"""
VoltWay 2W - Official Hero VIDA Grid Fast Chargers Sync Script
Fetches charging points from Hero VIDA official network:
https://www.vidaworld.com/content/dam/vida/map/map.json.gzip
"""

import urllib.request
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from charger_validator import classify_state

URL = 'https://www.vidaworld.com/content/dam/vida/map/map.json.gzip'
FALLBACK_URL = 'https://www.vidaworld.com/content/dam/vida/map/map.json'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Encoding': 'gzip, deflate'
}


def sync_vida():
    print("Connecting to Hero VIDA Official API...")
    data_bytes = None
    for target_url in [URL, FALLBACK_URL]:
        try:
            req = urllib.request.Request(target_url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                try:
                    data_bytes = gzip.decompress(raw)
                except Exception:
                    data_bytes = raw
                if data_bytes:
                    break
        except Exception as e:
            print(f"VIDA endpoint {target_url} failed: {e}")

    if not data_bytes:
        print("Could not fetch VIDA data, keeping existing.")
        return []

    try:
        cities = json.loads(data_bytes.decode('utf-8'))
    except Exception as e:
        print("JSON parse error:", e)
        return []

    cleaned = []
    seen_ids = set()

    for city in cities:
        c_name = city.get('cityName', '')
        s_name = city.get('stateName', '')
        for ch in city.get('chargingStations', []):
            sid = ch.get('stationId')
            item_id = f'VIDA_{sid}'
            if not sid or item_id in seen_ids:
                continue
            try:
                lat = float(ch.get('latitude', 0))
                lng = float(ch.get('longitude', 0))
            except Exception:
                continue
            if not (6 <= lat <= 38 and 68 <= lng <= 98):
                continue

            st_name = (ch.get('stationName') or '').strip()
            addr = (ch.get('chargingStationAddress') or '').strip()
            clean_addr = addr.split(',')[0].strip()
            disp_name = f'Vida Grid Fast - {st_name or clean_addr or c_name}'
            st = classify_state(disp_name, f"{addr} {c_name} {s_name}", lat, lng)

            cleaned.append({
                'id': item_id,
                'name': disp_name,
                'network': 'VIDA_GRID',
                'type': 'FAST',
                'state': st,
                'model_id': 'HERO_VIDA_FAST_LEVDC',
                'connector_std': 'TYPE7_LECCS',
                'compatible_vehicles': ['ATHER', 'VIDA'],
                'connector': 'Type 7 LECCS DC Fast (Hero VIDA / Ather Compatible)',
                'power_kw': 3.3,
                'lat': round(lat, 6),
                'lng': round(lng, 6),
                'address': addr if addr else f'Location in {c_name}, {s_name}',
                'source': 'Hero VIDA Official',
                'verified': True,
                'is_2w': True
            })
            seen_ids.add(item_id)

    out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'vida_chargers.json')
    if len(cleaned) > 0:
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(cleaned, f, indent=2, ensure_ascii=False)
        print(f"Successfully saved {len(cleaned)} Hero VIDA fast chargers to {out_path}")

    return cleaned


if __name__ == '__main__':
    sync_vida()
