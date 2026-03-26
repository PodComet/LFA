@echo off
title LFA - Labornese Football Association
color 0E
echo.
echo   =============================================
echo     LFA - Labornese Football Association
echo   =============================================
color 07
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    color 0C
    echo   Node.js is not installed or not in PATH.
    echo   Download it from https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo   Node.js %%v detected

:: Check required files
if not exist "%~dp0serve-cards.js" (
    color 0C
    echo   Missing: serve-cards.js
    echo   Place this launcher in the game folder.
    pause
    exit /b 1
)
if not exist "%~dp0data\league.json" (
    color 0C
    echo   Missing: data\league.json
    echo   Place this launcher in the game folder.
    pause
    exit /b 1
)

:: Build site
echo   Building site...
cd /d "%~dp0"
node build-site.js >nul 2>&1
echo   Done.

:: Check if server already running
powershell -Command "try { (Invoke-WebRequest -Uri 'http://localhost:3456/' -TimeoutSec 2 -UseBasicParsing).StatusCode } catch { 0 }" 2>nul | findstr "200" >nul 2>&1
if not errorlevel 1 (
    echo   Server already running on port 3456
    start http://localhost:3456/
    echo   Browser opened!
    echo.
    pause
    exit /b 0
)

:: Start server in background
echo   Starting server on port 3456...
start /b node serve-cards.js

:: Wait for server
set attempts=0
:wait_loop
if %attempts% geq 20 goto server_failed
timeout /t 1 /nobreak >nul
powershell -Command "try { (Invoke-WebRequest -Uri 'http://localhost:3456/' -TimeoutSec 2 -UseBasicParsing).StatusCode } catch { 0 }" 2>nul | findstr "200" >nul 2>&1
if not errorlevel 1 goto server_ready
set /a attempts+=1
goto wait_loop

:server_ready
echo.
color 0A
echo   Game is running at http://localhost:3456
color 07
echo.
start http://localhost:3456/
echo   Browser opened!
echo.
echo   Keep this window open while playing.
echo   Press any key to stop the server and exit.
echo.
pause >nul
echo   Shutting down...
taskkill /f /im node.exe >nul 2>&1
exit /b 0

:server_failed
color 0C
echo   Server failed to start. Check for errors.
echo.
pause
exit /b 1
