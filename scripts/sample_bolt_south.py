import urllib.request
import json
import time

CITIES = [
    # Kerala
    {'name': 'Kochi', 'b': 9.85, 'l': 76.15, 't': 10.15, 'r': 76.45},
    {'name': 'Trivandrum', 'b': 8.40, 'l': 76.85, 't': 8.65, 'r': 77.05},
    {'name': 'Kozhikode', 'b': 11.15, 'l': 75.70, 't': 11.40, 'r': 75.95},
    {'name': 'Thrissur', 'b': 10.40, 'l': 76.10, 't': 10.65, 'r': 76.35},
    {'name': 'Kannur', 'b': 11.75, 'l': 75.30, 't': 12.00, 'r': 75.55},
    {'name': 'Palakkad', 'b': 10.70, 'l': 76.55, 't': 10.90, 'r': 76.75},
    {'name': 'Kollam', 'b': 8.80, 'l': 76.50, 't': 9.05, 'r': 76.75},
    {'name': 'Kottayam', 'b': 9.50, 'l': 76.45, 't': 9.70, 'r': 76.65},
    {'name': 'Alappuzha', 'b': 9.40, 'l': 76.25, 't': 9.60, 'r': 76.45},
    {'name': 'Malappuram', 'b': 10.95, 'l': 75.95, 't': 11.15, 'r': 76.15},
    # Tamil Nadu
    {'name': 'Coimbatore', 'b': 10.90, 'l': 76.85, 't': 11.15, 'r': 77.10},
    {'name': 'Chennai', 'b': 12.90, 'l': 80.05, 't': 13.20, 'r': 80.35},
    {'name': 'Madurai', 'b': 9.85, 'l': 78.05, 't': 10.05, 'r': 78.25},
    {'name': 'Salem', 'b': 11.55, 'l': 78.05, 't': 11.75, 'r': 78.25},
    {'name': 'Tirunelveli', 'b': 8.65, 'l': 77.65, 't': 8.80, 'r': 77.80},
    {'name': 'Kanyakumari', 'b': 8.05, 'l': 77.45, 't': 8.25, 'r': 77.60},
    # Karnataka
    {'name': 'Bengaluru', 'b': 12.80, 'l': 77.45, 't': 13.15, 'r': 77.75},
    {'name': 'Mysuru', 'b': 12.25, 'l': 76.55, 't': 12.40, 'r': 76.75},
    {'name': 'Mangaluru', 'b': 12.80, 'l': 74.80, 't': 13.00, 'r': 75.00},
    {'name': 'Udupi-Manipal', 'b': 13.25, 'l': 74.70, 't': 13.45, 'r': 74.85},
]

headers = {'User-Agent': 'Mozilla/5.0'}

total_found = 0
for c in CITIES:
    url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={c['b']}&lng_left={c['l']}&lat_top={c['t']}&lng_right={c['r']}&zoom=16"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode())
            items = data.get('data', [])
            total_found += len(items)
            print(f"{c['name']}: {len(items)} items returned")
        time.sleep(1.2)
    except Exception as e:
        print(f"{c['name']} error:", e)
        break

print(f"Total items in sample scan: {total_found}")
