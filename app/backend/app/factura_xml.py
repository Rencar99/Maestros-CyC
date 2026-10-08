"""Lector de facturas electrónicas de venta (UBL 2.1 DIAN).

Extrae de un XML de factura (o de un AttachedDocument que la contenga) los datos
para cruzar contra la facturación aprobada: número, fecha, período (Note),
cliente (NIT + nombre), base gravable, IVA, total, retenciones (si vinieran) y
las líneas (concepto + valor). Las facturas de venta normalmente NO incluyen
retenciones: esas las aplica el adquirente al pagar.
"""
from __future__ import annotations

import re
from xml.etree import ElementTree as ET

_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
_NS = {"cac": _CAC, "cbc": _CBC}


def _f(s) -> float:
    try:
        return float(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return 0.0


def _t(el) -> str:
    return el.text.strip() if el is not None and el.text else ""


def parse_factura_xml(data: bytes) -> dict:
    """Devuelve los campos de la factura. Lanza si el XML no es una factura."""
    txt = data.decode("utf-8", "ignore")
    # AttachedDocument: la factura va embebida (CDATA/escapada). Extraer el Invoice.
    if not re.match(r"\s*<\?xml[^>]*\?>\s*<Invoice", txt) and "<Invoice" in txt:
        m = re.search(r"<Invoice[\s\S]*?</Invoice>", txt)
        if m:
            txt = m.group(0)
    root = ET.fromstring(txt.encode("utf-8"))

    def find(path):
        return root.find(path, _NS)

    def findall(path):
        return root.findall(path, _NS)

    numero = _t(find("cbc:ID"))
    fecha = _t(find("cbc:IssueDate"))
    periodo = _t(find("cbc:Note"))
    cliente_nit = _t(find("cac:AccountingCustomerParty//cac:PartyTaxScheme/cbc:CompanyID")) \
        or _t(find("cac:AccountingCustomerParty//cac:PartyLegalEntity/cbc:CompanyID"))
    cliente_nom = _t(find("cac:AccountingCustomerParty//cac:PartyName/cbc:Name")) \
        or _t(find("cac:AccountingCustomerParty//cac:PartyLegalEntity/cbc:RegistrationName"))
    base = _f(_t(find("cac:LegalMonetaryTotal/cbc:LineExtensionAmount")))
    total = _f(_t(find("cac:LegalMonetaryTotal/cbc:PayableAmount")))

    iva = 0.0
    for tt in findall("cac:TaxTotal"):
        amt = tt.find("cbc:TaxAmount", _NS)
        iva += _f(_t(amt))

    retenciones: dict[str, float] = {}
    for wt in findall("cac:WithholdingTaxTotal"):
        amt = wt.find("cbc:TaxAmount", _NS)
        nm = wt.find(".//cac:TaxScheme/cbc:Name", _NS)
        retenciones[_t(nm) or "Retención"] = retenciones.get(_t(nm) or "Retención", 0) + _f(_t(amt))

    lineas = []
    for ln in findall("cac:InvoiceLine"):
        lineas.append({
            "desc": _t(ln.find("cac:Item/cbc:Description", _NS)),
            "base": _f(_t(ln.find("cbc:LineExtensionAmount", _NS))),
        })

    return {
        "numero": numero, "fecha": fecha, "periodo": periodo,
        "cliente_nit": cliente_nit, "cliente_nombre": cliente_nom,
        "base": base, "iva": iva, "total": total,
        "retenciones": retenciones, "lineas": lineas,
    }
