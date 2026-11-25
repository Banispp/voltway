"""
VoltWay 2W - Official Ather Grid Fast Chargers Sync Script
Fetches charging points from Ather Energy official endpoint:
https://www.atherenergy.com/api/grid-locations
"""

import urllib.request
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from charger_validator import classify_state

URL = 'https://www.atherenergy.com/api/grid-locations'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}


def sync_ather():
    print("Connecting to Ather Energy Official API...")
    req = urllib.request.Request(URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))

    features = data.get('features', [])
    print(f"Fetched {len(features)} stations from Ather.")

    cleaned = []
    seen_ids = set()
    for f in features:
        coords = f.get('geometry', {}).get('coordinates', [])
        if len(coords) < 2:
            continue
        lng, lat = float(coords[0]), float(coords[1])
        if not (6 <= lat <= 38 and 68 <= lng <= 98):
            continue

        props = f.get('properties', {})
        name = (props.get('name') or props.get('Name') or 'Ather Grid Fast Charger').strip()
        addr = (props.get('address') or props.get('Area') or '').strip()
        cid = str(props.get('id') or f.get('id') or f"ather-{len(cleaned)}")
        if cid in seen_ids:
            continue
        seen_ids.add(cid)

        cleaned.append({
            'id': cid,
            'name': name,
            'network': 'ATHER_GRID',
            'type': 'FAST',
            'state': classify_state(name, addr, lat, lng),
            'connector_std': 'TYPE7_LECCS',
            'compatible_vehicles': ['ATHER', 'VIDA'],
            'connector': 'Type 7 LECCS DC Fast (Ather 450X / Rizta / Apex & Hero VIDA)',
            'power_kw': 3.3,
            'lat': round(lat, 6),
            'lng': round(lng, 6),
            'address': addr,
            'source': 'Ather Energy Official',
            'verified': True,
            'is_2w': True
        })

    out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ather_grid_chargers.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(cleaned, f, ensure_ascii=False)

    print(f"Successfully saved {len(cleaned)} Ather Grid fast chargers to {out_path}")
    return cleaned


if __name__ == '__main__':
    sync_ather()
