import urllib.request
import json
import time

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Origin': 'https://bolt.earth',
    'Referer': 'https://bolt.earth/'
}

# Test querying Kerala / South India with 1.0 degree box at zoom 18
# e.g., lat 8.0-10.0, lng 76.0-77.5
boxes = [
    ("South Kerala (8.0-10.0, 76.0-77.5)", 8.0, 76.0, 10.0, 77.5),
    ("North Kerala (10.0-13.0, 75.0-76.5)", 10.0, 75.0, 13.0, 76.5),
    ("Karnataka South / BLR (12.0-14.0, 76.5-78.5)", 12.0, 76.5, 14.0, 78.5),
]

for label, b, l, t, r in boxes:
    url = f'https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={b}&lng_left={l}&lat_top={t}&lng_right={r}&zoom=18'
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            items = data.get('data', [])
            clusters = sum(1 for x in items if x.get('properties', {}).get('cluster'))
            direct = sum(1 for x in items if 'chargerId' in x)
            print(f"{label}: total={len(items)}, direct chargers={direct}, clusters={clusters}", flush=True)
    except Exception as e:
        print(f"{label} error:", e, flush=True)
    time.sleep(1.2)
