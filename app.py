"""
v1.3 - NUSH Hack 2026 (BITS)

Run:   python app.py
Open:  http://localhost:5000  (or http://<your-ip>:5000 from a phone on the same Wi-Fi)
"""

from pathlib import Path
from secrets import token_urlsafe
from sys import argv
from threading import Timer

from flask import Flask, jsonify

from core.config import load_config, supabase_ready, as_bool
from core.db import SupabaseDB, LocalDB
from core.security import new_secret
from core.auth import bootstrap_admin
from core.qr import QR_AVAILABLE
from routes.pages import pages
from routes.api_auth import api_auth
from routes.api_data import api_data
from routes.api_manage import api_manage

VERSION = "1.3"

BOOT_ID = token_urlsafe(8)
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


def _secret(settings: dict) -> str:
    # APP_SECRET signs login tokens. If config.txt has none, keep a generated one in data/secret.txt.
    if settings.get("APP_SECRET"):
        return settings["APP_SECRET"]
    path = DATA_DIR / "secret.txt"
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    secret = new_secret()
    path.write_text(secret, encoding="utf-8")
    print("[auth] No APP_SECRET in config.txt, so one was generated into data/secret.txt.")
    print("       Keep that file (or move the value into config.txt), or everyone will have to")
    print("       log in again the next time you move the app to a new folder.")
    return secret


def create_app() -> Flask:
    settings = load_config(BASE_DIR / "config.txt", BASE_DIR / "config.example.txt")
    settings["APP_SECRET"] = _secret(settings)

    if supabase_ready(settings):
        db, mode = SupabaseDB(settings["SUPABASE_URL"], settings["SUPABASE_KEY"]), "supabase"
    else:
        db, mode = LocalDB(DATA_DIR / "db"), "local"

    app = Flask(__name__, template_folder=str(BASE_DIR / "templates"), static_folder=str(BASE_DIR / "static"))
    qr_lib = (BASE_DIR / "static" / "js" / "vendor" / "jsQR.js").exists()

    app.config.update(
        SETTINGS=settings, DB=db, DB_MODE=mode, APP_SECRET=settings["APP_SECRET"],
        COMPANY_NAME=settings.get("COMPANY_NAME") or "My Company", VERSION=VERSION, BOOT_ID=BOOT_ID,
        QR_AVAILABLE=QR_AVAILABLE, QR_LIB=qr_lib, JSON_SORT_KEYS=False, MAX_CONTENT_LENGTH=2 * 1024 * 1024,
    )

    for blueprint in (pages, api_auth, api_data, api_manage):
        app.register_blueprint(blueprint)

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "version": VERSION, "mode": mode, "qr": QR_AVAILABLE,
                        "scanning": qr_lib, "company": app.config["COMPANY_NAME"], "boot": BOOT_ID})

    @app.errorhandler(404)
    def not_found(_):
        return jsonify({"ok": False, "error": "Not found"}), 404

    @app.errorhandler(413)
    def too_large(_):
        return jsonify({"ok": False, "error": "Request too large"}), 413

    bootstrap_admin(db, settings)
    return app


app = create_app()

def _open_browser(port: int) -> None:
    from webbrowser import open as open_url
    Timer(1.5, lambda: open_url(f"http://localhost:{port}")).start()


if __name__ == "__main__":
    s = app.config["SETTINGS"]
    host, port = s.get("HOST", "0.0.0.0"), int(s.get("PORT", "5000"))
    debug = as_bool(s.get("DEBUG"))

    print(f"\n  listly v{VERSION}")
    print(f"  Open this in your browser:  http://localhost:{port}")
    if host == "0.0.0.0":
        print(f"  From a phone on the same Wi-Fi: http://<this computer's IP>:{port}")
    print(f"  Storing data in: {'Supabase' if app.config['DB_MODE'] == 'supabase' else 'this computer (data/db) - add Supabase keys to config.txt to change'}")
    print(f"  QR codes: {'on' if QR_AVAILABLE else 'OFF - run: pip install qrcode'}")
    if app.config["QR_LIB"]:
        print("  QR scanning: on")
    else:
        print("  QR scanning: OFF - see static/js/vendor/PUT-jsQR.js-HERE.txt (one file, 30 seconds)")
    print("\n  Leave this window open. Press Ctrl+C to stop.\n")

    if "--open" in argv and not debug:
        _open_browser(port)
    app.run(host=host, port=port, debug=debug)
