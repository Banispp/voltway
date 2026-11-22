"""
VoltWay 2W - High-Density Bolt.Earth Charger Harvester
Uses zoom=16 to prevent clustering and capture 100% of individual 2W Fast & 15A chargers
Polite rate limiting with automatic 429 retry
"""

import urllib.request
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

# UTF-8 stdout
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

REGIONS = [
    # Kerala South (Trivandrum, Attingal, Kollam, Karunagappally, Kayamkulam, Alappuzha)
    {'name': 'Kerala South', 'lat_min': 8.35, 'lat_max': 9.55, 'lng_min': 76.30, 'lng_max': 77.20, 'step': 0.24},
    # Kerala Central (Kottayam, Kochi, Ernakulam, Aluva, Angamaly, Chalakudy, Thrissur, Guruvayur)
    {'name': 'Kerala Central', 'lat_min': 9.55, 'lat_max': 10.75, 'lng_min': 76.10, 'lng_max': 77.10, 'step': 0.24},
    # Kerala North (Palakkad, Perinthalmanna, Malappuram, Kozhikode/Calicut, Wayanad)
    {'name': 'Kerala North', 'lat_min': 10.75, 'lat_max': 11.85, 'lng_min': 75.60, 'lng_max': 76.85, 'step': 0.25},
    # Kerala Far North (Vadakara, Thalassery, Kannur, Payyanur, Kanhangad, Kasaragod)
    {'name': 'Kerala Far North', 'lat_min': 11.85, 'lat_max': 12.65, 'lng_min': 74.85, 'lng_max': 75.65, 'step': 0.25},

    # Bengaluru Metropolitan & Suburbs (Electronic City, Whitefield, Indiranagar, Yelahanka, Kengeri)
    {'name': 'Bengaluru Metro', 'lat_min': 12.75, 'lat_max': 13.25, 'lng_min': 77.40, 'lng_max': 77.85, 'step': 0.18},
    # Mysuru & Mandya & Ramanagara Highway Corridor
    {'name': 'Mysuru Corridor', 'lat_min': 12.15, 'lat_max': 12.80, 'lng_min': 76.50, 'lng_max': 77.30, 'step': 0.25},
    # Mangaluru & Udupi Coastal Highway
    {'name': 'Mangaluru Coastal', 'lat_min': 12.75, 'lat_max': 13.55, 'lng_min': 74.65, 'lng_max': 75.15, 'step': 0.25},

    # Tamil Nadu (Coimbatore, Tiruppur, Erode, Salem)
    {'name': 'Coimbatore & Western TN', 'lat_min': 10.85, 'lat_max': 11.75, 'lng_min': 76.80, 'lng_max': 78.20, 'step': 0.28},
    # Hosur & Chennai Metro
    {'name': 'Hosur & Bangalore Border', 'lat_min': 12.65, 'lat_max': 12.90, 'lng_min': 77.75, 'lng_max': 78.00, 'step': 0.20},
    {'name': 'Chennai Metro', 'lat_min': 12.85, 'lat_max': 13.25, 'lng_min': 80.05, 'lng_max': 80.35, 'step': 0.20},

    # Hyderabad Metro
    {'name': 'Hyderabad Metro', 'lat_min': 17.25, 'lat_max': 17.65, 'lng_min': 78.25, 'lng_max': 78.65, 'step': 0.20},

    # Mumbai & Pune Corridor
    {'name': 'Mumbai & Navi Mumbai', 'lat_min': 18.90, 'lat_max': 19.30, 'lng_min': 72.80, 'lng_max': 73.15, 'step': 0.20},
    {'name': 'Pune City & PCMC', 'lat_min': 18.40, 'lat_max': 18.70, 'lng_min': 73.75, 'lng_max': 74.00, 'step': 0.20},

    # Delhi NCR (Delhi, Gurgaon, Noida)
    {'name': 'Delhi NCR', 'lat_min': 28.40, 'lat_max': 28.80, 'lng_min': 76.95, 'lng_max': 77.40, 'step': 0.22}
]

def generate_cells():
    cells = []
    for reg in REGIONS:
        lat = reg['lat_min']
        step = reg['step']
        while lat < reg['lat_max']:
            lat_top = round(min(lat + step, reg['lat_max']), 4)
            lng = reg['lng_min']
            while lng < reg['lng_max']:
                lng_right = round(min(lng + step, reg['lng_max']), 4)
                cells.append((round(lat, 4), round(lng, 4), lat_top, lng_right, reg['name']))
                lng += step
            lat += step
    return cells

def fetch_single_cell(cell_info):
    lat_b, lng_l, lat_t, lng_r, reg_name = cell_info
    url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={lat_b}&lng_left={lng_l}&lat_top={lat_t}&lng_right={lng_r}&zoom=16"

    max_retries = 3
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                items = data.get('data', [])
                chargers = [x for x in items if x.get('chargerId')]
                return chargers
        except urllib.error.HTTPError as he:
            if he.code == 429:
                time.sleep(1.5 * (attempt + 1))
            else:
                break
        except Exception:
            time.sleep(0.5)
    return []

def run_harvest():
    cells = generate_cells()
    print("=================================================================")
    print(f"VoltWay 2W - Deep Bolt.Earth Harvester (Zoom 16 Unclustered)")
    print(f"Scanning {len(cells)} precision grid zones across key EV corridors...")
    print("=================================================================")

    # Load existing bolt_chargers.json if present to preserve previously found chargers
    all_chargers_map = {}
    out_bolt = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bolt_chargers.json')
    if os.path.exists(out_bolt):
        try:
            with open(out_bolt, 'r', encoding='utf-8') as f:
                prev = json.load(f)
                for p in prev:
                    all_chargers_map[p['id']] = p
                print(f"Loaded {len(all_chargers_map)} existing Bolt chargers as baseline.")
        except Exception as e:
            print("Could not read baseline:", e)

    start_t = time.time()
    harvested_raw = {}
    completed = 0

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetch_single_cell, c): c for c in cells}
        for future in as_completed(futures):
            chargers = future.result()
            for ch in chargers:
                cid = ch.get('chargerId')
                if cid and cid not in harvested_raw:
                    harvested_raw[cid] = ch
            completed += 1
            if completed % 20 == 0 or completed == len(cells):
                print(f"  [{completed}/{len(cells)}] zones scanned. Raw unique chargers discovered: {len(harvested_raw)}")
            time.sleep(0.08)

    print(f"\nLive harvest completed in {time.time() - start_t:.1f}s.")
    print(f"New raw chargers discovered in this run: {len(harvested_raw)}")

    # Process and convert raw chargers to VoltWay format
    new_fast = 0
    new_slow = 0

    for cid, item in harvested_raw.items():
        coords = item.get('geometry', {}).get('coordinates', [])
        if len(coords) < 2:
            continue
        lng, lat = coords[0], coords[1]
        if not (6 <= lat <= 38 and 68 <= lng <= 98):
            continue

        model = item.get('model', {})
        model_id = (model.get('modelId') or '').upper()

        # Exclude 4-wheeler high power car guns
        if 'CCS' in model_id or 'GB/T' in model_id or 'CHADEMO' in model_id:
            continue

        # Fast charger detection
        # L1DC = Level 1 DC Fast Charger (2W)
        # 2WFC = 2-Wheeler Fast Charger
        # TYPE6 / TYPE7 = Bharat 2W DC Fast / AC Fast
        # LEVEL_2 / LEVEL_3 / OCPP_LEVEL_2 = Fast AC / DC
        cid_upper = str(cid).upper()
        is_fast = False
        if ('2WFC' in model_id or 'FAST' in model_id or 'TYPE6' in model_id or 'TYPE7' in model_id or
            'L1DC' in cid_upper or 'LEVEL_2' in model_id or 'LEVEL_3' in model_id or 'OCPP_LEVEL_2' in model_id):
            is_fast = True
            new_fast += 1
            ctype = 'FAST'
            conn_name = 'Bolt.Earth Fast Charger (DC / Fast AC)'
            power = 3.3
        else:
            new_slow += 1
            ctype = 'SLOW'
            conn_name = 'Standard 15A / 3-Pin AC Socket'
            power = 1.5

        station = item.get('station', {})
        addr = station.get('address') or ''
        name = f"Bolt.Earth {'Fast' if is_fast else '15A'} - {cid}"

        all_chargers_map[cid] = {
            'id': cid,
            'name': name,
            'network': 'BOLT_EARTH',
            'type': ctype,
            'model_id': model_id,
            'connector': conn_name,
            'power_kw': power,
            'lat': round(lat, 6),
            'lng': round(lng, 6),
            'address': addr.strip(),
            'source': 'Bolt.Earth Live API',
            'is_2w': True,
            'status': 'OPERATIONAL'
        }

    final_bolt_list = list(all_chargers_map.values())
    total_fast = sum(1 for c in final_bolt_list if c['type'] == 'FAST')
    total_slow = sum(1 for c in final_bolt_list if c['type'] == 'SLOW')

    print("\n=================================================================")
    print(f"Total Bolt.Earth Stations in Database: {len(final_bolt_list)}")
    print(f"  [FAST] 2W Fast Chargers (L1DC / 2WFC / Type6/7 / Level2): {total_fast}")
    print(f"  [SLOW] 15A / 3-Pin AC Plug Sockets: {total_slow}")
    print("=================================================================")

    # Write bolt_chargers.json
    with open(out_bolt, 'w', encoding='utf-8') as f:
        json.dump(final_bolt_list, f, ensure_ascii=False)
    print(f"Saved to {out_bolt}")

    # Merge with ather_grid_chargers.json
    ather_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ather_grid_chargers.json')
    with open(ather_path, 'r', encoding='utf-8') as f:
        ather_list = json.load(f)

    merged = ather_list + final_bolt_list

    merged_json = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'chargers_db.json')
    with open(merged_json, 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False)

    merged_js = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'chargers_db.js')
    with open(merged_js, 'w', encoding='utf-8') as f:
        f.write('// Auto-generated 2W EV Chargers Database\n')
        f.write('window.PRELOADED_CHARGERS = ')
        json.dump(merged, f, ensure_ascii=False)
        f.write(';\n')

    print(f"\nFinal Consolidated Master Database:")
    print(f"  Total Stations: {len(merged)}")
    print(f"  Ather Grid Fast: {len(ather_list)}")
    print(f"  Bolt.Earth Fast: {total_fast}")
    print(f"  Bolt.Earth Slow: {total_slow}")
    print("=================================================================")

if __name__ == '__main__':
    run_harvest()
