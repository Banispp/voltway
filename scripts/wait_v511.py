import urllib.request
import json
import time
import os

API_RUNS = "https://api.github.com/repos/Banispp/voltway/actions/runs?per_page=5"
RELEASE_URL = "https://github.com/Banispp/voltway/releases/download/v5.11-release/app-debug.apk"
OUTPUT_APK = "VoltWay.apk"

print("[VoltWay v5.11] Monitoring GitHub Actions build for v5.11...")

def get_latest_build_run():
    req = urllib.request.Request(API_RUNS, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            for run in data.get('workflow_runs', []):
                if 'Build VoltWay Android APK' in run.get('name', ''):
                    return run
    except Exception as e:
        print("[VoltWay Poll Error]", e)
    return None

start_time = time.time()
target_run_id = None

while time.time() - start_time < 600:
    run = get_latest_build_run()
    if run:
        target_run_id = run['id']
        status = run['status']
        conclusion = run['conclusion']
        print(f"[VoltWay Actions] Run #{target_run_id} status: {status}, conclusion: {conclusion}")
        if status == 'completed':
            if conclusion == 'success':
                print("[VoltWay Actions] Build succeeded! Fetching released APK...")
                break
            else:
                print(f"[VoltWay Actions] Build ended with conclusion: {conclusion}")
                break
    time.sleep(12)

# Download release APK
print("[VoltWay v5.11] Downloading VoltWay.apk from GitHub Release...")
download_success = False
for attempt in range(12):
    try:
        req = urllib.request.Request(RELEASE_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            content = r.read()
            if len(content) > 1000000:
                with open(OUTPUT_APK, 'wb') as f:
                    f.write(content)
                size_mb = len(content) / (1024 * 1024)
                print(f"[VoltWay v5.11] Successfully downloaded {OUTPUT_APK} ({size_mb:.2f} MB, {len(content)} bytes)!")
                download_success = True
                break
    except Exception as e:
        print(f"[VoltWay Download Attempt {attempt + 1}] Waiting for release asset to publish... ({e})")
        time.sleep(8)

if not download_success:
    print("[VoltWay v5.11] Could not download release asset automatically. Will verify.")
