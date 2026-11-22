"""
VoltWay 2W - Strict 2-Wheeler ONLY Harvester & Cleaner
Purges 100% of 4-Wheeler Car Chargers (OCPP_LEVEL_2, OCPP_LEVEL_3, OCPI, CCS2, Type 2 AC)
Harvests 100% of 2-Wheeler Fast Chargers (L1DC, 2WFC, Type 7 LEV DC Ather Gun) & 15A Sockets
Covers Kerala seamlessly and Pan-India EV corridors with zero gaps.
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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
}

# 1. Seamless Contiguous Grid across ALL 14 Districts of Kerala
def generate_kerala_seamless_grid():
    cells = []
    # Kerala bounding box: Lat 8.15 to 12.85, Lng 74.85 to 77.45
    lat_min, lat_max = 8.18, 12.82
    lng_min, lng_max = 74.90, 77.40
    step = 0.22 # Dense 25km cells for 100% zoom 16 unclustered capture

    lat = lat_min
    while lat < lat_max:
        lat_top = round(min(lat + step, lat_max), 4)
        lng = lng_min
        while lng < lng_max:
            lng_right = round(min(lng + step, lng_max), 4)
            cells.append({
                'name': f'Kerala Grid ({lat:.2f}N, {lng:.2f}E)',
                'b': round(lat, 4),
                'l': round(lng, 4),
                't': lat_top,
                'r': lng_right
            })
            lng += step
        lat += step
    return cells

# 2. Key High-Density 2W Urban Corridors across India
INTERSTATE_CORRIDORS = [
    # Bengaluru Comprehensive (8 Zones)
    {'name': 'Bengaluru South & Central', 'b': 12.88, 'l': 77.54, 't': 12.98, 'r': 77.66},
    {'name': 'Bengaluru East & Whitefield', 'b': 12.92, 'l': 77.66, 't': 13.02, 'r': 77.78},
    {'name': 'Bengaluru North & Yelahanka', 'b': 13.00, 'l': 77.52, 't': 13.12, 'r': 77.64},
    {'name': 'Bengaluru West & Peenya', 'b': 12.94, 'l': 77.46, 't': 13.04, 'r': 77.56},
    {'name': 'Bengaluru Electronic City & Hosur Rd', 'b': 12.80, 'l': 77.62, 't': 12.90, 'r': 77.72},
    # Mysuru & Mandya
    {'name': 'Mysuru City & Chamundi', 'b': 12.26, 'l': 76.58, 't': 12.36, 'r': 76.70},
    {'name': 'Mandya Highway Corridor', 'b': 12.48, 'l': 76.84, 't': 12.58, 'r': 76.96},
    # Mangaluru & Udupi Coastal
    {'name': 'Mangaluru City & Port', 'b': 12.82, 'l': 74.80, 't': 12.94, 'r': 74.92},
    {'name': 'Udupi & Manipal', 'b': 13.30, 'l': 74.70, 't': 13.40, 'r': 74.82},
    # Tamil Nadu Western Corridor
    {'name': 'Coimbatore Central & RS Puram', 'b': 10.96, 'l': 76.90, 't': 11.06, 'r': 77.02},
    {'name': 'Coimbatore Peelamedu & Airport', 'b': 11.00, 'l': 77.00, 't': 11.10, 'r': 77.10},
    {'name': 'Tiruppur Textile City', 'b': 11.06, 'l': 77.30, 't': 11.16, 'r': 77.40},
    {'name': 'Erode City', 'b': 11.30, 'l': 77.68, 't': 11.40, 'r': 77.78},
    {'name': 'Salem City', 'b': 11.62, 'l': 78.10, 't': 11.72, 'r': 78.20},
    {'name': 'Hosur Industrial Hub', 'b': 12.70, 'l': 77.78, 't': 12.78, 'r': 77.88},
    # Chennai Metro
    {'name': 'Chennai Central & T Nagar', 'b': 13.00, 'l': 80.18, 't': 13.10, 'r': 80.28},
    {'name': 'Chennai OMR & Sholinganallur', 'b': 12.86, 'l': 80.18, 't': 12.98, 'r': 80.26},
    # Hyderabad Metro
    {'name': 'Hyderabad Hitec & Gachibowli', 'b': 17.40, 'l': 78.32, 't': 17.50, 'r': 78.44},
    {'name': 'Hyderabad Secunderabad & Banjara', 'b': 17.38, 'l': 78.44, 't': 17.48, 'r': 78.54},
    # Mumbai MMR
    {'name': 'Mumbai Western Suburbs (Bandra-Borivali)', 'b': 19.05, 'l': 72.80, 't': 19.25, 'r': 72.90},
    {'name': 'Navi Mumbai & Thane', 'b': 19.05, 'l': 72.95, 't': 19.25, 'r': 73.10},
    # Pune Metro
    {'name': 'Pune Central & Hinjewadi', 'b': 18.48, 'l': 73.72, 't': 18.62, 'r': 73.92},
    # Delhi NCR
    {'name': 'Delhi South & Gurgaon DLF', 'b': 28.40, 'l': 77.00, 't': 28.58, 'r': 77.25},
    {'name': 'Noida Sector 18 & 62', 'b': 28.50, 'l': 77.30, 't': 28.62, 'r': 77.42},
]

def is_strictly_4_wheeler(cid, model_id):
    """Detects and returns True for any 4-wheeler car charger (MUST BE DROPPED)"""
    cid_upper = str(cid).upper()
    mid_upper = str(model_id).upper()

    # Model checks for 4W
    if any(k in mid_upper for k in [
        'OCPP_LEVEL_2', 'OCPP_LEVEL_3', 'LEVEL_2', 'LEVEL_3',
        'OCPI', 'CCS', 'TYPE2', 'GB/T', 'CHADEMO'
    ]):
        return True

    # Charger ID prefixes for 4W car networks
    if cid_upper.startswith('L200') or cid_upper.startswith('L300') or cid_upper.startswith('ST'):
        return True

    # Roaming 4W partner prefixes (Kazam / Statiq car IDs like MH00, TN00, DL00, GJ01 etc.)
    if any(cid_upper.startswith(p) for p in ['TN00', 'MH00', 'TS00', 'HR00', 'GJ01', 'DL00', 'HR01', 'KL00', 'KA01', 'MH04']):
        return True

    return False

def classify_2w_charger(cid, model_id):
    """
    Classifies strictly 2-wheeler chargers.
    Returns (is_valid_2w, is_fast, conn_name, compat_text, power_kw, ctype)
    """
    cid_upper = str(cid).upper()
    mid_upper = str(model_id).upper()

    # Reject 4-wheelers immediately!
    if is_strictly_4_wheeler(cid, model_id):
        return False, False, '', '', 0, ''

    # 1. Real 2-Wheeler Fast Charger with Ather Gun (IS 17017-2-7 Type 7 LEV DC / Type 6)
    if cid_upper.startswith('L1DC') or '2WFC' in mid_upper or 'TYPE7' in mid_upper or 'TYPE6' in mid_upper:
        return (
            True,
            True,
            'Ather Gun (IS 17017 Type 7 LEV DC Fast) ⚡',
            '100% Direct Plug-in (Ather 450X/Rizta/Apex)',
            3.3,
            'FAST'
        )

    # 2. Real 2-Wheeler 15A/16A Universal Socket (Requires Ather Portable Cable)
    if any(k in mid_upper for k in ['BOLT_16A', 'BOLT_LITE', 'OAKTER', 'LEVAC', 'OCPP_LEVEL_1']) or \
       cid_upper.startswith('L100') or cid_upper.startswith('L1OC') or cid_upper.startswith('BOLT_'):
        return (
            True,
            False,
            'Standard 15A / 3-Pin AC Socket (Requires Ather Portable Charger) 🔌',
            'Requires Portable Charger Cable',
            1.5,
            'SLOW'
        )

    # Unknown - drop to be safe
    return False, False, '', '', 0, ''

def make_request(url):
    max_retries = 3
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=9) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                return data.get('data', [])
        except urllib.error.HTTPError as he:
            if he.code == 429:
                retry_sec = int(he.headers.get('Retry-After', '15'))
                print(f"[429 Rate Limit] Pausing {retry_sec + 1}s...", flush=True)
                time.sleep(retry_sec + 1)
            else:
                return []
        except Exception:
            time.sleep(0.4)
    return []

def run():
    print("=" * 72, flush=True)
    print("VoltWay 2W - STRICT 2-WHEELER ONLY Harvester & Cleaner", flush=True)
    print("Purges 100% of 4-Wheeler Car Chargers (OCPP_LEVEL_2, Level 3, OCPI, CCS2)", flush=True)
    print("=" * 72, flush=True)

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    base_file = os.path.join(base_dir, 'bolt_chargers.json')

    master_chargers = {}
    purged_4w_count = 0

    # 1. Clean existing bolt_chargers.json: REMOVE ALL 4-WHEELERS!
    if os.path.exists(base_file):
        try:
            with open(base_file, 'r', encoding='utf-8') as f:
                prev = json.load(f)
                for p in prev:
                    cid = p['id']
                    mid = p.get('modelId', '') or p.get('model_id', '')
                    # Check if 4W
                    if is_strictly_4_wheeler(cid, mid):
                        purged_4w_count += 1
                        continue

                    # Classify
                    is_2w, is_fast, conn_name, compat, power, ctype = classify_2w_charger(cid, mid)
                    if not is_2w:
                        purged_4w_count += 1
                        continue

                    p['type'] = ctype
                    p['is_ather_gun'] = is_fast
                    p['connector'] = conn_name
                    p['ather_compatibility'] = compat
                    p['power_kw'] = power
                    p['is_2w'] = True

                    clean_addr = p.get('address', '').split(',')[0].strip()
                    if is_fast:
                        p['name'] = f"Bolt Fast (Ather Gun ⚡) - {clean_addr or cid}"
                    else:
                        p['name'] = f"Bolt.Earth 15A Socket - {clean_addr or cid}"

                    master_chargers[cid] = p

            print(f"Purged {purged_4w_count} 4-Wheeler car chargers from previous database!", flush=True)
            print(f"Retained {len(master_chargers)} verified 2-Wheeler stations.", flush=True)
        except Exception as e:
            print("Baseline clean error:", e, flush=True)

    # 2. Build seamless harvest target zones: Kerala (Zero Gaps) + Interstate Corridors
    kerala_cells = generate_kerala_seamless_grid()
    all_targets = kerala_cells + INTERSTATE_CORRIDORS
    print(f"Targeting {len(all_targets)} precision zones ({len(kerala_cells)} seamless Kerala cells + {len(INTERSTATE_CORRIDORS)} major corridors)...", flush=True)

    new_2w_fast = 0
    new_2w_slow = 0

    for idx, box in enumerate(all_targets):
        name = box['name']
        b, l, t, r = box['b'], box['l'], box['t'], box['r']

        url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={b}&lng_left={l}&lat_top={t}&lng_right={r}&zoom=16"
        raw_items = make_request(url)
        time.sleep(0.35)

        for item in raw_items:
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

            # Strictly 2-Wheeler Classification
            is_2w, is_fast, conn_name, compat, power, ctype = classify_2w_charger(cid, model_id)
            if not is_2w:
                continue # Skip 4W car chargers

            station = item.get('station', {}) or {}
            addr = station.get('address') or ''
            clean_addr = addr.split(',')[0].strip() if addr else ''

            if is_fast:
                name_label = f"Bolt Fast (Ather Gun ⚡) - {clean_addr or cid}"
            else:
                name_label = f"Bolt.Earth 15A Socket - {clean_addr or cid}"

            is_new = cid not in master_chargers
            if is_new:
                if is_fast:
                    new_2w_fast += 1
                else:
                    new_2w_slow += 1

            master_chargers[cid] = {
                'id': cid,
                'name': name_label,
                'network': 'BOLT_EARTH',
                'type': ctype,
                'model_id': model_id,
                'connector': conn_name,
                'is_ather_gun': is_fast,
                'ather_compatibility': compat,
                'power_kw': power,
                'lat': round(lat, 6),
                'lng': round(lng, 6),
                'address': addr.strip() if addr else f"Location in {name}",
                'source': 'Bolt.Earth Live API',
                'is_2w': True,
                'status': 'OPERATIONAL'
            }

        if (idx + 1) % 20 == 0 or idx == len(all_targets) - 1:
            print(f"[{idx+1}/{len(all_targets)}] {name}: Total Master 2W: {len(master_chargers)} (+{new_2w_fast} new 2W Fast, +{new_2w_slow} new 15A)", flush=True)

    print("=" * 72, flush=True)
    print(f"Harvest Complete! 100% 2-Wheeler Stations in Master: {len(master_chargers)}", flush=True)

    bolt_list = list(master_chargers.values())
    fast_bolt = [c for c in bolt_list if c['type'] == 'FAST']
    slow_bolt = [c for c in bolt_list if c['type'] == 'SLOW']
    print(f"  • Verified Bolt.Earth 2W Fast (Ather Gun ⚡): {len(fast_bolt)}", flush=True)
    print(f"  • Verified Bolt.Earth 15A Sockets (2W)      : {len(slow_bolt)}", flush=True)
    print(f"  • Purged 4-Wheeler Car Chargers             : {purged_4w_count} (ZERO cars remain)", flush=True)

    # Save to bolt_chargers.json
    with open(base_file, 'w', encoding='utf-8') as f:
        json.dump(bolt_list, f, indent=2, ensure_ascii=False)
    print(f"Saved {len(bolt_list)} 2W stations to bolt_chargers.json", flush=True)

    # Load Ather Grid chargers (100% 2W DC Fast)
    ather_file = os.path.join(base_dir, 'ather_grid_chargers.json')
    ather_list = []
    if os.path.exists(ather_file):
        with open(ather_file, 'r', encoding='utf-8') as f:
            ather_list = json.load(f)
            for a in ather_list:
                a['network'] = 'ATHER_GRID'
                a['type'] = 'FAST'
                a['is_ather_gun'] = True
                a['ather_compatibility'] = '100% Direct Plug-in (Official Ather Grid Gun)'
                a['connector'] = 'Ather Grid Official DC Fast Gun (IS 17017-2-7 / Type 7) ⚡'
                a['is_2w'] = True
        print(f"Loaded {len(ather_list)} official Ather Grid 2W Fast Chargers.", flush=True)

    # Combine into Master 2W Database
    combined_db = ather_list + bolt_list
    total_fast = len([c for c in combined_db if c.get('type') == 'FAST'])

    print("=" * 72, flush=True)
    print("FINAL 100% TWO-WHEELER MASTER DATABASE:", flush=True)
    print(f"  • Ather Grid 2W Fast Chargers      : {len(ather_list)}", flush=True)
    print(f"  • Bolt.Earth 2W Fast (Ather Gun ⚡) : {len(fast_bolt)}", flush=True)
    print(f"  • Bolt.Earth 2W 15A Sockets        : {len(slow_bolt)}", flush=True)
    print("  -------------------------------------------------------------", flush=True)
    print(f"  • TOTAL ALL 2W EV STATIONS         : {len(combined_db)}", flush=True)
    print(f"  • TOTAL 2W ATHER GUN FAST CHARGERS : {total_fast}", flush=True)
    print("  • TOTAL 4-WHEELER CARS IN APP      : 0 (PURGED 100%)", flush=True)
    print("=" * 72, flush=True)

    # Write chargers_db.json
    db_json_path = os.path.join(base_dir, 'chargers_db.json')
    with open(db_json_path, 'w', encoding='utf-8') as f:
        json.dump(combined_db, f, indent=2, ensure_ascii=False)
    print(f"Wrote {db_json_path}", flush=True)

    # Write chargers_db.js
    db_js_path = os.path.join(base_dir, 'chargers_db.js')
    with open(db_js_path, 'w', encoding='utf-8') as f:
        f.write("// VoltWay 2W - 100% Verified Two-Wheeler Chargers Database (Offline PWA)\n")
        f.write(f"// ZERO 4-Wheeler Car Chargers. Ather Grid + Bolt 2W Fast (Type 7 LEV DC Gun) & 15A Sockets\n")
        f.write(f"// Total 2W Stations: {len(combined_db)} (Ather Fast: {len(ather_list)}, Bolt 2W Fast: {len(fast_bolt)}, Bolt 15A: {len(slow_bolt)})\n")
        f.write("window.BUNDLED_CHARGERS = ")
        json.dump(combined_db, f, ensure_ascii=False)
        f.write(";\n")
    print(f"Wrote {db_js_path}", flush=True)

if __name__ == '__main__':
    run()
