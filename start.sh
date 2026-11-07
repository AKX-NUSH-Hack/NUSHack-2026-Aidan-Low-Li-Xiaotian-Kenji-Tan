#!/usr/bin/env bash
# =====================================================================
#  listly - Mac / Linux start script
#  Run it with:   ./start.sh      (first time: chmod +x start.sh)
#  It checks Python, installs what is needed, runs first-time setup,
#  then starts the app.
# =====================================================================
cd "$(dirname "$0")" || exit 1

echo
echo "=========================================================="
echo "  Starting listly"
echo "=========================================================="
echo

# ---------- Find Python ----------
PY=""
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
        if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
            PY="$candidate"
            break
        fi
    fi
done

if [ -z "$PY" ]; then
    echo "[X] Python 3.10 or newer was not found."
    echo
    echo "    Mac:    brew install python3    (or get it from python.org)"
    echo "    Linux:  sudo apt install python3 python3-pip"
    echo
    echo "    Then run ./start.sh again."
    echo
    exit 1
fi
echo "[1/4] Found Python: $($PY --version)"

# ---------- Install the libraries ----------
echo "[2/4] Checking the libraries it needs..."
if ! $PY -m pip install --quiet --disable-pip-version-check -r requirements.txt >/dev/null 2>&1; then
    echo "      Retrying as a user install..."
    if ! $PY -m pip install --quiet --disable-pip-version-check --user -r requirements.txt; then
        echo
        echo "[X] Could not install the libraries. Are you online?"
        echo "    Some systems need a virtual environment:"
        echo "        $PY -m venv .venv && source .venv/bin/activate"
        echo "        pip install -r requirements.txt && python app.py"
        echo
        exit 1
    fi
fi
echo "      Done."

# ---------- First-time setup ----------
if [ ! -f "config.txt" ]; then
    echo "[3/4] No settings yet - running first-time setup."
    echo
    if ! $PY tools/first_run.py; then
        echo
        echo "Setup was not finished. Run ./start.sh to try again."
        exit 1
    fi
else
    echo "[3/4] Settings found in config.txt."
fi

# ---------- Start ----------
echo "[4/4] Starting the app. Your browser should open in a moment."
echo
$PY app.py --open

echo
echo "The app has stopped."
