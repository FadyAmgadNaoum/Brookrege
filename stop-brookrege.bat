@echo off
REM Brookrege - stop the site on this computer. Your data is kept (listings, accounts, uploads).
cd /d "%~dp0"
docker compose down
echo.
echo Brookrege is stopped. Start it again with start-brookrege.bat
pause
