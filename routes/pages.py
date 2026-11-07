from pathlib import Path

from flask import Blueprint, render_template, current_app, send_file, request, redirect, url_for

pages = Blueprint("pages", __name__)


def _render(template: str, active: str):
    return render_template(template, active=active,
                           company_name=current_app.config["COMPANY_NAME"],
                           version=current_app.config["VERSION"],
                           boot_id=current_app.config["BOOT_ID"],
                           qr_available=current_app.config["QR_AVAILABLE"],
                           qr_lib=current_app.config["QR_LIB"])

@pages.get("/login")
def login():
    return _render("login.html", "login")

@pages.get("/")
def home():
    code = request.args.get("code")
    if code:
        return redirect(url_for("pages.checklist", code=code))
    return _render("home.html", "home")

@pages.get("/checklist")
def checklist():
    return _render("checklist.html", "checklist")

@pages.get("/create")
def create():
    return _render("create.html", "create")

@pages.get("/settings")
def settings():
    return _render("settings.html", "settings")

@pages.get("/manage")
def manage():
    return _render("manage.html", "manage")

@pages.get("/sw.js")
def service_worker():
    path = Path(current_app.root_path) / "static" / "js" / "sw.js"
    return send_file(path, mimetype="application/javascript")