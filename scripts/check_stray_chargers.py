import json
import re

with open('chargers_db.json', 'r', encoding='utf-8') as f:
    db = json.load(f)

print(f"Total entries in db: {len(db)}")

out_of_bounds = []
by_detected_state = {}

for c in db:
    addr = (c.get('address') or '').lower()
    name = (c.get('name') or '').lower()
    lat = c.get('lat', 0)
    lng = c.get('lng', 0)
    cid = c.get('id', '')

    text = f"{addr} {name}"

    detected = 'Unknown'
    if any(k in text for k in ['kerala', 'ernakulam', 'kochi', 'trivandrum', 'thiruvananthapuram', 'kozhikode', 'calicut', 'thrissur', 'kannur', 'kollam', 'palakkad', 'alappuzha', 'kottayam', 'malappuram', 'kasaragod', 'pathanamthitta', 'wayanad', 'idukki']):
        detected = 'Kerala'
    elif any(k in text for k in ['tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'salem', 'tirunelveli', 'trichy', 'tiruchirappalli', 'erode', 'tiruppur', 'vellore', 'hosur', 'kanyakumari', 'thanjavur', 'dindigul', 'ranipet', 'kanchipuram']):
        detected = 'Tamil Nadu'
    elif any(k in text for k in ['karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'udupi', 'manipal', 'hubballi', 'hubli', 'belagavi', 'belgaum', 'tumakuru', 'tumkur', 'dharwad', 'shivamogga', 'shimoga', 'ballari', 'bellary', 'davangere', 'hassan']):
        detected = 'Karnataka'
    elif any(k in text for k in ['puducherry', 'pondicherry', 'mahe', 'karaikal', 'yanam']):
        detected = 'Puducherry'
    elif any(k in text for k in ['telangana', 'hyderabad', 'secunderabad', 'warangal']):
        detected = 'Telangana'
    elif any(k in text for k in ['andhra', 'vijayawada', 'visakhapatnam', 'vizag', 'tirupati', 'guntur', 'nellore', 'kurnool', 'rajahmundry', 'kakinada', 'anantapur']):
        detected = 'Andhra Pradesh'
    elif any(k in text for k in ['maharashtra', 'mumbai', 'pune', 'nagpur', 'thane', 'nashik', 'kolhapur']):
        detected = 'Maharashtra'
    elif any(k in text for k in ['goa', 'panaji', 'margao']):
        detected = 'Goa'

    by_detected_state[detected] = by_detected_state.get(detected, 0) + 1
    if detected in ['Telangana', 'Andhra Pradesh', 'Maharashtra', 'Goa', 'Unknown']:
        out_of_bounds.append((c, detected))

print("Detected breakdown by state:")
for st, cnt in sorted(by_detected_state.items(), key=lambda x: -x[1]):
    print(f"  {st}: {cnt}")

print(f"\nTotal chargers flagged as non-(KL/TN/KA/PY): {len(out_of_bounds)}")
for c, st in out_of_bounds[:15]:
    print(f"  [{st}] {c['id']} | {c['name']} | Lat: {c['lat']}, Lng: {c['lng']} | Addr: {c.get('address')[:60]}")
