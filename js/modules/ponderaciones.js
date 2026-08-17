import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";
import { setAuditContext, openAuditPanel } from "./auditoria.js";

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

function option(value, label, selected = false) {
  return `<option value="${escapeHTML(value)}" ${selected ? "selected" : ""}>${escapeHTML(label)}</option>`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(2).replace(".", ",")} %`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function sortRows(rows = []) {
  return [...rows].sort((a, b) => {
    const order = Number(a.orden || 0) - Number(b.orden || 0);
    if (order !== 0) return order;
    return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
  });
}

function exactEqualWeights(rows = []) {
  const sorted = sortRows(rows);
  const result = new Map();
  rows.forEach((row) => result.set(row.id, 0));
  if (!sorted.length) return result;
  const totalUnits = 10000;
  const base = Math.floor(totalUnits / sorted.length);
  const remainder = totalUnits - base * sorted.length;
  sorted.forEach((row, index) => {
    result.set(row.id, (base + (index < remainder ? 1 : 0)) / 100);
  });
  return result;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function indicatorProgress(indicator) {
  if (!indicator || indicator.estado !== "activo") return null;
  const base = Number(indicator.linea_base);
  const target = Number(indicator.meta);
  const current = Number(indicator.valor_actual);
  if (![base, target, current].every(Number.isFinite)) return null;
  let numerator;
  let denominator;
  if (indicator.sentido === "descendente") {
    numerator = base - current;
    denominator = base - target;
  } else {
    numerator = current - base;
    denominator = target - base;
  }
  if (Math.abs(denominator) < 1e-12) return null;
  return clamp(numerator / denominator * 100);
}

function activityProgress(indicators = []) {
  const active = indicators.filter((indicator) => indicator.estado === "activo");
  if (!active.length) return null;
  const values = active.map(indicatorProgress);
  if (values.some((value) => value === null)) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function projectProgress(project, activitiesByProject, indicatorsByActivity) {
  const activities = (activitiesByProject.get(project.id) || [])
    .filter((activity) => activity.estado !== "cancelada");
  if (!activities.length) return null;
  const weights = exactEqualWeights(activities);
  let total = 0;
  for (const activity of activities) {
    const value = activityProgress(indicatorsByActivity.get(activity.id) || []);
    if (value === null) return null;
    total += value * Number(weights.get(activity.id) || 0) / 100;
  }
  return clamp(total);
}

function statusChip(estado, type = "programa") {
  const active = type === "linea" ? estado === "activa" : estado === "activo";
  return `<span class="status-chip ${active ? "active" : "closed"}">${escapeHTML(estado || "—")}</span>`;
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

async function getConsejerias(vigenciaId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("vigencia_consejerias")
    .select(`
      id,
      vigencia_id,
      estado,
      responsable,
      pueblo,
      consejerias (
        id,
        nombre_corto,
        nombre_largo
      )
    `)
    .eq("vigencia_id", vigenciaId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).filter((item) => item.consejerias);
}

async function getHierarchy(vigenciaConsejeriaId) {
  const supabase = requireSupabase();
  const { data: lineas, error: lineError } = await supabase
    .from("lineas_accion")
    .select("id,vigencia_consejeria_id,nombre,nombre_corto,descripcion,estado,orden")
    .eq("vigencia_consejeria_id", vigenciaConsejeriaId)
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });
  if (lineError) throw lineError;

  const lineIds = (lineas || []).map((row) => row.id);
  let programas = [];
  if (lineIds.length) {
    const { data, error } = await supabase
      .from("programas")
      .select("id,linea_accion_id,nombre,nombre_corto,descripcion,estado,orden")
      .in("linea_accion_id", lineIds)
      .order("orden", { ascending: true })
      .order("nombre", { ascending: true });
    if (error) throw error;
    programas = data || [];
  }

  const programIds = programas.map((row) => row.id);
  let proyectos = [];
  if (programIds.length) {
    const { data, error } = await supabase
      .from("proyectos")
      .select("id,programa_id,codigo,nombre,nombre_corto,descripcion,estado,ponderacion,metodo_ponderacion,orden")
      .in("programa_id", programIds)
      .order("orden", { ascending: true })
      .order("nombre", { ascending: true });
    if (error) throw error;
    proyectos = data || [];
  }

  const projectIds = proyectos.map((row) => row.id);
  let actividades = [];
  if (projectIds.length) {
    const { data, error } = await supabase
      .from("actividades")
      .select("id,proyecto_id,estado,orden,nombre")
      .in("proyecto_id", projectIds);
    if (error) throw error;
    actividades = data || [];
  }

  const activityIds = actividades.map((row) => row.id);
  let indicadores = [];
  if (activityIds.length) {
    const { data, error } = await supabase
      .from("indicadores_actividad")
      .select("id,actividad_id,linea_base,meta,valor_actual,sentido,estado")
      .in("actividad_id", activityIds);
    if (error) throw error;
    indicadores = data || [];
  }

  return { lineas: lineas || [], programas, proyectos, actividades, indicadores };
}

async function getLastApproval(vigenciaConsejeriaId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("ponderacion_consejeria_aprobaciones")
    .select("id,descripcion,aprobado_por_email,aprobado_en,snapshot")
    .eq("vigencia_consejeria_id", vigenciaConsejeriaId)
    .order("aprobado_en", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function approveWeights(vigenciaConsejeriaId, description, rows) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("aprobar_ponderacion_consejeria", {
    p_vigencia_consejeria_id: vigenciaConsejeriaId,
    p_descripcion: description,
    p_ponderaciones: rows
  });
  if (error) throw error;
  return data;
}

function buildGroups(rows, field) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row[field];
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function noteContext({ vigencia, consejeria, linea = null, programa = null, proyecto = null }) {
  const cName = consejeria.consejerias.nombre_corto || consejeria.consejerias.nombre_largo;
  const parts = [vigencia.nombre, cName, "Ponderaciones"];
  if (linea) parts.push(linea.nombre);
  if (programa) parts.push(programa.nombre);
  if (proyecto) parts.push(proyecto.codigo || proyecto.nombre);

  let entidadTipo = "consejeria";
  let entidadId = consejeria.id;
  let entidadNombre = cName;
  let anchor = "audit-ponderacion-consejeria";

  if (programa) {
    entidadTipo = "programa";
    entidadId = programa.id;
    entidadNombre = programa.nombre;
    anchor = `audit-ponderacion-programa-${programa.id}`;
  }
  if (proyecto) {
    entidadTipo = "proyecto";
    entidadId = proyecto.id;
    entidadNombre = proyecto.nombre;
    anchor = `audit-ponderacion-proyecto-${proyecto.id}`;
  }

  return {
    vigenciaId: vigencia.id,
    vigenciaNombre: vigencia.nombre,
    entidadTipo,
    entidadId,
    entidadNombre,
    seccion: "ponderaciones",
    ruta: parts.join(" › "),
    navigation: {
      view: "ponderaciones",
      vigencia_id: vigencia.id,
      vigencia_nombre: vigencia.nombre,
      vigencia_consejeria_id: consejeria.id,
      consejeria_nombre: cName,
      linea_id: linea?.id || null,
      linea_nombre: linea?.nombre || null,
      programa_id: programa?.id || null,
      programa_nombre: programa?.nombre || null,
      proyecto_id: proyecto?.id || null,
      proyecto_codigo: proyecto?.codigo || null,
      proyecto_nombre: proyecto?.nombre || null,
      anchor
    }
  };
}

function approvalHelpHTML() {
  return `
    <section class="panel ponderacion-guide">
      <div class="ponderacion-guide-head">
        <div>
          <p class="eyebrow">Orientación</p>
          <h3>¿Cómo funciona la ponderación?</h3>
        </div>
        <span class="status-chip active">Borrador hasta aprobar</span>
      </div>

      <div class="ponderacion-guide-grid">
        <div>
          <strong>Qué representa</strong>
          <p>
            La ponderación define cuánto aporta cada Proyecto al resultado de su Programa.
            No equivale al avance ni al presupuesto. Las Líneas de Acción y los Programas
            mantienen ponderación automática; únicamente se editan los Proyectos.
          </p>
        </div>

        <div>
          <strong>Consejos para ponderar</strong>
          <ul>
            <li>Considere la relevancia estratégica y los resultados esperados.</li>
            <li>Revise la contribución del Proyecto a los Mandatos y al propósito del Programa.</li>
            <li>No use el presupuesto como único criterio.</li>
            <li><strong>Ponderación sugerida</strong> distribuye equitativamente el 100 % entre los Proyectos del Programa y luego puede ajustarse manualmente.</li>
            <li>La suma de los Proyectos de cada Programa debe ser exactamente 100 %.</li>
          </ul>
        </div>
      </div>

      <div class="ponderacion-draft-note">
        <strong>Importante:</strong>
        cualquier cambio realizado en esta pantalla es una propuesta temporal.
        La base de datos solo se actualiza al seleccionar <strong>Aprobar ponderación</strong>.
      </div>
    </section>
  `;
}

export async function renderPonderaciones(container, navigationTarget = null) {
  let vigencias = [];
  let consejerias = [];
  let lineas = [];
  let programas = [];
  let proyectos = [];
  let actividades = [];
  let indicadores = [];
  let selectedVigenciaId = "";
  let selectedConsejeriaId = "";
  let currentDraft = new Map();
  let currentMethods = new Map();
  let originalDraft = new Map();
  let originalMethods = new Map();
  let approvalDescription = "";
  let dirty = false;
  let lastApproval = null;

  const storedTarget = (() => {
    try {
      const raw = sessionStorage.getItem("onic_ponderaciones_target");
      if (!raw) return null;
      sessionStorage.removeItem("onic_ponderaciones_target");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();

  if (!navigationTarget && storedTarget) navigationTarget = storedTarget;

  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Configuración estratégica</p>
        <h2>Ponderaciones</h2>
      </div>

      <div class="page-action-group">
        <button id="suggestAllWeights" class="btn btn-secondary" type="button" disabled>
          Ponderación sugerida
        </button>
        <button id="resetAllWeights" class="btn btn-secondary" type="button" disabled>
          Restablecer propuesta
        </button>
        <button id="approveAllWeights" class="btn btn-primary" type="button" disabled>
          Aprobar ponderación
        </button>
      </div>
    </div>

    <section class="panel strategic-selector-panel ponderacion-selector-panel" style="margin-top:0">
      <div class="strategic-selector-intro">
        <p class="eyebrow">Ubicación de trabajo</p>
        <h2>Selecciona la Consejería</h2>
        <p class="muted">
          Selecciona la Vigencia y la Consejería para desplegar en una sola vista
          sus Líneas de Acción, Programas y Proyectos.
        </p>
      </div>

      <div class="strategic-selector-fields ponderacion-selector-fields">
        <label>
          <span>1. Vigencia</span>
          <select id="ponderacionVigenciaSelector">
            <option value="">Cargando…</option>
          </select>
        </label>
        <label>
          <span>2. Consejería</span>
          <select id="ponderacionConsejeriaSelector" disabled>
            <option value="">Seleccione una Consejería…</option>
          </select>
        </label>
      </div>
    </section>

    ${approvalHelpHTML()}

    <div id="ponderacionContent" class="ponderacion-content">
      <div class="empty-state">
        <strong>Selecciona una Vigencia y una Consejería.</strong>
        <p>La estructura de ponderación aparecerá aquí.</p>
      </div>
    </div>
  `;

  const vigenciaSelector = container.querySelector("#ponderacionVigenciaSelector");
  const consejeriaSelector = container.querySelector("#ponderacionConsejeriaSelector");
  const content = container.querySelector("#ponderacionContent");
  const suggestAllButton = container.querySelector("#suggestAllWeights");
  const resetAllButton = container.querySelector("#resetAllWeights");
  const approveButton = container.querySelector("#approveAllWeights");

  const currentVigencia = () => vigencias.find((item) => item.id === selectedVigenciaId);
  const currentConsejeria = () => consejerias.find((item) => item.id === selectedConsejeriaId);

  function activeLines() {
    return sortRows(lineas.filter((linea) => linea.estado === "activa"));
  }

  function programsForLine(lineId) {
    return sortRows(programas.filter((programa) => programa.linea_accion_id === lineId));
  }

  function activeProgramsForLine(lineId) {
    return programsForLine(lineId).filter((programa) => programa.estado === "activo");
  }

  function projectsForProgram(programId) {
    return sortRows(proyectos.filter((proyecto) => proyecto.programa_id === programId));
  }

  function activeProgramList() {
    const activeLineIds = new Set(activeLines().map((linea) => linea.id));
    return sortRows(programas.filter(
      (programa) => programa.estado === "activo" && activeLineIds.has(programa.linea_accion_id)
    ));
  }

  function setDraftFromCurrent() {
    currentDraft = new Map();
    currentMethods = new Map();
    proyectos.forEach((proyecto) => {
      currentDraft.set(proyecto.id, Number(proyecto.ponderacion || 0));
      currentMethods.set(proyecto.id, proyecto.metodo_ponderacion || "manual");
    });
    originalDraft = new Map(currentDraft);
    originalMethods = new Map(currentMethods);
    dirty = false;
    approvalDescription = "";
  }

  function programTotal(program) {
    return projectsForProgram(program.id).reduce(
      (sum, proyecto) => sum + Number(currentDraft.get(proyecto.id) || 0), 0
    );
  }

  function programState(program) {
    const rows = projectsForProgram(program.id);
    if (!rows.length) {
      return { type: "empty", label: "Sin Proyectos", detail: "El Programa no requiere distribución." };
    }
    const invalid = rows.some((project) => {
      const value = Number(currentDraft.get(project.id));
      return !Number.isFinite(value) || value < 0 || value > 100;
    });
    if (invalid) {
      return { type: "over", label: "Valor inválido", detail: "Cada Proyecto debe estar entre 0 % y 100 %." };
    }
    const total = programTotal(program);
    const diff = Math.round((100 - total) * 100) / 100;
    if (Math.abs(diff) < 0.005) {
      return { type: "ok", label: "Ponderación completa", detail: "La propuesta suma exactamente 100,00 %." };
    }
    if (diff > 0) {
      return { type: "pending", label: `Falta ${formatPercent(diff)}`, detail: "Distribuye el porcentaje restante." };
    }
    return { type: "over", label: `Excede ${formatPercent(Math.abs(diff))}`, detail: "Reduce uno o varios porcentajes." };
  }

  function reviewState() {
    const activePrograms = activeProgramList().filter((program) => projectsForProgram(program.id).length);
    const complete = activePrograms.filter((program) => programState(program).type === "ok").length;
    const errors = activePrograms.length - complete;
    return { total: activePrograms.length, complete, errors };
  }

  function canApprove() {
    const review = reviewState();
    return review.total > 0 && review.errors === 0 && approvalDescription.trim().length > 0;
  }

  function updateTopActions() {
    const hasSelection = Boolean(currentConsejeria());
    suggestAllButton.disabled = !hasSelection || !proyectos.length;
    resetAllButton.disabled = !hasSelection || !dirty;
    approveButton.disabled = !hasSelection || !canApprove();
  }

  function equalizeProgram(programId) {
    const rows = projectsForProgram(programId);
    const weights = exactEqualWeights(rows);
    rows.forEach((project) => {
      currentDraft.set(project.id, Number(weights.get(project.id) || 0));
      currentMethods.set(project.id, "sugerida");
    });
    dirty = true;
  }

  function completeRemaining(programId) {
    const rows = projectsForProgram(programId);
    if (!rows.length) return;
    const total = rows.reduce((sum, project) => sum + Number(currentDraft.get(project.id) || 0), 0);
    const remaining = Math.round((100 - total) * 100) / 100;
    if (remaining <= 0.005) return;
    const zeroRows = rows.filter((project) => Math.abs(Number(currentDraft.get(project.id) || 0)) < 0.005);
    if (zeroRows.length) {
      const weights = exactEqualWeights(zeroRows.map((project, index) => ({ ...project, __index: index })));
      // Distribuir el restante, no el 100 %, en centésimas.
      const totalUnits = Math.round(remaining * 100);
      const base = Math.floor(totalUnits / zeroRows.length);
      const rem = totalUnits - base * zeroRows.length;
      zeroRows.forEach((project, index) => {
        currentDraft.set(project.id, (base + (index < rem ? 1 : 0)) / 100);
        currentMethods.set(project.id, "sugerida");
      });
    } else {
      const target = rows[rows.length - 1];
      const current = Number(currentDraft.get(target.id) || 0);
      if (current + remaining <= 100.005) {
        currentDraft.set(target.id, Math.round((current + remaining) * 100) / 100);
        currentMethods.set(target.id, "sugerida");
      }
    }
    dirty = true;
  }

  function resetProgram(programId) {
    projectsForProgram(programId).forEach((project) => {
      currentDraft.set(project.id, Number(originalDraft.get(project.id) || 0));
      currentMethods.set(project.id, originalMethods.get(project.id) || "manual");
    });
    dirty = true;
  }

  function applySuggestedAll() {
    activeProgramList().forEach((program) => equalizeProgram(program.id));
    dirty = true;
  }

  function resetAll() {
    currentDraft = new Map(originalDraft);
    currentMethods = new Map(originalMethods);
    approvalDescription = "";
    dirty = false;
  }

  function projectProgressMap() {
    const activitiesByProject = buildGroups(actividades, "proyecto_id");
    const indicatorsByActivity = buildGroups(indicadores, "actividad_id");
    const map = new Map();
    proyectos.forEach((project) => {
      map.set(project.id, projectProgress(project, activitiesByProject, indicatorsByActivity));
    });
    return map;
  }

  function renderStructure() {
    const vigencia = currentVigencia();
    const consejeria = currentConsejeria();
    if (!vigencia || !consejeria) return;

    const lineWeights = exactEqualWeights(activeLines());
    const progress = projectProgressMap();
    const review = reviewState();
    const cName = consejeria.consejerias.nombre_corto || consejeria.consejerias.nombre_largo;

    content.innerHTML = `
      <section id="audit-ponderacion-consejeria" class="panel ponderacion-summary-panel">
        <div class="ponderacion-summary-head">
          <div>
            <p class="eyebrow">Consejería seleccionada</p>
            <h2>${escapeHTML(cName)}</h2>
            <p class="muted">${escapeHTML(consejeria.consejerias.nombre_largo || cName)}</p>
          </div>
          <button id="notePonderacionConsejeria" class="btn btn-secondary" type="button">Nota</button>
        </div>

        <div class="ponderacion-summary-grid">
          <div><span>Líneas activas</span><strong>${activeLines().length}</strong></div>
          <div><span>Programas activos</span><strong>${activeProgramList().length}</strong></div>
          <div><span>Proyectos</span><strong>${proyectos.length}</strong></div>
          <div class="${review.errors ? "warning" : "ok"}"><span>Programas completos</span><strong>${review.complete} / ${review.total}</strong></div>
        </div>

        ${lastApproval ? `
          <div class="ponderacion-last-approval">
            <div>
              <span>Última aprobación</span>
              <strong>${escapeHTML(formatDateTime(lastApproval.aprobado_en))}</strong>
              <small>${escapeHTML(lastApproval.aprobado_por_email || "Usuario")}</small>
            </div>
            <p>${escapeHTML(lastApproval.descripcion || "Sin descripción registrada.")}</p>
          </div>
        ` : `
          <div class="ponderacion-last-approval empty">
            <strong>Aún no hay una aprobación formal registrada para esta Consejería.</strong>
          </div>
        `}
      </section>

      <section class="ponderacion-tree">
        ${lineas.length ? sortRows(lineas).map((linea) => {
          const lineIsActive = linea.estado === "activa";
          const linePrograms = programsForLine(linea.id);
          const activePrograms = lineIsActive ? activeProgramsForLine(linea.id) : [];
          const programWeights = exactEqualWeights(activePrograms);
          return `
            <article class="ponderacion-line-card ${!lineIsActive ? "is-inactive" : ""}">
              <header class="ponderacion-line-header">
                <div>
                  <span class="context-label">Línea de Acción</span>
                  <h3>${escapeHTML(linea.nombre)}</h3>
                  ${linea.descripcion ? `<p>${escapeHTML(linea.descripcion)}</p>` : ""}
                </div>
                <div class="ponderacion-auto-side">
                  ${statusChip(linea.estado, "linea")}
                  <div class="ponderacion-auto-weight">
                    <span>${lineIsActive ? "Peso automático" : "Fuera del cálculo"}</span>
                    <strong>${lineIsActive ? formatPercent(lineWeights.get(linea.id) || 0) : "0,00 %"}</strong>
                  </div>
                </div>
              </header>

              <div class="ponderacion-program-list">
                ${linePrograms.map((programa) => {
                  const isActive = lineIsActive && programa.estado === "activo";
                  const programProjects = projectsForProgram(programa.id);
                  const state = isActive ? programState(programa) : { type: "empty", label: "Fuera del cálculo", detail: "Programa inactivo o archivado." };
                  const total = isActive ? programTotal(programa) : 0;
                  return `
                    <section id="audit-ponderacion-programa-${programa.id}" class="ponderacion-program-card ${!isActive ? "is-inactive" : ""}">
                      <div class="ponderacion-program-head">
                        <div>
                          <span class="context-label">Programa</span>
                          <h4>${escapeHTML(programa.nombre)}</h4>
                          <div class="ponderacion-program-meta">
                            ${statusChip(programa.estado)}
                            <span>Peso automático: <strong>${isActive ? formatPercent(programWeights.get(programa.id) || 0) : "0,00 %"}</strong></span>
                          </div>
                        </div>
                        <button class="btn btn-secondary note-program-weight" data-id="${programa.id}" type="button">Nota</button>
                      </div>

                      ${isActive ? `
                        <div class="ponderacion-program-actions">
                          <button class="btn btn-secondary suggest-program-weight" data-id="${programa.id}" type="button">Ponderación sugerida</button>
                          <button class="btn btn-secondary complete-program-weight" data-id="${programa.id}" type="button">Completar restante</button>
                          <button class="btn btn-secondary reset-program-weight" data-id="${programa.id}" type="button">Restablecer</button>
                        </div>
                      ` : ""}

                      ${programProjects.length ? `
                        <div class="ponderacion-project-table-wrap">
                          <table class="ponderacion-project-table">
                            <thead>
                              <tr>
                                <th>Proyecto</th>
                                <th>Actual</th>
                                <th>Propuesta</th>
                                <th>Avance</th>
                                <th>Auditoría</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${programProjects.map((project) => {
                                const value = Number(currentDraft.get(project.id) || 0);
                                const currentValue = Number(project.ponderacion || 0);
                                const method = currentMethods.get(project.id) || "manual";
                                const changed = Math.abs(value - currentValue) > 0.005;
                                const progressValue = progress.get(project.id);
                                return `
                                  <tr id="audit-ponderacion-proyecto-${project.id}" class="${changed ? "has-draft-change" : ""}">
                                    <td>
                                      <span class="project-code">${escapeHTML(project.codigo || "Proyecto")}</span>
                                      <strong>${escapeHTML(project.nombre)}</strong>
                                      <small>${escapeHTML(project.estado || "")}</small>
                                    </td>
                                    <td class="ponderacion-current-value">${formatPercent(currentValue)}</td>
                                    <td>
                                      <label class="ponderacion-input-wrap">
                                        <input
                                          class="ponderacion-project-input"
                                          data-id="${project.id}"
                                          data-program-id="${programa.id}"
                                          type="number"
                                          min="0"
                                          max="100"
                                          step="0.01"
                                          value="${value.toFixed(2)}"
                                          ${!isActive ? "disabled" : ""}
                                        >
                                        <span>%</span>
                                      </label>
                                      <small class="ponderacion-method ${method === "sugerida" ? "suggested" : ""}">${method === "sugerida" ? "Sugerida" : "Manual"}</small>
                                    </td>
                                    <td>
                                      <strong>${formatPercent(progressValue)}</strong>
                                      <small>${progressValue === null ? "Sin medición completa" : "Cumplimiento técnico"}</small>
                                    </td>
                                    <td>
                                      <button class="btn btn-secondary note-project-weight" data-id="${project.id}" data-program-id="${programa.id}" type="button">Nota</button>
                                    </td>
                                  </tr>
                                `;
                              }).join("")}
                            </tbody>
                          </table>
                        </div>
                      ` : `<div class="empty-inline">Este Programa todavía no tiene Proyectos.</div>`}

                      <div class="ponderacion-program-total ${escapeHTML(state.type)}">
                        <div><span>Asignado</span><strong>${formatPercent(total)}</strong></div>
                        <div><span>Disponible</span><strong>${formatPercent(Math.max(0, 100 - total))}</strong></div>
                        <div class="ponderacion-program-state"><strong>${escapeHTML(state.label)}</strong><small>${escapeHTML(state.detail)}</small></div>
                      </div>
                    </section>
                  `;
                }).join("")}
              </div>
            </article>
          `;
        }).join("") : `
          <div class="empty-state">
            <strong>La Consejería no tiene Líneas de Acción activas.</strong>
            <p>No hay una estructura disponible para ponderar.</p>
          </div>
        `}
      </section>

      <section class="panel ponderacion-approval-panel">
        <div class="ponderacion-approval-head">
          <div>
            <p class="eyebrow">Aprobación</p>
            <h3>Descripción / criterio de la ponderación</h3>
            <p class="muted">
              Registra brevemente los criterios utilizados. Esta descripción quedará asociada
              a la aprobación junto con la fecha y el usuario que la realiza.
            </p>
          </div>
        </div>

        <textarea id="ponderacionDescription" rows="5" placeholder="Ej. La distribución prioriza los Proyectos con mayor relevancia estratégica y contribución a los Mandatos de la Vigencia…">${escapeHTML(approvalDescription)}</textarea>

        <div class="ponderacion-review ${review.errors ? "has-errors" : "is-complete"}">
          <div><span>Programas revisados</span><strong>${review.total}</strong></div>
          <div><span>Completos</span><strong>${review.complete}</strong></div>
          <div><span>Con ajustes pendientes</span><strong>${review.errors}</strong></div>
          <div class="ponderacion-review-message">
            <strong>${review.errors ? "La propuesta todavía requiere ajustes." : "Las sumas de los Programas son correctas."}</strong>
            <small>${approvalDescription.trim() ? "Descripción registrada." : "Agrega la descripción para habilitar la aprobación."}</small>
          </div>
        </div>

        <p id="ponderacionMessage" class="form-message"></p>

        <div class="form-actions ponderacion-final-actions">
          <button id="discardPonderacionDraft" class="btn btn-secondary" type="button" ${dirty ? "" : "disabled"}>Descartar cambios</button>
          <button id="approvePonderacionBottom" class="btn btn-primary" type="button" ${canApprove() ? "" : "disabled"}>Aprobar ponderación</button>
        </div>
      </section>
    `;

    const description = content.querySelector("#ponderacionDescription");
    const message = content.querySelector("#ponderacionMessage");
    description.addEventListener("input", () => {
      approvalDescription = description.value;
      dirty = true;
      updateTopActions();
      const bottom = content.querySelector("#approvePonderacionBottom");
      if (bottom) bottom.disabled = !canApprove();
    });

    content.querySelector("#notePonderacionConsejeria")?.addEventListener("click", () => {
      openAuditPanel({ newNote: true, contextOverride: noteContext({ vigencia, consejeria }) });
    });

    content.querySelectorAll(".ponderacion-project-input").forEach((input) => {
      input.addEventListener("change", () => {
        const value = Number(input.value);
        currentDraft.set(input.dataset.id, value);
        currentMethods.set(input.dataset.id, "manual");
        dirty = true;
        renderStructure();
      });
    });

    content.querySelectorAll(".suggest-program-weight").forEach((button) => {
      button.addEventListener("click", () => {
        equalizeProgram(button.dataset.id);
        renderStructure();
      });
    });

    content.querySelectorAll(".complete-program-weight").forEach((button) => {
      button.addEventListener("click", () => {
        completeRemaining(button.dataset.id);
        renderStructure();
      });
    });

    content.querySelectorAll(".reset-program-weight").forEach((button) => {
      button.addEventListener("click", () => {
        resetProgram(button.dataset.id);
        renderStructure();
      });
    });

    content.querySelectorAll(".note-program-weight").forEach((button) => {
      button.addEventListener("click", () => {
        const programa = programas.find((item) => item.id === button.dataset.id);
        const linea = lineas.find((item) => item.id === programa?.linea_accion_id);
        if (!programa || !linea) return;
        openAuditPanel({
          newNote: true,
          contextOverride: noteContext({ vigencia, consejeria, linea, programa })
        });
      });
    });

    content.querySelectorAll(".note-project-weight").forEach((button) => {
      button.addEventListener("click", () => {
        const proyecto = proyectos.find((item) => item.id === button.dataset.id);
        const programa = programas.find((item) => item.id === button.dataset.programId);
        const linea = lineas.find((item) => item.id === programa?.linea_accion_id);
        if (!proyecto || !programa || !linea) return;
        openAuditPanel({
          newNote: true,
          contextOverride: noteContext({ vigencia, consejeria, linea, programa, proyecto })
        });
      });
    });

    content.querySelector("#discardPonderacionDraft")?.addEventListener("click", () => {
      if (!confirm("¿Descartar todos los cambios de la propuesta actual?")) return;
      resetAll();
      renderStructure();
    });

    content.querySelector("#approvePonderacionBottom")?.addEventListener("click", () => openApprovalDialog(message));

    setAuditContext(noteContext({ vigencia, consejeria }));
    updateTopActions();

    if (navigationTarget?.anchor || navigationTarget?.programa_id || navigationTarget?.proyecto_id) {
      const anchor = navigationTarget.anchor ||
        (navigationTarget.proyecto_id
          ? `audit-ponderacion-proyecto-${navigationTarget.proyecto_id}`
          : navigationTarget.programa_id
            ? `audit-ponderacion-programa-${navigationTarget.programa_id}`
            : "audit-ponderacion-consejeria");
      const target = content.querySelector(`#${CSS.escape(anchor)}`);
      if (target) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("audit-reference-highlight");
          setTimeout(() => target.classList.remove("audit-reference-highlight"), 2600);
        }, 80);
      }
      navigationTarget = null;
    }
  }

  function approvalRows() {
    const activeProgramIds = new Set(activeProgramList().map((program) => program.id));
    return proyectos
      .filter((project) => activeProgramIds.has(project.programa_id))
      .map((project) => ({
        proyecto_id: project.id,
        ponderacion: Math.round(Number(currentDraft.get(project.id) || 0) * 100) / 100,
        metodo_ponderacion: currentMethods.get(project.id) === "sugerida" ? "sugerida" : "manual"
      }));
  }

  function openApprovalDialog(messageTarget = null) {
    if (!canApprove()) return;
    const vigencia = currentVigencia();
    const consejeria = currentConsejeria();
    const review = reviewState();
    const cName = consejeria.consejerias.nombre_corto || consejeria.consejerias.nombre_largo;

    openModal({
      title: "Aprobar ponderación",
      content: `
        <div class="ponderacion-approval-confirm">
          <span class="context-label">Consejería</span>
          <h3>${escapeHTML(cName)}</h3>
          <p>
            Se actualizarán las ponderaciones oficiales de <strong>${approvalRows().length} Proyectos</strong>
            distribuidos en <strong>${review.total} Programas</strong>.
          </p>
          <div class="ponderacion-confirm-description">
            <span>Descripción / criterio</span>
            <p>${escapeHTML(approvalDescription.trim())}</p>
          </div>
          <div class="danger-callout soft">
            <strong>Los cambios se guardarán únicamente al confirmar esta aprobación.</strong>
            <p>La fecha, el usuario y una fotografía de la distribución quedarán registradas en el historial.</p>
          </div>
          <p id="approvePonderacionMessage" class="form-message"></p>
          <div class="form-actions">
            <button id="cancelPonderacionApproval" class="btn btn-secondary" type="button">Cancelar</button>
            <button id="confirmPonderacionApproval" class="btn btn-primary" type="button">Aprobar ponderación</button>
          </div>
        </div>
      `
    });

    document.querySelector("#cancelPonderacionApproval")?.addEventListener("click", closeModal);
    document.querySelector("#confirmPonderacionApproval")?.addEventListener("click", async () => {
      const button = document.querySelector("#confirmPonderacionApproval");
      const message = document.querySelector("#approvePonderacionMessage");
      button.disabled = true;
      button.textContent = "Aprobando…";
      try {
        await approveWeights(consejeria.id, approvalDescription.trim(), approvalRows());
        closeModal();
        await loadHierarchy();
        const refreshedMessage = content.querySelector("#ponderacionMessage");
        if (refreshedMessage) refreshedMessage.textContent = "Ponderación aprobada correctamente.";
      } catch (error) {
        console.error(error);
        message.textContent = error.message || "No fue posible aprobar la ponderación.";
        button.disabled = false;
        button.textContent = "Aprobar ponderación";
      }
    });
  }

  async function loadConsejerias() {
    selectedConsejeriaId = "";
    consejeriaSelector.innerHTML = `<option value="">Seleccione una Consejería…</option>`;
    consejeriaSelector.disabled = !selectedVigenciaId;
    lineas = [];
    programas = [];
    proyectos = [];
    actividades = [];
    indicadores = [];
    lastApproval = null;
    setDraftFromCurrent();
    updateTopActions();

    if (!selectedVigenciaId) {
      content.innerHTML = `<div class="empty-state"><strong>Selecciona una Vigencia.</strong></div>`;
      return;
    }

    consejerias = await getConsejerias(selectedVigenciaId);
    consejeriaSelector.innerHTML = `
      <option value="">Seleccione una Consejería…</option>
      ${consejerias.map((item) => option(
        item.id,
        `${item.consejerias.nombre_corto || item.consejerias.nombre_largo}${item.estado !== "activa" ? " · inactiva" : ""}`
      )).join("")}
    `;

    if (navigationTarget?.vigencia_consejeria_id && consejerias.some((item) => item.id === navigationTarget.vigencia_consejeria_id)) {
      selectedConsejeriaId = navigationTarget.vigencia_consejeria_id;
      consejeriaSelector.value = selectedConsejeriaId;
      await loadHierarchy();
    }
  }

  async function loadHierarchy() {
    if (!selectedConsejeriaId) {
      content.innerHTML = `<div class="empty-state"><strong>Selecciona una Consejería.</strong><p>Su estructura de ponderación aparecerá aquí.</p></div>`;
      updateTopActions();
      return;
    }

    content.innerHTML = `<div class="empty-state">Cargando estructura de ponderación…</div>`;
    const hierarchy = await getHierarchy(selectedConsejeriaId);
    lineas = hierarchy.lineas;
    programas = hierarchy.programas;
    proyectos = hierarchy.proyectos;
    actividades = hierarchy.actividades;
    indicadores = hierarchy.indicadores;

    try {
      lastApproval = await getLastApproval(selectedConsejeriaId);
    } catch (error) {
      console.error(error);
      if (String(error.message || "").toLowerCase().includes("ponderacion_consejeria_aprobaciones")) {
        content.innerHTML = `
          <div class="danger-callout">
            <strong>Falta habilitar el módulo de Ponderaciones en la base de datos.</strong>
            <p>Ejecuta la migración <code>014_ponderaciones_consejeria.sql</code> en Supabase y vuelve a cargar la página.</p>
          </div>
        `;
        return;
      }
      throw error;
    }

    setDraftFromCurrent();
    renderStructure();
  }

  vigenciaSelector.addEventListener("change", async () => {
    if (dirty && !confirm("Hay cambios de ponderación sin aprobar. ¿Deseas descartarlos y cambiar de Vigencia?")) {
      vigenciaSelector.value = selectedVigenciaId;
      return;
    }
    selectedVigenciaId = vigenciaSelector.value;
    await loadConsejerias();
  });

  consejeriaSelector.addEventListener("change", async () => {
    if (dirty && !confirm("Hay cambios de ponderación sin aprobar. ¿Deseas descartarlos y cambiar de Consejería?")) {
      consejeriaSelector.value = selectedConsejeriaId;
      return;
    }
    selectedConsejeriaId = consejeriaSelector.value;
    await loadHierarchy();
  });

  suggestAllButton.addEventListener("click", () => {
    if (!currentConsejeria()) return;
    applySuggestedAll();
    renderStructure();
  });

  resetAllButton.addEventListener("click", () => {
    if (!dirty) return;
    if (!confirm("¿Restablecer toda la propuesta a los valores actualmente guardados?")) return;
    resetAll();
    renderStructure();
  });

  approveButton.addEventListener("click", () => openApprovalDialog());

  try {
    vigencias = await getVigencias();
    vigenciaSelector.innerHTML = `
      <option value="">Seleccione una Vigencia…</option>
      ${vigencias.map((item) => option(item.id, item.nombre)).join("")}
    `;

    if (navigationTarget?.vigencia_id && vigencias.some((item) => item.id === navigationTarget.vigencia_id)) {
      selectedVigenciaId = navigationTarget.vigencia_id;
      vigenciaSelector.value = selectedVigenciaId;
      await loadConsejerias();
    }
  } catch (error) {
    console.error(error);
    content.innerHTML = `
      <div class="empty-state">
        <strong>No fue posible cargar el módulo Ponderaciones.</strong>
        <p>${escapeHTML(error.message || "Revisa la conexión con Supabase.")}</p>
      </div>
    `;
  }
}
