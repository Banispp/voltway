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
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'error': str(e)}

# Test Kochi at zoom 14 vs zoom 18
kochi_z14 = query('https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=9.85&lng_left=76.20&lat_top=10.15&lng_right=76.45&zoom=14')
kochi_z18 = query('https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=9.85&lng_left=76.20&lat_top=10.15&lng_right=76.45&zoom=18')

items_14 = kochi_z14.get('data', [])
items_18 = kochi_z18.get('data', [])

print(f"Kochi at zoom 14: items={len(items_14)}, direct chargers={sum(1 for x in items_14 if 'chargerId' in x)}, clusters={sum(1 for x in items_14 if x.get('properties', {}).get('cluster'))}", flush=True)
print(f"Kochi at zoom 18: items={len(items_18)}, direct chargers={sum(1 for x in items_18 if 'chargerId' in x)}, clusters={sum(1 for x in items_18 if x.get('properties', {}).get('cluster'))}", flush=True)

# Test Calicut/Kozhikode at zoom 18
time.sleep(1.2)
clt_z18 = query('https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=11.10&lng_left=75.70&lat_top=11.45&lng_right=76.00&zoom=18')
items_clt = clt_z18.get('data', [])
print(f"Calicut at zoom 18: items={len(items_clt)}, direct chargers={sum(1 for x in items_clt if 'chargerId' in x)}", flush=True)
