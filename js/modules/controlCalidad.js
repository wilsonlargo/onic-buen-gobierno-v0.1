import { requireSupabase } from "../supabaseClient.js";
import { setAuditContext } from "./auditoria.js";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function option(value, label, selected = false) {
  return `<option value="${escapeHTML(value)}" ${selected ? "selected" : ""}>${escapeHTML(label)}</option>`;
}

function normalize(value = "") {
  return String(value ?? "").trim().toLocaleLowerCase("es");
}

function hasText(value) {
  return Boolean(String(value ?? "").trim());
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function getRowsIn(table, field, ids, columns = "*") {
  if (!ids.length) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase.from(table).select(columns).in(field, ids);
  if (error) throw error;
  return data || [];
}

async function getVigencias() {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("vigencias")
    .select("id,nombre,fecha_inicio,fecha_fin,estado")
    .order("fecha_inicio", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadQualityData(vigenciaId, vcId = "") {
  const supabase = requireSupabase();
  const { data: allVc, error: vcError } = await supabase
    .from("vigencia_consejerias")
    .select("id,vigencia_id,consejeria_id,estado,responsable,consejerias(id,nombre_corto,nombre_largo)")
    .eq("vigencia_id", vigenciaId)
    .order("created_at", { ascending: true });
  if (vcError) throw vcError;

  const consejerias = vcId ? (allVc || []).filter((row) => row.id === vcId) : (allVc || []);
  const vcIds = consejerias.map((row) => row.id);
  const lineas = await getRowsIn(
    "lineas_accion",
    "vigencia_consejeria_id",
    vcIds,
    "id,vigencia_consejeria_id,nombre,nombre_corto,estado,orden"
  );
  const lineaIds = lineas.map((row) => row.id);
  const programas = await getRowsIn(
    "programas",
    "linea_accion_id",
    lineaIds,
    "id,linea_accion_id,nombre,nombre_corto,estado,orden"
  );
  const programaIds = programas.map((row) => row.id);
  const proyectos = await getRowsIn(
    "proyectos",
    "programa_id",
    programaIds,
    "id,programa_id,codigo,nombre,nombre_corto,descripcion,objetivo_general,responsable,fecha_inicio,fecha_fin,estado,ponderacion,orden"
  );
  const projectIds = proyectos.map((row) => row.id);
  const actividades = await getRowsIn(
    "actividades",
    "proyecto_id",
    projectIds,
    "id,proyecto_id,codigo,nombre,descripcion,responsable,fecha_inicio,fecha_fin,estado,orden"
  );
  const activityIds = actividades.map((row) => row.id);
  const [indicadores, links] = await Promise.all([
    getRowsIn(
      "indicadores_actividad",
      "actividad_id",
      activityIds,
      "id,actividad_id,codigo,nombre,estado,linea_base,meta,valor_actual,sentido,unidad_medida,orden"
    ),
    getRowsIn("proyecto_mandatos", "proyecto_id", projectIds, "proyecto_id,mandato_id")
  ]);

  return { allVc: allVc || [], consejerias, lineas, programas, proyectos, actividades, indicadores, links };
}

function vcName(vc) {
  return vc?.consejerias?.nombre_corto || vc?.consejerias?.nombre_largo || "Consejería";
}

function qualityState(score) {
  if (score >= 99.999) return { key: "complete", label: "Completo", className: "complete" };
  if (score >= 75) return { key: "review", label: "Requiere ajustes", className: "review" };
  return { key: "incomplete", label: "Incompleto", className: "incomplete" };
}

function buildQualityRows(data) {
  const vcById = new Map(data.consejerias.map((row) => [row.id, row]));
  const lineById = new Map(data.lineas.map((row) => [row.id, row]));
  const programById = new Map(data.programas.map((row) => [row.id, row]));

  const activitiesByProject = new Map();
  data.actividades.forEach((activity) => {
    if (!activitiesByProject.has(activity.proyecto_id)) activitiesByProject.set(activity.proyecto_id, []);
    activitiesByProject.get(activity.proyecto_id).push(activity);
  });

  const indicatorsByActivity = new Map();
  data.indicadores.forEach((indicator) => {
    if (!indicatorsByActivity.has(indicator.actividad_id)) indicatorsByActivity.set(indicator.actividad_id, []);
    indicatorsByActivity.get(indicator.actividad_id).push(indicator);
  });

  const mandatesByProject = new Map();
  data.links.forEach((link) => mandatesByProject.set(link.proyecto_id, Number(mandatesByProject.get(link.proyecto_id) || 0) + 1));

  const projectsByProgram = new Map();
  data.proyectos.forEach((project) => {
    if (!projectsByProgram.has(project.programa_id)) projectsByProgram.set(project.programa_id, []);
    projectsByProgram.get(project.programa_id).push(project);
  });

  const programWeightOk = new Map();
  projectsByProgram.forEach((projects, programId) => {
    const total = projects.reduce((sum, project) => sum + Number(project.ponderacion || 0), 0);
    programWeightOk.set(programId, Math.abs(total - 100) <= 0.01);
  });

  return data.proyectos.map((project) => {
    const program = programById.get(project.programa_id);
    const line = lineById.get(program?.linea_accion_id);
    const vc = vcById.get(line?.vigencia_consejeria_id);
    const activities = (activitiesByProject.get(project.id) || []).filter((activity) => activity.estado !== "cancelada");
    const activeIndicators = activities.flatMap((activity) => (indicatorsByActivity.get(activity.id) || []).filter((indicator) => indicator.estado === "activo"));

    const checks = [];
    checks.push({ key: "objetivo", label: "Objetivo general definido", ok: hasText(project.objetivo_general), target: "perfil" });
    checks.push({ key: "responsable", label: "Responsable definido", ok: hasText(project.responsable), target: "perfil" });
    checks.push({
      key: "fechas",
      label: "Fechas del Proyecto completas y coherentes",
      ok: Boolean(project.fecha_inicio && project.fecha_fin && project.fecha_inicio <= project.fecha_fin),
      target: "perfil"
    });
    checks.push({ key: "actividades", label: "Tiene al menos una Actividad", ok: activities.length > 0, target: "actividades" });
    checks.push({
      key: "actividad_datos",
      label: "Actividades con responsable y fechas",
      ok: activities.length > 0 && activities.every((activity) => hasText(activity.responsable) && activity.fecha_inicio && activity.fecha_fin && activity.fecha_inicio <= activity.fecha_fin),
      target: "actividades"
    });
    checks.push({
      key: "actividad_indicadores",
      label: "Cada Actividad tiene Indicadores activos",
      ok: activities.length > 0 && activities.every((activity) => (indicatorsByActivity.get(activity.id) || []).some((indicator) => indicator.estado === "activo")),
      target: "actividades"
    });
    checks.push({
      key: "indicadores_validos",
      label: "Indicadores con línea base, meta, unidad y sentido válidos",
      ok: activeIndicators.length > 0 && activeIndicators.every((indicator) => {
        const base = numericValue(indicator.linea_base);
        const meta = numericValue(indicator.meta);
        return base !== null && meta !== null && Math.abs(meta - base) > 1e-12 && hasText(indicator.nombre) && hasText(indicator.unidad_medida) && ["ascendente", "descendente"].includes(indicator.sentido);
      }),
      target: "actividades"
    });
    checks.push({
      key: "ponderacion",
      label: "Ponderación del Programa aprobada y suma 100 %",
      ok: Boolean(programWeightOk.get(project.programa_id)),
      target: "ponderaciones"
    });

    const passed = checks.filter((check) => check.ok).length;
    const score = checks.length ? (passed / checks.length) * 100 : 0;
    const state = qualityState(score);
    const findings = checks.filter((check) => !check.ok);

    return {
      project,
      program,
      line,
      vc,
      activities,
      activeIndicators,
      checks,
      findings,
      score,
      state,
      mandateCount: Number(mandatesByProject.get(project.id) || 0)
    };
  });
}

function projectTarget(vigenciaId, row, tab = "perfil") {
  return {
    view: "proyectos",
    vigencia_id: vigenciaId,
    vigencia_consejeria_id: row.vc?.id || null,
    linea_id: row.line?.id || null,
    programa_id: row.program?.id || null,
    proyecto_id: row.project?.id || null,
    project_tab: tab
  };
}

function dispatchNavigate(target) {
  window.dispatchEvent(new CustomEvent("app:navigate", { detail: { view: target.view, target } }));
}

export async function renderControlCalidad(container, navigationTarget = null) {
  let vigencias = [];
  let consejerias = [];
  let data = null;
  let rows = [];
  let selectedVigenciaId = navigationTarget?.vigencia_id || "";
  let selectedVcId = navigationTarget?.vigencia_consejeria_id || "";
  let stateFilter = "todos";
  let searchText = "";

  container.innerHTML = `
    <section class="hero-panel quality-hero">
      <div>
        <p class="eyebrow" style="color:var(--onic-cream-300)">Revisión de formulación</p>
        <h2>Control de calidad</h2>
        <p>Verifica que los Proyectos tengan la información mínima necesaria para producir seguimiento y avances confiables.</p>
      </div>
      <div class="quality-hero-note">La revisión es estructural: no reemplaza la valoración técnica o política del contenido.</div>
    </section>

    <section class="panel quality-context-panel">
      <div class="quality-context-grid">
        <div class="form-field">
          <label for="qualityVigencia">Vigencia</label>
          <select id="qualityVigencia"><option value="">Cargando…</option></select>
        </div>
        <div class="form-field">
          <label for="qualityConsejeria">Consejería</label>
          <select id="qualityConsejeria" disabled><option value="">Todas las autorizadas</option></select>
        </div>
        <div class="form-field">
          <label for="qualityState">Estado de calidad</label>
          <select id="qualityState">
            <option value="todos">Todos</option>
            <option value="complete">Completos</option>
            <option value="review">Requieren ajustes</option>
            <option value="incomplete">Incompletos</option>
          </select>
        </div>
        <div class="form-field">
          <label for="qualitySearch">Buscar Proyecto</label>
          <input id="qualitySearch" type="search" placeholder="Código, nombre, responsable…">
        </div>
      </div>
    </section>

    <section id="qualitySummary" class="quality-summary-grid"><div class="empty-state">Cargando revisión…</div></section>

    <section class="panel quality-guide">
      <details>
        <summary>¿Qué verifica el Control de calidad?</summary>
        <p>Comprueba objetivo, responsable, fechas, Actividades, Indicadores y ponderación. El porcentaje expresa cuántos requisitos estructurales están completos; no es un porcentaje de avance ni califica la calidad sustantiva del Proyecto.</p>
      </details>
    </section>

    <section id="qualityBody" class="quality-list"><div class="empty-state">Cargando…</div></section>
  `;

  const vigenciaSelect = container.querySelector("#qualityVigencia");
  const vcSelect = container.querySelector("#qualityConsejeria");
  const stateSelect = container.querySelector("#qualityState");
  const searchInput = container.querySelector("#qualitySearch");
  const summaryHost = container.querySelector("#qualitySummary");
  const body = container.querySelector("#qualityBody");

  function currentVigencia() {
    return vigencias.find((row) => row.id === selectedVigenciaId);
  }

  function renderSummary() {
    const complete = rows.filter((row) => row.state.key === "complete").length;
    const review = rows.filter((row) => row.state.key === "review").length;
    const incomplete = rows.filter((row) => row.state.key === "incomplete").length;
    const avg = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
    summaryHost.innerHTML = `
      <article class="quality-summary-card"><span>Proyectos revisados</span><strong>${rows.length}</strong><small>Dentro del alcance seleccionado</small></article>
      <article class="quality-summary-card quality-complete"><span>Completos</span><strong>${complete}</strong><small>100 % de requisitos estructurales</small></article>
      <article class="quality-summary-card quality-review"><span>Requieren ajustes</span><strong>${review}</strong><small>Entre 75 % y 99,99 %</small></article>
      <article class="quality-summary-card quality-incomplete"><span>Incompletos</span><strong>${incomplete}</strong><small>Menos de 75 %</small></article>
      <article class="quality-summary-card"><span>Calidad estructural promedio</span><strong>${avg.toFixed(0)} %</strong><small>No equivale al avance técnico</small></article>
    `;
  }

  function filteredRows() {
    const query = normalize(searchText);
    return rows.filter((row) => {
      if (stateFilter !== "todos" && row.state.key !== stateFilter) return false;
      if (!query) return true;
      const haystack = normalize([
        row.project.codigo,
        row.project.nombre,
        row.project.nombre_corto,
        row.project.responsable,
        row.program?.nombre,
        row.line?.nombre,
        vcName(row.vc)
      ].join(" "));
      return haystack.includes(query);
    });
  }

  function renderBody() {
    const visible = filteredRows();
    if (!visible.length) {
      body.innerHTML = `<div class="empty-state">No hay Proyectos que coincidan con los filtros seleccionados.</div>`;
      return;
    }

    body.innerHTML = visible.map((row) => {
      const findings = row.findings.length
        ? `<ul class="quality-findings">${row.findings.map((item) => `<li>${escapeHTML(item.label)}</li>`).join("")}</ul>`
        : `<p class="quality-ok-message">✓ La estructura mínima está completa.</p>`;
      return `
        <article class="quality-project-card ${row.state.className}" data-project-id="${row.project.id}">
          <div class="quality-project-header">
            <div>
              <p class="eyebrow">${escapeHTML(vcName(row.vc))} · ${escapeHTML(row.program?.nombre || "Programa")}</p>
              <h3>${escapeHTML(row.project.codigo || "Proyecto")} · ${escapeHTML(row.project.nombre)}</h3>
              <p class="muted">${escapeHTML(row.project.responsable || "Sin responsable")} · ${row.activities.length} Actividad${row.activities.length === 1 ? "" : "es"} · ${row.activeIndicators.length} Indicador${row.activeIndicators.length === 1 ? "" : "es"} activo${row.activeIndicators.length === 1 ? "" : "s"}</p>
            </div>
            <div class="quality-score-block">
              <strong>${row.score.toFixed(0)} %</strong>
              <span>${row.state.label}</span>
            </div>
          </div>
          <div class="quality-progress"><span style="width:${Math.max(0, Math.min(100, row.score))}%"></span></div>
          <div class="quality-project-body">
            <div>
              <h4>${row.findings.length ? `Pendientes (${row.findings.length})` : "Resultado"}</h4>
              ${findings}
            </div>
            <div class="quality-check-grid">
              ${row.checks.map((check) => `<span class="quality-check ${check.ok ? "ok" : "missing"}">${check.ok ? "✓" : "!"} ${escapeHTML(check.label)}</span>`).join("")}
            </div>
          </div>
          <div class="quality-project-actions">
            <span class="muted">Mandatos relacionados: ${row.mandateCount}</span>
            <button class="btn btn-secondary quality-open" type="button">Abrir Proyecto</button>
          </div>
        </article>
      `;
    }).join("");

    body.querySelectorAll(".quality-open").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest("[data-project-id]");
        const row = rows.find((item) => item.project.id === card?.dataset.projectId);
        if (row) dispatchNavigate(projectTarget(selectedVigenciaId, row, "perfil"));
      });
    });
  }

  function setAudit() {
    const vigencia = currentVigencia();
    if (!vigencia) return;
    const vc = consejerias.find((row) => row.id === selectedVcId);
    setAuditContext({
      vigenciaId: vigencia.id,
      vigenciaNombre: vigencia.nombre,
      entidadTipo: vc ? "consejeria" : "vigencia",
      entidadId: vc?.id || vigencia.id,
      entidadNombre: vc ? vcName(vc) : vigencia.nombre,
      seccion: "control_calidad",
      ruta: vc ? `${vigencia.nombre} › ${vcName(vc)} › Control de calidad` : `${vigencia.nombre} › Control de calidad`,
      navigation: { view: "calidad", vigencia_id: vigencia.id, vigencia_consejeria_id: vc?.id || null }
    });
  }

  async function refresh() {
    if (!selectedVigenciaId) {
      rows = [];
      renderSummary();
      body.innerHTML = `<div class="empty-state">Selecciona una Vigencia.</div>`;
      return;
    }
    body.innerHTML = `<div class="empty-state">Revisando estructura…</div>`;
    data = await loadQualityData(selectedVigenciaId, selectedVcId);
    consejerias = data.allVc;
    rows = buildQualityRows(data);
    renderSummary();
    renderBody();
    setAudit();
  }

  function fillConsejerias() {
    const current = selectedVcId;
    vcSelect.innerHTML = `<option value="">Todas las autorizadas</option>` + consejerias.map((row) => option(row.id, vcName(row), row.id === current)).join("");
    vcSelect.disabled = !selectedVigenciaId || consejerias.length === 0;
    if (current && !consejerias.some((row) => row.id === current)) selectedVcId = "";
  }

  vigencias = await getVigencias();
  if (!selectedVigenciaId || !vigencias.some((row) => row.id === selectedVigenciaId)) selectedVigenciaId = vigencias[0]?.id || "";
  vigenciaSelect.innerHTML = vigencias.map((row) => option(row.id, row.nombre, row.id === selectedVigenciaId)).join("") || `<option value="">Sin Vigencias</option>`;

  if (selectedVigenciaId) {
    data = await loadQualityData(selectedVigenciaId, selectedVcId);
    consejerias = data.allVc;
    fillConsejerias();
    rows = buildQualityRows(data);
    renderSummary();
    renderBody();
    setAudit();
  } else {
    rows = [];
    renderSummary();
    body.innerHTML = `<div class="empty-state">No hay Vigencias disponibles.</div>`;
  }

  vigenciaSelect.addEventListener("change", async () => {
    selectedVigenciaId = vigenciaSelect.value;
    selectedVcId = "";
    const temp = await loadQualityData(selectedVigenciaId, "");
    consejerias = temp.allVc;
    fillConsejerias();
    data = temp;
    rows = buildQualityRows(data);
    renderSummary();
    renderBody();
    setAudit();
  });

  vcSelect.addEventListener("change", async () => {
    selectedVcId = vcSelect.value;
    await refresh();
  });

  stateSelect.addEventListener("change", () => {
    stateFilter = stateSelect.value;
    renderBody();
  });

  searchInput.addEventListener("input", () => {
    searchText = searchInput.value;
    renderBody();
  });
}
