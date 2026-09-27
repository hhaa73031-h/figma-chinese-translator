@echo off
cd /d "%~dp0"
echo ========================================================
echo   Figma Realtime Localization Web Manager
echo   Starting local server and opening browser...
echo ========================================================

python web_server.py
if errorlevel 1 "C:\Users\ACG13\AppData\Local\Programs\Python\Python312\python.exe" web_server.py

echo.
echo [Server stopped]
pause
