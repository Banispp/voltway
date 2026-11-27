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
    # NOTE: This is a plain string written verbatim to MainActivity.java.
    # Keep Java escape sequences minimal — no dynamic string embedding in evaluateJavascript.
    main_activity_java = (
        'package com.voltway.evroute;\n'
        '\n'
        'import android.content.Intent;\n'
        'import android.os.Bundle;\n'
        'import android.webkit.JavascriptInterface;\n'
        'import android.webkit.WebView;\n'
        'import com.getcapacitor.BridgeActivity;\n'
        '\n'
        'public class MainActivity extends BridgeActivity {\n'
        '    private volatile String pendingShareText = null;\n'
        '\n'
        '    public class VoltWayShareBridge {\n'
        '        @JavascriptInterface\n'
        '        public String consumePendingShare() {\n'
        '            String val = pendingShareText;\n'
        '            pendingShareText = null;\n'
        '            return val != null ? val : "";\n'
        '        }\n'
        '    }\n'
        '\n'
        '    @Override\n'
        '    public void onCreate(Bundle savedInstanceState) {\n'
        '        super.onCreate(savedInstanceState);\n'
        '        // addJavascriptInterface right after super.onCreate() — WebView exists now.\n'
        '        // JS loaded after this point can call window.VoltWayAndroidShare.consumePendingShare().\n'
        '        WebView webView = getBridge() != null ? getBridge().getWebView() : null;\n'
        '        if (webView != null) {\n'
        '            webView.addJavascriptInterface(new VoltWayShareBridge(), "VoltWayAndroidShare");\n'
        '        }\n'
        '        captureShareIntent(getIntent(), false);\n'
        '    }\n'
        '\n'
        '    @Override\n'
        '    protected void onNewIntent(Intent intent) {\n'
        '        super.onNewIntent(intent);\n'
        '        setIntent(intent);\n'
        '        captureShareIntent(intent, true);\n'
        '    }\n'
        '\n'
        '    private void captureShareIntent(Intent intent, boolean notifyWeb) {\n'
        '        if (intent == null) return;\n'
        '        String action = intent.getAction();\n'
        '        String extracted = null;\n'
        '        if (Intent.ACTION_SEND.equals(action)) {\n'
        '            String txt = intent.getStringExtra(Intent.EXTRA_TEXT);\n'
        '            String subj = intent.getStringExtra(Intent.EXTRA_SUBJECT);\n'
        '            if (txt != null && !txt.trim().isEmpty()) {\n'
        '                if (subj != null && !subj.trim().isEmpty() && !txt.contains(subj.trim())) {\n'
        '                    extracted = subj.trim() + "\\n" + txt.trim();\n'
        '                } else {\n'
        '                    extracted = txt.trim();\n'
        '                }\n'
        '            } else if (subj != null && !subj.trim().isEmpty()) {\n'
        '                extracted = subj.trim();\n'
        '            }\n'
        '        } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {\n'
        '            if ("geo".equalsIgnoreCase(intent.getScheme())) {\n'
        '                extracted = intent.getDataString();\n'
        '            }\n'
        '        }\n'
        '        if (extracted == null || extracted.isEmpty()) return;\n'
        '        pendingShareText = extracted;\n'
        '        if (notifyWeb && getBridge() != null && getBridge().getWebView() != null) {\n'
        '            final WebView wv = getBridge().getWebView();\n'
        '            // Trigger JS poll — pendingShareText stored; consumePendingShare() will return it.\n'
        '            wv.post(() -> wv.evaluateJavascript(\n'
        '                "if(window.checkIncomingNativeShare)window.checkIncomingNativeShare();",\n'
        '                null\n'
        '            ));\n'
        '        }\n'
        '    }\n'
        '}\n'
    )
    with open(main_activity_path, 'w', encoding='utf-8') as f:
        f.write(main_activity_java)
    print('[VoltWay Build] Updated MainActivity.java with Android Share & geo: intent bridge cleanly!')
else:
    print(f'[VoltWay Build] MainActivity.java not found at {main_activity_path}')
