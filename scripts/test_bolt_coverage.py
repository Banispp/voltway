import urllib.request
import json
import time

with open('scripts/harvest_bolt_flawless.py', 'r', encoding='utf-8') as f:
    text = f.read()
loc = {}
exec(text, loc)
zones = loc['ZONES']

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
}

all_chargers = {}
models_count = {}

print(f"Testing first 20 zones out of {len(zones)}...")
for i, z in enumerate(zones[:20]):
    url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={z['b']}&lng_left={z['l']}&lat_top={z['t']}&lng_right={z['r']}&zoom=14"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            items = data.get('data', [])
            for it in items:
                cid = it.get('chargerId')
                if cid and cid not in all_chargers:
                    all_chargers[cid] = it
                    m = (it.get('model', {}).get('modelId') or 'unknown').upper()
                    models_count[m] = models_count.get(m, 0) + 1
    except Exception as e:
        print(f"Err on {z['name']}: {e}")
    time.sleep(0.15)

print(f"Total unique chargers in first 20 zones: {len(all_chargers)}")
print("Models breakdown:")
for m, c in sorted(models_count.items(), key=lambda x: -x[1]):
    print(f"  {m}: {c}")
