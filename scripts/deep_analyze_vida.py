import json

with open('scripts/vida_map_raw.json', 'r', encoding='utf-8') as f:
    cities = json.load(f)

vida_chargers = {}
ather_chargers = {}
swapping_stations = {}

for c in cities:
    city_name = c.get('cityName', '')
    state_name = c.get('stateName', '')

    for ch in c.get('chargingStations', []):
        sid = ch.get('stationId')
        if sid:
            ch['cityName'] = city_name
            ch['stateName'] = state_name
            vida_chargers[sid] = ch

    for ch in c.get('atherChargingStations', []):
        sid = ch.get('stationId')
        if sid:
            ch['cityName'] = city_name
            ch['stateName'] = state_name
            ather_chargers[sid] = ch

    for ch in c.get('swappingStations', []):
        sid = ch.get('stationId')
        if sid:
            ch['cityName'] = city_name
            ch['stateName'] = state_name
            swapping_stations[sid] = ch

print("UNIQUE COUNTS IN VIDA OFFICIAL DATABASE:")
print(f"  • Unique Vida Charging Stations (chargingStations) : {len(vida_chargers)}")
print(f"  • Unique Ather Stations in Vida (atherStations)    : {len(ather_chargers)}")
print(f"  • Unique Swapping Stations                         : {len(swapping_stations)}")

# Check Kerala Vida chargers
kerala_vida = []
for sid, ch in vida_chargers.items():
    try:
        lat = float(ch.get('latitude', 0))
        lng = float(ch.get('longitude', 0))
        state = ch.get('stateName', '').lower()
        if 'kerala' in state or (8.15 <= lat <= 12.85 and 74.85 <= lng <= 77.45):
            kerala_vida.append(ch)
    except:
        pass

print(f"\nVida Chargers in Kerala: {len(kerala_vida)}")
for ch in kerala_vida[:10]:
    print(f"  ID: {ch['stationId']} | {ch['stationName']} | Lat: {ch['latitude']}, Lng: {ch['longitude']}")
    print(f"    Addr: {ch['chargingStationAddress'][:60]}")
