@echo off
title Maestros CyC - Clientes y Responsables
cd /d "%~dp0app\backend"
echo ============================================
echo   Maestros CyC - Clientes y Responsables
echo   Iniciando servidor en http://localhost:8010
echo   Para DETENER, cierra esta ventana.
echo ============================================
echo.
REM Usa el Python de la app DIAN (ya tiene las dependencias instaladas).
REM Toma CARDONA_DATABASE_URL del entorno -> se conecta al Postgres real (esquema maestros).
set "PYEXE=G:\Mi unidad\Instalador DIAN CyC\python\python.exe"
start "" http://localhost:8010
"%PYEXE%" -m uvicorn app.main:app --host 127.0.0.1 --port 8010
pause
