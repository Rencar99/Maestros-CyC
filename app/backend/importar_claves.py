"""Importa el CSV "Claves Clientes" a la tabla ClienteClave (cifrando la clave).

Cruce por NIT (autoridad). El NIT 900489398 es un "comodín" (la firma) con muchas
razones sociales distintas: esas filas y las de NIT no hallado se cruzan por
Razón Social (clave compacta, sin espacios/acentos). Lo que no resuelva -> se
reporta y NO se carga.

Uso:
    python importar_claves.py            # PREVISUALIZADO (no escribe)
    python importar_claves.py --commit   # carga de verdad (idempotente)
"""
from __future__ import annotations

import csv
import io
import re
import sys
import unicodedata
from collections import Counter, defaultdict

from sqlmodel import Session, select

from app.db import engine
from app.models import Cliente, ClienteClave, Portal
from app.security import encrypt

CSV_PATH = r"C:\Users\COMPUMAX\Downloads\Claves Clientes.csv"
COMODIN = "900489398"          # NIT de la firma usado como comodín (no confiable)
COMMIT = "--commit" in sys.argv


def digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def key(s: str) -> str:
    """Clave compacta para cruzar por nombre: sin acentos, sin no-alfanuméricos."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]", "", s).upper()


def leer_csv() -> list[dict]:
    raw = open(CSV_PATH, "rb").read()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return list(csv.DictReader(io.StringIO(raw.decode(enc))))
        except UnicodeDecodeError:
            continue
    raise SystemExit("No se pudo decodificar el CSV")


def main() -> None:
    filas = leer_csv()
    with Session(engine) as s:
        clientes = s.exec(select(Cliente)).all()
        by_nit = {digits(c.num_id): c.id for c in clientes if digits(c.num_id)}
        by_key: dict[str, list[int]] = defaultdict(list)
        for c in clientes:
            by_key[key(c.nombre)].append(c.id)

        # Portales existentes (por descripción exacta, trim)
        portales = {p.descripcion.strip(): p for p in s.exec(select(Portal)).all()}

        # Claves ya existentes (para no duplicar en re-ejecuciones)
        existentes = set()
        for k in s.exec(select(ClienteClave)).all():
            existentes.add((k.cliente_id, k.portal_id, (k.usuario or "").lower(), (k.comentario or "").lower()))

        por_nit = por_nombre = sin_cliente = duplicadas = 0
        nuevos_portales: set[str] = set()
        sin_cliente_muestra: list[str] = []
        a_crear: list[tuple] = []   # (cid, portal_desc, usuario, comentario, clave)

        for f in filas:
            nit = digits(f.get("NIT", ""))
            razon = (f.get("Razon Social") or "").strip()
            cid = None
            if nit and nit != COMODIN and nit in by_nit:
                cid = by_nit[nit]; modo = "nit"
            else:
                ks = by_key.get(key(razon))
                if ks and len(ks) == 1:
                    cid = ks[0]; modo = "nombre"
            if cid is None:
                sin_cliente += 1
                if len(sin_cliente_muestra) < 15:
                    sin_cliente_muestra.append(f"{nit or '(sin nit)'} · {razon}")
                continue
            por_nit += (modo == "nit"); por_nombre += (modo == "nombre")

            portal_desc = (f.get("Tipo Portal") or "").strip() or "Otro"
            if portal_desc not in portales:
                nuevos_portales.add(portal_desc)
            a_crear.append((cid, portal_desc, (f.get("Usuario") or "").strip(),
                            (f.get("Comentarios") or "").strip(), (f.get("Pasabordo") or "")))

        # ---- Resumen
        print(f"Filas CSV: {len(filas)}")
        print(f"  cruzan por NIT:    {por_nit}")
        print(f"  cruzan por nombre: {por_nombre}  (comodín/otros)")
        print(f"  SIN cliente (no se cargan): {sin_cliente}")
        if sin_cliente_muestra:
            print("   muestra sin cliente:")
            for m in sin_cliente_muestra:
                print("     -", m)
        print(f"Portales nuevos a crear: {len(nuevos_portales)} -> {sorted(nuevos_portales)}")

        if not COMMIT:
            print("\n[PREVISUALIZADO] No se escribió nada. Ejecuta con --commit para cargar.")
            return

        # ---- Commit
        for desc in sorted(nuevos_portales):
            p = Portal(descripcion=desc, activo=True)
            s.add(p); s.flush(); portales[desc] = p
        creadas = 0
        for cid, portal_desc, usuario, comentario, clave in a_crear:
            pid = portales[portal_desc].id
            firma = (cid, pid, usuario.lower(), comentario.lower())
            if firma in existentes:
                continue
            existentes.add(firma)
            s.add(ClienteClave(cliente_id=cid, portal_id=pid, usuario=usuario,
                               comentario=comentario, clave_enc=encrypt(clave) if clave else ""))
            creadas += 1
        s.commit()
        print(f"\n[OK] Portales creados: {len(nuevos_portales)} | Claves creadas: {creadas} | "
              f"duplicadas omitidas: {len(a_crear) - creadas}")


if __name__ == "__main__":
    main()
