import http.server
import socketserver
import os
import sys
import json
import urllib.parse
import urllib.request

# Ensure UTF-8 output on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

PORT = 8080

class VoltWayHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Force aggressive no-cache on all responses so developer changes take effect immediately
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, post-check=0, pre-check=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    # Never return 304 Not Modified - always serve fresh 200 OK
    def send_error(self, code, message=None, explain=None):
        super().send_error(code, message, explain)

    def do_GET(self):
        # API: Resolve Google Maps short links (maps.app.goo.gl / goo.gl/maps)
        if self.path.startswith('/api/resolve-maps-url'):
            parsed_query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            target_url = parsed_query.get('url', [''])[0].strip()
            parsed_target = urllib.parse.urlparse(target_url) if target_url else None
            allowed_hosts = {'maps.app.goo.gl', 'goo.gl', 'g.co', 'share.google'}
            target_host = (parsed_target.hostname or '').lower() if parsed_target else ''
            is_google_host = target_host in allowed_hosts or target_host.endswith('.google.com') or target_host.endswith('.google.co.in')
            if parsed_target and parsed_target.scheme in ('http', 'https') and is_google_host:
                try:
                    req = urllib.request.Request(
                        target_url,
                        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
                    )
                    with urllib.request.urlopen(req, timeout=6) as response:
                        final_url = response.geturl()
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json; charset=utf-8')
                        self.end_headers()
                        self.wfile.write(json.dumps({'success': True, 'resolved_url': final_url}).encode('utf-8'))
                        return
                except Exception as e:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(json.dumps({'success': False, 'error': str(e), 'url': target_url}).encode('utf-8'))
                    return
            self.send_response(400)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': 'Invalid or disallowed target URL'}).encode('utf-8'))
            return

        # Remove conditional headers from incoming request to prevent SimpleHTTPRequestHandler from sending 304
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        if 'If-None-Match' in self.headers:
            del self.headers['If-None-Match']
        super().do_GET()

    def guess_type(self, path):
        if path.endswith('.js'):
            return 'application/javascript; charset=utf-8'
        if path.endswith('.json') or path.endswith('.webmanifest'):
            return 'application/json; charset=utf-8'
        if path.endswith('.css'):
            return 'text/css; charset=utf-8'
        if path.endswith('.svg'):
            return 'image/svg+xml'
        return super().guess_type(path)

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), VoltWayHandler) as httpd:
        print("=======================================================")
        print("VoltWay 2W - EV Route Planner Server (Fresh No-Cache)")
        print("=======================================================")
        print(f"App running locally at: http://localhost:{PORT}")
        print("Serving PWA, Leaflet Maps, and chargers_db.json")
        print("=======================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
