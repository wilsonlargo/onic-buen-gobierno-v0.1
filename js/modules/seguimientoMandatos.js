import { requireSupabase } from "../supabaseClient.js";
import { setAuditContext, openAuditPanel } from "./auditoria.js";
import { isConsejeriaUser } from "../security.js";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value = "") {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(2).replace(".", ",")} %`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function option(value, label, selected = false) {
  return `<option value="${escapeHTML(value)}" ${selected ? "selected" : ""}>${escapeHTML(label)}</option>`;
}

function equalWeights(items = []) {
  const map = new Map();
  if (!items.length) return map;
  const totalUnits = 10000;
  const base = Math.floor(totalUnits / items.length);
  const remainder = totalUnits - base * items.length;
  items.forEach((item, index) => map.set(item.id, (base + (index < remainder ? 1 : 0)) / 100));
  return map;
}

function indicatorProgress(indicator) {
  if (!indicator || indicator.estado !== "activo") return null;
  const base = Number(indicator.linea_base);
  const meta = Number(indicator.meta);
  const current = Number(indicator.valor_actual);
  if (![base, meta, current].every(Number.isFinite)) return null;

  let numerator;
  let denominator;
  if (indicator.sentido === "descendente") {
    numerator = base - current;
    denominator = base - meta;
  } else {
    numerator = current - base;
    denominator = meta - base;
  }

  if (Math.abs(denominator) < 1e-12) return null;
  return clamp((numerator / denominator) * 100);
}

function activityProgress(indicators = []) {
  const active = indicators.filter((indicator) => indicator.estado === "activo");
  if (!active.length) return null;
  const values = active.map(indicatorProgress);
  if (values.some((value) => value === null)) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function getRowsIn(table, field, ids, columns = "*") {
  if (!ids.length) return [];
  const supabase = requireSupabase();
  const unique = [...new Set(ids.filter(Boolean))];
  const chunks = [];
  for (let index = 0; index < unique.length; index += 400) {
    chunks.push(unique.slice(index, index + 400));
  }
  const results = await Promise.all(chunks.map(async (chunk) => {
    const { data, error } = await supabase.from(table).select(columns).in(field, chunk);
    if (error) throw error;
    return data || [];
  }));
  return results.flat();
}

async function getVigencias() {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("vigencias")
    .select("id,nombre,estado,fecha_inicio,fecha_fin")
    .order("fecha_inicio", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadMandateTrackingData(vigenciaId) {
  const supabase = requireSupabase();

  const [mandatesResult, vcResult] = await Promise.all([
    supabase
      .from("mandatos")
      .select("id,vigencia_id,fuente_id,codigo,titulo,texto,observaciones,estado,orden,fuentes_mandatos(id,nombre,descripcion)")
      .eq("vigencia_id", vigenciaId)
      .order("orden", { ascending: true }),
    supabase
      .from("vigencia_consejerias")
      .select("id,vigencia_id,consejeria_id,estado,consejerias(id,nombre_corto,nombre_largo)")
      .eq("vigencia_id", vigenciaId)
  ]);

  if (mandatesResult.error) throw mandatesResult.error;
  if (vcResult.error) throw vcResult.error;

  const mandatos = mandatesResult.data || [];
  const consejerias = vcResult.data || [];
  const mandateIds = mandatos.map((row) => row.id);

  const [mandatoConsejerias, projectLinks] = await Promise.all([
    getRowsIn("mandato_consejerias", "mandato_id", mandateIds, "id,mandato_id,vigencia_consejeria_id"),
    getRowsIn("proyecto_mandatos", "mandato_id", mandateIds, "id,mandato_id,proyecto_id")
  ]);

  const projectIds = [...new Set(projectLinks.map((row) => row.proyecto_id))];
  const proyectos = await getRowsIn(
    "proyectos",
    "id",
    projectIds,
    "id,programa_id,codigo,nombre,nombre_corto,estado,ponderacion,fecha_inicio,fecha_fin,orden"
  );

  const programIds = [...new Set(proyectos.map((row) => row.programa_id))];
  const programas = await getRowsIn(
    "programas",
    "id",
    programIds,
    "id,linea_accion_id,nombre,nombre_corto,estado,orden"
  );

  const lineIds = [...new Set(programas.map((row) => row.linea_accion_id))];
  const lineas = await getRowsIn(
    "lineas_accion",
    "id",
    lineIds,
    "id,vigencia_consejeria_id,nombre,nombre_corto,estado,orden"
  );

  const visibleProjectIds = proyectos.map((row) => row.id);
  const actividades = await getRowsIn(
    "actividades",
    "proyecto_id",
    visibleProjectIds,
    "id,proyecto_id,codigo,nombre,estado,orden"
  );

  const activityIds = actividades.map((row) => row.id);
  const indicadores = await getRowsIn(
    "indicadores_actividad",
    "actividad_id",
    activityIds,
    "id,actividad_id,linea_base,meta,valor_actual,sentido,estado,orden"
  );

  return {
    mandatos,
    consejerias,
    mandatoConsejerias,
    projectLinks,
    proyectos,
    programas,
    lineas,
    actividades,
    indicadores
  };
}

function consejeriaName(vc) {
  return vc?.consejerias?.nombre_corto || vc?.consejerias?.nombre_largo || "Consejería";
}

function buildTracking(data, { selectedVcId = "" } = {}) {
  const vcById = new Map(data.consejerias.map((row) => [row.id, row]));
  const lineById = new Map(data.lineas.map((row) => [row.id, row]));
  const programById = new Map(data.programas.map((row) => [row.id, row]));
  const projectById = new Map(data.proyectos.map((row) => [row.id, row]));

  const indicatorsByActivity = new Map();
  data.indicadores.forEach((indicator) => {
    if (!indicatorsByActivity.has(indicator.actividad_id)) indicatorsByActivity.set(indicator.actividad_id, []);
    indicatorsByActivity.get(indicator.actividad_id).push(indicator);
  });

  const activitiesByProject = new Map();
  data.actividades
    .filter((activity) => activity.estado !== "cancelada")
    .forEach((activity) => {
      if (!activitiesByProject.has(activity.proyecto_id)) activitiesByProject.set(activity.proyecto_id, []);
      activitiesByProject.get(activity.proyecto_id).push(activity);
    });

  const projectMetrics = new Map();
  data.proyectos.forEach((project) => {
    const program = programById.get(project.programa_id);
    const line = program ? lineById.get(program.linea_accion_id) : null;
    const vc = line ? vcById.get(line.vigencia_consejeria_id) : null;
    const inCalculation = Boolean(
      vc && vc.estado === "activa" &&
      line && line.estado === "activa" &&
      program && program.estado === "activo"
    );

    const projectActivities = activitiesByProject.get(project.id) || [];
    const weights = equalWeights(projectActivities);
    let progress = 0;
    let coverage = 0;

    projectActivities.forEach((activity) => {
      const value = activityProgress(indicatorsByActivity.get(activity.id) || []);
      const weight = Number(weights.get(activity.id) || 0);
      if (value !== null) {
        progress += (value * weight) / 100;
        coverage += weight;
      }
    });

    projectMetrics.set(project.id, {
      project,
      program,
      line,
      vc,
      inCalculation,
      progress: projectActivities.length ? clamp(progress) : 0,
      coverage: projectActivities.length ? clamp(coverage) : 0,
      activityCount: projectActivities.length
    });
  });

  const councilsByMandate = new Map();
  data.mandatoConsejerias.forEach((link) => {
    if (!councilsByMandate.has(link.mandato_id)) councilsByMandate.set(link.mandato_id, []);
    const vc = vcById.get(link.vigencia_consejeria_id);
    if (vc) councilsByMandate.get(link.mandato_id).push(vc);
  });

  const linksByMandate = new Map();
  data.projectLinks.forEach((link) => {
    if (!projectById.has(link.proyecto_id)) return;
    if (!linksByMandate.has(link.mandato_id)) linksByMandate.set(link.mandato_id, []);
    linksByMandate.get(link.mandato_id).push(link);
  });

  return data.mandatos.map((mandate) => {
    let councils = councilsByMandate.get(mandate.id) || [];
    let links = linksByMandate.get(mandate.id) || [];
    let projectRows = links
      .map((link) => projectMetrics.get(link.proyecto_id))
      .filter(Boolean);

    if (selectedVcId) {
      councils = councils.filter((vc) => vc.id === selectedVcId);
      projectRows = projectRows.filter((metric) => metric.vc?.id === selectedVcId);
    }

    const projectsInCalculation = projectRows.filter((metric) => metric.inCalculation);
    const progress = projectsInCalculation.length
      ? projectsInCalculation.reduce((sum, metric) => sum + metric.progress, 0) / projectsInCalculation.length
      : null;
    const coverage = projectsInCalculation.length
      ? projectsInCalculation.reduce((sum, metric) => sum + metric.coverage, 0) / projectsInCalculation.length
      : null;

    const projectCouncilIds = new Set(projectRows.map((metric) => metric.vc?.id).filter(Boolean));

    return {
      mandate,
      councils,
      projects: projectRows,
      projectsInCalculation,
      projectCouncilCount: projectCouncilIds.size,
      progress,
      coverage
    };
  });
}

function mandateState(item) {
  if (!item.projects.length) {
    return {
      key: "no-projects",
      label: "Sin proyectos",
      detail: "Todavía no tiene Proyectos vinculados dentro del ámbito consultado."
    };
  }
  if (!item.projectsInCalculation.length) {
    return {
      key: "outside",
      label: "Fuera del cálculo",
      detail: "Los Proyectos vinculados no participan actualmente en el cálculo activo del Plan."
    };
  }
  if (item.coverage === null || Number(item.coverage) <= 0) {
    return {
      key: "no-measurement",
      label: "Sin medición",
      detail: "Los Proyectos vinculados todavía no acreditan medición técnica."
    };
  }
  if (Number(item.coverage) < 99.995) {
    return {
      key: "partial",
      label: "Medición parcial",
      detail: "Parte de los Proyectos vinculados todavía no cuenta con medición completa."
    };
  }
  const progress = Number(item.progress || 0);
  if (progress < 40) return { key: "low", label: "Avance bajo", detail: "Avance asociado inferior al 40 %." };
  if (progress < 70) return { key: "process", label: "En proceso", detail: "Avance asociado entre 40 % y 69,99 %." };
  if (progress < 90) return { key: "good", label: "Avance favorable", detail: "Avance asociado entre 70 % y 89,99 %." };
  return { key: "high", label: "Avance alto", detail: "Avance asociado igual o superior al 90 %." };
}

function projectState(metric) {
  if (!metric.inCalculation) return { label: "Fuera del cálculo", className: "closed" };
  if (metric.coverage <= 0) return { label: "Sin medición", className: "warning" };
  if (metric.coverage < 99.995) return { label: "Medición parcial", className: "warning" };
  if (metric.progress >= 90) return { label: "Avance alto", className: "active" };
  if (metric.progress >= 70) return { label: "Avance favorable", className: "active" };
  if (metric.progress >= 40) return { label: "En proceso", className: "attention" };
  return { label: "Avance bajo", className: "danger" };
}

function projectLocation(metric) {
  return [
    consejeriaName(metric.vc),
    metric.line?.nombre,
    metric.program?.nombre
  ].filter(Boolean).join(" › ");
}

function projectCard(metric) {
  const state = projectState(metric);
  return `
    <article class="mandate-project-row">
      <div class="mandate-project-main">
        <div class="mandate-project-title">
          <span class="mandate-project-code">${escapeHTML(metric.project.codigo || "Proyecto")}</span>
          <strong>${escapeHTML(metric.project.nombre)}</strong>
        </div>
        <small>${escapeHTML(projectLocation(metric))}</small>
      </div>
      <div class="mandate-project-metric">
        <span>Avance técnico</span>
        <strong>${metric.inCalculation ? formatPct(metric.progress) : "—"}</strong>
      </div>
      <div class="mandate-project-metric">
        <span>Cobertura</span>
        <strong>${metric.inCalculation ? formatPct(metric.coverage) : "—"}</strong>
      </div>
      <div class="mandate-project-state">
        <span class="status-chip ${state.className}">${escapeHTML(state.label)}</span>
      </div>
      <div class="mandate-project-action">
        <button class="text-button open-linked-project" type="button" data-project-id="${metric.project.id}">Abrir Proyecto →</button>
      </div>
    </article>
  `;
}

function mandateCard(item, isOpen = false) {
  const mandate = item.mandate;
  const state = mandateState(item);
  const source = mandate.fuentes_mandatos?.nombre || "Sin fuente registrada";
  const councilNames = [...new Set(item.councils.map(consejeriaName))];
  const progressWidth = item.progress === null ? 0 : clamp(item.progress);
  const coverageWidth = item.coverage === null ? 0 : clamp(item.coverage);

  return `
    <article class="mandate-tracking-card ${isOpen ? "is-open" : ""}" data-mandate-id="${mandate.id}">
      <header class="mandate-tracking-header">
        <div class="mandate-tracking-identity">
          <div class="mandate-tracking-code-row">
            <span class="mandate-code-pill">${escapeHTML(mandate.codigo || "Mandato")}</span>
            <span class="status-chip ${mandate.estado === "activo" ? "active" : mandate.estado === "archivado" ? "archived" : "closed"}">${escapeHTML(mandate.estado === "activo" ? "Activo" : mandate.estado === "archivado" ? "Archivado" : "Inactivo")}</span>
            <span class="mandate-follow-state ${state.key}">${escapeHTML(state.label)}</span>
          </div>
          <h3>${escapeHTML(mandate.titulo || mandate.texto || "Mandato")}</h3>
          <p>${escapeHTML(source)}</p>
        </div>
        <div class="mandate-tracking-actions">
          <button class="btn btn-secondary mandate-audit-note" type="button" data-mandate-id="${mandate.id}">Nota</button>
          <button class="btn btn-secondary toggle-mandate-detail" type="button" data-mandate-id="${mandate.id}">${isOpen ? "Ocultar detalle" : "Ver detalle"}</button>
        </div>
      </header>

      <div class="mandate-tracking-metrics">
        <div>
          <span>Proyectos relacionados</span>
          <strong>${formatInteger(item.projects.length)}</strong>
          <small>${formatInteger(item.projectsInCalculation.length)} en cálculo activo</small>
        </div>
        <div>
          <span>Consejerías vinculadas</span>
          <strong>${formatInteger(councilNames.length)}</strong>
          <small>${formatInteger(item.projectCouncilCount)} con Proyectos</small>
        </div>
        <div>
          <span>Avance asociado</span>
          <strong>${formatPct(item.progress)}</strong>
          <div class="mandate-mini-bar" aria-hidden="true"><i style="width:${progressWidth}%"></i></div>
        </div>
        <div>
          <span>Cobertura de medición</span>
          <strong>${formatPct(item.coverage)}</strong>
          <div class="mandate-mini-bar coverage" aria-hidden="true"><i style="width:${coverageWidth}%"></i></div>
        </div>
      </div>

      <p class="mandate-state-detail">${escapeHTML(state.detail)}</p>

      <section class="mandate-tracking-detail ${isOpen ? "" : "hidden"}" data-detail-for="${mandate.id}">
        <div class="mandate-detail-grid">
          <div>
            <span>Texto del Mandato</span>
            <p>${escapeHTML(mandate.texto || "—")}</p>
          </div>
          <div>
            <span>Consejerías vinculadas</span>
            <p>${councilNames.length ? councilNames.map((name) => `<span class="mandate-council-chip">${escapeHTML(name)}</span>`).join(" ") : "—"}</p>
          </div>
        </div>

        <div class="mandate-projects-heading">
          <div>
            <span>Proyectos vinculados</span>
            <strong>${item.projects.length}</strong>
          </div>
          <small>El avance del Mandato se presenta como una lectura asociada a estos Proyectos.</small>
        </div>

        <div class="mandate-project-list">
          ${item.projects.length
            ? item.projects.map(projectCard).join("")
            : `<div class="empty-inline">Este Mandato todavía no tiene Proyectos vinculados dentro del ámbito seleccionado.</div>`}
        </div>
      </section>
    </article>
  `;
}

function summaryHTML(items) {
  const withProjects = items.filter((item) => item.projects.length > 0);
  const withoutProjects = items.length - withProjects.length;
  const measurable = withProjects.filter((item) => item.projectsInCalculation.length > 0);
  const completeCoverage = measurable.filter((item) => Number(item.coverage) >= 99.995).length;
  const averageProgress = measurable.length
    ? measurable.reduce((sum, item) => sum + Number(item.progress || 0), 0) / measurable.length
    : null;
  const averageCoverage = measurable.length
    ? measurable.reduce((sum, item) => sum + Number(item.coverage || 0), 0) / measurable.length
    : null;

  return `
    <div class="mandate-follow-summary-grid">
      <article class="metric-card">
        <small>Mandatos consultados</small>
        <strong>${items.length}</strong>
        <span>En el ámbito seleccionado</span>
      </article>
      <article class="metric-card">
        <small>Con Proyectos vinculados</small>
        <strong>${withProjects.length}</strong>
        <span>${withoutProjects ? `${withoutProjects} sin Proyecto asociado` : "Todos cuentan con relación operativa"}</span>
      </article>
      <article class="metric-card">
        <small>Avance asociado promedio</small>
        <strong>${formatPct(averageProgress)}</strong>
        <span>Promedio de Mandatos con Proyectos en cálculo</span>
      </article>
      <article class="metric-card">
        <small>Cobertura promedio</small>
        <strong>${formatPct(averageCoverage)}</strong>
        <span>${completeCoverage} con cobertura completa</span>
      </article>
    </div>
  `;
}

export async function renderSeguimientoMandatos(container, navigationTarget = null) {
  let vigencias = [];
  let selectedVigenciaId = navigationTarget?.vigencia_id || "";
  let selectedVcId = navigationTarget?.vigencia_consejeria_id || "";
  let rawData = null;
  let tracking = [];
  let openMandateId = navigationTarget?.mandato_id || "";
  let searchValue = "";
  let statusFilter = "activos";

  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Lectura estratégica</p>
        <h2>Seguimiento de Mandatos</h2>
      </div>
      <div class="page-action-group">
        <button id="refreshMandateTracking" class="btn btn-secondary" type="button">Actualizar</button>
      </div>
    </div>

    <section class="panel mandate-follow-intro" style="margin-top:0">
      <div>
        <p class="eyebrow">¿Qué muestra esta sección?</p>
        <h2>Mandatos y Proyectos que contribuyen a su atención</h2>
        <p>
          El avance asociado se calcula a partir del avance técnico de los Proyectos vinculados a cada Mandato.
          Esta lectura facilita el seguimiento del Plan, pero <strong>no equivale por sí sola al cumplimiento integral del Mandato</strong>.
        </p>
        <p>
          Cuando un Mandato tiene Proyectos ubicados en Programas diferentes, cada Proyecto participa de forma equivalente en esta lectura.
          De esta manera no se mezclan ponderaciones que solo son comparables dentro de un mismo Programa.
        </p>
      </div>
    </section>

    <section class="panel mandate-follow-filters">
      <div class="mandate-follow-filter-grid">
        <div class="form-field">
          <label for="mandateTrackingVigencia">Vigencia</label>
          <select id="mandateTrackingVigencia"></select>
        </div>
        <div class="form-field">
          <label for="mandateTrackingConsejeria">Consejería</label>
          <select id="mandateTrackingConsejeria" disabled>
            <option value="">Todas las Consejerías</option>
          </select>
        </div>
        <div class="form-field">
          <label for="mandateTrackingStatus">Estado del Mandato</label>
          <select id="mandateTrackingStatus">
            <option value="activos">Activos</option>
            <option value="todos">Todos</option>
            <option value="con_proyectos">Con Proyectos</option>
            <option value="sin_proyectos">Sin Proyectos</option>
            <option value="medicion_parcial">Medición parcial</option>
            <option value="sin_medicion">Sin medición</option>
          </select>
        </div>
        <div class="form-field">
          <label for="mandateTrackingSearch">Buscar</label>
          <input id="mandateTrackingSearch" type="search" placeholder="Código, título, texto, fuente…">
        </div>
      </div>
    </section>

    <section id="mandateTrackingSummary"></section>

    <section class="panel mandate-follow-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Mandatos de la Vigencia</p>
          <h2 id="mandateTrackingTitle">Seguimiento</h2>
        </div>
        <span id="mandateTrackingCount" class="status-chip">0</span>
      </div>
      <div id="mandateTrackingContent" style="margin-top:18px">
        <div class="empty-state">Cargando Mandatos…</div>
      </div>
    </section>
  `;

  const vigenciaSelector = container.querySelector("#mandateTrackingVigencia");
  const vcSelector = container.querySelector("#mandateTrackingConsejeria");
  const statusSelector = container.querySelector("#mandateTrackingStatus");
  const searchInput = container.querySelector("#mandateTrackingSearch");
  const refreshButton = container.querySelector("#refreshMandateTracking");
  const summaryHost = container.querySelector("#mandateTrackingSummary");
  const contentHost = container.querySelector("#mandateTrackingContent");
  const countHost = container.querySelector("#mandateTrackingCount");
  const titleHost = container.querySelector("#mandateTrackingTitle");

  function currentVigencia() {
    return vigencias.find((row) => row.id === selectedVigenciaId);
  }

  function currentConsejeria() {
    return rawData?.consejerias?.find((row) => row.id === selectedVcId) || null;
  }

  function setContext() {
    const vigencia = currentVigencia();
    const vc = currentConsejeria();
    if (!vigencia) return;
    setAuditContext({
      vigenciaId: vigencia.id,
      vigenciaNombre: vigencia.nombre,
      entidadTipo: vc ? "consejeria" : "vigencia",
      entidadId: vc?.id || vigencia.id,
      entidadNombre: vc ? consejeriaName(vc) : vigencia.nombre,
      seccion: "seguimiento_mandatos",
      ruta: vc
        ? `${vigencia.nombre} › ${consejeriaName(vc)} › Seguimiento de Mandatos`
        : `${vigencia.nombre} › Seguimiento de Mandatos`,
      navigation: {
        view: "seguimiento_mandatos",
        vigencia_id: vigencia.id,
        vigencia_consejeria_id: vc?.id || null
      },
      sectionOptions: [
        {
          value: "seguimiento_mandatos",
          label: "Seguimiento de Mandatos",
          navigation: { view: "seguimiento_mandatos", vigencia_id: vigencia.id, vigencia_consejeria_id: vc?.id || null }
        }
      ]
    });
  }

  function visibleItems() {
    const query = normalizeText(searchValue);
    return tracking.filter((item) => {
      const state = mandateState(item);
      const mandate = item.mandate;

      if (selectedVcId && !item.councils.length && !item.projects.length) return false;
      if (statusFilter === "activos" && mandate.estado !== "activo") return false;
      if (statusFilter === "con_proyectos" && !item.projects.length) return false;
      if (statusFilter === "sin_proyectos" && item.projects.length) return false;
      if (statusFilter === "medicion_parcial" && state.key !== "partial") return false;
      if (statusFilter === "sin_medicion" && !["no-measurement", "outside"].includes(state.key)) return false;

      if (!query) return true;
      return normalizeText([
        mandate.codigo,
        mandate.titulo,
        mandate.texto,
        mandate.observaciones,
        mandate.fuentes_mandatos?.nombre,
        ...item.councils.map(consejeriaName),
        ...item.projects.map((metric) => metric.project.nombre),
        ...item.projects.map((metric) => metric.project.codigo)
      ].join(" ")).includes(query);
    });
  }

  function renderFilters() {
    const vigencia = currentVigencia();
    vigenciaSelector.innerHTML = vigencias.length
      ? vigencias.map((row) => option(row.id, `${row.nombre}${row.estado === "activa" ? " · activa" : ""}`, row.id === selectedVigenciaId)).join("")
      : `<option value="">No hay Vigencias</option>`;
    vigenciaSelector.value = selectedVigenciaId;

    const councils = rawData?.consejerias || [];
    vcSelector.disabled = !selectedVigenciaId || !councils.length;
    vcSelector.innerHTML = `
      <option value="">Todas las Consejerías${isConsejeriaUser() ? " autorizadas" : ""}</option>
      ${councils.map((row) => option(row.id, `${consejeriaName(row)}${row.estado !== "activa" ? " · inactiva" : ""}`, row.id === selectedVcId)).join("")}
    `;
    if (selectedVcId && councils.some((row) => row.id === selectedVcId)) vcSelector.value = selectedVcId;
    else {
      selectedVcId = "";
      vcSelector.value = "";
    }

    statusSelector.value = statusFilter;
    searchInput.value = searchValue;
    titleHost.textContent = vigencia
      ? `Seguimiento · ${vcSelector.value ? consejeriaName(currentConsejeria()) : vigencia.nombre}`
      : "Seguimiento";
  }

  function bindProjectButtons() {
    contentHost.querySelectorAll(".open-linked-project").forEach((button) => {
      button.addEventListener("click", () => {
        const projectId = button.dataset.projectId;
        const metric = [...tracking.flatMap((item) => item.projects)].find((row) => row.project.id === projectId);
        if (!metric?.vc || !metric?.line || !metric?.program) return;
        window.dispatchEvent(new CustomEvent("app:navigate", {
          detail: {
            view: "proyectos",
            target: {
              vigencia_id: selectedVigenciaId,
              vigencia_consejeria_id: metric.vc.id,
              linea_id: metric.line.id,
              programa_id: metric.program.id,
              proyecto_id: metric.project.id,
              project_tab: "perfil"
            }
          }
        }));
      });
    });
  }

  function bindMandateActions() {
    contentHost.querySelectorAll(".toggle-mandate-detail").forEach((button) => {
      button.addEventListener("click", () => {
        openMandateId = openMandateId === button.dataset.mandateId ? "" : button.dataset.mandateId;
        renderResults();
      });
    });

    contentHost.querySelectorAll(".mandate-audit-note").forEach((button) => {
      button.addEventListener("click", () => {
        const item = tracking.find((row) => row.mandate.id === button.dataset.mandateId);
        const vigencia = currentVigencia();
        if (!item || !vigencia) return;
        openAuditPanel({
          newNote: true,
          contextOverride: {
            vigenciaId: vigencia.id,
            vigenciaNombre: vigencia.nombre,
            entidadTipo: "mandato",
            entidadId: item.mandate.id,
            entidadNombre: item.mandate.codigo || item.mandate.titulo || "Mandato",
            seccion: "seguimiento",
            ruta: `${vigencia.nombre} › Seguimiento de Mandatos › ${item.mandate.codigo || item.mandate.titulo || "Mandato"}`,
            navigation: {
              view: "seguimiento_mandatos",
              vigencia_id: vigencia.id,
              vigencia_consejeria_id: selectedVcId || null,
              mandato_id: item.mandate.id
            }
          }
        });
      });
    });
  }

  function renderResults() {
    const items = visibleItems();
    summaryHost.innerHTML = summaryHTML(items);
    countHost.textContent = String(items.length);

    if (!items.length) {
      contentHost.innerHTML = `
        <div class="empty-state">
          <strong>No hay Mandatos para los filtros seleccionados.</strong>
          <p>Prueba otra Consejería, estado o término de búsqueda.</p>
        </div>
      `;
      return;
    }

    contentHost.innerHTML = `<div class="mandate-tracking-list">${items.map((item) => mandateCard(item, item.mandate.id === openMandateId)).join("")}</div>`;
    bindMandateActions();
    bindProjectButtons();

    if (openMandateId) {
      const target = contentHost.querySelector(`[data-mandate-id="${CSS.escape(openMandateId)}"]`);
      if (target && navigationTarget?.mandato_id) {
        setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
        navigationTarget = null;
      }
    }
  }

  async function loadSelectedVigencia() {
    if (!selectedVigenciaId) {
      rawData = null;
      tracking = [];
      renderFilters();
      renderResults();
      return;
    }

    contentHost.innerHTML = `<div class="empty-state">Calculando seguimiento de Mandatos…</div>`;
    refreshButton.disabled = true;
    refreshButton.textContent = "Actualizando…";
    try {
      rawData = await loadMandateTrackingData(selectedVigenciaId);

      if (isConsejeriaUser()) {
        const visibleMandateIds = new Set([
          ...rawData.mandatoConsejerias.map((row) => row.mandato_id),
          ...rawData.projectLinks.map((row) => row.mandato_id)
        ]);
        rawData.mandatos = rawData.mandatos.filter((row) => visibleMandateIds.has(row.id));
      }

      if (selectedVcId && !rawData.consejerias.some((row) => row.id === selectedVcId)) selectedVcId = "";
      tracking = buildTracking(rawData, { selectedVcId });
      renderFilters();
      setContext();
      renderResults();
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Actualizar";
    }
  }

  vigenciaSelector.addEventListener("change", async () => {
    selectedVigenciaId = vigenciaSelector.value;
    selectedVcId = "";
    openMandateId = "";
    await loadSelectedVigencia();
  });

  vcSelector.addEventListener("change", () => {
    selectedVcId = vcSelector.value;
    openMandateId = "";
    tracking = buildTracking(rawData || {
      mandatos: [], consejerias: [], mandatoConsejerias: [], projectLinks: [], proyectos: [], programas: [], lineas: [], actividades: [], indicadores: []
    }, { selectedVcId });
    renderFilters();
    setContext();
    renderResults();
  });

  statusSelector.addEventListener("change", () => {
    statusFilter = statusSelector.value;
    renderResults();
  });

  searchInput.addEventListener("input", () => {
    searchValue = searchInput.value || "";
    renderResults();
  });

  refreshButton.addEventListener("click", loadSelectedVigencia);

  vigencias = await getVigencias();
  if (!selectedVigenciaId || !vigencias.some((row) => row.id === selectedVigenciaId)) {
    selectedVigenciaId = vigencias.find((row) => row.estado === "activa")?.id || vigencias[0]?.id || "";
  }

  renderFilters();
  await loadSelectedVigencia();
}
