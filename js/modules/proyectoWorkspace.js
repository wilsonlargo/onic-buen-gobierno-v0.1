import { requireSupabase } from "../supabaseClient.js";
import { updateWithVersion } from "../security.js";
import { openModal, closeModal } from "../components/modal.js";
import { setAuditContext, openAuditPanel } from "./auditoria.js";
import { openDocumentReportDialog, documentReportIcon } from "./documentReports.js";

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

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(2).replace(".", ",")} %`;
}

function formatNumber(value, max = 2) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: max }).format(number);
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(number);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function projectStatusChip(estado) {
  const labels = {
    borrador: "Borrador",
    formulacion: "Formulación",
    activo: "Activo",
    suspendido: "Suspendido",
    cerrado: "Cerrado"
  };
  const css = {
    borrador: "",
    formulacion: "draft",
    activo: "active",
    suspendido: "warning",
    cerrado: "closed"
  };
  return `<span class="status-chip ${css[estado] || ""}">${labels[estado] || escapeHTML(estado)}</span>`;
}

function activityStatusChip(estado) {
  const labels = {
    borrador: "Borrador",
    programada: "Programada",
    en_ejecucion: "En ejecución",
    suspendida: "Suspendida",
    completada: "Completada",
    cancelada: "Cancelada"
  };
  const css = {
    borrador: "",
    programada: "draft",
    en_ejecucion: "active",
    suspendida: "warning",
    completada: "active",
    cancelada: "closed"
  };
  return `<span class="status-chip ${css[estado] || ""}">${labels[estado] || escapeHTML(estado)}</span>`;
}

function trashIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M7 7l1 13h8l1-13"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>`;
}

function arrowIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>`;
}

function openIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path></svg>`;
}

function calculateIndicatorProgress(indicator) {
  if (!indicator || indicator.estado !== "activo") return null;
  const base = Number(indicator.linea_base);
  const meta = Number(indicator.meta);
  const current = Number(indicator.valor_actual);
  if (![base, meta, current].every(Number.isFinite)) return null;

  const denominator = indicator.sentido === "descendente" ? base - meta : meta - base;
  const numerator = indicator.sentido === "descendente" ? base - current : current - base;
  if (Math.abs(denominator) < 1e-12) return null;
  return Math.min(100, Math.max(0, (numerator / denominator) * 100));
}

function calculateActivityProgress(indicators = []) {
  const active = indicators.filter((indicator) => indicator.estado === "activo");
  if (!active.length) return null;
  const values = active.map(calculateIndicatorProgress).filter((value) => value !== null);
  if (values.length !== active.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function automaticActivityWeights(activities = []) {
  const included = activities
    .filter((activity) => activity.estado !== "cancelada")
    .sort((a, b) => {
      const orderDiff = Number(a.orden || 0) - Number(b.orden || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
    });

  const map = new Map();
  activities.forEach((activity) => map.set(activity.id, 0));
  if (!included.length) return map;

  const totalUnits = 10000;
  const baseUnits = Math.floor(totalUnits / included.length);
  const remainder = totalUnits - baseUnits * included.length;
  included.forEach((activity, index) => {
    map.set(activity.id, (baseUnits + (index < remainder ? 1 : 0)) / 100);
  });
  return map;
}

function calculateBudgetMetrics(items = []) {
  const active = items.filter((item) => item.estado === "activo");
  const programmed = active.reduce((sum, item) => sum + Number(item.programado || 0), 0);
  const executed = active.reduce((sum, item) => sum + Number(item.ejecutado || 0), 0);
  const execution = programmed > 0 ? Math.min(100, Math.max(0, (executed / programmed) * 100)) : null;
  return { programmed, executed, execution };
}

function calculateProjectMetrics(activities, indicators, budgetItems) {
  const included = activities.filter((activity) => activity.estado !== "cancelada");
  const weights = automaticActivityWeights(activities);
  const indicatorsByActivity = new Map();
  indicators.forEach((indicator) => {
    if (!indicatorsByActivity.has(indicator.actividad_id)) indicatorsByActivity.set(indicator.actividad_id, []);
    indicatorsByActivity.get(indicator.actividad_id).push(indicator);
  });

  const progressByActivity = new Map();
  included.forEach((activity) => {
    progressByActivity.set(activity.id, calculateActivityProgress(indicatorsByActivity.get(activity.id) || []));
  });

  const measurable = included.filter((activity) => progressByActivity.get(activity.id) !== null);
  let technicalProgress = null;
  if (included.length > 0 && measurable.length === included.length) {
    technicalProgress = included.reduce(
      (sum, activity) => sum + Number(progressByActivity.get(activity.id) || 0) * Number(weights.get(activity.id) || 0) / 100,
      0
    );
  }

  return {
    includedCount: included.length,
    measurableCount: measurable.length,
    technicalProgress,
    progressByActivity,
    weights,
    budget: calculateBudgetMetrics(budgetItems)
  };
}

// ------------------------- datos -------------------------
async function getProject(projectId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("proyectos").select("*").eq("id", projectId).single();
  if (error) throw error;
  return data;
}

async function getProjectMandateIds(projectId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("proyecto_mandatos").select("mandato_id").eq("proyecto_id", projectId);
  if (error) throw error;
  return (data || []).map((item) => item.mandato_id);
}

async function getMandatosConsejeria(vigenciaConsejeriaId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("mandato_consejerias").select("mandato_id").eq("vigencia_consejeria_id", vigenciaConsejeriaId);
  if (error) throw error;
  const ids = [...new Set((data || []).map((item) => item.mandato_id))];
  if (!ids.length) return [];
  const { data: mandatos, error: mandateError } = await supabase.from("mandatos").select("id,codigo,titulo,texto,estado,orden").in("id", ids).order("orden", { ascending: true });
  if (mandateError) throw mandateError;
  return mandatos || [];
}

async function updateProject(record, payload, mandateIds = null) {
  const supabase = requireSupabase();
  const data = await updateWithVersion({
    table: "proyectos",
    record,
    payload,
    entityType: "Proyecto",
    entityName: record?.nombre || record?.codigo || null
  });
  if (Array.isArray(mandateIds)) {
    const { error: deleteError } = await supabase.from("proyecto_mandatos").delete().eq("proyecto_id", record.id);
    if (deleteError) throw deleteError;
    if (mandateIds.length) {
      const { error: insertError } = await supabase.from("proyecto_mandatos").insert(
        mandateIds.map((mandatoId) => ({ proyecto_id: record.id, mandato_id: mandatoId }))
      );
      if (insertError) throw insertError;
    }
  }
  return data;
}

async function getActivities(projectId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("actividades").select("*").eq("proyecto_id", projectId).order("orden", { ascending: true }).order("nombre", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getIndicatorsByActivities(activityIds) {
  if (!activityIds.length) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("indicadores_actividad").select("*").in("actividad_id", activityIds).order("orden", { ascending: true }).order("nombre", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getBudgetByActivities(activityIds) {
  if (!activityIds.length) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("presupuesto_actividad_rubros").select("*").in("actividad_id", activityIds).order("orden", { ascending: true }).order("rubro", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getEvidenceByActivities(activityIds) {
  if (!activityIds.length) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("evidencias_actividad").select("*").in("actividad_id", activityIds).order("fecha", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getActivityFollowups(activityId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("seguimientos_actividad").select("*").eq("actividad_id", activityId).order("fecha_corte", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getIndicatorFollowups(indicatorIds) {
  if (!indicatorIds.length) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("seguimientos_indicador").select("*").in("indicador_id", indicatorIds).order("fecha_corte", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createActivity(payload) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("actividades").insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function updateActivity(record, payload) {
  return updateWithVersion({ table: "actividades", record, payload, entityType: "Actividad", entityName: record?.nombre || record?.codigo || null });
}

async function deleteActivity(id) {
  const supabase = requireSupabase();
  const { error } = await supabase.from("actividades").delete().eq("id", id);
  if (error) throw error;
}

async function createIndicator(payload) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("indicadores_actividad").insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function updateIndicator(record, payload) {
  return updateWithVersion({ table: "indicadores_actividad", record, payload, entityType: "Indicador", entityName: record?.nombre || record?.codigo || null });
}

async function deleteIndicator(id) {
  const supabase = requireSupabase();
  const { error } = await supabase.from("indicadores_actividad").delete().eq("id", id);
  if (error) throw error;
}

async function addIndicatorFollowup(payload) {
  const supabase = requireSupabase();
  const { error } = await supabase.from("seguimientos_indicador").insert(payload);
  if (error) throw error;
}

async function createBudgetItem(payload) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("presupuesto_actividad_rubros").insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function updateBudgetItem(record, payload) {
  return updateWithVersion({ table: "presupuesto_actividad_rubros", record, payload, entityType: "Rubro presupuestal", entityName: record?.rubro || null });
}

async function deleteBudgetItem(id) {
  const supabase = requireSupabase();
  const { error } = await supabase.from("presupuesto_actividad_rubros").delete().eq("id", id);
  if (error) throw error;
}

async function createEvidence(payload) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("evidencias_actividad").insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function updateEvidence(record, payload) {
  return updateWithVersion({ table: "evidencias_actividad", record, payload, entityType: "Evidencia", entityName: record?.nombre || null });
}

async function createActivityFollowup(payload) {
  const supabase = requireSupabase();
  const { error } = await supabase.from("seguimientos_actividad").insert(payload);
  if (error) throw error;
}

async function getActivityDependencyCounts(activityId) {
  const supabase = requireSupabase();
  const tables = [
    ["indicadores_actividad", "actividad_id"],
    ["presupuesto_actividad_rubros", "actividad_id"],
    ["evidencias_actividad", "actividad_id"],
    ["seguimientos_actividad", "actividad_id"]
  ];
  const counts = {};
  for (const [table, field] of tables) {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(field, activityId);
    if (error) throw error;
    counts[table] = Number(count || 0);
  }
  return counts;
}

async function getIndicatorDependencyCounts(indicatorId) {
  const supabase = requireSupabase();
  const { count: followups, error: fError } = await supabase.from("seguimientos_indicador").select("id", { count: "exact", head: true }).eq("indicador_id", indicatorId);
  if (fError) throw fError;
  const { count: evidence, error: eError } = await supabase.from("evidencias_actividad").select("id", { count: "exact", head: true }).eq("indicador_id", indicatorId);
  if (eError) throw eError;
  return { followups: Number(followups || 0), evidence: Number(evidence || 0) };
}

// ------------------------- formularios -------------------------
function openActivityForm({ projectId, record = null, onSaved }) {
  const editing = Boolean(record);
  openModal({
    title: editing ? "Editar actividad" : "Nueva actividad",
    content: `
      <form id="activityForm">
        <div class="form-grid">
          <div class="form-field"><label>Código</label><input name="codigo" value="${escapeHTML(record?.codigo || "")}" placeholder="Ej. A1"></div>
          <div class="form-field"><label>Orden</label><input name="orden" type="number" min="0" step="1" value="${Number(record?.orden ?? 0)}"></div>
          <div class="form-field full"><label>Nombre de la actividad</label><input name="nombre" required value="${escapeHTML(record?.nombre || "")}"></div>
          <div class="form-field full"><label>Descripción</label><textarea name="descripcion">${escapeHTML(record?.descripcion || "")}</textarea></div>
          <div class="form-field full"><label>Responsable</label><input name="responsable" value="${escapeHTML(record?.responsable || "")}"></div>
          <div class="form-field"><label>Fecha de inicio</label><input name="fecha_inicio" type="date" value="${escapeHTML(record?.fecha_inicio || "")}"></div>
          <div class="form-field"><label>Fecha de cierre</label><input name="fecha_fin" type="date" value="${escapeHTML(record?.fecha_fin || "")}"></div>
          <div class="form-field"><label>Estado</label><select name="estado">
            ${option("borrador", "Borrador", (record?.estado || "borrador") === "borrador")}
            ${option("programada", "Programada", record?.estado === "programada")}
            ${option("en_ejecucion", "En ejecución", record?.estado === "en_ejecucion")}
            ${option("suspendida", "Suspendida", record?.estado === "suspendida")}
            ${option("completada", "Completada", record?.estado === "completada")}
            ${option("cancelada", "Cancelada", record?.estado === "cancelada")}
          </select></div>
        </div>
        <p id="activityMessage" class="form-message"></p>
        <div class="form-actions"><button id="cancelActivity" class="btn btn-secondary" type="button">Cancelar</button><button class="btn btn-primary" type="submit">${editing ? "Guardar cambios" : "Crear actividad"}</button></div>
      </form>`
  });

  const form = document.querySelector("#activityForm");
  const message = document.querySelector("#activityMessage");
  document.querySelector("#cancelActivity").addEventListener("click", closeModal);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const payload = {
      codigo: data.get("codigo")?.trim() || null,
      nombre: data.get("nombre")?.trim(),
      descripcion: data.get("descripcion")?.trim() || null,
      responsable: data.get("responsable")?.trim() || null,
      fecha_inicio: data.get("fecha_inicio") || null,
      fecha_fin: data.get("fecha_fin") || null,
      estado: data.get("estado"),
      orden: Number(data.get("orden") || 0)
    };
    if (!payload.nombre) { message.textContent = "El nombre de la actividad es obligatorio."; return; }
    if (payload.fecha_inicio && payload.fecha_fin && payload.fecha_fin < payload.fecha_inicio) { message.textContent = "La fecha final no puede ser anterior a la fecha inicial."; return; }
    if (!editing) payload.proyecto_id = projectId;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";
    try {
      if (editing) await updateActivity(record, payload); else await createActivity(payload);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible guardar la actividad.";
      submit.disabled = false;
      submit.textContent = editing ? "Guardar cambios" : "Crear actividad";
    }
  });
}

function openIndicatorForm({ activityId, record = null, onSaved }) {
  const editing = Boolean(record);
  openModal({
    title: editing ? "Editar indicador" : "Nuevo indicador",
    content: `
      <form id="indicatorForm">
        <div class="form-grid">
          <div class="form-field"><label>Código</label><input name="codigo" value="${escapeHTML(record?.codigo || "")}" placeholder="Ej. I1"></div>
          <div class="form-field"><label>Orden</label><input name="orden" type="number" min="0" step="1" value="${Number(record?.orden ?? 0)}"></div>
          <div class="form-field full"><label>Indicador</label><input name="nombre" required value="${escapeHTML(record?.nombre || "")}"></div>
          <div class="form-field full"><label>Descripción</label><textarea name="descripcion">${escapeHTML(record?.descripcion || "")}</textarea></div>
          <div class="form-field"><label>Unidad de medida</label><input name="unidad_medida" value="${escapeHTML(record?.unidad_medida || "")}" placeholder="Número, %, jornadas..."></div>
          <div class="form-field"><label>Sentido</label><select name="sentido">${option("ascendente", "Ascendente", (record?.sentido || "ascendente") === "ascendente")}${option("descendente", "Descendente", record?.sentido === "descendente")}</select></div>
          <div class="form-field"><label>Línea base</label><input name="linea_base" type="number" step="0.0001" required value="${Number(record?.linea_base ?? 0)}"></div>
          <div class="form-field"><label>Meta</label><input name="meta" type="number" step="0.0001" required value="${record?.meta ?? ""}"></div>
          <div class="form-field"><label>Estado</label><select name="estado">${option("activo", "Activo", (record?.estado || "activo") === "activo")}${option("inactivo", "Inactivo", record?.estado === "inactivo")}</select></div>
        </div>
        <p class="field-help">El valor alcanzado se actualiza mediante registros de seguimiento.</p>
        <p id="indicatorMessage" class="form-message"></p>
        <div class="form-actions"><button id="cancelIndicator" class="btn btn-secondary" type="button">Cancelar</button><button class="btn btn-primary" type="submit">${editing ? "Guardar cambios" : "Crear indicador"}</button></div>
      </form>`
  });

  const form = document.querySelector("#indicatorForm");
  const message = document.querySelector("#indicatorMessage");
  document.querySelector("#cancelIndicator").addEventListener("click", closeModal);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const base = Number(data.get("linea_base"));
    const meta = Number(data.get("meta"));
    if (!Number.isFinite(base) || !Number.isFinite(meta)) { message.textContent = "Línea base y meta deben ser valores numéricos."; return; }
    if (Math.abs(meta - base) < 1e-12) { message.textContent = "La meta debe ser diferente de la línea base."; return; }
    const payload = {
      codigo: data.get("codigo")?.trim() || null,
      nombre: data.get("nombre")?.trim(),
      descripcion: data.get("descripcion")?.trim() || null,
      unidad_medida: data.get("unidad_medida")?.trim() || null,
      linea_base: base,
      meta,
      sentido: data.get("sentido"),
      estado: data.get("estado"),
      orden: Number(data.get("orden") || 0)
    };
    if (!payload.nombre) { message.textContent = "El nombre del indicador es obligatorio."; return; }
    if (!editing) { payload.actividad_id = activityId; payload.valor_actual = base; }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";
    try {
      if (editing) await updateIndicator(record, payload); else await createIndicator(payload);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible guardar el indicador.";
      submit.disabled = false;
      submit.textContent = editing ? "Guardar cambios" : "Crear indicador";
    }
  });
}

function openIndicatorFollowup({ indicator, onSaved }) {
  openModal({
    title: "Registrar avance del indicador",
    content: `
      <div class="modal-context-block"><span>Indicador</span><strong>${escapeHTML(indicator.codigo || indicator.nombre)}</strong><p>${escapeHTML(indicator.nombre)}</p></div>
      <form id="indicatorFollowupForm">
        <div class="form-grid">
          <div class="form-field"><label>Fecha de corte</label><input name="fecha_corte" type="date" required value="${todayISO()}"></div>
          <div class="form-field"><label>Valor alcanzado</label><input name="valor" type="number" step="0.0001" required value="${Number(indicator.valor_actual ?? indicator.linea_base ?? 0)}"></div>
          <div class="form-field full"><label>Observación</label><textarea name="observacion"></textarea></div>
        </div>
        <p id="indicatorFollowupMessage" class="form-message"></p>
        <div class="form-actions"><button id="cancelIndicatorFollowup" class="btn btn-secondary" type="button">Cancelar</button><button class="btn btn-primary" type="submit">Registrar avance</button></div>
      </form>`
  });
  const form = document.querySelector("#indicatorFollowupForm");
  const message = document.querySelector("#indicatorFollowupMessage");
  document.querySelector("#cancelIndicatorFollowup").addEventListener("click", closeModal);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const value = Number(data.get("valor"));
    if (!Number.isFinite(value)) { message.textContent = "El valor alcanzado debe ser numérico."; return; }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";
    try {
      await addIndicatorFollowup({ indicador_id: indicator.id, fecha_corte: data.get("fecha_corte"), valor: value, observacion: data.get("observacion")?.trim() || null });
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible registrar el avance.";
      submit.disabled = false;
      submit.textContent = "Registrar avance";
    }
  });
}

function openBudgetForm({ activityId, record = null, onSaved }) {
  const editing = Boolean(record);
  openModal({
    title: editing ? "Editar rubro" : "Nuevo rubro presupuestal",
    content: `
      <form id="budgetForm">
        <div class="form-grid">
          <div class="form-field full"><label>Rubro</label><input name="rubro" required value="${escapeHTML(record?.rubro || "")}"></div>
          <div class="form-field full"><label>Descripción</label><textarea name="descripcion">${escapeHTML(record?.descripcion || "")}</textarea></div>
          <div class="form-field"><label>Programado (COP)</label><input name="programado" type="number" min="0" step="0.01" required value="${Number(record?.programado ?? 0)}"></div>
          <div class="form-field"><label>Ejecutado (COP)</label><input name="ejecutado" type="number" min="0" step="0.01" required value="${Number(record?.ejecutado ?? 0)}"></div>
          <div class="form-field"><label>Estado</label><select name="estado">${option("activo", "Activo", (record?.estado || "activo") === "activo")}${option("inactivo", "Inactivo", record?.estado === "inactivo")}</select></div>
          <div class="form-field"><label>Orden</label><input name="orden" type="number" min="0" step="1" value="${Number(record?.orden ?? 0)}"></div>
        </div>
        <p id="budgetMessage" class="form-message"></p>
        <div class="form-actions"><button id="cancelBudget" class="btn btn-secondary" type="button">Cancelar</button><button class="btn btn-primary" type="submit">${editing ? "Guardar cambios" : "Crear rubro"}</button></div>
      </form>`
  });

  const form = document.querySelector("#budgetForm");
  const message = document.querySelector("#budgetMessage");
  document.querySelector("#cancelBudget").addEventListener("click", closeModal);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const planned = Number(data.get("programado"));
    const executed = Number(data.get("ejecutado"));
    if (![planned, executed].every(Number.isFinite) || planned < 0 || executed < 0) {
      message.textContent = "Los valores presupuestales deben ser números iguales o mayores a cero.";
      return;
    }
    const payload = {
      rubro: data.get("rubro")?.trim(),
      descripcion: data.get("descripcion")?.trim() || null,
      programado: planned,
      ejecutado: executed,
      estado: data.get("estado"),
      orden: Number(data.get("orden") || 0)
    };
    if (!payload.rubro) { message.textContent = "El rubro es obligatorio."; return; }
    if (!editing) payload.actividad_id = activityId;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";
    try {
      if (editing) await updateBudgetItem(record, payload); else await createBudgetItem(payload);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible guardar el rubro.";
      submit.disabled = false;
      submit.textContent = editing ? "Guardar cambios" : "Crear rubro";
    }
  });
}

function openEvidenceForm({ activityId, indicators, record = null, onSaved }) {
  const editing = Boolean(record);
  openModal({
    title: editing ? "Editar evidencia" : "Nueva evidencia",
    content: `
      <form id="evidenceForm">
        <div class="form-grid">
          <div class="form-field full"><label>Nombre</label><input name="nombre" required value="${escapeHTML(record?.nombre || "")}"></div>
          <div class="form-field"><label>Tipo de evidencia</label><input name="tipo" value="${escapeHTML(record?.tipo || "")}" placeholder="Acta, informe, fotografía..."></div>
          <div class="form-field"><label>Fecha</label><input name="fecha" type="date" value="${escapeHTML(record?.fecha || "")}"></div>
          <div class="form-field full"><label>Indicador relacionado</label><select name="indicador_id"><option value="">Evidencia general de la actividad</option>${indicators.map((indicator) => option(indicator.id, `${indicator.codigo || "Indicador"} · ${indicator.nombre}`, record?.indicador_id === indicator.id)).join("")}</select></div>
          <div class="form-field full"><label>Descripción</label><textarea name="descripcion">${escapeHTML(record?.descripcion || "")}</textarea></div>
          <div class="form-field full"><label>URL / enlace al soporte</label><input name="url" type="url" value="${escapeHTML(record?.url || "")}" placeholder="https://..."></div>
          <div class="form-field full"><label>Observaciones</label><textarea name="observaciones">${escapeHTML(record?.observaciones || "")}</textarea></div>
        </div>
        <p id="evidenceMessage" class="form-message"></p>
        <div class="form-actions"><button id="cancelEvidence" class="btn btn-secondary" type="button">Cancelar</button><button class="btn btn-primary" type="submit">${editing ? "Guardar cambios" : "Crear evidencia"}</button></div>
      </form>`
  });
  const form = document.querySelector("#evidenceForm");
  const message = document.querySelector("#evidenceMessage");
  document.querySelector("#cancelEvidence").addEventListener("click", closeModal);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const payload = {
      nombre: data.get("nombre")?.trim(),
      tipo: data.get("tipo")?.trim() || null,
      fecha: data.get("fecha") || null,
      indicador_id: data.get("indicador_id") || null,
      descripcion: data.get("descripcion")?.trim() || null,
      url: data.get("url")?.trim() || null,
      observaciones: data.get("observaciones")?.trim() || null
    };
    if (!payload.nombre) { message.textContent = "El nombre de la evidencia es obligatorio."; return; }
    if (!editing) { payload.actividad_id = activityId; payload.estado = "activa"; }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";
    try {
      if (editing) await updateEvidence(record, payload); else await createEvidence(payload);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible guardar la evidencia.";
      submit.disabled = false;
      submit.textContent = editing ? "Guardar cambios" : "Crear evidencia";
    }
  });
}

function openActivityFollowup({ activityId, onSaved }) {
  openModal({
    title: "Nuevo seguimiento de actividad",
    content: `
      <form id="activityFollowupForm">
        <div class="form-grid">
          <div class="form-field"><label>Fecha de corte</label><input name="fecha_corte" type="date" required value="${todayISO()}"></div>
          <div class="form-field full"><label>Resumen</label><textarea name="resumen"></textarea></div>
          <div class="form-field full"><label>Logros</label><textarea name="logros"></textarea></div>
          <div class="form-field full"><label>Dificultades</label><textarea name="dificultades"></textarea></div>
          <div class="form-field full"><label>Próximos pasos</label><textarea name="proximos_pasos"></textarea></div>
        </div>
        <p id="activityFollowupMessage" class="form-message"></p>
        <div class="form-actions"><button id="cancelActivityFollowup" class="btn btn-secondary" type="button">Cancelar</button><button class="btn btn-primary" type="submit">Guardar seguimiento</button></div>
      </form>`
  });
  const form = document.querySelector("#activityFollowupForm");
  const message = document.querySelector("#activityFollowupMessage");
  document.querySelector("#cancelActivityFollowup").addEventListener("click", closeModal);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";
    try {
      await createActivityFollowup({
        actividad_id: activityId,
        fecha_corte: data.get("fecha_corte"),
        resumen: data.get("resumen")?.trim() || null,
        logros: data.get("logros")?.trim() || null,
        dificultades: data.get("dificultades")?.trim() || null,
        proximos_pasos: data.get("proximos_pasos")?.trim() || null
      });
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible guardar el seguimiento.";
      submit.disabled = false;
      submit.textContent = "Guardar seguimiento";
    }
  });
}

export async function renderProyectoWorkspace(container, options) {
  const { projectId, vigencia, vigenciaConsejeria, linea, programa, onBack, onProjectChanged } = options;

  let project = null;
  let mandateIds = [];
  let availableMandates = [];
  let activities = [];
  let indicators = [];
  let budgetItems = [];
  let evidence = [];
  let projectTab = options.initialProjectTab || "perfil";
  let currentActivityId = options.initialActivityId || null;
  let activityTab = options.initialActivityTab || "general";
  const initialAnchor = options.initialAnchor || null;
  let showToast = () => {};

  function currentActivity() {
    return activities.find((item) => item.id === currentActivityId);
  }
  function indicatorsForActivity(activityId) { return indicators.filter((item) => item.actividad_id === activityId); }
  function budgetForActivity(activityId) { return budgetItems.filter((item) => item.actividad_id === activityId); }
  function evidenceForActivity(activityId) { return evidence.filter((item) => item.actividad_id === activityId); }

  async function loadProjectData() {
    [project, mandateIds, availableMandates] = await Promise.all([
      getProject(projectId),
      getProjectMandateIds(projectId),
      getMandatosConsejeria(vigenciaConsejeria.id)
    ]);
    await reloadOperationalData();
  }

  async function reloadOperationalData() {
    activities = await getActivities(projectId);
    const ids = activities.map((item) => item.id);
    [indicators, budgetItems, evidence] = await Promise.all([
      getIndicatorsByActivities(ids),
      getBudgetByActivities(ids),
      getEvidenceByActivities(ids)
    ]);
  }

  function projectMetrics() {
    return calculateProjectMetrics(activities, indicators, budgetItems);
  }

  function headerHTML() {
    const metrics = projectMetrics();
    const contribution = metrics.technicalProgress === null ? null : metrics.technicalProgress * Number(project.ponderacion || 0) / 100;
    const detailedBudget = metrics.budget.programmed > 0 ? metrics.budget.programmed : null;
    return `
      <div class="project-workspace-breadcrumbs">
        <span>${escapeHTML(vigencia.nombre)}</span><span>›</span><span>${escapeHTML(vigenciaConsejeria.consejerias.nombre_corto)}</span><span>›</span><span>${escapeHTML(linea.nombre)}</span><span>›</span><span>${escapeHTML(programa.nombre)}</span>
      </div>
      <div class="project-workspace-title-row">
        <div><p class="eyebrow">${escapeHTML(project.codigo || project.nombre_corto || "Proyecto")}</p><h2>${escapeHTML(project.nombre)}</h2></div>

        <div class="project-workspace-header-actions">
          <button
            id="projectDocumentReportButton"
            class="btn btn-secondary document-report-button"
            type="button"
          >
            ${documentReportIcon()}
            Generar documento
          </button>

          ${projectStatusChip(project.estado)}
        </div>
      </div>
      <div class="workspace-metrics">
        <div class="workspace-metric"><span>Ponderación</span><strong>${formatPercent(project.ponderacion)}</strong><small>Dentro del Programa</small></div>
        <div class="workspace-metric"><span>Cumplimiento técnico</span><strong>${formatPercent(metrics.technicalProgress)}</strong><small>${metrics.includedCount ? `${metrics.measurableCount}/${metrics.includedCount} actividades medibles` : "Sin actividades"}</small></div>
        <div class="workspace-metric"><span>Contribución</span><strong>${formatPercent(contribution)}</strong><small>Al Programa</small></div>
        <div class="workspace-metric"><span>Presupuesto detallado</span><strong>${detailedBudget !== null ? formatMoney(detailedBudget) : formatMoney(project.valor_estimado)}</strong><small>${detailedBudget !== null ? "Suma de actividades" : "Estimación del perfil"}</small></div>
        <div class="workspace-metric"><span>Ejecución presupuestal</span><strong>${formatPercent(metrics.budget.execution)}</strong><small>${formatMoney(metrics.budget.executed)} ejecutado</small></div>
      </div>`;
  }

  function projectNavigationHTML() {
    return `
      <nav class="project-workspace-tabs" aria-label="Secciones del Proyecto">
        <button class="${projectTab === "perfil" ? "active" : ""}" data-project-tab="perfil" type="button">Perfil</button>
        <button class="${projectTab === "actividades" ? "active" : ""}" data-project-tab="actividades" type="button">Actividades <span>${activities.length}</span></button>
        <button class="${projectTab === "seguimiento" ? "active" : ""}" data-project-tab="seguimiento" type="button">Seguimiento</button>
      </nav>`;
  }

  function bindToast() {
    const toast = container.querySelector("#projectWorkspaceToast");
    showToast = (text) => {
      toast.textContent = text;
      toast.classList.remove("hidden");
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3200);
    };
  }

  function renderShell() {
    container.innerHTML = `
      <section class="project-workspace">
        <button id="backToProjects" class="workspace-back-button" type="button">${arrowIcon()} Volver a Proyectos</button>
        <header class="project-workspace-header">${headerHTML()}</header>
        ${projectNavigationHTML()}
        <div id="projectWorkspaceBody"></div>
      </section>
      <div id="projectWorkspaceToast" class="app-toast hidden" role="status"></div>`;
    bindToast();
    container.querySelector("#backToProjects").addEventListener("click", async () => {
      if (typeof onProjectChanged === "function") await onProjectChanged();
      await onBack();
    });

    container
      .querySelector(
        "#projectDocumentReportButton"
      )
      ?.addEventListener(
        "click",
        () => {
          openDocumentReportDialog({
            scope: "proyecto",
            vigenciaId: vigencia.id,
            context: {
              projectId: project.id,
              projectCode:
                project.codigo || "",
              projectName:
                project.nombre,
              consejeriaRef:
                vigenciaConsejeria.id,
              consejeriaName:
                vigenciaConsejeria
                  .consejerias
                  .nombre_corto,
              lineName:
                linea.nombre,
              programName:
                programa.nombre
            }
          });
        }
      );

    container.querySelectorAll("[data-project-tab]").forEach((button) => {
      button.addEventListener("click", () => { projectTab = button.dataset.projectTab; renderProjectTab(); });
    });
    renderProjectTab();
  }

  function renderProfile() {
    const body = container.querySelector("#projectWorkspaceBody");
    body.innerHTML = `
      <form id="projectProfileForm" class="workspace-form-page">
        <section class="workspace-section">
          <div class="workspace-section-heading"><div><p class="eyebrow">Perfil</p><h3>Identificación del Proyecto</h3></div></div>
          <div class="workspace-form-grid">
            <div class="form-field"><label>Código</label><input name="codigo" value="${escapeHTML(project.codigo || "")}"></div>
            <div class="form-field"><label>Nombre corto</label><input name="nombre_corto" value="${escapeHTML(project.nombre_corto || "")}"></div>
            <div class="form-field full"><label>Nombre del Proyecto</label><input name="nombre" required value="${escapeHTML(project.nombre || "")}"></div>
            <div class="form-field full"><label>Descripción</label><textarea name="descripcion" rows="5">${escapeHTML(project.descripcion || "")}</textarea></div>
          </div>
        </section>
        <section class="workspace-section">
          <div class="workspace-section-heading"><div><p class="eyebrow">Orientación</p><h3>Objetivo y responsabilidad</h3></div></div>
          <div class="workspace-form-grid">
            <div class="form-field full"><label>Objetivo del Proyecto</label><textarea id="projectObjectiveField" name="objetivo_general" rows="6">${escapeHTML(project.objetivo_general || "")}</textarea></div>
            <div class="form-field full"><label>Responsable / coordinación</label><input name="responsable" value="${escapeHTML(project.responsable || "")}"></div>
            <div class="form-field"><label>Fecha de inicio</label><input name="fecha_inicio" type="date" value="${escapeHTML(project.fecha_inicio || "")}"></div>
            <div class="form-field"><label>Fecha de cierre</label><input name="fecha_fin" type="date" value="${escapeHTML(project.fecha_fin || "")}"></div>
            <div class="form-field"><label>Estado</label><select name="estado">${option("borrador", "Borrador", project.estado === "borrador")}${option("formulacion", "Formulación", project.estado === "formulacion")}${option("activo", "Activo", project.estado === "activo")}${option("suspendido", "Suspendido", project.estado === "suspendido")}${option("cerrado", "Cerrado", project.estado === "cerrado")}</select></div>
            <div class="form-field"><label>Ponderación dentro del Programa</label><div class="percent-input"><input name="ponderacion" type="number" min="0" max="100" step="0.01" value="${Number(project.ponderacion || 0).toFixed(2)}" readonly><span>%</span></div><small class="field-help">Se administra y aprueba desde el módulo Ponderaciones.</small></div>
            <div class="form-field"><label>Orden</label><input name="orden" type="number" min="0" step="1" value="${Number(project.orden || 0)}"></div>
          </div>
        </section>
        <section class="workspace-section">
          <div class="workspace-section-heading"><div><p class="eyebrow">Articulación</p><h3>Mandatos relacionados</h3></div></div>
          <div class="project-mandates-grid workspace-mandates-grid">
            ${availableMandates.length ? availableMandates.map((mandato) => `<label class="project-mandate-check ${mandato.estado === "archivado" ? "is-archived" : ""}"><input type="checkbox" name="mandatos" value="${mandato.id}" ${mandateIds.includes(mandato.id) ? "checked" : ""}><span><strong>${escapeHTML(mandato.codigo || mandato.titulo || "Mandato")}</strong><small>${escapeHTML(mandato.titulo || mandato.texto)}</small></span></label>`).join("") : `<div class="empty-inline">Esta Consejería no tiene Mandatos disponibles en la Vigencia.</div>`}
          </div>
        </section>
        <section class="workspace-section">
          <div class="workspace-section-heading"><div><p class="eyebrow">Financiación</p><h3>Información preliminar del perfil</h3></div><p class="muted">El presupuesto definitivo se consolida desde las Actividades.</p></div>
          <div class="workspace-form-grid">
            <div class="form-field"><label class="checkbox-inline"><input id="profileFinanced" name="tiene_financiacion" type="checkbox" ${project.tiene_financiacion ? "checked" : ""}><span>Tiene financiación</span></label></div>
            <div class="form-field"><label>Valor estimado del perfil (COP)</label><input id="profileEstimatedValue" name="valor_estimado" type="number" min="0" step="0.01" value="${project.valor_estimado ?? ""}"></div>
          </div>
        </section>
        <div class="workspace-form-footer"><p id="profileMessage" class="form-message"></p><button class="btn btn-primary" type="submit">Guardar Perfil</button></div>
      </form>`;

    const form = body.querySelector("#projectProfileForm");
    const financed = body.querySelector("#profileFinanced");
    const estimated = body.querySelector("#profileEstimatedValue");
    const message = body.querySelector("#profileMessage");
    const syncFinance = () => { estimated.disabled = !financed.checked; if (!financed.checked) estimated.value = ""; };
    financed.addEventListener("change", syncFinance);
    syncFinance();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const start = data.get("fecha_inicio") || null;
      const end = data.get("fecha_fin") || null;
      if (start && end && end < start) { message.textContent = "La fecha final no puede ser anterior a la fecha inicial."; return; }
      const selectedMandates = [...form.querySelectorAll('input[name="mandatos"]:checked')].map((input) => input.value);
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Guardando…";
      try {
        project = await updateProject(project, {
          codigo: data.get("codigo")?.trim() || null,
          nombre: data.get("nombre")?.trim(),
          nombre_corto: data.get("nombre_corto")?.trim() || null,
          descripcion: data.get("descripcion")?.trim() || null,
          objetivo_general: data.get("objetivo_general")?.trim() || null,
          responsable: data.get("responsable")?.trim() || null,
          fecha_inicio: start,
          fecha_fin: end,
          estado: data.get("estado"),
          orden: Number(data.get("orden") || 0),
          tiene_financiacion: financed.checked,
          valor_estimado: financed.checked && data.get("valor_estimado") !== "" ? Number(data.get("valor_estimado")) : null
        }, selectedMandates);
        mandateIds = selectedMandates;
        renderShell();
        projectTab = "perfil";
        renderProjectTab();
        showToast("Perfil del Proyecto actualizado.");
      } catch (error) {
        console.error(error);
        message.textContent = error.message || "No fue posible guardar el Perfil.";
        submit.disabled = false;
        submit.textContent = "Guardar Perfil";
      }
    });
  }

  async function deleteActivitySafely(activity) {
    let counts;
    try {
      counts = await getActivityDependencyCounts(activity.id);
    } catch (error) {
      console.error(error);
      showToast("No fue posible verificar las dependencias de la actividad.");
      return;
    }

    const totalDependencies = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);

    if (totalDependencies > 0) {
      openModal({
        title: "La actividad tiene información asociada",
        content: `
          <div class="danger-callout"><strong>${escapeHTML(activity.codigo || activity.nombre)}</strong><p>Esta actividad ya tiene indicadores, presupuesto, evidencias o seguimientos. No puede eliminarse físicamente porque se perdería la trazabilidad.</p></div>
          <p class="muted">Puedes marcarla como <strong>Cancelada</strong>. Toda su información permanecerá disponible.</p>
          <p id="activityProtectionMessage" class="form-message"></p>
          <div class="form-actions"><button id="cancelProtectedActivity" class="btn btn-secondary" type="button">Cerrar</button>${activity.estado !== "cancelada" ? `<button id="cancelActivityRecord" class="btn btn-danger" type="button">Marcar como cancelada</button>` : ""}</div>`
      });
      document.querySelector("#cancelProtectedActivity").addEventListener("click", closeModal);
      const cancelButton = document.querySelector("#cancelActivityRecord");
      if (cancelButton) {
        cancelButton.addEventListener("click", async () => {
          cancelButton.disabled = true;
          cancelButton.textContent = "Actualizando…";
          try {
            await updateActivity(activity, { estado: "cancelada" });
            closeModal();
            await reloadOperationalData();
            renderActivities();
            showToast("Actividad marcada como cancelada.");
          } catch (error) {
            console.error(error);
            document.querySelector("#activityProtectionMessage").textContent = error.message || "No fue posible actualizar la actividad.";
            cancelButton.disabled = false;
            cancelButton.textContent = "Marcar como cancelada";
          }
        });
      }
      return;
    }

    openModal({
      title: "Eliminar actividad",
      content: `
        <div class="danger-callout"><strong>${escapeHTML(activity.codigo || activity.nombre)}</strong><p>Esta actividad todavía no tiene información operativa asociada. Puede eliminarse definitivamente.</p></div>
        <div class="form-field"><label>Escribe <strong>ELIMINAR</strong> para confirmar</label><input id="deleteActivityConfirmation" autocomplete="off" placeholder="ELIMINAR"></div>
        <p id="deleteActivityMessage" class="form-message"></p>
        <div class="form-actions"><button id="cancelDeleteActivity" class="btn btn-secondary" type="button">Cancelar</button><button id="confirmDeleteActivity" class="btn btn-danger" type="button" disabled>Eliminar actividad</button></div>`
    });

    const input = document.querySelector("#deleteActivityConfirmation");
    const confirm = document.querySelector("#confirmDeleteActivity");
    document.querySelector("#cancelDeleteActivity").addEventListener("click", closeModal);
    input.addEventListener("input", () => { confirm.disabled = input.value.trim().toUpperCase() !== "ELIMINAR"; });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      confirm.textContent = "Eliminando…";
      try {
        const freshCounts = await getActivityDependencyCounts(activity.id);
        const freshTotal = Object.values(freshCounts).reduce((sum, value) => sum + Number(value || 0), 0);
        if (freshTotal > 0) throw new Error("La actividad recibió información asociada y ya no puede eliminarse.");
        await deleteActivity(activity.id);
        closeModal();
        await reloadOperationalData();
        renderActivities();
        showToast("Actividad eliminada.");
      } catch (error) {
        console.error(error);
        document.querySelector("#deleteActivityMessage").textContent = error.message || "No fue posible eliminar la actividad.";
        confirm.disabled = false;
        confirm.textContent = "Eliminar actividad";
      }
    });
  }

  function renderActivities() {
    const body = container.querySelector("#projectWorkspaceBody");
    const metrics = projectMetrics();
    const indicatorsByActivity = new Map();
    indicators.forEach((indicator) => {
      if (!indicatorsByActivity.has(indicator.actividad_id)) indicatorsByActivity.set(indicator.actividad_id, []);
      indicatorsByActivity.get(indicator.actividad_id).push(indicator);
    });
    const budgetByActivity = new Map();
    budgetItems.forEach((item) => {
      if (!budgetByActivity.has(item.actividad_id)) budgetByActivity.set(item.actividad_id, []);
      budgetByActivity.get(item.actividad_id).push(item);
    });

    body.innerHTML = `
      <section class="workspace-section workspace-section-flush">
        <div class="workspace-section-heading">
          <div><p class="eyebrow">Ejecución</p><h3>Actividades del Proyecto</h3><p class="muted">El objetivo del Proyecto se cumple mediante estas actividades. Indicadores, presupuesto, evidencias y seguimiento pertenecen a cada actividad.</p></div>
          <button id="newActivityButton" class="btn btn-primary" type="button">+ Nueva actividad</button>
        </div>
        ${activities.length ? `<div class="activity-work-grid">${activities.map((activity) => {
          const activityIndicators = indicatorsByActivity.get(activity.id) || [];
          const budgetMetric = calculateBudgetMetrics(budgetByActivity.get(activity.id) || []);
          const progress = metrics.progressByActivity.get(activity.id);
          const weight = Number(metrics.weights.get(activity.id) || 0);
          const evidenceCount = evidenceForActivity(activity.id).filter((item) => item.estado === "activa").length;
          return `
            <article class="activity-work-card ${activity.estado === "cancelada" ? "is-cancelled" : ""}">
              <div class="activity-work-card-header"><div><p class="eyebrow">${escapeHTML(activity.codigo || `Actividad ${Number(activity.orden || 0) + 1}`)}</p><h4>${escapeHTML(activity.nombre)}</h4></div>${activityStatusChip(activity.estado)}</div>
              <p class="muted activity-work-description">${escapeHTML(activity.descripcion || "Sin descripción registrada.")}</p>
              <div class="activity-work-metrics">
                <div><span>Peso técnico</span><strong>${formatPercent(weight)}</strong><small>Automático</small></div>
                <div><span>Cumplimiento</span><strong>${formatPercent(progress)}</strong><small>${activityIndicators.filter((i) => i.estado === "activo").length} indicadores</small></div>
                <div><span>Presupuesto</span><strong>${formatMoney(budgetMetric.programmed)}</strong><small>${formatPercent(budgetMetric.execution)} ejecutado</small></div>
                <div><span>Evidencias</span><strong>${evidenceCount}</strong><small>Activas</small></div>
              </div>
              <div class="activity-work-detail"><span>Responsable<strong>${escapeHTML(activity.responsable || "Sin registrar")}</strong></span><span>Periodo<strong>${formatDate(activity.fecha_inicio)} – ${formatDate(activity.fecha_fin)}</strong></span></div>
              <div class="entity-actions">
                <button class="btn btn-primary open-activity" type="button" data-id="${activity.id}">Abrir actividad ${openIcon()}</button>
                <button class="btn btn-secondary audit-activity-note" type="button" data-id="${activity.id}">Nota</button>
                <button class="btn btn-secondary edit-activity" type="button" data-id="${activity.id}">Editar</button>
                <button class="icon-btn danger delete-activity" type="button" data-id="${activity.id}" title="Eliminar actividad">${trashIcon()}</button>
              </div>
            </article>`;
        }).join("")}</div>` : `<div class="empty-state workspace-empty"><strong>El Proyecto todavía no tiene actividades.</strong><p>Crea la primera actividad para comenzar la formulación operativa.</p></div>`}
      </section>`;

    body.querySelector("#newActivityButton").addEventListener("click", () => {
      openActivityForm({ projectId: project.id, onSaved: async () => { await reloadOperationalData(); renderActivities(); showToast("Actividad creada."); } });
    });
    body.querySelectorAll(".open-activity").forEach((button) => button.addEventListener("click", () => { currentActivityId = button.dataset.id; activityTab = "general"; renderActivityWorkspace(); }));
    body.querySelectorAll(".audit-activity-note").forEach((button) => button.addEventListener("click", () => {
      const activity = activities.find((item) => item.id === button.dataset.id);
      if (!activity) return;

      openAuditPanel({
        newNote: true,
        contextOverride: {
          vigenciaId: vigencia.id,
          vigenciaNombre: vigencia.nombre,
          entidadTipo: "actividad",
          entidadId: activity.id,
          entidadNombre: activity.nombre,
          seccion: "general",
          ruta: `${vigencia.nombre} › ${vigenciaConsejeria.consejerias.nombre_corto} › ${linea.nombre} › ${programa.nombre} › ${project.nombre} › ${activity.nombre}`,
          navigation: {
            ...baseAuditNavigation(),
            project_tab: "actividades",
            actividad_id: activity.id,
            actividad_codigo: activity.codigo || "",
            actividad_nombre: activity.nombre,
            activity_tab: "general"
          },
          sectionOptions: [
            { value: "general", label: "General", navigation: { activity_tab: "general" } },
            { value: "indicadores", label: "Indicadores", navigation: { activity_tab: "indicadores" } },
            { value: "presupuesto", label: "Presupuesto", navigation: { activity_tab: "presupuesto" } },
            { value: "evidencias", label: "Evidencias", navigation: { activity_tab: "evidencias" } },
            { value: "seguimiento", label: "Seguimiento", navigation: { activity_tab: "seguimiento" } }
          ]
        }
      });
    }));

    body.querySelectorAll(".edit-activity").forEach((button) => button.addEventListener("click", () => {
      const activity = activities.find((item) => item.id === button.dataset.id);
      openActivityForm({ projectId: project.id, record: activity, onSaved: async () => { await reloadOperationalData(); renderActivities(); showToast("Actividad actualizada."); } });
    }));
    body.querySelectorAll(".delete-activity").forEach((button) => button.addEventListener("click", () => {
      const activity = activities.find((item) => item.id === button.dataset.id);
      deleteActivitySafely(activity);
    }));
  }

  function renderProjectTracking() {
    const body = container.querySelector("#projectWorkspaceBody");
    const metrics = projectMetrics();
    body.innerHTML = `
      <section class="workspace-section workspace-section-flush">
        <div class="workspace-section-heading"><div><p class="eyebrow">Consolidado</p><h3>Seguimiento del Proyecto</h3><p class="muted">El avance técnico proviene de los indicadores de las Actividades. La ejecución financiera se presenta por separado.</p></div></div>
        <div class="tracking-summary-grid">
          <div class="tracking-summary-card"><span>Cumplimiento técnico</span><strong>${formatPercent(metrics.technicalProgress)}</strong><small>${metrics.includedCount ? `${metrics.measurableCount} de ${metrics.includedCount} actividades medibles` : "Sin actividades"}</small></div>
          <div class="tracking-summary-card"><span>Presupuesto programado</span><strong>${formatMoney(metrics.budget.programmed)}</strong><small>Suma de rubros activos</small></div>
          <div class="tracking-summary-card"><span>Presupuesto ejecutado</span><strong>${formatMoney(metrics.budget.executed)}</strong><small>${formatPercent(metrics.budget.execution)}</small></div>
          <div class="tracking-summary-card"><span>Contribución al Programa</span><strong>${metrics.technicalProgress === null ? "—" : formatPercent(metrics.technicalProgress * Number(project.ponderacion || 0) / 100)}</strong><small>Ponderación del Proyecto: ${formatPercent(project.ponderacion)}</small></div>
        </div>
        <div class="tracking-activities"><h4>Avance por actividad</h4>
          ${activities.filter((activity) => activity.estado !== "cancelada").length ? activities.filter((activity) => activity.estado !== "cancelada").map((activity) => {
            const progress = metrics.progressByActivity.get(activity.id);
            const weight = metrics.weights.get(activity.id);
            return `<div class="tracking-activity-row"><div><strong>${escapeHTML(activity.codigo || activity.nombre)}</strong><span>${escapeHTML(activity.nombre)}</span></div><div class="progress-track"><span class="progress-fill" style="width:${progress === null ? 0 : Math.min(100, Math.max(0, progress))}%"></span></div><strong>${formatPercent(progress)}</strong><small>Peso ${formatPercent(weight)}</small></div>`;
          }).join("") : `<div class="empty-inline">No hay actividades activas para consolidar.</div>`}
        </div>
        ${metrics.technicalProgress === null && metrics.includedCount > 0 ? `<div class="calculation-note"><strong>El cumplimiento aún no es calculable</strong><p>Para evitar un porcentaje engañoso, el sistema solo calcula el cumplimiento del Proyecto cuando todas las actividades no canceladas tienen al menos un indicador activo con una meta válida.</p></div>` : ""}
      </section>`;
  }

  function baseAuditNavigation() {
    return {
      view: "proyectos",
      vigencia_id: vigencia.id,
      vigencia_nombre: vigencia.nombre,
      vigencia_consejeria_id: vigenciaConsejeria.id,
      consejeria_nombre: vigenciaConsejeria.consejerias.nombre_corto,
      linea_id: linea.id,
      linea_nombre: linea.nombre,
      programa_id: programa.id,
      programa_nombre: programa.nombre,
      proyecto_id: project.id,
      proyecto_codigo: project.codigo || "",
      proyecto_nombre: project.nombre
    };
  }

  function syncProjectAuditContext() {
    const labels = {
      perfil: "Perfil",
      actividades: "Actividades",
      seguimiento: "Seguimiento"
    };

    setAuditContext({
      vigenciaId: vigencia.id,
      vigenciaNombre: vigencia.nombre,
      entidadTipo: "proyecto",
      entidadId: project.id,
      entidadNombre: project.nombre,
      seccion: projectTab,
      ruta: `${vigencia.nombre} › ${vigenciaConsejeria.consejerias.nombre_corto} › ${linea.nombre} › ${programa.nombre} › ${project.nombre} › ${labels[projectTab] || projectTab}`,
      navigation: {
        ...baseAuditNavigation(),
        project_tab: projectTab
      },
      sectionOptions: [
        {
          value: "perfil",
          label: "Perfil del Proyecto",
          navigation: { project_tab: "perfil" }
        },
        {
          value: "objetivo",
          label: "Objetivo del Proyecto",
          navigation: {
            project_tab: "perfil",
            anchor: "projectObjectiveField"
          }
        },
        {
          value: "actividades",
          label: "Actividades",
          navigation: { project_tab: "actividades" }
        },
        {
          value: "seguimiento",
          label: "Seguimiento",
          navigation: { project_tab: "seguimiento" }
        }
      ]
    });
  }

  function renderProjectTab() {
    if (currentActivityId) { renderActivityWorkspace(); return; }
    syncProjectAuditContext();
    container.querySelectorAll("[data-project-tab]").forEach((button) => button.classList.toggle("active", button.dataset.projectTab === projectTab));
    if (projectTab === "actividades") renderActivities();
    else if (projectTab === "seguimiento") renderProjectTracking();
    else renderProfile();
  }

  async function refreshCurrentActivityData() {
    await reloadOperationalData();
    if (currentActivityId && !activities.some((item) => item.id === currentActivityId)) currentActivityId = null;
  }

  function activityHeaderHTML(activity) {
    const activityIndicators = indicatorsForActivity(activity.id);
    const progress = calculateActivityProgress(activityIndicators);
    const budget = calculateBudgetMetrics(budgetForActivity(activity.id));
    const metrics = projectMetrics();
    const weight = Number(metrics.weights.get(activity.id) || 0);
    return `
      <div class="project-workspace-breadcrumbs"><span>${escapeHTML(project.codigo || project.nombre)}</span><span>›</span><span>Actividades</span><span>›</span><span>${escapeHTML(activity.codigo || activity.nombre)}</span></div>
      <div class="project-workspace-title-row"><div><p class="eyebrow">${escapeHTML(activity.codigo || "Actividad")}</p><h2>${escapeHTML(activity.nombre)}</h2></div>${activityStatusChip(activity.estado)}</div>
      <div class="workspace-metrics">
        <div class="workspace-metric"><span>Peso técnico</span><strong>${formatPercent(weight)}</strong><small>Automático dentro del Proyecto</small></div>
        <div class="workspace-metric"><span>Cumplimiento</span><strong>${formatPercent(progress)}</strong><small>${activityIndicators.filter((i) => i.estado === "activo").length} indicadores activos</small></div>
        <div class="workspace-metric"><span>Presupuesto</span><strong>${formatMoney(budget.programmed)}</strong><small>Programado</small></div>
        <div class="workspace-metric"><span>Ejecución</span><strong>${formatPercent(budget.execution)}</strong><small>${formatMoney(budget.executed)} ejecutado</small></div>
        <div class="workspace-metric"><span>Evidencias</span><strong>${evidenceForActivity(activity.id).filter((e) => e.estado === "activa").length}</strong><small>Activas</small></div>
      </div>`;
  }

  function activityNavHTML() {
    const tabs = [["general","General"],["indicadores","Indicadores"],["presupuesto","Presupuesto"],["evidencias","Evidencias"],["seguimiento","Seguimiento"]];
    return `<nav class="project-workspace-tabs activity-tabs" aria-label="Secciones de la Actividad">${tabs.map(([id,label]) => `<button class="${activityTab === id ? "active" : ""}" data-activity-tab="${id}" type="button">${label}</button>`).join("")}</nav>`;
  }

  function renderActivityWorkspace() {
    const activity = currentActivity();
    if (!activity) { currentActivityId = null; projectTab = "actividades"; renderShell(); return; }
    container.innerHTML = `
      <section class="project-workspace activity-workspace">
        <button id="backToProjectActivities" class="workspace-back-button" type="button">${arrowIcon()} Volver al Proyecto</button>
        <header class="project-workspace-header">${activityHeaderHTML(activity)}</header>
        ${activityNavHTML()}
        <div id="activityWorkspaceBody"></div>
      </section>
      <div id="projectWorkspaceToast" class="app-toast hidden" role="status"></div>`;
    bindToast();
    container.querySelector("#backToProjectActivities").addEventListener("click", () => { currentActivityId = null; projectTab = "actividades"; renderShell(); });
    container.querySelectorAll("[data-activity-tab]").forEach((button) => button.addEventListener("click", () => { activityTab = button.dataset.activityTab; renderActivityTab(); }));
    renderActivityTab();
  }

  function renderActivityGeneral() {
    const activity = currentActivity();
    const body = container.querySelector("#activityWorkspaceBody");
    body.innerHTML = `
      <form id="activityGeneralForm" class="workspace-form-page">
        <section class="workspace-section"><div class="workspace-section-heading"><div><p class="eyebrow">Actividad</p><h3>Información general</h3></div></div>
          <div class="workspace-form-grid">
            <div class="form-field"><label>Código</label><input name="codigo" value="${escapeHTML(activity.codigo || "")}"></div>
            <div class="form-field"><label>Orden</label><input name="orden" type="number" min="0" step="1" value="${Number(activity.orden || 0)}"></div>
            <div class="form-field full"><label>Nombre</label><input name="nombre" required value="${escapeHTML(activity.nombre)}"></div>
            <div class="form-field full"><label>Descripción</label><textarea name="descripcion" rows="6">${escapeHTML(activity.descripcion || "")}</textarea></div>
            <div class="form-field full"><label>Responsable</label><input name="responsable" value="${escapeHTML(activity.responsable || "")}"></div>
            <div class="form-field"><label>Fecha de inicio</label><input name="fecha_inicio" type="date" value="${escapeHTML(activity.fecha_inicio || "")}"></div>
            <div class="form-field"><label>Fecha de cierre</label><input name="fecha_fin" type="date" value="${escapeHTML(activity.fecha_fin || "")}"></div>
            <div class="form-field"><label>Estado</label><select name="estado">${option("borrador", "Borrador", activity.estado === "borrador")}${option("programada", "Programada", activity.estado === "programada")}${option("en_ejecucion", "En ejecución", activity.estado === "en_ejecucion")}${option("suspendida", "Suspendida", activity.estado === "suspendida")}${option("completada", "Completada", activity.estado === "completada")}${option("cancelada", "Cancelada", activity.estado === "cancelada")}</select></div>
          </div>
        </section>
        <div class="workspace-form-footer"><p id="activityGeneralMessage" class="form-message"></p><button class="btn btn-primary" type="submit">Guardar actividad</button></div>
      </form>`;
    const form = body.querySelector("#activityGeneralForm");
    const message = body.querySelector("#activityGeneralMessage");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const start = data.get("fecha_inicio") || null;
      const end = data.get("fecha_fin") || null;
      if (start && end && end < start) { message.textContent = "La fecha final no puede ser anterior a la fecha inicial."; return; }
      const submit = form.querySelector('button[type="submit"]'); submit.disabled = true; submit.textContent = "Guardando…";
      try {
        await updateActivity(activity, { codigo: data.get("codigo")?.trim() || null, nombre: data.get("nombre")?.trim(), descripcion: data.get("descripcion")?.trim() || null, responsable: data.get("responsable")?.trim() || null, fecha_inicio: start, fecha_fin: end, estado: data.get("estado"), orden: Number(data.get("orden") || 0) });
        await refreshCurrentActivityData();
        renderActivityWorkspace();
        showToast("Actividad actualizada.");
      } catch (error) {
        console.error(error); message.textContent = error.message || "No fue posible guardar la actividad."; submit.disabled = false; submit.textContent = "Guardar actividad";
      }
    });
  }

  async function deleteIndicatorSafely(indicator) {
    let counts;
    try {
      counts = await getIndicatorDependencyCounts(indicator.id);
    } catch (error) {
      console.error(error);
      showToast("No fue posible verificar el uso del indicador.");
      return;
    }

    if (counts.followups > 0 || counts.evidence > 0) {
      openModal({
        title: "Indicador con historial",
        content: `
          <div class="danger-callout"><strong>${escapeHTML(indicator.codigo || indicator.nombre)}</strong><p>Este indicador tiene seguimientos o evidencias asociadas. No puede eliminarse físicamente.</p></div>
          <p class="muted">Puedes marcarlo como <strong>Inactivo</strong>. Su historial permanecerá disponible.</p>
          <p id="indicatorProtectionMessage" class="form-message"></p>
          <div class="form-actions"><button id="closeProtectedIndicator" class="btn btn-secondary" type="button">Cerrar</button>${indicator.estado !== "inactivo" ? `<button id="inactivateIndicator" class="btn btn-danger" type="button">Inactivar indicador</button>` : ""}</div>`
      });
      document.querySelector("#closeProtectedIndicator").addEventListener("click", closeModal);
      const inactivate = document.querySelector("#inactivateIndicator");
      if (inactivate) {
        inactivate.addEventListener("click", async () => {
          inactivate.disabled = true;
          try {
            await updateIndicator(indicator, { estado: "inactivo" });
            closeModal();
            await refreshCurrentActivityData();
            renderActivityWorkspace();
            activityTab = "indicadores";
            renderActivityTab();
            showToast("Indicador inactivado.");
          } catch (error) {
            console.error(error);
            document.querySelector("#indicatorProtectionMessage").textContent = error.message || "No fue posible inactivar el indicador.";
            inactivate.disabled = false;
          }
        });
      }
      return;
    }

    openModal({
      title: "Eliminar indicador",
      content: `<div class="danger-callout"><strong>${escapeHTML(indicator.codigo || indicator.nombre)}</strong><p>Este indicador no tiene historial ni evidencias asociadas.</p></div><div class="form-actions"><button id="cancelDeleteIndicator" class="btn btn-secondary" type="button">Cancelar</button><button id="confirmDeleteIndicator" class="btn btn-danger" type="button">Eliminar indicador</button></div>`
    });
    document.querySelector("#cancelDeleteIndicator").addEventListener("click", closeModal);
    document.querySelector("#confirmDeleteIndicator").addEventListener("click", async () => {
      try {
        await deleteIndicator(indicator.id);
        closeModal();
        await refreshCurrentActivityData();
        renderActivityWorkspace();
        activityTab = "indicadores";
        renderActivityTab();
        showToast("Indicador eliminado.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "No fue posible eliminar el indicador.");
      }
    });
  }

  function renderIndicators() {
    const activity = currentActivity();
    const body = container.querySelector("#activityWorkspaceBody");
    const rows = indicatorsForActivity(activity.id);
    body.innerHTML = `
      <section class="workspace-section workspace-section-flush">
        <div class="workspace-section-heading"><div><p class="eyebrow">Medición</p><h3>Indicadores de la actividad</h3><p class="muted">El cumplimiento de la actividad se calcula automáticamente con los indicadores activos.</p></div><button id="newIndicatorButton" class="btn btn-primary" type="button">+ Nuevo indicador</button></div>
        ${rows.length ? `<div class="indicator-card-list">${rows.map((indicator) => {
          const progress = calculateIndicatorProgress(indicator);
          return `<article id="audit-indicator-${indicator.id}" class="indicator-work-card ${indicator.estado === "inactivo" ? "is-inactive" : ""}">
            <div class="indicator-work-heading"><div><p class="eyebrow">${escapeHTML(indicator.codigo || "Indicador")}</p><h4>${escapeHTML(indicator.nombre)}</h4></div><span class="status-chip ${indicator.estado === "activo" ? "active" : "closed"}">${indicator.estado === "activo" ? "Activo" : "Inactivo"}</span></div>
            <div class="indicator-values">
              <div><span>Línea base</span><strong>${formatNumber(indicator.linea_base, 4)}</strong></div>
              <div><span>Meta</span><strong>${formatNumber(indicator.meta, 4)}</strong></div>
              <div><span>Alcanzado</span><strong>${formatNumber(indicator.valor_actual, 4)}</strong></div>
              <div><span>Unidad</span><strong>${escapeHTML(indicator.unidad_medida || "—")}</strong></div>
              <div><span>Cumplimiento</span><strong>${formatPercent(progress)}</strong></div>
            </div>
            <div class="progress-track large"><span class="progress-fill" style="width:${progress === null ? 0 : progress}%"></span></div>
            <div class="entity-actions"><button class="btn btn-primary indicator-followup" type="button" data-id="${indicator.id}">Registrar avance</button><button class="btn btn-secondary audit-indicator-note" type="button" data-id="${indicator.id}">Nota</button><button class="btn btn-secondary edit-indicator" type="button" data-id="${indicator.id}">Editar</button><button class="icon-btn danger delete-indicator" type="button" data-id="${indicator.id}" title="Eliminar indicador">${trashIcon()}</button></div>
          </article>`;
        }).join("")}</div>` : `<div class="empty-state workspace-empty"><strong>Esta actividad todavía no tiene indicadores.</strong><p>Sin indicadores el sistema no calcula cumplimiento técnico.</p></div>`}
      </section>`;

    body.querySelector("#newIndicatorButton").addEventListener("click", () => {
      openIndicatorForm({ activityId: activity.id, onSaved: async () => { await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "indicadores"; renderActivityTab(); showToast("Indicador creado."); } });
    });
    body.querySelectorAll(".indicator-followup").forEach((button) => button.addEventListener("click", () => {
      const indicator = rows.find((item) => item.id === button.dataset.id);
      openIndicatorFollowup({ indicator, onSaved: async () => { await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "indicadores"; renderActivityTab(); showToast("Avance del indicador registrado."); } });
    }));
    body.querySelectorAll(".audit-indicator-note").forEach((button) => button.addEventListener("click", () => {
      const indicator = rows.find((item) => item.id === button.dataset.id);
      if (!indicator) return;

      openAuditPanel({
        newNote: true,
        contextOverride: {
          vigenciaId: vigencia.id,
          vigenciaNombre: vigencia.nombre,
          entidadTipo: "indicador",
          entidadId: indicator.id,
          entidadNombre: indicator.codigo || indicator.nombre,
          seccion: "indicadores",
          ruta: `${vigencia.nombre} › ${vigenciaConsejeria.consejerias.nombre_corto} › ${linea.nombre} › ${programa.nombre} › ${project.nombre} › ${activity.nombre} › Indicador ${indicator.codigo || indicator.nombre}`,
          navigation: {
            ...baseAuditNavigation(),
            project_tab: "actividades",
            actividad_id: activity.id,
            actividad_codigo: activity.codigo || "",
            actividad_nombre: activity.nombre,
            activity_tab: "indicadores",
            indicador_id: indicator.id,
            indicador_codigo: indicator.codigo || "",
            indicador_nombre: indicator.nombre,
            anchor: `audit-indicator-${indicator.id}`
          }
        }
      });
    }));

    body.querySelectorAll(".edit-indicator").forEach((button) => button.addEventListener("click", () => {
      const indicator = rows.find((item) => item.id === button.dataset.id);
      openIndicatorForm({ activityId: activity.id, record: indicator, onSaved: async () => { await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "indicadores"; renderActivityTab(); showToast("Indicador actualizado."); } });
    }));
    body.querySelectorAll(".delete-indicator").forEach((button) => button.addEventListener("click", () => {
      const indicator = rows.find((item) => item.id === button.dataset.id);
      deleteIndicatorSafely(indicator);
    }));
  }

  function renderBudget() {
    const activity = currentActivity();
    const body = container.querySelector("#activityWorkspaceBody");
    const rows = budgetForActivity(activity.id);
    const metrics = calculateBudgetMetrics(rows);
    body.innerHTML = `
      <section class="workspace-section workspace-section-flush">
        <div class="workspace-section-heading"><div><p class="eyebrow">Finanzas</p><h3>Presupuesto de la actividad</h3><p class="muted">El presupuesto se controla de forma independiente al cumplimiento técnico.</p></div><button id="newBudgetButton" class="btn btn-primary" type="button">+ Nuevo rubro</button></div>
        <div class="tracking-summary-grid budget-summary-grid"><div class="tracking-summary-card"><span>Programado</span><strong>${formatMoney(metrics.programmed)}</strong></div><div class="tracking-summary-card"><span>Ejecutado</span><strong>${formatMoney(metrics.executed)}</strong></div><div class="tracking-summary-card"><span>Ejecución presupuestal</span><strong>${formatPercent(metrics.execution)}</strong></div></div>
        ${rows.length ? `<div class="table-wrap"><table class="data-table workspace-data-table"><thead><tr><th>Rubro</th><th>Programado</th><th>Ejecutado</th><th>Ejecución</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map((item) => {
          const execution = Number(item.programado || 0) > 0 ? Math.min(100, Number(item.ejecutado || 0) / Number(item.programado || 0) * 100) : null;
          return `<tr class="${item.estado === "inactivo" ? "muted-row" : ""}"><td><strong>${escapeHTML(item.rubro)}</strong>${item.descripcion ? `<small>${escapeHTML(item.descripcion)}</small>` : ""}</td><td>${formatMoney(item.programado)}</td><td>${formatMoney(item.ejecutado)}</td><td>${formatPercent(execution)}</td><td><span class="status-chip ${item.estado === "activo" ? "active" : "closed"}">${item.estado === "activo" ? "Activo" : "Inactivo"}</span></td><td><div class="row-actions compact-actions"><button class="btn btn-secondary edit-budget" type="button" data-id="${item.id}">Editar</button><button class="icon-btn danger delete-budget" type="button" data-id="${item.id}" title="Eliminar rubro">${trashIcon()}</button></div></td></tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty-state workspace-empty"><strong>No hay rubros presupuestales.</strong><p>Agrega rubros para construir el presupuesto detallado de la actividad.</p></div>`}
      </section>`;

    body.querySelector("#newBudgetButton").addEventListener("click", () => {
      openBudgetForm({ activityId: activity.id, onSaved: async () => { await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "presupuesto"; renderActivityTab(); showToast("Rubro creado."); } });
    });
    body.querySelectorAll(".edit-budget").forEach((button) => button.addEventListener("click", () => {
      const record = rows.find((item) => item.id === button.dataset.id);
      openBudgetForm({ activityId: activity.id, record, onSaved: async () => { await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "presupuesto"; renderActivityTab(); showToast("Rubro actualizado."); } });
    }));
    body.querySelectorAll(".delete-budget").forEach((button) => button.addEventListener("click", async () => {
      const record = rows.find((item) => item.id === button.dataset.id);
      if (Number(record.ejecutado || 0) > 0) {
        openModal({ title: "Rubro con ejecución", content: `<div class="danger-callout"><strong>${escapeHTML(record.rubro)}</strong><p>Este rubro ya registra ejecución presupuestal y no debe eliminarse.</p></div><p class="muted">Puedes marcarlo como inactivo para conservar el historial financiero.</p><div class="form-actions"><button id="closeBudgetProtection" class="btn btn-secondary" type="button">Cerrar</button>${record.estado !== "inactivo" ? `<button id="inactivateBudgetRecord" class="btn btn-danger" type="button">Inactivar rubro</button>` : ""}</div>` });
        document.querySelector("#closeBudgetProtection").addEventListener("click", closeModal);
        const inactivate = document.querySelector("#inactivateBudgetRecord");
        if (inactivate) inactivate.addEventListener("click", async () => { await updateBudgetItem(record, { estado: "inactivo" }); closeModal(); await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "presupuesto"; renderActivityTab(); showToast("Rubro inactivado."); });
        return;
      }
      try {
        await deleteBudgetItem(record.id);
        await refreshCurrentActivityData();
        renderActivityWorkspace();
        activityTab = "presupuesto";
        renderActivityTab();
        showToast("Rubro eliminado.");
      } catch (error) {
        console.error(error); showToast(error.message || "No fue posible eliminar el rubro.");
      }
    }));
  }

  function renderEvidence() {
    const activity = currentActivity();
    const body = container.querySelector("#activityWorkspaceBody");
    const rows = evidenceForActivity(activity.id);
    const activityIndicators = indicatorsForActivity(activity.id);
    const indicatorMap = new Map(activityIndicators.map((indicator) => [indicator.id, indicator]));
    body.innerHTML = `
      <section class="workspace-section workspace-section-flush">
        <div class="workspace-section-heading"><div><p class="eyebrow">Soportes</p><h3>Evidencias de la actividad</h3><p class="muted">Una evidencia puede ser general de la actividad o asociarse a un indicador específico.</p></div><button id="newEvidenceButton" class="btn btn-primary" type="button">+ Nueva evidencia</button></div>
        ${rows.length ? `<div class="evidence-grid">${rows.map((item) => {
          const indicator = indicatorMap.get(item.indicador_id);
          return `<article class="evidence-card ${item.estado === "archivada" ? "is-archived" : ""}"><div class="evidence-card-heading"><div><p class="eyebrow">${escapeHTML(item.tipo || "Evidencia")}</p><h4>${escapeHTML(item.nombre)}</h4></div><span class="status-chip ${item.estado === "activa" ? "active" : "closed"}">${item.estado === "activa" ? "Activa" : "Archivada"}</span></div><p class="muted">${escapeHTML(item.descripcion || "Sin descripción.")}</p><div class="evidence-meta"><span>Fecha<strong>${formatDate(item.fecha)}</strong></span><span>Indicador<strong>${indicator ? escapeHTML(indicator.codigo || indicator.nombre) : "Actividad"}</strong></span></div>${item.url ? `<a class="evidence-link" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">Abrir soporte ↗</a>` : ""}<div class="entity-actions"><button class="btn btn-secondary edit-evidence" type="button" data-id="${item.id}">Editar</button>${item.estado === "activa" ? `<button class="btn btn-secondary archive-evidence" type="button" data-id="${item.id}">Archivar</button>` : `<button class="btn btn-secondary restore-evidence" type="button" data-id="${item.id}">Reactivar</button>`}</div></article>`;
        }).join("")}</div>` : `<div class="empty-state workspace-empty"><strong>Esta actividad todavía no tiene evidencias.</strong><p>Agrega actas, informes, fotografías, productos u otros soportes.</p></div>`}
      </section>`;

    body.querySelector("#newEvidenceButton").addEventListener("click", () => {
      openEvidenceForm({ activityId: activity.id, indicators: activityIndicators, onSaved: async () => { await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "evidencias"; renderActivityTab(); showToast("Evidencia creada."); } });
    });
    body.querySelectorAll(".edit-evidence").forEach((button) => button.addEventListener("click", () => {
      const record = rows.find((item) => item.id === button.dataset.id);
      openEvidenceForm({ activityId: activity.id, indicators: activityIndicators, record, onSaved: async () => { await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "evidencias"; renderActivityTab(); showToast("Evidencia actualizada."); } });
    }));
    body.querySelectorAll(".archive-evidence").forEach((button) => button.addEventListener("click", async () => { const record = rows.find((item) => item.id === button.dataset.id); await updateEvidence(record, { estado: "archivada" }); await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "evidencias"; renderActivityTab(); showToast("Evidencia archivada."); }));
    body.querySelectorAll(".restore-evidence").forEach((button) => button.addEventListener("click", async () => { const record = rows.find((item) => item.id === button.dataset.id); await updateEvidence(record, { estado: "activa" }); await refreshCurrentActivityData(); renderActivityWorkspace(); activityTab = "evidencias"; renderActivityTab(); showToast("Evidencia reactivada."); }));
  }

  async function renderActivityTracking() {
    const activity = currentActivity();
    const body = container.querySelector("#activityWorkspaceBody");
    const activityIndicators = indicatorsForActivity(activity.id);
    const [followups, indicatorFollowups] = await Promise.all([
      getActivityFollowups(activity.id),
      getIndicatorFollowups(activityIndicators.map((item) => item.id))
    ]);
    const indicatorMap = new Map(activityIndicators.map((indicator) => [indicator.id, indicator]));
    body.innerHTML = `
      <section class="workspace-section workspace-section-flush">
        <div class="workspace-section-heading"><div><p class="eyebrow">Histórico</p><h3>Seguimiento de la actividad</h3><p class="muted">Los registros se agregan por fecha de corte y no sustituyen el histórico anterior.</p></div><button id="newActivityFollowupButton" class="btn btn-primary" type="button">+ Nuevo seguimiento</button></div>
        <div class="tracking-columns">
          <section><h4>Seguimientos narrativos</h4>${followups.length ? `<div class="timeline-list">${followups.map((item) => `<article class="timeline-card"><div class="timeline-date">${formatDate(item.fecha_corte)}</div>${item.resumen ? `<div><span>Resumen</span><p>${escapeHTML(item.resumen)}</p></div>` : ""}${item.logros ? `<div><span>Logros</span><p>${escapeHTML(item.logros)}</p></div>` : ""}${item.dificultades ? `<div><span>Dificultades</span><p>${escapeHTML(item.dificultades)}</p></div>` : ""}${item.proximos_pasos ? `<div><span>Próximos pasos</span><p>${escapeHTML(item.proximos_pasos)}</p></div>` : ""}</article>`).join("")}</div>` : `<div class="empty-inline">No hay seguimientos narrativos registrados.</div>`}</section>
          <section><h4>Histórico de indicadores</h4>${indicatorFollowups.length ? `<div class="timeline-list compact-timeline">${indicatorFollowups.map((item) => {
            const indicator = indicatorMap.get(item.indicador_id);
            return `<article class="timeline-card"><div class="timeline-date">${formatDate(item.fecha_corte)}</div><strong>${escapeHTML(indicator?.codigo || indicator?.nombre || "Indicador")}</strong><p>Valor: <strong>${formatNumber(item.valor, 4)}</strong>${indicator?.unidad_medida ? ` ${escapeHTML(indicator.unidad_medida)}` : ""}</p>${item.observacion ? `<p class="muted">${escapeHTML(item.observacion)}</p>` : ""}</article>`;
          }).join("")}</div>` : `<div class="empty-inline">No hay registros históricos de indicadores.</div>`}</section>
        </div>
      </section>`;
    body.querySelector("#newActivityFollowupButton").addEventListener("click", () => {
      openActivityFollowup({ activityId: activity.id, onSaved: async () => { await renderActivityTracking(); showToast("Seguimiento registrado."); } });
    });
  }

  function syncActivityAuditContext() {
    const activity = currentActivity();
    if (!activity) return;

    const labels = {
      general: "General",
      indicadores: "Indicadores",
      presupuesto: "Presupuesto",
      evidencias: "Evidencias",
      seguimiento: "Seguimiento"
    };

    setAuditContext({
      vigenciaId: vigencia.id,
      vigenciaNombre: vigencia.nombre,
      entidadTipo: "actividad",
      entidadId: activity.id,
      entidadNombre: activity.nombre,
      seccion: activityTab,
      ruta: `${vigencia.nombre} › ${vigenciaConsejeria.consejerias.nombre_corto} › ${linea.nombre} › ${programa.nombre} › ${project.nombre} › ${activity.nombre} › ${labels[activityTab] || activityTab}`,
      navigation: {
        ...baseAuditNavigation(),
        project_tab: "actividades",
        actividad_id: activity.id,
        actividad_codigo: activity.codigo || "",
        actividad_nombre: activity.nombre,
        activity_tab: activityTab
      },
      sectionOptions: [
        { value: "general", label: "General", navigation: { activity_tab: "general" } },
        { value: "indicadores", label: "Indicadores", navigation: { activity_tab: "indicadores" } },
        { value: "presupuesto", label: "Presupuesto", navigation: { activity_tab: "presupuesto" } },
        { value: "evidencias", label: "Evidencias", navigation: { activity_tab: "evidencias" } },
        { value: "seguimiento", label: "Seguimiento", navigation: { activity_tab: "seguimiento" } }
      ]
    });
  }

  function renderActivityTab() {
    syncActivityAuditContext();
    container.querySelectorAll("[data-activity-tab]").forEach((button) => button.classList.toggle("active", button.dataset.activityTab === activityTab));
    if (activityTab === "indicadores") renderIndicators();
    else if (activityTab === "presupuesto") renderBudget();
    else if (activityTab === "evidencias") renderEvidence();
    else if (activityTab === "seguimiento") renderActivityTracking().catch((error) => { console.error(error); showToast(error.message || "No fue posible cargar el seguimiento."); });
    else renderActivityGeneral();
  }

  try {
    await loadProjectData();

    if (
      currentActivityId &&
      !activities.some((item) => item.id === currentActivityId)
    ) {
      currentActivityId = null;
    }

    renderShell();

    if (initialAnchor) {
      setTimeout(() => {
        const target = container.querySelector(
          `#${CSS.escape(initialAnchor)}`
        );

        if (!target) return;

        target.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });

        target.classList.add("audit-reference-highlight");

        setTimeout(() => {
          target.classList.remove("audit-reference-highlight");
        }, 2600);
      }, 120);
    }
  } catch (error) {
    console.error(error);
    container.innerHTML = `<section class="panel" style="margin-top:0"><p class="eyebrow">Proyecto</p><h2>No fue posible abrir el espacio de trabajo</h2><p class="muted">${escapeHTML(error.message || "No fue posible cargar la información del Proyecto. Intenta nuevamente o informa al administrador del Sistema.")}</p><div style="margin-top:16px"><button id="workspaceErrorBack" class="btn btn-secondary" type="button">Volver a Proyectos</button></div></section>`;
    container.querySelector("#workspaceErrorBack").addEventListener("click", onBack);
  }
}
