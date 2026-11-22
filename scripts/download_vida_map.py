import urllib.request
import gzip
import json

urls = [
    'https://www.vidaworld.com/content/dam/vida/map/map.json.gzip',
    'https://www.vidaworld.com/content/dam/vida/map/map.json'
]

for url in urls:
    print("Trying:", url)
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept-Encoding': 'gzip, deflate'
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            print(f"Downloaded {len(data)} bytes")
            # Decompress if gzipped
            try:
                decompressed = gzip.decompress(data)
                print(f"Decompressed to {len(decompressed)} bytes")
                json_data = json.loads(decompressed.decode('utf-8'))
            except Exception as ge:
                json_data = json.loads(data.decode('utf-8'))

            print("JSON loaded successfully! Type:", type(json_data))
            if isinstance(json_data, dict):
                print("Keys:", list(json_data.keys()))
                for k in json_data.keys():
                    val = json_data[k]
                    if isinstance(val, list):
                        print(f"Key '{k}' has {len(val)} items")
                        if len(val) > 0:
                            print(f"  Sample item in '{k}':", json.dumps(val[0], indent=2)[:500])
            elif isinstance(json_data, list):
                print(f"List with {len(json_data)} items")
                if len(json_data) > 0:
                    print("Sample item:", json.dumps(json_data[0], indent=2)[:500])

            # Save json
            with open('scripts/vida_map_raw.json', 'w', encoding='utf-8') as f:
                json.dump(json_data, f, indent=2)
            print("Saved scripts/vida_map_raw.json")
            break
    except Exception as e:
        print("Failed:", e)
