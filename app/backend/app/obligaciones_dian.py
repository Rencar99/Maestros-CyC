"""Motor de aplicabilidad de obligaciones DIAN — fuente única (Maestros manda).

Deriva QUÉ obligaciones DIAN aplican a un cliente a partir de sus atributos del
RUT: responsabilidades (casilla 53), tipo de contribuyente, gran contribuyente y
periodicidad de IVA. Es la ÚNICA derivación de la firma: el Calendario ya no
re-deriva, solo lee ``ClienteObligacion``.

El apareamiento se hace por ``obligaciontipo.disparador`` (anclaje estable, no
depende del código). Las obligaciones ``origen != 'dian'`` (manuales: super*,
nómina, municipales, etc.) NO se derivan: las pone/quita la firma a mano.
"""
from __future__ import annotations

from sqlmodel import Session, select

from .models import Cliente, ClienteObligacion, ObligacionTipo


def codigos_resp(c: Cliente) -> set[str]:
    """Códigos de responsabilidad (RUT casilla 53) del cliente, como set de str."""
    out: set[str] = set()
    for r in (c.responsabilidades or []):
        cod = r.get("codigo") if isinstance(r, dict) else r
        if cod:
            out.add(str(cod))
    return out


def aplica_disparador(disp: str, c: Cliente, resp: set[str]) -> bool:
    """¿La obligación con este ``disparador`` aplica al cliente? (regla canónica)."""
    gc = bool(c.gran_contribuyente)
    rst = "47" in resp                      # Régimen Simple (RST)
    pj = c.tipo_contribuyente == "Jur"      # persona jurídica
    if disp == "renta_jur":    return "05" in resp and pj and not gc
    if disp == "renta_nat":    return "05" in resp and c.tipo_contribuyente == "Nat"
    if disp == "renta_gc":     return "05" in resp and gc
    if disp == "retencion":    return "07" in resp
    # ReteIVA (resp 09) NO es obligación aparte: se liquida en el MISMO Form 350
    # que la retención en la fuente. Se retiró como disparador (obligación RETEIVA
    # desactivada). El filtro activo==True ya impide que reaparezca.
    if disp == "inc":          return "33" in resp          # Impuesto Nacional al Consumo
    if disp == "iva_bim":      return "48" in resp and not rst and c.periodicidad_iva == "Bimestral"
    if disp == "iva_cuat":     return "48" in resp and not rst and c.periodicidad_iva == "Cuatrimestral"
    if disp == "iva_anual":    return rst and "48" in resp   # IVA consolidado anual (RST)
    if disp == "rst_anual":    return rst                    # RST — declaración anual
    if disp == "rst_anticipo": return rst                    # RST — anticipos bimestrales
    if disp == "exogena_jn":   return "14" in resp and not gc
    if disp == "exogena_gc":   return "14" in resp and gc
    if disp == "beneficiarios": return pj                    # RUB — toda persona jurídica
    return False


def ids_aplicables(session: Session, c: Cliente) -> list[int]:
    """IDs de ObligacionTipo DIAN que aplican al cliente (para vista previa)."""
    resp = codigos_resp(c)
    tipos = session.exec(select(ObligacionTipo).where(
        ObligacionTipo.origen == "dian", ObligacionTipo.activo == True)).all()  # noqa: E712
    return [t.id for t in tipos if aplica_disparador(t.disparador, c, resp)]


# --- Reconciliación REVISABLE (nada se aplica en silencio) -------------------
# La derivación NO corre al guardar. La firma revisa y aplica a mano: agregar las
# faltantes con un clic; quitar las sobrantes SOLO con confirmación (por si una se
# puso a propósito). Las manuales (origen != 'dian') nunca entran a estas listas.

def dian_tipos(session: Session) -> list[ObligacionTipo]:
    """Catálogo de obligaciones DIAN (origen 'dian'). Cárgalo UNA vez y reúsalo en
    los recorridos de varios clientes (evita releerlo por cliente)."""
    return session.exec(select(ObligacionTipo).where(ObligacionTipo.origen == "dian")).all()


def present_map(session: Session) -> dict[int, set[int]]:
    """{cliente_id → set(obligacion_tipo_id presentes)} para TODOS los clientes, en
    una sola consulta (dos columnas). Para reconciliar en lote sin N+1."""
    m: dict[int, set[int]] = {}
    for cid, otid in session.exec(
            select(ClienteObligacion.cliente_id, ClienteObligacion.obligacion_tipo_id)).all():
        m.setdefault(cid, set()).add(otid)
    return m


def diff_mem(c: Cliente, resp: set[str], dian: list[ObligacionTipo],
             present_ids: set[int]) -> tuple[list[int], list[int]]:
    """(faltan, sobran) EN MEMORIA: núcleo del diff con catálogo DIAN y presentes
    ya cargados (sin consultar). Lo usan la lista (`desincronizado`) y el lote."""
    if not resp:
        return ([], [])
    dian_ids = {t.id for t in dian}
    aplic = {t.id for t in dian if t.activo and aplica_disparador(t.disparador, c, resp)}
    faltan = sorted(aplic - present_ids)
    sobran = sorted((present_ids & dian_ids) - aplic)
    return (faltan, sobran)


def desincronizado(c: Cliente, resp: set[str], dian: list[ObligacionTipo],
                   present_ids: set[int]) -> bool:
    """¿El cliente tiene diferencias DIAN por revisar? Versión EN MEMORIA para la
    lista: recibe los tipos DIAN y el set de ids presentes ya cargados (sin N+1)."""
    faltan, sobran = diff_mem(c, resp, dian, present_ids)
    return bool(faltan or sobran)
