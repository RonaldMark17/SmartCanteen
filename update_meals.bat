@echo off
setlocal
cd /d "%~dp0"
echo ========================================================
echo       Updating MEALS Distribution Package...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update_meals.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Update failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] MEALS package update finished!
pause
