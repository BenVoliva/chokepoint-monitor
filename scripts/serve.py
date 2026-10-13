#!/usr/bin/env python3
"""Serve the site locally for development:  python3 scripts/serve.py [port]

The page loads its data with fetch(), which browsers block on file:// pages,
so it needs a local web server.  Responses are sent uncached so an edit shows
up on the next reload.  Standard library only.
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as server:
        print(f"Serving {ROOT} at http://localhost:{PORT}", flush=True)
        server.serve_forever()
