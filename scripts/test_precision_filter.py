import json
import re

KL_CITIES = [
    'kerala', 'thiruvananthapuram', 'trivandrum', 'kollam', 'quilon', 'pathanamthitta', 'alappuzha', 'alleppey',
    'kottayam', 'idukki', 'ernakulam', 'kochi', 'cochin', 'thrissur', 'trichur', 'palakkad', 'palghat',
    'malappuram', 'kozhikode', 'calicut', 'wayanad', 'kannur', 'cannanore', 'kasaragod', 'kasargod',
    'munnar', 'cherthala', 'chalakkudy', 'angamaly', 'perumbavoor', 'aluva', 'changanassery', 'thiruvalla',
    'kayamkulam', 'punalur', 'atteningal', 'neyyattinkara', 'vadakara', 'thalassery', 'payyanur', 'manjeri',
    'tirur', 'ponnani', 'kondotty', 'perinthalmanna', 'nilambur', 'ottapalam', 'shornur', 'guruvayur',
    'kunnamkulam', 'irinjallakuda', 'kodungallur', 'kothamangalam', 'muvattupuzha', 'piravom', 'pala',
    'thodupuzha', 'kattappana', 'adimali', 'sulthan bathery', 'kalpetta', 'mananthavady', 'uppala', 'kanhangad'
]

TN_CITIES = [
    'tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'tiruchirappalli', 'trichy', 'salem',
    'tirunelveli', 'tiruppur', 'erode', 'vellore', 'thoothukudi', 'tuticorin', 'dindigul', 'thanjavur',
    'ranipet', 'sivakasi', 'karur', 'ooty', 'udhagamandalam', 'hosur', 'nagercoil', 'kanyakumari',
    'kanchipuram', 'tiruvannamalai', 'kumbakonam', 'cuddalore', 'nagapattinam', 'pudukkottai', 'dharmapuri',
    'krishnagiri', 'namakkal', 'perambalur', 'ramanathapuram', 'sivaganga', 'tenkasi', 'theni', 'tiruvarur',
    'tirupathur', 'viluppuram', 'virudhunagar', 'chengalpattu', 'kallakurichi', 'mayiladuthurai', 'ambattur',
    'avadi', 'tambaram', 'pallavaram', 'pollachi', 'rajapalayam', 'gudiyatham', 'vaniyambadi', 'amur',
    'marthandam', 'kovilpatti', 'mettupalayam', 'gobichettipalayam', 'attur', 'paramakudi', 'panruti'
]

KA_CITIES = [
    'karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubballi',
    'hubli', 'belagavi', 'belgaum', 'kalaburagi', 'gulbarga', 'davanagere', 'ballari', 'bellary',
    'vijayapura', 'bijapur', 'shivamogga', 'shimoga', 'tumakuru', 'tumkur', 'raichur', 'bidar', 'hosapete',
    'gadag', 'kgf', 'hassan', 'bhadravati', 'chitradurga', 'udupi', 'manipal', 'kolar', 'mandya',
    'chikkamagaluru', 'chikmagalur', 'yadgir', 'chikkaballapura', 'ramanagara', 'bagalkote', 'bagalkot',
    'chamrajnagar', 'haveri', 'koppal', 'karwar', 'kodagu', 'madikeri', 'puttur', 'bhatkal', 'kundapura',
    'sullia', 'bantwal', 'karkala', 'sirsi', 'dandeli', 'kumta', 'honnavar', 'hunsur', 'nanjangud',
    'channapatna', 'kanakapura', 'nelamangala', 'doddaballapura', 'hoskote', 'anekal', 'whitefield'
]

PY_CITIES = [
    'puducherry', 'pondicherry', 'mahe', 'karaikal', 'yanam'
]

EXCLUDED_REGIONS = [
    'telangana', 'hyderabad', 'secunderabad', 'warangal', 'nizamabad', 'karimnagar', 'khammam', 'ramagundam',
    'andhra', 'visakhapatnam', 'vizag', 'vijayawada', 'guntur', 'nellore', 'kurnool', 'rajahmundry',
    'kakinada', 'tirupati', 'anantapur', 'kadapa', 'vizianagaram', 'eluru', 'ongole', 'nandyal', 'machilipatnam',
    'maharashtra', 'mumbai', 'pune', 'nagpur', 'thane', 'nashik', 'aurangabad', 'solapur', 'amravati',
    'navi mumbai', 'kolhapur', 'akola', 'latur', 'dhule', 'ahmednagar', 'chandrapur', 'parbhani', 'jalna',
    'jalgaon', 'dharashiv', 'osmanabad', 'satara', 'sangli', 'ratnagiri', 'sindhudurg',
    'goa', 'panaji', 'margao', 'vasco', 'mapusa', 'ponda',
    'gujarat', 'ahmedabad', 'surat', 'vadodara', 'rajkot', 'delhi', 'rajasthan', 'jaipur', 'uttar pradesh',
    'noida', 'gurgaon', 'gurugram', 'faridabad', 'ghaziabad', 'madhya pradesh', 'bhopal', 'indore'
]

def classify_location(name, addr, lat, lng):
    text = f"{name} {addr}".lower()

    # 1. Immediate exclusion check
    for ex in EXCLUDED_REGIONS:
        # Match whole word or exact city
        if re.search(r'\b' + re.escape(ex) + r'\b', text):
            return False, f"Excluded ({ex})"

    # 2. Positive Match for KL, TN, KA, PY
    for kl in KL_CITIES:
        if re.search(r'\b' + re.escape(kl) + r'\b', text):
            return True, 'KL'

    for tn in TN_CITIES:
        if re.search(r'\b' + re.escape(tn) + r'\b', text):
            return True, 'TN'

    for ka in KA_CITIES:
        if re.search(r'\b' + re.escape(ka) + r'\b', text):
            return True, 'KA'

    for py in PY_CITIES:
        if re.search(r'\b' + re.escape(py) + r'\b', text):
            return True, 'PY'

    # 3. High-Precision Geographic Fallback (Boundary strictly within KL, TN, KA, PY)
    # Kerala: Lat 8.2 - 12.8, Lng 74.85 - 77.40
    if (8.2 <= lat <= 12.8) and (74.85 <= lng <= 77.40):
        return True, 'KL-Geo'

    # Tamil Nadu: Lat 8.08 - 13.50, Lng 76.25 - 80.35 (excluding AP/KL)
    if (8.08 <= lat <= 13.50) and (76.25 <= lng <= 80.35) and not (lat > 13.35 and lng > 79.8):
        return True, 'TN-Geo'

    # Karnataka: Lat 11.55 - 18.45, Lng 74.05 - 77.80 (strict western/southern KA)
    if (11.55 <= lat <= 15.50) and (74.05 <= lng <= 77.80):
        return True, 'KA-Geo'

    return False, 'Out-of-Region'

# Test on Ather Grid
with open('ather_grid_chargers.json', 'r', encoding='utf-8') as f:
    ather = json.load(f)

ather_accepted = []
ather_rejected = []

for a in ather:
    ok, reason = classify_location(a.get('name', ''), a.get('address', ''), a.get('lat', 0), a.get('lng', 0))
    if ok:
        ather_accepted.append((a, reason))
    else:
        ather_rejected.append((a, reason))

print(f"Ather Grid: Total {len(ather)} -> Accepted: {len(ather_accepted)}, Rejected: {len(ather_rejected)}")
print("Sample Rejected Ather:")
for a, r in ather_rejected[:10]:
    print(f"  [{r}] {a['id']} | {a['name']} | Lat: {a['lat']}, Lng: {a['lng']} | Addr: {a.get('address')[:60]}")
