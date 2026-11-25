"""
VoltWay 2W - Shared Charger Validation, Classification & Compatibility Helpers
Ensures consistent 2-wheeler filtering, connector tagging, and South India state classification
across all network harvesters and database merge scripts.
"""

import re

EXCLUDED_4W_TOKENS = (
    'OCPP_LEVEL_2', 'OCPP_LEVEL_3', 'LEVEL_2', 'LEVEL_3', 'OCPI',
    'CCS2', 'CCS_2', 'CCS', 'GB/T', 'GBT', 'CHADEMO', 'CHAOJI',
    'TYPE2', 'TYPE_2', 'TYPE-2', '7_4KW', '7.4KW', '15KW', '22KW',
    '30KW', '50KW', '60KW', '120KW'
)

EXCLUDED_ID_PREFIXES = (
    'L200', 'L300', 'L3DC', 'ST',
    'TN00', 'MH00', 'MH04', 'TS00', 'HR00', 'HR01', 'GJ01', 'DL00', 'KL00', 'KA00', 'KA01', 'AP00', 'TC', 'SM'
)

# Accurate PIN-code prefix lookup + district/city keyword matching (evaluated BEFORE bounding boxes)
KL_PIN_RE = re.compile(r'\b6[789]\d{4}\b')
TN_PIN_RE = re.compile(r'\b6[0-4]\d{4}\b')
KA_PIN_RE = re.compile(r'\b5[6-9]\d{4}\b')

KL_KEYWORDS = (
    'kerala', 'malappuram', 'kozhikode', 'calicut', 'ernakulam', 'kochi', 'cochin',
    'thrissur', 'trivandrum', 'thiruvananthapuram', 'kollam', 'alappuzha', 'alleppey',
    'kottayam', 'palakkad', 'kannur', 'kasaragod', 'wayanad', 'idukki', 'pathanamthitta',
    'edappally', 'aluva', 'kakkanad', 'thalassery', 'vadakara', 'tirur', 'perinthalmanna',
    'manjeri', 'guruvayur', 'muvattupuzha', 'thodupuzha', 'kayamkulam', 'thiruvalla', 'pala',
    'chengannur', 'kottarakkara', 'attinal', 'attingal', 'kalpetta', 'sulthan bathery', 'munnar'
)

TN_KEYWORDS = (
    'tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'trichy',
    'tiruchirappalli', 'salem', 'tirunelveli', 'tiruppur', 'erode', 'vellore',
    'hosur', 'kanyakumari', 'nagercoil', 'ooty', 'udhagamandalam', 'dharmapuri',
    'krishnagiri', 'pollachi', 'thanjavur', 'thoothukudi', 'tuticorin', 'dindigul',
    'karur', 'namakkal', 'cuddalore', 'kanchipuram', 'chengalpattu', 'avadi', 'tambaram'
)

KA_KEYWORDS = (
    'karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore',
    'hubli', 'hubballi', 'dharwad', 'belagavi', 'belgaum', 'udupi', 'manipal',
    'tumkur', 'tumakuru', 'shimoga', 'shivamogga', 'davanagere', 'ballari', 'bellary',
    'kolar', 'hassan', 'mandya', 'chikkamagaluru', 'raichur', 'bidar', 'kalaburagi',
    'gulbarga', 'bagalkot', 'vijayapura', 'bijapur', 'electronic city', 'whitefield',
    'koramangala', 'indiranagar', 'hsr layout', 'jayanagar', 'yelahanka', 'hebbal', 'kanakapura'
)


def classify_state(name, address, lat, lng):
    """Accurately classifies state into 'kerala', 'karnataka', 'tamil_nadu', or 'other'."""
    text = f"{name or ''} {address or ''}".lower()

    # 1. Postal PIN code match (highest certainty)
    if KL_PIN_RE.search(text):
        return 'kerala'
    if TN_PIN_RE.search(text):
        return 'tamil_nadu'
    if KA_PIN_RE.search(text):
        return 'karnataka'

    # 2. Explicit city / district / state name match (word boundaries prevent substring hits e.g. mettupalayam != pala)
    if any(re.search(r'\b' + re.escape(k) + r'\b', text) for k in KL_KEYWORDS):
        return 'kerala'
    if any(re.search(r'\b' + re.escape(k) + r'\b', text) for k in TN_KEYWORDS):
        return 'tamil_nadu'
    if any(re.search(r'\b' + re.escape(k) + r'\b', text) for k in KA_KEYWORDS):
        return 'karnataka'

    # 3. Refined non-overlapping geographic fallback boxes
    if lat is not None and lng is not None:
        # Tighter Kerala box excluding Coimbatore/Pollachi/Gudalur corridor
        if 8.20 <= lat <= 12.78 and 74.85 <= lng <= 77.15:
            # Exclude Coimbatore corridor (~10.75-11.20 N, >76.82 E) and Ooty (>76.62 E at 11.25-11.65 N)
            if not (10.72 <= lat <= 11.22 and lng >= 76.82) and not (11.22 <= lat <= 11.65 and lng >= 76.60):
                return 'kerala'
        # Karnataka box (north of Nilgiris/Wayanad & west of Hosur/TN border)
        if 11.75 <= lat <= 18.45 and 74.05 <= lng <= 77.78:
            return 'karnataka'
        # Tamil Nadu box
        if 8.08 <= lat <= 13.50 and 76.65 <= lng <= 80.35:
            return 'tamil_nadu'

    return 'other'


def is_excluded_4w_or_roaming(cid, model_id, name='', address=''):
    """Returns True if record represents a 4W car charger or unverified OCPI roaming unit."""
    mid = (model_id or '').upper()
    cid_up = (cid or '').upper()
    blob = f"{cid_up} {mid}".strip()

    if any(tok in blob for tok in EXCLUDED_4W_TOKENS):
        return True

    # Reject Level 2/3/OCPI prefixes ONLY when not explicitly an OCPP_2WFC unit
    if '2WFC' not in mid and any(cid_up.startswith(pref) for pref in EXCLUDED_ID_PREFIXES):
        return True

    return False


def parse_bolt_power_kw(model_id, is_fast):
    """Extracts true charger power rating in kW from Bolt.Earth model_id."""
    mid = (model_id or '').upper()
    m = re.search(r'_1_(\d+)KW', mid)
    if m:
        val = float(m.group(1))
        if 1.0 <= val <= 15.0:
            return val
    return 3.0 if is_fast else 1.5


def parse_bolt_connector(model_id, is_fast):
    """Returns (connector_std, compatible_vehicles, connector_label)."""
    mid = (model_id or '').upper()
    if not is_fast:
        return (
            'AC_15A',
            ['ATHER', 'VIDA', 'OLA', 'TVS', 'BAJAJ', 'ALL_2W'],
            'Standard 15A / 3-Pin AC Socket (Portable Charger)'
        )

    has_t6 = 'TYPE6' in mid
    has_t7 = 'TYPE7' in mid

    if has_t6 and has_t7:
        return (
            'TYPE6_TYPE7',
            ['ATHER', 'VIDA', 'OLA'],
            'Dual 2W Fast DC (Type 7 LECCS + Type 6 LEVDC)'
        )
    if has_t7:
        return (
            'TYPE7_LECCS',
            ['ATHER', 'VIDA'],
            'Type 7 LECCS Fast DC (Ather / Hero VIDA)'
        )
    if has_t6:
        return (
            'TYPE6_LEVDC',
            ['OLA'],
            'Type 6 LEVDC Fast DC (Ola / Type 6 — Adapter req. for Ather)'
        )

    return (
        'TYPE7_LECCS',
        ['ATHER', 'VIDA'],
        'Bolt 2W Fast Charger'
    )
