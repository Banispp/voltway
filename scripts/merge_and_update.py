"""
VoltWay 2W - Database Merge & Production Generator Script
Merges Ather Grid, Hero VIDA Grid, and Bolt.Earth datasets into chargers_db.json and chargers_db.js
"""

import json
import os

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ather_path = os.path.join(base_dir, 'ather_grid_chargers.json')
bolt_path = os.path.join(base_dir, 'bolt_chargers.json')
vida_path = os.path.join(base_dir, 'vida_chargers.json')
db_json_path = os.path.join(base_dir, 'chargers_db.json')
db_js_path = os.path.join(base_dir, 'chargers_db.js')

print("Generating unified production database...")

ather_data = []
if os.path.exists(ather_path):
    with open(ather_path, 'r', encoding='utf-8') as f:
        ather_data = json.load(f)

bolt_data = []
if os.path.exists(bolt_path):
    with open(bolt_path, 'r', encoding='utf-8') as f:
        bolt_data = json.load(f)

vida_data = []
if os.path.exists(vida_path):
    with open(vida_path, 'r', encoding='utf-8') as f:
        vida_data = json.load(f)

# Ensure state tag is assigned on any item missing it
kl_kw = ['kerala', 'malappuram', 'kozhikode', 'ernakulam', 'kochi', 'cochin', 'thrissur', 'trivandrum', 'thiruvananthapuram', 'kollam', 'alappuzha', 'alleppey', 'kottayam', 'palakkad', 'kannur', 'kasaragod', 'wayanad', 'idukki', 'pathanamthitta']
ka_kw = ['karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubli', 'hubballi', 'dharwad', 'belagavi', 'belgaum', 'udupi', 'manipal', 'tumkur', 'tumakuru', 'shimoga', 'shivamogga', 'davanagere', 'ballari', 'bellary', 'kolar', 'hassan', 'mandya', 'chikkamagaluru']
tn_kw = ['tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'trichy', 'tiruchirappalli', 'salem', 'tirunelveli', 'tiruppur', 'erode', 'vellore', 'hosur', 'kanyakumari', 'ooty', 'udhagamandalam', 'dharmapuri', 'krishnagiri']

seen_ids = set()
combined = []

for c in ather_data + vida_data + bolt_data:
    cid = c.get('id')
    if not cid or cid in seen_ids:
        continue
    seen_ids.add(cid)
    
    if not c.get('state'):
        lat = c.get('lat', 0)
        lng = c.get('lng', 0)
        text = f"{c.get('name', '')} {c.get('address', '')}".lower()
        st = 'other'
        if any(k in text for k in kl_kw) or (8.15 <= lat <= 12.85 and 74.85 <= lng <= 77.40):
            st = 'kerala'
        elif any(k in text for k in ka_kw) or (11.55 <= lat <= 18.45 and 74.05 <= lng <= 77.75):
            st = 'karnataka'
        elif any(k in text for k in tn_kw) or (8.08 <= lat <= 13.50 and 76.25 <= lng <= 80.35):
            st = 'tamil_nadu'
        c['state'] = st

    combined.append(c)

print(f"Total merged 2W chargers: {len(combined)}")

with open(db_json_path, 'w', encoding='utf-8') as f:
    json.dump(combined, f, indent=2, ensure_ascii=False)

js_content = "// VoltWay 2W - Pure 2-Wheeler Fast & Universal Chargers Database\nwindow.BUNDLED_CHARGERS = " + json.dumps(combined, separators=(',', ':'), ensure_ascii=False) + ";\n"
with open(db_js_path, 'w', encoding='utf-8') as f:
    f.write(js_content)

print(f"Updated {db_json_path} ({os.path.getsize(db_json_path)} bytes)")
print(f"Updated {db_js_path} ({os.path.getsize(db_js_path)} bytes)")
print("Done!")
