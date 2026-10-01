@echo off
REM Brookrege - double-click to start the whole site on this computer (needs Docker Desktop).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local\start.ps1"
