"""Utilidades de dominio (sin dependencias de web ni de BD)."""
from __future__ import annotations

# Pesos del algoritmo del dígito de verificación (DV) de la DIAN.
_PESOS_DV = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]


def calcular_dv(num_id: str) -> int | None:
    """Dígito de verificación del NIT/documento (algoritmo DIAN).

    Toma solo los dígitos, los pondera de derecha a izquierda y aplica módulo 11.
    Devuelve None si no hay dígitos.
    """
    d = [int(ch) for ch in str(num_id or "") if ch.isdigit()]
    if not d:
        return None
    s = sum(d[-1 - i] * _PESOS_DV[i] for i in range(len(d)) if i < len(_PESOS_DV))
    r = s % 11
    return r if r < 2 else 11 - r


def componer_nombre(primer_apellido: str, segundo_apellido: str,
                    primer_nombre: str, otros_nombres: str) -> str:
    """Arma el nombre de una persona natural desde sus componentes.

    Orden de la firma: apellido1 apellido2 nombre1 nombre2. La fuente de verdad
    son los componentes; este ``nombre`` es solo para mostrar/buscar.
    """
    partes = [primer_apellido, segundo_apellido, primer_nombre, otros_nombres]
    return " ".join(p.strip() for p in partes if p and p.strip()).strip()
