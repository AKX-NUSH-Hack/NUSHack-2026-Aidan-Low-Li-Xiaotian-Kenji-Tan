from zlib import compress, decompress, error as ZlibError
from base64 import urlsafe_b64encode, urlsafe_b64decode
from json import dumps, loads, JSONDecodeError

PREFIX = "CL1."
KINDS = {"b", "i", "f", "s"}
MAX_ITEMS = 200
MAX_NAME_LEN = 120
MAX_TITLE_LEN = 80


class CodecError(ValueError):
    """Error flag."""

def normalise_checklist(obj) -> dict:
    if not isinstance(obj, dict):
        raise CodecError("Checklist must be an object")

    title = str(obj.get("t") or obj.get("title") or "").strip()
    if not title:
        raise CodecError("Checklist needs a title")
    if len(title) > MAX_TITLE_LEN:
        raise CodecError(f"Title is too long (max {MAX_TITLE_LEN} characters)")

    raw_items = obj.get("i") if "i" in obj else obj.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise CodecError("Checklist needs at least one item")
    if len(raw_items) > MAX_ITEMS:
        raise CodecError(f"Too many items (max {MAX_ITEMS})")

    items = []
    for index, item in enumerate(raw_items, start=1):
        if not isinstance(item, dict):
            raise CodecError(f"Item {index} is not valid")
        name = str(item.get("n") or item.get("name") or "").strip()
        kind = str(item.get("k") or item.get("kind") or "b").strip().lower()
        if not name:
            raise CodecError(f"Item {index} has no name")
        if len(name) > MAX_NAME_LEN:
            raise CodecError(f"Item {index} name is too long (max {MAX_NAME_LEN})")
        if kind not in KINDS:
            raise CodecError(f"Item {index} has unknown type '{kind}' (use b, i, f or s)")
        items.append({"n": name, "k": kind})

    return {"v": 1, "t": title, "i": items}


def encode_checklist(obj) -> str:
    clean = normalise_checklist(obj)
    raw = dumps(clean, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    packed = compress(raw, 9)
    b64 = urlsafe_b64encode(packed).decode("ascii").rstrip("=")
    return PREFIX + b64


def decode_checklist(code: str) -> dict:
    code = (code or "").strip()
    if not code.startswith(PREFIX):
        raise CodecError(f"Not a checklist code (should start with {PREFIX})")

    b64 = code[len(PREFIX):]
    b64 += "=" * (-len(b64) % 4)  # restore padding stripped during encoding
    try:
        packed = urlsafe_b64decode(b64)
        raw = decompress(packed)
        obj = loads(raw.decode("utf-8"))
    except (ValueError, ZlibError, JSONDecodeError, UnicodeDecodeError) as exc:
        raise CodecError("Code is corrupted or incomplete") from exc

    return normalise_checklist(obj)