import os

manifest_path = os.path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml')
main_activity_dir = os.path.join('android', 'app', 'src', 'main', 'java', 'com', 'voltway', 'evroute')
main_activity_path = os.path.join(main_activity_dir, 'MainActivity.java')

# 1. Inject Minimal Required Permissions & Android 11+ TTS Service Query
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

    queries = """
    <queries>
        <intent>
            <action android:name="android.intent.action.TTS_SERVICE" />
        </intent>
    </queries>
"""

    missing_perms = [p for p in required_perms if p.split('"')[1] not in content]
    if missing_perms:
        content = content.replace('<application', '    ' + '\n    '.join(missing_perms) + '\n\n    <application')

    if 'TTS_SERVICE' not in content:
        content = content.replace('<application', queries + '\n    <application')

    with open(manifest_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[VoltWay Build] Injected GPS, WakeLock & TTS queries into AndroidManifest.xml cleanly!')
else:
    print(f'[VoltWay Build] AndroidManifest.xml not found at {manifest_path}')

# 2. Inject Native Android TextToSpeech Bridge with Navigation AudioFocus Ducking & Bluetooth Support
java_code = """package com.voltway.evroute;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;

    private final AudioManager.OnAudioFocusChangeListener focusChangeListener = focusChange -> {
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            if (tts != null) {
                tts.stop();
            }
        }
    };

    private void requestNavAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest == null) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(attrs)
                        .setOnAudioFocusChangeListener(focusChangeListener)
                        .build();
                }
                audioManager.requestAudioFocus(focusRequest);
            } else {
                audioManager.requestAudioFocus(
                    focusChangeListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                );
            }
        } catch (Exception ignored) {}
    }

    private void abandonNavAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
                audioManager.abandonAudioFocusRequest(focusRequest);
            } else {
                audioManager.abandonAudioFocus(focusChangeListener);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);

        try {
            tts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    int res = tts.setLanguage(new Locale("en", "IN"));
                    if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                        res = tts.setLanguage(Locale.UK);
                    }
                    if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                        tts.setLanguage(Locale.US);
                    }
                    tts.setSpeechRate(0.98f);
                    tts.setPitch(1.0f);

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        AudioAttributes navAttrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build();
                        tts.setAudioAttributes(navAttrs);
                    }

                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {}

                        @Override
                        public void onDone(String utteranceId) {
                            abandonNavAudioFocus();
                        }

                        @Override
                        public void onError(String utteranceId) {
                            abandonNavAudioFocus();
                        }
                    });

                    ttsReady = true;
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
        }

        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void speak(String text, boolean flush) {
                    if (tts != null && ttsReady && text != null && !text.trim().isEmpty()) {
                        requestNavAudioFocus();
                        int mode = flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
                        Bundle params = new Bundle();
                        params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
                        tts.speak(text, mode, params, "VoltWayNav_" + System.currentTimeMillis());
                    }
                }

                @JavascriptInterface
                public void speak(String text) {
                    speak(text, true);
                }

                @JavascriptInterface
                public void stop() {
                    if (tts != null) {
                        tts.stop();
                    }
                    abandonNavAudioFocus();
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
        abandonNavAudioFocus();
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
    print('[VoltWay Build] Injected native AndroidTTS with AudioFocus ducking into MainActivity.java!')
else:
    print(f'[VoltWay Build] MainActivity directory not found at {main_activity_dir}')
