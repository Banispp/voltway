import urllib.request
import re

url = 'https://www.vidaworld.com/etc.clientlibs/vida/clientlibs/clientlib-site.lc-2e92123b6a3d40a46e4f6a4d19f2b91f-lc.min.js'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req, timeout=12) as resp:
        js_text = resp.read().decode('utf-8')
        print(f"Downloaded clientlib-site JS: {len(js_text)} bytes")

        # Search for chargingStations and atherChargingStations
        for kw in ['chargingStations', 'atherChargingStations', 'swappingStations', 'map.json']:
            matches = [m.start() for m in re.finditer(re.escape(kw), js_text)]
            print(f"Found '{kw}' {len(matches)} times")
            for pos in matches[:2]:
                print(f"  Context around {kw}:", js_text[max(0, pos-100):min(len(js_text), pos+200)])
except Exception as e:
    print("Error:", e)
