# ⚡ VoltWay 2W: Indian 2-Wheeler EV Route Planner & Navigation Cockpit (v5.20)

[![Build VoltWay Android APK](https://github.com/Banispp/voltway/actions/workflows/build-apk.yml/badge.svg)](https://github.com/Banispp/voltway/actions/workflows/build-apk.yml)
[![Auto-Sync EV Chargers Database](https://github.com/Banispp/voltway/actions/workflows/auto_sync_chargers.yml/badge.svg)](https://github.com/Banispp/voltway/actions/workflows/auto_sync_chargers.yml)
[![Latest Release](https://img.shields.io/github/v/release/Banispp/voltway?label=Latest%20APK&color=00e676)](https://github.com/Banispp/voltway/releases/latest)

A high-performance, **zero-server-cost** Android EV Route Planner application engineered specifically for Indian 2-wheeler electric vehicle riders (optimized for **Ather 450X, Ather Rizta, Ather 450 Apex, Hero VIDA V1, Ola S1 Pro, TVS iQube, Bajaj Chetak**, and all 2W EVs).

Combines free open-source mapping (Leaflet, OpenStreetMap, CartoDB Dark Matter, OSRM) with **turn-by-turn human voice navigation**, **360° tilt-compensated compass rotation** for handlebar mounts, and an embedded offline database of **11,450 genuine 2W chargers**.

---

## 🚀 Key Highlights & Capabilities (v5.20)

### 1. Complete Pan-India 2W Charger Coverage (11,450 Stations)
- ⚡ **Ather Grid Fast Chargers (3,572 stations)**: Official Ather Energy high-speed DC fast chargers with live slot availability.
- ⚡ **Hero VIDA Fast Chargers (611 stations)**: Official Type 7 LEV DC Fast Chargers across Indian metro corridors.
- ⚡ **Bolt.Earth Fast Chargers (550 stations)**: 3.3 kW+ LEV DC and fast AC chargers verified for 2W EVs.
- 🔌 **Bolt.Earth 15A Sockets (6,717 stations)**: Standard 15A 3-pin AC plug points for portable travel chargers.
- 🛡️ **Zero Car Clutter**: Car-exclusive CCS2 and GB/T car guns are strictly excluded.

### 2. Turn-by-Turn Google Maps Style Human Voice Navigation
- **Natural Human Speech Synthesis**: Automatically selects Google Natural TTS Female voices (`Google UK English Female`, `Google English India`, `Google US English`, `Samantha`) rather than robotic offline fallbacks.
- **Intelligent Distance Trigger Announcements**:
  - **At 500 Meters**: *"In 500 meters, turn right onto National Highway 66"* / *"In 500 meters, your destination is on the right"*
  - **At 100 Meters**: Melodic alert chime + *"In 100 meters, turn left"*
  - **At Junction (< 35m)**: Chime + *"Turn left now onto Main Road"*
  - **Charging Stop Proximity**: *"Approaching Ather Fast Charging stop in 500 meters"*
  - **Arrival**: Harmonic 3-tone arrival chime + *"You have arrived at your destination"*
- **Audio Pre-Warming & Mobile Gesture Unlock**: AudioContext and speech engines are primed on user touch to prevent Android WebView silent-playback restrictions.
- **Interactive Sound Toggle & Test**: Tap the HUD speaker icon to hear immediate human voice feedback (*"Voice guidance active"*).
- **Secondary Google Maps Deep Link**: 1-tap launcher to export the entire multi-stop route into native Google Maps app.

### 3. Cockpit UI, Dark Mode & 360° Handlebar Mount Rotation
- **Google Maps Dark Mode Tiles**: High-contrast CartoDB Dark Matter tile layer with dark OLED background for reduced battery drain and glare-free night riding.
- **360° Tilt-Compensated Compass Tracking**: Utilizes a 3D gimbal-lock-free orientation vector `[0, cos(B), -sin(B)]^T` that keeps the map perfectly aligned with the rider's heading whether handheld, flat on a table, or mounted 90° upright on a motorcycle/scooter handlebar.
- **Automotive Driving HUD**: Shows upcoming maneuver icon, live remaining meters, street name, next charging stop badge, live ETA, and total trip duration.

### 4. Route Corridor & Battery Safety Range Engine
- **Manual Corridor Buffer Input**: Custom numeric input allowing riders to search chargers within any custom corridor distance (e.g. 5 km, 10 km, 25 km).
- **Battery SoC & Range Model**:
  - `Reachable Distance (km) = (Current Battery % - Reserve %) * Efficiency (km / 1%)`
  - Real-time Safe Range Ring overlaid directly around the rider's live position.
  - Interactive Fast Charge Target Limit slider (50% to 100%).
  - Pre-configured vehicle profiles for Ather, Ola, TVS, Bajaj, and VIDA.
  - Automatic intermediate charger stop suggestions along the travel corridor.

### 5. Automated CI/CD & Database Maintenance
- **GitHub Actions APK Build (`build-apk.yml`)**: Compiles and packages native Android APKs via Capacitor and automatically purges old releases, keeping only the single newest release on GitHub.
- **Automated Database Auto-Sync (`auto_sync_chargers.yml`)**: Runs twice daily to deep-scan all 384 national zoom-18 cells across India, fetching newly installed Ather, VIDA, and Bolt.Earth stations.

---

## 📥 Android APK Download

- **Latest Release**: [VoltWay.apk](file:///c:/Users/banis/OneDrive/Desktop/ather/VoltWay.apk)
- **GitHub Releases Page**: [https://github.com/Banispp/voltway/releases/latest](https://github.com/Banispp/voltway/releases/latest)

---

## 🏃 Running Locally

```bash
# Start local preview server with CORS support
python serve.py
```
Open [http://localhost:8080](http://localhost:8080) in your web browser.

---

## 📂 Repository Structure

```
ather/
├── index.html                   # Single-Page Application (PWA) with v5.20 cache busters
├── manifest.json                # Web App Manifest for Android installation
├── sw.js                        # Offline caching Service Worker (v5.20)
├── serve.py                     # Zero-dependency local preview server
├── chargers_db.js               # Bundled database of 11,450 2W chargers
├── chargers_db.json             # GeoJSON database for OTA sync
├── ather_grid_chargers.json     # 3,572 clean Ather Grid stations
├── vida_chargers.json           # 611 Hero VIDA Type 7 LEV fast chargers
├── bolt_chargers.json           # 7,267 Bolt.Earth fast & 15A sockets
├── ANDROID_PACKAGING_GUIDE.md   # Android APK & PWA packaging instructions
├── capacitor.config.json        # Capacitor Android native configuration
├── css/
│   └── app.css                  # Modern EV dashboard & Dark Matter styling
├── js/
│   ├── app.js                   # Master controller, DriveEngine human voice navigation HUD
│   ├── map.js                   # Leaflet map, 360° tilt-compensated rotation, CartoDB Dark Matter
│   ├── router.js                # OSRM router & corridor waypoint optimizer
│   ├── battery.js               # Battery consumption model & vehicle presets
│   ├── navigator.js             # Google Maps multi-stop deep linking engine
│   ├── sync.js                  # Live database OTA update & IndexedDB sync
│   ├── utilities.js             # SOS nearest locator & charging time calculator
│   └── leaflet-rotate.js        # Leaflet 360° map canvas rotation plugin
├── icons/                       # PWA & Android app icons (192px, 512px, SVG)
└── scripts/
    ├── sync_all_networks.py     # Master national deep-scan harvester
    ├── download_ather.py        # Ather Energy official API sync
    ├── download_vida.py         # Hero VIDA official API sync
    ├── harvest_bolt_national.py # Bolt.Earth national zoom-18 cell harvester
    ├── merge_and_update.py      # Re-generates database bundles
    └── inject_permissions.py    # Injects Android permissions for Capacitor APK build
```

---

## 📄 License
MIT License. Open-source for all electric vehicle riders across India.
