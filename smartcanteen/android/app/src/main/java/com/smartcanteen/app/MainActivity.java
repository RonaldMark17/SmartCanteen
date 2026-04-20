package com.smartcanteen.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAlertsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
