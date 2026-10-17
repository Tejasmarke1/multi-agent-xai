@echo off
echo Starting Multi-Agent XAI Dashboard...
echo.

REM Start FastAPI backend in a new window
echo [1/2] Starting FastAPI backend on http://localhost:8000 ...
start "XAI API Backend" cmd /k "cd /d "%~dp0" && call .venv\Scripts\activate.bat && python api.py"

REM Wait 3 seconds for backend to initialize
timeout /t 3 /nobreak >nul

REM Start React frontend
echo [2/2] Starting React dashboard on http://localhost:5173 ...
start "XAI Dashboard" cmd /k "cd /d "%~dp0\dashboard" && npm run dev"

echo.
echo Dashboard: http://localhost:5173
echo API docs:  http://localhost:8000/docs
echo.
pause
