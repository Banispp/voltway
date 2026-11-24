# VoltWay 2W - Android Installation, Packaging & CI/CD Guide (v5.20)

VoltWay 2W is a **100% zero-server-cost**, production-ready Android EV Route Planner application engineered specifically for Indian 2-wheeler electric vehicles (Ather 450X, Ather Rizta, Hero VIDA, Bolt.Earth users, Ola, TVS iQube, Bajaj Chetak, and other 2W EVs).

---

## ⚡ Highlights & Architecture (v5.20)

1. **11,450 Pre-Packaged 2W Compatible Chargers Out-of-the-Box**:
   - **3,572 Ather Grid DC Fast Chargers** fetched directly from Ather Energy endpoints.
   - **611 Hero VIDA Type 7 LEV Fast Chargers** fetched from Hero VIDA API.
   - **7,267 Bolt.Earth Chargers** (550 Fast Chargers + 6,717 15A / 3-pin Slow Sockets) with **car-exclusive CCS2 chargers automatically filtered out**.
2. **Turn-by-Turn Human Voice Guidance (Google Maps Style)**:
   - Built-in In-App Drive Guidance HUD with natural human voice prompts (*"In 100 meters, turn right"*, *"Destination on right"*).
   - Dynamic selection of high-fidelity Google Natural TTS voices.
   - Web Audio dual-tone EV alert chimes (G5 -> C6).
   - Audio pre-warming on user gesture to prevent WebView playback muting.
3. **CartoDB Dark Matter & 360° Tilt-Compensated Rotation**:
   - Google Maps style dark mode tiles for night visibility and battery saving.
   - 3D orientation vector `[0, cos(B), -sin(B)]^T` for flawless 360° map rotation on motorcycle/scooter handlebar mounts.
4. **Live Auto-Sync & Zero Server Costs**:
   - Directly queries Bolt.Earth and remote database OTA updates.
   - Saves all points offline into client **IndexedDB** & **Service Worker Cache**.
5. **Intelligent EV Range & Buffer Engine**:
   - `Reachable Distance (km) = (Current Battery % - Reserve %) * Efficiency`
   - Real-time Safe Range Ring overlaid directly on the Leaflet map.
   - Customizable corridor search buffer (typed in km).
   - Fast Charge Target SoC Limit slider.

---

## 📲 How to Install as an Android App

### Method 1: Download Pre-Built Android APK (Instant)

Every push to the `master` branch triggers an automated GitHub Actions CI/CD pipeline that compiles and publishes the latest signed debug APK:

1. Download the latest build directly: [VoltWay.apk](file:///c:/Users/banis/OneDrive/Desktop/ather/VoltWay.apk)
2. Or download from GitHub Releases: [https://github.com/Banispp/voltway/releases/latest](https://github.com/Banispp/voltway/releases/latest)
3. Transfer the `.apk` file to your Android phone and install!

---

### Method 2: Instant PWA Installation (Browser-to-App)

1. Host the folder on **GitHub Pages**, **Vercel**, **Netlify**, or run `python serve.py` locally.
2. Open the URL in **Google Chrome** on your Android smartphone.
3. Tap the **"📲 Install App"** button in the top bar (or tap Chrome's three-dot menu `⋮` -> **"Install App"** / **"Add to Home Screen"**).
4. VoltWay 2W installs directly onto your phone's app drawer with custom splash screen and standalone fullscreen experience.
5. **Works 100% Offline!** All 11,450 chargers, map engines, and calculators run without cellular coverage.

---

### Method 3: Native Android Studio Build with Capacitor

To build or customize the native Android project locally:

```bash
# 1. Prepare web directory
mkdir -p www
cp -r index.html manifest.json sw.js chargers_db.js chargers_db.json css js icons www/

# 2. Install Capacitor dependencies
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/geolocation

# 3. Add and sync Android platform
npx cap add android
npx cap sync android

# 4. Inject runtime GPS and audio permissions
python scripts/inject_permissions.py

# 5. Build debug APK using Gradle
cd android
./gradlew assembleDebug

# Output APK path:
# android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🛠️ Automated Sync & Harvest Scripts

To update the bundled chargers database across all 3 major Indian 2W networks:

```bash
# Master deep scan across Ather, Hero VIDA, and Bolt.Earth (384 national cells)
python scripts/sync_all_networks.py
```

This runs:
1. `scripts/download_ather.py` — Official Ather Grid API
2. `scripts/download_vida.py` — Official Hero VIDA API
3. `scripts/harvest_bolt_national.py` — Bolt.Earth unclustered zoom-18 deep harvester
4. `scripts/merge_and_update.py` — Re-generates `chargers_db.js` and `chargers_db.json`

The GitHub Actions workflow (`.github/workflows/auto_sync_chargers.yml`) executes this scan automatically twice every day at 00:00 and 12:00 UTC.
