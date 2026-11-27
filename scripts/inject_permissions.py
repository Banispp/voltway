import os

manifest_path = os.path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml')

# Inject only minimal required permissions (no background GPS, no TTS queries)
if os.path.exists(manifest_path):
    with open(manifest_path, 'r', encoding='utf-8') as f:
        content = f.read()

    required_perms = [
        '<uses-permission android:name="android.permission.INTERNET" />',
        '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
        '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
        '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
        '<uses-permission android:name="android.permission.WAKE_LOCK" />',
        '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
    ]

    missing_perms = [p for p in required_perms if p.split('"')[1] not in content]
    if missing_perms:
        content = content.replace('<application', '    ' + '\n    '.join(missing_perms) + '\n\n    <application')

    if '<queries' not in content:
        queries_block = (
            '    <queries>\n'
            '        <package android:name="com.athermobileapp" />\n'
            '        <package android:name="com.hero.vida" />\n'
            '        <package android:name="com.revos.bolt.android" />\n'
            '        <intent>\n'
            '            <action android:name="android.intent.action.VIEW" />\n'
            '            <data android:scheme="market" />\n'
            '        </intent>\n'
            '        <intent>\n'
            '            <action android:name="android.intent.action.VIEW" />\n'
            '            <data android:scheme="https" />\n'
            '        </intent>\n'
            '    </queries>\n\n    <application'
        )
        content = content.replace('<application', queries_block)

    if 'android.intent.action.SEND' not in content:
        share_filters = (
            '\n            <intent-filter>\n'
            '                <action android:name="android.intent.action.SEND" />\n'
            '                <category android:name="android.intent.category.DEFAULT" />\n'
            '                <data android:mimeType="text/plain" />\n'
            '            </intent-filter>\n'
            '            <intent-filter>\n'
            '                <action android:name="android.intent.action.VIEW" />\n'
            '                <category android:name="android.intent.category.DEFAULT" />\n'
            '                <category android:name="android.intent.category.BROWSABLE" />\n'
            '                <data android:scheme="geo" />\n'
            '            </intent-filter>\n'
            '        </activity>'
        )
        main_pos = content.find('MainActivity')
        if main_pos != -1:
            end_pos = content.find('</activity>', main_pos)
            if end_pos != -1:
                content = content[:end_pos] + share_filters + content[end_pos + len('</activity>'):]

    with open(manifest_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[VoltWay Build] Injected GPS, WakeLock, EV <queries> & Google Maps Share intent-filters cleanly!')
else:
    print(f'[VoltWay Build] AndroidManifest.xml not found at {manifest_path}')

main_activity_path = os.path.join('android', 'app', 'src', 'main', 'java', 'com', 'voltway', 'evroute', 'MainActivity.java')
if os.path.exists(main_activity_path):
    main_activity_java = """package com.voltway.evroute;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private volatile String pendingShareText = null;

    public class VoltWayShareBridge {
        @JavascriptInterface
        public String consumePendingShare() {
            String val = pendingShareText;
            pendingShareText = null;
            return val != null ? val : "";
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Capture intent BEFORE super.onCreate() so it is available during app init
        captureShareIntent(getIntent(), false);
        super.onCreate(savedInstanceState);
        // addJavascriptInterface after super.onCreate() — WebView exists now.
        // The interface is active for all JS loaded after this point.
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.addJavascriptInterface(new VoltWayShareBridge(), "VoltWayAndroidShare");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureShareIntent(intent, true);
    }

    private void captureShareIntent(Intent intent, boolean notifyWeb) {
        if (intent == null) return;
        String action = intent.getAction();
        String extracted = null;
        if (Intent.ACTION_SEND.equals(action)) {
            String txt = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subj = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (txt != null && !txt.trim().isEmpty()) {
                if (subj != null && !subj.trim().isEmpty() && !txt.contains(subj.trim())) {
                    extracted = subj.trim() + "\\n" + txt.trim();
                } else {
                    extracted = txt.trim();
                }
            } else if (subj != null && !subj.trim().isEmpty()) {
                extracted = subj.trim();
            }
        } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            if ("geo".equalsIgnoreCase(intent.getScheme())) {
                extracted = intent.getDataString();
            }
        }
        if (extracted == null || extracted.isEmpty()) return;
        pendingShareText = extracted;
        if (notifyWeb && getBridge() != null && getBridge().getWebView() != null) {
            final String sharePayload = extracted.replace("\\\\", "\\\\\\\\").replace("\"", "\\\\\"").replace("\\n", "\\\\n");
            final WebView wv = getBridge().getWebView();
            // Push text directly — do NOT rely on consumePendingShare() for warm launches
            wv.post(() -> wv.evaluateJavascript(
                "(function(){var t=\\"" + sharePayload + "\\";pendingShareText=t;" +
                "if(window.handleVoltwayIncomingShare){window.handleVoltwayIncomingShare(t)}" +
                "else if(window.checkIncomingNativeShare){window.checkIncomingNativeShare()}})()",
                null
            ));
        }
    }
}
"""
    with open(main_activity_path, 'w', encoding='utf-8') as f:
        f.write(main_activity_java)
    print('[VoltWay Build] Updated MainActivity.java with Android Share & geo: intent bridge cleanly!')
else:
    print(f'[VoltWay Build] MainActivity.java not found at {main_activity_path}')
