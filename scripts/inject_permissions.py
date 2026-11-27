import os

manifest_path = os.path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml')

# Inject only minimal required permissions (no background GPS, no TTS queries)
if os.path.exists(manifest_path):
    with open(manifest_path, 'r', encoding='utf-8') as f:
        content = f.read()

    required_perms = [
        '<uses-permission android:name="android.permission.INTERNET" />',
        '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
        '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
        '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
        '<uses-permission android:name="android.permission.WAKE_LOCK" />',
        '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
    ]

    missing_perms = [p for p in required_perms if p.split('"')[1] not in content]
    if missing_perms:
        content = content.replace('<application', '    ' + '\n    '.join(missing_perms) + '\n\n    <application')

    if '<queries' not in content:
        queries_block = (
            '    <queries>\n'
            '        <package android:name="com.athermobileapp" />\n'
            '        <package android:name="com.hero.vida" />\n'
            '        <package android:name="com.revos.bolt.android" />\n'
            '        <intent>\n'
            '            <action android:name="android.intent.action.VIEW" />\n'
            '            <data android:scheme="market" />\n'
            '        </intent>\n'
            '        <intent>\n'
            '            <action android:name="android.intent.action.VIEW" />\n'
            '            <data android:scheme="https" />\n'
            '        </intent>\n'
            '    </queries>\n\n    <application'
        )
        content = content.replace('<application', queries_block)

    with open(manifest_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[VoltWay Build] Injected GPS, WakeLock & EV app <queries> into AndroidManifest.xml cleanly!')
else:
    print(f'[VoltWay Build] AndroidManifest.xml not found at {manifest_path}')
