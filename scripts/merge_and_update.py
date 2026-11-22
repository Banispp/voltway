"""
VoltWay 2W - Database Merge & Production Generator Script
Merges Ather Grid and Bolt.Earth datasets into chargers_db.json and chargers_db.js
"""

import json
import os

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ather_path = os.path.join(base_dir, 'ather_grid_chargers.json')
bolt_path = os.path.join(base_dir, 'bolt_chargers.json')
db_json_path = os.path.join(base_dir, 'chargers_db.json')
db_js_path = os.path.join(base_dir, 'chargers_db.js')

print("Generating unified production database...")

with open(ather_path, 'r', encoding='utf-8') as f:
    ather_data = json.load(f)

with open(bolt_path, 'r', encoding='utf-8') as f:
    bolt_data = json.load(f)

combined = ather_data + bolt_data
print(f"Total merged 2W chargers: {len(combined)}")

with open(db_json_path, 'w', encoding='utf-8') as f:
    json.dump(combined, f, ensure_ascii=False)

js_content = "window.BUNDLED_CHARGERS = " + json.dumps(combined, separators=(',', ':'), ensure_ascii=False) + ";"
with open(db_js_path, 'w', encoding='utf-8') as f:
    f.write(js_content)

print(f"Updated {db_json_path} ({os.path.getsize(db_json_path)} bytes)")
print(f"Updated {db_js_path} ({os.path.getsize(db_js_path)} bytes)")
print("Done!")
