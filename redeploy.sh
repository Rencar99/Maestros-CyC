#!/usr/bin/env bash
# ============================================================================
#  redeploy.sh — ciclo de despliegue (dev) de Maestros CyC
#
#  Uso (un solo comando, por eso Claude Code lo puede autorizar de una vez):
#     bash "G:/Mi unidad/Maestros CyC/redeploy.sh"          -> frontend + backend
#     bash "G:/Mi unidad/Maestros CyC/redeploy.sh" front    -> solo frontend
#     bash "G:/Mi unidad/Maestros CyC/redeploy.sh" back      -> solo reiniciar backend
#
#  Nota: usa el Python LOCAL (el de G:\ lo borra Google Drive). Ver memoria
#  maestros-backend-dev-python.
# ============================================================================
set -e

SRC="G:/Mi unidad/Maestros CyC/app/frontend"
BUILD="/c/Users/COMPUMAX/AppData/Local/Temp/maestros_fe_build"
DIST="G:/Mi unidad/Maestros CyC/app/frontend/dist"
BACKEND="G:/Mi unidad/Maestros CyC/app/backend"
PY="C:/Users/COMPUMAX/AppData/Local/maestros_py/python.exe"
PORT=8010
LOG="/c/Users/COMPUMAX/AppData/Local/Temp/maestros_uvicorn.log"

MODO="${1:-all}"

build_front() {
  echo "== [1/3] Sincronizando fuentes del frontend =="
  rm -rf "$BUILD/src" "$BUILD/public"
  cp -r "$SRC/src" "$BUILD/src"
  [ -d "$SRC/public" ] && cp -r "$SRC/public" "$BUILD/public" || true
  cp "$SRC/index.html" "$BUILD/"
  cp "$SRC/package.json" "$SRC/vite.config.ts" "$SRC/tsconfig.json" "$BUILD/" 2>/dev/null || true

  echo "== [2/3] Compilando (tsc + vite) =="
  # Invocamos los binarios locales con node (evita npx, que en Git Bash no encuentra
  # el shim extensionless .bin/tsc y termina bajando un paquete equivocado).
  ( cd "$BUILD" && node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build )

  echo "== [3/3] Desplegando dist =="
  rm -rf "$DIST"
  mkdir -p "$DIST"
  cp -r "$BUILD/dist/." "$DIST/"
  echo "   frontend desplegado en app/frontend/dist"
}

restart_back() {
  echo "== Verificando sintaxis del backend =="
  ( cd "$BACKEND" && PYTHONIOENCODING=utf-8 PYTHONUTF8=1 "$PY" -c "import ast,glob; [ast.parse(open(f,encoding='utf-8').read()) for f in glob.glob('app/**/*.py',recursive=True)]; print('   sintaxis OK')" )

  echo "== Deteniendo backend en puerto $PORT =="
  powershell.exe -NoProfile -Command "\$c=Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue; if(\$c){\$c.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }; 'detenido' } else { 'ya libre' }" || true
  sleep 1

  echo "== Lanzando uvicorn =="
  ( cd "$BACKEND"; nohup "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port $PORT > "$LOG" 2>&1 & )

  echo "== Esperando health =="
  for i in $(seq 1 20); do
    H=$(curl -s -m 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
    if [ -n "$H" ]; then echo "   health: $H"; return 0; fi
    sleep 0.5
  done
  echo "   NO RESPONDE — últimas líneas del log:"; tail -25 "$LOG"; return 1
}

case "$MODO" in
  front) build_front ;;
  back)  restart_back ;;
  all)   build_front; restart_back ;;
  *) echo "Modo no reconocido: '$MODO' (usa: all | front | back)"; exit 2 ;;
esac

echo "== Redeploy ($MODO) COMPLETO =="
