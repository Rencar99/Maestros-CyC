"""Lectura de archivos de clientes por Microsoft Graph (OneDrive/SharePoint).

Módulo COMPARTIDO: todas las apps (Cartera, Calendario, …) lo consumen para abrir
archivos por ``drive_id`` + ``item_id`` (referencia estable en la nube), en vez de
por ruta de disco —que NO es portable entre equipos de colaboradores—. Solo lectura.

El ``access_token`` se obtiene con ``graph_delegado.refrescar(rt, SCOPE_FILES)`` a
partir del refresh token del usuario (el mismo del correo, si ya consintió archivos).
Requiere consentimiento de administrador del inquilino para ``Files.Read.All``.

Solo stdlib.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

_GRAPH = "https://graph.microsoft.com/v1.0"
_DL_KEY = "@microsoft.graph.downloadUrl"


def _get(access_token: str, url: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        detalle = ""
        try:
            detalle = json.loads(e.read().decode()).get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"Graph {e.code}: {detalle or e.reason}")


def _nodo(it: dict) -> dict:
    """Normaliza un item de Graph a lo mínimo que usan las apps."""
    return {
        "name": it.get("name", ""),
        "drive_id": (it.get("parentReference") or {}).get("driveId", ""),
        "item_id": it.get("id", ""),
        "es_carpeta": "folder" in it,
        "hijos": (it.get("folder") or {}).get("childCount", 0) if "folder" in it else None,
        "size": it.get("size", 0),
        "download_url": it.get(_DL_KEY, "") if "file" in it else "",
    }


def listar_hijos(access_token: str, drive_id: str, item_id: str,
                 exts: list[str] | None = None) -> dict:
    """Lista los hijos de una carpeta (navegable: cada subcarpeta trae su item_id
    para seguir bajando). Devuelve {'carpetas': [...], 'archivos': [...]}, cada uno
    con name/drive_id/item_id. Los archivos traen download_url. ``exts`` filtra los
    archivos por extensión (p.ej. ['pdf']). Sigue la paginación de Graph."""
    ex = tuple("." + e.lower().lstrip(".") for e in (exts or []))
    carpetas: list[dict] = []
    archivos: list[dict] = []
    url = f"{_GRAPH}/drives/{drive_id}/items/{item_id}/children?$top=200"
    while url:
        j = _get(access_token, url)
        for it in j.get("value", []):
            n = _nodo(it)
            if n["es_carpeta"]:
                carpetas.append(n)
            elif not ex or n["name"].lower().endswith(ex):
                archivos.append(n)
        url = j.get("@odata.nextLink", "")
    carpetas.sort(key=lambda n: n["name"].lower())
    archivos.sort(key=lambda n: n["name"].lower())
    return {"carpetas": carpetas, "archivos": archivos}


def item(access_token: str, drive_id: str, item_id: str) -> dict:
    """Metadatos de un item (incluye download_url si es archivo)."""
    j = _get(access_token, f"{_GRAPH}/drives/{drive_id}/items/{item_id}")
    return _nodo(j)


def descargar(access_token: str, drive_id: str, item_id: str) -> tuple[bytes, str, str]:
    """Baja el contenido de un archivo. Devuelve (bytes, nombre, content_type). Usa
    el download_url preautenticado de Graph (no requiere el bearer para ese GET)."""
    meta = _get(access_token, f"{_GRAPH}/drives/{drive_id}/items/{item_id}")
    url = meta.get(_DL_KEY)
    if not url:
        raise RuntimeError("El item no es un archivo descargable.")
    with urllib.request.urlopen(urllib.request.Request(url), timeout=120) as r:
        data = r.read()
        ctype = r.headers.get("Content-Type", "application/octet-stream")
    return data, meta.get("name", "archivo"), ctype


def resolver_ruta_a_item(access_token: str, ruta_rel: str) -> dict | None:
    """Resuelve una ruta RELATIVA al drive del usuario (p.ej.
    'Asesorias Externas/C&C') a {drive_id, item_id, name}. Para migrar referencias
    de ruta vieja → nube: corre como el usuario que tiene el árbol en SU drive.
    Devuelve None si no existe."""
    rel = (ruta_rel or "").strip().strip("/\\").replace("\\", "/")
    if not rel:
        j = _get(access_token, f"{_GRAPH}/me/drive/root")
    else:
        try:
            j = _get(access_token, f"{_GRAPH}/me/drive/root:/{urllib.parse.quote(rel)}")
        except RuntimeError:
            return None
    if not j.get("id"):
        return None
    return {"drive_id": (j.get("parentReference") or {}).get("driveId") or _mi_drive_id(access_token),
            "item_id": j["id"], "name": j.get("name", "")}


def _mi_drive_id(access_token: str) -> str:
    return _get(access_token, f"{_GRAPH}/me/drive").get("id", "")


def ruta_relativa_onedrive(ruta_abs: str) -> str:
    """De una ruta ABSOLUTA de disco bajo OneDrive, saca la parte RELATIVA al drive
    (lo que va después de '…\\OneDrive - <algo>\\'). Vacío si no la reconoce."""
    p = (ruta_abs or "").replace("/", "\\")
    low = p.lower()
    marca = "\\onedrive"
    i = low.find(marca)
    if i < 0:
        return ""
    resto = p[i + len(marca):]            # "" o " - Cardona…\A\B\C"
    j = resto.find("\\")                   # salta el nombre de la carpeta OneDrive
    return resto[j + 1:].strip("\\") if j >= 0 else ""
