"""Lector de cuentas de cobro en Word (.docx).

Un .docx es un ZIP con ``word/document.xml`` adentro; se extrae el texto por
párrafo y se localizan los campos por patrón (número, fecha, NIT del cliente,
valor y concepto). Las CC no son factura electrónica → no hay XML; el cruce se
hace por NIT y valor contra los ítems tipo CC de la facturación.
"""
from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree as ET

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _f(s) -> float:
    try:
        return float(re.sub(r"[^\d]", "", str(s)))
    except (TypeError, ValueError):
        return 0.0


def parse_cuenta_cobro_docx(data: bytes) -> dict:
    """Devuelve los campos de la cuenta de cobro. Lanza si el .docx es inválido."""
    root = ET.fromstring(zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml"))
    paras = ["".join(t.text or "" for t in p.iter(f"{{{_W}}}t")).strip()
             for p in root.iter(f"{{{_W}}}p")]
    paras = [p for p in paras if p]
    full = "\n".join(paras)

    numm = re.search(r"[Cc]uenta de cobro\s*N[°ºo]?\s*[°º]?\s*(\d+)", full)
    fchm = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", full)
    nitm = re.search(r"NIT\.?\s*([\d.]+)", full)           # NIT del cliente (el rotulado "NIT.")
    nomm = re.search(r"[“\"']([^”\"']+)[”\"']", full)      # nombre entre comillas
    valm = re.search(r"\$\s*([\d.]+)", full)               # primer valor con "$"

    concepto = ""
    for i, p in enumerate(paras):
        if re.search(r"[Pp]or concepto", p):
            for q in paras[i + 1:]:
                if q.strip():
                    concepto = q.strip()
                    break
            break

    return {
        "numero": numm.group(1) if numm else "",
        "fecha": (f"{fchm.group(3)}-{int(fchm.group(2)):02d}-{int(fchm.group(1)):02d}"
                  if fchm else ""),
        "cliente_nit": re.sub(r"\D", "", nitm.group(1)) if nitm else "",
        "cliente_nombre": (nomm.group(1).strip().rstrip(".") if nomm else ""),
        "valor": _f(valm.group(1)) if valm else 0.0,
        "concepto": concepto,
    }
