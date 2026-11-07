from functools import wraps

from flask import current_app, request, jsonify, g

from core.security import read_token

def ok(**data):
    data["ok"] = True
    return jsonify(data)

def fail(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status

def token_user() -> dict | None:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return read_token(current_app.config["APP_SECRET"], header[7:].strip())

def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        user = token_user()
        if not user:
            return fail("Please log in again", 401)
        g.user = user
        return view(*args, **kwargs)
    return wrapper

def manager_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        user = token_user()
        if not user:
            return fail("Please log in again", 401)
        if user.get("role") != "manager":
            return fail("Managers only", 403)
        # Re-check against the database: a demoted or deactivated manager loses access immediately
        from core.auth import get_user
        row = get_user(current_app.config["DB"], user["uid"])
        if not row or row.get("role") != "manager" or not row.get("active", True):
            return fail("Manager access has been removed. Please log in again.", 403)
        g.user = user
        return view(*args, **kwargs)
    return wrapper

def body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}