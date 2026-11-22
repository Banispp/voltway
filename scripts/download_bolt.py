"""
VoltWay 2W - Bolt.Earth Live API Sync Script
Directly fetches live charging points from Bolt.Earth Discovery API:
https://api.bolt.earth/discovery/v1/chargers/clusters
"""

import urllib.request
import json
import os
import time

BOXES = [
    {'name': 'Bangalore & Karnataka', 'lat_bottom': 12.0, 'lng_left': 76.5, 'lat_top': 13.5, 'lng_right': 78.0},
    {'name': 'Kerala (Kochi, Calicut, TVM)', 'lat_bottom': 8.4, 'lng_left': 75.5, 'lat_top': 11.5, 'lng_right': 77.2},
    {'name': 'Chennai & Tamil Nadu', 'lat_bottom': 12.7, 'lng_left': 79.8, 'lat_top': 13.4, 'lng_right': 80.4},
    {'name': 'Hyderabad & Telangana', 'lat_bottom': 17.1, 'lng_left': 78.1, 'lat_top': 17.7, 'lng_right': 78.7},
    {'name': 'Mumbai & Pune Corridor', 'lat_bottom': 18.3, 'lng_left': 72.7, 'lat_top': 19.4, 'lng_right': 74.0},
    {'name': 'Delhi NCR', 'lat_bottom': 28.2, 'lng_left': 76.8, 'lat_top': 28.9, 'lng_right': 77.5},
    {'name': 'Coimbatore & Western TN', 'lat_bottom': 10.8, 'lng_left': 76.8, 'lat_top': 11.8, 'lng_right': 78.2},
    {'name': 'Gujarat (Ahmedabad/Surat)', 'lat_bottom': 21.0, 'lng_left': 72.0, 'lat_top': 23.5, 'lng_right': 73.5}
]

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

def sync_bolt():
    all_chargers = {}
    print("Connecting to Bolt.Earth Live Discovery API across corridors...")

    for i, box in enumerate(BOXES):
        url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={box['lat_bottom']}&lng_right={box['lng_right']}&lat_top={box['lat_top']}&lng_left={box['lng_left']}&zoom=13"
        print(f"Fetching region {i+1}/{len(BOXES)}: {box['name']}...")
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                items = data.get('data', [])
                for item in items:
                    cid = item.get('chargerId')
                    if not cid or cid in all_chargers:
                        continue
                    coords = item.get('geometry', {}).get('coordinates', [])
                    if len(coords) < 2:
                        continue
                    lng, lat = coords[0], coords[1]
                    if not (6 <= lat <= 38 and 68 <= lng <= 98):
                        continue

                    model = item.get('model', {})
                    model_id = (model.get('modelId') or '').upper()

                    # Filter out 4W CCS2 / car guns
                    if 'CCS' in model_id or 'GB/T' in model_id or 'CHADEMO' in model_id:
                        continue

                    is_fast = False
                    if 'FAST' in model_id or '2WFC' in model_id or 'LEVEL_2' in model_id or 'LEVEL_3' in model_id:
                        is_fast = True
                        ctype = 'FAST'
                        conn_name = 'Bolt.Earth Fast Charger (DC / Fast AC)'
                        power = 3.3
                    else:
                        ctype = 'SLOW'
                        conn_name = 'Standard 15A / 3-Pin AC Socket'
                        power = 1.5

                    station = item.get('station', {})
                    addr = station.get('address') or ''
                    name = f"Bolt.Earth {'Fast' if is_fast else '15A'} - {cid}"

                    all_chargers[cid] = {
                        'id': cid,
                        'name': name,
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
            time.sleep(0.3)
        except Exception as e:
            print(f"  Error on {box['name']}: {e}")

    bolt_list = list(all_chargers.values())
    out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bolt_chargers.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(bolt_list, f, ensure_ascii=False)

    print(f"Successfully saved {len(bolt_list)} Bolt.Earth chargers to {out_path}")
    return bolt_list

if __name__ == '__main__':
    sync_bolt()
