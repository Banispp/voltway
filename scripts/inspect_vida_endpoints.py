import re

with open('scripts/vida_page.html', 'r', encoding='utf-8') as f:
    text = f.read()

matches = re.findall(r'"([^"]*(?:charging|station|locator)[^"]*)"', text, re.I)
print(f"Total matches: {len(matches)}")
unique_matches = sorted(list(set(matches)))
for m in unique_matches[:40]:
    if any(k in m for k in ['http', '.json', 'api', 'graphql', 'content']):
        print("  Endpoint/File:", m)
