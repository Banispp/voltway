import os

manifest_path = os.path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml')
main_activity_dir = os.path.join('android', 'app', 'src', 'main', 'java', 'com', 'voltway', 'evroute')
main_activity_path = os.path.join(main_activity_dir, 'MainActivity.java')

# 1. Inject Permissions and TTS Intent Query into AndroidManifest.xml
if os.path.exists(manifest_path):
    with open(manifest_path, 'r', encoding='utf-8') as f:
        content = f.read()

    perms = """
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />
"""

    queries = """
    <queries>
        <intent>
            <action android:name="android.intent.action.TTS_SERVICE" />
        </intent>
    </queries>
"""

    if 'ACCESS_FINE_LOCATION' not in content:
        content = content.replace('<application', perms + '\n    <application')
    
    if '<queries>' not in content:
        content = content.replace('<application', queries + '\n    <application')

    with open(manifest_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[VoltWay Build] Injected GPS location permissions & TTS queries into AndroidManifest.xml successfully!')
else:
    print(f'[VoltWay Build] AndroidManifest.xml not found at {manifest_path}')

# 2. Inject Native Android TextToSpeech Bridge into MainActivity.java
java_code = """package com.voltway.evroute;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private TextToSpeech tts;
    private boolean ttsReady = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    if (status == TextToSpeech.SUCCESS && tts != null) {
                        tts.setLanguage(Locale.US);
                        tts.setSpeechRate(0.96f);
                        tts.setPitch(1.0f);
                        ttsReady = true;
                    }
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
        }

        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void speak(String text) {
                    if (tts != null && text != null && !text.trim().isEmpty()) {
                        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "VoltWayNav");
                    }
                }

                @JavascriptInterface
                public void stop() {
                    if (tts != null) {
                        tts.stop();
                    }
                }

                @JavascriptInterface
                public boolean isReady() {
                    return ttsReady;
                }
            }, "AndroidTTS");
        }
    }

    @Override
    public void onDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.onDestroy();
    }
}
"""

if os.path.exists(main_activity_dir):
    with open(main_activity_path, 'w', encoding='utf-8') as f:
        f.write(java_code)
    print('[VoltWay Build] Injected native AndroidTTS JavascriptInterface into MainActivity.java successfully!')
else:
    print(f'[VoltWay Build] MainActivity directory not found at {main_activity_dir}')

