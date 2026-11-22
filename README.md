# ⚡ VoltWay 2W: Android EV Route Planner (Ather & Bolt.Earth)

A production-ready, **zero-server-cost** Android EV Route Planner application engineered specifically for 2-wheeler electric vehicle riders (optimized for **Ather 450X, Ather 450 Apex, Ather Rizta, Bolt.Earth, Ola, TVS iQube**, and all 2W EVs).

Utilizes 100% free open-source mapping and routing APIs (Leaflet.js, OpenStreetMap, OSRM, Nominatim) with client-side persistence and deep-linking into native Google Maps for turn-by-turn voice navigation.

---

## 🚀 Key Features

### 1. Charger Networks & Connector Filtering
- **Ather Grid Fast Chargers (3,572 stations)**: High-speed DC fast chargers compatible with 2-wheelers, fetched straight from official Ather Energy infrastructure.
- **Bolt.Earth Fast Chargers (262 stations)**: 2-wheeler compatible DC and fast AC points.
- **Bolt.Earth Slow Chargers (893 stations)**: Standard 15A / 3-pin AC plug sockets for portable chargers.
- **Strict 4-Wheeler Car Exclusion**: Car-exclusive high-power CCS2 and GB/T car guns are automatically filtered out.

### 2. Map UI & Distinct Visual Pins
- **Leaflet.js + OSM Engine**: Completely free tiles with zero API keys or monthly bills.
- **Distinct Pin Badges & Color Coding**:
  - ⚡ **Ather Grid Fast**: Emerald Neon Green (`#00E676`) with glowing badge.
  - ⚡ **Bolt.Earth Fast**: Vivid Neon Amber/Orange (`#FF9100`).
  - 🔌 **Bolt.Earth 15A Socket**: Electric Blue (`#00B0FF`) with plug icon.
- **Sticky Filter Chips Bar**:
  - `[✓] Ather Grid (Fast)` (3,572)
  - `[✓] Bolt.Earth (Fast)` (262)
  - `[✓] Bolt.Earth (Slow 15A)` (893)
  - Instant marker visibility toggle.
- **Sunlight Readability Mode**: Toggle between AMOLED pitch-dark night mode and an ultra-high-contrast sunlight mode designed for handlebar phone mounts under bright tropical sun.

### 3. Battery Consumption & Range Engine
- **User Inputs**: Current Battery % (slider & number box) and customizable efficiency (`km / 1%`).
- **Vehicle Profiles**:
  - Ather 450X (3.7 kWh & 2.9 kWh)
  - Ather Rizta (3.7 kWh)
  - Ather 450 Apex (Warp+)
  - Ola S1 Pro Gen 2
  - TVS iQube
  - Bajaj Chetak
  - Hero Vida V1 Pro
- **Riding Mode Presets**:
  - 🟢 **Eco Mode**: 1% = 1.0 km (100 km / 100%)
  - 🟡 **Ride Mode**: 1% = 0.8 km (80 km / 100%)
  - 🔴 **Sport / Warp Mode**: 1% = 0.6 km (60 km / 100%)
- **Safety Reserve Margin**:
  - Configurable safety reserve buffer (default: 15%).
  - `Reachable Distance (km) = (Current Battery % - Reserve %) * Efficiency`
  - Safe Range Ring overlay rendered directly on the map around your position.
  - Range warning banner alerting you if destination or next stop drops below safety buffer.

### 4. Route Planning & Corridor Discovery
- **OSRM (Open Source Routing Machine)**: 100% free public driving route computation between Origin (A) and Destination (D).
- **Corridor Discovery**: Automatically identifies all compatible 2W chargers within 2.5 km of the route line.
- **Automatic Charging Stop Optimizer**: If trip distance exceeds current battery range, automatically discovers and suggests optimal intermediate stops (Point B, Point C) prioritized before battery hits reserve margin.

### 5. Native Google Maps Multi-Stop Navigation
- **1-Tap "Start Full Trip in Google Maps"**:
  Launches universal waypoint URL:
  `https://www.google.com/maps/dir/?api=1&origin={Origin}&destination={Dest}&waypoints={Stop1}|{Stop2}&travelmode=driving`
  Pre-populates turn-by-turn voice navigation with all intermediate charger stops in Google Maps.
- **1-Tap "Navigate to Next Charger"**: Direct navigation to the immediate next waypoint.

### 6. Rider Utilities
- **SOS / Nearest Charger**: Instant 1-tap geolocation pinpointing the closest fast charger & closest 15A socket with distance in km, battery required to reach, and direct directions.
- **Charging Time Estimator**:
  - Fast Charger: Estimates duration to 80% SoC (~1 km/min or ~35 mins for 20-80%).
  - Slow 15A Socket: Estimates duration and charge gain (~18-20% per hour).

### 7. Zero-Server Architecture & Data Sync
- Pre-packaged embedded database of **4,727 genuine 2W chargers** (`chargers_db.js` / `chargers_db.json`).
- Live client-side querying of Bolt.Earth API with CORS enabled.
- Offline persistence via IndexedDB & Progressive Web App Service Worker.
- In-app "Install App" button for 1-tap installation on Android smartphones.

---

## 🏃 Running Locally

```bash
# Start local preview server
python serve.py
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## 📂 Project Structure

```
ather/
├── index.html                   # Single-Page Application (PWA)
├── manifest.json                # Web App Manifest for Android installation
├── sw.js                        # Service Worker for 100% offline caching
├── serve.py                     # Zero-dependency local preview server
├── chargers_db.js               # Bundled database of 4,727 2W chargers
├── chargers_db.json             # Raw GeoJSON/JSON charger points
├── ather_grid_chargers.json     # 3,572 clean Ather Grid stations
├── bolt_chargers.json           # 1,155 clean Bolt.Earth stations
├── ANDROID_PACKAGING_GUIDE.md   # Android APK & PWA packaging instructions
├── capacitor.config.json        # Capacitor Android native configuration
├── css/
│   └── app.css                  # Modern EV dashboard & Sunlight contrast theme
├── js/
│   ├── app.js                   # Master controller & UI event binding
│   ├── map.js                   # Leaflet map, custom pins & safe range rings
│   ├── router.js                # OSRM router & corridor waypoint optimizer
│   ├── battery.js               # Battery consumption model & vehicle presets
│   ├── navigator.js             # Google Maps multi-stop deep linking engine
│   ├── sync.js                  # Live Bolt.Earth & Ather IndexedDB sync
│   └── utilities.js             # SOS nearest locator & charging time calculator
├── icons/                       # PWA & Android app icons (192px, 512px, SVG)
└── scripts/
    ├── download_ather.py        # Updates Ather Grid data from official API
    ├── download_bolt.py         # Updates Bolt.Earth data from live API
    └── merge_and_update.py      # Re-generates database bundles
```
