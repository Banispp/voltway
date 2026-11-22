import urllib.request
import re

url = 'https://www.vidaworld.com/charging-locator.html'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})

resp = urllib.request.urlopen(req, timeout=12)
text = resp.read().decode('utf-8')
with open('scripts/vida_page.html', 'w', encoding='utf-8') as f:
    f.write(text)

print(f"Downloaded {len(text)} bytes")

scripts = re.findall(r'<script[^>]*src=["\']([^"\']+)["\']', text)
print("Scripts:")
for s in scripts:
    print(" ", s)

print("\nKeywords in HTML:")
for kw in ['mapmyindia', 'mappls', 'google', 'charger', 'locator', 'station', 'ather', 'api', 'endpoint', 'fetch']:
    matches = re.findall(r'.{0,50}' + kw + r'.{0,50}', text, re.I)
    print(f"Keyword '{kw}' matches: {len(matches)}")
    for m in matches[:3]:
        print("   ", m.strip().replace('\n', ' '))
