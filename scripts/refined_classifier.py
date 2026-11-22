import re

def is_strictly_south_target_improved(name, addr, lat, lng):
    try:
        lat = float(lat)
        lng = float(lng)
    except:
        return False, 'Invalid-Coords'

    text = f"{name} {addr}".lower()

    # 1. State indicator check
    is_in_kl = any(k in text for k in ['kerala', 'malappuram', 'kozhikode', 'ernakulam', 'kochi', 'thrissur', 'trivandrum', 'thiruvananthapuram', 'kollam', 'alappuzha', 'kottayam', 'palakkad', 'kannur', 'kasaragod', 'wayanad', 'idukki', 'pathanamthitta'])
    is_in_tn = any(k in text for k in ['tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'trichy', 'tiruchirappalli', 'salem', 'tirunelveli', 'tiruppur', 'erode', 'vellore', 'hosur', 'kanyakumari', 'ooty', 'udhagamandalam', 'dharmapuri', 'krishnagiri'])
    is_in_ka = any(k in text for k in ['karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubli', 'hubballi', 'dharwad', 'belagavi', 'belgaum', 'udupi', 'manipal', 'tumkur', 'tumakuru', 'shimoga', 'shivamogga', 'davanagere', 'ballari', 'bellary', 'kolar', 'hassan', 'mandya', 'chikkamagaluru', 'raichur', 'bidar'])
    is_in_py = any(k in text for k in ['puducherry', 'pondicherry', 'mahe', 'karaikal'])

    is_positive_state = is_in_kl or is_in_tn or is_in_ka or is_in_py

    # 2. Excluded state indicator check
    is_in_telangana = any(k in text for k in ['telangana', 'hyderabad', 'secunderabad', 'warangal'])
    is_in_andhra = any(k in text for k in ['andhra', 'andhra pradesh', 'anantapur', 'chittoor', 'tirupati', 'vijayawada', 'visakhapatnam', 'vizag', 'guntur', 'nellore', 'kurnool'])
    is_in_maharashtra = any(k in text for k in ['maharashtra', 'mumbai', 'pune', 'nagpur', 'nashik', 'sangli', 'kolhapur', 'dharashiv', 'solapur', 'satara']) and not ('bank' in text or 'pune bangalore' in text or 'pune-bangalore' in text)
    is_in_goa = any(k in text for k in ['curchorem', 'canacona', 'margao', 'panaji', 'mapusa', 'quepem', 'zambaulim']) or (re.search(r'\bgoa\b', text) and not ('road' in text or 'hwy' in text or 'highway' in text))
    is_in_north = any(k in text for k in ['delhi', 'noida', 'gurgaon', 'gurugram', 'haryana', 'punjab', 'rajasthan', 'gujarat', 'uttar pradesh', 'bhopal', 'indore', 'bihar', 'bengal'])

    is_negative_state = is_in_telangana or is_in_andhra or is_in_maharashtra or is_in_goa or is_in_north

    # If it has positive state and NOT negative state
    if is_positive_state and not is_negative_state:
        if 8.05 <= lat <= 18.55 and 74.0 <= lng <= 80.4:
            return True, 'Confirmed-South'

    # If negative state is detected, definitely reject!
    if is_negative_state:
        return False, 'Excluded-State'

    # Geographic Fallbacks for stations with minimal address (Strict boundaries)
    if (8.15 <= lat <= 12.85) and (74.85 <= lng <= 77.40):
        return True, 'KL-Geo'
    if (8.08 <= lat <= 13.50) and (76.25 <= lng <= 80.35) and not (lat > 13.35 and lng > 79.75):
        return True, 'TN-Geo'
    if (11.55 <= lat <= 15.50) and (74.05 <= lng <= 77.75):
        return True, 'KA-Geo'

    return False, 'Out-of-Region'
