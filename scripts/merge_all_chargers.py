import json
import os

with open('chargers_db.json', 'r', encoding='utf-8') as f:
    current = json.load(f)

with open('scripts/vida_map_raw.json', 'r', encoding='utf-8') as f:
    vida_cities = json.load(f)

existing_ids = {c['id'] for c in current}
added_vida = 0

kl_kw = ['kerala', 'malappuram', 'kozhikode', 'ernakulam', 'kochi', 'cochin', 'thrissur', 'trivandrum', 'thiruvananthapuram', 'kollam', 'alappuzha', 'alleppey', 'kottayam', 'palakkad', 'kannur', 'kasaragod', 'wayanad', 'idukki', 'pathanamthitta']
ka_kw = ['karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubli', 'hubballi', 'dharwad', 'belagavi', 'belgaum', 'udupi', 'manipal', 'tumkur', 'tumakuru', 'shimoga', 'shivamogga', 'davanagere', 'ballari', 'bellary', 'kolar', 'hassan', 'mandya', 'chikkamagaluru']
tn_kw = ['tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'trichy', 'tiruchirappalli', 'salem', 'tirunelveli', 'tiruppur', 'erode', 'vellore', 'hosur', 'kanyakumari', 'ooty', 'udhagamandalam', 'dharmapuri', 'krishnagiri']

for city in vida_cities:
    c_name = city.get('cityName', '')
    s_name = city.get('stateName', '')
    for ch in city.get('chargingStations', []):
        sid = ch.get('stationId')
        item_id = f'VIDA_{sid}'
        if not sid or item_id in existing_ids:
            continue
        try:
            lat = float(ch.get('latitude', 0))
            lng = float(ch.get('longitude', 0))
        except:
            continue
        if not (6 <= lat <= 38 and 68 <= lng <= 98):
            continue

        st_name = (ch.get('stationName') or '').strip()
        addr = (ch.get('chargingStationAddress') or '').strip()
        clean_addr = addr.split(',')[0].strip()
        disp_name = f'Vida Grid Fast - {st_name or clean_addr or c_name}'

        text = f'{disp_name} {addr} {c_name} {s_name}'.lower()
        st = 'other'
        if any(k in text for k in kl_kw) or (8.15 <= lat <= 12.85 and 74.85 <= lng <= 77.40):
            st = 'kerala'
        elif any(k in text for k in ka_kw) or (11.55 <= lat <= 18.45 and 74.05 <= lng <= 77.75):
            st = 'karnataka'
        elif any(k in text for k in tn_kw) or (8.08 <= lat <= 13.50 and 76.25 <= lng <= 80.35):
            st = 'tamil_nadu'

        current.append({
            'id': item_id,
            'name': disp_name,
            'network': 'VIDA_GRID',
            'type': 'FAST',
            'state': st,
            'model_id': 'HERO_VIDA_FAST_LEVDC',
            'connector': 'Hero VIDA Official DC Fast Gun (IS 17017-2-7 / Type 7 LEV DC) ⚡',
            'is_ather_gun': True,
            'ather_compatibility': '100% Direct Plug-in (Official Hero VIDA Fast Gun)',
            'power_kw': 3.3,
            'lat': round(lat, 6),
            'lng': round(lng, 6),
            'address': addr if addr else f'Location in {c_name}, {s_name}',
            'source': 'Hero VIDA Official',
            'is_2w': True,
            'status': 'OPERATIONAL'
        })
        existing_ids.add(item_id)
        added_vida += 1

print(f'Added {added_vida} Hero VIDA stations. Total chargers: {len(current)}')

# Save chargers_db.json
with open('chargers_db.json', 'w', encoding='utf-8') as f:
    json.dump(current, f, indent=2, ensure_ascii=False)
print('Wrote chargers_db.json')

# Save chargers_db.js
with open('chargers_db.js', 'w', encoding='utf-8') as f:
    f.write('// VoltWay 2W - Pure 2-Wheeler Fast & Universal Chargers Database\n')
    f.write('// Includes Ather Grid Fast, Hero VIDA Grid Fast & Bolt.Earth 2W\n')
    f.write('window.BUNDLED_CHARGERS = ')
    json.dump(current, f, ensure_ascii=False)
    f.write(';\n')
print('Wrote chargers_db.js')
