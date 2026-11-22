import re
import json

def verify():
    # 1. Check index.html text
    with open('index.html', 'r', encoding='utf-8') as f:
        html = f.read()

    # Verify no Malayalam in buttons / badges
    malayalam_in_html = re.findall(r'[\u0D00-\u0D7F]', html)
    print(f"Malayalam characters in index.html: {len(malayalam_in_html)} (should be 0)")
    assert len(malayalam_in_html) == 0, "Found unexpected Malayalam in index.html"

    # Verify no 'e.g.' in index.html or js/app.js
    assert 'e.g.' not in html, "Found 'e.g.' in index.html"
    
    with open('js/app.js', 'r', encoding='utf-8') as f:
        app_js = f.read()
    malayalam_in_js = re.findall(r'[\u0D00-\u0D7F]', app_js)
    print(f"Malayalam characters in js/app.js: {len(malayalam_in_js)} (should be 0)")
    assert len(malayalam_in_js) == 0, "Found unexpected Malayalam in js/app.js"
    assert 'e.g.' not in app_js, "Found 'e.g.' in js/app.js"

    # 2. Check chargers_db.json
    with open('chargers_db.json', 'r', encoding='utf-8') as f:
        chargers = json.load(f)
    print(f"Total chargers in chargers_db.json: {len(chargers)}")
    assert len(chargers) == 2958, f"Expected 2958 chargers, got {len(chargers)}"

    ather = [c for c in chargers if c.get('network') == 'ATHER_GRID']
    vida = [c for c in chargers if c.get('network') == 'VIDA_GRID']
    bolt_fast = [c for c in chargers if c.get('network') == 'BOLT_EARTH' and c.get('type') == 'FAST']
    bolt_slow = [c for c in chargers if c.get('network') == 'BOLT_EARTH' and c.get('type') == 'SLOW']

    print(f"Ather Fast: {len(ather)} (expected 1331)")
    print(f"VIDA Fast: {len(vida)} (expected 149)")
    print(f"Bolt Fast: {len(bolt_fast)} (expected 281)")
    print(f"Bolt Slow: {len(bolt_slow)} (expected 1197)")
    total_fast = len(ather) + len(vida) + len(bolt_fast)
    print(f"Total Fast (Ather Gun): {total_fast} (expected 1761)")

    assert len(ather) == 1331
    assert len(vida) == 149
    assert len(bolt_fast) == 281
    assert len(bolt_slow) == 1197
    assert total_fast == 1761

    # 3. Check chargers_db.js
    with open('chargers_db.js', 'r', encoding='utf-8') as f:
        db_js = f.read()
    assert 'window.BUNDLED_CHARGERS = [' in db_js
    print("chargers_db.js syntax OK")

    print("\nALL VERIFICATIONS PASSED SUCCESSFULLY!")

if __name__ == '__main__':
    verify()
