@echo off
REM =====================================================================
REM  listly - Windows start script
REM  Just double-click this file. It checks Python, installs what is
REM  needed, runs first-time setup, then starts the app.
REM =====================================================================
setlocal
cd /d "%~dp0"
title listly

echo.
echo ==========================================================
echo   listly - starting up
echo ==========================================================
echo.

REM ---------- 1. Find Python ----------
set PY=
for %%C in ("py -3" "python" "python3") do (
    if not defined PY (
        %%~C --version >nul 2>&1 && set PY=%%~C
    )
)

if not defined PY (
    echo [X] Python is not installed, or not on your PATH.
    echo.
    echo     1. Go to  https://www.python.org/downloads/
    echo     2. Download Python for Windows and run the installer
    echo     3. IMPORTANT: tick "Add Python to PATH" on the first screen
    echo     4. Close this window and double-click start.bat again
    echo.
    pause
    exit /b 1
)
echo [1/4] Found Python: %PY%

REM ---------- 2. Install the libraries ----------
echo [2/4] Checking the libraries it needs...
%PY% -m pip install --quiet --disable-pip-version-check -r requirements.txt >nul 2>&1
if errorlevel 1 (
    echo       Retrying as a user install...
    %PY% -m pip install --quiet --disable-pip-version-check --user -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [X] Could not install the libraries. Are you online?
        echo     You can also try this command by hand:
        echo         %PY% -m pip install flask requests qrcode
        echo.
        pause
        exit /b 1
    )
)
echo       Done.

REM ---------- 3. First-time setup ----------
if not exist "config.txt" (
    echo [3/4] No settings yet - running first-time setup.
    echo.
    %PY% tools\first_run.py
    if errorlevel 1 (
        echo.
        echo Setup was not finished. Double-click start.bat to try again.
        pause
        exit /b 1
    )
) else (
    echo [3/4] Settings found in config.txt.
)

REM ---------- 4. Start ----------
echo [4/4] Starting the app. Your browser should open in a moment.
echo.
%PY% app.py --open

echo.
echo The app has stopped.
pause
