import subprocess
import time
import json
import os

# Use msedge headless to dump DOM or evaluate JS
def test_with_edge():
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    edge_exe = None
    for p in edge_paths:
        if os.path.exists(p):
            edge_exe = p
            break
            
    if not edge_exe:
        print("Edge binary not found, checking alternatives")
        return

    out_file = os.path.abspath("scripts/dom_output.html")
    cmd = [
        edge_exe,
        "--headless",
        "--disable-gpu",
        "--dump-dom",
        "--virtual-time-budget=5000",
        "http://localhost:8080"
    ]
    print(f"Running: {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    dom = res.stdout
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write(dom)
    print(f"DOM length: {len(dom)} characters")

    # Inspect key elements
    import re
    def get_text(elem_id):
        m = re.search(r'id=["\']' + elem_id + r'["\'][^>]*>(.*?)<', dom)
        return m.group(1).strip() if m else "NOT_FOUND"

    checks = {
        'count-fast-only': get_text('count-fast-only'),
        'count-ather-fast': get_text('count-ather-fast'),
        'count-vida-fast': get_text('count-vida-fast'),
        'count-bolt-fast': get_text('count-bolt-fast'),
        'count-bolt-slow': get_text('count-bolt-slow'),
        'header-station-count': get_text('header-station-count'),
        'sync-total-chargers': get_text('sync-total-chargers'),
        'modal-ather-count': get_text('modal-ather-count'),
        'modal-vida-count': get_text('modal-vida-count'),
        'modal-bolt-fast-count': get_text('modal-bolt-fast-count'),
        'modal-bolt-slow-count': get_text('modal-bolt-slow-count'),
    }

    print("\nLive Rendered Element Counts:")
    for k, v in checks.items():
        print(f"  {k}: {v}")

    assert checks['count-fast-only'] in ['1,764', '1764'], f"Expected 1,764, got {checks['count-fast-only']}"
    assert checks['count-ather-fast'] in ['1,332', '1332'], f"Expected 1,332, got {checks['count-ather-fast']}"
    assert checks['count-vida-fast'] in ['150'], f"Expected 150, got {checks['count-vida-fast']}"
    assert checks['count-bolt-fast'] in ['282'], f"Expected 282, got {checks['count-bolt-fast']}"
    assert checks['count-bolt-slow'] in ['1,198', '1198'], f"Expected 1,198, got {checks['count-bolt-slow']}"
    assert checks['header-station-count'] in ['2,962', '2962'], f"Expected 2,962, got {checks['header-station-count']}"

    print("\nLIVE HEADLESS DOM VERIFICATION PASSED PERFECTLY!")

if __name__ == '__main__':
    test_with_edge()
