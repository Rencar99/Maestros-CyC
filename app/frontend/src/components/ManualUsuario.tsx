import { ReactNode, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../ui";

/* ---- Helpers de cuerpo (mismos estilos que el Manual de Descargas DIAN) ---- */
const H = ({ e, children }: { e?: string; children: ReactNode }) => (
  <h4 style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", margin: "18px 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
    {e && <span style={{ fontSize: 16, lineHeight: 1 }}>{e}</span>}{children}
  </h4>
);
const P = ({ children }: { children: ReactNode }) => (
  <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-2)", margin: "8px 0" }}>{children}</p>
);
const L = ({ children }: { children: ReactNode }) => (
  <ul style={{ margin: "8px 0", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-2)" }}>{children}</ul>
);
const OL = ({ children }: { children: ReactNode }) => (
  <ol style={{ margin: "8px 0", paddingLeft: 22, fontSize: 13.5, lineHeight: 1.75, color: "var(--ink-2)" }}>{children}</ol>
);
/* Nota con tipo: warn (⚠️ regla), tip (💡 consejo), lock (🔒 seguridad), ok (✅ bueno saber) */
const NOTA_CFG: Record<string, { e: string; c: string; bg: string }> = {
  warn: { e: "⚠️", c: "#f7931e", bg: "var(--warn-bg)" },
  tip: { e: "💡", c: "#0836c7", bg: "var(--info-bg)" },
  lock: { e: "🔒", c: "#f7931e", bg: "var(--warn-bg)" },
  ok: { e: "✅", c: "#2e7d32", bg: "var(--ok-bg)" },
};
const Nota = ({ tipo = "warn", children }: { tipo?: "warn" | "tip" | "lock" | "ok"; children: ReactNode }) => {
  const cfg = NOTA_CFG[tipo];
  return (
    <div style={{ margin: "12px 0", padding: "10px 14px 10px 12px", background: cfg.bg, border: "1px solid var(--line)", borderLeft: `3px solid ${cfg.c}`, borderRadius: "0 8px 8px 0", fontSize: 13, lineHeight: 1.65, color: "var(--ink-2)", display: "flex", gap: 10 }}>
      <span style={{ flex: "none", fontSize: 14, lineHeight: 1.6 }}>{cfg.e}</span>
      <div>{children}</div>
    </div>
  );
};

type Sec = { id: string; titulo: string; icono: string; texto: string; cuerpo: ReactNode };

/* -------------------------------- Contenido -------------------------------- */
const SECCIONES: Sec[] = [
  {
    id: "intro", titulo: "Introducción", icono: "info",
    texto: "que es maestros base compartida menu organizacion cerebro referencia firma primeros pasos grillas buscar filtrar ordenar exportar columnas minimizar roles permisos refrescar",
    cuerpo: (
      <>
        <P>👋 <b>Maestros CyC</b> es la aplicación donde la firma mantiene sus <b>datos de referencia</b>: clientes, responsables (personal), claves de los portales, los catálogos y las obligaciones DIAN de cada cliente. Es la <b>fuente única</b>: lo que se define aquí lo consumen las demás apps de la firma.</P>
        <P>Corre en el equipo de cada persona y se conecta a la <b>base de datos compartida</b>. Todos trabajan sobre los mismos datos <b>en tiempo real</b>: si alguien cambia un cliente, los demás lo ven al refrescar.</P>

        <H e="🧭">Cómo está organizado el menú</H>
        <P>El menú de la izquierda agrupa las pantallas en dos bloques:</P>
        <L>
          <li><b>Maestros</b> — el dato del día a día: <b>Clientes</b>, <b>Responsables</b>, <b>Claves</b>, <b>Facturación</b> y <b>Consultas</b>.</li>
          <li><b>Sistema</b> — administración: <b>Catálogos</b> (listas maestras), <b>Generar Consultas</b> y <b>Configuración</b> (Roles y permisos, este Manual y el Servidor de datos).</li>
        </L>
        <P>Lo que ves en el menú depende de tu <b>rol</b>: solo aparecen las secciones a las que tu usuario tiene permiso (ver <i>Roles y permisos</i>).</P>

        <H e="📊">Cómo moverse en las grillas (tablas)</H>
        <P>Casi todas las pantallas usan la misma tabla ("Grilla CyC"). Con ella puedes:</P>
        <L>
          <li>🔍 <b>Buscar</b> en toda la tabla con el cuadro de búsqueda (acepta comodines <code>*</code>).</li>
          <li>↕️ <b>Ordenar</b> por una columna haciendo clic en su encabezado.</li>
          <li>🔻 <b>Filtrar</b> por columna con el menú del encabezado (el triángulo <code>▾</code>).</li>
          <li>↔️ <b>Reordenar y redimensionar</b> columnas arrastrándolas; la App recuerda tu ajuste.</li>
          <li>📗 <b>Exportar a Excel</b> con el botón <i>Exportar</i>.</li>
        </L>
        <Nota tipo="tip">Cada pantalla <b>se recarga sola al entrar</b>: si alguien más cambió datos mientras la tenías abierta, al volver a la sección verás lo último. Donde haya ícono 🔄, también puedes recargar en el momento.</Nota>

        <H e="🪟">Editar sin perder el hilo</H>
        <P>Las fichas (Cliente, Responsable) y el editor de Facturación se pueden <b>minimizar</b> con el botón <b>─</b> de arriba: la ventana se guarda como una <b>píldora</b> abajo a la derecha, te vas a consultar otra pantalla, y al hacer clic en la píldora vuelves <b>con todo intacto</b>. Puedes tener varias minimizadas a la vez, una al lado de la otra.</P>

        <Nota>🧠 <b>Maestros es el "cerebro".</b> Los clientes, responsables, obligaciones y claves que defines aquí alimentan al <b>Calendario de obligaciones</b>, a <b>Descargas DIAN</b>, al <b>Liquidador 350</b> y demás. Por eso un cambio aquí impacta a toda la firma: hazlo con cuidado.</Nota>
      </>
    ),
  },
  {
    id: "clientes", titulo: "Clientes", icono: "clientes",
    texto: "contribuyente nit documento dv rut casilla 53 regimen simple 47 periodicidad iva agente de retencion retenedor responsables obligaciones revisar por revisar representante legal sigla software objeto social contacto cliente desde clasificacion tributaria comparar rut pestañas identificacion tributario comercial municipios ica reteica autorretencion exogena distrital claves gestion minimizar quitar responsabilidad navegar confidencial emisor cuenta de cobro",
    cuerpo: (
      <>
        <P>👥 Catálogo general de los clientes de la firma. Cada cliente es un <b>contribuyente</b> (persona natural o jurídica) con su documento/NIT, datos de contacto, clasificación tributaria, responsables asignados, servicios, claves y obligaciones.</P>

        <H e="➕">Crear un cliente nuevo</H>
        <OL>
          <li>Clic en <b>+ Nuevo cliente</b>.</li>
          <li>Elige <b>tipo de contribuyente</b> (Natural / Jurídica) y el <b>tipo de documento</b>. Para jurídicas es NT y el <b>dígito de verificación (DV)</b> se calcula solo.</li>
          <li>La vía rápida y confiable es <b>Comparar con RUT</b>: carga el PDF del RUT y la App llena nombre, documento, actividades (CIIU), responsabilidades, régimen, etc. (ver abajo).</li>
          <li>Completa lo que falte y <b>Guardar cambios</b>.</li>
        </OL>

        <H e="📄">Comparar con RUT</H>
        <P>Botón <b>Comparar con RUT</b> (abajo en la ficha): lee un RUT en PDF y te muestra, campo por campo, qué trae el RUT frente a lo que tienes, para que apliques lo que quieras. De ahí la App <b>deriva</b> datos clave y te evita teclear a mano.</P>
        <Nota tipo="tip">La fecha <i>"Actualizado: …"</i> de la ficha indica la última vez que se comparó con el RUT. <i>"Nunca comparado"</i> = conviene cargarlo.</Nota>

        <H e="🗂️">Las pestañas de la ficha</H>
        <L>
          <li><b>Identificación:</b> tipo de contribuyente, documento + DV (NIT/ID), nombre o razón social, el <b>representante legal</b> de las jurídicas (documento, nombre, código de representación), sigla, software contable, objeto social, grupo económico y los datos de contacto/ubicación.</li>
          <li><b>Tributario:</b> clasificación tributaria y responsabilidades del RUT (ver siguiente bloque).</li>
          <li><b>Comercial:</b> servicios contratados y cobros programados (alimentan <i>Facturación</i>).</li>
          <li><b>Municipios ICA:</b> municipios donde el cliente declara, con sus marcas de <b>ICA</b>, <b>ReteICA</b>, <b>Autorretención</b> y <b>Exógena distrital</b> por municipio (para el calendario municipal).</li>
          <li><b>Obligaciones:</b> obligaciones DIAN del cliente (ver más abajo).</li>
          <li><b>Claves:</b> credenciales del cliente en los portales, guardadas cifradas.</li>
          <li><b>Gestión:</b> responsables de la firma asignados, firma contador/revisor, contacto del cliente, clave del portal DIAN y ruta de trabajo.</li>
        </L>

        <H e="⚖️">Clasificación tributaria (pestaña Tributario)</H>
        <P>El <b>Régimen</b> (<code>47</code> = Simple; si no, Ordinario), la <b>Periodicidad de IVA</b> y la condición de <b>agente de retención</b> se <b>derivan</b> de las <b>responsabilidades del RUT (casilla 53)</b> — no se teclean a mano. Por eso lo importante es mantener bien las responsabilidades: se cargan al Comparar con RUT, o se agregan/quitan en la tabla de esa pestaña.</P>
        <Nota>Al <b>quitar una responsabilidad</b>, si el cliente tiene obligaciones DIAN asignadas, la App avisa y pide confirmación: el cliente quedará <b>«por revisar»</b> (las obligaciones no se quitan solas).</Nota>

        <H e="📋">Obligaciones DIAN del cliente (pestaña Obligaciones)</H>
        <P>Lista las obligaciones DIAN que le aplican. Salen del <b>catálogo de Obligaciones</b> según el perfil del RUT, pero <b>la reconciliación es manual</b>: nada se agrega ni se quita solo al guardar.</P>
        <OL>
          <li><b>Revisar obligaciones:</b> compara el RUT actual contra lo asignado y muestra lo que <b>Falta</b> (agregar) y lo que <b>Sobra</b> (quitar).</li>
          <li>Agregas los faltantes con un clic; quitar un sobrante pide confirmación. Las obligaciones puestas <b>a mano</b> nunca se listan como sobrantes.</li>
          <li>En la lista de Clientes, un chip ámbar <b>"por revisar"</b> (y su filtro rápido) marca los clientes cuyo RUT dejó de coincidir con sus obligaciones.</li>
        </OL>
        <Nota>No se puede quitar una obligación que ya tiene <b>trabajo en el Calendario</b> (cumplimientos o revisiones registrados): la App lo bloquea para no perder esos registros. Si de verdad ya no aplica, primero desactívala o elimina sus registros en el Calendario.</Nota>

        <H e="💡">Trucos útiles</H>
        <L>
          <li>➖ <b>Minimizar la ficha:</b> botón <b>─</b> de arriba para irte a consultar otra pantalla (p. ej. un catálogo) y volver sin perder lo que llevas.</li>
          <li>⬅️➡️ <b>Navegar entre clientes:</b> flechas <code>‹ ›</code> de la cabecera (o <code>Alt+←</code> / <code>Alt+→</code>) para pasar al anterior/siguiente sin cerrar la ficha.</li>
          <li>📑 <b>Copiar el NIT:</b> ícono de copiar dentro del campo Número.</li>
        </L>
      </>
    ),
  },
  {
    id: "responsables", titulo: "Responsables", icono: "resp",
    texto: "personal interno externo login usuario rol apodo cargo cedula tarjeta profesional eliminar referencias foto formacion acceso superadmin admin usuario inactivar",
    cuerpo: (
      <>
        <P>🧑‍💼 Maestro del <b>personal</b> que interviene en los clientes. Reúne a los <b>internos</b> de la firma (con usuario para entrar a los aplicativos) y a los <b>externos</b> del cliente (contactos sin login, p. ej. su contador o representante).</P>

        <H e="➕">Crear o editar un responsable</H>
        <OL>
          <li>Clic en <b>+ Nuevo responsable</b> (o el lápiz de una fila).</li>
          <li>Datos personales: nombre, cédula, tarjeta profesional, formación académica, cargo, email corporativo, teléfono y foto.</li>
          <li><b>Apodo:</b> las iniciales que se muestran en las grillas (p. ej. "LAR"); la App lo sugiere del nombre, pero puedes cambiarlo.</li>
          <li>Elige <b>Tipo</b> (Interno / Externo) y <b>Guardar</b>.</li>
        </OL>

        <H e="🔑">Acceso al aplicativo (solo internos)</H>
        <P>A un interno se le define un <b>usuario</b> y un <b>rol de acceso</b>, que determina qué secciones ve y qué puede hacer:</P>
        <L>
          <li><b>Super Usuario:</b> todo, incluida la configuración (roles, catálogos, etc.).</li>
          <li><b>Administrador / Usuario:</b> según los permisos de su rol (ver <i>Roles y permisos</i>).</li>
        </L>
        <Nota tipo="tip">Un <b>externo no lleva usuario</b> (es un contacto del cliente). Un <b>interno sin usuario</b> es una inconsistencia: ponle login o márcalo externo.</Nota>

        <H e="🗑️">Eliminar un responsable</H>
        <P>Con el 🗑️ de la fila o el botón del modal. Antes de borrar, la App <b>valida referencias</b>:</P>
        <L>
          <li>Si está <b>asignado a algún cliente</b> (como Responsable/Coordinador de Impuestos o Financiero, Responsable del Registro, Firma Contador o Revisor), <b>no se puede borrar</b>: primero hay que reasignar esos clientes. El aviso dice cuántos y en qué rol.</li>
          <li>Tampoco puedes <b>borrarte a ti mismo</b>.</li>
        </L>
        <Nota tipo="tip">Si un responsable ya no trabaja pero sigue en clientes, lo práctico es <b>reasignar sus clientes</b> (o inactivarlo) antes de eliminarlo.</Nota>
      </>
    ),
  },
  {
    id: "claves", titulo: "Claves", icono: "lock",
    texto: "credenciales portales dian cifrada fernet representante legal copiar exportar mostrar ocultar ver claves refrescar persona natural seguridad revelar",
    cuerpo: (
      <>
        <P>🔐 Todas las <b>credenciales de los clientes en los portales</b> (DIAN, cámara, bancos…), en un solo lugar. Cada clave se guarda <b>cifrada</b>; solo se descifra en memoria al momento de operar y <b>no se muestra "a la vista"</b> sin que la reveles.</P>

        <H e="🛠️">Qué puedes hacer</H>
        <L>
          <li>👁️ <b>Ver una clave</b> (ícono del ojo en la fila) y <b>copiarla</b> al portapapeles.</li>
          <li>👀 <b>Ver Claves / Ocultar Claves:</b> muestra u oculta toda la columna de una vez.</li>
          <li>📗 <b>Exportar a Excel</b> y <b>Refrescar</b> la lista.</li>
          <li>🔍 Buscar y filtrar como en cualquier grilla.</li>
        </L>
        <P>La clave de cada cliente también se edita desde su ficha (pestaña <b>Claves</b>): portal, usuario y clave.</P>

        <Nota tipo="lock"><b>Seguridad:</b> las claves van cifradas con la llave única de la firma; no se imprimen en texto plano ni se envían por fuera. Ver esta pantalla y revelar claves está restringido por permiso (Admin/Super).</Nota>
        <Nota tipo="tip">La clave <b>DIAN</b> es de la <b>persona natural</b>. Las <b>jurídicas</b> entran "a nombre de terceros" con la clave del Representante Legal.</Nota>
      </>
    ),
  },
  {
    id: "catalogos", titulo: "Catálogos", icono: "cat",
    texto: "listas maestras obligaciontipo disparador familia duplicar cargos formas cobro entidades portales municipios ciiu formularios numero codigo calendario revisar dian de todos mantenimiento responsabilidades tipos documento software grupos activa inmutable genera pago formulario de pago plazo fatal consecuencia ineficacia exclusion rst hito recibo",
    cuerpo: (
      <>
        <P>🗃️ Las <b>listas maestras</b> que alimentan los combos y las reglas de toda la App. Se eligen en la columna izquierda y casi todas se editan igual: <b>+</b> para agregar, lápiz para editar, 🗑️ para borrar (si no está en uso).</P>

        <H e="📋">Obligaciones (el catálogo que alimenta el Calendario)</H>
        <P>Define cada obligación de reporte. Campos clave:</P>
        <L>
          <li><b>Código:</b> la llave estable (inmutable una vez creada).</li>
          <li><b>Disparador:</b> qué responsabilidad/condición del RUT la activa (es el motor de aplicabilidad DIAN).</li>
          <li><b>Familia:</b> agrupación para el Calendario (<code>dian / super / municipal / nómina / otras</code>).</li>
          <li><b>Criterio</b>, <b>Tamaño de intervalo</b> y <b>Paso solo-NIT</b>: cómo el Calendario reparte los vencimientos por dígito de NIT.</li>
          <li><b>Genera pago:</b> si al cumplir la obligación hay que <b>pagar</b>, se marca y se habilita el <b>Formulario de pago</b> (del catálogo de Formularios) para enlazar el recibo que corresponde.</li>
          <li><b>Plazo de pago fatal</b> y <b>Consecuencia:</b> plazo extra para pagar y qué pasa si no se paga (p. ej. <i>ineficacia</i> de la retención, <i>exclusión</i> del Régimen Simple). Alimentan el <b>segundo hito</b> (verificar el pago) en el Calendario.</li>
          <li><b>Activa:</b> interruptor universal — una obligación inactiva no se deriva a nadie.</li>
        </L>
        <P>El modal de la obligación organiza estos campos en <b>subsecciones</b> (Identificación, Generación, Pago, Estado); los de pago se ven siempre y se habilitan al marcar <i>Genera pago</i>.</P>
        <L>
          <li>📑 <b>Duplicar:</b> crea una nueva a partir de una existente (abre el modal con los datos ya puestos).</li>
          <li>🔄 <b>Revisar DIAN de todos:</b> mantenimiento en lote — compara el RUT de todos los clientes contra sus obligaciones y permite agregar faltantes / quitar sobrantes.</li>
        </L>
        <Nota>No se puede borrar una obligación con <b>entradas en el Calendario</b> (asignada a clientes, con plazos, cumplimientos o anclas). Si ya no se usa, <b>desactívala</b> en lugar de borrarla.</Nota>

        <H e="📚">Otros catálogos</H>
        <L>
          <li><b>Rol del servicio, Formas de cobro, Software, Cargos, Grupos económicos, Portales, Entidades, Tipos de documento, Responsabilidades (RUT 53), Municipios y CIIU.</b></li>
          <li><b>Formularios</b> (solo Super): los formularios DIAN (Nombre, <b>Número</b>, <b>Código Calendario</b> —enlazado a una obligación del catálogo— y Activo). Habilitan la autorización de "presentar borradores" (ver <i>Roles y permisos</i>) y sirven como <b>Formulario de pago</b> de las obligaciones.</li>
        </L>
      </>
    ),
  },
  {
    id: "facturacion", titulo: "Facturación", icono: "briefcase",
    texto: "generar periodo cobros programados pendiente facturado cuentas de cobro fila libre tipo cobro mandato forma fa cc iva reteiva aprobar historico foto importar cobros validar xml minimizar resumen detalle",
    cuerpo: (
      <>
        <P>🧾 Genera la <b>facturación por período</b> a partir de los <b>cobros programados</b> de cada cliente (período <code>AAAA-MM</code>, con estado facturado/pendiente que define Comercial en la ficha del cliente).</P>

        <H e="▶️">Generar una facturación</H>
        <OL>
          <li>En <i>Facturaciones guardadas</i>, clic en <b>+ Nueva facturación</b> (o <b>Importar cobros</b> desde Excel para cargarlos cruzando por NIT).</li>
          <li>Elige el <b>período</b> (mes/año). La App toma los cobros <b>pendientes</b> de ese período de cada cliente.</li>
          <li>Revisa en <b>Detalle</b> y en <b>Resumen por cliente</b>; ajusta lo que falte.</li>
          <li><b>Guardar</b>. Puedes <b>exportar a Excel</b> y, cuando esté lista, <b>Aprobar</b> (solo Super).</li>
        </OL>

        <H e="➕">Fila libre (cobro puntual)</H>
        <P>Botón <b>+ Agregar → Fila libre</b>: un ítem manual con <b>Concepto</b>, <b>Valor</b>, <b>Tipo cobro</b> (del catálogo de formas de cobro), <b>Forma</b> (<code>Fa</code> factura · <code>CC</code> cuenta de cobro · <b>Ma</b> mandato), IVA/ReteIVA y observaciones.</P>

        <H e="✅">Validar contra lo emitido</H>
        <P>Desde la lista puedes <b>validar</b> una facturación contra las facturas electrónicas emitidas (XML de una carpeta) para cruzar lo facturado con lo realmente emitido.</P>

        <Nota tipo="tip">Cada facturación guarda una <b>foto</b> de los datos del momento: el histórico <b>no cambia</b> aunque luego edites el cliente.</Nota>
        <Nota tipo="tip">El editor se puede <b>minimizar</b> (botón <b>─</b>) para consultar otra pantalla y volver al borrador sin perderlo.</Nota>
      </>
    ),
  },
  {
    id: "cobros", titulo: "Cuentas de cobro", icono: "file",
    texto: "cuentas de cobro cc emisor emisores consecutivo prefijo nota 383 generar en firme pdf revisar enviar correo microsoft deudor nit periodo datos de cobro banco cuenta titular vista previa lote",
    cuerpo: (
      <>
        <P>🧾 Genera las <b>cuentas de cobro</b> (los ítems con forma <code>CC</code>) en <b>PDF</b> y, próximamente, las <b>envía por correo</b> a los clientes. Las CC <b>no pasan</b> por el servicio automático de la DIAN (ese es solo para las facturas), por eso se manejan aquí.</P>

        <H e="🖋️">Emisores (quién firma la cuenta de cobro)</H>
        <P>Cada CC la <b>emite y firma</b> una persona (el <b>emisor</b>), con su propio <b>consecutivo</b>: un <b>prefijo</b> + número (ej. <code>MB-421</code>). Se administran en <b>Catálogos → Emisores</b> (prefijo, último consecutivo usado, nota del art. 383) y se <b>asignan por cliente</b> en la ficha → pestaña <b>Comercial</b> → <i>"Emisor de la cuenta de cobro"</i>.</P>

        <H e="▶️">Paso a paso</H>
        <OL>
          <li>Carga el <b>emisor</b> en Catálogos → Emisores y <b>asígnalo</b> al cliente (ficha → Comercial).</li>
          <li>En <b>Cuentas de cobro</b>, elige el <b>período</b> (mes/año). Verás los ítems <code>CC</code> de la <b>facturación guardada</b> de ese mes.</li>
          <li><b>Generar en firme</b> 📋: asigna el <b>número definitivo</b> y <b>consume</b> el consecutivo del emisor (<i>"Generar todas"</i> lo hace en lote). No se puede deshacer.</li>
          <li><b>Revisar</b> 📄: abre el <b>PDF</b> de la cuenta de cobro (número definitivo si ya está en firme, o <b>vista previa</b> con el siguiente número si aún no).</li>
          <li><b>Enviar por correo</b> ✉️: <i>próximamente</i> — adjuntará el PDF al correo del cliente.</li>
        </OL>

        <Nota tipo="tip">El PDF toma los <b>datos de pago</b> (banco, tipo y N° de cuenta, titular) de <b>Configuración → Datos de cobro</b>, y la <b>nota del art. 383</b> si el emisor la tiene activada.</Nota>
        <Nota tipo="warn">Para que una CC aparezca y se pueda generar, el mes debe tener su <b>facturación guardada</b> (de ahí salen el concepto y el valor) y el cliente debe tener un <b>emisor asignado</b>.</Nota>
      </>
    ),
  },
  {
    id: "consultas", titulo: "Consultas", icono: "search",
    texto: "consultas guardadas ejecutar alcance asignados firma reporte exportar",
    cuerpo: (
      <>
        <P>🔎 Consultas <b>ya armadas</b> y listas para ejecutar. Las crea el Super en <i>Generar Consultas</i> y las comparte por rol; aquí cada quien ejecuta las que tiene disponibles.</P>
        <OL>
          <li>Elige una consulta de la lista.</li>
          <li>Se ejecuta y muestra el resultado en una grilla (que puedes ordenar, filtrar y <b>exportar a Excel</b>).</li>
        </OL>
        <Nota tipo="tip">El <b>alcance</b> de cada consulta define qué filas ves: <b>Solo mis asignados</b> (los clientes a tu cargo) o <b>Toda la firma</b>.</Nota>
      </>
    ),
  },
  {
    id: "generar", titulo: "Generar Consultas", icono: "db",
    texto: "constructor sql tabla base campos filtros alcance guardar roles joins super columnas reporte ejemplos solo lectura",
    cuerpo: (
      <>
        <P>🧰 <b>Constructor de consultas sin escribir SQL</b> (solo Super Usuario). Permite armar <b>reportes reutilizables</b> sobre los datos de la firma y compartirlos con los roles que elijas. Es de <b>solo lectura</b>: nunca modifica ni borra datos.</P>

        <H e="🧱">Paso a paso</H>
        <OL>
          <li>Elige la <b>Tabla base</b> (Clientes, Responsables, …): es el punto de partida de la consulta.</li>
          <li>Marca los <b>Campos a mostrar</b> (las columnas del reporte) y, si quieres, <b>renómbralos</b> para que salgan con un título más claro.</li>
          <li>Agrega <b>Filtros</b> con <b>+ Agregar filtro</b>: condiciones del tipo "Régimen = Simple", "Estado = Activo", "Municipio ICA = Barranquilla"… Puedes combinar varias.</li>
          <li>Define el <b>Alcance de las filas</b>: <b>Solo asignados</b> (cada quien ve sus clientes) o <b>Toda la firma</b>.</li>
          <li><b>Guardar</b> con un <b>nombre</b> y una <b>descripción</b>, y marca los <b>Roles que pueden verla</b>. Desde ahí aparece en <i>Consultas</i> para esa gente, lista para ejecutar.</li>
        </OL>

        <H e="🔎">Ejemplos de uso</H>
        <L>
          <li>Clientes de <b>Régimen Simple</b> con su responsable de impuestos.</li>
          <li>Clientes marcados <b>"por revisar"</b> (RUT desalineado con sus obligaciones).</li>
          <li>Responsables <b>internos</b> por cargo, o clientes <b>sin clave DIAN</b> cargada.</li>
          <li>Clientes activos por <b>municipio ICA</b> o por <b>grupo económico</b>.</li>
        </L>

        <Nota tipo="tip">Cada quien ve la consulta según su <b>alcance</b> y rol: así compartes un mismo reporte y cada persona ve solo lo que le corresponde, sin dar acceso a toda la base.</Nota>
        <Nota tipo="ok">Como es <b>solo lectura</b>, puedes experimentar sin miedo: probar campos y filtros no cambia ni borra nada.</Nota>
      </>
    ),
  },
  {
    id: "roles", titulo: "Roles y permisos", icono: "shield-check",
    texto: "rbac acceso rol permisos seccion accion matriz tri-estado presentar borradores formularios autorizar enforcement super admin usuario",
    cuerpo: (
      <>
        <P>🛡️ Controla <b>quién puede ver y hacer qué</b> en la App. Solo Super Usuario. Tiene dos vistas (pestañas arriba).</P>

        <H e="🔐">Permisos por rol</H>
        <P>Matriz de <b>roles × permisos</b> (por sección: ver / crear / editar / eliminar). Cada casilla se marca o desmarca.</P>
        <OL>
          <li>Crea o selecciona un <b>rol</b>.</li>
          <li>Marca los permisos que tendrá.</li>
          <li><b>Guardar cambios.</b> El control es real en el servidor: aunque alguien llegue a una pantalla, sin permiso no puede ejecutar la acción.</li>
        </OL>
        <P>El rol de cada persona se asigna en su ficha de <i>Responsables</i> (Acceso al aplicativo).</P>

        <H e="📝">Presentar borradores</H>
        <P>Matriz de <b>usuarios × formularios</b>: define <b>quién puede presentar borradores</b> de cada formulario DIAN. Es <b>dinámica</b> — al agregar un formulario nuevo al catálogo, aparece solo en esta matriz.</P>
        <Nota>Aquí Maestros solo <b>autoriza</b> (quién puede presentar qué). El <b>flujo de presentación</b> lo tiene cada aplicativo (p. ej. el Liquidador 350 consulta esta autorización antes de dejar presentar). El <b>Super siempre puede</b>; los demás necesitan su casilla marcada.</Nota>
      </>
    ),
  },
  {
    id: "obligaciones", titulo: "Obligaciones y Calendario", icono: "calendar",
    texto: "reparto calendario fechas vencimientos digito nit festivos aplicabilidad disparador cerebro cumplimiento derivada manual por revisar fuente unica reconciliacion genera pago segundo hito verificar pago recibo 490 formulario de pago como se forma generar calendarios año plazos fecha inicio por regla importar plantilla leer oficial excel dane municipio flag sin plazos publicar cruce mes año carga semaforo",
    cuerpo: (
      <>
        <P>📅 Explica de dónde salen las obligaciones y las fechas, para entender por qué Maestros y el Calendario trabajan juntos sin duplicarse.</P>

        <H e="🔗">El reparto</H>
        <L>
          <li>🧠 <b>Maestros = el cerebro (QUÉ y QUIÉN):</b> es dueño del <b>catálogo</b> de obligaciones y de la <b>asignación por cliente</b> (las derivadas del RUT + las manuales, en una sola lista).</li>
          <li>🗓️ <b>Calendario = el cuándo (CÓMO VA):</b> calcula <b>vencimientos</b> por dígito de NIT, maneja festivos y registra <b>cumplimiento</b>. Lee de Maestros; no decide quién tiene qué.</li>
        </L>

        <H e="🎯">Aplicabilidad (quién tiene cada obligación)</H>
        <P>La decide Maestros con el <b>disparador</b> de cada obligación del catálogo, evaluado contra las <b>responsabilidades del RUT (casilla 53)</b>, el tipo de contribuyente, gran contribuyente y periodicidad de IVA.</P>
        <Nota tipo="tip">La reconciliación es <b>manual</b> (no cambia sola al guardar): usa <b>Revisar obligaciones</b> en el cliente, o <b>Revisar DIAN de todos</b> en Catálogos. El chip <b>«por revisar»</b> avisa cuando el RUT dejó de coincidir.</Nota>

        <H e="🗓️">Cómo se forma el calendario (de la obligación a la fecha)</H>
        <P>Ojo con el reparto: la <b>asignación</b> (Maestros) define <b>a qué clientes</b> aplica la obligación; las <b>fechas</b> salen de la <b>tabla de plazos del Calendario</b> y <b>no se generan solas</b>. El "por dígito de NIT" no es generación automática: es cómo el motor <b>distribuye</b> las fechas dentro de un plazo <b>ya cargado</b>.</P>
        <OL>
          <li><b>En Maestros:</b> crea la obligación en el Catálogo y <b>asígnala</b> a los clientes (<i>Revisar obligaciones</i> / <i>Revisar DIAN de todos</i>).</li>
          <li><b>En el Calendario → «Generar Calendarios»:</b> elige el <b>año</b> y <b>carga las fechas del año</b> por una de tres vías (se usa una):
            <L>
              <li><b>Por regla:</b> marca la obligación, escribe su <b>Fecha Inicio</b> (el ancla del 1.er período) y <b>Generar</b>; el motor proyecta el resto contando días hábiles con los festivos. Para DIAN, si ya existe el año anterior, te <b>sugiere</b> las fechas.</li>
              <li><b>Importar plantilla:</b> sube el Excel estándar de plazos.</li>
              <li><b>Leer oficial:</b> sube el Excel oficial (DIAN / alcaldía) y <b>mapea</b> cada plazo a su obligación.</li>
            </L>
          </li>
          <li><b>Listo.</b> No hay botón de «publicar»: el Calendario <b>cruza clientes × asignación × plazos</b> en cada lectura. Al entrar a <b>Mes / Año / Carga</b> de ese año, la obligación ya aparece con su fecha, su responsable y el semáforo.</li>
        </OL>
        <Nota tipo="warn">Si una obligación nueva sale <b>«sin plazos»</b> o no aparece, falta <b>cargar sus plazos del año</b> en el Calendario (paso 2). En las <b>municipales</b> (ICA / ReteICA / Autorretención), además, el plazo lleva el <b>código DANE</b> del municipio y el cliente debe tener ese municipio con el <b>flag marcado</b>.</Nota>

        <Nota>Como el Calendario ya registra trabajo (cumplimientos/revisiones), <b>no se puede quitar una obligación que tenga esas entradas</b>; primero se desactiva o se limpian sus registros.</Nota>
        <Nota tipo="tip">Cuando una obligación <b>genera pago</b> (se marca en su catálogo, con su <i>formulario de pago</i>), el Calendario suma un <b>segundo hito</b> para <b>verificar el pago</b> con el recibo (490), además de la presentación.</Nota>
      </>
    ),
  },
  {
    id: "glosario", titulo: "Glosario de conceptos", icono: "files",
    texto: "rut casilla 53 disparador familia derivada manual por revisar interno externo regimen simple 47 dv cumplimiento plazo definiciones terminos fernet mandato fa cc",
    cuerpo: (
      <>
        <P>📖 Términos que aparecen por toda la App:</P>
        <L>
          <li><b>RUT · casilla 53 (responsabilidades):</b> el conjunto de responsabilidades tributarias del contribuyente; de ahí la App deriva régimen, periodicidad de IVA y qué obligaciones aplican.</li>
          <li><b>DV (dígito de verificación):</b> el número después del guion en el NIT; la App lo calcula solo.</li>
          <li><b>Régimen Simple (47):</b> si el RUT tiene la responsabilidad 47, el cliente es de Régimen Simple; si no, Ordinario.</li>
          <li><b>Disparador:</b> la condición del RUT (una responsabilidad, el tipo, etc.) que activa una obligación del catálogo.</li>
          <li><b>Familia:</b> agrupación de la obligación para el Calendario (<code>dian / super / municipal / nómina / otras</code>).</li>
          <li><b>Derivada vs manual:</b> <i>derivada</i> = la propone el motor según el RUT; <i>manual</i> = la agregó una persona a propósito (el motor nunca la toca).</li>
          <li><b>Por revisar:</b> el RUT del cliente dejó de coincidir con sus obligaciones; hay que revisarlas.</li>
          <li><b>Cumplimiento (Calendario):</b> registro de que una obligación de un período se presentó / no aplica / está en revisión. Es "trabajo" que impide borrar la obligación.</li>
          <li><b>Interno / externo (responsable):</b> con login (personal de la firma) vs sin login (contacto del cliente).</li>
          <li><b>Fa / CC / Ma (facturación):</b> Factura / Cuenta de cobro / Mandato.</li>
        </L>
      </>
    ),
  },
  {
    id: "actualizar", titulo: "Actualizar la app y servidor", icono: "gear",
    texto: "servidor de datos ip puerto instalador actualizar conexion base compartida clave cifrada sin conexion configuracion probar reconectar",
    cuerpo: (
      <>
        <H e="🌐">Servidor de datos</H>
        <P>La App se conecta a la <b>base compartida</b> de la firma. Si el servidor cambia de dirección (IP/host o puerto), se ajusta en <b>Configuración → Servidor de datos</b>: escribe la dirección, <b>Prueba la conexión</b> y guarda para reconectar.</P>
        <Nota tipo="tip">Si al abrir la App <b>no hay conexión</b>, aparece sola la pantalla de servidor para corregir la dirección antes de entrar. Esto solo cambia <b>a qué servidor</b> apunta este equipo; no toca las credenciales de la base.</Nota>

        <H e="⬆️">Actualizar la App</H>
        <P>La App se instala <b>por equipo</b>. Para actualizarla se usa el <b>instalador/actualizador</b> de la firma (lo coordina sistemas). El servidor levanta el backend solo al iniciar sesión, y el acceso directo abre la ventana.</P>

        <Nota tipo="lock">La <b>clave del portal</b> de cada cliente va <b>cifrada</b> con la llave única de la firma; nunca se comparte en texto plano.</Nota>
      </>
    ),
  },
];

/* ------------------------------ Componente -------------------------------- */
export function ManualUsuario() {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string>("intro");
  const [ver, setVer] = useState("");

  useEffect(() => {
    api.get("/health").then((h: any) => setVer(h?.version || "")).catch(() => {});
  }, []);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return !s ? SECCIONES : SECCIONES.filter((x) => (x.titulo + " " + x.texto).toLowerCase().includes(s));
  }, [q]);
  const activa = visibles.find((x) => x.id === sel) || visibles[0] || null;

  return (
    <div className="card man">
      <div className="card-h">
        <Icon name="file" size={18} />
        <div><h3>Manual de usuario</h3><div className="hint">Cómo usar la App · Cardona &amp; co.</div></div>
      </div>
      <div className="man-body">
        <aside className="man-idx">
          <div className="man-search">
            <Icon name="search" size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el manual…" />
          </div>
          <nav>
            {visibles.map((x) => (
              <button key={x.id} className={"man-item" + (activa?.id === x.id ? " on" : "")} onClick={() => setSel(x.id)}>
                <Icon name={x.icono} size={16} /><span>{x.titulo}</span>
              </button>
            ))}
            {visibles.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "8px 10px" }}>Sin coincidencias.</div>}
          </nav>
        </aside>
        <section className="man-content">
          {activa && (
            <>
              <h3 style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ color: "#f7931e", display: "inline-flex" }}><Icon name={activa.icono} size={20} /></span>{activa.titulo}
              </h3>
              {activa.cuerpo}
              {ver && <div className="man-ver">Maestros CyC · versión {ver}</div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
