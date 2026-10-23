"""Motor de base de datos (Postgres o SQLite) y utilidades de sesión.

El ``engine`` es reconstruible en vivo: si el usuario cambia la IP/puerto del
servidor (data/servidor.json), ``reconstruir_engine()`` lo rehace sin reiniciar.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

from . import config

DB_URL = config.DB_URL
_ES_SQLITE = DB_URL.startswith("sqlite")


def _crear_engine(url: str):
    es_sqlite = url.startswith("sqlite")
    # connect_timeout evita que la app se cuelgue al arrancar si la base no responde.
    connect_args = {"check_same_thread": False} if es_sqlite else {"connect_timeout": 8}
    return create_engine(url, echo=False, pool_pre_ping=not es_sqlite, connect_args=connect_args)


engine = _crear_engine(DB_URL)


def reconstruir_engine() -> None:
    """Reconstruye el motor desde la ubicación de servidor actual (tras un cambio)."""
    global engine, _ES_SQLITE, DB_URL
    nueva = config.db_url_efectivo()
    anterior = engine
    engine = _crear_engine(nueva)
    DB_URL = nueva
    _ES_SQLITE = nueva.startswith("sqlite")
    try:
        anterior.dispose()
    except Exception:  # noqa: BLE001
        pass


def probar_conexion(url: str | None = None) -> tuple[bool, str]:
    """Prueba una conexión real (SELECT 1). Con ``url=None`` usa el motor actual;
    con una url, crea un motor temporal para probar un servidor candidato."""
    temporal = None
    try:
        eng = engine if url is None else (temporal := _crear_engine(url))
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, (str(exc).splitlines() or [""])[0][:200]
    finally:
        if temporal is not None:
            try:
                temporal.dispose()
            except Exception:  # noqa: BLE001
                pass


def init_db() -> None:
    """Crea el esquema y las tablas si no existen.

    En Postgres, primero asegura el esquema ``maestros`` (search_path apunta
    ahí); en SQLite se ignora el esquema.
    """
    from . import models  # noqa: F401  (registro de tablas)

    if not _ES_SQLITE:
        from .config import DB_SCHEMA
        with engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{DB_SCHEMA}"'))

    SQLModel.metadata.create_all(engine)
    _ensure_columns()


def _ensure_columns() -> None:
    """Migración liviana e idempotente: agrega columnas nuevas a tablas ya
    existentes (``create_all`` solo crea tablas nuevas, no altera columnas).

    Cobros programados por período: ``clienteservicio.periodo`` (AAAA-MM) y
    ``facturacion_id`` (cabecera donde se facturó; NULL = pendiente). La primera
    vez que se crea ``periodo`` se siembra 2026-07 en las filas que eran
    mensuales, para no perder los cobros ya cargados.
    """
    if _ES_SQLITE:
        return
    from .config import DB_SCHEMA
    with engine.begin() as conn:
        ya = conn.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema=:s AND table_name='clienteservicio' "
            "AND column_name='periodo'"), {"s": DB_SCHEMA}).first()
        conn.execute(text(
            "ALTER TABLE clienteservicio "
            "ADD COLUMN IF NOT EXISTS periodo VARCHAR NOT NULL DEFAULT ''"))
        conn.execute(text(
            "ALTER TABLE clienteservicio "
            "ADD COLUMN IF NOT EXISTS facturacion_id INTEGER"))
        if not ya:   # primera migración: sembrar el período de arranque
            conn.execute(text(
                "UPDATE clienteservicio SET periodo='2026-07' "
                "WHERE periodicidad='Mes' AND (periodo IS NULL OR periodo='')"))
        # RBAC: rol de acceso del usuario (FK a rol; NULL = fallback por `rol`).
        conn.execute(text(
            "ALTER TABLE usuario ADD COLUMN IF NOT EXISTS rol_id INTEGER"))
        # Responsable del Registro (FK a usuario; cuenta para el alcance por asignación).
        conn.execute(text(
            "ALTER TABLE cliente ADD COLUMN IF NOT EXISTS responsable_registro_id INTEGER"))
        # Cliente confidencial: solo visible con permiso "clientes.ver_confidencial" (y Super).
        conn.execute(text(
            "ALTER TABLE cliente ADD COLUMN IF NOT EXISTS confidencial BOOLEAN NOT NULL DEFAULT FALSE"))
        # Emisor de la cuenta de cobro asignado al cliente (FK a emisor; NULL = sin asignar).
        conn.execute(text(
            "ALTER TABLE cliente ADD COLUMN IF NOT EXISTS emisor_id INTEGER"))
        # Firma del emisor (data URI base64) para estamparla en la cuenta de cobro.
        conn.execute(text(
            "ALTER TABLE emisor ADD COLUMN IF NOT EXISTS firma VARCHAR NOT NULL DEFAULT ''"))
        # Foto del texto de la nota del art. 383 al generar la cuenta de cobro (editable en Datos de cobro).
        conn.execute(text(
            "ALTER TABLE cuentacobro ADD COLUMN IF NOT EXISTS nota_383_texto VARCHAR NOT NULL DEFAULT ''"))
        # Correo propio del responsable (Graph delegado): cuenta M365 + refresh token cifrado.
        conn.execute(text(
            "ALTER TABLE usuario ADD COLUMN IF NOT EXISTS correo_cuenta VARCHAR NOT NULL DEFAULT ''"))
        conn.execute(text(
            "ALTER TABLE usuario ADD COLUMN IF NOT EXISTS correo_token_enc VARCHAR NOT NULL DEFAULT ''"))
        # Archivo base (Generador de Mvto Contable) por cliente; token %OneDrive% portable.
        conn.execute(text(
            "ALTER TABLE cliente ADD COLUMN IF NOT EXISTS ruta_generador VARCHAR NOT NULL DEFAULT ''"))
        # Foto de la firma del emisor (data URI) en la cuenta de cobro, para estamparla en el PDF.
        conn.execute(text(
            "ALTER TABLE cuentacobro ADD COLUMN IF NOT EXISTS emisor_firma VARCHAR NOT NULL DEFAULT ''"))
        # URL de acceso del portal en la credencial del cliente.
        conn.execute(text(
            "ALTER TABLE clienteclave ADD COLUMN IF NOT EXISTS url VARCHAR NOT NULL DEFAULT ''"))
        # Campos específicos de credenciales ODBC (nombre DSN, archivo DBF, IP).
        conn.execute(text(
            "ALTER TABLE clienteclave ADD COLUMN IF NOT EXISTS odbc_nombre VARCHAR NOT NULL DEFAULT ''"))
        conn.execute(text(
            "ALTER TABLE clienteclave ADD COLUMN IF NOT EXISTS odbc_dbf VARCHAR NOT NULL DEFAULT ''"))
        conn.execute(text(
            "ALTER TABLE clienteclave ADD COLUMN IF NOT EXISTS odbc_ip VARCHAR NOT NULL DEFAULT ''"))
        # Consultas compartidas: descripción y alcance de filas por consulta guardada.
        conn.execute(text(
            "ALTER TABLE consultaguardada ADD COLUMN IF NOT EXISTS descripcion VARCHAR NOT NULL DEFAULT ''"))
        conn.execute(text(
            "ALTER TABLE consultaguardada "
            "ADD COLUMN IF NOT EXISTS alcance VARCHAR NOT NULL DEFAULT 'asignados'"))
        # Parámetros de generación de obligaciones (tabla compartida con Calendario).
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS modo_generacion VARCHAR NOT NULL DEFAULT 'auto_dian'"))
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS paso_dias_habiles INTEGER NOT NULL DEFAULT 1"))
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS tam_intervalo INTEGER NOT NULL DEFAULT 0"))
        # Familia: agrupación visual en el Calendario (columna compartida ya poblada;
        # IF NOT EXISTS es defensivo para instalaciones nuevas, no re-hace el backfill).
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS familia VARCHAR NOT NULL DEFAULT 'otras'"))
        # Cuenta de cobro: ruta donde se guardó el PDF al generar en firme.
        conn.execute(text(
            "ALTER TABLE cuentacobro ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR NOT NULL DEFAULT ''"))
        # Pago en el catálogo de obligaciones (el Calendario lo LEE para el hito de
        # verificación del pago con el recibo 490). Maestros es dueño de escritura.
        ya_pago = conn.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema=:s AND table_name='obligaciontipo' "
            "AND column_name='formulario_pago'"), {"s": DB_SCHEMA}).first()
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS genera_pago BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS formulario_pago VARCHAR NOT NULL DEFAULT ''"))
        if not ya_pago:   # siembra ÚNICA al crear las columnas (no reescribe ediciones posteriores)
            _sembrar_pago(conn)
        # Catálogo Formularios: número DIAN (lo que trae el 490 para validar el pago).
        ya_fnum = conn.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema=:s AND table_name='formulario' AND column_name='numero'"),
            {"s": DB_SCHEMA}).first()
        conn.execute(text(
            "ALTER TABLE formulario ADD COLUMN IF NOT EXISTS numero VARCHAR NOT NULL DEFAULT ''"))
        if not ya_fnum:   # backfill único: saca el número que hoy vive dentro del nombre ("Formulario 350 (…)")
            conn.execute(text(
                "UPDATE formulario SET numero = COALESCE(substring(nombre from '\\d+'), '') WHERE numero=''"))
        # Plazo de pago FATAL (desde el vencimiento) + consecuencia; lo lee el Calendario.
        ya_fatal = conn.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema=:s AND table_name='obligaciontipo' AND column_name='consecuencia_impago'"),
            {"s": DB_SCHEMA}).first()
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS plazo_pago_fatal_num INTEGER NOT NULL DEFAULT 0"))
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS plazo_pago_fatal_unidad VARCHAR NOT NULL DEFAULT ''"))
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS consecuencia_impago VARCHAR NOT NULL DEFAULT ''"))
        if not ya_fatal:
            _sembrar_pago_fatal(conn)
        _agente_retenedor_derivado(conn)


def _sembrar_pago(conn) -> None:
    """Siembra ÚNICA (al crear las columnas, no se repite en arranques siguientes,
    así no reescribe lo que Renzo edite después) de ``genera_pago`` /
    ``formulario_pago`` para las obligaciones conocidas.

    Las DIAN cuyo pago se verifica con un 490 llevan su formulario; las
    municipales (ICA/ReteICA) generan pago pero SIN formulario DIAN (no hay 490).
    El resto queda en el default (``genera_pago=false``) y se ajusta en el catálogo.
    """
    con_formulario = [
        ("RETEFUENTE", "350"), ("RETEIVA", "350"),            # retención en la fuente (renta + IVA)
        ("IVA_BIM", "300"), ("IVA_CUAT", "300"), ("IVA_ANUAL", "300"),
        ("INC", "315"),                                        # impuesto al consumo
        ("RENTA_JUR", "110"), ("RENTA_GC", "110"),             # renta PJ / grandes contribuyentes
        ("RENTA_NAT", "210"),                                  # renta personas naturales
    ]
    for cod, formulario in con_formulario:
        conn.execute(text(
            "UPDATE obligaciontipo SET genera_pago=TRUE, formulario_pago=:f WHERE codigo=:c"),
            {"f": formulario, "c": cod})
    # Municipales: generan pago a verificar pero sin formulario DIAN (no hay 490).
    for cod in ("ICA_MUN", "RETEICA_MUN", "AUTORETEICA_MUN", "RETICA_CTG"):
        conn.execute(text(
            "UPDATE obligaciontipo SET genera_pago=TRUE WHERE codigo=:c"), {"c": cod})


def _sembrar_pago_fatal(conn) -> None:
    """Siembra ÚNICA (al crear las columnas) de las reglas de pago FATAL conocidas:
    plazo contado desde el VENCIMIENTO + consecuencia grave si no se paga. El
    resto de obligaciones queda sin regla (solo intereses).

    - 350 (RETEFUENTE, RETEIVA): 60 días calendario → ineficacia (se da por no presentada).
    - 2593 (RST_ANT, anticipo Simple): 1 mes → exclusión del RST.
    """
    for cod in ("RETEFUENTE", "RETEIVA"):
        conn.execute(text(
            "UPDATE obligaciontipo SET plazo_pago_fatal_num=60, plazo_pago_fatal_unidad='dias', "
            "consecuencia_impago='ineficacia' WHERE codigo=:c"), {"c": cod})
    conn.execute(text(
        "UPDATE obligaciontipo SET plazo_pago_fatal_num=1, plazo_pago_fatal_unidad='meses', "
        "consecuencia_impago='exclusion_rst' WHERE codigo='RST_ANT'"))


def _agente_retenedor_derivado(conn) -> None:
    """`cliente.agente_retenedor` se calcula del RUT; no se llena a mano.

    Decisión de Renzo el 13-oct-2026. Antes era un campo que nadie podía
    editar —no hay control en la pantalla de Clientes— y que solo tenía valor
    en los 59 clientes de la carga inicial de julio; los 238 creados después
    quedaron en nulo. Un campo así no dice la verdad y nadie puede corregirlo.

    La fuente es la casilla 53 del RUT, que sí se carga del PDF: es agente de
    retención quien declara la responsabilidad 07 (retención a título de renta)
    o 23 (agente de retención en ventas). **Son los mismos dos códigos con que
    el Liquidador 350 decide a quién ofrece**, y tienen que seguir siendo los
    mismos: si discreparan, un cliente podría figurar como agente de retención
    aquí y no poder liquidarse allá.

    Va en un disparador y no en el router a propósito: así vale para toda vía
    de escritura —la API, una carga masiva, un script— y no solo para la
    pantalla. Lo que llegue en el campo desde afuera se ignora.
    """
    from .config import DB_SCHEMA

    #: El criterio, escrito una sola vez: se usa en el disparador y en el
    #: recálculo de las filas que ya estaban.
    #:
    #: Tres valores, no dos: nulo cuando el RUT no está cargado. Sin ese dato no
    #: se puede afirmar que alguien NO es agente de retención —son 190 clientes
    #: al 13-oct-2026— y es el mismo criterio que `_normalizar_regimen_iva` ya
    #: aplica al régimen. Además así se distingue «sabemos que no» de «no
    #: sabemos», que es justo lo que necesita quien va a cargar los RUT.
    es_agente = """
        CASE WHEN COALESCE(json_array_length(
                      COALESCE({fila}responsabilidades, '[]'::json)), 0) = 0
             THEN NULL
             ELSE EXISTS (SELECT 1 FROM json_array_elements(
                                        {fila}responsabilidades) item
                           WHERE COALESCE(item->>'codigo', item#>>'{{}}')
                                 IN ('07', '23'))
        END"""

    conn.execute(text(f"""
        CREATE OR REPLACE FUNCTION "{DB_SCHEMA}".calcular_agente_retenedor()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.agente_retenedor := {es_agente.format(fila='NEW.')};
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """))
    conn.execute(text(
        f'DROP TRIGGER IF EXISTS cliente_agente_retenedor ON "{DB_SCHEMA}".cliente'))
    conn.execute(text(f"""
        CREATE TRIGGER cliente_agente_retenedor
        BEFORE INSERT OR UPDATE OF responsabilidades, agente_retenedor
            ON "{DB_SCHEMA}".cliente
        FOR EACH ROW EXECUTE FUNCTION "{DB_SCHEMA}".calcular_agente_retenedor()
    """))
    # Las filas que ya estaban: se recalculan todas, incluidas las de la carga
    # inicial. Donde la marca y el RUT discrepaban, manda el RUT.
    conn.execute(text(f"""
        UPDATE "{DB_SCHEMA}".cliente SET agente_retenedor = {es_agente.format(fila='')}
         WHERE agente_retenedor IS DISTINCT FROM {es_agente.format(fila='')}
    """))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
