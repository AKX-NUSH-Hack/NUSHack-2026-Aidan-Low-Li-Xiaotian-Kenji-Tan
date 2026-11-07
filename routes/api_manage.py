from flask import Blueprint, current_app, request, g

from core.auth import list_users, create_user, update_user, set_password, AuthError
from core.codec import decode_checklist, CodecError
from core.company import (set_logo, clear_logo, get_logo, publish_company_checklist,
                          unpublish_company_checklist, CompanyError)
from core.db import DBError
from core.submissions import list_submissions
from .common import ok, fail, body, manager_required

api_manage = Blueprint("api_manage", __name__, url_prefix="/api/manage")


def _db():
    return current_app.config["DB"]

@api_manage.get("/users")
@manager_required
def users():
    try:
        return ok(users=list_users(_db()))
    except DBError as exc:
        return fail(str(exc), 503)


@api_manage.post("/users")
@manager_required
def add_user():
    try:
        return ok(user=create_user(_db(), body()))
    except AuthError as exc:
        return fail(str(exc), exc.status)
    except DBError as exc:
        return fail(str(exc), 503)

@api_manage.patch("/users/<user_id>")
@manager_required
def edit_user(user_id):
    try:
        return ok(user=update_user(_db(), g.user["uid"], user_id, body()))
    except AuthError as exc:
        return fail(str(exc), exc.status)
    except DBError as exc:
        return fail(str(exc), 503)

@api_manage.post("/users/<user_id>/password")
@manager_required
def reset_password(user_id):
    try:
        set_password(_db(), user_id, body().get("password"))
        return ok()
    except AuthError as exc:
        return fail(str(exc), exc.status)
    except DBError as exc:
        return fail(str(exc), 503)

@api_manage.put("/logo")
@manager_required
def put_logo():
    try:
        svg = set_logo(_db(), body().get("svg", ""), g.user["un"])
        return ok(logo_svg=svg)
    except CompanyError as exc:
        return fail(str(exc), exc.status)
    except DBError as exc:
        return fail(str(exc), 503)

@api_manage.delete("/logo")
@manager_required
def delete_logo():
    try:
        clear_logo(_db(), g.user["un"])
        return ok(logo_svg="")
    except DBError as exc:
        return fail(str(exc), 503)

@api_manage.get("/logo")
@manager_required
def read_logo():
    return ok(logo_svg=get_logo(_db()))

@api_manage.post("/checklists")
@manager_required
def publish():
    code = str(body().get("code", "")).strip()
    try:
        checklist = decode_checklist(code)
        return ok(checklist=publish_company_checklist(_db(), code, checklist["t"], g.user["un"]))
    except CodecError as exc:
        return fail(str(exc))
    except CompanyError as exc:
        return fail(str(exc), exc.status)
    except DBError as exc:
        return fail(str(exc), 503)

@api_manage.delete("/checklists/<checklist_id>")
@manager_required
def unpublish(checklist_id):
    try:
        unpublish_company_checklist(_db(), checklist_id)
        return ok()
    except DBError as exc:
        return fail(str(exc), 503)

@api_manage.get("/submissions")
@manager_required
def submissions():
    username = request.args.get("username") or None
    limit = request.args.get("limit", "200")
    try:
        return ok(submissions=list_submissions(_db(), username=username, limit=int(limit) if limit.isdigit() else 200))
    except DBError as exc:
        return fail(str(exc), 503)