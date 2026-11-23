import urllib.request
import json
import time
import os

API_RUNS = "https://api.github.com/repos/Banispp/voltway/actions/runs?per_page=5"
RELEASE_URL = "https://github.com/Banispp/voltway/releases/download/v5.14-release/app-debug.apk"
OUTPUT_APK = "VoltWay.apk"

print("[VoltWay v5.14] Monitoring GitHub Actions build for v5.14...", flush=True)

def get_latest_build_run():
    req = urllib.request.Request(API_RUNS, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            for run in data.get('workflow_runs', []):
                if 'Build VoltWay Android APK' in run.get('name', ''):
                    return run
    except Exception as e:
        print("[VoltWay Poll Error]", e, flush=True)
    return None

start_time = time.time()
target_run_id = None

while time.time() - start_time < 600:
    run = get_latest_build_run()
    if run:
        target_run_id = run['id']
        status = run['status']
        conclusion = run['conclusion']
        head_commit = run.get('head_commit', {}).get('message', '')[:60]
        print(f"[VoltWay Actions] Run #{target_run_id} ({head_commit}) status: {status}, conclusion: {conclusion}", flush=True)
        if status == 'completed':
            if conclusion == 'success':
                print("[VoltWay Actions] Build succeeded! Fetching released APK...", flush=True)
                break
            else:
                print(f"[VoltWay Actions] Build ended with conclusion: {conclusion}", flush=True)
                break
    time.sleep(12)

# Download release APK
print("[VoltWay v5.14] Downloading VoltWay.apk from GitHub Release...", flush=True)
download_success = False
for attempt in range(15):
    try:
        req = urllib.request.Request(RELEASE_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            content = r.read()
            if len(content) > 1000000:
                with open(OUTPUT_APK, 'wb') as f:
                    f.write(content)
                size_mb = os.path.getsize(OUTPUT_APK) / (1024 * 1024)
                print(f"[VoltWay v5.14] SUCCESS! Downloaded {OUTPUT_APK} ({size_mb:.2f} MB)", flush=True)
                download_success = True
                break
            else:
                print(f"[VoltWay v5.14] Got unexpected size {len(content)}, retrying...", flush=True)
    except Exception as e:
        print(f"[VoltWay v5.14] Download attempt {attempt+1}/15: {e}, waiting 6s...", flush=True)
        time.sleep(6)

if not download_success:
    print("[VoltWay v5.14] Could not download released APK directly yet.", flush=True)
