import json

with open('scripts/vida_map_raw.json', 'r', encoding='utf-8') as f:
    cities = json.load(f)

print(f"Total cities: {len(cities)}")
first = cities[0]
print("City keys:", list(first.keys()))

# Check for charging stations in cities
total_chargers = 0
charger_samples = []
charger_networks = set()
charger_types = set()

for c in cities:
    # check keys
    for k in c.keys():
        if 'charg' in k.lower() or 'station' in k.lower():
            chargers = c.get(k, [])
            total_chargers += len(chargers)
            for ch in chargers:
                charger_types.add(ch.get('type', ''))
                # check network or provider or brand
                for nk in ['network', 'partner', 'provider', 'brand', 'operator', 'source', 'type', 'chargerType', 'vendor']:
                    if nk in ch:
                        charger_networks.add(f"{nk}:{ch[nk]}")
                if len(charger_samples) < 5:
                    charger_samples.append((k, ch))

print(f"Total chargers found across all cities: {total_chargers}")
print("Charger types:", charger_types)
print("Charger networks/fields:", charger_networks)

for k, ch in charger_samples:
    print(f"\n--- Sample from '{k}' ---")
    print(json.dumps(ch, indent=2))
