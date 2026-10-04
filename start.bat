@echo off
rem Запуск кассы АрхБухта: локальный сервер + браузер. Интернет не нужен.
chcp 65001 >nul
cd /d "%~dp0"
set PORT=8080
where node >nul 2>nul
if not errorlevel 1 (
  start "ArchBukhta server" /min node server.js
) else (
  where python >nul 2>nul
  if not errorlevel 1 (
    start "ArchBukhta server" /min python -m http.server %PORT% --bind 127.0.0.1 --directory app
  ) else (
    echo Нужен Node.js или Python. См. README.
    pause
    exit /b 1
  )
)
timeout /t 2 >nul
start "" http://localhost:%PORT%/
