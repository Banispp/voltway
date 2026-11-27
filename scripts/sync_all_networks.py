"""
VoltWay 2W - Unified Master Network Harvester & Sync Engine
Executes complete deep-scan across all 3 major Indian 2W EV Networks:
1. Ather Energy Official API
2. Hero VIDA Official API
3. Bolt.Earth National Zoom 18 Unclustered Harvester (with strict 4W/OCPI exclusion)
4. Unified merge & connector validation
"""

import os
import sys
import subprocess


def run():
    print("=" * 75)
    print("VoltWay 2W - Master Network Deep Scan & Verification Engine")
    print("=" * 75)

    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    steps = [
        ("[Step 1/4] Syncing Official Ather Grid API...", 'download_ather.py'),
        ("[Step 2/4] Syncing Official Hero VIDA Grid API...", 'download_vida.py'),
        ("[Step 3/4] Running Bolt.Earth National Zoom 18 Deep Harvester...", 'harvest_bolt_national.py'),
    ]

    ok_networks = 0
    for label, script_name in steps:
        print(f"\n{label}", flush=True)
        try:
            subprocess.run([sys.executable, os.path.join(scripts_dir, script_name)], check=True)
            ok_networks += 1
        except Exception as exc:
            print(f"Warning: {script_name} failed ({exc}); keeping previous baseline and continuing.", flush=True)

    if ok_networks == 0:
        raise RuntimeError("All 3 EV network sync steps failed!")

    print("\n[Step 4/4] Verifying merged database bundle...", flush=True)
    subprocess.run([sys.executable, os.path.join(scripts_dir, 'merge_and_update.py')], check=True)

    print("\n" + "=" * 75)
    print(f"Master Deep Scan & Merge Completed ({ok_networks}/3 live sources succeeded)!")
    print("=" * 75)


if __name__ == '__main__':
    run()
