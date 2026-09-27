@echo off
setlocal
cd /d "%~dp0"
title Figma Web Translator

echo ========================================================
echo   Figma Realtime Web Translator
echo   Directory: %cd%
echo ========================================================

set "PY_EXE="
where py >nul 2>nul && set "PY_EXE=py"
if not defined PY_EXE where python >nul 2>nul && set "PY_EXE=python"
if not defined PY_EXE if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY_EXE if exist "C:\Users\ACG13\AppData\Local\Programs\Python\Python312\python.exe" set "PY_EXE=C:\Users\ACG13\AppData\Local\Programs\Python\Python312\python.exe"

if not defined PY_EXE (
    echo [ERROR] Python not found!
    echo Please make sure Python is installed.
    echo.
    pause
    exit /b 1
)

echo Found Python: %PY_EXE%
echo Starting web server on http://localhost:8765 ...
echo.

"%PY_EXE%" web_server.py

echo.
echo [Server stopped]
pause
