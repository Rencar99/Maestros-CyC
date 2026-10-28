"""Control de concurrencia OPTIMISTA (compartido entre routers).

La UI manda la marca de tiempo con la que cargó el registro (``?base=<ISO>``) y el
guardado la compara con la actual; si otra persona guardó entremedias, se corta con
409 (no se pisa su cambio). Sin candados → nada que quede colgado.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException


def mismo_ts(base: Optional[str], dt: Optional[datetime]) -> bool:
    """¿La marca base (ISO del front) coincide con la actual? Tolerante a la
    serialización (zona horaria, al segundo). ``base`` None = sin chequeo (compat)."""
    if not base:                 # "" o None: no hay base que comparar
        return dt is None or base is None
    if dt is None:
        return False
    try:
        b = datetime.fromisoformat(base.replace("Z", "+00:00"))
        if b.tzinfo:
            b = b.astimezone(timezone.utc).replace(tzinfo=None)
        return abs((b - dt).total_seconds()) < 1.0
    except ValueError:
        return False


def exigir_sin_conflicto(base: Optional[str], dt: Optional[datetime],
                         nombre: str, por: str = "") -> None:
    """Lanza 409 si ``base`` no coincide con ``dt`` (otro guardó mientras editabas)."""
    if mismo_ts(base, dt):
        return
    quien = (por or "").strip() or "otra persona"
    cuando = (f" ({dt.replace(tzinfo=timezone.utc).astimezone().strftime('%d/%m %H:%M')})"
              if dt else "")
    raise HTTPException(
        409,
        f"«{nombre}» fue modificado por {quien}{cuando} mientras lo editabas. "
        f"Recarga y vuelve a aplicar tus cambios.")
