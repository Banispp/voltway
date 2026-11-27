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

    if 'android.intent.action.SEND' not in content:
        share_filters = (
            '\n            <intent-filter>\n'
            '                <action android:name="android.intent.action.SEND" />\n'
            '                <category android:name="android.intent.category.DEFAULT" />\n'
            '                <data android:mimeType="text/plain" />\n'
            '            </intent-filter>\n'
            '            <intent-filter>\n'
            '                <action android:name="android.intent.action.VIEW" />\n'
            '                <category android:name="android.intent.category.DEFAULT" />\n'
            '                <category android:name="android.intent.category.BROWSABLE" />\n'
            '                <data android:scheme="geo" />\n'
            '            </intent-filter>\n'
            '        </activity>'
        )
        main_pos = content.find('MainActivity')
        if main_pos != -1:
            end_pos = content.find('</activity>', main_pos)
            if end_pos != -1:
                content = content[:end_pos] + share_filters + content[end_pos + len('</activity>'):]

    with open(manifest_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('[VoltWay Build] Injected GPS, WakeLock, EV <queries> & Google Maps Share intent-filters cleanly!')
else:
    print(f'[VoltWay Build] AndroidManifest.xml not found at {manifest_path}')

java_dir = os.path.join('android', 'app', 'src', 'main', 'java', 'com', 'voltway', 'evroute')
main_activity_path = os.path.join(java_dir, 'MainActivity.java')
plugin_path = os.path.join(java_dir, 'VoltWayNativePlugin.java')

if os.path.exists(main_activity_path):
    # Proper Capacitor 6 plugin registration BEFORE super.onCreate() so bridge + WebView
    # expose Capacitor.Plugins.VoltWayNative before any page JS loads, and handleOnNewIntent works cleanly.
    main_activity_java = r'''package com.voltway.evroute;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoltWayNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
'''

    voltway_native_plugin_java = r'''package com.voltway.evroute;

import android.content.ClipData;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "VoltWayNative")
public class VoltWayNativePlugin extends Plugin {
    private static final String DESKTOP_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    private static final Map<String, String> DOH_IP_CACHE = new ConcurrentHashMap<>();

    private volatile String pendingShareText = null;
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @Override
    public void load() {
        super.load();
        if (getActivity() != null) {
            captureShareIntent(getActivity().getIntent(), false);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        captureShareIntent(intent, true);
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private String extractShareText(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            CharSequence csText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            String txt = csText != null ? csText.toString() : intent.getStringExtra(Intent.EXTRA_TEXT);
            if ((txt == null || txt.trim().isEmpty()) && intent.getClipData() != null) {
                ClipData clip = intent.getClipData();
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < clip.getItemCount(); i++) {
                    ClipData.Item item = clip.getItemAt(i);
                    if (item == null) continue;
                    CharSequence itemText = item.getText();
                    if (itemText != null && !itemText.toString().trim().isEmpty()) {
                        if (sb.length() > 0) sb.append("\n");
                        sb.append(itemText.toString().trim());
                    } else if (item.getUri() != null) {
                        if (sb.length() > 0) sb.append("\n");
                        sb.append(item.getUri().toString());
                    }
                }
                txt = sb.toString();
            }
            CharSequence csSubj = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
            String subj = csSubj != null ? csSubj.toString() : intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (txt != null && !txt.trim().isEmpty()) {
                if (subj != null && !subj.trim().isEmpty() && !txt.contains(subj.trim())) {
                    return subj.trim() + "\n" + txt.trim();
                }
                return txt.trim();
            }
            if (subj != null && !subj.trim().isEmpty()) {
                return subj.trim();
            }
        } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            String scheme = intent.getScheme();
            if ("geo".equalsIgnoreCase(scheme)) {
                return intent.getDataString();
            }
        }
        return null;
    }

    private void captureShareIntent(Intent intent, boolean notify) {
        if (intent == null || intent.getBooleanExtra("_vw_handled", false)) return;
        String extracted = extractShareText(intent);
        if (extracted == null || extracted.isEmpty()) return;

        intent.putExtra("_vw_handled", true);
        pendingShareText = extracted;

        if (notify) {
            JSObject data = new JSObject();
            data.put("text", extracted);
            notifyListeners("shareReceived", data, true);
        }
    }

    @PluginMethod
    public void consumePendingShare(PluginCall call) {
        JSObject ret = new JSObject();
        String val = pendingShareText;
        pendingShareText = null;
        ret.put("text", val != null ? val : "");
        call.resolve(ret);
    }

    @PluginMethod
    public void resolveMapUrl(PluginCall call) {
        String rawUrl = call.getString("url", "");
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            JSObject err = new JSObject();
            err.put("success", false);
            call.resolve(err);
            return;
        }
        final String target = rawUrl.trim()
            .replaceAll("([?&])g_st=[^&]*&?", "$1")
            .replaceAll("[?&]$", "");

        executor.execute(() -> {
            JSObject ret = new JSObject();
            try {
                String finalUrl = followGoogleRedirects(target, 5);
                String placeTitle = extractPlaceFromUrl(finalUrl);
                double[] coords = extractCoords(finalUrl);

                if (coords == null && finalUrl != null && isAllowedGoogleHost(new URL(finalUrl).getHost())) {
                    try {
                        HttpResult htmlRes = fetchWithDohFallback(finalUrl, true, 4500);
                        if (htmlRes != null && htmlRes.body != null) {
                            coords = extractCoordsFromHtml(htmlRes.body);
                            if (placeTitle == null || placeTitle.isEmpty()) {
                                placeTitle = extractTitleFromHtml(htmlRes.body);
                            }
                        }
                    } catch (Exception ignoredHtmlErr) {
                        // Keep finalUrl and placeTitle even when HTML body times out on slow connections!
                    }
                }

                ret.put("success", true);
                ret.put("url", finalUrl != null ? finalUrl : target);
                if (placeTitle != null && !placeTitle.isEmpty()) {
                    ret.put("title", placeTitle);
                }
                if (coords != null) {
                    ret.put("lat", coords[0]);
                    ret.put("lng", coords[1]);
                }
                call.resolve(ret);
            } catch (Exception e) {
                ret.put("success", false);
                ret.put("error", e.getMessage() != null ? e.getMessage() : "Resolve failed");
                call.resolve(ret);
            }
        });
    }

    private static class HttpResult {
        int code;
        String location;
        String body;
    }

    private boolean isAllowedGoogleHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.US);
        return h.equals("goo.gl") || h.endsWith(".goo.gl")
            || h.equals("maps.app.goo.gl")
            || h.equals("g.co") || h.endsWith(".g.co")
            || h.equals("share.google") || h.endsWith(".share.google")
            || h.matches("^(?:[a-z0-9-]+\\.)*google\\.(?:com|[a-z]{2}|com?\\.[a-z]{2})$");
    }

    private String followGoogleRedirects(String startUrl, int maxHops) throws IOException {
        String current = startUrl;
        for (int hop = 0; hop < maxHops; hop++) {
            URL u = new URL(current);
            if (!"https".equalsIgnoreCase(u.getProtocol()) && !"http".equalsIgnoreCase(u.getProtocol())) {
                break;
            }
            if (!isAllowedGoogleHost(u.getHost())) {
                break;
            }
            if (extractCoords(current) != null) {
                return current;
            }

            HttpResult res = fetchWithDohFallback(current, false, 2600);
            if (res == null || res.location == null || res.location.isEmpty()) {
                return current;
            }
            String nextUrl = res.location.trim();
            if (nextUrl.startsWith("/")) {
                nextUrl = u.getProtocol() + "://" + u.getAuthority() + nextUrl;
            }
            URL nextParsed = new URL(nextUrl);
            if (!isAllowedGoogleHost(nextParsed.getHost())) {
                return current;
            }
            current = nextUrl;
            if (current.contains("/maps/place/") || current.contains("/maps/dir/")) {
                return current;
            }
        }
        return current;
    }

    private HttpResult fetchWithDohFallback(String urlStr, boolean wantBody, int timeoutMs) throws IOException {
        URL u = new URL(urlStr);
        String host = u.getHost();
        boolean isShortHost = host != null && (host.equalsIgnoreCase("maps.app.goo.gl") || host.equalsIgnoreCase("goo.gl") || host.equalsIgnoreCase("g.co") || host.equalsIgnoreCase("share.google"));
        // For short link hosts on Jio/carrier networks where system DNS getaddrinfo() can block >15s ignoring connectTimeout,
        // resolve via IPv4 DoH first and fall back to direct HttpURLConnection only if DoH fails.
        if (isShortHost && !DOH_IP_CACHE.containsKey(host)) {
            String dohIp = resolveIpv4ViaDoh(host);
            if (dohIp != null) {
                DOH_IP_CACHE.put(host, dohIp);
                try {
                    return fetchDirectToIp(u, dohIp, wantBody, timeoutMs);
                } catch (IOException dohConnErr) {
                    DOH_IP_CACHE.remove(host);
                    return fetchDirect(u, wantBody, timeoutMs);
                }
            }
        }
        int directTimeout = isShortHost ? Math.min(timeoutMs, 1000) : timeoutMs;
        if (!DOH_IP_CACHE.containsKey(host)) {
            try {
                return fetchDirect(u, wantBody, directTimeout);
            } catch (IOException directErr) {
                String dohIp = resolveIpv4ViaDoh(host);
                if (dohIp == null) throw directErr;
                DOH_IP_CACHE.put(host, dohIp);
                return fetchDirectToIp(u, dohIp, wantBody, timeoutMs);
            }
        } else {
            String cachedIp = DOH_IP_CACHE.get(host);
            try {
                return fetchDirectToIp(u, cachedIp, wantBody, timeoutMs);
            } catch (IOException retryErr) {
                DOH_IP_CACHE.remove(host);
                String freshIp = resolveIpv4ViaDoh(host);
                if (freshIp != null) {
                    DOH_IP_CACHE.put(host, freshIp);
                    return fetchDirectToIp(u, freshIp, wantBody, timeoutMs);
                }
                return fetchDirect(u, wantBody, timeoutMs);
            }
        }
    }

    private HttpResult fetchDirect(URL u, boolean wantBody, int timeoutMs) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) u.openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(wantBody ? 4500 : timeoutMs);
        conn.setRequestProperty("User-Agent", DESKTOP_UA);
        conn.setRequestProperty("Accept", "text/html,application/xhtml+xml");
        try {
            HttpResult res = new HttpResult();
            res.code = conn.getResponseCode();
            res.location = conn.getHeaderField("Location");
            if (wantBody && res.code >= 200 && res.code < 300) {
                res.body = readStreamLimited(conn.getInputStream(), 512 * 1024);
            }
            return res;
        } finally {
            conn.disconnect();
        }
    }

    private String resolveIpv4ViaDoh(String host) {
        String encoded;
        try {
            encoded = URLEncoder.encode(host, "UTF-8");
        } catch (Exception e) {
            return null;
        }
        String[] endpoints = new String[] {
            "https://8.8.8.8/resolve?name=" + encoded + "&type=A",
            "https://dns.google/resolve?name=" + encoded + "&type=A",
            "https://cloudflare-dns.com/dns-query?name=" + encoded + "&type=A"
        };
        for (String ep : endpoints) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(ep).openConnection();
                c.setConnectTimeout(2500);
                c.setReadTimeout(2500);
                c.setRequestProperty("Accept", "application/dns-json, application/json");
                if (c.getResponseCode() == 200) {
                    String json = readStreamLimited(c.getInputStream(), 16384);
                    JSONObject obj = new JSONObject(json);
                    JSONArray ans = obj.optJSONArray("Answer");
                    if (ans != null) {
                        for (int i = 0; i < ans.length(); i++) {
                            JSONObject rec = ans.optJSONObject(i);
                            if (rec != null && rec.optInt("type", 0) == 1) {
                                String ip = rec.optString("data", "").trim();
                                if (ip.matches("^\\d+\\.\\d+\\.\\d+\\.\\d+$")) {
                                    return ip;
                                }
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return null;
    }

    private HttpResult fetchDirectToIp(URL u, String ip, boolean wantBody, int timeoutMs) throws IOException {
        String host = u.getHost();
        int port = u.getPort() > 0 ? u.getPort() : 443;
        String path = u.getFile();
        if (path == null || path.isEmpty()) path = "/";

        Socket raw = new Socket();
        SSLSocket ssl = null;
        try {
            raw.connect(new InetSocketAddress(ip, port), timeoutMs);
            raw.setSoTimeout(wantBody ? 4500 : timeoutMs);
            SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
            ssl = (SSLSocket) factory.createSocket(raw, host, port, true);

            if (Build.VERSION.SDK_INT >= 24) {
                SSLParameters params = ssl.getSSLParameters();
                params.setServerNames(Collections.singletonList(new SNIHostName(host)));
                ssl.setSSLParameters(params);
            } else {
                try {
                    Method setHostname = ssl.getClass().getMethod("setHostname", String.class);
                    setHostname.invoke(ssl, host);
                } catch (Exception ignored) {}
            }

            ssl.startHandshake();
            HostnameVerifier hv = HttpsURLConnection.getDefaultHostnameVerifier();
            if (!hv.verify(host, ssl.getSession())) {
                throw new IOException("TLS hostname check failed for " + host);
            }

            OutputStream out = ssl.getOutputStream();
            String req = "GET " + path + " HTTP/1.1\r\n"
                + "Host: " + host + "\r\n"
                + "User-Agent: " + DESKTOP_UA + "\r\n"
                + "Accept: text/html,application/xhtml+xml\r\n"
                + "Accept-Encoding: identity\r\n"
                + "Connection: close\r\n\r\n";
            out.write(req.getBytes(StandardCharsets.US_ASCII));
            out.flush();

            byte[] rawBytes = readHttpResponseBytes(ssl.getInputStream(), wantBody, wantBody ? 512 * 1024 : 16384);
            int splitIdx = findHeaderEnd(rawBytes);
            int headerLen = splitIdx >= 0 ? splitIdx : rawBytes.length;
            String headerBlock = new String(rawBytes, 0, headerLen, StandardCharsets.US_ASCII);

            HttpResult res = new HttpResult();
            Matcher statusM = Pattern.compile("^HTTP/\\d(?:\\.\\d)?\\s+(\\d{3})").matcher(headerBlock);
            res.code = statusM.find() ? Integer.parseInt(statusM.group(1)) : 200;

            Matcher locM = Pattern.compile("(?im)^Location:\\s*([^\\r\\n]+)").matcher(headerBlock);
            if (locM.find()) {
                res.location = locM.group(1).trim();
            }
            if (wantBody && splitIdx >= 0) {
                int bodyStart = splitIdx + 4;
                int bodyLen = rawBytes.length - bodyStart;
                byte[] bodyBytes;
                if (headerBlock.toLowerCase(Locale.US).contains("transfer-encoding: chunked")) {
                    bodyBytes = decodeChunkedBytes(rawBytes, bodyStart, rawBytes.length);
                } else {
                    bodyBytes = new byte[bodyLen];
                    System.arraycopy(rawBytes, bodyStart, bodyBytes, 0, bodyLen);
                }
                res.body = new String(bodyBytes, StandardCharsets.UTF_8);
            }
            return res;
        } finally {
            try { if (ssl != null) ssl.close(); } catch (Exception ignored) {}
            try { raw.close(); } catch (Exception ignored) {}
        }
    }

    private int findHeaderEnd(byte[] data) {
        for (int i = 0; i <= data.length - 4; i++) {
            if (data[i] == '\r' && data[i + 1] == '\n' && data[i + 2] == '\r' && data[i + 3] == '\n') {
                return i;
            }
        }
        return -1;
    }

    private byte[] decodeChunkedBytes(byte[] raw, int start, int end) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int pos = start;
        while (pos < end) {
            int lineEnd = -1;
            for (int i = pos; i < end - 1; i++) {
                if (raw[i] == '\r' && raw[i + 1] == '\n') {
                    lineEnd = i;
                    break;
                }
            }
            if (lineEnd < 0) break;
            String sizeHex = new String(raw, pos, lineEnd - pos, StandardCharsets.US_ASCII).split(";")[0].trim();
            int chunkLen;
            try {
                chunkLen = Integer.parseInt(sizeHex, 16);
            } catch (NumberFormatException e) {
                ByteArrayOutputStream fallback = new ByteArrayOutputStream();
                fallback.write(raw, start, end - start);
                return fallback.toByteArray();
            }
            if (chunkLen <= 0) break;
            int dataStart = lineEnd + 2;
            int avail = Math.min(chunkLen, end - dataStart);
            if (avail > 0) out.write(raw, dataStart, avail);
            pos = dataStart + avail + 2;
        }
        return out.toByteArray();
    }

    private byte[] readHttpResponseBytes(InputStream is, boolean wantBody, int maxBytes) throws IOException {
        if (is == null) return new byte[0];
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int total = 0;
        int n;
        try {
            while ((n = is.read(buf)) != -1) {
                int take = Math.min(n, maxBytes - total);
                bos.write(buf, 0, take);
                total += take;
                if (!wantBody && findHeaderEnd(bos.toByteArray()) >= 0) {
                    break;
                }
                if (total >= maxBytes) break;
            }
        } catch (IOException readErr) {
            if (findHeaderEnd(bos.toByteArray()) < 0) {
                throw readErr;
            }
        }
        return bos.toByteArray();
    }

    private byte[] readStreamBytesLimited(InputStream is, int maxBytes) throws IOException {
        if (is == null) return new byte[0];
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int total = 0;
        int n;
        while ((n = is.read(buf)) != -1) {
            int take = Math.min(n, maxBytes - total);
            bos.write(buf, 0, take);
            total += take;
            if (total >= maxBytes) break;
        }
        return bos.toByteArray();
    }

    private String readStreamLimited(InputStream is, int maxBytes) throws IOException {
        return new String(readStreamBytesLimited(is, maxBytes), StandardCharsets.UTF_8);
    }

    private String extractPlaceFromUrl(String url) {
        if (url == null) return "";
        Matcher m = Pattern.compile("/maps/(?:place|search)/([^/@?]+)").matcher(url);
        if (m.find()) {
            try {
                // URLDecoder.decode already converts unencoded '+' to ' ' AND keeps '%2B' as literal '+' (needed for Plus Codes like 8XW4+5J)
                String name = URLDecoder.decode(m.group(1), "UTF-8").trim();
                if (!name.matches("^-?\\d+\\.\\d+\\s*,\\s*-?\\d+\\.\\d+$")) {
                    return name;
                }
            } catch (Exception ignored) {}
        }
        return "";
    }

    private double[] extractCoords(String text) {
        if (text == null || text.isEmpty()) return null;
        String[] patterns = new String[] {
            "[?&](?:q|daddr|saddr|ll|query)=(?:loc:)?(-?\\d+\\.\\d+)(?:,|%2C|\\s|\\+)+(-?\\d+\\.\\d+)",
            "/maps/(?:search|place)/(-?\\d+\\.\\d+)(?:,|%2C|\\+)+\\s*(-?\\d+\\.\\d+)",
            "(?:!|%21)3d(-?\\d+\\.\\d+)(?:!|%21)4d(-?\\d+\\.\\d+)",
            "@(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)",
            "center=(-?\\d+\\.\\d+)(?:%2C|,)(-?\\d+\\.\\d+)"
        };
        for (String p : patterns) {
            Matcher m = Pattern.compile(p, Pattern.CASE_INSENSITIVE).matcher(text);
            if (m.find()) {
                double lat = Double.parseDouble(m.group(1));
                double lng = Double.parseDouble(m.group(2));
                if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    return new double[] { lat, lng };
                }
            }
        }
        Matcher m2d3d = Pattern.compile("(?:!|%21)2d(-?\\d+\\.\\d+)(?:!|%21)3d(-?\\d+\\.\\d+)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (m2d3d.find()) {
            double lng = Double.parseDouble(m2d3d.group(1));
            double lat = Double.parseDouble(m2d3d.group(2));
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                return new double[] { lat, lng };
            }
        }
        return null;
    }

    private double[] extractCoordsFromHtml(String html) {
        if (html == null || html.isEmpty()) return null;
        // ONLY extract explicit pin protobuf markers or staticmap markers= from HTML.
        // Never use center=, !2d!3d, or APP_INITIALIZATION_STATE (Google puts IP-centroid near user's own location there).
        Matcher pinM = Pattern.compile("(?:!|%21)8m2(?:!|%21)3d(-?\\d+\\.\\d+)(?:!|%21)4d(-?\\d+\\.\\d+)|(?:!|%21)3d(-?\\d+\\.\\d+)(?:!|%21)4d(-?\\d+\\.\\d+)", Pattern.CASE_INSENSITIVE).matcher(html);
        if (pinM.find()) {
            double lat = Double.parseDouble(pinM.group(1) != null ? pinM.group(1) : pinM.group(3));
            double lng = Double.parseDouble(pinM.group(2) != null ? pinM.group(2) : pinM.group(4));
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                return new double[] { lat, lng };
            }
        }
        Matcher smM = Pattern.compile("staticmap\\?[^\"'<>]*markers=[^\"'<>]*?(-?\\d+\\.\\d+)(?:%2C|,)(-?\\d+\\.\\d+)", Pattern.CASE_INSENSITIVE).matcher(html);
        if (smM.find()) {
            double lat = Double.parseDouble(smM.group(1));
            double lng = Double.parseDouble(smM.group(2));
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                return new double[] { lat, lng };
            }
        }
        return null;
    }

    private String extractTitleFromHtml(String html) {
        if (html == null) return "";
        Matcher m = Pattern.compile("<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(html);
        if (!m.find()) {
            m = Pattern.compile("<title[^>]*>([^<]+)</title>", Pattern.CASE_INSENSITIVE).matcher(html);
            if (!m.find()) return "";
        }
        String clean = m.group(1)
            .replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\"")
            .replaceAll("\\s*[-–·]\\s*Google Maps\\s*$", "")
            .split("·")[0]
            .trim();
        if (clean.length() < 2 || clean.equalsIgnoreCase("Google Maps") || clean.toLowerCase(Locale.US).startsWith("consent")) {
            return "";
        }
        return clean;
    }
}
'''

    with open(plugin_path, 'w', encoding='utf-8') as f:
        f.write(voltway_native_plugin_java)
    with open(main_activity_path, 'w', encoding='utf-8') as f:
        f.write(main_activity_java)
    print('[VoltWay Build] Wrote VoltWayNativePlugin.java & MainActivity.java cleanly!')
else:
    print(f'[VoltWay Build] MainActivity.java not found at {main_activity_path}')
