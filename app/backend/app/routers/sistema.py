"""Selectores nativos de Windows (uso local: el diálogo se abre en la máquina
del backend, que aquí es la del usuario).

- Carpeta: diálogo MODERNO de Windows (IFileOpenDialog) compilado en
  ``folderpicker.exe`` (app de ventana, sin consola). Mismo del Explorador.
- Archivo: OpenFileDialog de WinForms vía PowerShell (traído al frente).

Réplica del patrón de la app Descargar DIAN, para obtener la ruta REAL del disco
(lo que el navegador no puede por seguridad).
"""
from __future__ import annotations

import base64
import os
import subprocess
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ..config import (EXPLORADOR_RAIZ, INSTALL_ROOT, VERSION,
                     hay_actualizacion, resolver_instalador)
from ..deps import get_current_user

router = APIRouter(prefix="/api/sistema", tags=["sistema"])


@router.get("/actualizacion")
def actualizacion(_u=Depends(get_current_user)):
    """¿Este equipo está atrás del instalador compartido? La App lo consulta al
    arrancar para avisar (estilo Windows Update) y ofrecer actualizarse."""
    hay, disp = hay_actualizacion()
    return {"actual": VERSION, "disponible": disp, "hay": hay}


@router.post("/actualizar")
def actualizar(_u=Depends(get_current_user)):
    """Lanza el actualizador del instalador compartido contra ESTA instalación.
    El actualizador detiene este backend, copia el código nuevo y termina; por
    eso se lanza DESAPEGADO (sobrevive a que nos maten) y con un respiro para
    que la respuesta HTTP alcance a volver. El usuario reabre la app al final."""
    hay, disp = hay_actualizacion()
    if not hay:
        raise HTTPException(409, "Ya estás en la última versión.")
    inst_dir, _ = resolver_instalador()   # la MISMA carpeta que trajo la versión nueva
    cmd = Path(inst_dir) / "ACTUALIZAR.cmd"
    if not inst_dir or not cmd.is_file():
        raise HTTPException(404, f"No se encontró el actualizador en '{inst_dir}'.")
    if os.name != "nt":
        raise HTTPException(400, "La actualización automática solo corre en Windows.")
    # Se lanza por PowerShell (quoting seguro vs. 'cmd /c' con comillas internas):
    # espera 2 s para que este 200 alcance a volver, y corre ACTUALIZAR.cmd en su
    # propia consola visible, pasándole el destino = raíz de ESTA instalación. El
    # .cmd detiene este backend, copia y termina con "pause".
    cmd_q = str(cmd).replace("'", "''")
    root_q = str(INSTALL_ROOT).replace("'", "''")
    psc = f"Start-Sleep -Seconds 2; & '{cmd_q}' -Destino '{root_q}'"
    try:
        subprocess.Popen(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psc],
            cwd=str(inst_dir),
            creationflags=0x00000010)  # CREATE_NEW_CONSOLE (consola propia; sobrevive a que nos maten)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"No se pudo lanzar el actualizador: {exc}")
    return {"ok": True, "version": disp}


def _ruta_portable(abs_path: str) -> str:
    """Si la ruta está bajo OneDrive, la devuelve como ``%OneDriveCommercial%\\<rel>``
    (o ``%OneDrive%``), portable entre equipos; si no, la deja tal cual. Idempotente:
    si ya trae un token ``%...%`` no la toca."""
    ruta = (abs_path or "").strip()
    if not ruta or ruta.startswith("%"):
        return ruta
    for var in ("OneDriveCommercial", "OneDrive"):
        base = (os.environ.get(var) or "").rstrip("\\/")
        if base and ruta.lower().startswith(base.lower()):
            return f"%{var}%" + ruta[len(base):]
    return ruta


@router.get("/ruta-portable")
def ruta_portable(ruta: str = "", _u=Depends(get_current_user)):
    """Convierte una ruta ABSOLUTA a su forma PORTABLE (token %OneDrive%), para
    guardarla y que cada equipo la resuelva con su propia variable de OneDrive."""
    return {"ruta": _ruta_portable(ruta)}


def _dentro_de_raiz(p: Path, raiz: Path) -> bool:
    try:
        p.resolve().relative_to(raiz)
        return True
    except (ValueError, OSError):
        return p.resolve() == raiz


def _fecha(ts: float) -> str:
    from datetime import datetime
    try:
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    except (OverflowError, OSError, ValueError):
        return ""


def _tamano(n: int) -> str:
    x = float(n)
    for u in ("B", "KB", "MB", "GB"):
        if x < 1024 or u == "GB":
            return f"{int(x)} {u}" if u == "B" else f"{x:.1f} {u}"
        x /= 1024
    return f"{x:.1f} GB"


def _unidades() -> list:
    """Unidades disponibles del equipo (C:\\, D:\\, …) para el modo libre."""
    import string
    out = []
    for letra in string.ascii_uppercase:
        d = f"{letra}:\\"
        if os.path.exists(d):
            out.append({"nombre": d, "ruta": d, "modificado": ""})
    return out


def _listar(actual: Path, solo_carpetas: bool) -> tuple[list, list]:
    carpetas, archivos = [], []
    try:
        for e in sorted(actual.iterdir(), key=lambda p: p.name.lower()):
            if e.name.startswith((".", "~$")):
                continue
            try:
                st = e.stat()
                if e.is_dir():
                    carpetas.append({"nombre": e.name, "ruta": str(e),
                                     "modificado": _fecha(st.st_mtime)})
                elif not solo_carpetas and e.is_file():
                    ext = e.suffix.lstrip(".").upper()
                    archivos.append({"nombre": e.name, "ruta": str(e),
                                     "modificado": _fecha(st.st_mtime),
                                     "tipo": ext or "Archivo", "tamano": _tamano(st.st_size)})
            except OSError:
                continue
    except (PermissionError, OSError):
        pass
    return carpetas, archivos


@router.get("/explorar")
def explorar(ruta: str = "", solo_carpetas: bool = False, libre: bool = False,
             _u=Depends(get_current_user)):
    """Explorador del almacenamiento del servidor. Por defecto LIMITADO a
    EXPLORADOR_RAIZ; con ``libre=true`` navega todo el equipo (unidades incluidas)."""
    # Expandir tokens (%OneDrive%…) y ~ para que una ruta portable guardada
    # (ruta_trabajo = %OneDrive%\…) abra en la carpeta correcta de ESTE equipo.
    if ruta and ruta != "::equipo::":
        ruta = os.path.expanduser(os.path.expandvars(ruta))
    if libre:
        # Navega todo el equipo. Arranca en la carpeta de la firma (cómodo) pero
        # deja subir hasta las unidades. Sentinela "::equipo::" = lista de unidades.
        raiz = Path(EXPLORADOR_RAIZ).resolve()
        unidades = {"ruta": "", "padre": "", "raiz": "", "es_raiz": True,
                    "carpetas": _unidades(), "archivos": []}
        if ruta == "::equipo::":
            return unidades
        if not ruta:
            actual = raiz if raiz.is_dir() else None
        else:
            actual = Path(ruta).resolve()
        if actual is None or not actual.is_dir():
            return unidades
        carpetas, archivos = _listar(actual, solo_carpetas)
        es_drive_root = actual.parent == actual         # C:\ ← subir vuelve a las unidades
        padre = "::equipo::" if es_drive_root else str(actual.parent)
        return {"ruta": str(actual), "padre": padre, "raiz": str(raiz), "es_raiz": False,
                "carpetas": carpetas, "archivos": archivos}

    raiz = Path(EXPLORADOR_RAIZ).resolve()
    if not raiz.is_dir():
        raise HTTPException(500, f"La raíz del explorador no existe: {EXPLORADOR_RAIZ}")
    actual = Path(ruta).resolve() if ruta else raiz
    if not actual.is_dir() or not _dentro_de_raiz(actual, raiz):
        actual = raiz
    carpetas, archivos = _listar(actual, solo_carpetas)
    padre = "" if actual == raiz else str(actual.parent)
    return {"ruta": str(actual), "padre": padre, "raiz": str(raiz),
            "es_raiz": actual == raiz, "carpetas": carpetas, "archivos": archivos}

# folderpicker.exe vive en  app/backend/folderpicker.exe
_PICKER = Path(__file__).resolve().parents[2] / "folderpicker.exe"
_lock = threading.Lock()  # evita abrir dos diálogos a la vez


@router.get("/seleccionar-carpeta")
def seleccionar_carpeta(_u=Depends(get_current_user)):
    if not _PICKER.is_file():
        raise HTTPException(500, "No se encontró el selector de carpeta (folderpicker.exe).")
    if not _lock.acquire(blocking=False):
        return {"path": ""}
    flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
    try:
        res = subprocess.run([str(_PICKER)], capture_output=True, text=True,
                             timeout=300, creationflags=flags)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"No se pudo abrir el selector de carpeta: {exc}")
    finally:
        _lock.release()
    return {"path": (res.stdout or "").strip()}


@router.get("/seleccionar-archivo")
def seleccionar_archivo(dir: str = "", titulo: str = "Ubica el archivo de la propuesta",
                        filtro: str = "", _u=Depends(get_current_user)):
    """Diálogo nativo de Windows para elegir UN archivo. Devuelve su ruta absoluta.
    ``dir`` = carpeta inicial; ``titulo`` = título del diálogo; ``filtro`` =
    filtro de tipos estilo WinForms (ej. 'PDF (*.pdf)|*.pdf|Todos|*.*')."""
    if not _lock.acquire(blocking=False):
        return {"path": ""}
    init = (dir or "").replace("'", "''")
    tit = (titulo or "Ubica el archivo").replace("'", "''")
    filt = (filtro or "").replace("'", "''")
    ps = "\n".join([
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$sig = @'",
        '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
        '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
        '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);',
        '[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
        '[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);',
        '[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);',
        "'@",
        "$W = Add-Type -MemberDefinition $sig -Name Fg -Namespace Native -PassThru",
        "$o = New-Object System.Windows.Forms.Form",
        "$o.TopMost = $true; $o.StartPosition = 'CenterScreen'",
        "$o.Size = New-Object System.Drawing.Size(1,1); $o.Opacity = 0; $o.ShowInTaskbar = $false",
        "$o.Add_Shown({",
        "  $fg = $W::GetForegroundWindow()",
        "  $tid = $W::GetWindowThreadProcessId($fg, [IntPtr]::Zero)",
        "  $cur = $W::GetCurrentThreadId()",
        "  [void]$W::AttachThreadInput($tid, $cur, $true)",
        "  [void]$W::SetForegroundWindow($o.Handle)",
        "  [void]$W::BringWindowToTop($o.Handle)",
        "  [void]$W::AttachThreadInput($tid, $cur, $false)",
        "})",
        "$o.Show(); [System.Windows.Forms.Application]::DoEvents()",
        "$d = New-Object System.Windows.Forms.OpenFileDialog",
        "$d.Multiselect = $false",
        f"$d.Title = '{tit}'",
        f"$d.InitialDirectory = '{init}'",
        *([f"$d.Filter = '{filt}'"] if filtro else []),
        "$r = $d.ShowDialog($o)",
        "$o.Close()",
        "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }",
    ])
    b64 = base64.b64encode(ps.encode("utf-16-le")).decode()
    flags = 0x08000000 if os.name == "nt" else 0
    try:
        res = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-EncodedCommand", b64],
            capture_output=True, text=True, encoding="utf-8", timeout=300, creationflags=flags)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"No se pudo abrir el selector de archivo: {exc}")
    finally:
        _lock.release()
    return {"path": (res.stdout or "").strip()}
