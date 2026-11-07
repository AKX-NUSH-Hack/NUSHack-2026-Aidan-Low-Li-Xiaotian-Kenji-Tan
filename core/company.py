from datetime import datetime, timezone
from uuid import uuid4
from xml.etree import ElementTree as ET

from .db import DBError

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
MAX_LOGO_BYTES = 50 * 1024
BANNED_TAGS = {"script", "foreignObject", "iframe", "embed", "object", "audio", "video", "animate", "set"}

ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)

class CompanyError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]

def sanitise_svg(text: str) -> str:
    text = (text or "").strip()
    if not text:
        raise CompanyError("No SVG content")
    if len(text.encode("utf-8")) > MAX_LOGO_BYTES:
        raise CompanyError(f"Logo is too big (max {MAX_LOGO_BYTES // 1024} KB). Simplify it or remove embedded images.")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise CompanyError("SVG must not contain a DOCTYPE or entities")

    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise CompanyError(f"Not valid SVG/XML: {exc}") from exc
    if _local(root.tag) != "svg":
        raise CompanyError("The file must start with an <svg> element")

    def clean(element):
        for child in list(element):
            if _local(child.tag) in BANNED_TAGS:
                element.remove(child)
                continue
            clean(child)
        for attr in list(element.attrib):
            name = _local(attr).lower()
            value = element.attrib[attr].strip().lower()
            if name.startswith("on") or value.startswith("javascript:"):
                del element.attrib[attr]
            elif name == "href" and not (value.startswith("#") or value.startswith("data:image/")):
                del element.attrib[attr]
            elif name == "style" and ("url(" in value or "expression(" in value):
                del element.attrib[attr]

    clean(root)

    if "viewBox" not in root.attrib:
        try:
            width = float(str(root.attrib.get("width", "100")).rstrip("px"))
            height = float(str(root.attrib.get("height", "100")).rstrip("px"))
        except ValueError:
            width = height = 100.0
        root.set("viewBox", f"0 0 {width:g} {height:g}")
    root.attrib.pop("width", None)
    root.attrib.pop("height", None)

    return ET.tostring(root, encoding="unicode")

def get_logo(db) -> str:
    try:
        rows = db.select("company_settings", {"key": "logo_svg"}, limit=1)
    except DBError:
        return ""
    return (rows[0].get("value") if rows else "") or ""

def set_logo(db, svg_text: str, actor_username: str) -> str:
    clean = sanitise_svg(svg_text)
    db.upsert("company_settings", [{"key": "logo_svg", "value": clean,
                                    "updated_at": _now(), "updated_by": actor_username}], on_conflict="key")
    return clean

def clear_logo(db, actor_username: str) -> None:
    db.upsert("company_settings", [{"key": "logo_svg", "value": "",
                                    "updated_at": _now(), "updated_by": actor_username}], on_conflict="key")

def list_company_checklists(db) -> list:
    rows = db.select("company_checklists", {"active": True}, order="created_at.desc")
    return [{"id": r["id"], "code": r["code"], "title": r["title"], "created_at": r.get("created_at"),
             "created_by": r.get("created_by")} for r in rows]

def publish_company_checklist(db, code: str, title: str, actor_username: str) -> dict:
    existing = db.select("company_checklists", {"code": code}, limit=1)
    if existing:
        if existing[0].get("active", True):
            raise CompanyError("That checklist is already published", 409)
        db.update("company_checklists", {"id": existing[0]["id"]}, {"active": True, "title": title})
        return {"id": existing[0]["id"], "code": code, "title": title}
    row = {"id": str(uuid4()), "code": code, "title": title, "created_by": actor_username,
           "created_at": _now(), "active": True}
    db.insert("company_checklists", [row])
    return {"id": row["id"], "code": code, "title": title}

def unpublish_company_checklist(db, checklist_id: str) -> None:
    db.update("company_checklists", {"id": checklist_id}, {"active": False})
