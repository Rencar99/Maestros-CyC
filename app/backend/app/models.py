"""Modelos de datos (SQLModel) de los Maestros compartidos de la firma.

Esquema Postgres destino: ``maestros`` (search_path). Tablas:
  · Catálogos editables: ``RolServicio``, ``Software``.
  · ``Usuario``  — Responsables de la firma (internos que inician sesión y externos).
  · ``Cliente``  — catálogo ancho de clientes/contribuyentes, con hijas:
        ``ClienteServicio``     (N servicios comerciales por cliente),
        ``ClienteMunicipioIca`` (N municipios donde declara ICA).

Regla de la firma: la clave del portal DIAN se guarda cifrada (Fernet) en
``Cliente.password_enc`` y NUNCA se devuelve en las lecturas.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import JSON, Column, Numeric
from sqlmodel import Field, SQLModel


# ============================================================ Catálogos editables
class RolServicio(SQLModel, table=True):
    """Tipos de servicio que presta la firma (lista editable desde la app)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    descripcion: str = Field(index=True, unique=True)
    activo: bool = True


class Entidad(SQLModel, table=True):
    """Entidades / entes de control (DIAN, UGPP, Superintendencias, Hacienda…).
    Alimenta el Calendario y el campo Ente de las Obligaciones."""

    id: Optional[int] = Field(default=None, primary_key=True)
    nombre: str = Field(index=True, unique=True)
    sigla: str = ""
    activo: bool = True


class Emisor(SQLModel, table=True):
    """Persona que emite y firma las cuentas de cobro a nombre de la firma
    (p. ej. 'MB' = María Bernarda). Cada emisor lleva su propio consecutivo."""

    id: Optional[int] = Field(default=None, primary_key=True)
    nombre: str = Field(index=True, unique=True)
    cedula: str = ""
    direccion: str = ""
    celular: str = ""
    prefijo: str = ""                  # iniciales para el N° de la cuenta (ej. "MB")
    consecutivo: int = 0               # último número usado; el siguiente = consecutivo + 1
    nota_383: bool = False             # incluir la nota del art. 383 ET en la cuenta de cobro
    firma: str = ""                    # imagen de la firma (data URI base64) para la cuenta de cobro
    activo: bool = True


class Parametro(SQLModel, table=True):
    """Parámetros de configuración de la firma (clave-valor). P. ej. los datos de
    pago que salen en las cuentas de cobro (cobro_banco, cobro_numero_cuenta…)."""

    clave: str = Field(primary_key=True)
    valor: str = ""


class Software(SQLModel, table=True):
    """Software contable/administrativo utilizado por los clientes (lista editable)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    descripcion: str = Field(index=True, unique=True)
    activo: bool = True


class ObligacionTipo(SQLModel, table=True):
    """Registro único de obligaciones para el calendario de la firma.

    Cubre tanto las obligaciones DIAN que se derivan del perfil del cliente
    (``origen='dian'``: IVA, retención, renta, exógena…) como las 'otras
    obligaciones' que la firma marca por cliente (``origen='manual'``:
    superintendencias, nómina electrónica, PILA…). El vencimiento se calcula
    con la tabla ``PlazoVencimiento`` según ``digitos_nit``.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    descripcion: str = Field(index=True, unique=True)
    activo: bool = True
    codigo: str = ""               # clave estable p.ej. "IVA_BIM", "RETEFUENTE", "SUPERSOCIEDADES"
    ente: str = ""                 # DIAN | Supersociedades | Supersalud | UGPP (PILA) | ...
    periodicidad: str = ""         # Mensual | Bimestral | Cuatrimestral | Semestral | Anual
    digitos_nit: int = 1           # (compat) nº de últimos dígitos; ver 'criterio'
    criterio: str = "nit1"         # cómo vence: nit1 | nit2 | fijo | grupo | municipio
    origen: str = "manual"         # "dian" (auto-derivada del perfil) | "manual" (pestaña Otras Obligaciones)
    disparador: str = ""           # QUÉ la activa (anclaje estable, no depende del código):
    #   renta_jur | renta_nat | renta_gc | retencion | iva_bim | iva_cuat | exogena_jn | exogena_gc
    # --- Parámetros de generación (tabla compartida con Calendario) ---
    # Maestros es dueño de escritura de tam_intervalo / paso_dias_habiles (se editan aquí);
    # modo_generacion es de Calendario: se mapea para preservarlo, NO se edita en Maestros.
    modo_generacion: str = "auto_dian"   # (Calendario) secuencia | fija | auto_dian
    paso_dias_habiles: int = 1            # días hábiles que avanza por grupo
    tam_intervalo: int = 0               # tamaño del intervalo de NIT por grupo (nit2: de a 2, 5…)
    # Agrupación visual en el Calendario (columna compartida, ya poblada por Calendario).
    # Maestros la deja elegir al crear/editar la obligación.
    familia: str = "otras"               # dian | super | municipal | nomina | otras
    # --- Pago (lo LEE el Calendario para el hito de verificación del pago con el 490) ---
    # Maestros es dueño de estos campos (se editan en el catálogo).
    genera_pago: bool = False            # ¿puede generar un pago a verificar? (retención, IVA, renta, consumo, ICA/ReteICA)
    formulario_pago: str = ""            # formulario DIAN que paga, para cruzar el 490 (350/300/110/210/315…); vacío = municipal/sin 490
    # Plazo de pago FATAL contado desde el VENCIMIENTO (no la presentación), con consecuencia
    # grave si no se paga. Lo LEE el Calendario para calcular la fecha límite y alertar.
    plazo_pago_fatal_num: int = 0        # 0 = sin plazo fatal
    plazo_pago_fatal_unidad: str = ""    # "dias" | "meses"
    consecuencia_impago: str = ""        # "ineficacia" | "exclusion_rst" | "" (solo intereses)


class Cargo(SQLModel, table=True):
    """Cargos de la firma (lista editable desde Catálogos)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    descripcion: str = Field(index=True, unique=True)
    activo: bool = True


class GrupoEconomico(SQLModel, table=True):
    """Grupos económicos para agrupar clientes de un mismo dueño (lista editable)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    descripcion: str = Field(index=True, unique=True)
    activo: bool = True


class Portal(SQLModel, table=True):
    """Portales/entidades donde el cliente tiene credenciales (lista editable):
    DIAN, Cámara de Comercio, Alcaldía, banco, Escritorio Remoto, etc."""

    id: Optional[int] = Field(default=None, primary_key=True)
    descripcion: str = Field(index=True, unique=True)
    activo: bool = True


class TipoDocumento(SQLModel, table=True):
    """Catálogo de tipos de documento de la DIAN (referencia general)."""

    codigo: str = Field(primary_key=True)      # CC, NT, CE, PA, ...
    descripcion: str
    orden: int = 0                             # para conservar el orden de la DIAN


class Responsabilidad(SQLModel, table=True):
    """Catálogo de responsabilidades del RUT (casilla 53), editable/general."""

    codigo: str = Field(primary_key=True)      # 07, 09, 48, ...
    descripcion: str
    orden: int = 0


class FormaCobro(SQLModel, table=True):
    """Catálogo de formas de cobro de un servicio (editable desde Catálogos)."""

    codigo: str = Field(primary_key=True)      # Fa, CC, Ma, ...
    descripcion: str                           # Factura, Cuenta de cobro, Mandato
    orden: int = 0


# ==================================================== Roles y permisos (RBAC)
class Rol(SQLModel, table=True):
    """Rol de acceso. ``sistema`` = no editable/borrable (ej. Super Usuario)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    nombre: str = Field(index=True, unique=True)
    sistema: bool = False           # rol de sistema (Super): todos los permisos
    orden: int = 0
    activo: bool = True


class Permiso(SQLModel, table=True):
    """Catálogo de permisos, llave ``seccion.accion`` (sembrado desde código)."""

    clave: str = Field(primary_key=True)       # "clientes.editar"
    seccion: str = ""                          # "clientes"
    accion: str = ""                           # "editar"
    etiqueta: str = ""                         # "Editar"
    orden: int = 0


class RolPermiso(SQLModel, table=True):
    """Qué permisos tiene cada rol (N:N)."""

    rol_id: int = Field(primary_key=True)
    permiso_clave: str = Field(primary_key=True)


class Municipio(SQLModel, table=True):
    """Catálogo de municipios (DANE). ``codigo`` de 5 dígitos; el departamento
    se deriva del prefijo de 2 dígitos. Referencia con búsqueda en la ficha."""

    codigo: str = Field(primary_key=True)      # 5 dígitos DANE
    nombre: str = Field(index=True)
    departamento: str = ""                     # nombre del departamento


class Ciiu(SQLModel, table=True):
    """Catálogo CIIU (clasificación de actividades económicas de la DIAN).

    ``codigo`` es la clave (4 dígitos). Se busca por código o por nombre para
    llenar ``cliente.actividad_ciiu_*`` y el CIIU de cada municipio ICA; el
    nombre se resuelve por lookup (no se duplica en el cliente)."""

    codigo: str = Field(primary_key=True)      # 4 dígitos
    descripcion: str = Field(index=True)


# ============================================================ Responsables
class Usuario(SQLModel, table=True):
    """Responsable de la firma.

    ``tipo`` distingue **interno** (empleado que accede al aplicativo) de
    **externo** (colaborador que no inicia sesión). ``cargo`` aplica solo a
    internos. Solo los internos tienen ``usuario``/``password_hash``; en los
    externos ``usuario`` va NULL (por eso es opcional y único-si-existe).
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    tipo: str = "Int"              # "Int" (interno) | "Ext" (externo)
    nombre: str
    cedula: str = ""
    tarjeta_profesional: str = ""
    # 1-Profesional | 2-Postgrado | 3-Maestría | 4-Doctorado | 5-Otros
    formacion_academica: int = 1
    formacion_nombre: str = ""      # título/nombre (ej. "Contador Público")
    apodo: str = ""                 # abreviatura/iniciales (ej. "LAR"), 3 caracteres
    email_corporativo: str = ""

    # Acceso (solo internos inician sesión)
    usuario: Optional[str] = Field(default=None, index=True, unique=True)  # login
    password_hash: str = ""        # hash Argon2 (para autenticar)
    password_enc: str = ""         # clave cifrada (Fernet, reversible) para que el superusuario la vea
    rol: str = "usuario"           # "admin" | "usuario" (compat; ver rol_id)
    rol_id: Optional[int] = None   # FK a Rol (RBAC); NULL = usar fallback por `rol`
    activo: bool = True
    debe_cambiar: bool = True      # forzar cambio de contraseña al primer ingreso
    foto: str = ""                 # data URI base64 (opcional)
    cargo: str = ""                # solo Tipo interno
    telefono: str = ""
    creado_at: datetime = Field(default_factory=datetime.utcnow)


class Formulario(SQLModel, table=True):
    """Catálogo de formularios DIAN cuyos borradores se presentan (350, etc.).

    ``codigo_calendario`` es la llave estable para enlazar a futuro con la
    obligación del Calendario. La autorización para presentar borradores es por
    usuario Y por formulario (ver ``UsuarioFormulario``)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    nombre: str = Field(index=True, unique=True)            # "Formulario 350 (Rete Renta)"
    numero: str = ""                                        # "350" — número DIAN (lo que trae el 490 para validar el pago)
    codigo_calendario: str = Field(default="", index=True)  # "Rete_Renta"
    activo: bool = True


class UsuarioFormulario(SQLModel, table=True):
    """Matriz de autorización: el usuario puede PRESENTAR borradores del
    formulario. La presencia de la fila = autorizado. Super siempre puede (no
    necesita fila)."""

    usuario_id: int = Field(foreign_key="usuario.id", primary_key=True)
    formulario_id: int = Field(foreign_key="formulario.id", primary_key=True)


# ============================================================ Clientes
class Cliente(SQLModel, table=True):
    """Catálogo ancho de clientes/contribuyentes (fuente única de la firma)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    # Confidencial: solo lo ven usuarios con permiso "clientes.ver_confidencial" (y Super).
    confidencial: bool = Field(default=False, index=True)

    # --- Identificación ---
    tipo_contribuyente: str        # "Nat" | "Jur"
    tipo_documento: str = "CC"     # Jur → "NT"
    num_id: str = Field(index=True, unique=True)   # sin dígito de verificación
    dv: Optional[int] = None       # dígito de verificación (lo calcula el sistema)
    sigla: str = ""                # sigla/acrónimo del cliente (máx. 3 caracteres)
    nombre: str                    # display; en Nat se ARMA desde los componentes
    razon_social: str = ""         # solo Jur (RUT casilla 35); Jur: nombre = razon_social
    # Nat: la fuente de verdad son estos 4 componentes (RUT 31-34); nombre se deriva.
    primer_apellido: str = ""      # solo Nat (RUT 31)
    segundo_apellido: str = ""     # (32)
    primer_nombre: str = ""        # (33)
    otros_nombres: str = ""        # (34)
    software_id: Optional[int] = Field(default=None, foreign_key="software.id")
    emisor_id: Optional[int] = Field(default=None, foreign_key="emisor.id")   # emisor de la cuenta de cobro
    logo: str = ""                 # logo del cliente (data URI base64, opcional)
    objeto_social: str = ""        # objeto social del cliente (texto largo)

    # --- Representante legal (solo Jur) ---
    representante_tipo_documento: str = ""
    representante_num_id: str = ""
    representante_nombre: str = ""
    representante_desde: str = ""   # RUT casilla 99: fecha inicio ejercicio (AAAA-MM-DD)
    representante_codigo: str = ""  # RUT casilla 98: código de representación (01..21, 99)

    # --- Contador y Revisor fiscal declarados en el RUT (Hoja 5) ---
    contador_nombre: str = ""
    contador_tarjeta: str = ""
    contador_desde: str = ""        # fecha de nombramiento
    revisor_nombre: str = ""
    revisor_tarjeta: str = ""
    revisor_desde: str = ""         # fecha de nombramiento

    # --- Contacto / Ubicación ---
    email: str = ""
    email_alt: str = ""
    telefono: str = ""
    direccion: str = ""            # RUT casilla 41
    departamento_dane: str = ""    # código DANE
    municipio_dane: str = ""       # código DANE

    # --- Clasificación tributaria ---
    regimen: str = "Ordinario"     # "Ordinario" (110/210) | "Simple" (RST → 260)
    regimen_desde: Optional[int] = None    # año a partir del cual está en ese régimen
    seccional_codigo: str = ""     # RUT casilla 12: administración / seccional DIAN (01, 02…)
    actividad_ciiu_principal: str = ""     # RUT casilla 46
    actividad_ciiu_secundaria: str = ""
    responsabilidades: list = Field(default_factory=list, sa_column=Column(JSON))  # RUT 53
    periodicidad_iva: str = ""     # "Bimestral" | "Cuatrimestral" | "Anual" (resp. 48; RST=Anual)
    responsable_iva: Optional[bool] = None
    # DERIVADO del RUT: lo calcula un disparador desde `responsabilidades`
    # (07 o 23, los mismos códigos del Liquidador 350). No se llena a mano y lo
    # que llegue en este campo desde afuera se ignora. Ver
    # `db._agente_retenedor_derivado`.
    agente_retenedor: Optional[bool] = None
    facturador_electronico: Optional[bool] = None
    gran_contribuyente: Optional[bool] = None

    # --- Portal DIAN (secreto) ---
    password_enc: str = ""         # clave del portal, cifrada (Fernet)
    clave_actualizada_at: Optional[datetime] = None

    # --- Comercial ---
    estado: str = "Act"            # "Act" | "Ina"
    cliente_desde: str = ""        # "AAAA-MM": mes/año desde que es cliente de la firma

    # --- Gestión interna (firma) ---
    responsable_impuestos_id: Optional[int] = Field(default=None, foreign_key="usuario.id")           # Responsable Impuestos
    coordinador_impuestos_id: Optional[int] = Field(default=None, foreign_key="usuario.id")           # 2ª persona (coordinador)
    responsable_financiero_id: Optional[int] = Field(default=None, foreign_key="usuario.id")
    coordinador_financiero_id: Optional[int] = Field(default=None, foreign_key="usuario.id")          # 2ª persona (coordinador)
    responsable_registro_id: Optional[int] = Field(default=None, foreign_key="usuario.id")            # Responsable del Registro
    firma_contador_id: Optional[int] = Field(default=None, foreign_key="usuario.id")
    firma_revisor_id: Optional[int] = Field(default=None, foreign_key="usuario.id")
    responsable_cliente: str = ""              # persona de contacto del lado del cliente
    email_responsable_cliente: str = ""
    grupo: str = ""
    notas: str = ""
    archivo_propuesta: str = ""    # ruta al archivo de la propuesta (una por cliente)
    ruta_trabajo: str = ""         # carpeta de trabajo del cliente (la leen otros aplicativos)

    # --- Trazabilidad / Auditoría ---
    rut_actualizado: str = ""      # fecha YYYY-MM-DD de la última toma del RUT
    creado_at: datetime = Field(default_factory=datetime.utcnow)
    creado_por: str = ""
    actualizado_at: Optional[datetime] = None
    actualizado_por: str = ""


class ClienteServicio(SQLModel, table=True):
    """Servicio comercial contratado por un cliente (N por cliente)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    cliente_id: int = Field(foreign_key="cliente.id", index=True)
    rol_servicio_id: Optional[int] = Field(default=None, foreign_key="rolservicio.id")
    forma_facturacion: str = "Fa"  # "Fa" (factura) | "CC" (cuenta de cobro)
    periodicidad: str = "Mes"      # (obsoleto) se conserva por compatibilidad; ya no se usa
    periodo: str = ""              # "AAAA-MM" — período concreto que se cobra
    facturacion_id: Optional[int] = None  # cabecera donde se facturó (None = pendiente)
    valor_servicio: Optional[Decimal] = Field(
        default=None, sa_column=Column(Numeric(14, 2)))
    vendedor: str = ""             # texto libre
    pct_comision: Optional[Decimal] = Field(
        default=None, sa_column=Column(Numeric(6, 3)))
    nota: str = ""
    archivo_propuesta: str = ""    # ruta a archivo (botón "ubicar archivo")
    ruta_trabajo: str = ""         # ruta a carpeta (botón "ubicar carpeta")
    creado_at: datetime = Field(default_factory=datetime.utcnow)


class ClienteMunicipioIca(SQLModel, table=True):
    """Municipio donde el cliente declara ICA (N por cliente)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    cliente_id: int = Field(foreign_key="cliente.id", index=True)
    municipio_dane: str = ""       # código DANE del municipio (opcional)
    municipio: str = ""            # nombre del municipio
    ciiu: str = ""                 # actividad (CIIU) que declara ICA allí
    # Obligaciones municipales autónomas (las LEE el Calendario para generar por municipio):
    hace_ica: bool = False           # declara ICA en el municipio (ICA_MUN)
    hace_reteica: bool = False       # practica ReteICA (RETEICA_MUN)
    hace_autoreteica: bool = False   # es autorretenedor de ICA (AUTORETEICA_MUN)
    exogena_distrital: bool = False  # ¿presenta exógena distrital en ese municipio? (EXOG_MUN)
    creado_at: datetime = Field(default_factory=datetime.utcnow)


class ClienteObligacion(SQLModel, table=True):
    """Otra obligación de reportar información a un ente de control (N por cliente)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    cliente_id: int = Field(foreign_key="cliente.id", index=True)
    obligacion_tipo_id: Optional[int] = Field(default=None, foreign_key="obligaciontipo.id")
    periodicidad: str = "Mensual"   # "Mensual" | "Trimestral" | "Semestral" | "Anual"
    desde: str = ""                 # "AAAA-MM": mes/año desde que se adquiere la obligación
    observaciones: str = ""
    creado_at: datetime = Field(default_factory=datetime.utcnow)


class ClienteClave(SQLModel, table=True):
    """Credencial de un cliente en un portal (N por cliente). La clave se guarda
    cifrada (Fernet) y NUNCA se devuelve en las lecturas normales: solo se revela
    bajo demanda a Administradores/Super Usuarios."""

    id: Optional[int] = Field(default=None, primary_key=True)
    cliente_id: int = Field(foreign_key="cliente.id", index=True)
    portal_id: Optional[int] = Field(default=None, foreign_key="portal.id")
    comentario: str = ""            # nota/etiqueta libre (host, "Firma Digital", etc.)
    url: str = ""                   # URL de acceso al portal/login
    odbc_nombre: str = ""           # (solo ODBC) nombre del DSN/ODBC
    odbc_dbf: str = ""              # (solo ODBC) ruta/archivo DBF
    odbc_ip: str = ""               # (solo ODBC) dirección IP del servidor
    usuario: str = ""               # usuario/login del portal
    clave_enc: str = ""             # clave cifrada (Fernet, reversible)
    actualizado_at: datetime = Field(default_factory=datetime.utcnow)
    creado_at: datetime = Field(default_factory=datetime.utcnow)


# ============================================================ Calendario de obligaciones
class PlazoVencimiento(SQLModel, table=True):
    """Calendario MAESTRO virgen: una fecha límite para un subconjunto, sin terceros.

    El subconjunto se define por el *criterio* de la obligación (ObligacionTipo.criterio):
      · nit1/nit2 → rango numérico en ``criterio_desde..criterio_hasta`` (dígitos del NIT).
      · grupo     → ``criterio_desde..criterio_hasta`` (nº de grupo) o ``criterio_valor`` (nombre).
      · municipio → ``criterio_valor`` (código DANE del municipio).
      · fijo      → aplica a todos (``criterio_desde = criterio_hasta = -1``).
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    anio: int = Field(index=True)
    obligacion_tipo_id: int = Field(foreign_key="obligaciontipo.id", index=True)
    periodo: int = 1               # 1..12 mensual · 1..6 bimestral · 1..3 cuatrimestral · 1 anual
    criterio_desde: int = -1       # -1 = aplica a todos (fecha fija)
    criterio_hasta: int = -1
    criterio_valor: str = ""       # municipio (DANE) o nombre de grupo, si aplica
    fecha: Optional[date] = None
    nota: str = ""


class AnclaPeriodo(SQLModel, table=True):
    """Ancla de 'Generar año' del Calendario (tabla compartida, dueña = Calendario).
    Maestros la lee solo para saber si una obligación tiene entradas en el Calendario."""

    id: Optional[int] = Field(default=None, primary_key=True)
    obligacion_tipo_id: int = Field(foreign_key="obligaciontipo.id", index=True)
    anio: int = Field(index=True)
    periodo: int = 1
    criterio_valor: str = ""
    fecha_ancla: Optional[date] = None
    nota: str = ""


class ObligacionCumplimiento(SQLModel, table=True):
    """Estado de UNA instancia (cliente × obligación × año × período). Fila rala:
    solo existe cuando se marca algo; si no hay fila, la instancia está 'pendiente'."""

    id: Optional[int] = Field(default=None, primary_key=True)
    cliente_id: int = Field(foreign_key="cliente.id", index=True)
    obligacion_tipo_id: int = Field(foreign_key="obligaciontipo.id", index=True)
    anio: int
    periodo: int = 1
    estado: str = "presentado"     # "presentado" | "na" (no aplica) ; "pendiente" = sin fila
    presentado_at: Optional[datetime] = None
    presentado_por: str = ""
    nota: str = ""


# ============================================================ Facturación mensual
class Facturacion(SQLModel, table=True):
    """Encabezado de una facturación de un mes (histórico). Solo superusuarios."""

    id: Optional[int] = Field(default=None, primary_key=True)
    anio: int
    mes: int                       # 1-12
    etiqueta: str = ""             # "Agosto 2026"
    creado_at: datetime = Field(default_factory=datetime.utcnow)
    creado_por: str = ""
    aprobada_at: Optional[datetime] = None   # fecha de aprobación (None = sin aprobar)
    aprobada_por: str = ""                    # usuario que aprobó (solo superusuario)


class FacturacionItem(SQLModel, table=True):
    """Fila de una facturación. Guarda una FOTO de los datos (no referencias
    vivas) para que el histórico no cambie si luego se edita el cliente."""

    id: Optional[int] = Field(default=None, primary_key=True)
    facturacion_id: int = Field(foreign_key="facturacion.id", index=True)
    cliente_id: Optional[int] = Field(default=None, foreign_key="cliente.id")
    num_id: str = ""               # NIT/documento (foto)
    nombre: str = ""               # nombre/razón social (foto)
    rol_servicio: str = ""         # concepto base (rol del servicio)
    concepto: str = ""             # "Servicios Contables — Agosto 2026"
    valor: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(14, 2)))
    forma: str = "Fa"             # "Fa" | "CC"
    iva: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(14, 2)))
    reteiva: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(14, 2)))
    periodicidad: str = "Mes"
    observaciones: str = ""
    orden: int = 0


class CuentaCobro(SQLModel, table=True):
    """Cuenta de cobro generada EN FIRME (consume el consecutivo del emisor).

    Guarda una FOTO de todos los datos del documento al momento de generarlo
    (deudor, emisor, concepto, valor, datos de pago, nota 383) para que el PDF
    y el número sean inmutables aunque luego se edite el cliente, el emisor o la
    configuración de pago.

    Identidad de negocio ESTABLE = (anio, mes, cliente_id, concepto). Se usa así
    porque al re-guardar una facturación se borran y recrean sus ítems y su
    encabezado con ids nuevos; la cuenta de cobro emitida (y su número quemado)
    debe sobrevivir a eso. Por lo mismo los enlaces a ítem/encabezado son
    informativos y NO llevan FK (un borrado del ítem no debe bloquear ni borrar
    el documento emitido)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    # --- Identidad de negocio (estable) ---
    anio: int = Field(index=True)
    mes: int = Field(index=True)
    cliente_id: Optional[int] = Field(default=None, foreign_key="cliente.id", index=True)
    concepto: str = ""
    # --- Enlaces informativos (ids volátiles; sin FK a propósito) ---
    facturacion_id: Optional[int] = None
    facturacion_item_id: Optional[int] = Field(default=None, index=True)
    emisor_id: Optional[int] = Field(default=None, foreign_key="emisor.id", index=True)

    numero: str = Field(index=True)        # "MB-421" (prefijo + consecutivo)
    prefijo: str = ""
    consecutivo: int = 0                   # número quemado del emisor
    fecha: date                            # fecha del documento

    # --- Foto del deudor (cliente) ---
    deudor: str = ""                       # nombre/razón social
    deudor_doc: str = ""                   # "NIT. 73.083.927 - 3"
    email_destino: str = ""                # correo del cliente al momento de generar

    # --- Foto del emisor ---
    emisor_nombre: str = ""
    emisor_cedula: str = ""
    emisor_direccion: str = ""
    emisor_celular: str = ""
    nota_383: bool = False
    nota_383_texto: str = ""               # foto del texto del 383 al generar (editable en Datos de cobro)

    # --- Contenido ---
    valor: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(14, 2)))

    # --- Foto de los datos de pago (config al momento de generar) ---
    pago_banco: str = ""
    pago_tipo: str = ""
    pago_numero: str = ""
    pago_titular: str = ""

    ruta_pdf: str = ""                     # ruta donde se guardó el PDF al generar (si hay carpeta configurada)

    # --- Envío ---
    estado: str = "generada"               # "generada" | "enviada" | "error"
    enviado_at: Optional[datetime] = None
    enviado_por: str = ""
    error_envio: str = ""

    creado_at: datetime = Field(default_factory=datetime.utcnow)
    creado_por: str = ""


class ConsultaGuardada(SQLModel, table=True):
    """Consulta del constructor guardada con nombre (definición estructurada en JSON).
    El Super la crea en "Generar Consultas" y la comparte a roles para que la corran
    desde el menú "Consultas". ``alcance`` = qué filas ve el consumidor:
    ``asignados`` (solo sus clientes) | ``firma`` (todas)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    nombre: str = Field(index=True)
    descripcion: str = ""
    alcance: str = "asignados"      # "asignados" | "firma"
    definicion: dict = Field(default_factory=dict, sa_column=Column(JSON))  # el cuerpo de ConsultaIn
    creado_por: str = ""
    creado_at: datetime = Field(default_factory=datetime.utcnow)
    actualizado_at: datetime = Field(default_factory=datetime.utcnow)


class ConsultaRol(SQLModel, table=True):
    """Roles que pueden ver/ejecutar una consulta guardada (N:N). El Super siempre
    puede, sin necesidad de fila aquí."""

    consulta_id: int = Field(primary_key=True)
    rol_id: int = Field(primary_key=True)
