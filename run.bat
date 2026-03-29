@echo off
title Naukri Bot
cd /d "%~dp0"
echo.
echo  Starting Naukri Bot...
echo.
call npm run fast
echo.
echo  Done. Press any key to close.
pause >nul
