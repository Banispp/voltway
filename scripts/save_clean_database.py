import json
from verify_purge_leaks import is_strictly_south_target_final

with open('chargers_db.json', 'r', encoding='utf-8') as f:
    raw = json.load(f)

clean_chargers = [c for c in raw if is_strictly_south_target_final(c)[0]]

print(f"Writing {len(clean_chargers)} chargers to chargers_db.json and chargers_db.js...")

with open('chargers_db.json', 'w', encoding='utf-8') as f:
    json.dump(clean_chargers, f, indent=2, ensure_ascii=False)

with open('chargers_db.js', 'w', encoding='utf-8') as f:
    f.write('window.BUNDLED_CHARGERS = ' + json.dumps(clean_chargers, ensure_ascii=False) + ';\n')

print("Files saved successfully!")
