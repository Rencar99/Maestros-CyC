"""Esquemas de entrada/salida de la API (separados de las tablas).

Regla clave: la clave del portal DIAN se recibe pero **nunca** se devuelve; en
las lecturas solo se informa ``tiene_password``.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlmodel import SQLModel


# ----------------------------------------------------------- Autenticación
class LoginIn(SQLModel):
    usuario: str
    password: str


class LoginOut(SQLModel):
    token: str
    nombre: str
    usuario: str
    rol: str
    debe_cambiar: bool


class CambiarPasswordIn(SQLModel):
    actual: str
    nueva: str


# ----------------------------------------------------------- Catálogos simples
class CatItemCreate(SQLModel):
    descripcion: str
    activo: bool = True


class CatItemUpdate(SQLModel):
    descripcion: Optional[str] = None
    activo: Optional[bool] = None


class CatItemRead(SQLModel):
    id: int
    descripcion: str
    activo: bool


class CiiuRead(SQLModel):
    codigo: str
    descripcion: str


# ----------------------------------------------------------- Responsables
class ResponsableBase(SQLModel):
    tipo: str = "Int"                 # "Int" | "Ext"
    nombre: str
    cedula: str = ""
    tarjeta_profesional: str = ""
    formacion_academica: int = 1      # 1-Profesional … 5-Otros
    formacion_nombre: str = ""        # título (ej. "Contador Público")
    apodo: str = ""                   # abreviatura/iniciales (ej. "LAR")
    email_corporativo: str = ""
    usuario: Optional[str] = None     # login (solo internos)
    rol: str = "usuario"              # "usuario" | "admin" | "superadmin" (compat)
    rol_id: Optional[int] = None      # rol de acceso (RBAC)
    activo: bool = True
    cargo: str = ""                   # solo internos
    telefono: str = ""
    foto: str = ""                    # foto de perfil (data URI base64)


class ResponsableCreate(ResponsableBase):
    password: Optional[str] = None    # solo internos; texto plano en tránsito


class ResponsableUpdate(SQLModel):
    tipo: Optional[str] = None
    nombre: Optional[str] = None
    cedula: Optional[str] = None
    tarjeta_profesional: Optional[str] = None
    formacion_academica: Optional[int] = None
    formacion_nombre: Optional[str] = None
    apodo: Optional[str] = None
    email_corporativo: Optional[str] = None
    usuario: Optional[str] = None
    rol: Optional[str] = None
    activo: Optional[bool] = None
    cargo: Optional[str] = None
    telefono: Optional[str] = None
    password: Optional[str] = None    # si viene, resetea la contraseña


class ResponsableRead(ResponsableBase):
    id: int
    debe_cambiar: bool
    creado_at: datetime


# ----------------------------------------------------------- Hijas de Cliente
class ServicioIn(SQLModel):
    rol_servicio_id: Optional[int] = None
    forma_facturacion: str = "Fa"     # "Fa" | "CC"
    periodo: str = ""                 # "AAAA-MM" — período concreto que se cobra
    valor_servicio: Optional[Decimal] = None
    vendedor: str = ""
    pct_comision: Optional[Decimal] = None
    nota: str = ""
    archivo_propuesta: str = ""
    ruta_trabajo: str = ""


class ServicioOut(ServicioIn):
    id: int
    facturacion_id: Optional[int] = None   # solo-lectura: NULL = pendiente, si no = facturado


class MunicipioIcaIn(SQLModel):
    municipio_dane: str = ""
    municipio: str = ""
    ciiu: str = ""
    hace_ica: bool = False
    hace_reteica: bool = False
    hace_autoreteica: bool = False
    exogena_distrital: bool = False


class MunicipioIcaOut(MunicipioIcaIn):
    id: int


class ObligacionIn(SQLModel):
    obligacion_tipo_id: Optional[int] = None
    periodicidad: str = "Mensual"     # "Mensual" | "Trimestral" | "Semestral" | "Anual"
    desde: str = ""                   # "AAAA-MM"
    observaciones: str = ""


class ObligacionOut(ObligacionIn):
    id: int


# ----------------------------------------------------------- Cliente
class ClienteBase(SQLModel):
    tipo_contribuyente: str           # "Nat" | "Jur"
    tipo_documento: str = "CC"
    num_id: str
    sigla: str = ""                   # máx. 3 caracteres
    nombre: str = ""                  # en Nat se arma desde componentes
    razon_social: str = ""
    primer_apellido: str = ""
    segundo_apellido: str = ""
    primer_nombre: str = ""
    otros_nombres: str = ""
    software_id: Optional[int] = None
    emisor_id: Optional[int] = None
    logo: str = ""
    objeto_social: str = ""
    representante_tipo_documento: str = ""
    representante_num_id: str = ""
    representante_nombre: str = ""
    representante_desde: str = ""
    representante_codigo: str = ""
    contador_nombre: str = ""
    contador_tarjeta: str = ""
    contador_desde: str = ""
    revisor_nombre: str = ""
    revisor_tarjeta: str = ""
    revisor_desde: str = ""
    email: str = ""
    email_alt: str = ""
    telefono: str = ""
    direccion: str = ""
    departamento_dane: str = ""
    municipio_dane: str = ""
    regimen: str = "Ordinario"
    regimen_desde: Optional[int] = None
    seccional_codigo: str = ""
    actividad_ciiu_principal: str = ""
    actividad_ciiu_secundaria: str = ""
    responsabilidades: List[dict] = []
    periodicidad_iva: str = ""
    responsable_iva: Optional[bool] = None
    agente_retenedor: Optional[bool] = None
    facturador_electronico: Optional[bool] = None
    gran_contribuyente: Optional[bool] = None
    estado: str = "Act"
    confidencial: bool = False        # solo visible con permiso clientes.ver_confidencial (y Super)
    cliente_desde: str = ""
    responsable_impuestos_id: Optional[int] = None
    coordinador_impuestos_id: Optional[int] = None
    responsable_financiero_id: Optional[int] = None
    coordinador_financiero_id: Optional[int] = None
    responsable_registro_id: Optional[int] = None
    firma_contador_id: Optional[int] = None
    firma_revisor_id: Optional[int] = None
    responsable_cliente: str = ""
    email_responsable_cliente: str = ""
    grupo: str = ""
    notas: str = ""
    archivo_propuesta: str = ""
    ruta_trabajo: str = ""
    rut_actualizado: str = ""


class ClienteCreate(ClienteBase):
    password: Optional[str] = None    # clave de portal; se cifra al guardar
    servicios: List[ServicioIn] = []
    municipios_ica: List[MunicipioIcaIn] = []
    obligaciones: List[ObligacionIn] = []


class ClienteRead(ClienteBase):
    id: int
    dv: Optional[int] = None
    tiene_password: bool = False
    creado_at: datetime
    creado_por: str = ""
    actualizado_at: Optional[datetime] = None
    actualizado_por: str = ""
    servicios: List[ServicioOut] = []
    municipios_ica: List[MunicipioIcaOut] = []
    obligaciones: List[ObligacionOut] = []


class ClienteListItem(SQLModel):
    id: int
    num_id: str
    dv: Optional[int] = None
    nombre: str
    email: str = ""
    tipo_contribuyente: str
    tipo_documento: str
    regimen: str
    estado: str
    responsable_impuestos_id: Optional[int] = None
    responsable_nombre: str = ""
    software_desc: str = ""
    n_servicios: int = 0
    n_municipios: int = 0
    tiene_password: bool = False
    rut_actualizado: str = ""
    confidencial: bool = False               # solo en la lista de quien puede verlos
    obligaciones_por_revisar: bool = False   # chip: diferencias DIAN sin revisar
    # Equipo (apodos + nombres) para la columna Responsable de la grilla
    resp_imp_apodo: str = ""
    coord_imp_apodo: str = ""
    resp_fin_apodo: str = ""
    coord_fin_apodo: str = ""
    resp_imp_nombre: str = ""
    coord_imp_nombre: str = ""
    resp_fin_nombre: str = ""
    coord_fin_nombre: str = ""
