package com.smartcanteen.app;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;

@CapacitorPlugin(name = "SmartCanteenBiometrics")
public class SmartCanteenBiometricsPlugin extends Plugin {
    private static final int AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_WEAK |
        BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int status = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        JSObject result = new JSObject();
        result.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("code", status);
        result.put("message", statusMessage(status));
        call.resolve(result);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        int status = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        if (status != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject(statusMessage(status), "BIOMETRIC_UNAVAILABLE");
            return;
        }

        if (!(getActivity() instanceof FragmentActivity)) {
            call.reject("Biometric verification is unavailable in this activity.", "BIOMETRIC_ACTIVITY_UNAVAILABLE");
            return;
        }

        FragmentActivity activity = (FragmentActivity) getActivity();
        Executor executor = ContextCompat.getMainExecutor(getContext());
        BiometricPrompt prompt = new BiometricPrompt(
            activity,
            executor,
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    JSObject response = new JSObject();
                    response.put("verified", true);
                    call.resolve(response);
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    call.reject(errString.toString(), "BIOMETRIC_AUTH_FAILED");
                }

                @Override
                public void onAuthenticationFailed() {
                    notifyListeners("biometricAttemptFailed", new JSObject());
                }
            }
        );

        String title = call.getString("title", "SmartCanteen verification");
        String subtitle = call.getString("subtitle", "Confirm it is you to continue.");

        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build();

        prompt.authenticate(promptInfo);
    }

    private String statusMessage(int status) {
        switch (status) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                return "Biometric verification is available.";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "This device does not have biometric hardware.";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "Biometric hardware is currently unavailable.";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "No fingerprint, face unlock, or screen lock is set up on this device.";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:
                return "A security update is required before biometrics can be used.";
            case BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED:
                return "This device does not support the required biometric security level.";
            case BiometricManager.BIOMETRIC_STATUS_UNKNOWN:
            default:
                return "Biometric verification is not available right now.";
        }
    }
}
