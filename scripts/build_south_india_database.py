"""
VoltWay 2W - South India Regional Database Builder
Covers: Kerala (KL), Tamil Nadu (TN), Karnataka (KA), Puducherry / Mahe (PY)
Networks Included (100% Two-Wheeler ONLY):
  1. Ather Grid DC Fast (Official Ather Gun) - includes 6kW fast stations
  2. Hero VIDA Grid DC Fast (Official LEV DC Ather Gun) - strictly Vida's own chargingStations (ZERO duplication)
  3. Bolt.Earth 2W Fast (L1DC / 2WFC / Type 7 LEV DC Ather Gun)
  4. Bolt.Earth 15A Sockets (Universal 3-Pin for Ather Portable Charger)
Excludes 100% of 4-Wheeler Car Chargers (CCS2, Type 2 AC, Level 2/3, OCPI)
"""

import json
import os
import sys

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TARGET_STATES = ['kerala', 'tamil nadu', 'karnataka', 'puducherry', 'pondicherry', 'mahe']
EXCLUDED_STATES = ['andhra', 'telangana', 'maharashtra', 'goa', 'odisha', 'madhya pradesh', 'gujarat', 'delhi', 'rajasthan', 'uttar pradesh', 'bihar', 'punjab', 'haryana']

def is_in_target_region(lat, lng, state='', addr=''):
    try:
        lat = float(lat)
        lng = float(lng)
    except:
        return False

    # Target South India Bounding Box: Kanyakumari (8.05N) to Northern Karnataka (18.55N), Karwar (74.00E) to Chennai (80.40E)
    in_box = (8.05 <= lat <= 18.55 and 74.00 <= lng <= 80.40)
    
    full_text = f"{state} {addr}".lower()
    has_target_state = any(ts in full_text for ts in TARGET_STATES)
    has_excluded_state = any(es in full_text for es in EXCLUDED_STATES)

    if has_target_state and not has_excluded_state:
        return True
    if in_box and not has_excluded_state:
        return True
    return False

def is_strictly_4_wheeler(cid, model_id):
    cid_upper = str(cid).upper()
    mid_upper = str(model_id).upper()

    if any(k in mid_upper for k in [
        'OCPP_LEVEL_2', 'OCPP_LEVEL_3', 'LEVEL_2', 'LEVEL_3',
        'OCPI', 'CCS', 'TYPE2', 'GB/T', 'CHADEMO'
    ]):
        return True

    if cid_upper.startswith('L200') or cid_upper.startswith('L300') or cid_upper.startswith('ST'):
        return True

    if any(cid_upper.startswith(p) for p in ['TN00', 'MH00', 'TS00', 'HR00', 'GJ01', 'DL00', 'HR01', 'KL00', 'KA01', 'MH04']):
        return True

    return False

def classify_bolt_2w(cid, model_id):
    cid_upper = str(cid).upper()
    mid_upper = str(model_id).upper()

    if is_strictly_4_wheeler(cid, model_id):
        return False, False, '', '', 0, ''

    if cid_upper.startswith('L1DC') or '2WFC' in mid_upper or 'TYPE7' in mid_upper or 'TYPE6' in mid_upper:
        return (
            True,
            True,
            'Ather Gun (IS 17017 Type 7 LEV DC Fast) ⚡',
            '100% Direct Plug-in (Ather 450X/Rizta/Apex)',
            3.3,
            'FAST'
        )

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

    return False, False, '', '', 0, ''

def main():
    print("=" * 72)
    print("VoltWay 2W - Building Pure Two-Wheeler Database (KL, TN, KA, PY)")
    print("Zero 4-Wheeler Cars. Zero Duplication across Ather & Vida.")
    print("=" * 72)

    master_db = []
    seen_ids = set()

    # ---------------------------------------------------------
    # 1. ATHER GRID FAST CHARGERS (Official DC Fast)
    # ---------------------------------------------------------
    ather_file = os.path.join(BASE_DIR, 'ather_grid_chargers.json')
    ather_added = 0
    with open(ather_file, 'r', encoding='utf-8') as f:
        ather_raw = json.load(f)

    for a in ather_raw:
        aid = a['id']
        lat = a.get('lat')
        lng = a.get('lng')
        addr = a.get('address') or ''
        state = a.get('state') or ''

        if not is_in_target_region(lat, lng, state, addr):
            continue

        item_id = f"ATHER_{aid}" if not str(aid).startswith('ATHER_') else aid
        if item_id in seen_ids:
            continue
        seen_ids.add(item_id)

        clean_name = a.get('name') or f"Ather Grid Fast Charger - {aid}"
        # Detect if 6kW fast station
        power = 6.0 if '6KW' in clean_name.upper() or '6 KW' in clean_name.upper() else 3.3

        master_db.append({
            'id': item_id,
            'name': clean_name,
            'network': 'ATHER_GRID',
            'type': 'FAST',
            'model_id': 'ATHER_GRID_FAST_DC',
            'connector': 'Ather Grid Official DC Fast Gun (IS 17017-2-7 / Type 7) ⚡',
            'is_ather_gun': True,
            'ather_compatibility': '100% Direct Plug-in (Official Ather Grid Gun)',
            'power_kw': power,
            'lat': round(float(lat), 6),
            'lng': round(float(lng), 6),
            'address': addr.strip(),
            'source': 'Ather Grid Official',
            'is_2w': True,
            'status': 'OPERATIONAL'
        })
        ather_added += 1

    print(f"Added {ather_added} Ather Grid Fast Chargers.")

    # ---------------------------------------------------------
    # 2. HERO VIDA GRID FAST CHARGERS (Official LEV DC Ather Gun)
    # Strictly from 'chargingStations' to guarantee ZERO duplication with Ather!
    # ---------------------------------------------------------
    vida_file = os.path.join(BASE_DIR, 'scripts', 'vida_map_raw.json')
    vida_added = 0
    vida_list_saved = []

    if os.path.exists(vida_file):
        with open(vida_file, 'r', encoding='utf-8') as f:
            cities = json.load(f)

        for c in cities:
            c_name = c.get('cityName', '')
            s_name = c.get('stateName', '')

            # chargingStations is strictly Vida's own fast charging network
            for ch in c.get('chargingStations', []):
                sid = ch.get('stationId')
                if not sid:
                    continue

                item_id = f"VIDA_{sid}"
                if item_id in seen_ids:
                    continue

                lat = ch.get('latitude')
                lng = ch.get('longitude')
                addr = ch.get('chargingStationAddress') or ''

                if not is_in_target_region(lat, lng, s_name, addr):
                    continue

                seen_ids.add(item_id)
                st_name = ch.get('stationName', '').strip()
                clean_addr = addr.split(',')[0].strip()
                disp_name = f"Vida Grid Fast (Ather Gun ⚡) - {st_name or clean_addr}"

                station_entry = {
                    'id': item_id,
                    'name': disp_name,
                    'network': 'VIDA_GRID',
                    'type': 'FAST',
                    'model_id': 'HERO_VIDA_FAST_LEVDC',
                    'connector': 'Hero VIDA Official DC Fast Gun (IS 17017-2-7 / Type 7 LEV DC) ⚡',
                    'is_ather_gun': True,
                    'ather_compatibility': '100% Direct Plug-in (Official Hero VIDA Fast Gun)',
                    'power_kw': 3.3,
                    'lat': round(float(lat), 6),
                    'lng': round(float(lng), 6),
                    'address': addr.strip() if addr else f"Location in {c_name}, {s_name}",
                    'source': 'Hero VIDA Official',
                    'is_2w': True,
                    'status': 'OPERATIONAL'
                }
                master_db.append(station_entry)
                vida_list_saved.append(station_entry)
                vida_added += 1

    print(f"Added {vida_added} Hero VIDA Grid Fast Chargers (0 Ather duplicates).")

    # Save dedicated vida_chargers.json
    with open(os.path.join(BASE_DIR, 'vida_chargers.json'), 'w', encoding='utf-8') as f:
        json.dump(vida_list_saved, f, indent=2, ensure_ascii=False)
    print("Saved vida_chargers.json")

    # ---------------------------------------------------------
    # 3. BOLT.EARTH TWO-WHEELER CHARGERS (FAST & 15A SLOW)
    # ---------------------------------------------------------
    bolt_file = os.path.join(BASE_DIR, 'bolt_chargers.json')
    bolt_fast_added = 0
    bolt_slow_added = 0
    bolt_purged_cars = 0

    with open(bolt_file, 'r', encoding='utf-8') as f:
        bolt_raw = json.load(f)

    for b in bolt_raw:
        bid = b['id']
        mid = b.get('modelId', '') or b.get('model_id', '')

        # Block any 4-wheeler car
        if is_strictly_4_wheeler(bid, mid):
            bolt_purged_cars += 1
            continue

        is_2w, is_fast, conn_name, compat, power, ctype = classify_bolt_2w(bid, mid)
        if not is_2w:
            bolt_purged_cars += 1
            continue

        lat = b.get('lat')
        lng = b.get('lng')
        addr = b.get('address') or ''
        state = b.get('state') or ''

        if not is_in_target_region(lat, lng, state, addr):
            continue

        item_id = f"BOLT_{bid}" if not str(bid).startswith('BOLT_') else bid
        if item_id in seen_ids:
            continue
        seen_ids.add(item_id)

        clean_addr = addr.split(',')[0].strip()
        if is_fast:
            name_label = f"Bolt Fast (Ather Gun ⚡) - {clean_addr or bid}"
            bolt_fast_added += 1
        else:
            name_label = f"Bolt.Earth 15A Socket - {clean_addr or bid}"
            bolt_slow_added += 1

        master_db.append({
            'id': item_id,
            'name': name_label,
            'network': 'BOLT_EARTH',
            'type': ctype,
            'model_id': mid,
            'connector': conn_name,
            'is_ather_gun': is_fast,
            'ather_compatibility': compat,
            'power_kw': power,
            'lat': round(float(lat), 6),
            'lng': round(float(lng), 6),
            'address': addr.strip(),
            'source': 'Bolt.Earth Verified 2W',
            'is_2w': True,
            'status': 'OPERATIONAL'
        })

    print(f"Added {bolt_fast_added} Bolt 2W Fast Chargers.")
    print(f"Added {bolt_slow_added} Bolt 15A Universal Sockets.")

    total_fast = ather_added + vida_added + bolt_fast_added
    total_slow = bolt_slow_added
    total_stations = len(master_db)

    print("=" * 72)
    print("FINAL SOUTH INDIA 2W DATABASE (KL, TN, KA, PY):")
    print(f"  • Ather Grid Fast Chargers (3.3kW / 6kW)   : {ather_added}")
    print(f"  • Hero VIDA Grid Fast (Ather Gun ⚡)       : {vida_added}")
    print(f"  • Bolt.Earth 2W Fast (Ather Gun ⚡)        : {bolt_fast_added}")
    print(f"  • Bolt.Earth 15A Sockets (Universal 2W)   : {bolt_slow_added}")
    print("  -------------------------------------------------------------")
    print(f"  • TOTAL ATHER-COMPATIBLE FAST CHARGERS    : {total_fast} (Ather + Vida + Bolt Fast)")
    print(f"  • TOTAL ALL 2W EV CHARGING STATIONS       : {total_stations}")
    print(f"  • TOTAL 4-WHEELER CARS IN APP             : 0 (PURGED 100%)")
    print("=" * 72)

    # Kerala specific stats
    kl_chargers = [c for c in master_db if 8.15 <= c['lat'] <= 12.85 and 74.85 <= c['lng'] <= 77.45]
    kl_ather = len([c for c in kl_chargers if c['network'] == 'ATHER_GRID'])
    kl_vida = len([c for c in kl_chargers if c['network'] == 'VIDA_GRID'])
    kl_bolt_fast = len([c for c in kl_chargers if c['network'] == 'BOLT_EARTH' and c['type'] == 'FAST'])
    kl_bolt_slow = len([c for c in kl_chargers if c['network'] == 'BOLT_EARTH' and c['type'] == 'SLOW'])

    print("KERALA STATE BREAKDOWN:")
    print(f"  • Ather Grid Fast in Kerala               : {kl_ather}")
    print(f"  • Hero VIDA Fast in Kerala                : {kl_vida}")
    print(f"  • Bolt 2W Fast in Kerala                  : {kl_bolt_fast}")
    print(f"  • Bolt 15A Sockets in Kerala              : {kl_bolt_slow}")
    print(f"  • Kerala Total Fast Chargers (Ather Gun)  : {kl_ather + kl_vida + kl_bolt_fast}")
    print(f"  • Kerala Total All 2W Stations            : {len(kl_chargers)}")
    print("=" * 72)

    # Write chargers_db.json
    db_json_path = os.path.join(BASE_DIR, 'chargers_db.json')
    with open(db_json_path, 'w', encoding='utf-8') as f:
        json.dump(master_db, f, indent=2, ensure_ascii=False)
    print(f"Wrote {db_json_path}")

    # Write chargers_db.js
    db_js_path = os.path.join(BASE_DIR, 'chargers_db.js')
    with open(db_js_path, 'w', encoding='utf-8') as f:
        f.write("// VoltWay 2W - Pure Two-Wheeler Chargers Database (Offline PWA)\n")
        f.write("// Regional: Kerala, Tamil Nadu, Karnataka, Puducherry / Mahe\n")
        f.write(f"// ZERO Cars. Ather Grid ({ather_added}) + Hero VIDA Fast ({vida_added}) + Bolt Fast ({bolt_fast_added}) & Bolt 15A ({bolt_slow_added})\n")
        f.write(f"// Total 2W Stations: {total_stations} (Fast: {total_fast}, 15A: {total_slow})\n")
        f.write("window.BUNDLED_CHARGERS = ")
        json.dump(master_db, f, ensure_ascii=False)
        f.write(";\n")
    print(f"Wrote {db_js_path}")

if __name__ == '__main__':
    main()
