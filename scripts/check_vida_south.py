import json

with open('scripts/vida_map_raw.json', 'r', encoding='utf-8') as f:
    cities = json.load(f)

# States: Kerala, Tamil Nadu, Karnataka, Puducherry
target_states = ['kerala', 'tamil nadu', 'karnataka', 'puducherry', 'pondicherry']

south_vida = []
all_vida = {}

for c in cities:
    c_name = c.get('cityName', '')
    s_name = c.get('stateName', '')
    s_lower = s_name.lower().strip()

    for ch in c.get('chargingStations', []):
        sid = ch.get('stationId')
        if not sid or sid in all_vida:
            continue

        try:
            lat = float(ch.get('latitude', 0))
            lng = float(ch.get('longitude', 0))
        except:
            continue

        if not (6 <= lat <= 38 and 68 <= lng <= 98):
            continue

        is_target_state = any(ts in s_lower for ts in target_states)
        is_target_coord = (8.05 <= lat <= 18.50 and 74.00 <= lng <= 80.50)

        # Also check address
        addr_lower = (ch.get('chargingStationAddress') or '').lower()
        addr_target = any(ts in addr_lower for ts in target_states)

        ch_obj = {
            'stationId': sid,
            'stationName': ch.get('stationName', '').strip(),
            'address': (ch.get('chargingStationAddress') or '').strip(),
            'latitude': lat,
            'longitude': lng,
            'cityName': c_name,
            'stateName': s_name,
            'is_south': is_target_state or is_target_coord or addr_target
        }
        all_vida[sid] = ch_obj
        if ch_obj['is_south']:
            south_vida.append(ch_obj)

print(f"Total Unique Vida Stations (chargingStations) in India: {len(all_vida)}")
print(f"Total Vida Stations in KL, TN, KA, PY (South India): {len(south_vida)}")

# Breakdown by state
by_state = {}
for ch in south_vida:
    st = ch['stateName'] or 'Unknown'
    by_state[st] = by_state.get(st, 0) + 1

print("Breakdown by state:")
for st, cnt in by_state.items():
    print(f"  {st}: {cnt}")

print("\nSample stations:")
for ch in south_vida[:5]:
    print(f"  ID: {ch['stationId']} | {ch['stationName']} | {ch['cityName']}, {ch['stateName']} | Lat: {ch['latitude']}, Lng: {ch['longitude']}")
    print(f"    Addr: {ch['address'][:70]}")
