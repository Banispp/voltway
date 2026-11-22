import urllib.request
import json
import time

def scan_kerala_seamless():
    lat_min, lat_max = 8.15, 12.85
    lng_min, lng_max = 74.85, 77.45
    step_lat = 0.28
    step_lng = 0.28

    cells = []
    lat = lat_min
    while lat < lat_max:
        lat_top = min(lat + step_lat, lat_max)
        lng = lng_min
        while lng < lng_max:
            lng_right = min(lng + step_lng, lng_max)
            cells.append((round(lat, 4), round(lng, 4), round(lat_top, 4), round(lng_right, 4)))
            lng += step_lng
        lat += step_lat

    print(f"Generated {len(cells)} seamless contiguous cells for 100% of Kerala (Zero Gaps)")

    all_chargers = {}
    l1dc_found = {}

    for idx, (b, l, t, r) in enumerate(cells[:15]): # test first 15
        url = f"https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom={b}&lng_left={l}&lat_top={t}&lng_right={r}&zoom=16"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode())
                for item in data.get('data', []):
                    cid = item.get('chargerId')
                    if cid:
                        all_chargers[cid] = item
                        if str(cid).upper().startswith('L1DC') or '2WFC' in str(item.get('model', {}).get('modelId', '')):
                            l1dc_found[cid] = item
            time.sleep(0.3)
        except Exception as e:
            print(f"Cell {idx} error:", e)

    print(f"In first 15 cells: total {len(all_chargers)} chargers, 2W Fast L1DC/2WFC: {len(l1dc_found)}")
    for cid, item in list(l1dc_found.items())[:10]:
        print("  ", cid, item.get('station', {}).get('address')[:40])

scan_kerala_seamless()
