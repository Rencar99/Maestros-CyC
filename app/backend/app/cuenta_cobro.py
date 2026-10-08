"""Generación de cuentas de cobro: número a letras (pesos), HTML del documento y
conversión HTML→PDF con Microsoft Edge en modo headless.

El formato replica el de la firma: fecha, N° consecutivo (por emisor), deudor
(cliente), acreedor/emisor, valor en números y letras, concepto + período, datos
de pago (de config), nota art. 383 (si el emisor la tiene) y firma del emisor."""
from __future__ import annotations

import os
import subprocess
import tempfile
from datetime import date
from html import escape

# ----------------------------------------------------------------- número a letras
_UNID = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
         "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
         "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
         "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"]
_DEC = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]
_CEN = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
        "seiscientos", "setecientos", "ochocientos", "novecientos"]


def _centenas(n: int) -> str:
    """0..999 en letras (sin apócope)."""
    if n == 0:
        return ""
    if n == 100:
        return "cien"
    c, r = divmod(n, 100)
    out = []
    if c:
        out.append(_CEN[c])
    if r:
        if r < 30:
            out.append(_UNID[r])
        else:
            d, u = divmod(r, 10)
            out.append(_DEC[d] if u == 0 else f"{_DEC[d]} y {_UNID[u]}")
    return " ".join(out)


def _apocope(txt: str) -> str:
    """'uno' → 'un', 'veintiuno' → 'veintiún' (antes de 'mil'/'millón'/sustantivo)."""
    if txt.endswith("veintiuno"):
        return txt[:-len("veintiuno")] + "veintiún"
    if txt.endswith("uno"):
        return txt[:-3] + "un"
    return txt


def _grupo(n: int, singular: str, plural: str) -> str:
    """Devuelve 'mil' / 'un millón' / 'dos millones' etc. para un grupo de miles/millones."""
    if n == 0:
        return ""
    if singular == "mil":                       # 'mil', no 'un mil'
        pref = "" if n == 1 else _apocope(_centenas(n)) + " "
        return f"{pref}mil"
    pal = singular if n == 1 else plural
    return f"{_apocope(_centenas(n))} {pal}"


def num_a_letras(valor) -> str:
    """Entero de pesos → 'Seiscientos setenta y tres mil pesos' (capitalizado)."""
    n = int(round(float(valor)))
    if n == 0:
        return "Cero pesos"
    neg = n < 0
    n = abs(n)
    millones, resto = divmod(n, 1_000_000)
    miles, cientos = divmod(resto, 1000)
    partes = []
    if millones:
        partes.append(_grupo(millones, "millón", "millones"))
    if miles:
        partes.append(_grupo(miles, "mil", "mil"))
    if cientos:
        partes.append(_apocope(_centenas(cientos)) if (millones or miles) and cientos == 1 else _centenas(cientos))
    texto = " ".join(p for p in partes if p).strip()
    texto = ("menos " + texto) if neg else texto
    # 'de pesos' cuando termina en millón/millones exacto (dos millones de pesos).
    suf = " de pesos" if (millones and miles == 0 and cientos == 0) else " pesos"
    return (texto[0].upper() + texto[1:]) + suf


# ----------------------------------------------------------------- HTML + PDF
_MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
          "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
_NOTA_383 = ("De conformidad con el artículo 383 del Estatuto Tributario, informo que no he "
             "contratado o vinculado dos (2) o más trabajadores asociados a la actividad que "
             "ejerzo. Por lo tanto, me aplica la retención del artículo en mención.")


def _miles(n) -> str:
    return f"{int(round(float(n))):,}".replace(",", ".")


def construir_html(*, numero: str, fecha: date, deudor: str, deudor_doc: str,
                   emisor_nombre: str, emisor_cedula: str, emisor_direccion: str,
                   emisor_celular: str, nota_383: bool, concepto: str, valor,
                   pago_banco: str, pago_tipo: str, pago_numero: str, pago_titular: str) -> str:
    f = fecha
    fecha_txt = f"{f.day:02d}/{f.month:02d}/{f.year}"
    letras = num_a_letras(valor)
    nota = (f'<p class="nota">{escape(_NOTA_383)}</p>') if nota_383 else ""
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>
  @page {{ size: Letter; margin: 2.4cm 2.6cm; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 13.5px; line-height: 1.9; }}
  .fecha {{ text-align: right; margin-bottom: 4px; }}
  .tit {{ font-weight: 700; font-size: 15px; margin: 2px 0 22px; }}
  .lbl {{ color: #555; margin: 14px 0 2px; }}
  .val {{ margin: 0; }}
  .suma b {{ font-size: 14.5px; }}
  .pago {{ margin-top: 22px; font-size: 12.5px; color: #333; }}
  .nota {{ margin-top: 12px; font-size: 11.5px; color: #555; }}
  .firma {{ margin-top: 54px; }}
  .firma .linea {{ width: 260px; border-top: 1px solid #333; padding-top: 4px; font-size: 12.5px; line-height: 1.6; }}
</style></head><body>
  <div class="fecha">{fecha_txt}</div>
  <div class="tit">Cuenta de cobro N° {escape(numero)}</div>

  <p class="val"><b>{escape(deudor)}</b><br>{escape(deudor_doc)}</p>

  <p class="lbl">Debe a:</p>
  <p class="val">{escape(emisor_nombre)}<br>Identificada con cédula de ciudadanía N° {escape(emisor_cedula)}</p>

  <p class="lbl">La suma de:</p>
  <p class="val suma"><b>$ {_miles(valor)}</b> ({escape(letras)})</p>

  <p class="lbl">Por concepto de:</p>
  <p class="val">{escape(concepto)}</p>

  <p class="pago">Por favor efectuar el pago en: consignación en la cuenta de {escape(pago_tipo)} N° {escape(pago_numero)} a nombre de {escape(pago_titular)} del banco {escape(pago_banco)}.</p>
  {nota}

  <p class="lbl" style="margin-top:22px">Cordialmente,</p>
  <div class="firma"><div class="linea">
    {escape(emisor_nombre)}<br>
    C.C. {escape(emisor_cedula)}<br>
    Dirección: {escape(emisor_direccion)}<br>
    Celular: {escape(emisor_celular)}
  </div></div>
</body></html>"""


def _edge() -> str:
    for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(p):
            return p
    raise RuntimeError("No se encontró Microsoft Edge para generar el PDF.")


def html_a_pdf(html: str) -> bytes:
    """Convierte HTML a PDF con Edge headless (--print-to-pdf)."""
    edge = _edge()
    with tempfile.TemporaryDirectory() as d:
        hp = os.path.join(d, "cc.html")
        pp = os.path.join(d, "cc.pdf")
        with open(hp, "w", encoding="utf-8") as fh:
            fh.write(html)
        url = "file:///" + hp.replace("\\", "/")
        subprocess.run(
            [edge, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
             f"--print-to-pdf={pp}", url],
            check=True, timeout=40,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        with open(pp, "rb") as fh:
            return fh.read()
