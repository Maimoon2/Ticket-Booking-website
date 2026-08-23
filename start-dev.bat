@echo off
echo ============================================
echo   ScenePass - Starting Development Servers
echo ============================================
echo.

REM Set environment variables
set PORT=3000
set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scenepass
set JWT_SECRET=scenepass-local-dev-secret-key-2024-change-in-production
set HOLD_TTL_MINUTES=10
set HOLD_SWEEP_INTERVAL_MS=30000
set WAITLIST_OFFER_MINUTES=15
set APP_URL=http://localhost:5173
set NODE_ENV=development

echo [1/2] Building and starting API server on port 3000...
echo      (this runs in a new window)
start "ScenePass API Server" cmd /k "cd /d d:\Ticket-Booking-website && set PORT=3000 && set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scenepass && set JWT_SECRET=scenepass-local-dev-secret-key-2024-change-in-production && set HOLD_TTL_MINUTES=10 && set HOLD_SWEEP_INTERVAL_MS=30000 && set WAITLIST_OFFER_MINUTES=15 && set APP_URL=http://localhost:5173 && set NODE_ENV=development && pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start"

echo.
echo [2/2] Starting frontend dev server on port 5173...
echo      (this runs in a new window)
timeout /t 5 /nobreak >nul
start "ScenePass Frontend" cmd /k "cd /d d:\Ticket-Booking-website && set PORT=5173 && set BASE_PATH=/ && pnpm --filter @workspace/ticket-booking run dev"

echo.
echo ============================================
echo   Both servers are starting in new windows!
echo.
echo   Frontend: http://localhost:5173
echo   API:      http://localhost:3000
echo ============================================
echo.
pause
