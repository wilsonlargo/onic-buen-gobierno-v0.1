import { requireSupabase } from "../supabaseClient.js";
import { getCurrentProfile, canManageGlobalStructure } from "../security.js";
import { openModal, closeModal } from "../components/modal.js";
import { setAuditContext } from "./auditoria.js";
import { getConsejeriaProgressMap } from "./consejeriaProgress.js";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(digits).replace(".", ",")} %`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
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

function todayISO() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultCutName() {
  const text = new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric"
  }).format(new Date());
  return `Corte ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function equalWeightValues(items = []) {
  if (!items.length) return [];
  const totalUnits = 10000;
  const base = Math.floor(totalUnits / items.length);
  const remainder = totalUnits - base * items.length;
  return items.map((item, index) => ({
    item,
    weight: (base + (index < remainder ? 1 : 0)) / 100
  }));
}

const STATE_META = {
  abierto: { label: "Abierto", className: "draft" },
  revision: { label: "En revisión", className: "attention" },
  aprobado: { label: "Aprobado", className: "active" },
  cerrado: { label: "Cerrado", className: "closed" }
};

function stateMeta(value) {
  return STATE_META[value] || { label: String(value || "—"), className: "draft" };
}

async function loadVigencias() {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("vigencias")
    .select("id,nombre,fecha_inicio,fecha_fin,estado")
    .order("fecha_inicio", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadVigenciaConsejerias(vigenciaId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("vigencia_consejerias")
    .select(`
      id,
      consejeria_id,
      estado,
      consejerias (
        id,
        nombre_corto,
        nombre_largo
      )
    `)
    .eq("vigencia_id", vigenciaId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).filter((row) => row.consejerias);
}

function consejeriaName(row) {
  return row?.consejerias?.nombre_corto || row?.consejerias?.nombre_largo || "Consejería";
}

/**
 * Obtiene la fotografía viva del ámbito que el usuario puede leer.
 * Para Administrador/Coordinador representa toda la Vigencia; para un
 * usuario de Consejería representa únicamente sus Consejerías asignadas.
 */
export async function getCurrentTrackingSnapshot(vigenciaId) {
  const [vcRows, progressMap] = await Promise.all([
    loadVigenciaConsejerias(vigenciaId),
    getConsejeriaProgressMap(vigenciaId)
  ]);

  const activeRows = vcRows.filter((row) => row.estado === "activa");
  let progress = 0;
  let coverage = 0;

  equalWeightValues(activeRows).forEach(({ item: row, weight }) => {
    const metric = progressMap.get(row.id) || { progress: 0, coverage: 0, active: true };
    progress += Number(metric.progress || 0) * weight / 100;
    coverage += Number(metric.coverage || 0) * weight / 100;
  });

  return {
    progress: activeRows.length ? clamp(progress) : null,
    coverage: activeRows.length ? clamp(coverage) : 0,
    consejerias: vcRows.map((row) => {
      const metric = progressMap.get(row.id) || { progress: null, coverage: null, active: false };
      return {
        vigencia_consejeria_id: row.id,
        consejeria_nombre: consejeriaName(row),
        estado_consejeria: row.estado,
        avance: metric.progress === null ? null : clamp(metric.progress),
        cobertura: metric.coverage === null ? null : clamp(metric.coverage)
      };
    })
  };
}

async function loadCuts(vigenciaId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("cortes_seguimiento")
    .select(`
      id,
      vigencia_id,
      nombre,
      fecha_corte,
      estado,
      observaciones,
      avance_vigencia,
      cobertura_vigencia,
      creado_por_email,
      creado_en,
      actualizado_en,
      aprobado_por_email,
      aprobado_en,
      cerrado_por_email,
      cerrado_en,
      row_version,
      cortes_seguimiento_consejerias (
        id,
        vigencia_consejeria_id,
        consejeria_nombre,
        estado_consejeria,
        avance,
        cobertura
      )
    `)
    .eq("vigencia_id", vigenciaId)
    .order("fecha_corte", { ascending: true })
    .order("creado_en", { ascending: true });

  if (error) throw error;
  return data || [];
}

function scopeMetricFromCut(cut) {
  const profile = getCurrentProfile();
  if (profile?.rol !== "consejeria") {
    return {
      progress: cut.avance_vigencia === null ? null : Number(cut.avance_vigencia),
      coverage: Number(cut.cobertura_vigencia || 0)
    };
  }

  const rows = (cut.cortes_seguimiento_consejerias || [])
    .filter((row) => row.estado_consejeria === "activa");

  if (!rows.length) return { progress: null, coverage: 0 };

  let progress = 0;
  let coverage = 0;
  equalWeightValues(rows).forEach(({ item, weight }) => {
    progress += Number(item.avance || 0) * weight / 100;
    coverage += Number(item.cobertura || 0) * weight / 100;
  });

  return { progress: clamp(progress), coverage: clamp(coverage) };
}

export async function loadOfficialTrackingSeries(vigenciaId) {
  const cuts = await loadCuts(vigenciaId);
  return cuts
    .filter((cut) => ["aprobado", "cerrado"].includes(cut.estado))
    .map((cut) => {
      const metric = scopeMetricFromCut(cut);
      return {
        id: cut.id,
        name: cut.nombre,
        date: cut.fecha_corte,
        status: cut.estado,
        progress: metric.progress,
        coverage: metric.coverage
      };
    });
}

function shortDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short"
  }).format(date).replace(".", "");
}

/** Render SVG nativo, sin dependencias externas. */
export function renderTrackingChart(points = [], { includeCurrent = null, compact = false } = {}) {
  const source = points
    .filter((point) => point.progress !== null && Number.isFinite(Number(point.progress)))
    .map((point) => ({ ...point, progress: clamp(point.progress) }));

  if (!source.length) {
    const currentText = includeCurrent && includeCurrent.progress !== null && Number.isFinite(Number(includeCurrent.progress))
      ? `<p>Avance actual: <strong>${formatPercent(includeCurrent.progress)}</strong>. Cuando se apruebe el primer corte, comenzará la serie histórica.</p>`
      : `<p>Cuando se apruebe el primer corte, su avance aparecerá en este histórico.</p>`;
    return `
      <div class="tracking-chart-empty">
        <strong>Todavía no hay cortes aprobados.</strong>
        ${currentText}
      </div>
    `;
  }

  if (includeCurrent && includeCurrent.progress !== null && Number.isFinite(Number(includeCurrent.progress))) {
    source.push({
      id: "current-live",
      name: "Actual",
      date: todayISO(),
      status: "actual",
      progress: clamp(includeCurrent.progress),
      coverage: clamp(includeCurrent.coverage || 0),
      current: true
    });
  }

  const width = 920;
  const height = compact ? 250 : 310;
  const left = 54;
  const right = 30;
  const top = 28;
  const bottom = compact ? 50 : 66;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index) => source.length === 1
    ? left + plotWidth / 2
    : left + index * (plotWidth / (source.length - 1));
  const y = (value) => top + (100 - clamp(value)) / 100 * plotHeight;

  const grid = [0, 25, 50, 75, 100].map((value) => `
    <line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" class="tracking-grid-line"></line>
    <text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" class="tracking-axis-label">${value}%</text>
  `).join("");

  const polyline = source.map((point, index) => `${x(index)},${y(point.progress)}`).join(" ");
  const labelEvery = source.length <= 8 ? 1 : Math.ceil(source.length / 7);

  const nodes = source.map((point, index) => {
    const shouldLabel = source.length <= 8 || index === source.length - 1 || index % labelEvery === 0;
    return `
      <g class="tracking-point ${point.current ? "current" : ""}">
        <circle cx="${x(index)}" cy="${y(point.progress)}" r="${point.current ? 6 : 5}"></circle>
        <title>${escapeHTML(point.name)} · ${formatPercent(point.progress)} · Cobertura ${formatPercent(point.coverage)}</title>
        ${shouldLabel ? `
          <text x="${x(index)}" y="${Math.max(16, y(point.progress) - 12)}" text-anchor="middle" class="tracking-value-label">${Number(point.progress).toFixed(1).replace(".", ",")}%</text>
          <text x="${x(index)}" y="${height - 25}" text-anchor="middle" class="tracking-x-label">${escapeHTML(point.current ? "Actual" : shortDate(point.date))}</text>
        ` : ""}
      </g>
    `;
  }).join("");

  return `
    <div class="tracking-chart-wrap" role="img" aria-label="Histórico gráfico del avance técnico">
      <svg class="tracking-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        ${grid}
        ${source.length > 1 ? `<polyline points="${polyline}" class="tracking-progress-line"></polyline>` : ""}
        ${nodes}
      </svg>
    </div>
    <div class="tracking-chart-legend">
      <span><i class="tracking-legend-line"></i> Avance acreditado</span>
      ${includeCurrent ? `<span><i class="tracking-legend-current"></i> Valor actual no cerrado</span>` : ""}
    </div>
  `;
}

function variationMarkup(current, previous) {
  if (current === null || previous === null || current === undefined || previous === undefined) return "";
  const diff = Number(current) - Number(previous);
  const sign = diff > 0 ? "+" : "";
  const className = diff > 0 ? "positive" : diff < 0 ? "negative" : "neutral";
  return `<span class="cut-variation ${className}">${sign}${diff.toFixed(2).replace(".", ",")} puntos</span>`;
}

function renderCutCard(cut, previousOfficial = null) {
  const state = stateMeta(cut.estado);
  const metric = scopeMetricFromCut(cut);
  const previousMetric = previousOfficial ? scopeMetricFromCut(previousOfficial) : null;
  const canManage = canManageGlobalStructure();
  const childRows = (cut.cortes_seguimiento_consejerias || [])
    .slice()
    .sort((a, b) => String(a.consejeria_nombre).localeCompare(String(b.consejeria_nombre), "es"));

  let actionButtons = "";
  if (canManage && cut.estado === "abierto") {
    actionButtons = `
      <button class="btn btn-secondary update-cut-snapshot" data-cut-id="${cut.id}" type="button">Actualizar fotografía</button>
      <button class="btn btn-primary advance-cut-state" data-cut-id="${cut.id}" data-next-state="revision" type="button">Pasar a revisión</button>
    `;
  } else if (canManage && cut.estado === "revision") {
    actionButtons = `
      <button class="btn btn-secondary update-cut-snapshot" data-cut-id="${cut.id}" type="button">Actualizar fotografía</button>
      <button class="btn btn-primary advance-cut-state" data-cut-id="${cut.id}" data-next-state="aprobado" type="button">Aprobar corte</button>
    `;
  } else if (canManage && cut.estado === "aprobado") {
    actionButtons = `
      <button class="btn btn-primary advance-cut-state" data-cut-id="${cut.id}" data-next-state="cerrado" type="button">Cerrar corte</button>
    `;
  }

  return `
    <article class="tracking-cut-card" data-cut-id="${cut.id}">
      <header class="tracking-cut-header">
        <div>
          <div class="tracking-cut-title-line">
            <h3>${escapeHTML(cut.nombre)}</h3>
            <span class="status-chip ${state.className}">${escapeHTML(state.label)}</span>
          </div>
          <p>${formatDate(cut.fecha_corte)}${cut.creado_por_email ? ` · Registrado por ${escapeHTML(cut.creado_por_email)}` : ""}</p>
        </div>
        <div class="tracking-cut-actions">${actionButtons}</div>
      </header>

      <div class="tracking-cut-metrics">
        <div>
          <span>Avance acreditado</span>
          <strong>${formatPercent(metric.progress)}</strong>
          ${previousMetric ? variationMarkup(metric.progress, previousMetric.progress) : ""}
        </div>
        <div>
          <span>Cobertura de medición</span>
          <strong>${formatPercent(metric.coverage)}</strong>
        </div>
      </div>

      ${cut.observaciones ? `<p class="tracking-cut-note">${escapeHTML(cut.observaciones)}</p>` : ""}

      <details class="tracking-cut-details">
        <summary>Ver detalle por Consejería</summary>
        ${childRows.length ? `
          <div class="tracking-cut-vc-grid">
            ${childRows.map((row) => `
              <div class="tracking-cut-vc-item">
                <strong>${escapeHTML(row.consejeria_nombre)}</strong>
                <span>${formatPercent(row.avance)} avance</span>
                <small>${formatPercent(row.cobertura)} cobertura</small>
              </div>
            `).join("")}
          </div>
        ` : `<p class="muted">No hay Consejerías visibles para este usuario en la fotografía.</p>`}
      </details>

      ${(cut.aprobado_en || cut.cerrado_en) ? `
        <footer class="tracking-cut-footer">
          ${cut.aprobado_en ? `<span>Aprobado: ${formatDateTime(cut.aprobado_en)}${cut.aprobado_por_email ? ` · ${escapeHTML(cut.aprobado_por_email)}` : ""}</span>` : ""}
          ${cut.cerrado_en ? `<span>Cerrado: ${formatDateTime(cut.cerrado_en)}${cut.cerrado_por_email ? ` · ${escapeHTML(cut.cerrado_por_email)}` : ""}</span>` : ""}
        </footer>
      ` : ""}
    </article>
  `;
}

async function createCut(payload) {
  const supabase = requireSupabase();
  const snapshot = await getCurrentTrackingSnapshot(payload.vigenciaId);
  const { data, error } = await supabase.rpc("crear_corte_seguimiento", {
    p_vigencia_id: payload.vigenciaId,
    p_nombre: payload.nombre,
    p_fecha_corte: payload.fechaCorte,
    p_observaciones: payload.observaciones || null,
    p_avance_vigencia: snapshot.progress,
    p_cobertura_vigencia: snapshot.coverage,
    p_consejerias: snapshot.consejerias
  });
  if (error) throw error;
  return data;
}

async function refreshCutSnapshot(cut) {
  const supabase = requireSupabase();
  const snapshot = await getCurrentTrackingSnapshot(cut.vigencia_id);
  const { data, error } = await supabase.rpc("actualizar_fotografia_corte", {
    p_corte_id: cut.id,
    p_version_esperada: Number(cut.row_version || 1),
    p_avance_vigencia: snapshot.progress,
    p_cobertura_vigencia: snapshot.coverage,
    p_consejerias: snapshot.consejerias
  });
  if (error) throw error;
  return data;
}

async function changeCutState(cut, nextState) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("cambiar_estado_corte_seguimiento", {
    p_corte_id: cut.id,
    p_version_esperada: Number(cut.row_version || 1),
    p_nuevo_estado: nextState
  });
  if (error) throw error;
  return data;
}

function openNewCutDialog({ vigencia, onCreated }) {
  openModal({
    title: "Nuevo corte de seguimiento",
    content: `
      <p class="notice">
        El corte guardará una fotografía del avance y la cobertura existentes en este momento. Mientras permanezca abierto o en revisión, la fotografía podrá actualizarse antes de su aprobación.
      </p>
      <form id="newTrackingCutForm" class="form-grid">
        <div class="form-field form-field-full">
          <label for="trackingCutName">Nombre del corte</label>
          <input id="trackingCutName" name="nombre" required maxlength="160" value="${escapeHTML(defaultCutName())}">
        </div>
        <div class="form-field">
          <label for="trackingCutDate">Fecha de corte</label>
          <input id="trackingCutDate" name="fecha_corte" type="date" required value="${todayISO()}">
        </div>
        <div class="form-field form-field-full">
          <label for="trackingCutNotes">Observaciones</label>
          <textarea id="trackingCutNotes" name="observaciones" rows="4" placeholder="Contexto o alcance del corte (opcional)"></textarea>
        </div>
        <p id="trackingCutMessage" class="form-message form-field-full"></p>
        <div class="form-actions form-field-full">
          <button id="cancelTrackingCut" type="button" class="btn btn-secondary">Cancelar</button>
          <button type="submit" class="btn btn-primary">Crear corte y guardar fotografía</button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#newTrackingCutForm");
  const message = document.querySelector("#trackingCutMessage");
  document.querySelector("#cancelTrackingCut")?.addEventListener("click", closeModal);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Creando…";
    message.textContent = "";

    try {
      await createCut({
        vigenciaId: vigencia.id,
        nombre: form.nombre.value.trim(),
        fechaCorte: form.fecha_corte.value,
        observaciones: form.observaciones.value.trim()
      });
      closeModal();
      await onCreated?.();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible crear el corte.";
      submit.disabled = false;
      submit.textContent = "Crear corte y guardar fotografía";
    }
  });
}

function stateConfirmation(cut, nextState, onConfirm) {
  const copy = {
    revision: {
      title: "Pasar corte a revisión",
      text: "La fotografía continuará disponible para actualización mientras el corte esté en revisión.",
      button: "Pasar a revisión"
    },
    aprobado: {
      title: "Aprobar corte",
      text: "La fotografía quedará oficial y ya no podrá actualizarse. Este punto será utilizado en el histórico gráfico de avance.",
      button: "Aprobar corte"
    },
    cerrado: {
      title: "Cerrar corte",
      text: "El corte permanecerá como registro histórico definitivo de la Vigencia.",
      button: "Cerrar corte"
    }
  }[nextState];

  if (!copy) return;

  openModal({
    title: copy.title,
    content: `
      <p><strong>${escapeHTML(cut.nombre)}</strong></p>
      <p class="notice">${escapeHTML(copy.text)}</p>
      <p id="cutStateMessage" class="form-message"></p>
      <div class="form-actions">
        <button id="cancelCutState" class="btn btn-secondary" type="button">Cancelar</button>
        <button id="confirmCutState" class="btn btn-primary" type="button">${escapeHTML(copy.button)}</button>
      </div>
    `
  });

  document.querySelector("#cancelCutState")?.addEventListener("click", closeModal);
  document.querySelector("#confirmCutState")?.addEventListener("click", async () => {
    const button = document.querySelector("#confirmCutState");
    const message = document.querySelector("#cutStateMessage");
    button.disabled = true;
    button.textContent = "Guardando…";
    try {
      await onConfirm();
      closeModal();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible cambiar el estado del corte.";
      button.disabled = false;
      button.textContent = copy.button;
    }
  });
}

export async function renderCortesSeguimiento(container, navigationTarget = null) {
  let vigencias = [];
  let selectedVigenciaId = "";
  let cuts = [];
  let currentSnapshot = null;

  container.innerHTML = `
    <section class="hero-panel tracking-hero">
      <div>
        <p class="eyebrow" style="color: var(--onic-cream-300)">Seguimiento institucional</p>
        <h2>Cortes de seguimiento</h2>
        <p>Conserva fotografías del avance del Plan y consulta su evolución a través del tiempo.</p>
      </div>
      <div class="tracking-hero-controls">
        <label for="trackingVigenciaSelector">Vigencia</label>
        <select id="trackingVigenciaSelector"><option value="">Cargando…</option></select>
        ${canManageGlobalStructure() ? `<button id="newCorteButton" class="btn btn-primary tracking-new-cut-button" type="button" title="Crear un nuevo corte de seguimiento">+ Nuevo corte</button>` : ""}
      </div>
    </section>

    <section id="trackingSummary" class="tracking-summary-grid"></section>

    <section class="panel tracking-history-panel">
      <div class="panel-heading tracking-panel-heading">
        <div>
          <p class="eyebrow">Evolución</p>
          <h2>Histórico gráfico de avance</h2>
          <p class="muted">El gráfico utiliza únicamente cortes aprobados o cerrados. El valor actual se muestra como referencia y todavía puede cambiar.</p>
        </div>
      </div>
      <div id="trackingChartHost"><div class="empty-state">Cargando histórico…</div></div>
    </section>

    <section class="panel tracking-cuts-panel">
      <div class="panel-heading tracking-panel-heading">
        <div>
          <p class="eyebrow">Registro de cortes</p>
          <h2>Fotografías de seguimiento</h2>
        </div>
      </div>
      <div id="trackingCutsList"><div class="empty-state">Cargando cortes…</div></div>
    </section>
  `;

  const selector = container.querySelector("#trackingVigenciaSelector");
  const summaryHost = container.querySelector("#trackingSummary");
  const chartHost = container.querySelector("#trackingChartHost");
  const listHost = container.querySelector("#trackingCutsList");
  const newButton = container.querySelector("#newCorteButton");

  function currentVigencia() {
    const liveId = selector?.value || selectedVigenciaId || "";
    return vigencias.find((row) => row.id === liveId);
  }

  function updateNewCutButtonState() {
    if (!newButton) return;
    const hasVigencia = Boolean(selector?.value || selectedVigenciaId);
    newButton.disabled = !hasVigencia;
    if (hasVigencia) {
      newButton.removeAttribute("disabled");
      newButton.setAttribute("aria-disabled", "false");
      newButton.title = "Crear un nuevo corte de seguimiento";
    } else {
      newButton.setAttribute("aria-disabled", "true");
      newButton.title = "Selecciona una Vigencia para crear un corte";
    }
  }

  // El clic se registra inmediatamente y consulta la selección visible en ese momento.
  // Así no depende del orden o tiempo de las consultas iniciales.
  newButton?.addEventListener("click", () => {
    selectedVigenciaId = selector?.value || selectedVigenciaId || "";
    const vigencia = currentVigencia();
    if (!vigencia) {
      updateNewCutButtonState();
      return;
    }
    openNewCutDialog({ vigencia, onCreated: refresh });
  });

  async function refresh() {
    if (!selectedVigenciaId) {
      summaryHost.innerHTML = "";
      chartHost.innerHTML = `<div class="empty-state">Selecciona una Vigencia.</div>`;
      listHost.innerHTML = `<div class="empty-state">Selecciona una Vigencia.</div>`;
      updateNewCutButtonState();
      return;
    }

    const vigencia = currentVigencia();
    updateNewCutButtonState();

    setAuditContext({
      vigenciaId: selectedVigenciaId,
      vigenciaNombre: vigencia?.nombre || "Vigencia",
      entidadTipo: "vigencia",
      entidadId: selectedVigenciaId,
      entidadNombre: vigencia?.nombre || "Vigencia",
      seccion: "cortes_seguimiento",
      ruta: `${vigencia?.nombre || "Vigencia"} / Cortes de seguimiento`,
      navigation: { view: "cortes", vigencia_id: selectedVigenciaId },
      sectionOptions: [{
        value: "cortes_seguimiento",
        label: "Cortes de seguimiento",
        navigation: { view: "cortes", vigencia_id: selectedVigenciaId }
      }]
    });

    summaryHost.innerHTML = `<div class="empty-state">Calculando estado actual…</div>`;
    chartHost.innerHTML = `<div class="empty-state">Cargando histórico…</div>`;
    listHost.innerHTML = `<div class="empty-state">Cargando cortes…</div>`;

    try {
      [currentSnapshot, cuts] = await Promise.all([
        getCurrentTrackingSnapshot(selectedVigenciaId),
        loadCuts(selectedVigenciaId)
      ]);

      const official = cuts.filter((cut) => ["aprobado", "cerrado"].includes(cut.estado));
      const officialPoints = official.map((cut) => {
        const metric = scopeMetricFromCut(cut);
        return {
          id: cut.id,
          name: cut.nombre,
          date: cut.fecha_corte,
          status: cut.estado,
          progress: metric.progress,
          coverage: metric.coverage
        };
      });
      const lastOfficial = officialPoints.at(-1) || null;
      const variation = lastOfficial && currentSnapshot.progress !== null
        ? Number(currentSnapshot.progress) - Number(lastOfficial.progress || 0)
        : null;

      summaryHost.innerHTML = `
        <article class="tracking-summary-card primary">
          <span>Avance actual</span>
          <strong>${formatPercent(currentSnapshot.progress)}</strong>
          <small>Valor vivo calculado desde los indicadores.</small>
        </article>
        <article class="tracking-summary-card">
          <span>Cobertura actual</span>
          <strong>${formatPercent(currentSnapshot.coverage)}</strong>
          <small>Porción del ámbito con medición suficiente.</small>
        </article>
        <article class="tracking-summary-card">
          <span>Último corte oficial</span>
          <strong>${lastOfficial ? formatPercent(lastOfficial.progress) : "—"}</strong>
          <small>${lastOfficial ? `${escapeHTML(lastOfficial.name)} · ${formatDate(lastOfficial.date)}` : "Todavía no hay cortes aprobados."}</small>
        </article>
        <article class="tracking-summary-card">
          <span>Variación desde el último corte</span>
          <strong>${variation === null ? "—" : `${variation > 0 ? "+" : ""}${variation.toFixed(2).replace(".", ",")} pts`}</strong>
          <small>${variation === null ? "Se calculará después del primer corte oficial." : "Diferencia respecto al valor actual."}</small>
        </article>
      `;

      chartHost.innerHTML = renderTrackingChart(officialPoints, {
        includeCurrent: currentSnapshot,
        compact: false
      });

      if (!cuts.length) {
        listHost.innerHTML = `
          <div class="empty-state">
            <strong>No hay cortes registrados.</strong>
            <p>${canManageGlobalStructure() ? "Crea el primer corte para conservar una fotografía del avance actual." : "Todavía no se han registrado cortes para esta Vigencia."}</p>
          </div>
        `;
      } else {
        let previousOfficial = null;
        listHost.innerHTML = cuts.slice().reverse().map((cut) => {
          // La variación se calcula contra el corte oficial anterior en orden cronológico.
          const chronologicalIndex = cuts.findIndex((item) => item.id === cut.id);
          previousOfficial = cuts
            .slice(0, chronologicalIndex)
            .filter((item) => ["aprobado", "cerrado"].includes(item.estado))
            .at(-1) || null;
          return renderCutCard(cut, previousOfficial);
        }).join("");
      }
    } catch (error) {
      console.error(error);
      summaryHost.innerHTML = "";
      chartHost.innerHTML = `<div class="empty-state"><strong>No fue posible cargar el histórico.</strong><p>${escapeHTML(error.message || "Intenta nuevamente.")}</p></div>`;
      listHost.innerHTML = "";
    }
  }

  try {
    vigencias = await loadVigencias();
    if (!vigencias.length) {
      selector.innerHTML = `<option value="">No hay Vigencias registradas</option>`;
      summaryHost.innerHTML = "";
      chartHost.innerHTML = `<div class="empty-state">Todavía no hay Vigencias.</div>`;
      listHost.innerHTML = "";
      return;
    }

    selectedVigenciaId = navigationTarget?.vigencia_id && vigencias.some((row) => row.id === navigationTarget.vigencia_id)
      ? navigationTarget.vigencia_id
      : (vigencias.find((row) => row.estado === "activa")?.id || vigencias[0].id);

    selector.innerHTML = vigencias.map((row) => `
      <option value="${row.id}" ${row.id === selectedVigenciaId ? "selected" : ""}>
        ${escapeHTML(row.nombre)}${row.estado === "activa" ? " · activa" : ""}
      </option>
    `).join("");
    selector.value = selectedVigenciaId;
    updateNewCutButtonState();

    selector.addEventListener("change", async () => {
      selectedVigenciaId = selector.value;
      updateNewCutButtonState();
      await refresh();
    });

    listHost.addEventListener("click", async (event) => {
      const updateButton = event.target.closest(".update-cut-snapshot");
      if (updateButton) {
        const cut = cuts.find((row) => row.id === updateButton.dataset.cutId);
        if (!cut) return;
        openModal({
          title: "Actualizar fotografía del corte",
          content: `
            <p><strong>${escapeHTML(cut.nombre)}</strong></p>
            <p class="notice">Se sustituirán los valores de avance y cobertura de este corte por la información actualmente registrada en el Plan. Esta opción solo está disponible antes de la aprobación.</p>
            <p id="refreshCutMessage" class="form-message"></p>
            <div class="form-actions">
              <button id="cancelRefreshCut" class="btn btn-secondary" type="button">Cancelar</button>
              <button id="confirmRefreshCut" class="btn btn-primary" type="button">Actualizar fotografía</button>
            </div>
          `
        });
        document.querySelector("#cancelRefreshCut")?.addEventListener("click", closeModal);
        document.querySelector("#confirmRefreshCut")?.addEventListener("click", async () => {
          const button = document.querySelector("#confirmRefreshCut");
          const message = document.querySelector("#refreshCutMessage");
          button.disabled = true;
          button.textContent = "Actualizando…";
          try {
            await refreshCutSnapshot(cut);
            closeModal();
            await refresh();
          } catch (error) {
            console.error(error);
            message.textContent = error.message || "No fue posible actualizar la fotografía.";
            button.disabled = false;
            button.textContent = "Actualizar fotografía";
          }
        });
        return;
      }

      const stateButton = event.target.closest(".advance-cut-state");
      if (stateButton) {
        const cut = cuts.find((row) => row.id === stateButton.dataset.cutId);
        if (!cut) return;
        stateConfirmation(cut, stateButton.dataset.nextState, async () => {
          await changeCutState(cut, stateButton.dataset.nextState);
          await refresh();
        });
      }
    });

    await refresh();
  } catch (error) {
    console.error(error);
    selector.innerHTML = `<option value="">No disponible</option>`;
    chartHost.innerHTML = `<div class="empty-state"><strong>No fue posible cargar Cortes de seguimiento.</strong><p>${escapeHTML(error.message || "Intenta nuevamente.")}</p></div>`;
    listHost.innerHTML = "";
  }
}
