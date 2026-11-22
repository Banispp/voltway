import http.server
import socketserver
import os
import sys

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
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), VoltWayHandler) as httpd:
        print("=======================================================")
        print("VoltWay 2W - EV Route Planner Server (Fresh No-Cache)")
        print("=======================================================")
        print(f"App running locally at: http://localhost:{PORT}")
        print("Serving PWA, Leaflet Maps, and 4,727 2W EV Chargers")
        print("Live on Local Network: http://192.168.31.230:8080")
        print("=======================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
