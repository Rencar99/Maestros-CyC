"""Lanzador de escritorio de Maestros CyC.

Arranca el backend (uvicorn) en el HILO PRINCIPAL y abre la app en una ventana
propia (Chrome/Edge --app). Pensado para ``pythonw.exe`` (sin consola):

1. Bajo pythonw, ``sys.stdout``/``sys.stderr`` son ``None``; se redirigen a 'nul'
   para que el logging de uvicorn no reviente el proceso.
2. uvicorn corre en el hilo principal para permanecer vivo sin consola.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser

# (1) Blindaje para pythonw: sin consola, stdout/stderr son None.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")  # noqa: SIM115
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")  # noqa: SIM115

import uvicorn  # noqa: E402

HOST = "127.0.0.1"
PORT = 8010
URL = f"http://{HOST}:{PORT}"


def _servidor_arriba() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex((HOST, PORT)) == 0


def _endurecer_perfil(perfil: str) -> None:
    """Desactiva el gestor de contraseñas de Chrome/Edge en el perfil de la App y
    borra claves guardadas: evita que autocomplete la clave del portal DIAN."""
    import json  # noqa: PLC0415
    default = os.path.join(perfil, "Default")
    try:
        os.makedirs(default, exist_ok=True)
    except OSError:
        return
    prefs_path = os.path.join(default, "Preferences")
    prefs: dict = {}
    try:
        if os.path.isfile(prefs_path):
            with open(prefs_path, "r", encoding="utf-8") as f:
                prefs = json.load(f)
    except Exception:  # noqa: BLE001
        prefs = {}
    prefs["credentials_enable_service"] = False
    prefs["credentials_enable_autosignin"] = False
    prof = prefs.get("profile")
    if not isinstance(prof, dict):
        prof = {}
    prof["password_manager_enabled"] = False
    prefs["profile"] = prof
    try:
        with open(prefs_path, "w", encoding="utf-8") as f:
            json.dump(prefs, f)
    except Exception:  # noqa: BLE001
        pass
    for nombre in ("Login Data", "Login Data-journal", "Login Data For Account",
                   "Login Data For Account-journal"):
        try:
            p = os.path.join(default, nombre)
            if os.path.isfile(p):
                os.remove(p)
        except Exception:  # noqa: BLE001
            pass


def _abrir_como_app() -> bool:
    """Abre la app en ventana propia (Chrome/Edge --app). True si lo logró."""
    import subprocess  # noqa: PLC0415
    perfil = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
                          "CardonaApps", "MaestrosVentana")
    _endurecer_perfil(perfil)
    bases = [os.environ.get("PROGRAMFILES", r"C:\Program Files"),
             os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
             os.environ.get("LOCALAPPDATA", "")]
    subrutas = (r"Google\Chrome\Application\chrome.exe",
                r"Microsoft\Edge\Application\msedge.exe")
    for base in bases:
        for sub in subrutas:
            exe = os.path.join(base, sub)
            if os.path.isfile(exe):
                try:
                    subprocess.Popen(
                        [exe, f"--app={URL}", f"--user-data-dir={perfil}",
                         "--window-size=1320,880", "--no-first-run",
                         "--no-default-browser-check"],
                        creationflags=(0x08000000 if os.name == "nt" else 0))
                    return True
                except Exception:  # noqa: BLE001
                    pass
    return False


def _abrir_navegador() -> None:
    for _ in range(80):
        if _servidor_arriba():
            break
        time.sleep(0.25)
    if _abrir_como_app():
        return
    try:
        webbrowser.open(URL)
    except Exception:  # noqa: BLE001
        pass


def main() -> None:
    # Modo autoarranque (lanzador .vbs de la carpeta Inicio): levanta SOLO el
    # backend, sin abrir ventana. La app se abre aparte con su acceso directo.
    sin_navegador = os.environ.get("MAESTROS_SIN_NAVEGADOR") == "1"
    if _servidor_arriba():
        if not sin_navegador and not _abrir_como_app():
            try:
                webbrowser.open(URL)
            except Exception:  # noqa: BLE001
                pass
        return
    if not sin_navegador:
        threading.Thread(target=_abrir_navegador, daemon=True).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
