import json

with open('bolt_chargers.json', 'r', encoding='utf-8') as f:
    chargers = json.load(f)

fast_chargers = [c for c in chargers if c.get('type') == 'FAST']
print('Total Fast in bolt_chargers.json:', len(fast_chargers))

ids = [c['id'] for c in fast_chargers]
print('Prefixes of Fast IDs:')
from collections import Counter
prefixes = Counter(i[:4] for i in ids)
print(prefixes.most_common(20))
