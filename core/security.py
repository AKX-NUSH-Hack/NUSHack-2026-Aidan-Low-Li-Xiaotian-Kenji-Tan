"""
Passwords, session tokens and login throttling.

Passwords
    Stored as:  pbkdf2_sha256$<iterations>$<salt b64url>$<hash b64url>
    PBKDF2-HMAC-SHA256 = SHA-256 run `iterations` times with a random salt
    per user, so two users with the same password get different hashes and
    brute-forcing is slow. The browser can run the same function (Web Crypto
    or static/js/crypto.js) to check a password offline.

Session tokens
    <payload b64url>.<signature b64url>
    payload = {"uid", "un", "role", "exp"}; signature = HMAC-SHA256(APP_SECRET).
    Stateless: nothing to store server-side, and a token cannot be forged
    without the secret.

Throttling
    5 failed logins for the same username -> locked for 60 seconds.
"""
from base64 import urlsafe_b64encode, urlsafe_b64decode
from hashlib import pbkdf2_hmac
from hmac import compare_digest, new as hmac_new
from json import dumps, loads
from secrets import token_bytes, token_urlsafe
from time import time
from threading import Lock

PBKDF2_ITERATIONS = 100_000
PASSWORD_MIN_LEN = 8
PASSWORD_MAX_LEN = 128

def _b64e(raw: bytes) -> str:
    return urlsafe_b64encode(raw).decode("ascii").rstrip("=")

def _b64d(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))

def hash_password(password: str, iterations: int = PBKDF2_ITERATIONS, salt: bytes | None = None) -> str:
    salt = salt or token_bytes(16)
    digest = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_b64e(salt)}${_b64e(digest)}"

def split_hash(stored: str) -> tuple[int, str, str] | None:
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return None
        return int(iterations), salt, digest
    except (ValueError, AttributeError):
        return None

def verify_password(password: str, stored: str) -> bool:
    parts = split_hash(stored or "")
    if not parts:
        return False
    iterations, salt_b64, digest_b64 = parts
    digest = pbkdf2_hmac("sha256", password.encode("utf-8"), _b64d(salt_b64), iterations)
    return compare_digest(_b64e(digest), digest_b64)

def password_problem(password: str) -> str | None:
    """Return a human message if the password is not acceptable, else None."""
    if not isinstance(password, str) or len(password) < PASSWORD_MIN_LEN:
        return f"Password must be at least {PASSWORD_MIN_LEN} characters"
    if len(password) > PASSWORD_MAX_LEN:
        return f"Password must be at most {PASSWORD_MAX_LEN} characters"
    if password.strip() != password:
        return "Password cannot start or end with spaces"
    return None

def make_token(secret: str, user: dict, days: int) -> str:
    payload = {"uid": user["id"], "un": user["username"], "role": user["role"],
               "dn": (user.get("display_name") or user["username"])[:60],
               "exp": int(time()) + days * 86400}
    body = _b64e(dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = _b64e(hmac_new(secret.encode("utf-8"), body.encode("ascii"), "sha256").digest())
    return body + "." + sig

def read_token(secret: str, token: str) -> dict | None:
    """-> payload dict if the signature is valid and not expired, else None."""
    try:
        body, sig = token.split(".")
        expected = _b64e(hmac_new(secret.encode("utf-8"), body.encode("ascii"), "sha256").digest())
        if not compare_digest(expected, sig):
            return None
        payload = loads(_b64d(body).decode("utf-8"))
        if payload.get("exp", 0) < time():
            return None
        return payload
    except (ValueError, AttributeError, UnicodeDecodeError):
        return None

def new_secret() -> str:
    return token_urlsafe(48)

class LoginThrottle:
    MAX_FAILS = 5
    LOCK_SECONDS = 60

    def __init__(self):
        self._fails: dict[str, list] = {}
        self._lock = Lock()

    def locked_for(self, username: str) -> int:
        """Seconds remaining on a lock, 0 if not locked."""
        with self._lock:
            entry = self._fails.get(username)
            if not entry:
                return 0
            remaining = int(entry[1] - time())
            return max(remaining, 0)

    def record_failure(self, username: str) -> None:
        with self._lock:
            entry = self._fails.setdefault(username, [0, 0])
            entry[0] += 1
            if entry[0] >= self.MAX_FAILS:
                entry[1] = time() + self.LOCK_SECONDS
                entry[0] = 0

    def record_success(self, username: str) -> None:
        with self._lock:
            self._fails.pop(username, None)