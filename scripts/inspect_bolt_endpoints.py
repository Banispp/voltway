import urllib.request
import json
import time

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Origin': 'https://bolt.earth',
    'Referer': 'https://bolt.earth/'
}

def query(url):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'error': str(e)}

# Test what happens at various zoom levels for Bangalore (12.8 to 13.2, 77.4 to 77.8)
for z in [6, 8, 10, 12, 14, 16, 18]:
    url = f'https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=12.80&lng_left=77.45&lat_top=13.15&lng_right=77.80&zoom={z}'
    res = query(url)
    items = res.get('data', [])
    clusters = sum(1 for x in items if x.get('properties', {}).get('cluster'))
    chargers = sum(1 for x in items if 'chargerId' in x)
    print(f"Zoom {z:2d}: Total items={len(items):3d} | Clusters={clusters:3d} | Direct Chargers={chargers:3d}")
    time.sleep(1.0)
