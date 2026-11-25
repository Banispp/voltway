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

    print("\n[Step 1/4] Syncing Official Ather Grid API...", flush=True)
    subprocess.run([sys.executable, os.path.join(scripts_dir, 'download_ather.py')], check=True)

    print("\n[Step 2/4] Syncing Official Hero VIDA Grid API...", flush=True)
    subprocess.run([sys.executable, os.path.join(scripts_dir, 'download_vida.py')], check=True)

    print("\n[Step 3/4] Running Bolt.Earth National Zoom 18 Deep Harvester...", flush=True)
    subprocess.run([sys.executable, os.path.join(scripts_dir, 'harvest_bolt_national.py')], check=True)

    print("\n[Step 4/4] Verifying merged database bundle...", flush=True)
    subprocess.run([sys.executable, os.path.join(scripts_dir, 'merge_and_update.py')], check=True)

    print("\n" + "=" * 75)
    print("Master Deep Scan & Merge Completed Successfully!")
    print("=" * 75)


if __name__ == '__main__':
    run()
