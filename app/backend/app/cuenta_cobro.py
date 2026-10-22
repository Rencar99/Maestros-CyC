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
                   pago_banco: str, pago_tipo: str, pago_numero: str, pago_titular: str,
                   nota_383_texto: str = "") -> str:
    """HTML de la cuenta de cobro con diseño: encabezado del EMISOR (quien cobra),
    secciones en marcos, valor destacado, nota 383 condicional y firma del emisor."""
    f = fecha
    fecha_txt = f"{f.day:02d}/{f.month:02d}/{f.year}"
    letras = num_a_letras(valor)
    ini = ("".join(p[0] for p in emisor_nombre.split()[:2]).upper()) or "·"
    nota_txt = (nota_383_texto or "").strip() or _NOTA_383
    nota = (f'<div class="nota"><b>Nota (art. 383 ET):</b> {escape(nota_txt)}</div>') if nota_383 else ""
    firma_extra = ""
    if emisor_direccion.strip():
        firma_extra += f"<br>Dirección: {escape(emisor_direccion)}"
    if emisor_celular.strip():
        firma_extra += f"<br>Celular: {escape(emisor_celular)}"
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>
  @page {{ size: Letter; margin: 0; }}
  * {{ box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #1a2332; font-size: 13px; margin: 0; }}
  .hd {{ background: #062d65; color: #fff; padding: 24px 40px; display: flex; align-items: center; justify-content: space-between; }}
  .hd .em {{ display: flex; align-items: center; gap: 14px; }}
  .hd .ava {{ width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,.12); display: flex; align-items: center; justify-content: center; color: #f7931e; font-weight: 700; font-size: 16px; }}
  .hd .emn {{ font-size: 16.5px; font-weight: 600; }}
  .hd .emc {{ font-size: 11.5px; color: rgba(255,255,255,.72); margin-top: 2px; }}
  .hd .doc {{ text-align: right; }}
  .hd .kic {{ font-size: 11px; letter-spacing: 2.5px; color: #f7931e; font-weight: 600; }}
  .hd .num {{ font-size: 23px; font-weight: 700; line-height: 1.1; }}
  .hd .fec {{ font-size: 11.5px; color: rgba(255,255,255,.78); margin-top: 3px; }}
  .bd {{ padding: 28px 40px; }}
  .box {{ border: 1px solid #e2e6ec; border-radius: 9px; padding: 12px 16px; margin-bottom: 15px; }}
  .lbl {{ font-size: 10px; letter-spacing: 1px; color: #8792a3; font-weight: 700; text-transform: uppercase; margin-bottom: 5px; }}
  .box.deu {{ border-left: 3px solid #062d65; }}
  .nm {{ font-weight: 700; font-size: 14.5px; }}
  .sub {{ font-size: 12.5px; color: #5d6b7e; margin-top: 3px; }}
  .suma {{ border-color: #cfe0f2; background: #f3f8fd; display: flex; align-items: baseline; justify-content: space-between; gap: 18px; }}
  .suma .lbl {{ color: #185fa5; }}
  .suma .let {{ font-size: 12.5px; color: #5d6b7e; margin-top: 4px; font-style: italic; }}
  .suma .amt {{ font-size: 27px; font-weight: 800; color: #062d65; white-space: nowrap; }}
  .box.pago {{ background: #fafbfc; }}
  .pago-tx {{ font-size: 12.5px; color: #44474b; line-height: 1.65; }}
  .nota {{ font-size: 11px; color: #667085; line-height: 1.6; border-top: 1px dashed #e2e6ec; padding-top: 12px; margin-bottom: 4px; }}
  .nota b {{ color: #854f0b; }}
  .firma {{ margin-top: 30px; }}
  .firma .cor {{ font-size: 12.5px; color: #5d6b7e; margin-bottom: 34px; }}
  .firma .ln {{ border-top: 1px solid #333; width: 280px; padding-top: 6px; font-size: 12.5px; line-height: 1.7; }}
</style></head><body>
  <div class="hd">
    <div class="em">
      <div class="ava">{escape(ini)}</div>
      <div><div class="emn">{escape(emisor_nombre)}</div><div class="emc">C.C. {escape(emisor_cedula)}</div></div>
    </div>
    <div class="doc">
      <div class="kic">CUENTA DE COBRO</div>
      <div class="num">N° {escape(numero)}</div>
      <div class="fec">{fecha_txt}</div>
    </div>
  </div>
  <div class="bd">
    <div class="box deu">
      <div class="lbl">Deudor</div>
      <div class="nm">{escape(deudor)}</div>
      <div class="sub">{escape(deudor_doc)}</div>
    </div>
    <div class="box suma">
      <div><div class="lbl">La suma de</div><div class="let">{escape(letras)}</div></div>
      <div class="amt">$ {_miles(valor)}</div>
    </div>
    <div class="box">
      <div class="lbl">Por concepto de</div>
      <div style="font-size:13.5px">{escape(concepto)}</div>
    </div>
    <div class="box pago">
      <div class="lbl">Forma de pago</div>
      <div class="pago-tx">Consignación en la cuenta de <b>{escape(pago_tipo)} N° {escape(pago_numero)}</b> del banco <b>{escape(pago_banco)}</b> a nombre de <b>{escape(pago_titular)}</b>.</div>
    </div>
    {nota}
    <div class="firma">
      <div class="cor">Cordialmente,</div>
      <div class="ln"><b>{escape(emisor_nombre)}</b><br>C.C. {escape(emisor_cedula)}{firma_extra}</div>
    </div>
  </div>
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
