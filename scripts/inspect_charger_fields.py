import urllib.request
import json

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Origin': 'https://bolt.earth',
    'Referer': 'https://bolt.earth/'
}

url = 'https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=9.95&lng_left=76.25&lat_top=10.05&lng_right=76.35&zoom=18'
req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req, timeout=10) as r:
    data = json.loads(r.read().decode('utf-8'))
    items = data.get('data', [])
    for it in items[:3]:
        print(json.dumps(it, indent=2))
        print("="*50)
