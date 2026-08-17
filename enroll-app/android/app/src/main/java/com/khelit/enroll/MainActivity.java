package com.khelit.enroll;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // targetSdk 36 makes edge-to-edge mandatory (Android 15+) — the
        // WebView draws behind the system status/navigation bars by default,
        // which let the /join page's fixed-position bottom nav pill render
        // underneath (visually mixing with) the phone's own 3-button nav
        // bar. Consuming the bottom inset as real WebView padding keeps
        // content clear of the system bar natively, instead of depending on
        // CSS env(safe-area-inset-*) being correctly propagated through
        // Capacitor's WebView bridge — that alone wasn't enough on the
        // device this was tested on.
        View webView = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(0, 0, 0, bars.bottom);
            return insets;
        });
    }
}
