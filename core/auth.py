from datetime import datetime, timezone
from re import fullmatch
from uuid import uuid4

from .db import DBError
from .security import (hash_password, verify_password, password_problem, make_token,
                       split_hash, LoginThrottle)

ROLES = ("guard", "manager")
USERNAME_RE = r"[a-z0-9][a-z0-9._-]{2,31}"
THROTTLE = LoginThrottle()

class AuthError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def public_user(row: dict) -> dict:
    return {"id": row["id"], "username": row["username"], "display_name": row.get("display_name") or row["username"],
            "role": row.get("role", "guard"), "active": bool(row.get("active", True)),
            "created_at": row.get("created_at")}

def clean_username(value) -> str:
    username = str(value or "").strip().lower()
    if not fullmatch(USERNAME_RE, username):
        raise AuthError("Username: 3-32 characters, letters, numbers, dots, dashes or underscores")
    return username

def clean_display_name(value, fallback: str) -> str:
    name = " ".join(str(value or "").split())[:60]
    return name or fallback

def find_user(db, username: str) -> dict | None:
    rows = db.select("users", {"username": username}, limit=1)
    return rows[0] if rows else None

def get_user(db, user_id: str) -> dict | None:
    rows = db.select("users", {"id": user_id}, limit=1)
    return rows[0] if rows else None

def bootstrap_admin(db, settings: dict) -> None:
    """Make sure the first manager from config.txt exists."""
    try:
        username = clean_username(settings.get("ADMIN_USERNAME") or "admin")
    except AuthError:
        print("[auth] ADMIN_USERNAME in config.txt is not valid - using 'admin'")
        username = "admin"

    try:
        if find_user(db, username):
            return
        stored = (settings.get("ADMIN_PASSWORD_HASH") or "").strip()
        plain = (settings.get("ADMIN_PASSWORD") or "").strip()
        if stored and split_hash(stored):
            password_hash = stored
        elif plain:
            password_hash = hash_password(plain)
            print("[auth] ADMIN_PASSWORD is in plain text. Tip: run  python tools/hash_password.py  and put the")
            print("       result in ADMIN_PASSWORD_HASH instead, then delete ADMIN_PASSWORD.")
        else:
            print(f"[auth] No ADMIN_PASSWORD set - manager account '{username}' was NOT created.")
            return
        db.insert("users", [{"id": str(uuid4()), "username": username, "display_name": "Manager",
                             "role": "manager", "password": password_hash, "active": True,
                             "created_at": _now()}])
        print(f"[auth] Created first manager account: {username}")
    except DBError as exc:
        print(f"[auth] Could not check/create the manager account: {exc}")

def login(db, settings: dict, username, password) -> dict:
    """-> {"token", "user", "offline": {"iterations", "salt", "hash"}} or raises AuthError."""
    username = str(username or "").strip().lower()
    password = str(password or "")
    if not username or not password:
        raise AuthError("Enter your username and password")

    wait = THROTTLE.locked_for(username)
    if wait:
        raise AuthError(f"Too many attempts. Try again in {wait} s", 429)

    try:
        row = find_user(db, username)
    except DBError as exc:
        raise AuthError(f"Server cannot reach the database ({exc})", 503) from exc

    if not row or not verify_password(password, row.get("password", "")):
        THROTTLE.record_failure(username)
        raise AuthError("Wrong username or password", 401)
    if not row.get("active", True):
        raise AuthError("This account has been deactivated. Ask a manager.", 403)

    THROTTLE.record_success(username)
    iterations, salt, digest = split_hash(row["password"])
    return {
        "token": make_token(settings["APP_SECRET"], row, int(settings.get("SESSION_DAYS") or 30)),
        "user": public_user(row),
        # lets the device verify the same password offline later
        "offline": {"iterations": iterations, "salt": salt, "hash": digest},
    }

def list_users(db) -> list:
    return [public_user(r) for r in db.select("users", order="username.asc")]


def create_user(db, data: dict) -> dict:
    username = clean_username(data.get("username"))
    role = str(data.get("role") or "guard").lower()
    if role not in ROLES:
        raise AuthError("Role must be guard or manager")
    problem = password_problem(data.get("password"))
    if problem:
        raise AuthError(problem)
    if find_user(db, username):
        raise AuthError("That username is already taken", 409)

    row = {"id": str(uuid4()), "username": username,
           "display_name": clean_display_name(data.get("display_name"), username),
           "role": role, "password": hash_password(data["password"]), "active": True, "created_at": _now()}
    db.insert("users", [row])
    return public_user(row)


def _active_manager_count(db) -> int:
    return sum(1 for r in db.select("users", {"role": "manager"}) if r.get("active", True))


def update_user(db, actor_id: str, user_id: str, data: dict) -> dict:
    """Change role / active / display_name. Guards against locking everyone out."""
    row = get_user(db, user_id)
    if not row:
        raise AuthError("User not found", 404)

    changes = {}
    if "display_name" in data:
        changes["display_name"] = clean_display_name(data["display_name"], row["username"])
    if "role" in data:
        role = str(data["role"]).lower()
        if role not in ROLES:
            raise AuthError("Role must be guard or manager")
        changes["role"] = role
    if "active" in data:
        changes["active"] = bool(data["active"])

    becoming_non_manager = (changes.get("role", row["role"]) != "manager") or not changes.get("active", row.get("active", True))
    if row["role"] == "manager" and becoming_non_manager:
        if user_id == actor_id:
            raise AuthError("You cannot remove your own manager access")
        if _active_manager_count(db) <= 1:
            raise AuthError("There must always be at least one active manager")

    if changes:
        db.update("users", {"id": user_id}, changes)
        row.update(changes)
    return public_user(row)


def set_password(db, user_id: str, new_password) -> None:
    problem = password_problem(new_password)
    if problem:
        raise AuthError(problem)
    if not get_user(db, user_id):
        raise AuthError("User not found", 404)
    db.update("users", {"id": user_id}, {"password": hash_password(new_password)})


def change_own_password(db, user_id: str, current, new_password) -> dict:
    row = get_user(db, user_id)
    if not row or not verify_password(str(current or ""), row.get("password", "")):
        raise AuthError("Current password is wrong", 401)
    set_password(db, user_id, new_password)
    iterations, salt, digest = split_hash(get_user(db, user_id)["password"])
    return {"iterations": iterations, "salt": salt, "hash": digest}