from json import dumps, loads
from pathlib import Path
from threading import Lock

from requests import get, post, patch, delete, RequestException


class DBError(Exception):
    """Error flag."""

UNIQUE_KEYS = {
    "users": ("id", "username"),
    "submissions": ("id",),
    "user_checklists": ("id", ("user_id", "code")),
    "company_settings": ("key",),
    "company_checklists": ("id", "code"),
}

class SupabaseDB:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1/"
        self.headers = {"apikey": key, "Authorization": "Bearer " + key,
                        "Content-Type": "application/json"}

    def _call(self, method, table, params=None, body=None, prefer=None):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        try:
            response = method(self.base + table, params=params, headers=headers,
                              data=dumps(body) if body is not None else None, timeout=12)
        except RequestException as exc:
            raise DBError(f"Cannot reach Supabase: {exc.__class__.__name__}") from exc
        if response.status_code >= 400:
            raise DBError(f"Supabase error {response.status_code}: {response.text[:160]}")
        if response.text.strip():
            try:
                return response.json()
            except ValueError:
                return None
        return None

    @staticmethod
    def _params(filters: dict | None) -> dict:
        return {col: f"eq.{val}" for col, val in (filters or {}).items()}

    def select(self, table, filters=None, order=None, limit=None, columns="*"):
        params = self._params(filters)
        params["select"] = columns
        if order:
            params["order"] = order
        if limit:
            params["limit"] = str(limit)
        return self._call(get, table, params=params) or []

    def insert(self, table, rows, ignore_duplicates=False, on_conflict=None):
        prefer = "return=minimal"
        params = {}
        if ignore_duplicates:
            prefer += ",resolution=ignore-duplicates"
            if on_conflict:
                params["on_conflict"] = on_conflict
        self._call(post, table, params=params, body=rows, prefer=prefer)

    def upsert(self, table, rows, on_conflict):
        self._call(post, table, params={"on_conflict": on_conflict}, body=rows,
                   prefer="return=minimal,resolution=merge-duplicates")

    def update(self, table, filters, values):
        self._call(patch, table, params=self._params(filters), body=values, prefer="return=minimal")

    def delete(self, table, filters):
        if not filters:
            raise DBError("Refusing to delete without a filter")
        self._call(delete, table, params=self._params(filters), prefer="return=minimal")

class LocalDB:
    def __init__(self, folder: Path):
        self.folder = folder
        self.folder.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

    def _path(self, table) -> Path:
        return self.folder / f"{table}.json"

    def _read(self, table) -> list:
        path = self._path(table)
        if not path.exists():
            return []
        try:
            return loads(path.read_text(encoding="utf-8"))
        except ValueError:
            return []

    def _write(self, table, rows) -> None:
        self._path(table).write_text(dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")

    @staticmethod
    def _matches(row, filters) -> bool:
        return all(str(row.get(col)) == str(val) for col, val in (filters or {}).items())

    @staticmethod
    def _conflicts(a, b, keys) -> bool:
        for key in keys:
            cols = key if isinstance(key, tuple) else (key,)
            if all(a.get(c) is not None and a.get(c) == b.get(c) for c in cols):
                return True
        return False

    def select(self, table, filters=None, order=None, limit=None, columns="*"):
        with self._lock:
            rows = [r for r in self._read(table) if self._matches(r, filters)]
        if order:
            col, _, direction = order.partition(".")
            rows.sort(key=lambda r: str(r.get(col) or ""), reverse=(direction == "desc"))
        if limit:
            rows = rows[:limit]
        return rows

    def insert(self, table, rows, ignore_duplicates=False, on_conflict=None):
        keys = UNIQUE_KEYS.get(table, ("id",))
        with self._lock:
            existing = self._read(table)
            for row in rows:
                if any(self._conflicts(row, old, keys) for old in existing):
                    if ignore_duplicates:
                        continue
                    raise DBError("Already exists")
                existing.append(row)
            self._write(table, existing)

    def upsert(self, table, rows, on_conflict):
        keys = UNIQUE_KEYS.get(table, ("id",))
        with self._lock:
            existing = self._read(table)
            for row in rows:
                for index, old in enumerate(existing):
                    if self._conflicts(row, old, keys):
                        existing[index] = {**old, **row}
                        break
                else:
                    existing.append(row)
            self._write(table, existing)

    def update(self, table, filters, values):
        with self._lock:
            rows = self._read(table)
            for row in rows:
                if self._matches(row, filters):
                    row.update(values)
            self._write(table, rows)

    def delete(self, table, filters):
        if not filters:
            raise DBError("Refusing to delete without a filter")
        with self._lock:
            rows = [r for r in self._read(table) if not self._matches(r, filters)]
            self._write(table, rows)