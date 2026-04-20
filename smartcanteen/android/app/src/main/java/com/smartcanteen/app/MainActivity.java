package com.smartcanteen.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmartCanteenBiometricsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
