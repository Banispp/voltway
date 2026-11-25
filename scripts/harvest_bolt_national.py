"""
VoltWay 2W - National Comprehensive Bolt.Earth Harvester (Zoom 18 Unclustered)
Discovers verified 2-Wheeler Fast (2WFC Type 6 / Type 7) & 15A/16A AC Sockets across India,
strictly excluding 4W Level 2/3, CCS2, GB/T, and unverified OCPI car stations.
"""

import urllib.request
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from charger_validator import (
    classify_state,
    is_excluded_4w_or_roaming,
    parse_bolt_power_kw,
    parse_bolt_connector
)

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
                return data.get('data') or []
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
                return None
        except Exception:
            time.sleep(1.0)
    return None


def is_verified_2w_fast(cid, model_id):
    mid = (model_id or '').upper()
    cid_up = (cid or '').upper()
    return ('2WFC' in mid) or cid_up.startswith('L1DC')


def is_verified_2w_slow(cid, model_id):
    mid = (model_id or '').upper()
    cid_up = (cid or '').upper()
    if any(tok in mid for tok in ('BOLT_16A', 'BOLT_LITE', 'OCPP_LEVEL_1', 'LEVAC_BLE_LEVEL_1')):
        return True
    if cid_up.startswith(('L100', 'L1OC', 'BOLT_')):
        return True
    return False


def build_grid_cells():
    print("[1/3] Fetching national overview at Zoom 8 across India...", flush=True)
    overview_url = 'https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=8.0&lng_left=68.0&lat_top=36.0&lng_right=95.0&zoom=8'
    overview_items = query_url(overview_url)
    print(f"Found {len(overview_items)} national cluster points.", flush=True)

    coords = []
    for it in overview_items:
        geom = it.get('geometry', {})
        c = geom.get('coordinates', [])
        if len(c) >= 2:
            coords.append((c[1], c[0]))

    cells = set()
    step = 1.0
    for lat, lng in coords:
        c_lat = round(lat / step) * step
        c_lng = round(lng / step) * step
        cells.add((round(c_lat, 2), round(c_lng, 2)))

    kerala_lat_steps = [8.3, 8.6, 8.9, 9.2, 9.5, 9.8, 10.1, 10.4, 10.7, 11.0, 11.3, 11.6, 11.9, 12.2, 12.5, 12.8]
    kerala_lng_steps = [74.9, 75.3, 75.7, 76.1, 76.5, 76.9, 77.3]
    for klat in kerala_lat_steps:
        for klng in kerala_lng_steps:
            cells.add((round(klat, 2), round(klng, 2)))

    # Dense Karnataka & Tamil Nadu highway/urban grid so non-clustered town fast chargers are never missed
    south_lat_steps = [8.2, 9.0, 9.8, 10.6, 11.4, 12.2, 13.0, 13.8, 14.6, 15.4, 16.2]
    south_lng_steps = [74.6, 75.5, 76.5, 77.5, 78.5, 79.5, 80.2]
    for slat in south_lat_steps:
        for slng in south_lng_steps:
            cells.add((round(slat, 2), round(slng, 2)))

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
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    base_file = os.path.join(root_dir, 'bolt_chargers.json')
    quarantine_file = os.path.join(root_dir, 'backups', 'non_2w_quarantined_bolt.json')
    os.makedirs(os.path.dirname(quarantine_file), exist_ok=True)

    master = {}
    quarantined = {}
    if os.path.exists(quarantine_file):
        try:
            with open(quarantine_file, 'r', encoding='utf-8') as f:
                for q in json.load(f):
                    quarantined[q['id']] = q
        except Exception:
            pass

    if os.path.exists(base_file):
        try:
            with open(base_file, 'r', encoding='utf-8') as f:
                prev = json.load(f)
                for p in prev:
                    if is_excluded_4w_or_roaming(p.get('id'), p.get('model_id'), p.get('name', ''), p.get('address', '')):
                        quarantined[p['id']] = p
                    else:
                        master[p['id']] = p
                print(f"Loaded {len(master)} valid 2W Bolt stations ({len(quarantined)} 4W/OCPI quarantined).", flush=True)
        except Exception as e:
            print("Baseline load warning:", e, flush=True)

    boxes = build_grid_cells()
    total_cells = len(boxes)
    print(f"[3/3] Harvesting all {total_cells} cells slowly at Zoom 18 (unclustered)...", flush=True)

    start_time = time.time()
    scanned_boxes = []
    seen_live_ids = set()

    for idx, (b, l, t, r) in enumerate(boxes):
        url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={b}&lng_left={l}&lat_top={t}&lng_right={r}&zoom=18"
        items = query_url(url)
        time.sleep(0.88)

        if items is None:
            print(f"[{idx+1}/{total_cells}] ({b:.2f}, {l:.2f}) -> API failed (skipping removal check for cell)", flush=True)
            continue

        scanned_boxes.append((b, l, t, r))
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
            station = it.get('station', {}) or {}
            address = (station.get('address') or it.get('address') or '').strip()

            if is_excluded_4w_or_roaming(cid, model_id, '', address):
                quarantined[cid] = {
                    'id': cid,
                    'model_id': model_id,
                    'lat': round(lat, 6),
                    'lng': round(lng, 6),
                    'address': address,
                    'reason': '4W_OR_OCPI_UNVERIFIED'
                }
                master.pop(cid, None)
                continue

            fast = is_verified_2w_fast(cid, model_id)
            slow = (not fast) and is_verified_2w_slow(cid, model_id)
            if not fast and not slow:
                continue

            seen_live_ids.add(cid)
            conn_std, compat_vehicles, conn_label = parse_bolt_connector(model_id, fast)
            power_kw = parse_bolt_power_kw(model_id, fast)
            verified = bool(model_id) and not (not fast and str(cid).upper().startswith(('L2', 'L3', 'ST')))
            name = f"Bolt.Earth {'Fast' if fast else '15A'} - {cid}"

            record = {
                'id': cid,
                'name': name,
                'network': 'BOLT_EARTH',
                'type': 'FAST' if fast else 'SLOW',
                'model_id': model_id,
                'connector_std': conn_std,
                'compatible_vehicles': compat_vehicles,
                'connector': conn_label,
                'power_kw': power_kw,
                'lat': round(lat, 6),
                'lng': round(lng, 6),
                'address': address,
                'source': 'Bolt.Earth Live API',
                'verified': verified,
                'is_2w': True,
                'state': classify_state(name, address, lat, lng)
            }

            if cid not in master:
                new_in_cell += 1
            master[cid] = record

        if (idx + 1) % 15 == 0 or idx == total_cells - 1 or new_in_cell > 0:
            fast_c = sum(1 for x in master.values() if x.get('type') == 'FAST')
            slow_c = sum(1 for x in master.values() if x.get('type') == 'SLOW')
            print(f"[{idx+1}/{total_cells}] ({b:.2f}, {l:.2f}) -> +{new_in_cell} new (2W Total: {len(master)} | ⚡{fast_c} Fast, 🔌{slow_c} Slow)", flush=True)

    # Reconcile removals only when >= 80% of cells responded cleanly (prevents wiping on temporary outage)
    removed_count = 0
    if total_cells > 0 and (len(scanned_boxes) / total_cells) >= 0.80:
        to_remove = []
        for cid, rec in master.items():
            if cid in seen_live_ids:
                continue
            rlat, rlng = rec.get('lat'), rec.get('lng')
            if isinstance(rlat, (int, float)) and isinstance(rlng, (int, float)):
                if any(b <= rlat <= t and l <= rlng <= r for (b, l, t, r) in scanned_boxes):
                    to_remove.append(cid)
        for cid in to_remove:
            master.pop(cid, None)
            removed_count += 1
        print(f"Reconciled deleted Bolt stations in scanned regions: -{removed_count} removed", flush=True)
    else:
        print(f"Skipped Bolt removal pass ({len(scanned_boxes)}/{total_cells} cells succeeded).", flush=True)

    elapsed = time.time() - start_time
    print(f"\nNational harvest completed in {elapsed:.1f}s. Clean 2W Bolt stations: {len(master)}", flush=True)

    with open(base_file, 'w', encoding='utf-8') as f:
        json.dump(list(master.values()), f, ensure_ascii=False)
    with open(quarantine_file, 'w', encoding='utf-8') as f:
        json.dump(list(quarantined.values()), f, ensure_ascii=False)

    merge_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'merge_and_update.py')
    if os.path.exists(merge_script):
        import subprocess
        subprocess.run([sys.executable, merge_script], check=True)


if __name__ == '__main__':
    harvest_national()
