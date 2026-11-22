import json
import os
import sys

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Load Vida Map
with open(os.path.join(BASE_DIR, 'scripts', 'vida_map_raw.json'), 'r', encoding='utf-8') as f:
    vida_cities = json.load(f)

# Load Ather Grid
with open(os.path.join(BASE_DIR, 'ather_grid_chargers.json'), 'r', encoding='utf-8') as f:
    ather_data = json.load(f)

# Load Bolt Earth
with open(os.path.join(BASE_DIR, 'bolt_chargers.json'), 'r', encoding='utf-8') as f:
    bolt_data = json.load(f)

TARGET_STATES = ['kerala', 'tamil nadu', 'karnataka', 'puducherry', 'pondicherry', 'mahe']

def is_in_target_region(lat, lng, state='', addr=''):
    try:
        lat = float(lat)
        lng = float(lng)
    except:
        return False

    # Check bounding box
    in_box = (8.00 <= lat <= 18.55 and 74.00 <= lng <= 80.40)
    
    # Text match
    full_text = f"{state} {addr}".lower()
    has_state_name = any(s in full_text for s in TARGET_STATES)

    # Exclude other states if coordinate happens to touch border
    excluded_states = ['andhra', 'telangana', 'maharashtra', 'goa', 'odisha', 'madhya pradesh', 'gujarat']
    is_excluded = any(ex in full_text for ex in excluded_states)

    if has_state_name and not is_excluded:
        return True
    if in_box and not is_excluded:
        return True
    return False

# 1. Vida Stations (chargingStations only - 100% Vida Fast)
vida_target = {}
for c in vida_cities:
    c_name = c.get('cityName', '')
    s_name = c.get('stateName', '')
    for ch in c.get('chargingStations', []):
        sid = ch.get('stationId')
        if not sid or sid in vida_target:
            continue
        lat = ch.get('latitude')
        lng = ch.get('longitude')
        addr = ch.get('chargingStationAddress') or ''
        if is_in_target_region(lat, lng, s_name, addr):
            clean_addr = addr.split(',')[0].strip()
            name_label = f"Vida Grid Fast - {ch.get('stationName') or clean_addr}"
            vida_target[sid] = {
                'id': f"VIDA_{sid}",
                'name': name_label,
                'network': 'VIDA_GRID',
                'type': 'FAST',
                'model_id': 'VIDA_FAST_LEVDC',
                'connector': 'Hero VIDA Official DC Fast Gun (IS 17017-2-7 / Type 7 LEV DC) ⚡',
                'is_ather_gun': True,
                'ather_compatibility': '100% Direct Plug-in (Official Hero VIDA Fast Gun)',
                'power_kw': 3.3,
                'lat': round(float(lat), 6),
                'lng': round(float(lng), 6),
                'address': addr.strip(),
                'source': 'Hero VIDA Official',
                'is_2w': True,
                'status': 'OPERATIONAL'
            }

# 2. Ather Grid Stations (FAST)
ather_target = {}
for a in ather_data:
    aid = a.get('id')
    lat = a.get('lat')
    lng = a.get('lng')
    addr = a.get('address') or ''
    state = a.get('state') or ''
    if is_in_target_region(lat, lng, state, addr):
        ather_target[aid] = {
            'id': aid,
            'name': a.get('name') or f"Ather Grid Fast Charger - {aid}",
            'network': 'ATHER_GRID',
            'type': 'FAST',
            'model_id': 'ATHER_GRID_FAST_DC',
            'connector': 'Ather Grid Official DC Fast Gun (IS 17017-2-7 / Type 7) ⚡',
            'is_ather_gun': True,
            'ather_compatibility': '100% Direct Plug-in (Official Ather Grid Gun)',
            'power_kw': 3.3,
            'lat': round(float(lat), 6),
            'lng': round(float(lng), 6),
            'address': addr.strip(),
            'source': 'Ather Grid Official',
            'is_2w': True,
            'status': 'OPERATIONAL'
        }

# 3. Bolt.Earth Stations (Pure 2W - FAST & SLOW)
bolt_fast_target = {}
bolt_slow_target = {}
for b in bolt_data:
    bid = b.get('id')
    lat = b.get('lat')
    lng = b.get('lng')
    addr = b.get('address') or ''
    state = b.get('state') or ''
    if is_in_target_region(lat, lng, state, addr):
        if b.get('type') == 'FAST':
            bolt_fast_target[bid] = b
        else:
            bolt_slow_target[bid] = b

print("=" * 72)
print("REGIONAL TARGET STATS (Kerala + Tamil Nadu + Karnataka + Puducherry):")
print(f"  • Ather Grid Fast Chargers (Official)        : {len(ather_target)}")
print(f"  • Hero VIDA Grid Fast Chargers (Official)    : {len(vida_target)}")
print(f"  • Bolt.Earth 2W Fast Chargers (Ather Gun ⚡)  : {len(bolt_fast_target)}")
print(f"  • Bolt.Earth 15A Sockets (Universal 2W)      : {len(bolt_slow_target)}")
print("  ----------------------------------------------------------------------")
total_fast = len(ather_target) + len(vida_target) + len(bolt_fast_target)
total_all = total_fast + len(bolt_slow_target)
print(f"  • TOTAL 2W FAST CHARGERS (Ather Gun ⚡)      : {total_fast}")
print(f"  • TOTAL ALL 2W CHARGING STATIONS             : {total_all}")
print("=" * 72)
