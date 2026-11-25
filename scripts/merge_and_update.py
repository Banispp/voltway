"""
VoltWay 2W - Database Merge, Connector Validation & Production Bundle Script
1. Validates Ather Grid, Hero VIDA Grid, and Bolt.Earth datasets.
2. Quarantines 4W Level 2/3, CCS2, GB/T, and unverified OCPI records into backups/non_2w_quarantined_bolt.json.
3. Distinguishes Type 7 LECCS vs Type 6 LEVDC vs Universal 15A AC connectors and real power ratings.
4. Produces single compact minified production bundle chargers_db.json (no duplicate runtime copies).
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from charger_validator import (
    classify_state,
    is_excluded_4w_or_roaming,
    parse_bolt_power_kw,
    parse_bolt_connector
)

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ather_path = os.path.join(base_dir, 'ather_grid_chargers.json')
bolt_path = os.path.join(base_dir, 'bolt_chargers.json')
vida_path = os.path.join(base_dir, 'vida_chargers.json')
quarantine_path = os.path.join(base_dir, 'backups', 'non_2w_quarantined_bolt.json')
db_json_path = os.path.join(base_dir, 'chargers_db.json')
db_js_path = os.path.join(base_dir, 'chargers_db.js')


def normalize_and_merge():
    print("Validating & merging unified 2W EV charger database...")

    ather_raw = json.load(open(ather_path, 'r', encoding='utf-8')) if os.path.exists(ather_path) else []
    vida_raw = json.load(open(vida_path, 'r', encoding='utf-8')) if os.path.exists(vida_path) else []
    bolt_raw = json.load(open(bolt_path, 'r', encoding='utf-8')) if os.path.exists(bolt_path) else []

    quarantined = {}
    if os.path.exists(quarantine_path):
        try:
            for q in json.load(open(quarantine_path, 'r', encoding='utf-8')):
                if q.get('id'):
                    quarantined[q['id']] = q
        except Exception:
            pass

    clean_ather = []
    for c in ather_raw:
        lat, lng = c.get('lat'), c.get('lng')
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        if not (6 <= lat <= 38 and 68 <= lng <= 98):
            continue
        item = {
            'id': str(c['id']),
            'name': (c.get('name') or 'Ather Grid Fast Charger').strip(),
            'network': 'ATHER_GRID',
            'type': 'FAST',
            'connector_std': 'TYPE7_LECCS',
            'compatible_vehicles': ['ATHER', 'VIDA'],
            'connector': 'Type 7 LECCS DC Fast (Ather / Hero VIDA)',
            'power_kw': float(c.get('power_kw') or 3.3),
            'lat': round(float(lat), 6),
            'lng': round(float(lng), 6),
            'address': (c.get('address') or '').strip(),
            'source': 'Ather Energy Official',
            'verified': True,
            'is_2w': True,
            'state': classify_state(c.get('name', ''), c.get('address', ''), lat, lng)
        }
        clean_ather.append(item)

    clean_vida = []
    for c in vida_raw:
        lat, lng = c.get('lat'), c.get('lng')
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        if not (6 <= lat <= 38 and 68 <= lng <= 98):
            continue
        item = {
            'id': str(c['id']),
            'name': (c.get('name') or 'Hero VIDA Fast Charger').strip(),
            'network': 'VIDA_GRID',
            'type': 'FAST',
            'model_id': c.get('model_id') or 'HERO_VIDA_FAST_LEVDC',
            'connector_std': 'TYPE7_LECCS',
            'compatible_vehicles': ['ATHER', 'VIDA'],
            'connector': 'Type 7 LECCS DC Fast (Hero VIDA / Ather Compatible)',
            'power_kw': float(c.get('power_kw') or 3.3),
            'lat': round(float(lat), 6),
            'lng': round(float(lng), 6),
            'address': (c.get('address') or '').strip(),
            'source': 'Hero VIDA Official',
            'verified': True,
            'is_2w': True,
            'state': classify_state(c.get('name', ''), c.get('address', ''), lat, lng)
        }
        clean_vida.append(item)

    clean_bolt = []
    for c in bolt_raw:
        cid = str(c.get('id') or '')
        lat, lng = c.get('lat'), c.get('lng')
        if not cid or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        if not (6 <= lat <= 38 and 68 <= lng <= 98):
            continue

        model_id = c.get('model_id') or ''
        addr = (c.get('address') or '').strip()
        name = (c.get('name') or '').strip()

        if is_excluded_4w_or_roaming(cid, model_id, name, addr):
            quarantined[cid] = c
            continue

        is_fast = (c.get('type') == 'FAST') or ('2WFC' in model_id.upper()) or cid.upper().startswith('L1DC')
        conn_std, compat_vehicles, conn_label = parse_bolt_connector(model_id, is_fast)
        power_kw = parse_bolt_power_kw(model_id, is_fast)
        verified = bool(model_id) and not (not is_fast and cid.upper().startswith(('L2', 'L3', 'ST')))

        item = {
            'id': cid,
            'name': name or f"Bolt.Earth {'Fast' if is_fast else '15A'} - {cid}",
            'network': 'BOLT_EARTH',
            'type': 'FAST' if is_fast else 'SLOW',
            'model_id': model_id,
            'connector_std': conn_std,
            'compatible_vehicles': compat_vehicles,
            'connector': conn_label,
            'power_kw': power_kw,
            'lat': round(float(lat), 6),
            'lng': round(float(lng), 6),
            'address': addr,
            'source': 'Bolt.Earth Live API',
            'verified': verified,
            'is_2w': True,
            'state': classify_state(name, addr, lat, lng)
        }
        clean_bolt.append(item)

    os.makedirs(os.path.dirname(quarantine_path), exist_ok=True)
    with open(quarantine_path, 'w', encoding='utf-8') as f:
        json.dump(list(quarantined.values()), f, ensure_ascii=False)

    # Persist cleaned network JSONs so future diffs stay clean
    with open(ather_path, 'w', encoding='utf-8') as f:
        json.dump(clean_ather, f, ensure_ascii=False)
    with open(vida_path, 'w', encoding='utf-8') as f:
        json.dump(clean_vida, f, indent=2, ensure_ascii=False)
    with open(bolt_path, 'w', encoding='utf-8') as f:
        json.dump(clean_bolt, f, ensure_ascii=False)

    seen_ids = set()
    combined = []
    for item in clean_ather + clean_vida + clean_bolt:
        if item['id'] in seen_ids:
            continue
        seen_ids.add(item['id'])
        combined.append(item)

    # Single compact minified JSON bundle (replaces dual redundant pretty JSON + sync JS)
    with open(db_json_path, 'w', encoding='utf-8') as f:
        json.dump(combined, f, separators=(',', ':'), ensure_ascii=False)

    # Remove bloated duplicate chargers_db.js if present to avoid shipping 2x DB payload
    if os.path.exists(db_js_path):
        os.remove(db_js_path)
        print(f"Removed redundant duplicate bundle: {db_js_path}")

    print(f"Quarantined non-2W/OCPI records saved to {quarantine_path}: {len(quarantined)}")
    print(f"Verified 2W summary -> Ather: {len(clean_ather)}, VIDA: {len(clean_vida)}, Bolt: {len(clean_bolt)}, Total: {len(combined)}")
    print(f"Updated minified {db_json_path} ({os.path.getsize(db_json_path):,} bytes)")


if __name__ == '__main__':
    normalize_and_merge()
