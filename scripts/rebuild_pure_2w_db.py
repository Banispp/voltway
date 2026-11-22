"""
VoltWay 2W - Pure Two-Wheeler Database Builder & 4W Purger
- Completely eliminates 100% of 4-Wheeler Car Chargers (OCPP_LEVEL_2, Level 3, OCPI, CCS2, Type 2 AC)
- Retains ONLY authentic 2-Wheeler Chargers:
  1. Ather Grid DC Fast Chargers (Official Ather Gun)
  2. Bolt.Earth 2W Fast Chargers (Level 1 DC / Type 7 LEV DC Ather Gun)
  3. Bolt.Earth 15A/16A Universal 3-Pin Sockets (for Ather Portable Cable)
- Outputs verified bolt_chargers.json, chargers_db.json, and chargers_db.js
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

def is_strictly_4_wheeler(cid, model_id):
    cid_upper = str(cid).upper()
    mid_upper = str(model_id).upper()

    # Model identifiers for 4-wheelers
    if any(k in mid_upper for k in [
        'OCPP_LEVEL_2', 'OCPP_LEVEL_3', 'LEVEL_2', 'LEVEL_3',
        'OCPI', 'CCS', 'TYPE2', 'GB/T', 'CHADEMO'
    ]):
        return True

    # Charger ID prefixes for 4W car networks
    if cid_upper.startswith('L200') or cid_upper.startswith('L300') or cid_upper.startswith('ST'):
        return True

    # Roaming 4W partner car IDs
    if any(cid_upper.startswith(p) for p in ['TN00', 'MH00', 'TS00', 'HR00', 'GJ01', 'DL00', 'HR01', 'KL00', 'KA01', 'MH04']):
        return True

    return False

def classify_2w_charger(cid, model_id):
    cid_upper = str(cid).upper()
    mid_upper = str(model_id).upper()

    if is_strictly_4_wheeler(cid, model_id):
        return False, False, '', '', 0, ''

    # 1. 2W Fast Charger with Ather Gun (IS 17017-2-7 Type 7 LEV DC / Type 6)
    if cid_upper.startswith('L1DC') or '2WFC' in mid_upper or 'TYPE7' in mid_upper or 'TYPE6' in mid_upper:
        return (
            True,
            True,
            'Ather Gun (IS 17017 Type 7 LEV DC Fast) ⚡',
            '100% Direct Plug-in (Ather 450X/Rizta/Apex)',
            3.3,
            'FAST'
        )

    # 2. 2W 15A/16A Universal Socket
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
    print("VoltWay 2W - Purging 4-Wheeler Car Chargers & Generating 100% 2W Database")
    print("=" * 72)

    bolt_file = os.path.join(BASE_DIR, 'bolt_chargers.json')
    ather_file = os.path.join(BASE_DIR, 'ather_grid_chargers.json')

    with open(bolt_file, 'r', encoding='utf-8') as f:
        raw_bolt = json.load(f)

    print(f"Loaded raw bolt_chargers: {len(raw_bolt)} entries")

    pure_bolt = {}
    purged_cars = 0

    for c in raw_bolt:
        cid = c['id']
        mid = c.get('modelId', '') or c.get('model_id', '')

        if is_strictly_4_wheeler(cid, mid):
            purged_cars += 1
            continue

        is_2w, is_fast, conn_name, compat, power, ctype = classify_2w_charger(cid, mid)
        if not is_2w:
            purged_cars += 1
            continue

        clean_addr = c.get('address', '').split(',')[0].strip()
        if is_fast:
            name_label = f"Bolt Fast (Ather Gun ⚡) - {clean_addr or cid}"
        else:
            name_label = f"Bolt.Earth 15A Socket - {clean_addr or cid}"

        pure_bolt[cid] = {
            'id': cid,
            'name': name_label,
            'network': 'BOLT_EARTH',
            'type': ctype,
            'model_id': mid,
            'connector': conn_name,
            'is_ather_gun': is_fast,
            'ather_compatibility': compat,
            'power_kw': power,
            'lat': c['lat'],
            'lng': c['lng'],
            'address': c.get('address', ''),
            'source': 'Bolt.Earth Verified 2W',
            'is_2w': True,
            'status': 'OPERATIONAL'
        }

    bolt_list = list(pure_bolt.values())
    fast_bolt = [c for c in bolt_list if c['type'] == 'FAST']
    slow_bolt = [c for c in bolt_list if c['type'] == 'SLOW']

    print(f"Purged {purged_cars} 4-Wheeler car stations!")
    print(f"Retained {len(bolt_list)} pure 2-Wheeler Bolt.Earth stations:")
    print(f"  • Bolt Fast (Ather Gun ⚡) : {len(fast_bolt)}")
    print(f"  • Bolt 15A Sockets (2W)    : {len(slow_bolt)}")

    # Save cleaned bolt_chargers.json
    with open(bolt_file, 'w', encoding='utf-8') as f:
        json.dump(bolt_list, f, indent=2, ensure_ascii=False)
    print(f"Updated {bolt_file}")

    # Process Ather Grid Chargers
    ather_list = []
    if os.path.exists(ather_file):
        with open(ather_file, 'r', encoding='utf-8') as f:
            ather_raw = json.load(f)
            for a in ather_raw:
                ather_list.append({
                    'id': a['id'],
                    'name': a.get('name') or f"Ather Grid Fast Charger - {a['id']}",
                    'network': 'ATHER_GRID',
                    'type': 'FAST',
                    'model_id': 'ATHER_GRID_FAST_DC',
                    'connector': 'Ather Grid Official DC Fast Gun (IS 17017-2-7 / Type 7) ⚡',
                    'is_ather_gun': True,
                    'ather_compatibility': '100% Direct Plug-in (Official Ather Grid Gun)',
                    'power_kw': 3.3,
                    'lat': a['lat'],
                    'lng': a['lng'],
                    'address': a.get('address', ''),
                    'source': 'Ather Grid Official',
                    'is_2w': True,
                    'status': 'OPERATIONAL'
                })

    print(f"Loaded Ather Grid 2W Fast Chargers: {len(ather_list)}")

    combined = ather_list + bolt_list
    total_fast = len([c for c in combined if c['type'] == 'FAST'])
    total_slow = len([c for c in combined if c['type'] == 'SLOW'])

    # Kerala Stats
    kerala_stations = [c for c in combined if 8.15 <= c['lat'] <= 12.85 and 74.85 <= c['lng'] <= 77.45]
    kerala_ather_fast = [c for c in kerala_stations if c['network'] == 'ATHER_GRID']
    kerala_bolt_fast = [c for c in kerala_stations if c['network'] == 'BOLT_EARTH' and c['type'] == 'FAST']
    kerala_bolt_slow = [c for c in kerala_stations if c['network'] == 'BOLT_EARTH' and c['type'] == 'SLOW']

    print("=" * 72)
    print("MASTER TWO-WHEELER DATABASE BREAKDOWN:")
    print(f"  • Total All 2W EV Stations in India : {len(combined)}")
    print(f"  • Total Ather Gun Fast Chargers     : {total_fast} (Ather: {len(ather_list)} + Bolt Fast: {len(fast_bolt)})")
    print(f"  • Total 15A Universal Sockets       : {total_slow}")
    print(f"  • In Kerala State Alone             : {len(kerala_stations)} total")
    print(f"      - Ather Grid Fast Chargers      : {len(kerala_ather_fast)}")
    print(f"      - Bolt 2W Fast (Ather Gun ⚡)    : {len(kerala_bolt_fast)}")
    print(f"      - Bolt 15A Sockets              : {len(kerala_bolt_slow)}")
    print(f"      - Kerala Total Fast Chargers    : {len(kerala_ather_fast) + len(kerala_bolt_fast)}")
    print(f"  • 4-Wheeler Car Chargers Remaining  : 0 (100% PURGED)")
    print("=" * 72)

    # Write chargers_db.json
    db_json_path = os.path.join(BASE_DIR, 'chargers_db.json')
    with open(db_json_path, 'w', encoding='utf-8') as f:
        json.dump(combined, f, indent=2, ensure_ascii=False)
    print(f"Wrote {db_json_path}")

    # Write chargers_db.js
    db_js_path = os.path.join(BASE_DIR, 'chargers_db.js')
    with open(db_js_path, 'w', encoding='utf-8') as f:
        f.write("// VoltWay 2W - 100% Verified Two-Wheeler Chargers Database (Offline PWA)\n")
        f.write("// ZERO 4-Wheeler Car Chargers. Ather Grid + Bolt 2W Fast (Type 7 LEV DC Gun) & 15A Sockets\n")
        f.write(f"// Total 2W Stations: {len(combined)} (Ather Fast: {len(ather_list)}, Bolt 2W Fast: {len(fast_bolt)}, Bolt 15A: {len(slow_bolt)})\n")
        f.write("window.BUNDLED_CHARGERS = ")
        json.dump(combined, f, ensure_ascii=False)
        f.write(";\n")
    print(f"Wrote {db_js_path}")

if __name__ == '__main__':
    main()
