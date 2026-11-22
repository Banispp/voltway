import os

manifest_path = os.path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml')

if os.path.exists(manifest_path):
    with open(manifest_path, 'r', encoding='utf-8') as f:
        content = f.read()

    perms = """
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />
"""

    if 'ACCESS_FINE_LOCATION' not in content:
        content = content.replace('<application', perms + '\n    <application')
        with open(manifest_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print('[VoltWay Build] Injected GPS location permissions into AndroidManifest.xml successfully!')
    else:
        print('[VoltWay Build] Location permissions already present.')
else:
    print(f'[VoltWay Build] AndroidManifest.xml not found at {manifest_path}')
