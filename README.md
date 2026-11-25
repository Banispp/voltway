# VoltWay 2W — EV Two-Wheeler Route Planner & Navigation (v5.50)

Offline-first Progressive Web App (PWA) and Capacitor 6 Android application engineered specifically for Indian electric two-wheelers (**Ather**, **Hero VIDA**, **Ola**, **TVS iQube**, **Bajaj Chetak**).

---

## Core Capabilities (v5.50)

- **Verified 9,286 2-Wheeler Charging Stations**:
  - **3,572** Ather Grid Type 7 LECCS fast chargers (`ATHER_GRID`)
  - **611** Hero VIDA Type 7 LECCS fast chargers (`VIDA_GRID`)
  - **5,103** Bolt.Earth 2W chargers (`550` 2W Fast [492 Type 6/7 combo, 44 Type 6-only LEVDC, 14 Type 7 LECCS] + `4,553` 15A portable AC sockets)
  - **Strict 4W Exclusion**: 2,164 four-wheeler (`OCPP_LEVEL_2`, `OCPP_LEVEL_3`, `OCPI`) records are excluded from recommendations and preserved separately in `backups/non_2w_quarantined_bolt.json`.
  - **Zero Hallucinated Live Availability**: Static database reflects verified station metadata; OEM app deep-links allow checking live gun availability before arrival.
- **2W Physics-Aware Battery & Charging Engine** (`js/battery.js`, `js/utilities.js`):
  - Per-scooter riding modes (`ECO`, `RIDE`, `SPORT`, `WARP`, `NORMAL`, `HYPER`, `POWER`, `SPORTS`) with `km / 1%` consumption, safety reserve buffer (`5%–35%`), conservative `-10%` range estimate, and connector compatibility checks (`TYPE7` vs `TYPE6` vs `AC_PORTABLE`).
  - Charging duration estimation models vehicle battery capacity (`kWh`), charger power rating (`kW`), and `>80%` CC-CV constant-voltage taper.
- **Multi-Stop OSRM Routing & Auto-Stop Planner** (`js/router.js`):
  - Uses OSRM car/motor-road profiles (`routing.openstreetmap.de/routed-car` and `router.project-osrm.org`), excluding bicycle routing.
  - Supports multi-route alternatives, polyline-ordered waypoints, adjustable corridor buffer (`1–100 km`), `2x` corridor detour accounting, and **Fast Hop** vs **Full Target** timelines.
- **Offline Turn-by-Turn HUD & Zero-Cost Voice Guidance** (`js/voice.js`, `js/app.js`, `js/map.js`):
  - OLED dark HUD (`#06090f` / `#0b1220`) with live speed, maneuver banner, upcoming charger badge, live ETA, WakeLock screen hold, magnetic/GPS heading fusion, and mute toggle (`#btn-hud-sound`).
  - Priority 1: Native offline `AndroidTTS` bridge (with `AudioManager` ducking & `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE`); Priority 2: Web `speechSynthesis`; Priority 3: Web Audio harmonic chimes.
- **Offline-First PWA + Capacitor 6 Android Architecture**:
  - Single minified `chargers_db.json` (~4.1 MB) cached in IndexedDB (`voltway_db_schema_version = 5.50-clean-2w`) and Service Worker (`sw.js`, `voltway-2w-v5-50`, bounded 350-tile LRU cache).
  - Boots offline directly from bundled local `www/` inside Capacitor 6 (`androidScheme: "https"`).

---

## Project Structure

- `index.html`, `css/app.css`, `manifest.json`, `sw.js`, `capacitor.config.json`
- `js/`: `battery.js`, `sync.js`, `navigator.js`, `voice.js`, `router.js`, `utilities.js`, `map.js`, `app.js`, `leaflet-rotate.js`
- `scripts/`: `charger_validator.py`, `download_ather.py`, `download_vida.py`, `harvest_bolt_national.py`, `merge_and_update.py`, `sync_all_networks.py`, `inject_permissions.py`
- `chargers_db.json`: Unified verified 2W station database (`9,286` stations)
- `serve.py`: Local HTTP development server & Google Maps short-link resolver (`/api/resolve-maps-url`)

---

## Local Run & Data Sync

```bash
# Serve locally (recommended — also handles Google Maps short-link resolution)
python serve.py

# Refresh and validate the 2W charger database
python scripts/sync_all_networks.py
python scripts/merge_and_update.py
```

Android APKs are built via GitHub Actions (`.github/workflows/build-apk.yml`) using Capacitor 6 and JDK 21 (see [ANDROID_PACKAGING_GUIDE.md](ANDROID_PACKAGING_GUIDE.md)).
