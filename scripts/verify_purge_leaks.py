import json
import re

def is_strictly_south_target_final(c):
    lat = float(c['lat'])
    lng = float(c['lng'])

    # 1. Strict South India coordinate boundaries
    # KL, TN, KA, PY are completely within [8.05, 18.55] lat and [74.00, 80.40] lng.
    if lat < 8.05 or lat > 18.55 or lng < 74.00 or lng > 80.40:
        return False, "Out of South India bounding box"

    name = c.get('name', '')
    addr = c.get('address', '')
    text = f"{name} {addr}".lower()

    # Exclude false negative for restaurants or roads:
    safe_text = text
    safe_text = safe_text.replace('anantapuram vari', 'restaurant')
    safe_text = safe_text.replace('pune bangalore', 'highway')
    safe_text = safe_text.replace('pune-bangalore', 'highway')
    safe_text = safe_text.replace('goa main road', 'road')
    safe_text = safe_text.replace('goa road', 'road')
    safe_text = safe_text.replace('maharashtra bank', 'bank')

    # 2. Excluded state indicators (negative keywords)
    is_telangana = any(k in safe_text for k in ['telangana', 'hyderabad', 'secunderabad', 'warangal'])
    is_andhra = any(k in safe_text for k in ['andhra', 'andhra pradesh', 'anantapur', 'chittoor', 'tirupati', 'vijayawada', 'visakhapatnam', 'vizag', 'guntur', 'nellore', 'kurnool'])
    is_maharashtra = any(k in safe_text for k in ['maharashtra', 'mumbai', 'pune', 'nagpur', 'nashik', 'sangli', 'kolhapur', 'dharashiv', 'solapur', 'satara']) and not ('bank' in safe_text)
    is_goa = any(k in safe_text for k in ['curchorem', 'canacona', 'margao', 'panaji', 'mapusa', 'quepem', 'zambaulim']) or (bool(re.search(r'\bgoa\b', safe_text)) and not ('road' in safe_text or 'highway' in safe_text or 'hwy' in safe_text))
    is_north = any(bool(re.search(rf'\b{k}\b', safe_text)) for k in ['delhi', 'noida', 'gurgaon', 'gurugram', 'haryana', 'punjab', 'rajasthan', 'gujarat', 'uttar pradesh', 'bhopal', 'indore', 'bihar', 'bengal', 'aizawl', 'mizoram', 'assam'])

    if is_telangana or is_andhra or is_maharashtra or is_goa or is_north:
        return False, "Negative state detected"

    # 3. Positive state indicators
    is_kl = any(k in safe_text for k in ['kerala', 'malappuram', 'kozhikode', 'ernakulam', 'kochi', 'thrissur', 'trivandrum', 'thiruvananthapuram', 'kollam', 'alappuzha', 'kottayam', 'palakkad', 'kannur', 'kasaragod', 'wayanad', 'idukki', 'pathanamthitta'])
    is_tn = any(k in safe_text for k in ['tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'trichy', 'tiruchirappalli', 'salem', 'tirunelveli', 'tiruppur', 'erode', 'vellore', 'hosur', 'kanyakumari', 'ooty', 'udhagamandalam', 'dharmapuri', 'krishnagiri'])
    is_ka = any(k in safe_text for k in [
        'karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 
        'hubli', 'hubballi', 'dharwad', 'belagavi', 'belgaum', 'udupi', 'manipal', 'tumkur', 
        'tumakuru', 'shimoga', 'shivamogga', 'davanagere', 'ballari', 'bellary', 'kolar', 
        'hassan', 'mandya', 'chikkamagaluru', 'raichur', 'bidar', 'kalaburagi', 'gulbarga', 
        'jewargi', 'badami', 'bagalkot', 'bagalkote', 'yadgir', 'yadgiri', 'vijayapura', 
        'bijapur', 'ilkal', 'kerur', 'bagepalli', 'kudatini'
    ])
    is_py = any(k in safe_text for k in ['puducherry', 'pondicherry', 'mahe', 'karaikal'])

    if is_kl or is_tn or is_ka or is_py:
        return True, "Positive state verified"

    # Geo fallbacks:
    if (8.15 <= lat <= 12.85) and (74.85 <= lng <= 77.40):
        return True, 'KL-Geo'
    if (8.08 <= lat <= 13.50) and (76.25 <= lng <= 80.35) and not (lat > 13.35 and lng > 79.75):
        return True, 'TN-Geo'
    if (11.55 <= lat <= 18.45) and (74.05 <= lng <= 77.75):
        return True, 'KA-Geo'

    return False, "Outside target"

with open('chargers_db.json', 'r', encoding='utf-8') as f:
    raw = json.load(f)

accepted = []
rejected = []

for c in raw:
    ok, r = is_strictly_south_target_final(c)
    if ok:
        accepted.append(c)
    else:
        rejected.append((c, r))

print(f"Total accepted: {len(accepted)}")
print(f"Total rejected: {len(rejected)}")
print("\nRejected breakdown:")
for c, r in rejected:
    print(f"  [{c['id']}] {c['name']} | Addr: {c.get('address')} | lat={c['lat']}, lng={c['lng']} | {r}")

ather = [c for c in accepted if c.get('network') == 'ATHER_GRID']
vida = [c for c in accepted if c.get('network') == 'VIDA_GRID']
bolt_fast = [c for c in accepted if c.get('network') == 'BOLT_EARTH' and c.get('type') == 'FAST']
bolt_slow = [c for c in accepted if c.get('network') == 'BOLT_EARTH' and c.get('type') == 'SLOW']

print(f"\nFinal Verified 100% KL+TN+KA+PY Database:")
print(f"  Ather Grid Fast: {len(ather)}")
print(f"  Hero VIDA Fast:  {len(vida)}")
print(f"  Bolt.Earth Fast: {len(bolt_fast)}")
print(f"  Bolt.Earth 15A:  {len(bolt_slow)}")
print(f"  Total Fast:      {len(ather) + len(vida) + len(bolt_fast)}")
print(f"  Total Chargers:  {len(accepted)}")
