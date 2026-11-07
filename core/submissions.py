from datetime import datetime, timezone
from uuid import uuid4, UUID

from .db import DBError

ROW_FIELDS = ("id", "checklist_title", "checklist_code", "results", "notes", "submitted_at", "prev_hash", "hash")
MAX_BATCH = 500

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _valid_uuid(value) -> bool:
    try:
        UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False

def _clean_submission(sub: dict, user: dict) -> dict | None:
    if not isinstance(sub, dict) or not _valid_uuid(sub.get("id")):
        return None
    if not isinstance(sub.get("results"), list):
        return None
    row = {field: sub.get(field) for field in ROW_FIELDS}
    row["id"] = str(sub["id"]).lower()
    row["user_id"] = user["uid"]
    row["username"] = user["un"]
    row["guard"] = str(user.get("dn") or user["un"])[:60]   # from the token, never from the body
    row["checklist_title"] = str(row.get("checklist_title") or "")[:80]
    row["checklist_code"] = str(row.get("checklist_code") or "")[:4000]
    row["notes"] = str(row.get("notes") or "")[:1000]
    row["prev_hash"] = str(row.get("prev_hash") or "")[:128]
    row["hash"] = str(row.get("hash") or "")[:128]
    row["submitted_at"] = str(row.get("submitted_at") or _now())[:40]
    row["received_at"] = _now()
    return row

def push_submissions(db, submissions: list, user: dict) -> dict:
    """-> {"synced": [ids], "failed": [{"id", "error"}]}"""
    rows, failed = [], []
    for sub in submissions[:MAX_BATCH]:
        row = _clean_submission(sub, user)
        if row is None:
            failed.append({"id": str((sub or {}).get("id", "?")) if isinstance(sub, dict) else "?",
                           "error": "invalid submission"})
        else:
            rows.append(row)
    if not rows:
        return {"synced": [], "failed": failed}
    try:
        db.insert("submissions", rows, ignore_duplicates=True, on_conflict="id")
    except DBError as exc:
        return {"synced": [], "failed": failed + [{"id": r["id"], "error": str(exc)} for r in rows]}
    return {"synced": [r["id"] for r in rows], "failed": failed}

def list_submissions(db, username: str | None = None, limit: int = 200) -> list:
    filters = {"username": username} if username else None
    rows = db.select("submissions", filters, order="submitted_at.desc", limit=min(int(limit or 200), 1000))
    return [{k: r.get(k) for k in ("id", "guard", "username", "checklist_title", "checklist_code", "results",
                                    "notes", "submitted_at", "received_at", "prev_hash", "hash")} for r in rows]

def get_user_checklists(db, user_id: str) -> list:
    rows = db.select("user_checklists", {"user_id": user_id}, order="saved_at.desc")
    return [{"code": r["code"], "title": r.get("title") or "", "saved_at": r.get("saved_at")}
            for r in rows if not r.get("deleted")]

def merge_user_checklists(db, user_id: str, added: list, removed: list) -> list:
    """Apply the device's changes, then return the user's full list."""
    rows = []
    for item in added[:200]:
        if not isinstance(item, dict) or not str(item.get("code", "")).startswith("CL1."):
            continue
        rows.append({"id": str(uuid4()), "user_id": user_id, "code": str(item["code"])[:4000],
                     "title": str(item.get("title") or "")[:80], "saved_at": str(item.get("saved_at") or _now())[:40],
                     "deleted": False})
    if rows:
        # upsert on (user_id, code): re-saving a deleted one brings it back
        db.upsert("user_checklists", rows, on_conflict="user_id,code")
    for code in removed[:200]:
        db.update("user_checklists", {"user_id": user_id, "code": str(code)}, {"deleted": True})
    return get_user_checklists(db, user_id)