import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { CatItem, Cliente, ClienteClave, ClienteListItem, MunicipioIca, Obligacion, Responsable, Servicio } from "../types";
import { Icon, money, SecTitle, Toggle, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { CiiuCombo } from "../components/CiiuCombo";
import { MunicipioCombo } from "../components/MunicipioCombo";
import { Explorador } from "../components/Explorador";
import { CatSelect } from "../components/CatSelect";
import { CodeSelect } from "../components/CodeSelect";
import { Modal } from "../components/Modal";

interface ObligTipo { id: number; codigo: string; descripcion: string; ente: string; criterio: string; periodicidad: string; origen: string; disparador: string; activo: boolean; tam_intervalo: number; paso_dias_habiles: number; }
const OBL_CRIT_TXT: Record<string, string> = { nit1: "Último dígito", nit2: "2 últimos dígitos", fijo: "Fecha única", grupo: "Por grupo", municipio: "Por municipio" };
const OBL_DISP_TXT: Record<string, string> = { "": "— (manual)", renta_jur: "Renta P. Jurídica", renta_nat: "Renta P. Natural", renta_gc: "Renta Grandes Contrib.", retencion: "Retención (07)", reteiva: "ReteIVA (07)", inc: "INC (33)", iva_bim: "IVA Bimestral (48)", iva_cuat: "IVA Cuatrimestral (48)", iva_anual: "IVA Anual RST (47+48)", rst_anual: "RST Declaración (47)", rst_anticipo: "RST Anticipo (47)", exogena_jn: "Exógena Jur/Nat (14)", exogena_gc: "Exógena Grandes Contrib. (14)", beneficiarios: "Beneficiarios Finales (RUB)" };

/** Período "AAAA-MM" del mes actual (para nuevas filas de servicio). */
const periodoHoy = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Suma k meses a un período "AAAA-MM" y devuelve el resultado "AAAA-MM". */
const addMeses = (p: string, k: number): string => {
  const [y, m] = (p || "").split("-").map(Number);
  if (!y || !m) return p;
  const idx = y * 12 + (m - 1) + k;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
};

/** Diálogo (arrastrable) para replicar un cobro a N períodos consecutivos. */
function ReplicarModal({ base, onOk, onClose }: {
  base: string; onOk: (n: number) => void; onClose: () => void;
}) {
  const [txt, setTxt] = useState("3");
  const n = Math.max(1, Math.min(60, parseInt(txt, 10) || 0));
  const periodos = base ? Array.from({ length: n }, (_, k) => addMeses(base, k)) : [];
  return (
    <Modal title="Replicar cobro" sub={base ? `Desde ${base}` : "Sin período base"} icon="copy" size="md"
      onClose={onClose}
      onSave={() => onOk(n)} canSave={!!base && !!n} saveLabel={`Crear ${n} período${n === 1 ? "" : "s"}`} saveIcon="check"
      avisoTone={base ? "info" : "warn"}
      aviso={!base ? "Este cobro no tiene período base."
        : periodos.length ? `Se crearán ${n} período(s): ${periodos[0]} → ${periodos[periodos.length - 1]} · se copia rol, forma, valor, vendedor y % comisión; los que ya existan se omiten.`
        : "Indica cuántos períodos crear."}>
      <div style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, maxWidth: 220 }}>
          <span className="hint">¿Cuántos períodos?</span>
          <input type="number" min={1} max={60} value={txt} autoFocus
            onChange={(e) => setTxt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && base && n) onOk(n); }} />
        </label>
        {!!periodos.length && (
          <div className="hint" style={{ lineHeight: 1.8 }}>
            {periodos.map((p) => <span key={p} className="pill" style={{ marginRight: 6 }}>{p}</span>)}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Diálogo (arrastrable) para crear un cobro. Los cobros no se editan: se crean aquí,
 *  se replican o se eliminan desde la grilla. */
function NuevoServicioModal({ roles, setRoles, onOk, onClose }: {
  roles: CatItem[];
  setRoles: (fn: (p: CatItem[]) => CatItem[]) => void;
  onOk: (s: Servicio) => void;
  onClose: () => void;
}) {
  const [rol, setRol] = useState<number | null>(roles[0]?.id ?? null);
  const [forma, setForma] = useState("Fa");
  const [formas, setFormas] = useState<{ codigo: string; descripcion: string }[]>([]);
  useEffect(() => { api.get("/catalogos/forma-cobro").then(setFormas).catch(() => {}); }, []);
  const [periodo, setPeriodo] = useState(periodoHoy());
  const [valor, setValor] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [pct, setPct] = useState("");
  const periodoOk = /^\d{4}-\d{2}$/.test(periodo.trim());
  const puede = !!rol && periodoOk;
  const crear = () => {
    if (!puede) return;
    onOk({
      rol_servicio_id: rol, forma_facturacion: forma, periodo: periodo.trim(),
      valor_servicio: valor.replace(/\D/g, "") || null, vendedor,
      pct_comision: pct.trim() || null, nota: "", archivo_propuesta: "",
      ruta_trabajo: "", facturacion_id: null,
    });
  };
  return (
    <Modal title="Nuevo cobro" sub="Se agrega a los servicios contratados" icon="plus" size="md" onClose={onClose}
      onSave={crear} canSave={puede} saveLabel="Crear cobro" saveIcon="check"
      avisoTone={!periodoOk ? "warn" : "info"}
      aviso={!periodoOk ? "El período debe tener formato AAAA-MM." : `Cobro ${forma} para el período ${periodo}${valor ? ` · $ ${fmtMiles(valor)}` : ""}`}>
      <div style={{ display: "grid", gap: 12 }}>
        <div className="f"><label>Rol del servicio</label>
          <CatSelect path="rol-servicio" items={roles} onItems={(n) => setRoles((p) => [...p, n])}
            value={rol} onChange={(v) => setRol(v as number | null)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="f"><label>Forma de Cobro</label>
            <CodeSelect path="forma-cobro" items={formas} onItems={(n) => setFormas((p) => [...p, n])}
              value={forma} onChange={setForma} />
          </div>
          <div className="f"><label>Periodo</label>
            <input value={periodo} placeholder="2026-08" maxLength={7} onChange={(e) => setPeriodo(e.target.value.trim())} />
            {!periodoOk && <small style={{ color: "var(--err)", marginTop: 2 }}>Formato AAAA-MM</small>}
          </div>
        </div>
        <div className="f"><label>Valor</label>
          <input style={{ textAlign: "right" }} value={fmtMiles(valor)} onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
          <div className="f"><label>Vendedor</label>
            <input value={vendedor} onChange={(e) => setVendedor(e.target.value)} />
          </div>
          <div className="f"><label>% Comisión</label>
            <input style={{ textAlign: "right" }} value={pct} onChange={(e) => setPct(e.target.value.trim())} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Diálogo (arrastrable) para crear/editar una credencial de portal. La clave se
 *  cifra en el servidor; al editar, dejar la clave vacía conserva la actual. */
function ClaveModal({ portales, setPortales, clave, getClave, onOk, onClose }: {
  portales: CatItem[];
  setPortales: (fn: (p: CatItem[]) => CatItem[]) => void;
  clave: ClienteClave | null;
  getClave?: () => Promise<string>;   // trae la clave actual (para editarla directo)
  onOk: (payload: { portal_id: number | null; usuario: string; comentario: string; clave: string }) => void;
  onClose: () => void;
}) {
  const [portalId, setPortalId] = useState<number | null>(clave?.portal_id ?? (portales[0]?.id ?? null));
  const [usuario, setUsuario] = useState(clave?.usuario || "");
  const [comentario, setComentario] = useState(clave?.comentario || "");
  const [pass, setPass] = useState("");
  const [ver, setVer] = useState(false);
  const editando = !!clave;
  // Al editar, precargamos la clave actual para poder modificarla sin retecla.
  useEffect(() => { if (getClave) getClave().then((v) => setPass(v || "")).catch(() => {}); }, []); // eslint-disable-line
  return (
    <Modal title={editando ? "Editar clave" : "Nueva clave"} icon="lock" size="md" onClose={onClose}
      onSave={() => onOk({ portal_id: portalId, usuario: usuario.trim(), comentario: comentario.trim(), clave: pass })}
      saveLabel={editando ? "Guardar" : "Crear"} saveIcon={editando ? "save" : "check"}
      aviso={editando ? "La clave se guarda cifrada · dejarla vacía conserva la actual." : "La clave se guarda cifrada en el servidor."}>
      <div style={{ display: "grid", gap: 12 }}>
        <div className="f"><label>Portal</label>
          <CatSelect path="portal" items={portales} onItems={(n) => setPortales((p) => [...p, n])}
            value={portalId} onChange={(v) => setPortalId(v as number | null)} placeholder="— Portal —" />
        </div>
        <div className="f"><label>Usuario</label>
          <input value={usuario} autoComplete="off" onChange={(e) => setUsuario(e.target.value)} />
        </div>
        <div className="f"><label>Clave {editando && <span className="hint" style={{ fontWeight: 400 }}>(vacío = no cambiar)</span>}</label>
          <div className="pw-wrap">
            <input style={{ paddingRight: 34 }} type={ver ? "text" : "password"} value={pass} autoComplete="new-password"
              placeholder={editando ? "•••••• (sin cambios)" : ""} onChange={(e) => setPass(e.target.value)} />
            <button type="button" className="pw-eye" onClick={() => setVer((v) => !v)} title={ver ? "Ocultar" : "Ver"}><Icon name={ver ? "eye-off" : "eye"} size={15} /></button>
          </div>
        </div>
        <div className="f"><label>Comentario</label>
          <input value={comentario} placeholder="host, etiqueta, nota…" onChange={(e) => setComentario(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

/** Modal de solo consulta de las claves de un cliente desde la grilla (Admin/Super).
 *  Reutiliza los endpoints de claves; muestra •••• con "ver" y "copiar". */
function ClavesClienteModal({ cliente, onClose }: { cliente: ClienteListItem; onClose: () => void }) {
  const toast = useToast();
  const [claves, setClaves] = useState<ClienteClave[]>([]);
  const [reveladas, setReveladas] = useState<Record<number, string>>({});
  useEffect(() => { api.get(`/clientes/${cliente.id}/claves`).then(setClaves).catch((e: any) => toast(e.message, true)); }, []); // eslint-disable-line
  const revelar = async (k: ClienteClave) => {
    if (reveladas[k.id] !== undefined) { setReveladas((r) => { const n = { ...r }; delete n[k.id]; return n; }); return; }
    try { const res: any = await api.get(`/clientes/${cliente.id}/claves/${k.id}/revelar`); setReveladas((r) => ({ ...r, [k.id]: res.clave || "" })); }
    catch (e: any) { toast(e.message, true); }
  };
  const cols: Column<ClienteClave>[] = [
    { key: "portal", label: "Portal", sortable: true, filterable: true, minWidth: "150px", value: (k) => k.portal || "" },
    { key: "usuario", label: "Usuario", sortable: true, minWidth: "150px", value: (k) => k.usuario || "" },
    {
      key: "clave", label: "Clave", minWidth: "210px", value: () => "",
      render: (k) => k.tiene_clave ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "monospace", letterSpacing: reveladas[k.id] !== undefined ? 0 : 2 }}>{reveladas[k.id] !== undefined ? (reveladas[k.id] || "(vacía)") : "••••••••"}</span>
          <button type="button" className="act-btn" title={reveladas[k.id] !== undefined ? "Ocultar" : "Ver"} onClick={() => revelar(k)}><Icon name="eye" size={14} /></button>
          {reveladas[k.id] ? <button type="button" className="act-btn" title="Copiar" onClick={() => { navigator.clipboard?.writeText(reveladas[k.id]); toast("Copiada ✓"); }}><Icon name="copy" size={14} /></button> : null}
        </div>
      ) : <span className="hint">— sin clave —</span>,
    },
    { key: "comentario", label: "Comentario", sortable: true, filterable: true, minWidth: "170px", value: (k) => k.comentario || "" },
  ];
  return (
    <Modal title={`Claves — ${cliente.nombre}`} sub={cliente.num_id} icon="lock" size="md" onClose={onClose}
      aviso={`${claves.length} credencial(es) registrada(s)`}>
      <DataGrid columns={cols} rows={claves} getKey={(k) => k.id} label="Claves del cliente"
        emptyLabel="Este cliente no tiene claves registradas." scrollClass="claves-modal-scroll" />
    </Modal>
  );
}

const DEPTOS: Record<string, string> = {
  "05": "Antioquia", "08": "Atlántico", "11": "Bogotá D.C.", "13": "Bolívar", "15": "Boyacá",
  "17": "Caldas", "18": "Caquetá", "19": "Cauca", "20": "Cesar", "23": "Córdoba", "25": "Cundinamarca",
  "27": "Chocó", "41": "Huila", "44": "La Guajira", "47": "Magdalena", "50": "Meta", "52": "Nariño",
  "54": "Norte de Santander", "63": "Quindío", "66": "Risaralda", "68": "Santander", "70": "Sucre",
  "73": "Tolima", "76": "Valle del Cauca", "81": "Arauca", "85": "Casanare", "86": "Putumayo",
  "88": "Archipiélago de San Andrés", "91": "Amazonas", "94": "Guainía", "95": "Guaviare",
  "97": "Vaupés", "99": "Vichada",
};
const deptoNombre = (cod: string) => (cod ? (DEPTOS[cod.slice(0, 2)] || cod) : "");

const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
function calcDV(num: string): string {
  const d = (num || "").replace(/\D/g, "");
  if (!d) return "";
  let s = 0;
  for (let i = 0; i < d.length && i < PESOS.length; i++) s += parseInt(d[d.length - 1 - i]) * PESOS[i];
  const r = s % 11;
  return String(r < 2 ? r : 11 - r);
}
function componer(c: Cliente): string {
  return [c.primer_apellido, c.segundo_apellido, c.primer_nombre, c.otros_nombres].map((x) => (x || "").trim()).filter(Boolean).join(" ");
}
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
/** Empata un nombre del RUT (ej. "FERNANDEZ GARRIDO MARIA BERNARDA") con un
 *  responsable de la firma por coincidencia de tokens (sin tildes, sin orden). */
function matchResponsable(nombreRut: string, resp: Responsable[]): number | null {
  const toks = (s: string) => new Set((s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean));
  const t = toks(nombreRut);
  if (t.size < 2) return null;
  let best: number | null = null, score = 0;
  for (const r of resp) {
    const rt = toks(r.nombre);
    const inter = [...t].filter((x) => rt.has(x)).length;
    const sc = inter / Math.max(t.size, rt.size);
    if (inter >= 2 && sc > score) { best = r.id; score = sc; }
  }
  return best;
}
const soloDig = (v: string) => String(v || "").replace(/\D/g, "").slice(0, 10);
const fmtTel = (v: string) => { const d = soloDig(v); return d.length <= 3 ? d : d.slice(0, 3) + "-" + d.slice(3); };
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtFecha = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const fmtMiles = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "";
  // v puede venir como "1500000.00" (backend) o "1500000" (tecleado); redondea a peso.
  const n = Math.round(Number(String(v).replace(/[^\d.-]/g, "")));
  return isNaN(n) ? "" : n.toLocaleString("es-CO");
};
const TAB_ICON: Record<string, string> = { ident: "user", rep: "lock", trib: "file", comercial: "cat", ica: "info", obligaciones: "clipboard-check", claves: "lock", gestion: "resp" };
function vacio(): Cliente {
  return {
    tipo_contribuyente: "Jur", tipo_documento: "NT", num_id: "", sigla: "", nombre: "", razon_social: "",
    primer_apellido: "", segundo_apellido: "", primer_nombre: "", otros_nombres: "",
    software_id: null, emisor_id: null, logo: "", objeto_social: "", representante_tipo_documento: "", representante_num_id: "",
    representante_nombre: "", representante_desde: "", representante_codigo: "", contador_nombre: "", contador_tarjeta: "", contador_desde: "",
    revisor_nombre: "", revisor_tarjeta: "", revisor_desde: "",
    email: "", email_alt: "", telefono: "", direccion: "", departamento_dane: "",
    municipio_dane: "", regimen: "Ordinario", regimen_desde: null, seccional_codigo: "", actividad_ciiu_principal: "",
    actividad_ciiu_secundaria: "", responsabilidades: [], periodicidad_iva: "", responsable_iva: null, agente_retenedor: null,
    facturador_electronico: null, gran_contribuyente: null, estado: "Act", confidencial: false, cliente_desde: "", responsable_impuestos_id: null,
    coordinador_impuestos_id: null, responsable_financiero_id: null, coordinador_financiero_id: null, responsable_registro_id: null,
    firma_contador_id: null, firma_revisor_id: null,
    responsable_cliente: "", email_responsable_cliente: "",
    grupo: "", notas: "", archivo_propuesta: "", ruta_trabajo: "", rut_actualizado: "", servicios: [], municipios_ica: [], obligaciones: [],
  };
}

export function Clientes({ esSuper, esAdmin, puede, active = true }: { esSuper: boolean; esAdmin: boolean; puede: (c: string) => boolean; active?: boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<ClienteListItem[]>([]);
  const [quick, setQuick] = useState("");   // filtro rápido activo
  const [edit, setEdit] = useState<Cliente | null>(null);
  const [verClaves, setVerClaves] = useState<ClienteListItem | null>(null);
  const [software, setSoftware] = useState<CatItem[]>([]);
  const [roles, setRoles] = useState<CatItem[]>([]);
  const [obligTipos, setObligTipos] = useState<ObligTipo[]>([]);
  const [resp, setResp] = useState<Responsable[]>([]);
  const [tiposDoc, setTiposDoc] = useState<{ codigo: string; descripcion: string }[]>([]);
  const [respsCat, setRespsCat] = useState<{ codigo: string; descripcion: string }[]>([]);
  const [emisores, setEmisores] = useState<{ id: number; nombre: string; prefijo: string }[]>([]);

  const load = () => api.get("/clientes").then(setRows).catch((e) => toast(e.message, true));
  useEffect(() => {
    load();
    api.get("/catalogos/software").then(setSoftware).catch(() => {});
    api.get("/catalogos/rol-servicio").then(setRoles).catch(() => {});
    api.get("/catalogos/obligacion-tipo").then(setObligTipos).catch(() => {});
    api.get("/responsables").then(setResp).catch(() => {});
    api.get("/catalogos/tipo-documento").then(setTiposDoc).catch(() => {});
    api.get("/catalogos/responsabilidad").then(setRespsCat).catch(() => {});
    api.get("/catalogos/emisor").then((es: any[]) => setEmisores(es.filter((e) => e.activo))).catch(() => {});
  }, []); // eslint-disable-line
  // La App mantiene las páginas montadas (display:none); re-leer al volver a entrar.
  useEffect(() => { if (active) load(); }, [active]); // eslint-disable-line

  const [autoRut, setAutoRut] = useState(false);
  const [orden, setOrden] = useState<number[]>([]);   // orden visible de la grilla (para navegar)
  const abrir = async (id: number, rut = false) => {
    try { const cli = await api.get(`/clientes/${id}`); setAutoRut(rut); setEdit(cli); } catch (e: any) { toast(e.message, true); }
  };
  const vecino = (dir: "prev" | "next"): number | undefined => {
    if (!edit || !edit.id) return undefined;
    const i = orden.indexOf(edit.id);
    if (i < 0) return undefined;
    return orden[dir === "next" ? i + 1 : i - 1];
  };

  const filtered = useMemo(() => {
    // La búsqueda por texto ahora la hace el buscador global de la grilla (todas las columnas).
    // Aquí solo quedan los filtros rápidos (chips).
    return rows.filter((r) => {
      if (quick === "act" && r.estado !== "Act") return false;
      if (quick === "ina" && r.estado !== "Ina") return false;
      if (quick === "jur" && r.tipo_contribuyente !== "Jur") return false;
      if (quick === "nat" && r.tipo_contribuyente !== "Nat") return false;
      if (quick === "noclave" && r.tiene_password) return false;
      if (quick === "rev" && !r.obligaciones_por_revisar) return false;
      return true;
    });
  }, [rows, quick]);

  const qfiltros = [
    { k: "", lbl: "Todos", n: rows.length },
    { k: "act", lbl: "Activos", n: rows.filter((r) => r.estado === "Act").length },
    { k: "ina", lbl: "Inactivos", n: rows.filter((r) => r.estado === "Ina").length },
    { k: "jur", lbl: "Jurídicas", n: rows.filter((r) => r.tipo_contribuyente === "Jur").length },
    { k: "nat", lbl: "Naturales", n: rows.filter((r) => r.tipo_contribuyente === "Nat").length },
    { k: "noclave", lbl: "Sin clave DIAN", n: rows.filter((r) => !r.tiene_password).length },
    { k: "rev", lbl: "Por revisar", n: rows.filter((r) => r.obligaciones_por_revisar).length },
  ];

  const cols: Column<ClienteListItem>[] = [
    { key: "num_id", label: "ID", type: "code", align: "left", sortable: true, filterable: true, width: "15ch", value: (r) => r.num_id,
      render: (r) => <span className="idcell" title={r.rut_actualizado ? `RUT tomado: ${fmtFecha(r.rut_actualizado)}` : "Sin comparar con RUT"}><span className={"rut-dot" + (r.rut_actualizado ? " ok" : "")} />{r.num_id}{r.confidencial && <span title="Cliente confidencial (solo supervisores)" style={{ marginLeft: 4 }}>🔒</span>}{r.obligaciones_por_revisar && <span className="rev-dot" title="Obligaciones DIAN por revisar" />}</span> },
    { key: "nombre", label: "Nombre / Razón social", sortable: true, filterable: true, width: "55ch", value: (r) => r.nombre, tip: (r) => r.nombre || "" },
    { key: "tipo", label: "Tipo", type: "status", filterable: true, value: (r) => r.tipo_contribuyente, render: (r) => <span className={"tag " + (r.tipo_contribuyente === "Jur" ? "jur" : "nat")}>{r.tipo_contribuyente}</span> },
    { key: "email", label: "Email", sortable: true, filterable: true, width: "26ch", value: (r) => r.email, tip: (r) => r.email || "" },
    { key: "regimen", label: "Régimen", sortable: true, filterable: true, value: (r) => r.regimen },
    { key: "estado", label: "Estado", type: "status", filterable: true, value: (r) => (r.estado === "Act" ? "Activo" : "Inactivo"), render: (r) => <span className={"tag " + (r.estado === "Act" ? "act" : "ina")}>{r.estado === "Act" ? "Activo" : "Inactivo"}</span> },
    { key: "eqimp", label: "Equipo Impto", sortable: true, filterable: true, width: "16ch",
      value: (r) => [r.coord_imp_apodo, r.resp_imp_apodo].filter(Boolean).join(" - "),
      tip: (r) => [
        r.coord_imp_nombre && `Coord. Impuestos: ${r.coord_imp_nombre}`,
        r.resp_imp_nombre && `Resp. Impuestos: ${r.resp_imp_nombre}`,
      ].filter(Boolean).join("\n"),
      render: (r) => {
        const t = [r.coord_imp_apodo, r.resp_imp_apodo].filter(Boolean).join(" - ");
        return t ? <span className="equipo">{t}</span> : <span className="muted">—</span>;
      } },
    { key: "eqfin", label: "Equipo Finanzas", sortable: true, filterable: true, width: "16ch",
      value: (r) => [r.coord_fin_apodo, r.resp_fin_apodo].filter(Boolean).join(" - "),
      tip: (r) => [
        r.coord_fin_nombre && `Coord. Financiero: ${r.coord_fin_nombre}`,
        r.resp_fin_nombre && `Resp. Financiero: ${r.resp_fin_nombre}`,
      ].filter(Boolean).join("\n"),
      render: (r) => {
        const t = [r.coord_fin_apodo, r.resp_fin_apodo].filter(Boolean).join(" - ");
        return t ? <span className="equipo eq-fin">{t}</span> : <span className="muted">—</span>;
      } },
    { key: "srv", label: "Servicios", align: "center", total: true, filterable: true, value: (r) => r.n_servicios, render: (r) => <span className="pill">{r.n_servicios}</span> },
    { key: "ica", label: "Mun. ICA", align: "center", total: true, filterable: true, value: (r) => r.n_municipios, render: (r) => <span className="pill">{r.n_municipios}</span> },
  ];

  return (
    <>
      <div className="card">
        <div className="card-h">
          <div><SecTitle icon="clientes">Clientes</SecTitle></div>
          <div className="r" style={{ alignItems: "center" }}>
            <button className="btn primary sm" onClick={() => { setAutoRut(false); setEdit(vacio()); }}><Icon name="plus" size={16} />Nuevo cliente</button>
          </div>
        </div>
        <DataGrid columns={cols} rows={filtered} getKey={(r) => r.id} label="Clientes" emptyLabel="Sin clientes." scrollClass="cli-scroll"
          storageKey="clientes" searchable exportable={puede("clientes.exportar")}
          toolbar={<div className="qfbar">
            {qfiltros.map((f) => (
              <button key={f.k} className={"qf" + (quick === f.k ? " on" : "")} onClick={() => setQuick(f.k)}>
                {f.lbl}<span className="n">{f.n}</span>
              </button>
            ))}
          </div>}
          onView={(rs) => setOrden(rs.map((r) => r.id))}
          actions={(r) => <>
            {esAdmin && <button className="act-btn" title="Ver claves del cliente" onClick={() => setVerClaves(r)}><Icon name="lock" size={15} /></button>}
            {esAdmin && <button className="act-btn rut" title="Comparar con RUT (abre la ficha)" onClick={() => abrir(r.id, true)}><Icon name="upload" size={15} /></button>}
            {esAdmin && <button className="act-btn edit" title="Abrir ficha" onClick={() => abrir(r.id)}><Icon name="edit" size={15} /></button>}
          </>} />
      </div>
      {edit && <Ficha cliente={edit} autoRut={autoRut} software={software} setSoftware={setSoftware} roles={roles} setRoles={setRoles} obligTipos={obligTipos} setObligTipos={setObligTipos} resp={resp} tiposDoc={tiposDoc} setTiposDoc={setTiposDoc} respsCat={respsCat} setRespsCat={setRespsCat} emisores={emisores} esSuper={esSuper} esAdmin={esAdmin} veConf={esSuper || puede("clientes.ver_confidencial")}
        prevId={vecino("prev") ?? null} nextId={vecino("next") ?? null} onGo={abrir} reload={load}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {verClaves && <ClavesClienteModal cliente={verClaves} onClose={() => setVerClaves(null)} />}
    </>
  );
}

const TABS = [["ident", "Identificación"], ["trib", "Tributario"], ["comercial", "Comercial"], ["ica", "Municipios ICA"], ["obligaciones", "Obligaciones"], ["claves", "Claves"], ["gestion", "Gestión"]] as const;

interface RutDiff { label: string; actual: string; propuesto: string; check: boolean; apply: (o: Cliente) => Cliente; info?: boolean; }

// Códigos de representación del RUT (casilla 98).
const REP_CODES: [string, string][] = [
  ["01", "Administrador judicial"], ["02", "Administrador privado"],
  ["03", "Agente exclusivo de negocios en Colombia"], ["04", "Agente oficioso"],
  ["05", "Albacea"], ["06", "Apoderado especial"], ["07", "Apoderado general"],
  ["08", "Asignatario"], ["09", "Comunero"], ["10", "Curador"], ["11", "Donatario"],
  ["12", "Factor"], ["13", "Funcionario delegado para cumplir obligaciones formales"],
  ["14", "Heredero con administración de bienes"], ["15", "Liquidador"],
  ["16", "Mandatario"], ["17", "Padre"], ["18", "Representante legal principal"],
  ["19", "Representante legal suplente"], ["20", "Síndico"], ["21", "Tutor"],
  ["99", "Otra representación"],
];

// ¿aplica esta obligación DIAN al cliente? Se evalúa por su DISPARADOR (anclaje estable,
// no por el código que puede renombrarse). Debe coincidir con la lógica del Calendario.
// La regla de aplicabilidad DIAN vive SOLO en el backend (Maestros = fuente única):
// el botón "Generar DIAN" consulta /clientes/derivar-preview para no duplicarla aquí.

function Ficha({ cliente, autoRut, software, setSoftware, roles, setRoles, obligTipos, setObligTipos, resp, tiposDoc, setTiposDoc, respsCat, setRespsCat, emisores, esSuper, esAdmin, veConf, prevId, nextId, onGo, reload, onClose, onSaved }: {
  cliente: Cliente; autoRut?: boolean; software: CatItem[]; setSoftware: (fn: (p: CatItem[]) => CatItem[]) => void;
  roles: CatItem[]; setRoles: (fn: (p: CatItem[]) => CatItem[]) => void;
  obligTipos: ObligTipo[]; setObligTipos: (fn: (p: ObligTipo[]) => ObligTipo[]) => void; resp: Responsable[];
  tiposDoc: { codigo: string; descripcion: string }[];
  setTiposDoc: (fn: (p: { codigo: string; descripcion: string }[]) => { codigo: string; descripcion: string }[]) => void;
  respsCat: { codigo: string; descripcion: string }[];
  setRespsCat: (fn: (p: { codigo: string; descripcion: string }[]) => { codigo: string; descripcion: string }[]) => void;
  emisores: { id: number; nombre: string; prefijo: string }[];
  esSuper: boolean; esAdmin: boolean; veConf: boolean;
  prevId?: number | null; nextId?: number | null; onGo?: (id: number) => void; reload?: () => void;
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [c, setC] = useState<Cliente>({ ...cliente });
  const [tab, setTab] = useState("ident");
  const [min, setMin] = useState(false);              // ficha minimizada a píldora
  const [clave, setClave] = useState("");
  const [claveTouched, setClaveTouched] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const rutFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoRut) rutFileRef.current?.click(); }, []); // eslint-disable-line
  useEffect(() => { api.get("/catalogos/grupo-economico").then(setGruposCat).catch(() => {}); }, []);
  useEffect(() => { api.get("/catalogos/portal").then(setPortalesCat).catch(() => {}); }, []);
  const [rutItems, setRutItems] = useState<RutDiff[] | null>(null);
  const [rutNit, setRutNit] = useState<{ leido: string; coincide: boolean } | null>(null);
  const [rutCargando, setRutCargando] = useState(false);
  const [repIdx, setRepIdx] = useState<number | null>(null);   // fila que se está replicando
  const [soloPend, setSoloPend] = useState(false);             // grilla Comercial: solo cobros pendientes
  const [nuevoSrv, setNuevoSrv] = useState(false);             // abrir modal "Nuevo cobro"
  const [gruposCat, setGruposCat] = useState<CatItem[]>([]);   // catálogo de grupos económicos
  const [portalesCat, setPortalesCat] = useState<CatItem[]>([]);          // catálogo de portales
  const [claves, setClaves] = useState<ClienteClave[]>([]);              // claves del cliente
  const [reveladas, setReveladas] = useState<Record<number, string>>({}); // claves reveladas en pantalla
  const [claveEdit, setClaveEdit] = useState<ClienteClave | "new" | null>(null);
  // Claves de portales: se cargan al abrir la pestaña; la clave en claro se pide aparte.
  const cargarClaves = () => { if (cliente.id) api.get(`/clientes/${cliente.id}/claves`).then(setClaves).catch(() => {}); };
  useEffect(() => { setReveladas({}); if (tab === "claves") cargarClaves(); }, [tab]); // eslint-disable-line
  const revelarClave = async (k: ClienteClave) => {
    if (reveladas[k.id] !== undefined) { setReveladas((r) => { const n = { ...r }; delete n[k.id]; return n; }); return; }
    try { const res: any = await api.get(`/clientes/${cliente.id}/claves/${k.id}/revelar`); setReveladas((r) => ({ ...r, [k.id]: res.clave || "" })); }
    catch (e: any) { toast(e.message, true); }
  };
  const borrarClave = async (k: ClienteClave) => {
    if ((await confirmar({ titulo: "Eliminar clave", mensaje: `Se eliminará la credencial de "${k.portal || "portal"}" (${k.usuario || "sin usuario"}).`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/clientes/${cliente.id}/claves/${k.id}`); cargarClaves(); toast("Eliminada"); }
    catch (e: any) { toast(e.message, true); }
  };
  const claveCols: Column<ClienteClave>[] = [
    { key: "portal", label: "Portal", sortable: true, filterable: true, minWidth: "150px", value: (k) => k.portal || "", render: (k) => k.portal || "—" },
    { key: "usuario", label: "Usuario", sortable: true, filterable: true, minWidth: "160px", value: (k) => k.usuario || "", render: (k) => k.usuario || "—" },
    { key: "clave", label: "Clave", minWidth: "210px", value: () => "", render: (k) => k.tiene_clave ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "monospace", letterSpacing: reveladas[k.id] !== undefined ? 0 : 2 }}>{reveladas[k.id] !== undefined ? (reveladas[k.id] || "(vacía)") : "••••••••"}</span>
          <button type="button" className="act-btn" title={reveladas[k.id] !== undefined ? "Ocultar" : "Ver"} onClick={() => revelarClave(k)}><Icon name="eye" size={14} /></button>
          {reveladas[k.id] ? <button type="button" className="act-btn" title="Copiar" onClick={() => { navigator.clipboard?.writeText(reveladas[k.id]); toast("Copiada ✓"); }}><Icon name="copy" size={14} /></button> : null}
        </div>
      ) : <span className="hint">— sin clave —</span> },
    { key: "comentario", label: "Comentario", sortable: true, filterable: true, minWidth: "180px", value: (k) => k.comentario || "", render: (k) => k.comentario || "—" },
  ];
  // Al navegar a otro registro el modal NO se remonta (evita el "salto"): refrescamos el estado aquí.
  const primera = useRef(true);
  const icaSeedRef = useRef<number | null>(null);   // ¿ya se evaluó la siembra del domicilio ICA para este cliente?
  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    setC({ ...cliente }); setTab("ident"); setClave(""); setClaveTouched(false);
    setShowPw(false); setRutItems(null); setRutNit(null); icaSeedRef.current = null; setMin(false);
  }, [cliente.id]); // eslint-disable-line
  const nuevo = !cliente.id;
  const jur = c.tipo_contribuyente === "Jur";
  const set = (k: keyof Cliente, v: any) => setC((o) => ({ ...o, [k]: v }));
  const tieneResp = (cod: string) => (c.responsabilidades || []).some((r) => r.codigo === cod);
  // Al cambiar las responsabilidades (p. ej. al traerlas del RUT) se valida y ajusta:
  //  · Régimen: con 47 (RST) => "Simple"; sin 47 => "Ordinario".
  //  · Periodicidad IVA: RST => "Anual"; sin 47 ni 48 => se limpia; con 48 no puede ser "Anual".
  useEffect(() => {
    if (!(c.responsabilidades || []).length) return;   // sin responsabilidades cargadas: no inferir
    const rstNow = tieneResp("47");
    if (rstNow && c.regimen !== "Simple") set("regimen", "Simple");
    if (!rstNow && c.regimen === "Simple") set("regimen", "Ordinario");
    if (rstNow) { if (c.periodicidad_iva !== "Anual") set("periodicidad_iva", "Anual"); }
    else if (!tieneResp("48")) { if (c.periodicidad_iva) set("periodicidad_iva", ""); }
    else if (c.periodicidad_iva === "Anual") set("periodicidad_iva", "");
  }, [c.responsabilidades]); // eslint-disable-line

  const setTipo = (v: "Nat" | "Jur") => setC((o) => ({ ...o, tipo_contribuyente: v, tipo_documento: v === "Jur" ? "NT" : (o.tipo_documento === "NT" ? "CC" : o.tipo_documento) }));

  // servicios / municipios helpers
  const srv = c.servicios;
  const ica = c.municipios_ica;
  const delSrv = (i: number) => setC((o) => ({ ...o, servicios: o.servicios.filter((_, j) => j !== i) }));
  const addSrvObj = (s: Servicio) => setC((o) => ({ ...o, servicios: [...o.servicios, s] }));
  // Grilla de servicios en modo lectura: nombre del rol, orden y vista ordenada+filtrada.
  const rolName = (id: number | null | undefined) => roles.find((r) => r.id === id)?.descripcion || "—";
  // Filtra (Solo pendientes) y ordena por período por defecto; el DataGrid re-ordena al clic.
  const srvVista = srv.map((s, i) => ({ s, i }))
    .filter(({ s }) => !soloPend || !s.facturacion_id)
    .sort((a, b) => (a.s.periodo || "").localeCompare(b.s.periodo || ""));
  const srvCols: Column<{ s: Servicio; i: number }>[] = [
    { key: "rol", label: "Rol del servicio", sortable: true, filterable: true, minWidth: "210px", value: (r) => rolName(r.s.rol_servicio_id) },
    { key: "factura", label: "Factura", type: "status", sortable: true, filterable: true, width: "84px", align: "center", value: (r) => r.s.forma_facturacion || "" },
    { key: "periodo", label: "Periodo", sortable: true, filterable: true, align: "center", width: "100px", value: (r) => r.s.periodo || "" },
    { key: "valor", label: "Valor", type: "money", sortable: true, total: true, value: (r) => Number(r.s.valor_servicio) || 0, formatter: (v) => "$ " + Math.round(Number(v) || 0).toLocaleString("es-CO"), render: (r) => <span>{fmtMiles(r.s.valor_servicio) || "—"}</span> },
    { key: "vendedor", label: "Vendedor", sortable: true, filterable: true, minWidth: "150px", value: (r) => r.s.vendedor || "" },
    { key: "pct", label: "% Com.", align: "right", width: "80px", sortable: true, value: (r) => Number(r.s.pct_comision) || 0, render: (r) => <span>{r.s.pct_comision ?? "—"}</span> },
    {
      key: "estado", label: "Estado", type: "status", align: "center", width: "92px", sortable: true, filterable: true,
      value: (r) => r.s.facturacion_id ? "Facturado" : "Pendiente",
      render: (r) => r.s.facturacion_id
        ? <span className="pill" style={{ background: "var(--ok)", color: "#fff" }} title="Facturado en este período">Fact</span>
        : <span className="pill" title="Pendiente por facturar">Pend</span>,
    },
  ];
  // Replica el cobro de la fila `i` a N períodos mensuales consecutivos desde su
  // período base (omite los períodos que ya existan para el mismo rol).
  const replicarSrv = (i: number, n: number) => setC((o) => {
    const base = o.servicios[i];
    if (!base?.periodo) return o;
    const nuevos: Servicio[] = [];
    for (let k = 0; k < n; k++) {
      const per = addMeses(base.periodo, k);
      const existe = o.servicios.some((s) => s.rol_servicio_id === base.rol_servicio_id && s.periodo === per)
        || nuevos.some((s) => s.periodo === per);
      if (existe) continue;
      nuevos.push({ ...base, id: undefined, periodo: per, facturacion_id: null });
    }
    return nuevos.length ? { ...o, servicios: [...o.servicios, ...nuevos] } : o;
  });
  const setIca = (i: number, patch: Partial<MunicipioIca>) => setC((o) => ({ ...o, municipios_ica: o.municipios_ica.map((m, j) => j === i ? { ...m, ...patch } : m) }));
  const addIca = () => setC((o) => ({ ...o, municipios_ica: [...o.municipios_ica, { municipio_dane: "", municipio: "", ciiu: "", hace_ica: false, hace_reteica: false, hace_autoreteica: false, exogena_distrital: false }] }));
  const delIca = (i: number) => setC((o) => ({ ...o, municipios_ica: o.municipios_ica.filter((_, j) => j !== i) }));
  // El municipio de domicilio del cliente es, por defecto, el primer municipio ICA (con su
  // actividad principal como CIIU). `force` sobreescribe el CIIU (se usa al leer el RUT).
  const conDomicilioIca = (o: Cliente, munDane: string, ciiu: string, force = false): Cliente => {
    if (!munDane) return o;
    const list = [...(o.municipios_ica || [])];
    const idx = list.findIndex((m) => m.municipio_dane === munDane);
    if (idx >= 0) {
      if (ciiu && (force || !list[idx].ciiu)) list[idx] = { ...list[idx], ciiu };
    } else {
      list.unshift({ municipio_dane: munDane, municipio: "", ciiu: ciiu || "", hace_ica: false, hace_reteica: false, hace_autoreteica: false, exogena_distrital: false });
    }
    return { ...o, municipios_ica: list };
  };
  // Al abrir la pestaña ICA por primera vez para este cliente, si está vacía siembra el domicilio.
  useEffect(() => {
    if (tab !== "ica") return;
    const cid = cliente.id ?? 0;
    if (icaSeedRef.current === cid) return;
    icaSeedRef.current = cid;
    if (c.municipios_ica.length === 0 && c.municipio_dane) {
      setC((o) => conDomicilioIca(o, o.municipio_dane, o.actividad_ciiu_principal || "", false));
    }
  }, [tab]); // eslint-disable-line
  const [oblDraft, setOblDraft] = useState<{ obligacion_tipo_id: number | null } | null>(null);
  const obl = c.obligaciones ?? [];
  const delObl = async (row: Obligacion) => {
    const otid = row.obligacion_tipo_id;
    const t = tipoDe(otid);
    const nombre = t ? `${t.codigo} — ${t.descripcion}` : "esta obligación";
    // Si el cliente ya tiene entradas en el Calendario para esta obligación, no se puede quitar.
    if (!nuevo && c.id && otid) {
      try {
        const r: any = await api.get(`/clientes/${c.id}/obligacion/${otid}/entradas-calendario`);
        if (r.tiene) { toast(`No se puede quitar «${t?.descripcion ?? nombre}»: tiene ${r.n} registro(s) de cumplimiento/revisión en el Calendario. Desactívala o elimina esos registros primero.`, true); return; }
      } catch { /* endpoint no disponible: el guardado valida igual en el servidor */ }
    }
    if ((await confirmar({ titulo: "Quitar obligación", mensaje: `Se quitará «${nombre}» de este cliente.`, peligro: true, confirmar: "Quitar" })) !== "si") return;
    setC((o) => ({ ...o, obligaciones: (o.obligaciones ?? []).filter((x) => x !== row) }));
  };
  const tipoDe = (id: number | null) => obligTipos.find((t) => t.id === id) || null;
  // Quitar una responsabilidad del RUT: si el cliente tiene obligaciones DIAN asignadas,
  // avisar (quedará «por revisar»; las obligaciones no se quitan solas) y pedir confirmación.
  const quitarResp = async (codigo: string) => {
    const r = (c.responsabilidades || []).find((x) => x.codigo === codigo);
    const nombre = r ? `${r.codigo} — ${r.descripcion}` : codigo;
    const nDian = (c.obligaciones || []).filter((o) => tipoDe(o.obligacion_tipo_id)?.origen === "dian").length;
    if (nDian > 0) {
      const ok = await confirmar({
        titulo: "Quitar responsabilidad",
        mensaje: `Vas a quitar «${nombre}». El cliente tiene ${nDian} obligación(es) DIAN asignada(s); estas NO se quitan solas, así que quedará marcado «por revisar». Revisa luego sus obligaciones. ¿Quitar la responsabilidad?`,
        peligro: true, confirmar: "Quitar",
      });
      if (ok !== "si") return;
    }
    setC((o) => ({ ...o, responsabilidades: (o.responsabilidades || []).filter((x) => x.codigo !== codigo) }));
  };
  // Columnas de la Grilla CyC para las obligaciones del cliente (solo lectura: los
  // campos vienen del catálogo; desde aquí solo se asigna o se quita).
  const oblCols: Column<Obligacion>[] = [
    { key: "codigo", label: "Código", sortable: true, filterable: true, width: "130px",
      value: (r) => tipoDe(r.obligacion_tipo_id)?.codigo || "",
      render: (r) => { const t = tipoDe(r.obligacion_tipo_id); return t ? <span className="pill">{t.codigo}</span> : <span className="muted">—</span>; } },
    { key: "descripcion", label: "Obligación", sortable: true, filterable: true, width: "34ch",
      value: (r) => tipoDe(r.obligacion_tipo_id)?.descripcion || "",
      tip: (r) => tipoDe(r.obligacion_tipo_id)?.descripcion || "" },
    { key: "ente", label: "Ente", sortable: true, filterable: true, width: "150px",
      value: (r) => tipoDe(r.obligacion_tipo_id)?.ente || "" },
    { key: "criterio", label: "Criterio", sortable: true, filterable: true, width: "150px",
      value: (r) => { const t = tipoDe(r.obligacion_tipo_id); return t ? (OBL_CRIT_TXT[t.criterio] || t.criterio) : ""; } },
    { key: "disparador", label: "Disparador (DIAN)", sortable: true, filterable: true, width: "190px",
      value: (r) => { const t = tipoDe(r.obligacion_tipo_id); return t ? (OBL_DISP_TXT[t.disparador] ?? t.disparador) : ""; } },
  ];
  const abrirNuevaObl = () => setOblDraft({ obligacion_tipo_id: null });
  const guardarObl = () => {
    if (!oblDraft) return;
    if (!oblDraft.obligacion_tipo_id) { toast("Elige la obligación del catálogo", true); return; }
    if (obl.some((o) => o.obligacion_tipo_id === oblDraft.obligacion_tipo_id)) { toast("Esa obligación ya está en el cliente", true); return; }
    setC((o) => ({ ...o, obligaciones: [...(o.obligaciones ?? []), { obligacion_tipo_id: oblDraft.obligacion_tipo_id, periodicidad: "", desde: "", observaciones: "" }] }));
    setOblDraft(null);
  };
  // Revisar obligaciones DIAN (100% manual, nada se aplica solo). Pide al backend
  // qué aplica y calcula el diff contra lo que la ficha tiene: FALTAN (aplicables
  // que no están) y SOBRAN (DIAN presentes que ya no aplican). Las manuales
  // (origen != 'dian') nunca entran a estas listas.
  const [revisar, setRevisar] = useState<{ faltan: number[]; sobran: number[] } | null>(null);
  const [revisando, setRevisando] = useState(false);
  const abrirRevisar = async () => {
    if (!(c.responsabilidades || []).length) { toast("Primero importa el RUT (no hay responsabilidades para revisar).", true); return; }
    setRevisando(true);
    try {
      const r = await api.post("/clientes/derivar-preview", c);
      const aplic = (r.aplican || []) as number[];
      const aplicSet = new Set(aplic);
      const present = (c.obligaciones ?? []).map((o) => o.obligacion_tipo_id);
      const presentSet = new Set(present);
      const faltan = aplic.filter((id) => !presentSet.has(id));
      const sobran = present.filter((id) => id != null && tipoDe(id)?.origen === "dian" && !aplicSet.has(id)) as number[];
      setRevisar({ faltan, sobran });
    } catch (e: any) { toast(e.message, true); }
    finally { setRevisando(false); }
  };
  const mkObl = (id: number) => { const t = tipoDe(id); return { obligacion_tipo_id: id, periodicidad: t?.periodicidad || "Anual", desde: "", observaciones: "" }; };
  const agregarFaltante = (id: number) => {
    setC((o) => ({ ...o, obligaciones: [...(o.obligaciones ?? []), mkObl(id)] }));
    setRevisar((rv) => rv && { ...rv, faltan: rv.faltan.filter((x) => x !== id) });
  };
  const agregarTodasFaltantes = () => {
    const ids = revisar?.faltan ?? [];
    if (!ids.length) return;
    setC((o) => ({ ...o, obligaciones: [...(o.obligaciones ?? []), ...ids.map(mkObl)] }));
    setRevisar((rv) => rv && { ...rv, faltan: [] });
  };
  const quitarSobrante = async (id: number) => {
    const t = tipoDe(id);
    if ((await confirmar({ titulo: "Quitar obligación", mensaje: `Se quitará «${t?.descripcion || id}» del cliente. Puede haberse puesto a mano a propósito.`, peligro: true, confirmar: "Quitar" })) !== "si") return;
    setC((o) => ({ ...o, obligaciones: (o.obligaciones ?? []).filter((x) => x.obligacion_tipo_id !== id) }));
    setRevisar((rv) => rv && { ...rv, sobran: rv.sobran.filter((x) => x !== id) });
  };
  const quitarTodasSobrantes = async () => {
    const ids = revisar?.sobran ?? [];
    if (!ids.length) return;
    if ((await confirmar({ titulo: "Quitar obligaciones sobrantes", mensaje: `Se quitarán ${ids.length} obligación(es) DIAN que ya no aplican según el RUT. Revisa que ninguna se haya puesto a mano a propósito.`, peligro: true, confirmar: "Quitar todas" })) !== "si") return;
    const s = new Set(ids);
    setC((o) => ({ ...o, obligaciones: (o.obligaciones ?? []).filter((x) => !s.has(x.obligacion_tipo_id ?? -1)) }));
    setRevisar((rv) => rv && { ...rv, sobran: [] });
  };

  const nombreFinal = jur ? (c.razon_social || c.nombre) : (componer(c) || c.nombre);

  const verOcultarClave = async () => {
    if (showPw) { setShowPw(false); return; }
    // Al revelar: si hay clave guardada y aún no está cargada, la trae descifrada.
    if (!claveTouched && !clave && !nuevo && c.tiene_password) {
      try { const r = await api.get(`/clientes/${cliente.id}/password`); setClave(r.password); }
      catch (e: any) { toast(e.message, true); return; }
    }
    setShowPw(true);
  };
  const copiarClave = async () => {
    let v = clave;
    if (!v && !nuevo && c.tiene_password) {   // aún no cargada: traerla descifrada
      try { const r = await api.get(`/clientes/${cliente.id}/password`); v = r.password; setClave(v); }
      catch (e: any) { toast(e.message, true); return; }
    }
    if (!v) { toast("No hay clave para copiar.", true); return; }
    try { await navigator.clipboard.writeText(v); toast("Clave copiada ✓"); }
    catch { toast("No se pudo copiar.", true); }
  };
  const copiarId = (v: string) => {
    if (!v) { toast("No hay número para copiar.", true); return; }
    navigator.clipboard?.writeText(v); toast("Copiado ✓");
  };

  // --- Comparar con RUT (PDF) --------------------------------------------------
  const construirDiff = (p: any): RutDiff[] => {
    const out: RutDiff[] = [];
    const add = (label: string, actual: string | undefined, prop: string | undefined, apply: (o: Cliente) => Cliente) => {
      const a = (actual || "").trim(), pr = (prop || "").trim();
      if (pr && pr !== a) out.push({ label, actual: a, propuesto: pr, apply, check: true });
    };
    add("Razón social", c.razon_social, p.razon_social, (o) => ({ ...o, razon_social: p.razon_social, nombre: o.tipo_contribuyente === "Jur" ? p.razon_social : o.nombre }));
    add("Sigla", c.sigla, p.sigla, (o) => ({ ...o, sigla: p.sigla }));
    // Persona natural: tipo de documento (25) y nombres (31-34)
    add("Tipo de documento", c.tipo_documento, p.tipo_documento, (o) => ({ ...o, tipo_documento: p.tipo_documento }));
    add("Primer apellido", c.primer_apellido, p.primer_apellido, (o) => ({ ...o, primer_apellido: p.primer_apellido }));
    add("Segundo apellido", c.segundo_apellido, p.segundo_apellido, (o) => ({ ...o, segundo_apellido: p.segundo_apellido }));
    add("Primer nombre", c.primer_nombre, p.primer_nombre, (o) => ({ ...o, primer_nombre: p.primer_nombre }));
    add("Otros nombres", c.otros_nombres, p.otros_nombres, (o) => ({ ...o, otros_nombres: p.otros_nombres }));
    add("CIIU principal", c.actividad_ciiu_principal, p.actividad_ciiu_principal,
      (o) => conDomicilioIca({ ...o, actividad_ciiu_principal: p.actividad_ciiu_principal }, o.municipio_dane, p.actividad_ciiu_principal, true));
    add("CIIU secundaria", c.actividad_ciiu_secundaria, p.actividad_ciiu_secundaria, (o) => ({ ...o, actividad_ciiu_secundaria: p.actividad_ciiu_secundaria }));
    if (p.municipio_dane && p.municipio_dane !== c.municipio_dane) {
      out.push({ label: "Municipio (DANE)", actual: c.municipio_dane || "", propuesto: `${p.municipio_dane}${p.departamento_dane ? " · " + deptoNombre(p.departamento_dane) : ""}`, check: true,
        apply: (o) => conDomicilioIca({ ...o, municipio_dane: p.municipio_dane, departamento_dane: p.departamento_dane || o.departamento_dane }, p.municipio_dane, o.actividad_ciiu_principal || p.actividad_ciiu_principal, true) });
    }
    add("Dirección", c.direccion, p.direccion, (o) => ({ ...o, direccion: p.direccion }));
    add("Email", c.email, p.email, (o) => ({ ...o, email: p.email }));
    add("Teléfono", c.telefono, p.telefono, (o) => ({ ...o, telefono: p.telefono }));
    const rl = p.representante || {};
    add("Tipo doc. RL", c.representante_tipo_documento, rl.tipo_documento, (o) => ({ ...o, representante_tipo_documento: rl.tipo_documento }));
    add("Número doc. RL", c.representante_num_id, rl.num_id, (o) => ({ ...o, representante_num_id: rl.num_id }));
    add("Código Rep. (RUT 98)", c.representante_codigo, rl.codigo, (o) => ({ ...o, representante_codigo: rl.codigo }));
    add("Nombre del RL", c.representante_nombre, rl.nombre, (o) => ({ ...o, representante_nombre: rl.nombre }));
    add("RL ejerce desde", c.representante_desde, rl.desde, (o) => ({ ...o, representante_desde: rl.desde }));
    add("Código Seccional (RUT 12)", c.seccional_codigo, p.seccional_codigo, (o) => ({ ...o, seccional_codigo: p.seccional_codigo }));
    // Contador / Revisor fiscal: empatar el nombre del RUT con un responsable de la firma.
    const nombreDe = (id: number | null) => resp.find((r) => r.id === id)?.nombre || "(ninguno)";
    const firmaDiff = (label: string, nombreRut: string | undefined, actualId: number | null, key: keyof Cliente) => {
      if (!nombreRut) return;
      const id = matchResponsable(nombreRut, resp);
      if (id && id !== actualId) {
        out.push({ label, actual: nombreDe(actualId), propuesto: `${nombreDe(id)}  (RUT: ${nombreRut})`, check: true,
          apply: (o) => ({ ...o, [key]: id }) as Cliente });
      } else if (!id) {
        // No hay responsable que empate: solo aviso (crear en Responsables).
        out.push({ label, actual: nombreDe(actualId), propuesto: `${nombreRut} — no está en Responsables (créalo)`, check: false, info: true, apply: (o) => o });
      }
    };
    const cont = p.contador || {}, rev = p.revisor || {};
    firmaDiff("Firma Contador", cont.nombre, c.firma_contador_id, "firma_contador_id");
    add("Contador · tarjeta prof.", c.contador_tarjeta, cont.tarjeta, (o) => ({ ...o, contador_tarjeta: cont.tarjeta }));
    add("Contador · nombramiento", c.contador_desde, cont.desde, (o) => ({ ...o, contador_desde: cont.desde }));
    firmaDiff("Firma Revisor Fiscal", rev.nombre, c.firma_revisor_id, "firma_revisor_id");
    add("Revisor fiscal · tarjeta prof.", c.revisor_tarjeta, rev.tarjeta, (o) => ({ ...o, revisor_tarjeta: rev.tarjeta }));
    add("Revisor fiscal · nombramiento", c.revisor_desde, rev.desde, (o) => ({ ...o, revisor_desde: rev.desde }));
    const codes: string[] = p.responsabilidades || [];
    if (codes.length) {
      const act = (c.responsabilidades || []).map((x) => x.codigo);
      if (JSON.stringify([...act].sort()) !== JSON.stringify([...codes].sort())) {
        const objs = codes.map((cd) => ({ codigo: cd, descripcion: respsCat.find((r) => r.codigo === cd)?.descripcion || "" }));
        out.push({ label: "Responsabilidades (RUT 53)", actual: act.join(", ") || "(ninguna)", propuesto: codes.join(", "), check: true, apply: (o) => ({ ...o, responsabilidades: objs }) });
      }
      // Régimen y Periodicidad IVA derivados de las responsabilidades del RUT:
      //  · con 47 (RST) => Régimen "Simple" + IVA "Anual";  · sin 47 => "Ordinario".
      const rst = codes.includes("47");
      const regProp = rst ? "Simple" : "Ordinario";
      add("Régimen (según RUT 53)", c.regimen, regProp, (o) => ({ ...o, regimen: regProp }));
      if (rst) add("Periodicidad IVA (RST)", c.periodicidad_iva, "Anual", (o) => ({ ...o, periodicidad_iva: "Anual" }));
    }
    return out;
  };
  const onRutFile = async (f?: File) => {
    if (!f) return;
    setRutCargando(true);
    try {
      const p = await api.upload("/clientes/rut/parse", f);
      setRutNit({ leido: p.num_id || "", coincide: !p.num_id || p.num_id === c.num_id });
      const items = construirDiff(p);
      setRutItems(items);
      if (!items.length) toast("El RUT coincide con la ficha: sin diferencias.");
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (/reconoci|escane|formato del RUT/i.test(msg)) {
        await confirmar({
          titulo: "No se pudo leer el RUT",
          mensaje: "El archivo parece un PDF escaneado (una imagen), no el RUT digital. "
            + "Descárgalo del portal de la DIAN en PDF (con texto) y vuelve a intentarlo.",
          confirmar: "Entendido", soloAceptar: true,
        });
      } else {
        await confirmar({ titulo: "Error al leer el RUT", mensaje: msg || "No se pudo procesar el archivo.", confirmar: "Entendido", soloAceptar: true });
      }
    }
    finally { setRutCargando(false); }
  };
  const aplicarRut = () => {
    const nuevo = { ...(rutItems || []).filter((it) => it.check).reduce((acc, it) => it.apply(acc), c), rut_actualizado: hoyISO() };
    setC(nuevo);
    setRutItems(null); setRutNit(null);
    // Las obligaciones DIAN NO se tocan aquí: se revisan a mano con "Revisar
    // obligaciones" (pestaña Obligaciones). Nada cambia en silencio.
    toast("Cambios aplicados. Revisa las obligaciones y pulsa «Guardar cambios».");
  };
  const [explorar, setExplorar] = useState<{ modo: "carpeta" | "archivo"; key: keyof Cliente } | null>(null);

  const guardarRaw = async (): Promise<boolean> => {
    if (c.email_responsable_cliente && !emailOk(c.email_responsable_cliente)) {
      setTab("gestion"); toast("El email del responsable del cliente no es válido", true); return false;
    }
    if (c.email && !emailOk(c.email)) { setTab("ident"); toast("El email del cliente no es válido", true); return false; }
    try {
      const body: any = { ...c, nombre: nombreFinal };
      // Campos numéricos vacíos -> null (el backend no parsea "" como decimal).
      body.servicios = (c.servicios || []).map((s) => ({
        ...s,
        valor_servicio: s.valor_servicio === "" ? null : s.valor_servicio,
        pct_comision: s.pct_comision === "" ? null : s.pct_comision,
      }));
      if (claveTouched) body.password = clave;
      delete body.dv; delete body.tiene_password; delete body.id;
      if (nuevo) await api.post("/clientes", body);
      else await api.put(`/clientes/${cliente.id}`, body);
      return true;
    } catch (e: any) { toast(e.message, true); return false; }
  };
  const guardar = async () => { if (await guardarRaw()) { toast("Guardado ✓"); onSaved(); } };
  const cambiado = () => JSON.stringify(c) !== JSON.stringify(cliente) || claveTouched;
  const navegar = async (id?: number | null) => {
    if (id == null || !onGo) return;
    if (cambiado()) {
      const res = await confirmar({ titulo: "Cambios sin guardar", mensaje: "Tienes cambios sin guardar en esta ficha. ¿Qué deseas hacer antes de pasar al otro registro?", confirmar: "Guardar y continuar", descartar: "Descartar", cancelar: "Cancelar" });
      if (res === "cancelar") return;
      if (res === "si") { if (!(await guardarRaw())) return; reload?.(); }
    }
    onGo(id);
  };
  const borrar = async () => {
    if ((await confirmar({ titulo: "Eliminar cliente", mensaje: `Se eliminará a "${nombreFinal}" del maestro de clientes. Esta acción no se puede deshacer.`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/clientes/${cliente.id}`); toast("Eliminado"); onSaved(); }
    catch (e: any) { toast(e.message, true); }
  };

  // Select de responsables (reutilizable para impuestos/financiero/firmas).
  const RSel = (label: string, value: number | null, key: keyof Cliente) => (
    <div className="f"><label>{label}</label>
      <select value={value ?? ""} onChange={(e) => set(key, e.target.value ? Number(e.target.value) : null)}>
        <option value="">—</option>
        {resp.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
      </select>
    </div>
  );

  return (
    <Modal
      size="lg"
      icon="clientes"
      portal
      minimized={min}
      onMinimize={() => setMin(true)}
      onRestore={() => setMin(false)}
      title={nuevo ? "Nuevo cliente" : `Editando - ${nombreFinal}  ·  ${c.tipo_documento} ${c.num_id}${calcDV(c.num_id) ? "-" + calcDV(c.num_id) : ""}`}
      onClose={onClose}
      onPrev={!nuevo && prevId != null ? () => navegar(prevId) : undefined}
      onNext={!nuevo && nextId != null ? () => navegar(nextId) : undefined}
      onSave={guardar} saveLabel={nuevo ? "Crear" : "Guardar cambios"} saveIcon={nuevo ? "check" : "save"}
      extraActions={<>
        {!nuevo && <button className="mh-act danger" onClick={borrar} aria-label="Eliminar"><Icon name="trash" size={18} /><span className="mh-tip">Eliminar</span></button>}
        <button className="mh-act" onClick={() => rutFileRef.current?.click()} disabled={rutCargando} aria-label="Comparar con RUT"><Icon name="upload" size={18} /><span className="mh-tip">Comparar con RUT</span></button>
      </>}
      avisoTone={c.rut_actualizado ? "info" : "warn"}
      aviso={rutCargando ? "Leyendo el RUT…" : (c.rut_actualizado ? `RUT comparado: ${fmtFecha(c.rut_actualizado)}` : "Nunca comparado con RUT")}
    >
      <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
      {/* Señuelos ocultos: absorben el autocompletado del navegador (Edge/Chrome). */}
      <div aria-hidden style={{ position: "absolute", height: 0, width: 0, overflow: "hidden" }}>
        <input type="text" name="usuario-decoy" tabIndex={-1} autoComplete="username" />
        <input type="password" name="clave-decoy" tabIndex={-1} autoComplete="new-password" />
      </div>
      <div className="ficha-layout">
        <nav className="ficha-nav">
          {TABS.filter(([k]) => (esSuper || k !== "comercial") && (esAdmin || k !== "claves")).map(([k, l]) => (
            <button key={k} type="button" className={"ficha-nav-item" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
              <Icon name={TAB_ICON[k]} size={16} />{l}
            </button>
          ))}
        </nav>
        <div className="ficha-content">
          {tab === "ident" && (
            <>
            <div className="fieldgroup"><h4>Identificación</h4>
              <div style={{ display: "grid", gridTemplateColumns: "148px 118px minmax(150px,1fr) minmax(180px,1.3fr)", gap: 14, alignItems: "start" }}>
                <div className="f"><label>Tipo de contribuyente</label><select value={c.tipo_contribuyente} onChange={(e) => setTipo(e.target.value as any)}><option value="Nat">Natural</option><option value="Jur">Jurídica</option></select></div>
                {jur
                  ? <div className="f"><label>Tipo de documento</label><input value="NT" readOnly /></div>
                  : <div className="f"><label>Tipo de documento</label><CodeSelect path="tipo-documento" items={tiposDoc} onItems={(n) => setTiposDoc((p) => [...p, n])} value={c.tipo_documento} onChange={(v) => set("tipo_documento", v)} /></div>}
                <div className="f"><label>Número ID <span className="req">*</span></label><div className="row"><div className="pw-wrap" style={{ flex: 1 }}><input style={{ paddingRight: 34 }} value={c.num_id} onChange={(e) => set("num_id", e.target.value)} /><button type="button" className="pw-eye" title="Copiar número" onClick={() => copiarId(c.num_id)}><Icon name="copy" size={15} /></button></div><input readOnly style={{ width: 40, textAlign: "center" }} value={calcDV(c.num_id)} title="DV automático" /></div></div>
                <div className="f"><label>Grupo económico</label>
                  <CatSelect path="grupo-economico" items={gruposCat} onItems={(n) => setGruposCat((p) => [...p, n])}
                    by="descripcion" value={c.grupo || ""} onChange={(v) => set("grupo", (v as string) || "")}
                    placeholder="— Sin grupo —" />
                </div>
              </div>
              <div className="grid2" style={{ marginTop: 14 }}>
                {jur
                  ? <div className="f wide"><label>Razón social <span className="req">*</span></label><input value={c.razon_social} onChange={(e) => set("razon_social", e.target.value)} /></div>
                  : <>
                    <div className="f"><label>Primer apellido <span className="req">*</span></label><input value={c.primer_apellido} onChange={(e) => set("primer_apellido", e.target.value)} /></div>
                    <div className="f"><label>Segundo apellido</label><input value={c.segundo_apellido} onChange={(e) => set("segundo_apellido", e.target.value)} /></div>
                    <div className="f"><label>Primer nombre <span className="req">*</span></label><input value={c.primer_nombre} onChange={(e) => set("primer_nombre", e.target.value)} /></div>
                    <div className="f"><label>Otros nombres</label><input value={c.otros_nombres} onChange={(e) => set("otros_nombres", e.target.value)} /></div>
                    <div className="f wide"><label>Nombre (como se guardará)</label><input readOnly value={componer(c) || c.nombre} /></div>
                  </>}
              </div>
            </div>
            <div className="fieldgroup"><h4>Representante legal {jur ? "" : "(no aplica a Persona Natural)"}</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 0.85fr 1.8fr 0.8fr", gap: "9px 16px" }}>
                <div className="f"><label>Tipo doc. RL</label><CodeSelect path="tipo-documento" items={tiposDoc} onItems={(n) => setTiposDoc((p) => [...p, n])} value={c.representante_tipo_documento} onChange={(v) => set("representante_tipo_documento", v)} disabled={!jur} /></div>
                <div className="f"><label>Número doc. RL</label><div className="pw-wrap"><input style={{ paddingRight: 34 }} autoComplete="off" value={c.representante_num_id} disabled={!jur} onChange={(e) => set("representante_num_id", e.target.value)} /><button type="button" className="pw-eye" title="Copiar número" disabled={!jur} onClick={() => copiarId(c.representante_num_id)}><Icon name="copy" size={15} /></button></div></div>
                <div className="f"><label>Código Rep.</label><select value={c.representante_codigo} disabled={!jur} onChange={(e) => set("representante_codigo", e.target.value)}><option value="">—</option>{REP_CODES.map(([cod, desc]) => <option key={cod} value={cod}>{cod} · {desc}</option>)}</select></div>
                <div className="f"><label>Ejerce desde</label><input autoComplete="off" value={c.representante_desde} disabled={!jur} placeholder="AAAA-MM-DD" onChange={(e) => set("representante_desde", e.target.value)} /></div>
                <div className="f" style={{ gridColumn: "span 4" }}><label>Nombre del RL</label><input autoComplete="off" value={c.representante_nombre} disabled={!jur} onChange={(e) => set("representante_nombre", e.target.value)} /></div>
              </div>
            </div>
            <div className="fieldgroup"><h4>Sigla, software y objeto social</h4>
              <div className="grid2">
                <div className="f"><label>Sigla</label><input value={c.sigla} maxLength={3} placeholder="ABC" style={{ textTransform: "uppercase" }} onChange={(e) => set("sigla", e.target.value.toUpperCase().slice(0, 3))} /></div>
                <div className="f"><label>Software utilizado</label><CatSelect path="software" items={software} onItems={(n) => setSoftware((p) => [...p, n])} value={c.software_id} onChange={(v) => set("software_id", v as number | null)} /></div>
              </div>
              <div className="f wide" style={{ marginTop: 14 }}><label>Objeto social</label><textarea rows={2} value={c.objeto_social} onChange={(e) => set("objeto_social", e.target.value)} /></div>
            </div>
            <div className="fieldgroup"><h4>Contacto y ubicación</h4>
              <div className="grid2">
                <F l="Email" v={c.email} on={(v) => set("email", v)} />
                <F l="Email alterno" v={c.email_alt} on={(v) => set("email_alt", v)} />
                <div className="f"><label>Teléfono / Celular</label><input autoComplete="off" value={fmtTel(c.telefono)} placeholder="999-9999999" onChange={(e) => set("telefono", soloDig(e.target.value))} /></div>
                <F l="Dirección (RUT)" v={c.direccion} on={(v) => set("direccion", v)} />
                <div className="f"><label>Municipio (DANE)</label><MunicipioCombo value={c.municipio_dane} onChange={(m) => setC((o) => ({ ...o, municipio_dane: m.codigo, departamento_dane: m.codigo.slice(0, 2) }))} /></div>
                <div className="f"><label>Departamento</label><input value={deptoNombre(c.departamento_dane)} readOnly placeholder="— (se toma del municipio)" /></div>
              </div>
            </div>
            </>
          )}

          {tab === "trib" && (
            <>
              <div className="fieldgroup"><h4>Clasificación tributaria</h4>
                <div style={{ display: "grid", gridTemplateColumns: "150px 100px 1fr 1fr", gap: 14 }}>
                  <div className="f"><label>Régimen</label><select value={c.regimen} onChange={(e) => set("regimen", e.target.value)}><option value="Ordinario">Ordinario</option><option value="Simple">Simple</option></select></div>
                  <div className="f"><label>Año</label><input value={c.regimen_desde ?? ""} onChange={(e) => set("regimen_desde", e.target.value ? Number(e.target.value) : null)} placeholder="AAAA" maxLength={4} /></div>
                  <div className="f"><label>Actividad económica principal (CIIU · RUT 46)</label><CiiuCombo value={c.actividad_ciiu_principal} onChange={(code) => set("actividad_ciiu_principal", code)} /></div>
                  <div className="f"><label>Actividad económica secundaria (CIIU)</label><CiiuCombo value={c.actividad_ciiu_secundaria} onChange={(code) => set("actividad_ciiu_secundaria", code)} /></div>
                </div>
              </div>
              <div className="fieldgroup"><h4>Responsabilidades (RUT casilla 53)</h4>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div className="f" style={{ flex: "1 1 240px", maxWidth: 300 }}>
                    <label>Periodicidad IVA</label>
                    {tieneResp("47")
                      ? <input value="Anual (RST — se asume)" disabled />
                      : tieneResp("48")
                        ? <select value={c.periodicidad_iva === "Anual" ? "" : (c.periodicidad_iva || "")} onChange={(e) => set("periodicidad_iva", e.target.value)}>
                            <option value="">Seleccione…</option>
                            <option value="Bimestral">Bimestral</option>
                            <option value="Cuatrimestral">Cuatrimestral</option>
                          </select>
                        : <input value="No aplica (sin resp. 48/47)" disabled />}
                  </div>
                  <div className="f" style={{ flex: "0 0 160px" }}>
                    <label>Código Seccional</label>
                    <input value={c.seccional_codigo} placeholder="01" maxLength={2} onChange={(e) => set("seccional_codigo", e.target.value.replace(/\D/g, ""))} />
                  </div>
                </div>
                <RespSelect value={c.responsabilidades} onChange={(v) => set("responsabilidades", v)}
                  catalogo={respsCat} onCatalogo={(n) => setRespsCat((p) => [...p, n])} onDel={quitarResp} />
              </div>
            </>
          )}

          {tab === "comercial" && (
            <div className="comercial-tab">
              <div className="fieldgroup">
                <div className="fg-head" style={{ alignItems: "center" }}><h4>Estado comercial</h4>
                  <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--ink)", whiteSpace: "nowrap" }}>Cliente desde</span>
                      <input type="month" value={c.cliente_desde || ""} max="2100-12" title="Mes/año de inicio del cliente"
                        style={{ width: 150 }} onChange={(e) => set("cliente_desde", e.target.value)} />
                    </label>
                    <Toggle color="green" label={c.estado === "Act" ? "Activo" : "Inactivo"}
                      checked={c.estado === "Act"} onChange={(v) => set("estado", v ? "Act" : "Ina")} />
                    {veConf && (
                      <Toggle label="🔒 Confidencial" checked={!!c.confidencial}
                        onChange={(v) => set("confidencial", v)}
                        title="Si está activo, SOLO los supervisores (con permiso «Ver confidenciales») verán este cliente en Maestros." />
                    )}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, marginTop: 12 }}>
                  <div className="f"><label>Ruta Propuesta Comercial
                    <button type="button" className="lbl-ic" title="Buscar archivo…" onClick={() => setExplorar({ modo: "archivo", key: "archivo_propuesta" })}><Icon name="folder" size={14} /></button></label>
                    <input value={c.archivo_propuesta} placeholder="ruta del archivo de propuesta…" onChange={(e) => set("archivo_propuesta", e.target.value)} />
                  </div>
                  <div className="f"><label>Emisor de la cuenta de cobro</label>
                    <select value={c.emisor_id ?? ""} onChange={(e) => set("emisor_id", e.target.value ? Number(e.target.value) : null)} title="Quién firma y emite la cuenta de cobro (CC) de este cliente">
                      <option value="">— Sin asignar —</option>
                      {emisores.map((em) => <option key={em.id} value={em.id}>{em.prefijo ? `${em.prefijo} · ${em.nombre}` : em.nombre}</option>)}
                      {c.emisor_id != null && !emisores.some((em) => em.id === c.emisor_id) && <option value={c.emisor_id}>(emisor inactivo)</option>}
                    </select>
                  </div>
                </div>
              </div>
              <div className="fieldgroup srv-group">
                <div className="fg-head"><h4>Servicios contratados</h4>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <Toggle label="Solo pendientes" checked={soloPend} onChange={setSoloPend} title="Ocultar los cobros ya facturados" />
                    <button className="btn primary sm" onClick={() => setNuevoSrv(true)}><Icon name="plus" size={15} />Nuevo cobro</button>
                  </div>
                </div>
                <DataGrid columns={srvCols} rows={srvVista} getKey={(r) => r.i}
                  label="Servicios contratados" scrollClass="srv-scroll" storageKey="cli-servicios"
                  searchable exportable={false} defaultTotals={["valor"]}
                  emptyLabel={srv.length ? "No hay cobros pendientes." : "Sin servicios. Usa «Nuevo cobro» para crear uno."}
                  actions={(r) => (
                    <div className="act-btns">
                      <button className="act-btn" onClick={() => setRepIdx(r.i)} title="Replicar a varios períodos" disabled={!r.s.periodo}><Icon name="copy" size={14} /></button>
                      <button className="act-btn del" onClick={() => delSrv(r.i)} title="Quitar"><Icon name="trash" size={14} /></button>
                    </div>
                  )} />
              </div>
              {repIdx !== null && (
                <ReplicarModal base={srv[repIdx]?.periodo || ""}
                  onClose={() => setRepIdx(null)}
                  onOk={(n) => { replicarSrv(repIdx, n); setRepIdx(null); }} />
              )}
              {nuevoSrv && (
                <NuevoServicioModal roles={roles} setRoles={setRoles}
                  onClose={() => setNuevoSrv(false)}
                  onOk={(s) => { addSrvObj(s); setNuevoSrv(false); }} />
              )}
            </div>
          )}

          {tab === "ica" && (
            <div className="fieldgroup"><h4>Municipios en que declara ICA</h4>
              <div className="tbl-wrap" style={{ overflow: "visible" }}><table className="child"><thead><tr><th style={{ minWidth: 230 }}>Municipio (DANE)</th><th style={{ minWidth: 190 }}>CIIU (ICA)</th><th className="center" title="Declara ICA en el municipio">ICA</th><th className="center" title="Practica retención de ICA">ReteICA</th><th className="center" title="Autorretenedor de ICA">AutoReteICA</th><th className="center">Exógena distrital</th><th className="center" style={{ width: 56 }}><button className="add-ic" onClick={addIca} title="Agregar municipio"><Icon name="plus" size={16} /></button></th></tr></thead>
                <tbody>
                  {ica.map((m, i) => (
                    <tr key={i}>
                      <td><MunicipioCombo value={m.municipio_dane} onChange={(mn) => setIca(i, { municipio_dane: mn.codigo, municipio: mn.nombre })} /></td>
                      <td><CiiuCombo value={m.ciiu} onChange={(code) => setIca(i, { ciiu: code })} /></td>
                      <td className="center"><input type="checkbox" checked={m.hace_ica} onChange={(e) => setIca(i, { hace_ica: e.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} /></td>
                      <td className="center"><input type="checkbox" checked={m.hace_reteica} onChange={(e) => setIca(i, { hace_reteica: e.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} /></td>
                      <td className="center"><input type="checkbox" checked={m.hace_autoreteica} onChange={(e) => setIca(i, { hace_autoreteica: e.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} /></td>
                      <td className="center"><input type="checkbox" checked={m.exogena_distrital} onChange={(e) => setIca(i, { exogena_distrital: e.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} /></td>
                      <td className="al-c"><button className="act-btn del" onClick={() => delIca(i)} title="Quitar"><Icon name="trash" size={14} /></button></td>
                    </tr>
                  ))}
                  {!ica.length && <tr><td colSpan={7} className="empty" style={{ padding: 14 }}>Sin municipios.</td></tr>}
                </tbody></table></div>
            </div>
          )}

          {tab === "obligaciones" && (
            <div className="fieldgroup">
              <div className="fg-head"><h4>Obligaciones del cliente</h4>
                <span style={{ flex: 1 }} />
                <button type="button" className="btn sm" onClick={abrirRevisar} disabled={revisando}><Icon name="check-circle" size={14} />{revisando ? "Revisando…" : "Revisar obligaciones"}</button>
                <button type="button" className="btn primary sm" onClick={abrirNuevaObl}><Icon name="plus" size={15} />Nueva obligación</button>
              </div>
              <DataGrid columns={oblCols} rows={obl} getKey={(r) => r.obligacion_tipo_id ?? -1}
                label="Obligaciones del cliente" scrollClass="obl-cli-scroll" storageKey="cli-oblig"
                actionsWidth="70px" emptyLabel='Sin obligaciones. Usa "Revisar obligaciones" o "Nueva obligación".'
                actions={(r) => <button className="act-btn del" onClick={() => delObl(r)} title="Quitar"><Icon name="trash" size={15} /></button>} />

              {oblDraft && (() => {
                const t = tipoDe(oblDraft.obligacion_tipo_id);
                return (
                  <Modal title="Nueva obligación del cliente" icon="clipboard-check" size="md"
                    onClose={() => setOblDraft(null)}
                    onSave={guardarObl}>
                    <div className="obl-cli-form">
                      <label className="cq-fld"><span>Obligación (del catálogo)</span>
                        <select value={oblDraft.obligacion_tipo_id ?? ""} autoFocus onChange={(e) => setOblDraft({ obligacion_tipo_id: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">— Selecciona —</option>
                          {obligTipos.filter((x) => x.activo).map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.descripcion}</option>)}
                        </select></label>
                      <div className="obl-cli-ro">
                        <div className="ro"><em>Ente</em>{t?.ente || "—"}</div>
                        <div className="ro"><em>Criterio</em>{t ? (OBL_CRIT_TXT[t.criterio] || t.criterio) : "—"}</div>
                        <div className="ro"><em>Disparador</em>{t ? (OBL_DISP_TXT[t.disparador] ?? t.disparador) : "—"}</div>
                        {t && (t.criterio === "nit1" || t.criterio === "nit2") && <>
                          <div className="ro"><em>Tamaño intervalo</em>{t.tam_intervalo}</div>
                          <div className="ro"><em>Paso (días háb.)</em>{t.paso_dias_habiles}</div>
                        </>}
                        <div className="ro"><em>Activa</em>{t ? (t.activo ? "Sí" : "No") : "—"}</div>
                      </div>
                    </div>
                  </Modal>
                );
              })()}

              {revisar && (() => {
                const filaFalta = (id: number) => { const t = tipoDe(id); return (
                  <div className="rev-row" key={id}>
                    <span className="pill">{t?.codigo || id}</span>
                    <div className="rev-desc"><b>{t?.descripcion || "—"}</b>
                      <span>{t?.ente || "DIAN"} · {t ? (OBL_CRIT_TXT[t.criterio] || t.criterio) : ""}{t?.disparador ? " · " + (OBL_DISP_TXT[t.disparador] ?? t.disparador) : ""}</span></div>
                    <button className="btn add sm" onClick={() => agregarFaltante(id)}><Icon name="plus" size={14} />Agregar</button>
                  </div>
                ); };
                const filaSobra = (id: number) => { const t = tipoDe(id); return (
                  <div className="rev-row old" key={id}>
                    <span className="pill">{t?.codigo || id}</span>
                    <div className="rev-desc"><b>{t?.descripcion || "—"}</b><span>ya no aplica según el RUT</span></div>
                    <button className="btn del2 sm" onClick={() => quitarSobrante(id)}><Icon name="trash" size={14} />Quitar…</button>
                  </div>
                ); };
                const nada = !revisar.faltan.length && !revisar.sobran.length;
                return (
                  <Modal title="Revisar obligaciones DIAN" sub={nombreFinal} icon="check-circle" size="md"
                    onClose={() => setRevisar(null)}
                    aviso={<>Los cambios entran a la grilla; recuerda <b>Guardar cambios</b>.</>}
                    onSave={revisar.faltan.length > 0 ? agregarTodasFaltantes : undefined}
                    saveLabel="Agregar faltantes" saveIcon="plus">
                    {nada
                      ? <div className="rev-ok"><Icon name="check-circle" size={18} />Las obligaciones DIAN están al día.</div>
                      : <>
                        {revisar.faltan.length > 0 && <div className="rev-sec">
                          <div className="rev-h add"><Icon name="plus" size={14} />Faltan · se agregarían<span className="n">{revisar.faltan.length}</span><span className="sp" />
                            <button className="btn add sm" onClick={agregarTodasFaltantes}><Icon name="plus" size={14} />Agregar todas</button></div>
                          {revisar.faltan.map(filaFalta)}
                        </div>}
                        {revisar.sobran.length > 0 && <div className="rev-sec">
                          <div className="rev-h del"><Icon name="trash" size={14} />Sobran · revisar antes de quitar<span className="n">{revisar.sobran.length}</span><span className="sp" />
                            <button className="btn del2 sm" onClick={quitarTodasSobrantes}><Icon name="trash" size={14} />Quitar todas…</button></div>
                          {revisar.sobran.map(filaSobra)}
                          <p className="rev-note">Quitar pide confirmación: puede ser una obligación puesta a mano a propósito. Las manuales (no DIAN) nunca se listan aquí.</p>
                        </div>}
                      </>}
                  </Modal>
                );
              })()}
            </div>
          )}

          {tab === "claves" && (
            <div className="claves-tab">
              <div className="fieldgroup srv-group">
                <div className="fg-head"><h4>Claves y portales</h4>
                  {cliente.id && <button type="button" className="btn sm" onClick={() => setClaveEdit("new")}><Icon name="plus" size={14} />Nueva clave</button>}
                </div>
                {!cliente.id
                  ? <div className="empty" style={{ padding: 16 }}>Guarda el cliente primero para agregar sus claves.</div>
                  : <DataGrid columns={claveCols} rows={claves} getKey={(k) => k.id}
                      label="Claves y portales" scrollClass="srv-scroll" storageKey="cli-claves"
                      searchable exportable={false}
                      emptyLabel={'Sin claves. Usa «Nueva clave» para agregar.'}
                      actions={(k) => (
                        <div className="act-btns">
                          <button className="act-btn" onClick={() => setClaveEdit(k)} title="Editar"><Icon name="edit" size={14} /></button>
                          <button className="act-btn del" onClick={() => borrarClave(k)} title="Eliminar"><Icon name="trash" size={14} /></button>
                        </div>
                      )} />}
              </div>
            </div>
          )}

          {tab === "gestion" && (
            <>
              <div className="fieldgroup"><h4>Responsables de la firma</h4>
                <div className="grid2">
                  {RSel("Responsable Impuestos", c.responsable_impuestos_id, "responsable_impuestos_id")}
                  {RSel("Coordinador Impuestos", c.coordinador_impuestos_id, "coordinador_impuestos_id")}
                  {RSel("Responsable Financiero", c.responsable_financiero_id, "responsable_financiero_id")}
                  {RSel("Coordinador Financiero", c.coordinador_financiero_id, "coordinador_financiero_id")}
                  {RSel("Responsable del Registro", c.responsable_registro_id, "responsable_registro_id")}
                </div>
              </div>
              <div className="fieldgroup"><h4>Contador y Revisor fiscal (tarjeta y nombramiento del RUT)</h4>
                <div className="firma-row">
                  {RSel("Firma Contador", c.firma_contador_id, "firma_contador_id")}
                  <div className="f"><label>Tarjeta prof.</label><input value={c.contador_tarjeta} onChange={(e) => set("contador_tarjeta", e.target.value)} /></div>
                  <div className="f"><label>Nombramiento</label><input value={c.contador_desde} placeholder="AAAA-MM-DD" onChange={(e) => set("contador_desde", e.target.value)} /></div>
                </div>
                <div className="firma-row" style={{ marginTop: 14 }}>
                  {RSel("Firma Revisor Fiscal", c.firma_revisor_id, "firma_revisor_id")}
                  <div className="f"><label>Tarjeta prof.</label><input value={c.revisor_tarjeta} onChange={(e) => set("revisor_tarjeta", e.target.value)} /></div>
                  <div className="f"><label>Nombramiento</label><input value={c.revisor_desde} placeholder="AAAA-MM-DD" onChange={(e) => set("revisor_desde", e.target.value)} /></div>
                </div>
              </div>
              <div className="fieldgroup"><h4>Responsable del cliente (contacto)</h4>
                <div className="grid2">
                  <F l="Responsable del Cliente" v={c.responsable_cliente} on={(v) => set("responsable_cliente", v)} />
                  <div className="f"><label>Email Responsable Cliente</label>
                    <input type="email" value={c.email_responsable_cliente} onChange={(e) => set("email_responsable_cliente", e.target.value)}
                      className={c.email_responsable_cliente && !emailOk(c.email_responsable_cliente) ? "inp-err" : ""} />
                    {c.email_responsable_cliente && !emailOk(c.email_responsable_cliente) && <span className="fld-err">Email no válido</span>}
                  </div>
                </div>
              </div>
              <div className="fieldgroup"><h4>Portal DIAN y ruta de trabajo</h4>
                <div className="grid2">
                  <div className="f"><label>Clave del portal DIAN (cifrada)</label>
                    <div className="pw-wrap">
                      <input style={{ paddingRight: 58 }} type={showPw ? "text" : "password"} name="clave-portal-cyc" autoComplete="new-password" value={clave} placeholder={c.tiene_password ? "••••••" : ""} onChange={(e) => { setClave(e.target.value); setClaveTouched(true); }} />
                      <div className="pw-acts">
                        <button type="button" className="pw-eye" title={showPw ? "Ocultar" : "Ver clave"} onClick={verOcultarClave}><Icon name={showPw ? "eye-off" : "eye"} size={16} /></button>
                        <button type="button" className="pw-eye" title="Copiar clave" onClick={copiarClave}><Icon name="copy" size={15} /></button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="f wide" style={{ marginTop: 12 }}><label>Ruta de trabajo del cliente</label>
                  <div className="filebox"><input value={c.ruta_trabajo} placeholder="carpeta de trabajo…" onChange={(e) => set("ruta_trabajo", e.target.value)} /><button type="button" className="btn sm" title="Buscar carpeta" onClick={() => setExplorar({ modo: "carpeta", key: "ruta_trabajo" })}><Icon name="folder" size={14} />Examinar…</button></div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <input ref={rutFileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
        onChange={(e) => { onRutFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
      </form>
      {explorar && <Explorador modo={explorar.modo} onSelect={(ruta) => set(explorar.key, ruta)} onClose={() => setExplorar(null)} />}
      {claveEdit && (
        <ClaveModal portales={portalesCat} setPortales={setPortalesCat}
          clave={claveEdit === "new" ? null : claveEdit}
          getClave={claveEdit !== "new" && (claveEdit as ClienteClave).tiene_clave
            ? () => api.get(`/clientes/${cliente.id}/claves/${(claveEdit as ClienteClave).id}/revelar`).then((r: any) => r.clave || "")
            : undefined}
          onClose={() => setClaveEdit(null)}
          onOk={async (payload) => {
            try {
              if (claveEdit === "new") await api.post(`/clientes/${cliente.id}/claves`, payload);
              else await api.put(`/clientes/${cliente.id}/claves/${(claveEdit as ClienteClave).id}`, payload);
              setClaveEdit(null); cargarClaves(); toast("Guardada ✓");
            } catch (e: any) { toast(e.message, true); }
          }} />
      )}
      {rutItems !== null && (
        <Modal title="Conciliación con el RUT" icon="file" size="md"
               onClose={() => { setRutItems(null); setRutNit(null); }}
               extraActions={rutItems.length > 0 ? (
                 <button className="mh-act" aria-label="Marcar/Desmarcar todos"
                   onClick={() => setRutItems((arr) => { const t = !(arr || []).filter((y) => !y.info).every((y) => y.check); return (arr || []).map((x) => x.info ? x : { ...x, check: t }); })}>
                   <Icon name="check-circle" size={18} /><span className="mh-tip">Marcar/Desmarcar todos</span></button>
               ) : undefined}
               onSave={rutItems.length > 0 ? aplicarRut : undefined}
               canSave={rutItems.some((it) => it.check)}
               saveLabel={`Aplicar ${rutItems.filter((it) => it.check).length} cambios`} saveIcon="check"
               avisoTone={rutNit && !rutNit.coincide ? "err" : rutItems.length === 0 ? "ok" : "info"}
               aviso={rutNit && !rutNit.coincide
                 ? `El NIT del RUT (${rutNit.leido}) no coincide con el de la ficha (${c.num_id}). Verifica que sea el RUT correcto.`
                 : rutItems.length === 0
                   ? "El RUT coincide con la ficha; no hay cambios por aplicar."
                   : `${rutItems.filter((it) => it.check).length} cambio(s) a aplicar · se traen a la ficha; luego «Guardar cambios».`}>
          {rutItems.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--ink-2)" }}>No hay diferencias entre el RUT y la ficha. ✓</div>
          ) : (
            <>
              <div className="tbl-wrap" style={{ maxHeight: "50vh", overflow: "auto" }}>
                <table className="child">
                  <thead><tr><th style={{ width: 34 }}></th><th style={{ minWidth: 140 }}>Campo</th><th>En la ficha</th><th>En el RUT</th></tr></thead>
                  <tbody>
                    {rutItems.map((it, i) => (
                      <tr key={i}>
                        <td className="al-c">{it.info
                          ? <span title="No se puede aplicar; solo aviso" style={{ color: "#E8A020" }}><Icon name="info" size={15} /></span>
                          : <input type="checkbox" checked={it.check} onChange={(e) => setRutItems((arr) => (arr || []).map((x, j) => j === i ? { ...x, check: e.target.checked } : x))} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} />}</td>
                        <td><b>{it.label}</b></td>
                        <td style={{ color: "var(--ink-3)" }}>{it.actual || "—"}</td>
                        <td style={{ color: it.info ? "#E8A020" : "var(--primary)" }}>{it.propuesto}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Modal>
      )}
    </Modal>
  );
}

function F({ l, v, on }: { l: string; v: string; on: (v: string) => void }) {
  return <div className="f"><label>{l}</label><input autoComplete="off" value={v} onChange={(e) => on(e.target.value)} /></div>;
}

/** Responsabilidades DIAN (RUT 53): se cargan desde el RUT (que la DIAN ya valida),
 *  y también se pueden agregar a mano desde el catálogo (con "+" para crear una nueva).
 *  Permite quitar una fila por si hay que corregir. */
function RespSelect({ value, onChange, catalogo, onCatalogo, onDel }: {
  value: { codigo: string; descripcion: string }[];
  onChange: (v: { codigo: string; descripcion: string }[]) => void;
  catalogo: { codigo: string; descripcion: string }[];
  onCatalogo: (n: { codigo: string; descripcion: string }) => void;
  onDel?: (codigo: string) => void;     // si se pasa, maneja el quitar (con confirmación)
}) {
  const del = (codigo: string) => onChange((value || []).filter((v) => v.codigo !== codigo));
  const agregar = (cod: string) => {
    if (!cod || (value || []).some((v) => v.codigo === cod)) return;
    const desc = catalogo.find((x) => x.codigo === cod)?.descripcion || "";
    onChange([...(value || []), { codigo: cod, descripcion: desc }]);
  };
  return (
    <div className="tbl-wrap" style={{ marginTop: 12 }}>
      <table className="resp-grid">
        <thead><tr><th style={{ width: 90 }}>Código</th><th>Descripción</th><th className="center" style={{ width: 64 }}>Quitar</th></tr></thead>
        <tbody>
          {(value || []).length === 0 && <tr><td colSpan={3} className="empty">Sin responsabilidades (se cargan al «Comparar con RUT» o agrégalas abajo)</td></tr>}
          {(value || []).map((r) => (
            <tr key={r.codigo}>
              <td><span className="pill">{r.codigo}</span></td>
              <td>{r.descripcion}</td>
              <td className="center"><button type="button" className="act-btn del" title="Quitar" onClick={() => (onDel ? onDel(r.codigo) : del(r.codigo))}><Icon name="trash" size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="f" style={{ marginTop: 8 }}>
        <CodeSelect path="responsabilidad" items={catalogo} onItems={onCatalogo}
          value={null} onChange={agregar} placeholder="Agregar responsabilidad…" maxCod={5} />
      </div>
    </div>
  );
}
