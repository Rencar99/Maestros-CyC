import { useEffect, useState } from "react";
import { api, clearToken, getToken } from "./api";
import { Responsable } from "./types";
import { ConfirmProvider, Icon, ToastProvider } from "./ui";
import { Splash } from "./components/Splash";
import { Login } from "./pages/Login";
import { Clientes } from "./pages/Clientes";
import { Responsables } from "./pages/Responsables";
import { Catalogos } from "./pages/Catalogos";
import { Facturacion } from "./pages/Facturacion";
import { CuentasCobro } from "./pages/CuentasCobro";
import { Claves } from "./pages/Claves";
import { Consultas } from "./pages/Consultas";
import { ConsultasPublicas } from "./pages/ConsultasPublicas";
import { Config } from "./pages/Config";
import { ServidorConfig } from "./components/ServidorConfig";

type Page = "clientes" | "responsables" | "claves" | "catalogos" | "facturacion" | "cobros" | "consultas" | "generar" | "config";
const TITLES: Record<Page, [string, string]> = {
  clientes: ["Clientes", "Catálogo general de clientes de la firma"],
  responsables: ["Responsables", "Personal de la firma (internos y externos)"],
  claves: ["Claves", "Credenciales de los clientes en los portales"],
  catalogos: ["Catálogos", "Listas maestras editables"],
  facturacion: ["Facturación", "Generación mensual de la facturación"],
  cobros: ["Cuentas de cobro", "Generación y envío de cuentas de cobro"],
  consultas: ["Consultas", "Consultas disponibles para ejecutar"],
  generar: ["Generar Consultas", "Arma consultas sobre la base sin escribir SQL"],
  config: ["Configuración", "Roles, permisos y manual de usuario"],
};
// Permiso que habilita cada página. Catálogos es pantalla de edición =
// catalogos.editar; Generar Consultas = consultas.generar; el resto = seccion.ver.
// (Configuración se excluye del guard: es visible para todos por el Manual.)
const CLAVE_VER = (p: Page) => (p === "catalogos" ? "catalogos.editar"
  : p === "generar" ? "consultas.generar" : p === "cobros" ? "facturacion.ver" : p + ".ver");

export default function App() {
  const [user, setUser] = useState<Responsable | null>(null);
  const [ready, setReady] = useState(false);
  const [sinConexion, setSinConexion] = useState(false);
  const [page, setPage] = useState<Page>("clientes");
  // "keep-alive": una vez visitada, la sección se mantiene montada (conserva su
  // estado: facturación generada, filtros de grilla, etc.) y solo se oculta.
  const [vistas, setVistas] = useState<Set<Page>>(() => new Set<Page>(["clientes"]));
  useEffect(() => { setVistas((v) => v.has(page) ? v : new Set(v).add(page)); }, [page]);
  const [colapsado, setColapsado] = useState(() => localStorage.getItem("side_colapsado") === "1");
  const toggleSide = () => setColapsado((c) => { localStorage.setItem("side_colapsado", c ? "0" : "1"); return !c; });

  useEffect(() => {
    const salir = () => { clearToken(); setUser(null); };
    window.addEventListener("maestros:logout", salir);
    // Antes de todo: ¿la base responde? Si no, mostrar la pantalla de servidor.
    api.get("/servidor").then((s: any) => {
      if (s && s.conectado === false) { setSinConexion(true); setReady(true); return; }
      if (getToken()) api.get("/auth/me").then(setUser).catch(() => clearToken()).finally(() => setReady(true));
      else setReady(true);
    }).catch(() => setReady(true));   // si /servidor falla, seguir al login normal
    return () => window.removeEventListener("maestros:logout", salir);
  }, []);

  const inicial = (user?.nombre || "?").split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  // RBAC: qué secciones/acciones puede el usuario. Super ve todo.
  const perms = new Set(user?.permisos || []);
  const puede = (clave: string) => user?.rol === "superadmin" || perms.has(clave);
  // Si la página activa dejó de ser visible (por permisos), caer a la primera permitida.
  useEffect(() => {
    if (!user) return;
    const orden: Page[] = ["clientes", "responsables", "claves", "facturacion", "cobros", "consultas", "catalogos", "generar", "config"];
    if (page !== "config" && !puede(CLAVE_VER(page))) {   // Configuración es visible para todos (Manual)
      const primera = orden.find((p) => puede(CLAVE_VER(p)));
      if (primera) setPage(primera);
    }
  }, [user, page]); // eslint-disable-line

  return (
    <ToastProvider>
    <ConfirmProvider>
      <Splash />
      {!ready ? (
        <div className="spin">Cargando…</div>
      ) : sinConexion ? (
        <ServidorConfig variant="pantalla" onListo={() => setSinConexion(false)} />
      ) : !user ? (
        <Login onOk={setUser} />
      ) : (
        <div className={"app" + (colapsado ? " nav-col" : "")}>
          <aside className={"side" + (colapsado ? " collapsed" : "")}>
            <button className="side-toggle" onClick={toggleSide}
              title={colapsado ? "Expandir menú" : "Colapsar menú"} aria-label="Colapsar menú">
              <Icon name={colapsado ? "chevron-right" : "chevron-left"} size={16} />
            </button>
            <div className="brand">
              <img src="/assets/logo-blanco-t.png" alt="Cardona & co." className="brand-logo" />
              <img src="/assets/logo-icono-ocre.png" alt="Cardona & co." className="brand-ico" />
              <div className="sub">Maestros</div>
            </div>
            <div className="nav-lbl">Maestros</div>
            {puede("clientes.ver") && <button className={"nav-item" + (page === "clientes" ? " on" : "")} title="Clientes" onClick={() => setPage("clientes")}><Icon name="clientes" /><span className="nav-txt">Clientes</span></button>}
            {puede("responsables.ver") && <button className={"nav-item" + (page === "responsables" ? " on" : "")} title="Responsables" onClick={() => setPage("responsables")}><Icon name="resp" /><span className="nav-txt">Responsables</span></button>}
            {puede("claves.ver") && <button className={"nav-item" + (page === "claves" ? " on" : "")} title="Claves" onClick={() => setPage("claves")}><Icon name="lock" /><span className="nav-txt">Claves</span></button>}
            {puede("facturacion.ver") && (
              <button className={"nav-item" + (page === "facturacion" ? " on" : "")} title="Facturación" onClick={() => setPage("facturacion")}><Icon name="briefcase" /><span className="nav-txt">Facturación</span></button>
            )}
            {puede("facturacion.ver") && (
              <button className={"nav-item" + (page === "cobros" ? " on" : "")} title="Cuentas de cobro" onClick={() => setPage("cobros")}><Icon name="file" /><span className="nav-txt">Cuentas de cobro</span></button>
            )}
            {puede("consultas.ver") && (
              <button className={"nav-item" + (page === "consultas" ? " on" : "")} title="Consultas" onClick={() => setPage("consultas")}><Icon name="search" /><span className="nav-txt">Consultas</span></button>
            )}
            <div className="nav-lbl">Sistema</div>
            {puede("catalogos.editar") && <button className={"nav-item" + (page === "catalogos" ? " on" : "")} title="Catálogos" onClick={() => setPage("catalogos")}><Icon name="cat" /><span className="nav-txt">Catálogos</span></button>}
            {puede("consultas.generar") && (
              <button className={"nav-item" + (page === "generar" ? " on" : "")} title="Generar Consultas" onClick={() => setPage("generar")}><Icon name="db" /><span className="nav-txt">Generar Consultas</span></button>
            )}
            <button className={"nav-item" + (page === "config" ? " on" : "")} title="Configuración" onClick={() => setPage("config")}><Icon name="gear" /><span className="nav-txt">Configuración</span></button>
            <div className="side-foot">
              <div className="avatar" title={user.nombre}>{user.foto ? <img src={user.foto} alt="" /> : inicial}</div>
              <div className="who">{user.nombre}<span>{user.rol === "superadmin" ? "Super Usuario" : user.rol === "admin" ? "Administrador" : "Usuario"}</span></div>
              <button className="lo" title="Cerrar sesión" onClick={() => { clearToken(); setUser(null); }}><Icon name="logout" size={16} /></button>
            </div>
          </aside>
          <div className="main">
            <div className="topbar">
              <div><h2>{TITLES[page][0]}</h2><div className="sub">{TITLES[page][1]}</div></div>
            </div>
            <div className="content">
              {vistas.has("clientes") && puede("clientes.ver") && <div style={{ display: page === "clientes" ? "contents" : "none" }}><Clientes esSuper={user.rol === "superadmin"} esAdmin={user.rol === "superadmin" || user.rol === "admin"} puede={puede} active={page === "clientes"} /></div>}
              {vistas.has("responsables") && puede("responsables.ver") && <div style={{ display: page === "responsables" ? "contents" : "none" }}><Responsables esSuper={user.rol === "superadmin"} puede={puede} active={page === "responsables"} /></div>}
              {vistas.has("claves") && puede("claves.ver") && <div style={{ display: page === "claves" ? "contents" : "none" }}><Claves esSuper={user.rol === "superadmin"} puede={puede} active={page === "claves"} /></div>}
              {vistas.has("catalogos") && puede("catalogos.editar") && <div style={{ display: page === "catalogos" ? "contents" : "none" }}><Catalogos esSuper={user.rol === "superadmin"} /></div>}
              {vistas.has("facturacion") && puede("facturacion.ver") && <div style={{ display: page === "facturacion" ? "contents" : "none" }}><Facturacion usuario={user.usuario || user.nombre} active={page === "facturacion"} goFacturacion={() => setPage("facturacion")} /></div>}
              {vistas.has("cobros") && puede("facturacion.ver") && <div style={{ display: page === "cobros" ? "contents" : "none" }}><CuentasCobro active={page === "cobros"} /></div>}
              {vistas.has("consultas") && puede("consultas.ver") && <div style={{ display: page === "consultas" ? "contents" : "none" }}><ConsultasPublicas /></div>}
              {vistas.has("generar") && puede("consultas.generar") && <div style={{ display: page === "generar" ? "contents" : "none" }}><Consultas /></div>}
              {vistas.has("config") && <div style={{ display: page === "config" ? "contents" : "none" }}><Config active={page === "config"} puede={puede} /></div>}
            </div>
          </div>
        </div>
      )}
    </ConfirmProvider>
    </ToastProvider>
  );
}
