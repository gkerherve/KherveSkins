@echo off
rem KherveSkins - double-click to run the skin maker.
rem Starts the little Python server and opens a browser at it.
cd /d "%~dp0"
set PORT=8140

rem The py launcher first: on a machine where the Microsoft Store stub sits on
rem PATH ahead of the real interpreter, "python" opens the Store instead of
rem running anything. -3 is needed because the launcher would otherwise honour
rem serve.py's own "#!/usr/bin/env python3" line and find that same stub.
py -3 -V >nul 2>&1
if not errorlevel 1 (
  echo Starting KherveSkins on http://localhost:%PORT%/
  py -3 serve.py --port %PORT% --open
) else (
  echo Starting KherveSkins on http://localhost:%PORT%/
  python serve.py --port %PORT% --open
)

if errorlevel 1 (
  echo.
  echo Could not start. Is Python installed, and is port %PORT% free?
  pause
)
