"""
VoltWay 2W - Polite & Thorough Bolt.Earth Harvester
Iterates over all 54 zones across Kerala & South India/India with automatic 429 backoff.
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

from harvest_bolt_flawless import ZONES

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
}

def query_url(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                return data.get('data', [])
        except urllib.error.HTTPError as he:
            if he.code == 429:
                wait_sec = 5
                try:
                    wait_sec = int(he.headers.get('Retry-After', '5')) + 1
                except Exception:
                    pass
                print(f" [429 Throttled: Pausing {wait_sec}s...] ", end='', flush=True)
                time.sleep(wait_sec)
            else:
                print(f" [HTTP {he.code}] ", end='', flush=True)
                return []
        except Exception as e:
            time.sleep(1.0)
    return []

def run():
    base_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bolt_chargers.json')
    master = {}
    if os.path.exists(base_file):
        with open(base_file, 'r', encoding='utf-8') as f:
            for c in json.load(f):
                master[c['id']] = c
    print(f"Baseline Bolt chargers: {len(master)}", flush=True)

    total_added = 0
    start_t = time.time()

    for i, z in enumerate(ZONES):
        name = z['name']
        b, l, t, r = z['b'], z['l'], z['t'], z['r']
        url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={b}&lng_left={l}&lat_top={t}&lng_right={r}&zoom=13"
        items = query_url(url)
        time.sleep(1.2)  # 1.2s polite delay prevents Cloudflare 429

        zone_chargers = []
        clusters = []
        for it in items:
            if 'chargerId' in it:
                zone_chargers.append(it)
            elif it.get('properties', {}).get('cluster'):
                clusters.append(it)

        # For clusters, query sub-box at zoom 15
        for cl in clusters[:15]:  # top 15 clusters per zone
            coords = cl.get('geometry', {}).get('coordinates', [])
            if len(coords) < 2:
                continue
            cl_lng, cl_lat = coords[0], coords[1]
            sub_url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={round(cl_lat-0.02, 5)}&lng_left={round(cl_lng-0.02, 5)}&lat_top={round(cl_lat+0.02, 5)}&lng_right={round(cl_lng+0.02, 5)}&zoom=15"
            sub_items = query_url(sub_url)
            for sit in sub_items:
                if 'chargerId' in sit:
                    zone_chargers.append(sit)
            time.sleep(1.0)

        added = 0
        for it in zone_chargers:
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
            model_id = str(model.get('modelId') or '').upper()

            # Skip 4W heavy car chargers
            if 'CCS' in model_id or 'GB/T' in model_id or 'CHADEMO' in model_id:
                continue

            cid_upper = str(cid).upper()
            is_fast = False
            # 2W Fast Charger Identification:
            # 2WFC, L1DC, Level 2/3, Type 6/7, Fast
            if ('2WFC' in model_id or 'FAST' in model_id or 'TYPE6' in model_id or 'TYPE7' in model_id or
                'L1DC' in cid_upper or 'LEVEL_2' in model_id or 'LEVEL_3' in model_id or 'OCPP_LEVEL_2' in model_id):
                is_fast = True
                ctype = 'FAST'
                conn_name = 'Bolt.Earth Fast Charger (DC / Fast AC Type 7 Gun)'
                power = 3.3
            else:
                ctype = 'SLOW'
                conn_name = 'Standard 15A / 3-Pin AC Socket'
                power = 1.5

            station = it.get('station', {}) or {}
            addr = station.get('address') or ''
            name_label = f"Bolt.Earth {'Fast' if is_fast else '15A'} - {cid}"

            if cid not in master:
                added += 1
                total_added += 1

            master[cid] = {
                'id': cid,
                'name': name_label,
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

        fast_c = sum(1 for c in master.values() if c['type'] == 'FAST')
        slow_c = sum(1 for c in master.values() if c['type'] == 'SLOW')
        print(f"[{i+1}/{len(ZONES)}] {name}: +{added} new (Total: {len(master)} | ⚡{fast_c} Fast, 🔌{slow_c} Slow)", flush=True)

    print(f"\nCompleted in {time.time()-start_t:.1f}s. Total Bolt stations: {len(master)} (+{total_added} new)", flush=True)

    # Save to bolt_chargers.json
    final_list = list(master.values())
    with open(base_file, 'w', encoding='utf-8') as f:
        json.dump(final_list, f, ensure_ascii=False)
    print(f"Saved {len(final_list)} Bolt chargers to {base_file}", flush=True)

    # Run merge_and_update.py
    import subprocess
    merge_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'merge_and_update.py')
    subprocess.run([sys.executable, merge_script])

if __name__ == '__main__':
    run()
