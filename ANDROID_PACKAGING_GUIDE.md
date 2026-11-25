# VoltWay 2W — Android Capacitor 6 Packaging Guide (v5.50)

VoltWay 2W packages directly as an **offline-first Capacitor 6 Android APK** bundling all web assets (`index.html`, `css/`, `js/`, `icons/`, `chargers_db.json`) inside local `www/` (`"androidScheme": "https"`). No remote `server.url` is required for app startup.

---

## Automated GitHub Actions Build (`.github/workflows/build-apk.yml`)

Pushing to `master` (or triggering **Actions → Build VoltWay Android APK → Run workflow**) builds `android/app/build/outputs/apk/debug/app-debug.apk` with:

1. Node.js 22 & Java JDK 17 (`temurin`, Capacitor 6 compatible)
2. Local `www/` staging of `index.html`, `manifest.json`, `sw.js`, `chargers_db.json`, `css/`, `js/`, `icons/`
3. Capacitor 6 packages: `@capacitor/core@^6`, `@capacitor/cli@^6`, `@capacitor/android@^6`, `@capacitor/geolocation@^6`, `@capacitor/app@^6`
4. `python scripts/inject_permissions.py`, which configures:
   - `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`
   - Android `<queries>` intent for `android.intent.action.TTS_SERVICE`
   - Native `MainActivity.java` `AndroidTTS` `@JavascriptInterface` with `en-IN` offline speech, `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE`, `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`, and `UtteranceProgressListener`
5. `./gradlew assembleDebug` and GitHub Release publication (`v5.50-release`).

---

## Manual Local Build Prerequisites

To compile the Android APK locally on a developer machine, install:

- **Node.js 20+** and **npm**
- **Java JDK 17 or 21**
- **Android SDK** (`ANDROID_HOME` with Android API 34/35 `platforms` and `build-tools`)

Then run in the repository root:

```bash
mkdir -p www
cp -r index.html manifest.json sw.js chargers_db.json css js icons www/
npm init -y
npm install @capacitor/core@^6 @capacitor/cli@^6 @capacitor/android@^6 @capacitor/geolocation@^6 @capacitor/app@^6
npx cap add android
npx cap sync android
python scripts/inject_permissions.py
cd android
./gradlew assembleDebug
```

Output APK location: `android/app/build/outputs/apk/debug/app-debug.apk`.
