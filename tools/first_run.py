from getpass import getpass
from pathlib import Path
from shutil import copyfile
from sys import path as sys_path, version_info, exit as sys_exit

sys_path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.security import hash_password, password_problem, new_secret  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG = BASE_DIR / "config.txt"

LINE = "-" * 58


def ask(question: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    answer = input(f"{question}{suffix}: ").strip()
    return answer or default


def ask_yes_no(question: str, default: bool = False) -> bool:
    suffix = " [Y/n]" if default else " [y/N]"
    answer = input(f"{question}{suffix}: ").strip().lower()
    if not answer:
        return default
    return answer.startswith("y")


def ask_password() -> str:
    while True:
        try:
            first = getpass("  Password (you will not see it as you type): ")
            again = getpass("  Type it again: ")
        except (EOFError, OSError):
            print("  (this window cannot hide typing, so the password will show)")
            first = input("  Password: ")
            again = input("  Type it again: ")

        problem = password_problem(first)
        if problem:
            print(f"  -> {problem}. Try again.\n")
            continue
        if first != again:
            print("  -> Those did not match. Try again.\n")
            continue
        return first


def existing_secret() -> str:
    if not CONFIG.exists():
        return ""
    for raw in CONFIG.read_text(encoding="utf-8").splitlines():
        if raw.strip().startswith("APP_SECRET="):
            return raw.split("=", 1)[1].strip()
    return ""


def write_config(values: dict) -> None:
    text = f"""# ---------------------------------------------------------------
#  listly - settings
#  Made by tools/first_run.py. You can edit this file in Notepad.
#  Never upload this file: it holds your password hash and keys.
# ---------------------------------------------------------------

# Shown in the app header
COMPANY_NAME={values['company']}

# --- Supabase (Project Settings -> API) --------------------------
# Leave these blank to keep everything on this computer (data/db/*.json).
# Use the service_role key: only the server talks to Supabase, never the browser.
SUPABASE_URL={values['url']}
SUPABASE_KEY={values['key']}

# --- First manager account ---------------------------------------
ADMIN_USERNAME={values['username']}
# The password itself is not stored, only this one-way hash of it.
ADMIN_PASSWORD_HASH={values['hash']}

# --- Sessions ----------------------------------------------------
# Signs the login tokens stored in each browser. Keep this file when you
# update the app, or everyone has to log in again.
APP_SECRET={values['secret']}
SESSION_DAYS=30

# --- Server ------------------------------------------------------
# 0.0.0.0 lets phones on the same Wi-Fi reach this computer
HOST=0.0.0.0
PORT={values['port']}
DEBUG=false
"""
    if CONFIG.exists():
        copyfile(CONFIG, CONFIG.with_suffix(".txt.backup"))
        print("  (your old config.txt was saved as config.txt.backup)")
    CONFIG.write_text(text, encoding="utf-8")


def main() -> None:
    if version_info < (3, 10):
        print(f"This needs Python 3.10 or newer. You have {version_info.major}.{version_info.minor}.")
        sys_exit(1)

    print()
    print(LINE)
    print("  listly - first-time setup")
    print(LINE)
    print("  Press Enter to accept the [default] settings.")
    print()

    print("STEP 1 of 4   Your company or team name")
    print("              This shows at the top of the app.")
    company = ask("  Name", "My Company")
    print()

    print("STEP 2 of 4   The manager account")
    print("              This is the account you will log in with. It can add")
    print("              other users later, from the Manage tab.")
    username = ask("  Username", "admin").strip().lower()
    print()
    print("              Now choose a password. At least 8 characters.")
    password = ask_password()
    print("  Saved.")
    print()

    print("STEP 3 of 4   Where should finished checklists be stored?")
    print("              If you say no, everything is kept on this computer in")
    print("              data/db/. The app works fully. You can add Supabase later")
    print("              by editing config.txt.")
    url = key = ""
    if ask_yes_no("  Do you have a Supabase project ready", False):
        print()
        print("              In Supabase: Project Settings -> API")
        url = ask("  Project URL (https://....supabase.co)")
        key = ask("  service_role key")
        if not url.startswith("http"):
            print("  -> That does not look like a URL, so local storage will be used instead.")
            url = key = ""
        else:
            print()
            print("  Remember to run supabase_schema.sql in the Supabase SQL Editor,")
            print("  or the app will not find its tables.")
    else:
        print("  Using this computer. Nothing else to set up.")
    print()

    print("STEP 4 of 4   Which port should the app use?")
    print("              5000 is normal. Change it only if something else uses it.")
    port = ask("  Port", "5000")
    if not port.isdigit():
        port = "5000"
    print()

    write_config({"company": company, "username": username, "hash": hash_password(password),
                  "url": url, "key": key, "port": port,
                  "secret": existing_secret() or new_secret()})

    print(LINE)
    print("  Setup done. config.txt has been written.")
    print(LINE)
    print(f"  Log in as:  {username}")
    print("  Password:   the password you just chose")
    print(f"  Address:    http://localhost:{port}")
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nStopped. Nothing was saved. Run it again when you are ready.\n")
        sys_exit(1)
