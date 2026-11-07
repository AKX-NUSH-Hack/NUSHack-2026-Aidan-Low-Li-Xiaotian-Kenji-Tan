
from flask import Blueprint, current_app, g

from core.auth import login as do_login, change_own_password, get_user, public_user, AuthError
from core.db import DBError
from .common import ok, fail, body, login_required

api_auth = Blueprint("api_auth", __name__, url_prefix="/api/auth")


@api_auth.post("/login")
def login():
    data = body()
    try:
        result = do_login(current_app.config["DB"], current_app.config["SETTINGS"],
                          data.get("username"), data.get("password"))
    except AuthError as exc:
        return fail(str(exc), exc.status)
    return ok(**result)


@api_auth.get("/me")
@login_required
def me():
    try:
        row = get_user(current_app.config["DB"], g.user["uid"])
    except DBError as exc:
        return fail(str(exc), 503)
    if not row or not row.get("active", True):
        return fail("This account is no longer active", 403)
    return ok(user=public_user(row))


@api_auth.post("/password")
@login_required
def password():
    data = body()
    try:
        offline = change_own_password(current_app.config["DB"], g.user["uid"],
                                      data.get("current"), data.get("new"))
    except AuthError as exc:
        return fail(str(exc), exc.status)
    except DBError as exc:
        return fail(str(exc), 503)
    return ok(offline=offline)
