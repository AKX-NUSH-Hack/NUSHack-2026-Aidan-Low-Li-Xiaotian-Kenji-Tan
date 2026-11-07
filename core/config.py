from pathlib import Path

DEFAULTS = {
    "SUPABASE_URL": "",
    "SUPABASE_KEY": "",
    "COMPANY_NAME": "My Company",
    "ADMIN_USERNAME": "admin",
    "ADMIN_PASSWORD": "",
    "ADMIN_PASSWORD_HASH": "",
    "APP_SECRET": "",
    "SESSION_DAYS": "30",
    "HOST": "0.0.0.0",
    "PORT": "5000",
    "DEBUG": "false",
}

PLACEHOLDERS = {"", "your-key", "your-supabase-key", "https://xxxx.supabase.co", "paste-here", "change-me"}

def load_config(primary: Path, fallback: Path | None = None) -> dict:
    path = primary if primary.exists() else fallback
    settings = dict(DEFAULTS)

    if path is None or not path.exists():
        print("[config] No config file found - using defaults (LOCAL mode).")
        return settings

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        settings[key.strip().upper()] = value.strip().strip('"').strip("'")

    if path != primary:
        print(f"[config] Using {path.name}. Copy it to {primary.name} and fill in your own values.")
    return settings

def supabase_ready(settings: dict) -> bool:
    url = settings.get("SUPABASE_URL", "").strip()
    key = settings.get("SUPABASE_KEY", "").strip()
    return url not in PLACEHOLDERS and key not in PLACEHOLDERS and url.startswith("http")

def as_bool(value) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")