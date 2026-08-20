const COLOR_OPTIONS = [
  { value: "", label: "Automático", hex: "#4f7f67" },
  { value: "verde", label: "Verde", hex: "#4f7f67" },
  { value: "azul", label: "Azul", hex: "#4d7298" },
  { value: "turquesa", label: "Turquesa", hex: "#3f8585" },
  { value: "amarillo", label: "Amarillo", hex: "#c79a3b" },
  { value: "naranja", label: "Naranja", hex: "#bd6f3d" },
  { value: "rojo", label: "Rojo", hex: "#a95454" },
  { value: "morado", label: "Morado", hex: "#735f8f" },
  { value: "gris", label: "Gris", hex: "#707781" }
];

const AUTO_COLORS = COLOR_OPTIONS.filter((item) => item.value && item.value !== "gris");

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(2).replace(".", ",")} %`;
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

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function monthDifferenceInclusive(start, end) {
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
}

function colorForActivity(activity, index) {
  const stored = COLOR_OPTIONS.find((item) => item.value === (activity.planeador_color || ""));
  if (stored && stored.value) return stored;
  return AUTO_COLORS[index % AUTO_COLORS.length] || COLOR_OPTIONS[1];
}

function colorLabel(activity) {
  const option = COLOR_OPTIONS.find((item) => item.value === (activity.planeador_color || ""));
  return option?.label || "Automático";
}

function hexAlpha(hex, alpha = "22") {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;
}

function deriveTimelineRange(project, activities) {
  const projectStart = parseDate(project.fecha_inicio);
  const projectEnd = parseDate(project.fecha_fin);
  const activityStarts = activities.map((item) => parseDate(item.fecha_inicio)).filter(Boolean);
  const activityEnds = activities.map((item) => parseDate(item.fecha_fin)).filter(Boolean);

  let start = projectStart || (activityStarts.length ? new Date(Math.min(...activityStarts.map((d) => d.getTime()))) : null);
  let end = projectEnd || (activityEnds.length ? new Date(Math.max(...activityEnds.map((d) => d.getTime()))) : null);

  if (!start && end) start = new Date(end.getFullYear(), end.getMonth(), 1);
  if (start && !end) end = new Date(start.getFullYear(), start.getMonth(), 1);
  if (!start || !end) return null;
  if (end < start) [start, end] = [end, start];

  return {
    start: startOfMonth(start),
    end: endOfMonth(end),
    source: projectStart || projectEnd ? "proyecto" : "actividades"
  };
}

function makePeriods(range, scale) {
  if (!range) return [];
  const months = monthDifferenceInclusive(range.start, range.end);
  const size = scale === "trimestral" ? 3 : 1;
  const periods = [];

  for (let offset = 0; offset < months; offset += size) {
    const periodStart = addMonths(range.start, offset);
    const periodEnd = endOfMonth(addMonths(range.start, Math.min(offset + size - 1, months - 1)));
    const monthNumberStart = offset + 1;
    const monthNumberEnd = Math.min(offset + size, months);
    const calendarLabel = new Intl.DateTimeFormat("es-CO", {
      month: "short",
      year: periodStart.getFullYear() !== range.start.getFullYear() || offset === 0 ? "2-digit" : undefined
    }).format(periodStart).replace(".", "");

    periods.push({
      start: periodStart,
      end: periodEnd,
      label: scale === "trimestral" ? `M${monthNumberStart}–M${monthNumberEnd}` : `M${monthNumberStart}`,
      calendarLabel
    });
  }
  return periods;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function activityPosition(activity, range) {
  if (!range) return null;
  const start = parseDate(activity.fecha_inicio);
  const end = parseDate(activity.fecha_fin);
  if (!start || !end) return null;

  const rangeStart = range.start.getTime();
  const rangeEnd = range.end.getTime();
  const total = Math.max(1, rangeEnd - rangeStart);
  const activityStart = clamp(start.getTime(), rangeStart, rangeEnd);
  const activityEnd = clamp(new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime(), rangeStart, rangeEnd);
  const left = ((activityStart - rangeStart) / total) * 100;
  const right = ((activityEnd - rangeStart) / total) * 100;
  return {
    left: clamp(left, 0, 100),
    width: Math.max(1.5, clamp(right - left, 0, 100 - left))
  };
}

function timingStatus(activity, progress) {
  if (activity.estado === "cancelada") return { label: "Cancelada", css: "closed" };
  if (activity.estado === "suspendida") return { label: "Suspendida", css: "warning" };
  if (activity.estado === "completada" || Number(progress) >= 100) return { label: "Completada", css: "active" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseDate(activity.fecha_inicio);
  const end = parseDate(activity.fecha_fin);

  if (!start && !end) return { label: "Sin fechas", css: "draft" };
  if (end && end < today) return { label: "Vencida", css: "danger" };
  if (start && start > today) return { label: "Programada", css: "draft" };
  if (start && end && start <= today && end >= today) return { label: "En curso", css: "active" };
  return { label: "Planificada", css: "draft" };
}

function todayPosition(range) {
  if (!range) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (today < range.start || today > range.end) return null;
  const total = range.end.getTime() - range.start.getTime();
  return total <= 0 ? null : ((today.getTime() - range.start.getTime()) / total) * 100;
}

function summaryHTML({ project, activities, metrics, range }) {
  const noDates = activities.filter((item) => !item.fecha_inicio || !item.fecha_fin).length;
  const duration = range ? monthDifferenceInclusive(range.start, range.end) : null;
  return `
    <div class="planner-summary-grid">
      <div class="planner-summary-card"><span>Duración planificada</span><strong>${duration ? `${duration} ${duration === 1 ? "mes" : "meses"}` : "—"}</strong><small>${range?.source === "actividades" ? "Calculada desde las Actividades" : "Periodo del Proyecto"}</small></div>
      <div class="planner-summary-card"><span>Actividades</span><strong>${activities.length}</strong><small>${noDates ? `${noDates} sin periodo completo` : "Todas con periodo definido"}</small></div>
      <div class="planner-summary-card"><span>Cobertura técnica</span><strong>${metrics.includedCount ? `${metrics.measurableCount}/${metrics.includedCount}` : "—"}</strong><small>Actividades medibles</small></div>
      <div class="planner-summary-card"><span>Avance técnico</span><strong>${formatPercent(metrics.technicalProgress)}</strong><small>Calculado desde indicadores</small></div>
    </div>`;
}

function quickLinksHTML(activity, counts, budget) {
  return `
    <div class="planner-quick-links" aria-label="Accesos de ${escapeHTML(activity.nombre)}">
      <button class="planner-link" type="button" data-open-tab="indicadores" data-id="${activity.id}"><span>Indicadores</span><strong>${counts.indicators}</strong></button>
      <button class="planner-link" type="button" data-open-tab="evidencias" data-id="${activity.id}"><span>Evidencias</span><strong>${counts.evidence}</strong></button>
      <button class="planner-link planner-link-wide" type="button" data-open-tab="presupuesto" data-id="${activity.id}"><span>Presupuesto</span><strong>${formatMoney(budget.programmed)}</strong></button>
      <button class="planner-link" type="button" data-open-tab="seguimiento" data-id="${activity.id}"><span>Seguimiento</span><strong>→</strong></button>
    </div>`;
}

function matrixHTML({ activities, metrics, indicators, evidence, budgetItems }) {
  if (!activities.length) {
    return `<div class="empty-state workspace-empty"><strong>El Proyecto todavía no tiene actividades.</strong><p>Crea actividades para construir la matriz de planeación y seguimiento.</p></div>`;
  }

  const indicatorCounts = new Map();
  indicators.forEach((item) => indicatorCounts.set(item.actividad_id, (indicatorCounts.get(item.actividad_id) || 0) + 1));
  const evidenceCounts = new Map();
  evidence.filter((item) => item.estado === "activa").forEach((item) => evidenceCounts.set(item.actividad_id, (evidenceCounts.get(item.actividad_id) || 0) + 1));

  return `
    <div class="planner-matrix-list">
      ${activities.map((activity, index) => {
        const color = colorForActivity(activity, index);
        const progress = metrics.progressByActivity.get(activity.id);
        const status = timingStatus(activity, progress);
        const activityBudget = budgetItems.filter((item) => item.actividad_id === activity.id && item.estado === "activo");
        const budget = {
          programmed: activityBudget.reduce((sum, item) => sum + Number(item.programado || 0), 0)
        };
        const counts = {
          indicators: indicatorCounts.get(activity.id) || 0,
          evidence: evidenceCounts.get(activity.id) || 0
        };

        return `
          <article class="planner-matrix-card ${activity.estado === "cancelada" ? "is-cancelled" : ""}" style="--planner-color:${color.hex}; --planner-color-soft:${hexAlpha(color.hex, "1f")}">
            <div class="planner-matrix-main">
              <div class="planner-activity-identity">
                <button class="planner-color-button edit-activity-color" type="button" data-color-id="${activity.id}" title="Cambiar color" aria-label="Cambiar color de ${escapeHTML(activity.nombre)}"><span style="background:${color.hex}"></span></button>
                <div><p class="eyebrow">${escapeHTML(activity.codigo || `Actividad ${index + 1}`)}</p><h4>${escapeHTML(activity.nombre)}</h4><small>${escapeHTML(activity.responsable || "Sin responsable")}</small></div>
              </div>
              <div class="planner-period"><span>Periodo</span><strong>${formatDate(activity.fecha_inicio)} – ${formatDate(activity.fecha_fin)}</strong><small>${colorLabel(activity)}</small></div>
              <div class="planner-progress"><span>Avance</span><strong>${formatPercent(progress)}</strong><div class="planner-mini-progress"><span style="width:${progress === null ? 0 : clamp(Number(progress), 0, 100)}%; background:${color.hex}"></span></div></div>
              <div class="planner-state"><span class="status-chip ${status.css}">${status.label}</span></div>
            </div>
            ${quickLinksHTML(activity, counts, budget)}
            <div class="planner-card-actions">
              <button class="btn btn-primary planner-open-activity" type="button" data-id="${activity.id}">Abrir actividad</button>
              <button class="btn btn-secondary planner-edit-activity edit-activity" type="button" data-id="${activity.id}">Planificar</button>
              <button class="btn btn-secondary planner-audit-note" type="button" data-id="${activity.id}">Nota</button>
            </div>
          </article>`;
      }).join("")}
    </div>`;
}

function timelineHTML({ project, activities, metrics, range, scale }) {
  if (!activities.length) {
    return `<div class="empty-state workspace-empty"><strong>No hay actividades para mostrar.</strong><p>Agrega actividades al Proyecto para construir la línea de tiempo.</p></div>`;
  }
  if (!range) {
    return `<div class="calculation-note"><strong>La línea de tiempo necesita fechas.</strong><p>Define el periodo del Proyecto o las fechas de inicio y cierre de las Actividades.</p></div>`;
  }

  const periods = makePeriods(range, scale);
  const minWidth = Math.max(720, periods.length * (scale === "trimestral" ? 130 : 82));
  const today = todayPosition(range);

  return `
    <div class="planner-timeline-scroll">
      <div class="planner-timeline" style="--timeline-min-width:${minWidth}px">
        <div class="planner-timeline-head">
          <div class="planner-timeline-left-head">Actividad</div>
          <div class="planner-axis" style="grid-template-columns:repeat(${periods.length}, minmax(0,1fr))">
            ${periods.map((period) => `<div><strong>${period.label}</strong><small>${escapeHTML(period.calendarLabel)}</small></div>`).join("")}
          </div>
        </div>
        <div class="planner-timeline-body">
          ${activities.map((activity, index) => {
            const color = colorForActivity(activity, index);
            const progress = metrics.progressByActivity.get(activity.id);
            const position = activityPosition(activity, range);
            const status = timingStatus(activity, progress);
            return `
              <div class="planner-timeline-row ${activity.estado === "cancelada" ? "is-cancelled" : ""}">
                <div class="planner-timeline-label">
                  <button class="planner-color-button edit-activity-color" type="button" data-color-id="${activity.id}" title="Cambiar color"><span style="background:${color.hex}"></span></button>
                  <button class="planner-timeline-open" type="button" data-id="${activity.id}"><strong>${escapeHTML(activity.codigo || `A${index + 1}`)}</strong><span>${escapeHTML(activity.nombre)}</span></button>
                  <small>${formatPercent(progress)} · ${status.label}</small>
                </div>
                <div class="planner-track-area">
                  <div class="planner-grid-lines" style="grid-template-columns:repeat(${periods.length}, minmax(0,1fr))">${periods.map(() => `<span></span>`).join("")}</div>
                  ${today !== null ? `<span class="planner-today-line" style="left:${today}%"><em>Hoy</em></span>` : ""}
                  ${position ? `<button class="planner-timebar planner-timeline-open" type="button" data-id="${activity.id}" style="left:${position.left}%;width:${position.width}%;border-color:${color.hex};background:${hexAlpha(color.hex, "22")}" title="${escapeHTML(activity.nombre)} · ${formatDate(activity.fecha_inicio)} a ${formatDate(activity.fecha_fin)}"><span class="planner-timebar-progress" style="width:${progress === null ? 0 : clamp(Number(progress), 0, 100)}%;background:${color.hex}"></span><strong>${progress === null ? "" : `${Math.round(Number(progress))}%`}</strong></button>` : `<button class="planner-no-dates planner-edit-activity edit-activity" type="button" data-id="${activity.id}">Definir fechas</button>`}
                </div>
              </div>`;
          }).join("")}
        </div>
      </div>
    </div>
    <div class="planner-legend"><span><i class="planner-legend-swatch plan"></i>Periodo programado</span><span><i class="planner-legend-swatch progress"></i>Avance técnico dentro del periodo</span>${today !== null ? `<span><i class="planner-legend-line"></i>Fecha actual</span>` : ""}</div>`;
}

export function plannerColorOptions() {
  return [...COLOR_OPTIONS];
}

export function renderProjectPlanner({
  container,
  project,
  activities,
  indicators,
  budgetItems,
  evidence,
  metrics,
  view = "matriz",
  scale = "mensual",
  onViewChange,
  onScaleChange,
  onOpenActivity,
  onEditActivity,
  onNewActivity,
  onAuditActivity,
  onChangeColor
}) {
  const range = deriveTimelineRange(project, activities);
  const body = container;

  body.innerHTML = `
    <section class="workspace-section workspace-section-flush planner-section">
      <div class="workspace-section-heading planner-heading">
        <div><p class="eyebrow">Planeación y seguimiento</p><h3>Planeador del Proyecto</h3><p class="muted">Visualiza las mismas Actividades del Proyecto como matriz o línea de tiempo. Indicadores, Evidencias, Presupuesto y Seguimiento permanecen vinculados a cada Actividad.</p></div>
        <button id="plannerNewActivity" class="btn btn-primary" type="button">+ Nueva actividad</button>
      </div>
      ${summaryHTML({ project, activities, metrics, range })}
      <div class="planner-toolbar">
        <div class="planner-view-switch" role="group" aria-label="Vista del Planeador">
          <button class="${view === "matriz" ? "active" : ""}" data-planner-view="matriz" type="button">Vista matriz</button>
          <button class="${view === "cronograma" ? "active" : ""}" data-planner-view="cronograma" type="button">Vista cronograma</button>
        </div>
        <div class="planner-scale-switch ${view === "cronograma" ? "" : "hidden"}" role="group" aria-label="Escala del cronograma">
          <button class="${scale === "mensual" ? "active" : ""}" data-planner-scale="mensual" type="button">Mensual</button>
          <button class="${scale === "trimestral" ? "active" : ""}" data-planner-scale="trimestral" type="button">Trimestral</button>
        </div>
      </div>
      <div class="planner-guidance"><strong>Cómo leer el Planeador</strong><p>La extensión de cada barra representa el tiempo programado de la Actividad. El relleno interior muestra su avance técnico calculado desde los indicadores. El color es únicamente una ayuda visual y no modifica estados, ponderaciones ni porcentajes.</p></div>
      <div id="plannerContent">
        ${view === "cronograma"
          ? timelineHTML({ project, activities, metrics, range, scale })
          : matrixHTML({ activities, metrics, indicators, evidence, budgetItems })}
      </div>
    </section>`;

  body.querySelector("#plannerNewActivity")?.addEventListener("click", () => onNewActivity?.());
  body.querySelectorAll("[data-planner-view]").forEach((button) => button.addEventListener("click", () => onViewChange?.(button.dataset.plannerView)));
  body.querySelectorAll("[data-planner-scale]").forEach((button) => button.addEventListener("click", () => onScaleChange?.(button.dataset.plannerScale)));
  body.querySelectorAll("[data-open-tab]").forEach((button) => button.addEventListener("click", () => onOpenActivity?.(button.dataset.id, button.dataset.openTab)));
  body.querySelectorAll(".planner-open-activity,.planner-timeline-open").forEach((button) => button.addEventListener("click", () => onOpenActivity?.(button.dataset.id, "general")));
  body.querySelectorAll(".planner-edit-activity").forEach((button) => button.addEventListener("click", () => {
    const activity = activities.find((item) => item.id === button.dataset.id);
    if (activity) onEditActivity?.(activity);
  }));
  body.querySelectorAll(".planner-audit-note").forEach((button) => button.addEventListener("click", () => {
    const activity = activities.find((item) => item.id === button.dataset.id);
    if (activity) onAuditActivity?.(activity);
  }));
  body.querySelectorAll(".planner-color-button").forEach((button) => button.addEventListener("click", () => {
    const activity = activities.find((item) => item.id === button.dataset.colorId);
    if (!activity) return;
    onChangeColor?.(activity, COLOR_OPTIONS);
  }));
}
