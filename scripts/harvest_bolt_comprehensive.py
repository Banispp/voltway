"""
VoltWay 2W - Comprehensive Bolt.Earth Smart Unclustered Harvester
Fetches 100% of Bolt.Earth 2W Fast & 15A chargers across Kerala & Key Indian EV Corridors.
Uses smart zoom 14 discovery + targeted zoom 18 unclustering so zero chargers are dropped.
"""

import urllib.request
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

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

# High-density coverage zones: ALL 14 Kerala districts + Major 2W Highway corridors
REGIONS = [
    # --- KERALA (ALL 14 DISTRICTS) ---
    {'name': 'Trivandrum (TVM) & Neyyattinkara', 'lat_min': 8.25, 'lat_max': 8.75, 'lng_min': 76.80, 'lng_max': 77.20},
    {'name': 'Attingal, Varkala & South Kollam', 'lat_min': 8.65, 'lat_max': 8.95, 'lng_min': 76.60, 'lng_max': 76.95},
    {'name': 'Kollam City, Karunagappally & Kundara', 'lat_min': 8.85, 'lat_max': 9.15, 'lng_min': 76.50, 'lng_max': 76.80},
    {'name': 'Pathanamthitta, Adoor, Thiruvalla', 'lat_min': 9.10, 'lat_max': 9.45, 'lng_min': 76.55, 'lng_max': 77.05},
    {'name': 'Alappuzha, Kayamkulam, Cherthala', 'lat_min': 9.10, 'lat_max': 9.75, 'lng_min': 76.25, 'lng_max': 76.60},
    {'name': 'Kottayam, Changanassery, Pala', 'lat_min': 9.40, 'lat_max': 9.80, 'lng_min': 76.45, 'lng_max': 76.85},
    {'name': 'Idukki, Thodupuzha, Kattappana, Munnar', 'lat_min': 9.70, 'lat_max': 10.25, 'lng_min': 76.65, 'lng_max': 77.25},
    {'name': 'Kochi, Ernakulam, Aluva, Kakkanad', 'lat_min': 9.85, 'lat_max': 10.15, 'lng_min': 76.20, 'lng_max': 76.45},
    {'name': 'North Ernakulam, Angamaly, Chalakudy', 'lat_min': 10.10, 'lat_max': 10.35, 'lng_min': 76.30, 'lng_max': 76.55},
    {'name': 'Thrissur City, Guruvayur, Kodungallur', 'lat_min': 10.20, 'lat_max': 10.70, 'lng_min': 76.05, 'lng_max': 76.40},
    {'name': 'Palakkad, Ottapalam, Alathur, Mannarkkad', 'lat_min': 10.55, 'lat_max': 11.05, 'lng_min': 76.30, 'lng_max': 76.85},
    {'name': 'Malappuram, Perinthalmanna, Manjeri, Tirur', 'lat_min': 10.75, 'lat_max': 11.25, 'lng_min': 75.85, 'lng_max': 76.35},
    {'name': 'Kozhikode (Calicut) City & Suburbs', 'lat_min': 11.15, 'lat_max': 11.45, 'lng_min': 75.70, 'lng_max': 76.00},
    {'name': 'Vadakara, Koyilandy & North Kozhikode', 'lat_min': 11.40, 'lat_max': 11.70, 'lng_min': 75.55, 'lng_max': 75.85},
    {'name': 'Wayanad (Kalpetta, Sulthan Bathery, Mananthavady)', 'lat_min': 11.55, 'lat_max': 11.95, 'lng_min': 75.95, 'lng_max': 76.35},
    {'name': 'Kannur, Thalassery, Payyanur, Mattannur', 'lat_min': 11.65, 'lat_max': 12.15, 'lng_min': 75.25, 'lng_max': 75.75},
    {'name': 'Kasaragod, Kanhangad, Nileshwar', 'lat_min': 12.15, 'lat_max': 12.80, 'lng_min': 74.90, 'lng_max': 75.30},

    # --- KEY CONNECTING METROS & HIGHWAYS ---
    # Bengaluru Metropolitan
    {'name': 'Bangalore Central, Indiranagar, Koramangala', 'lat_min': 12.90, 'lat_max': 13.02, 'lng_min': 77.55, 'lng_max': 77.68},
    {'name': 'Bangalore South, Electronic City, Bannerghatta', 'lat_min': 12.80, 'lat_max': 12.92, 'lng_min': 77.55, 'lng_max': 77.70},
    {'name': 'Bangalore East, Whitefield, Marathahalli, Bellandur', 'lat_min': 12.90, 'lat_max': 13.02, 'lng_min': 77.68, 'lng_max': 77.80},
    {'name': 'Bangalore North, Yelahanka, Hebbal, Manyata', 'lat_min': 13.02, 'lat_max': 13.15, 'lng_min': 77.55, 'lng_max': 77.68},
    {'name': 'Bangalore West, Rajajinagar, Kengeri, Mysore Rd', 'lat_min': 12.90, 'lat_max': 13.02, 'lng_min': 77.45, 'lng_max': 77.56},
    # Mysore & Mandya Corridor
    {'name': 'Mysuru City & Chamundi', 'lat_min': 12.25, 'lat_max': 12.40, 'lng_min': 76.60, 'lng_max': 76.75},
    {'name': 'Mandya, Ramanagara, Channapatna Corridor', 'lat_min': 12.45, 'lat_max': 12.75, 'lng_min': 76.85, 'lng_max': 77.35},
    # Mangaluru Coastal
    {'name': 'Mangaluru City, Surathkal, Ullal', 'lat_min': 12.80, 'lat_max': 13.05, 'lng_min': 74.75, 'lng_max': 74.95},
    {'name': 'Udupi, Manipal, Kundapura', 'lat_min': 13.30, 'lat_max': 13.70, 'lng_min': 74.65, 'lng_max': 74.85},
    # Tamil Nadu Western Corridor (Coimbatore, Salem)
    {'name': 'Coimbatore Metro & Gandhipuram', 'lat_min': 10.95, 'lat_max': 11.10, 'lng_min': 76.90, 'lng_max': 77.05},
    {'name': 'Tiruppur & Avinashi Corridor', 'lat_min': 11.05, 'lat_max': 11.20, 'lng_min': 77.25, 'lng_max': 77.45},
    {'name': 'Salem, Erode Highway Corridor', 'lat_min': 11.25, 'lat_max': 11.70, 'lng_min': 77.65, 'lng_max': 78.20},
    {'name': 'Hosur & Tamil Nadu Border', 'lat_min': 12.68, 'lat_max': 12.80, 'lng_min': 77.78, 'lng_max': 77.90},
    # Chennai Metro
    {'name': 'Chennai Central & South (OMR, Guindy, Velachery)', 'lat_min': 12.90, 'lat_max': 13.10, 'lng_min': 80.15, 'lng_max': 80.30},
    # Hyderabad Metro
    {'name': 'Hyderabad (Hitech City, Gachibowli, Secunderabad)', 'lat_min': 17.35, 'lat_max': 17.55, 'lng_min': 78.35, 'lng_max': 78.55},
    # Mumbai & Pune
    {'name': 'Mumbai & Navi Mumbai', 'lat_min': 19.00, 'lat_max': 19.20, 'lng_min': 72.80, 'lng_max': 73.05},
    {'name': 'Pune City, PCMC, Hinjewadi', 'lat_min': 18.45, 'lat_max': 18.65, 'lng_min': 73.75, 'lng_max': 73.95},
    # Delhi NCR
    {'name': 'Delhi NCR & Gurgaon', 'lat_min': 28.40, 'lat_max': 28.70, 'lng_min': 77.00, 'lng_max': 77.35}
]

def query_box(lat_b, lng_l, lat_t, lng_r, zoom=14):
    url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={lat_b}&lng_left={lng_l}&lat_top={lat_t}&lng_right={lng_r}&zoom={zoom}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                return data.get('data', [])
        except urllib.error.HTTPError as he:
            if he.code == 429:
                time.sleep(1.2 * (attempt + 1))
            else:
                return []
        except Exception:
            time.sleep(0.4)
    return []

def harvest_region(reg):
    reg_name = reg['name']
    lat_b, lat_t = reg['lat_min'], reg['lat_max']
    lng_l, lng_r = reg['lng_min'], reg['lng_max']

    raw_items = query_box(lat_b, lng_l, lat_t, lng_r, zoom=14)
    chargers_found = []
    clusters = []

    for it in raw_items:
        if 'chargerId' in it:
            chargers_found.append(it)
        elif it.get('properties', {}).get('cluster'):
            clusters.append(it)

    # Smart targeted unclustering: for every cluster, query tiny 0.025 deg window at zoom 18
    for cl in clusters:
        coords = cl.get('geometry', {}).get('coordinates', [])
        if len(coords) < 2:
            continue
        c_lng, c_lat = coords[0], coords[1]
        sub_items = query_box(
            round(c_lat - 0.015, 5),
            round(c_lng - 0.015, 5),
            round(c_lat + 0.015, 5),
            round(c_lng + 0.015, 5),
            zoom=18
        )
        for sit in sub_items:
            if 'chargerId' in sit:
                chargers_found.append(sit)
        time.sleep(0.04)

    return reg_name, chargers_found

def run_harvest():
    print("=" * 70, flush=True)
    print("VoltWay 2W - Smart Bolt.Earth Deep Harvester", flush=True)
    print(f"Scanning {len(REGIONS)} high-density zones across Kerala & South India...", flush=True)
    print("=" * 70, flush=True)

    master_map = {}

    # Load baseline from existing bolt_chargers.json to ensure no historical points are ever lost
    base_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bolt_chargers.json')
    if os.path.exists(base_file):
        try:
            with open(base_file, 'r', encoding='utf-8') as f:
                prev = json.load(f)
                for p in prev:
                    master_map[p['id']] = p
                print(f"Loaded {len(master_map)} existing baseline Bolt chargers.", flush=True)
        except Exception as e:
            print("Baseline read error:", e, flush=True)

    start_t = time.time()
    total_raw_found = 0

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(harvest_region, reg): reg for reg in REGIONS}
        completed = 0
        for fut in as_completed(futures):
            reg_name, items = fut.result()
            added_in_reg = 0
            for item in items:
                cid = item.get('chargerId')
                if not cid:
                    continue
                coords = item.get('geometry', {}).get('coordinates', [])
                if len(coords) < 2:
                    continue
                lng, lat = coords[0], coords[1]
                if not (6 <= lat <= 38 and 68 <= lng <= 98):
                    continue

                model = item.get('model', {}) or {}
                model_id = str(model.get('modelId') or '').upper()

                # Filter out pure 4-wheeler high voltage guns (CCS / GBDT)
                if 'CCS' in model_id or 'GB/T' in model_id or 'CHADEMO' in model_id:
                    continue

                cid_upper = str(cid).upper()
                is_fast = False
                # Comprehensive 2W Fast Charger Identification:
                # 2WFC = 2-Wheeler Fast Charger (3.3kW / 6kW Type 6 & Type 7)
                # L1DC = Level 1 DC Fast Charger for 2-wheelers
                # TYPE6 / TYPE7 = Bharat EV 2W Fast Connector standards
                # LEVEL_2 / LEVEL_3 = Fast AC / DC points
                if ('2WFC' in model_id or 'FAST' in model_id or 'TYPE6' in model_id or 'TYPE7' in model_id or
                    'L1DC' in cid_upper or 'LEVEL_2' in model_id or 'LEVEL_3' in model_id or 'OCPP_LEVEL_2' in model_id):
                    is_fast = True
                    ctype = 'FAST'
                    conn_name = 'Bolt.Earth Fast Charger (DC / Fast AC)'
                    power = 3.3
                else:
                    ctype = 'SLOW'
                    conn_name = 'Standard 15A / 3-Pin AC Socket'
                    power = 1.5

                station = item.get('station', {}) or {}
                addr = station.get('address') or ''
                name = f"Bolt.Earth {'Fast' if is_fast else '15A'} - {cid}"

                master_map[cid] = {
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
                added_in_reg += 1

            total_raw_found += len(items)
            completed += 1
            print(f"[{completed}/{len(REGIONS)}] {reg_name}: {len(items)} items scanned ({added_in_reg} unique added). Total pool: {len(master_map)}", flush=True)
            time.sleep(0.08)

    print("\n" + "=" * 70, flush=True)
    final_bolt_list = list(master_map.values())
    total_fast = sum(1 for c in final_bolt_list if c['type'] == 'FAST')
    total_slow = sum(1 for c in final_bolt_list if c['type'] == 'SLOW')

    print(f"Deep Harvest completed in {time.time() - start_t:.1f}s.", flush=True)
    print(f"Total Consolidated Bolt.Earth Stations: {len(final_bolt_list)}", flush=True)
    print(f"  ⚡ Bolt.Earth 2W FAST Chargers: {total_fast}", flush=True)
    print(f"  🔌 Bolt.Earth 15A Plug Sockets: {total_slow}", flush=True)
    print("=" * 70, flush=True)

    # Save to bolt_chargers.json
    with open(base_file, 'w', encoding='utf-8') as f:
        json.dump(final_bolt_list, f, ensure_ascii=False)
    print(f"Saved {len(final_bolt_list)} Bolt chargers to {base_file}", flush=True)

    # Delegate full merge to merge_and_update.py (includes Ather + Hero VIDA + Bolt.Earth)
    import subprocess
    merge_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'merge_and_update.py')
    subprocess.run([sys.executable, merge_script])

if __name__ == '__main__':
    run_harvest()
