from getpass import getpass
from pathlib import Path
from sys import path as sys_path

sys_path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `core` imports work from anywhere
from core.security import hash_password, password_problem  # noqa: E402

if __name__ == "__main__":
    first = getpass("Password: ")
    problem = password_problem(first)
    if problem:
        raise SystemExit("Not accepted: " + problem)
    if first != getpass("Again:    "):
        raise SystemExit("Passwords do not match")
    print("\nADMIN_PASSWORD_HASH=" + hash_password(first))
