# VoltWay 2W - Android Installation & Deployment Guide

VoltWay 2W is a **100% zero-server-cost**, production-ready Android EV Route Planner application engineered specifically for 2-wheeler electric vehicles (Ather 450X, Ather Rizta, Bolt.Earth users, Ola, TVS iQube, and other 2W EVs).

---

## ⚡ Key Highlights & Zero-Server Architecture

1. **4,727 Pre-Packaged 2W Compatible Chargers Out-of-the-Box**:
   - **3,572 Ather Grid DC Fast Chargers** fetched directly from Ather Energy's official endpoints.
   - **1,155 Bolt.Earth Chargers** (262 Fast Chargers + 893 15A / 3-pin Slow Sockets) with **car-exclusive CCS2 chargers automatically filtered out**.
2. **Live Auto-Sync Without Server Costs**:
   - Directly queries Bolt.Earth's live discovery API (`https://api.bolt.earth/discovery/v1/chargers/clusters`) with CORS enabled as you pan and plan routes.
   - Saves all points offline into client **IndexedDB** & **Service Worker Cache**.
3. **Turn-by-Turn Voice Navigation Deep-Linking**:
   - 1-tap **"Start Full Trip in Google Maps"** constructs a universal multi-stop link (`A -> B -> C -> D`) that opens natively in Google Maps.
   - 1-tap **"Navigate to Next Charger"** for instant intermediate stop routing.
4. **Intelligent EV Range & Buffer Engine**:
   - `Reachable Distance (km) = (Current Battery % - Reserve %) * Efficiency`
   - Real-time Safe Range Ring overlaid directly on the Leaflet map.
   - Automatic suggestion of optimal charging waypoints along the route corridor (within 2.5 km).
5. **Sunlight-Readability Mode**:
   - High-contrast outdoor mode engineered for bright tropical sunlight on two-wheeler handlebar mounts.

---

## 📲 How to Install as an Android App

### Method 1: Instant PWA Installation (Recommended - No Dev Tools Required)

1. Host the folder on **GitHub Pages** (100% free forever) or any static host (Netlify, Vercel, Firebase Free Tier).
   - Alternatively, run `python serve.py` on your computer and connect from your Android phone on the same Wi-Fi (`http://<your-computer-ip>:8080`).
2. Open the URL in **Google Chrome** on your Android smartphone.
3. Tap the **"📲 Install App"** button in the header (or tap Chrome's three-dot menu `⋮` -> **"Install App"** or **"Add to Home Screen"**).
4. VoltWay 2W installs directly onto your Android app drawer and home screen with its custom icon, splash screen, and full-screen standalone experience (no browser URL bar).
5. **Works 100% Offline!** All 4,727 chargers, mapping engine, and calculators run even without cell reception on highways.

---

### Method 2: Generate Signed Android APK with PWABuilder (2 Minutes)

Microsoft PWABuilder lets you wrap any PWA into a native Google Play Store `.apk` / `.aab` package with zero Java/Kotlin coding:

1. Push this repository to GitHub and enable **GitHub Pages** in Repository Settings.
2. Visit [https://www.pwabuilder.com/](https://www.pwabuilder.com/).
3. Enter your GitHub Pages URL (e.g. `https://<username>.github.io/<repo>/`).
4. Click **"Package for Android"**.
5. Download your ready-to-install Android `.apk` or publish directly to the Google Play Store!

---

### Method 3: Native Android Studio Build with Capacitor

If you want to compile a raw native Android Studio APK locally:

```bash
# 1. Install Capacitor CLI (if Node is installed)
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. Add Android platform
npx cap add android

# 3. Copy web assets and sync
npx cap copy
npx cap sync

# 4. Open in Android Studio
npx cap open android
```
In Android Studio:
- Select **Build** -> **Build Bundle(s) / APK(s)** -> **Build APK(s)**.
- Transfer the generated `app-debug.apk` to your phone and install!

---

## 🛠️ Automated Scripts & Data Refresh

To update the bundled chargers database with the latest stations:

```bash
# Fetch latest Ather Grid chargers from Ather Energy
python scripts/download_ather.py

# Fetch latest Bolt.Earth chargers from live API
python scripts/download_bolt.py

# Merge and update chargers_db.json & chargers_db.js
python scripts/merge_and_update.py
```

You can even set up a free **GitHub Actions** cron workflow that runs these scripts weekly to automatically keep the database fresh!
