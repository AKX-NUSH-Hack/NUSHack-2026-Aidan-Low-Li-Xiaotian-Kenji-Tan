from flask import Blueprint, current_app, request, g, Response

from core.codec import encode_checklist, decode_checklist, CodecError
from core.company import get_logo, list_company_checklists
from core.db import DBError
from core.qr import qr_svg
from core.submissions import push_submissions, get_user_checklists, merge_user_checklists, list_submissions
from .common import ok, fail, body, login_required

api_data = Blueprint("api_data", __name__)

@api_data.post("/api/encode")
def encode():
    data = body()
    try:
        return ok(code=encode_checklist(data.get("checklist", data)))
    except CodecError as exc:
        return fail(str(exc))


@api_data.post("/api/decode")
def decode():
    try:
        return ok(checklist=decode_checklist(body().get("code", "")))
    except CodecError as exc:
        return fail(str(exc))


@api_data.get("/qr.svg")
def qr_image():
    code = request.args.get("code", "")
    try:
        decode_checklist(code)
    except CodecError as exc:
        return fail(str(exc))
    try:
        svg = qr_svg(code, get_logo(current_app.config["DB"]))
    except RuntimeError as exc:
        return fail(str(exc), 503)
    return Response(svg, mimetype="image/svg+xml",
                    headers={"Cache-Control": "no-cache", "Content-Disposition": "inline; filename=checklist-qr.svg"})

@api_data.post("/api/sync")
@login_required
def sync():
    submissions = body().get("submissions")
    if not isinstance(submissions, list):
        return fail("submissions must be a list")
    result = push_submissions(current_app.config["DB"], submissions, g.user)
    return ok(**result, mode=current_app.config["DB_MODE"])


@api_data.get("/api/me/submissions")
@login_required
def my_submissions():
    try:
        rows = list_submissions(current_app.config["DB"], username=g.user["un"], limit=100)
    except DBError as exc:
        return fail(str(exc), 503)
    return ok(submissions=rows)

@api_data.get("/api/me/checklists")
@login_required
def my_checklists():
    try:
        return ok(checklists=get_user_checklists(current_app.config["DB"], g.user["uid"]))
    except DBError as exc:
        return fail(str(exc), 503)


@api_data.post("/api/me/checklists")
@login_required
def merge_checklists():
    data = body()
    added = data.get("added") if isinstance(data.get("added"), list) else []
    removed = data.get("removed") if isinstance(data.get("removed"), list) else []
    try:
        return ok(checklists=merge_user_checklists(current_app.config["DB"], g.user["uid"], added, removed))
    except DBError as exc:
        return fail(str(exc), 503)

@api_data.get("/api/company")
@login_required
def company():
    db = current_app.config["DB"]
    try:
        return ok(name=current_app.config["COMPANY_NAME"], logo_svg=get_logo(db),
                  checklists=list_company_checklists(db))
    except DBError as exc:
        return fail(str(exc), 503)