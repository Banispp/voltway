"""
VoltWay 2W - Official Bolt.Earth Live API Sync Script
Runs comprehensive multi-region harvester covering Kerala & South India corridors.
"""

import sys
import os

base_dir = os.path.dirname(os.path.abspath(__file__))

if __name__ == '__main__':
    from harvest_bolt_thorough import run
    run()
