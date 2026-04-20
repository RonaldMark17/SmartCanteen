package com.smartcanteen.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

public class BackgroundAlertWorker extends Worker {
    private static final String LOW_STOCK_CHANNEL_ID = "low-stock-alerts";
    private static final String HIGH_DEMAND_CHANNEL_ID = "high-demand-alerts";
    private static final int LOW_STOCK_NOTIFICATION_ID = 4101;
    private static final int HIGH_DEMAND_NOTIFICATION_ID = 4102;

    public BackgroundAlertWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences preferences = context.getSharedPreferences(
            BackgroundAlertsPlugin.PREFS_NAME,
            Context.MODE_PRIVATE
        );

        if (!preferences.getBoolean(BackgroundAlertsPlugin.KEY_ENABLED, false)) {
            return Result.success();
        }

        String token = preferences.getString(BackgroundAlertsPlugin.KEY_TOKEN, "");
        String apiBase = trimTrailingSlash(preferences.getString(BackgroundAlertsPlugin.KEY_API_BASE, ""));
        if (token == null || token.isEmpty() || apiBase == null || apiBase.isEmpty()) {
            return Result.success();
        }

        try {
            JSONObject payload = fetchAlertSummary(apiBase, token);
            JSONArray lowStock = payload.optJSONArray("low_stock");
            JSONArray highDemand = payload.optJSONArray("high_demand");

            handleAlertGroup(
                preferences,
                BackgroundAlertsPlugin.KEY_LOW_STOCK_SIGNATURE,
                lowStock,
                "Low stock alert",
                "low stock alerts",
                LOW_STOCK_CHANNEL_ID,
                LOW_STOCK_NOTIFICATION_ID,
                true
            );
            handleAlertGroup(
                preferences,
                BackgroundAlertsPlugin.KEY_HIGH_DEMAND_SIGNATURE,
                highDemand,
                "High demand tomorrow",
                "high demand items tomorrow",
                HIGH_DEMAND_CHANNEL_ID,
                HIGH_DEMAND_NOTIFICATION_ID,
                false
            );
            return Result.success();
        } catch (UnauthorizedException exc) {
            BackgroundAlertScheduler.cancel(context);
            preferences.edit()
                .putBoolean(BackgroundAlertsPlugin.KEY_ENABLED, false)
                .remove(BackgroundAlertsPlugin.KEY_TOKEN)
                .apply();
            return Result.success();
        } catch (Exception exc) {
            return Result.retry();
        }
    }

    private JSONObject fetchAlertSummary(String apiBase, String token) throws Exception {
        URL url = new URL(apiBase + "/alerts/background-summary");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-SmartCanteen-Alert-Token", token);
        connection.setRequestProperty("X-SmartCanteen-Client", "native-background");
        connection.setRequestProperty("X-SmartCanteen-Platform", "android");
        connection.setRequestProperty("X-SmartCanteen-Device-Class", "mobile");

        int status = connection.getResponseCode();
        if (status == 401 || status == 403) {
            throw new UnauthorizedException();
        }
        if (status < 200 || status >= 300) {
            throw new IllegalStateException("Alert summary request failed: " + status);
        }

        try (InputStream stream = connection.getInputStream()) {
            return new JSONObject(readStream(stream));
        } finally {
            connection.disconnect();
        }
    }

    private void handleAlertGroup(
        SharedPreferences preferences,
        String signatureKey,
        JSONArray items,
        String singularTitle,
        String pluralTitle,
        String channelId,
        int notificationId,
        boolean lowStock
    ) {
        JSONArray safeItems = items == null ? new JSONArray() : items;
        String nextSignature = buildSignature(safeItems, lowStock);
        String previousSignature = preferences.getString(signatureKey, null);
        boolean hasNewSignature = !nextSignature.isEmpty() && !nextSignature.equals(previousSignature);

        preferences.edit().putString(signatureKey, nextSignature).apply();

        if (hasNewSignature) {
            String title = safeItems.length() == 1 ? singularTitle : safeItems.length() + " " + pluralTitle;
            String body = lowStock ? buildLowStockBody(safeItems) : buildHighDemandBody(safeItems);
            showNotification(channelId, notificationId, title, body);
        }
    }

    private String buildSignature(JSONArray items, boolean lowStock) {
        List<String> keys = new ArrayList<>();
        for (int index = 0; index < items.length(); index += 1) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) {
                continue;
            }

            String key = lowStock
                ? stringValue(item, "id", stringValue(item, "name", ""))
                : stringValue(item, "product_id", stringValue(item, "product_name", ""));
            if (!key.isEmpty()) {
                keys.add(key);
            }
        }

        Collections.sort(keys);
        return join(keys, "|");
    }

    private String buildLowStockBody(JSONArray items) {
        List<String> names = new ArrayList<>();
        for (int index = 0; index < Math.min(3, items.length()); index += 1) {
            JSONObject item = items.optJSONObject(index);
            if (item != null) {
                names.add(stringValue(item, "name", "Item"));
            }
        }

        int extraCount = Math.max(0, items.length() - 3);
        if (extraCount > 0) {
            return join(names, ", ") + ", and " + extraCount + " more items need attention.";
        }
        return join(names, ", ") + " need restocking soon.";
    }

    private String buildHighDemandBody(JSONArray items) {
        List<String> names = new ArrayList<>();
        for (int index = 0; index < Math.min(3, items.length()); index += 1) {
            JSONObject item = items.optJSONObject(index);
            if (item != null) {
                String quantity = String.format(
                    Locale.US,
                    "%.0f",
                    item.optDouble("predicted_quantity", 0)
                );
                names.add(stringValue(item, "product_name", "Item") + " (" + quantity + ")");
            }
        }

        int extraCount = Math.max(0, items.length() - 3);
        if (extraCount > 0) {
            return join(names, ", ") + ", and " + extraCount + " more items may sell faster than usual tomorrow.";
        }
        return join(names, ", ") + " may sell faster than usual tomorrow.";
    }

    private void showNotification(String channelId, int notificationId, String title, String body) {
        Context context = getApplicationContext();
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        ensureChannel(channelId);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);

        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
    }

    private void ensureChannel(String channelId) {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }

        Context context = getApplicationContext();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(channelId) != null) {
            return;
        }

        String name = LOW_STOCK_CHANNEL_ID.equals(channelId)
            ? "Low Stock Alerts"
            : "High Demand Alerts";
        String description = LOW_STOCK_CHANNEL_ID.equals(channelId)
            ? "Inventory warnings when products drop below minimum stock"
            : "Forecast warnings for items expected to sell fast tomorrow";
        NotificationChannel channel = new NotificationChannel(
            channelId,
            name,
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(description);
        manager.createNotificationChannel(channel);
    }

    private static String readStream(InputStream stream) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(stream, StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private static String trimTrailingSlash(String value) {
        if (value == null) {
            return "";
        }

        String normalized = value.trim();
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private static String stringValue(JSONObject item, String key, String fallback) {
        Object value = item.opt(key);
        if (value == null) {
            return fallback == null ? "" : fallback;
        }
        return String.valueOf(value);
    }

    private static String join(List<String> values, String separator) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < values.size(); index += 1) {
            if (index > 0) {
                builder.append(separator);
            }
            builder.append(values.get(index));
        }
        return builder.toString();
    }

    private static class UnauthorizedException extends Exception {
    }
}
