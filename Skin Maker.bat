@echo off
rem KherveSkins - double-click to run the skin maker.
rem Starts the little Python server and opens a browser at it.
cd /d "%~dp0"
set PORT=8140
echo Starting KherveSkins on http://localhost:%PORT%/
python serve.py --port %PORT% --open
if errorlevel 1 (
  echo.
  echo Could not start. Is Python installed, and is port %PORT% free?
  pause
)
