import urllib.request
import json
import time

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Origin': 'https://bolt.earth',
    'Referer': 'https://bolt.earth/'
}

url_z8 = 'https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=8.0&lng_left=68.0&lat_top=36.0&lng_right=95.0&zoom=8'
req = urllib.request.Request(url_z8, headers=headers)
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.loads(r.read().decode('utf-8'))
    items = data.get('data', [])

print(f"Total items at zoom 8: {len(items)}", flush=True)

# Collect all cluster coordinates
coords = []
for it in items:
    geom = it.get('geometry', {})
    c = geom.get('coordinates', [])
    if len(c) >= 2:
        coords.append((c[1], c[0])) # (lat, lng)

# Create 1.5 degree grid cells covering all detected charger points
cells = set()
for lat, lng in coords:
    # Snap to 1.5 degree grid
    cell_lat = round(lat / 1.5) * 1.5
    cell_lng = round(lng / 1.5) * 1.5
    cells.add((cell_lat, cell_lng))

print(f"Unique 1.5x1.5 degree active grid cells across India: {len(cells)}", flush=True)
