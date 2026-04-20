package com.smartcanteen.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SmartCanteenBackgroundAlerts")
public class BackgroundAlertsPlugin extends Plugin {
    static final String PREFS_NAME = "smartcanteen_background_alerts";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_API_BASE = "api_base";
    static final String KEY_TOKEN = "token";
    static final String KEY_LOW_STOCK_SIGNATURE = "low_stock_signature";
    static final String KEY_HIGH_DEMAND_SIGNATURE = "high_demand_signature";

    @PluginMethod
    public void configure(PluginCall call) {
        String token = call.getString("token", "");
        String apiBase = call.getString("apiBase", "");
        Boolean enabledValue = call.getBoolean("enabled");
        boolean enabled = enabledValue == null || enabledValue;

        if (!enabled || token == null || token.trim().isEmpty() || apiBase == null || apiBase.trim().isEmpty()) {
            stop(call);
            return;
        }

        SharedPreferences preferences = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        preferences.edit()
            .putBoolean(KEY_ENABLED, true)
            .putString(KEY_TOKEN, token.trim())
            .putString(KEY_API_BASE, apiBase.trim())
            .apply();

        BackgroundAlertScheduler.schedule(getContext());
        BackgroundAlertScheduler.refreshNow(getContext());

        JSObject response = new JSObject();
        response.put("enabled", true);
        call.resolve(response);
    }

    @PluginMethod
    public void refreshNow(PluginCall call) {
        BackgroundAlertScheduler.refreshNow(getContext());

        JSObject response = new JSObject();
        response.put("queued", true);
        call.resolve(response);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        preferences.edit()
            .putBoolean(KEY_ENABLED, false)
            .remove(KEY_TOKEN)
            .remove(KEY_API_BASE)
            .remove(KEY_LOW_STOCK_SIGNATURE)
            .remove(KEY_HIGH_DEMAND_SIGNATURE)
            .apply();

        BackgroundAlertScheduler.cancel(getContext());

        JSObject response = new JSObject();
        response.put("enabled", false);
        call.resolve(response);
    }
}
