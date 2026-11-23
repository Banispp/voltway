import urllib.request
import json
import time

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Origin': 'https://bolt.earth',
    'Referer': 'https://bolt.earth/'
}

for z in [9, 10, 11]:
    url = f'https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=8.0&lng_left=68.0&lat_top=36.0&lng_right=95.0&zoom={z}'
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode('utf-8'))
            items = data.get('data', [])
            clusters = [x for x in items if x.get('properties', {}).get('cluster')]
            direct = [x for x in items if 'chargerId' in x]
            print(f"Zoom {z}: items={len(items)}, clusters={len(clusters)}, direct={len(direct)}", flush=True)
    except Exception as e:
        print(f"Zoom {z} error:", e, flush=True)
    time.sleep(1.2)
