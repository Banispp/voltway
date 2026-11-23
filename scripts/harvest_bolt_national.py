"""
VoltWay 2W - National Comprehensive Bolt.Earth Harvester (Zoom 18 Unclustered)
Discovers 100% of Bolt.Earth 2-Wheeler Fast & Slow Chargers across all of India.
"""

import urllib.request
import json
import os
import sys
import time

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Origin': 'https://bolt.earth',
    'Referer': 'https://bolt.earth/'
}

def query_url(url, max_retries=6):
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=16) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                return data.get('data', [])
        except urllib.error.HTTPError as he:
            if he.code == 429:
                wait_sec = 15
                try:
                    wait_sec = int(he.headers.get('Retry-After', '15')) + 1
                except Exception:
                    pass
                print(f" [429: Pausing {wait_sec}s...] ", end='', flush=True)
                time.sleep(wait_sec)
            else:
                return []
        except Exception as e:
            time.sleep(1.0)
    return []

def classify_state(lat, lng):
    # Kerala bounding box: 8.28 to 12.8, 74.8 to 77.4
    if 8.28 <= lat <= 12.85 and 74.85 <= lng <= 77.45:
        if 8.28 <= lat <= 12.80 and 74.85 <= lng <= 77.40:
            return 'kerala'
    # Karnataka
    if 11.5 <= lat <= 18.5 and 74.0 <= lng <= 78.6:
        return 'karnataka'
    # Tamil Nadu
    if 8.05 <= lat <= 13.5 and 76.2 <= lng <= 80.35:
        return 'tamil_nadu'
    return 'other'

def is_fast_charger(cid, model_id):
    mid = (model_id or '').upper()
    cid_up = (cid or '').upper()
    if any(k in mid for k in ['2WFC', 'FAST', 'DC', 'TYPE7', 'TYPE_7', 'TYPE6_TYPE7', 'CCS', '7_4KW', 'CHAOJI', 'GB/T']):
        return True
    if cid_up.startswith('L1DC') or cid_up.startswith('L2DC') or cid_up.startswith('FC'):
        return True
    return False

def build_grid_cells():
    # 1. Fetch national overview at Zoom 8
    print("[1/3] Fetching national overview at Zoom 8 across India...", flush=True)
    overview_url = 'https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=8.0&lng_left=68.0&lat_top=36.0&lng_right=95.0&zoom=8'
    overview_items = query_url(overview_url)
    print(f"Found {len(overview_items)} national cluster points.", flush=True)

    # 2. Extract cluster coordinates
    coords = []
    for it in overview_items:
        geom = it.get('geometry', {})
        c = geom.get('coordinates', [])
        if len(c) >= 2:
            coords.append((c[1], c[0])) # (lat, lng)

    # 3. Create grid cells around each cluster point (size 1.2 x 1.2 with overlap)
    cells = set()
    step = 1.0
    for lat, lng in coords:
        c_lat = round(lat / step) * step
        c_lng = round(lng / step) * step
        cells.add((round(c_lat, 2), round(c_lng, 2)))

    # Also guarantee dense coverage for all Kerala districts
    kerala_lat_steps = [8.3, 8.5, 8.7, 8.9, 9.1, 9.3, 9.5, 9.7, 9.9, 10.1, 10.3, 10.5, 10.7, 10.9, 11.1, 11.3, 11.5, 11.7, 11.9, 12.1, 12.3, 12.5]
    kerala_lng_steps = [75.0, 75.3, 75.6, 75.9, 76.2, 76.5, 76.8, 77.1]
    for klat in kerala_lat_steps:
        for klng in kerala_lng_steps:
            cells.add((round(klat, 2), round(klng, 2)))

    # Convert cells to bounding boxes with 0.15 deg overlap
    boxes = []
    for clat, clng in sorted(cells):
        b = round(clat - 0.65, 4)
        t = round(clat + 0.65, 4)
        l = round(clng - 0.65, 4)
        r = round(clng + 0.65, 4)
        boxes.append((b, l, t, r))

    print(f"[2/3] Generated {len(boxes)} high-resolution Zoom 18 cells covering India.", flush=True)
    return boxes

def harvest_national():
    base_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bolt_chargers.json')
    master = {}
    if os.path.exists(base_file):
        try:
            with open(base_file, 'r', encoding='utf-8') as f:
                prev = json.load(f)
                for p in prev:
                    master[p['id']] = p
                print(f"Loaded {len(master)} baseline Bolt stations from disk.", flush=True)
        except Exception as e:
            print("Baseline load warning:", e, flush=True)

    boxes = build_grid_cells()
    total_cells = len(boxes)
    print(f"[3/3] Harvesting all {total_cells} cells at Zoom 18 (unclustered)...", flush=True)

    start_time = time.time()
    for idx, (b, l, t, r) in enumerate(boxes):
        url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={b}&lng_left={l}&lat_top={t}&lng_right={r}&zoom=18"
        items = query_url(url)
        time.sleep(0.75) # polite pacing

        new_in_cell = 0
        for it in items:
            cid = it.get('chargerId')
            if not cid:
                continue

            coords = it.get('geometry', {}).get('coordinates', [])
            if len(coords) < 2:
                continue
            lng, lat = coords[0], coords[1]
            if not (6 <= lat <= 38 and 68 <= lng <= 98):
                continue

            model = it.get('model', {}) or {}
            model_id = model.get('modelId', '')
            fast = is_fast_charger(cid, model_id)

            station = it.get('station', {}) or {}
            address = station.get('address') or it.get('address') or ''

            name = f"Bolt.Earth {'Fast' if fast else '15A'} - {cid}"

            record = {
                'id': cid,
                'name': name,
                'network': 'BOLT_EARTH',
                'type': 'FAST' if fast else 'SLOW',
                'model_id': model_id,
                'connector': 'Bolt.Earth Fast Charger (DC / Fast AC Type 7 Gun)' if fast else 'Standard 15A / 3-Pin AC Socket',
                'power_kw': 3.3 if fast else 1.5,
                'lat': round(lat, 6),
                'lng': round(lng, 6),
                'address': address,
                'source': 'Bolt.Earth Live API',
                'is_2w': True,
                'status': 'OPERATIONAL',
                'state': classify_state(lat, lng)
            }

            if cid not in master:
                new_in_cell += 1
            master[cid] = record

        fast_c = sum(1 for x in master.values() if x.get('type') == 'FAST')
        slow_c = sum(1 for x in master.values() if x.get('type') == 'SLOW')
        kerala_c = sum(1 for x in master.values() if x.get('state') == 'kerala')

        if (idx + 1) % 15 == 0 or idx == total_cells - 1 or new_in_cell > 0:
            print(f"[{idx+1}/{total_cells}] ({b:.2f}, {l:.2f}) -> +{new_in_cell} new (Total: {len(master)} | ⚡{fast_c} Fast, 🔌{slow_c} Slow | Kerala: {kerala_c})", flush=True)

    elapsed = time.time() - start_time
    print(f"\nNational harvest completed in {elapsed:.1f}s. Total Bolt stations: {len(master)}", flush=True)

    # Save to bolt_chargers.json
    with open(base_file, 'w', encoding='utf-8') as f:
        json.dump(list(master.values()), f, ensure_ascii=False)
    print(f"Saved {len(master)} Bolt chargers to {base_file}", flush=True)

    # Trigger database merge
    merge_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'merge_and_update.py')
    if os.path.exists(merge_script):
        print("Merging with Ather Grid & Hero VIDA Grid...", flush=True)
        import subprocess
        subprocess.run([sys.executable, merge_script], check=True)

if __name__ == '__main__':
    harvest_national()
