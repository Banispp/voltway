"""
VoltWay 2W - Unified Master Network Harvester & Sync Engine
Executes complete deep-scan across all 3 major Indian 2W EV Networks:
1. Ather Energy Official API (3,572 DC Fast Chargers)
2. Hero VIDA Official API (611 Type 7 LEV DC Fast Chargers)
3. Bolt.Earth National Zoom 18 Unclustered Harvester (7,260 2W Fast & 15A Sockets)
"""

import os
import sys
import subprocess
import time

def run():
    print("=" * 75)
    print("VoltWay 2W - Master Network Deep Scan & Verification Engine")
    print("=" * 75)
    
    scripts_dir = os.path.dirname(os.path.abspath(__file__))

    # 1. Sync Ather Grid
    print("\n[Step 1/3] Syncing Official Ather Grid API...", flush=True)
    subprocess.run([sys.executable, os.path.join(scripts_dir, 'download_ather.py')], check=True)

    # 2. Sync Hero VIDA Grid
    print("\n[Step 2/3] Syncing Official Hero VIDA Grid API...", flush=True)
    subprocess.run([sys.executable, os.path.join(scripts_dir, 'download_vida.py')], check=True)

    # 3. National Bolt.Earth Harvest (Zoom 18 Unclustered)
    print("\n[Step 3/3] Running Bolt.Earth National Zoom 18 Deep Harvester...", flush=True)
    subprocess.run([sys.executable, os.path.join(scripts_dir, 'harvest_bolt_national.py')], check=True)

    print("\n" + "=" * 75)
    print("Master Deep Scan & Merge Completed Successfully!")
    print("=" * 75)

if __name__ == '__main__':
    run()
