// Tipos que reflejan los schemas de la API.

export interface CatItem { id: number; descripcion: string; activo: boolean; }
export interface Ciiu { codigo: string; descripcion: string; }
export interface Municipio { codigo: string; nombre: string; departamento: string; }

export interface Responsable {
  id: number;
  tipo: "Int" | "Ext";
  nombre: string;
  cedula: string;
  tarjeta_profesional: string;
  formacion_academica: number;
  formacion_nombre: string;
  apodo: string;
  email_corporativo: string;
  usuario: string | null;
  rol: string;
  rol_id?: number | null;   // rol de acceso (RBAC)
  activo: boolean;
  cargo: string;
  telefono: string;
  foto: string;
  debe_cambiar?: boolean;
  creado_at?: string;
  permisos?: string[];      // RBAC: claves "seccion.accion" que puede el usuario
}

export interface Servicio {
  id?: number;
  rol_servicio_id: number | null;
  forma_facturacion: string;
  periodo: string;                 // "AAAA-MM" — período concreto que se cobra
  valor_servicio: string | null;
  vendedor: string;
  pct_comision: string | null;
  nota: string;
  archivo_propuesta: string;
  ruta_trabajo: string;
  facturacion_id?: number | null;  // solo-lectura: null = pendiente, si no = facturado
}

export interface MunicipioIca {
  id?: number;
  municipio_dane: string;
  municipio: string;
  ciiu: string;
  hace_ica: boolean;
  hace_reteica: boolean;
  hace_autoreteica: boolean;
  exogena_distrital: boolean;
}

export interface Obligacion {
  id?: number;
  obligacion_tipo_id: number | null;
  periodicidad: string;   // "Mensual" | "Trimestral" | "Semestral" | "Anual"
  desde: string;          // "AAAA-MM"
  observaciones: string;
}

export interface ClienteClave {
  id: number;
  portal_id: number | null;
  portal: string;          // descripción del portal (solo lectura)
  comentario: string;
  url: string;             // URL de acceso al portal
  odbc_nombre: string;     // (solo ODBC) nombre del DSN
  odbc_dbf: string;        // (solo ODBC) ruta/archivo DBF
  odbc_ip: string;         // (solo ODBC) dirección IP
  usuario: string;
  tiene_clave: boolean;    // si hay clave guardada (la clave en claro se pide aparte)
  actualizado_at: string | null;
}

export interface Cliente {
  id?: number;
  tipo_contribuyente: "Nat" | "Jur";
  tipo_documento: string;
  num_id: string;
  dv?: number | null;
  sigla: string;
  nombre: string;
  razon_social: string;
  primer_apellido: string;
  segundo_apellido: string;
  primer_nombre: string;
  otros_nombres: string;
  software_id: number | null;
  emisor_id: number | null;
  logo: string;
  objeto_social: string;
  representante_tipo_documento: string;
  representante_num_id: string;
  representante_nombre: string;
  representante_desde: string;
  representante_codigo: string;
  contador_nombre: string;
  contador_tarjeta: string;
  contador_desde: string;
  revisor_nombre: string;
  revisor_tarjeta: string;
  revisor_desde: string;
  email: string;
  email_alt: string;
  telefono: string;
  direccion: string;
  departamento_dane: string;
  municipio_dane: string;
  regimen: string;
  regimen_desde: number | null;
  seccional_codigo: string;
  actividad_ciiu_principal: string;
  actividad_ciiu_secundaria: string;
  responsabilidades: { codigo: string; descripcion: string }[];
  periodicidad_iva: string;
  responsable_iva: boolean | null;
  agente_retenedor: boolean | null;
  facturador_electronico: boolean | null;
  gran_contribuyente: boolean | null;
  estado: string;
  confidencial: boolean;
  cliente_desde: string;
  responsable_impuestos_id: number | null;
  coordinador_impuestos_id: number | null;
  responsable_financiero_id: number | null;
  coordinador_financiero_id: number | null;
  responsable_registro_id: number | null;
  firma_contador_id: number | null;
  firma_revisor_id: number | null;
  responsable_cliente: string;
  email_responsable_cliente: string;
  grupo: string;
  notas: string;
  archivo_propuesta: string;
  ruta_trabajo: string;
  rut_actualizado: string;
  tiene_password?: boolean;
  password?: string;
  servicios: Servicio[];
  municipios_ica: MunicipioIca[];
  obligaciones: Obligacion[];
}

export interface ClienteListItem {
  id: number;
  num_id: string;
  dv: number | null;
  nombre: string;
  email: string;
  tipo_contribuyente: "Nat" | "Jur";
  tipo_documento: string;
  regimen: string;
  estado: string;
  confidencial?: boolean;
  responsable_impuestos_id: number | null;
  responsable_nombre: string;
  software_desc: string;
  n_servicios: number;
  n_municipios: number;
  tiene_password: boolean;
  rut_actualizado: string;
  obligaciones_por_revisar?: boolean;
  resp_imp_apodo: string;
  coord_imp_apodo: string;
  resp_fin_apodo: string;
  coord_fin_apodo: string;
  resp_imp_nombre: string;
  coord_imp_nombre: string;
  resp_fin_nombre: string;
  coord_fin_nombre: string;
}
