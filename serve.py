#!/usr/bin/env python3
"""FaceCraft: a static server, and a place to put the skins.

The app is plain ES modules and runs from any static server — but not from a
`file://` URL, because modules will not load from one. So there has to be a
server, and once there is one it may as well be useful:

    POST /skin?name=NAME    writes skins/NAME.png and skins/NAME.json,
                            and rebuilds skins/index.json
    POST /shot?name=NAME    writes shots/NAME.png, which is how a change gets
                            looked at without asking anybody to look

Everything else is files off the disk with caching turned off, so an edit is
one reload away.

    python serve.py                on http://localhost:8140
    python serve.py --port 8150    somewhere else
    python serve.py --open         and open a browser at it
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SKIN_DIR = os.path.join(HERE, "skins")
SHOT_DIR = os.path.join(HERE, "shots")
PORT = 8140


def safe_name(raw: str, fallback: str = "skin") -> str:
    """A filename nobody can walk out of the folder with."""
    out = "".join(c for c in raw if c.isalnum() or c in "-_")
    return out[:48] or fallback


def rebuild_index() -> list[str]:
    """skins/index.json is whatever PNGs are actually in the folder."""
    os.makedirs(SKIN_DIR, exist_ok=True)
    names = sorted(
        f[:-4] for f in os.listdir(SKIN_DIR) if f.lower().endswith(".png")
    )
    with open(os.path.join(SKIN_DIR, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(names, fh)
    return names


def decode_data_url(body: str) -> bytes:
    """`data:image/png;base64,...` to bytes, and plain base64 too."""
    payload = body.split(",", 1)[1] if body.startswith("data:") else body
    return base64.b64decode(payload)


class Handler(SimpleHTTPRequestHandler):
    """Files, with caching off, plus the two POSTs above."""

    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def guess_type(self, path):                      # noqa: A003
        # Chrome will not install a web app whose manifest arrives as
        # text/plain, and Python does not know the extension.
        if str(path).endswith(".webmanifest"):
            return "application/manifest+json"
        return super().guess_type(path)

    def reply(self, text: str, code: int = 200) -> None:
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:                       # noqa: N802
        route = self.path.split("?", 1)[0]
        name = "skin"
        if "name=" in self.path:
            from urllib.parse import unquote
            name = unquote(self.path.split("name=", 1)[1].split("&")[0])
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > 12 << 20:
            self.send_error(413, "that is far too big for a 64x64")
            return
        body = self.rfile.read(length).decode("utf-8", "replace")

        if route == "/skin":
            try:
                doc = json.loads(body)
                png = decode_data_url(doc["png"])
            except (ValueError, KeyError, TypeError) as exc:
                self.send_error(400, f"not a skin: {exc}")
                return
            name = safe_name(name)
            os.makedirs(SKIN_DIR, exist_ok=True)
            path = os.path.join(SKIN_DIR, f"{name}.png")
            with open(path, "wb") as fh:
                fh.write(png)
            # the settings beside the picture: a skin you can come back to
            # and carry on adjusting is worth more than a skin you cannot
            doc.pop("png", None)
            doc["name"] = name
            with open(os.path.join(SKIN_DIR, f"{name}.json"), "w", encoding="utf-8") as fh:
                json.dump(doc, fh, separators=(",", ":"))
            rebuild_index()
            print(f"  + skins/{name}.png")
            self.reply(os.path.relpath(path, HERE).replace("\\", "/"))
            return

        if route == "/shot":
            os.makedirs(SHOT_DIR, exist_ok=True)
            path = os.path.join(SHOT_DIR, f"{safe_name(name, 'shot')}.png")
            try:
                with open(path, "wb") as fh:
                    fh.write(decode_data_url(body))
            except (ValueError, OSError) as exc:
                self.send_error(400, str(exc))
                return
            self.reply(os.path.relpath(path, HERE).replace("\\", "/"))
            return

        self.send_error(404)

    def log_message(self, fmt: str, *args: object) -> None:
        pass                                          # quiet


def lan_address() -> str:
    """The address a phone on the same wifi can reach this at."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        addr = s.getsockname()[0]
        s.close()
        return addr
    except OSError:
        return "127.0.0.1"


def main() -> int:
    ap = argparse.ArgumentParser(description="serve FaceCraft")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", PORT)))
    ap.add_argument("--open", action="store_true", help="open a browser at it")
    args = ap.parse_args()

    rebuild_index()
    try:
        httpd = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    except OSError as exc:
        print(f"cannot listen on {args.port}: {exc}")
        print("something is already there — try --port 8150")
        return 1

    url = f"http://localhost:{args.port}/"
    print("FaceCraft")
    print(f"  here   {url}")
    print(f"  phone  http://{lan_address()}:{args.port}/   (same wifi)")
    print("  ctrl-c to stop")
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
