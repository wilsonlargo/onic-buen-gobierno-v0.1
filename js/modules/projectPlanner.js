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

function safeFilename(value = "") {
  return String(value || "planeador")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 110) || "planeador";
}

function lightenHex(hex, amount = 0.82) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return "#E7ECE9";
  const raw = match[1];
  const parts = [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16));
  const mixed = parts.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function plannerExportContext(context = {}) {
  return {
    vigencia: context.vigenciaNombre || "—",
    consejeria: context.consejeriaNombre || "—",
    linea: context.lineaNombre || "—",
    programa: context.programaNombre || "—"
  };
}

function activityExportStats({ activities, indicators, evidence, budgetItems, metrics }) {
  const indicatorCounts = new Map();
  indicators.forEach((item) => indicatorCounts.set(item.actividad_id, (indicatorCounts.get(item.actividad_id) || 0) + 1));
  const evidenceCounts = new Map();
  evidence.filter((item) => item.estado === "activa").forEach((item) => evidenceCounts.set(item.actividad_id, (evidenceCounts.get(item.actividad_id) || 0) + 1));

  return activities.map((activity, index) => {
    const progress = metrics.progressByActivity.get(activity.id);
    const status = timingStatus(activity, progress);
    const programmed = budgetItems
      .filter((item) => item.actividad_id === activity.id && item.estado === "activo")
      .reduce((sum, item) => sum + Number(item.programado || 0), 0);
    return {
      activity,
      index,
      color: colorForActivity(activity, index),
      progress,
      status,
      indicatorCount: indicatorCounts.get(activity.id) || 0,
      evidenceCount: evidenceCounts.get(activity.id) || 0,
      programmed
    };
  });
}

function periodIntersectsActivity(activity, period) {
  const start = parseDate(activity.fecha_inicio);
  const end = parseDate(activity.fecha_fin);
  if (!start || !end) return false;
  const activityEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
  return start <= period.end && activityEnd >= period.start;
}

function activePeriodIndices(activity, periods) {
  const indices = [];
  periods.forEach((period, index) => {
    if (periodIntersectsActivity(activity, period)) indices.push(index);
  });
  return indices;
}

function periodContainsToday(period) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return today >= period.start && today <= period.end;
}

async function logoDataUrl() {
  try {
    const response = await fetch("./assets/branding/onic-logo.png", { cache: "no-store" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("No fue posible cargar el logo para el Planeador.", error);
    return null;
  }
}

function pdfHeader(logo, title) {
  return {
    columns: [
      ...(logo ? [{ image: logo, width: 30, margin: [0, 0, 10, 0] }] : []),
      {
        stack: [
          { text: "ORGANIZACIÓN NACIONAL INDÍGENA DE COLOMBIA - ONIC", bold: true, color: "#0F4230", fontSize: 9 },
          { text: title, bold: true, color: "#1C2B24", fontSize: 15, margin: [0, 3, 0, 0] }
        ]
      }
    ],
    margin: [0, 0, 0, 12]
  };
}

function pdfMetadata(project, context, viewLabel, scaleLabel = null) {
  const c = plannerExportContext(context);
  const rows = [
    ["Proyecto", project.nombre || "—", "Vigencia", c.vigencia],
    ["Consejería", c.consejeria, "Programa", c.programa],
    ["Línea de Acción", c.linea, "Vista", `${viewLabel}${scaleLabel ? ` · ${scaleLabel}` : ""}`],
    ["Periodo del Proyecto", `${formatDate(project.fecha_inicio)} – ${formatDate(project.fecha_fin)}`, "Generado", new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "long", year: "numeric" }).format(new Date())]
  ];
  return {
    table: {
      widths: [78, "*", 74, "*"],
      body: rows.map((row) => row.map((cell, index) => ({
        text: String(cell ?? "—"),
        bold: index % 2 === 0,
        color: index % 2 === 0 ? "#0F4230" : "#26312C",
        fontSize: 7.4,
        margin: [4, 3, 4, 3]
      })))
    },
    layout: {
      hLineColor: () => "#DCE5E0",
      vLineColor: () => "#DCE5E0"
    },
    margin: [0, 0, 0, 12]
  };
}

function pdfSummary(metrics, activities, range) {
  const duration = range ? monthDifferenceInclusive(range.start, range.end) : null;
  const values = [
    ["Duración", duration ? `${duration} ${duration === 1 ? "mes" : "meses"}` : "—"],
    ["Actividades", String(activities.length)],
    ["Cobertura técnica", metrics.includedCount ? `${metrics.measurableCount}/${metrics.includedCount}` : "—"],
    ["Avance técnico", formatPercent(metrics.technicalProgress)]
  ];
  return {
    columns: values.map(([label, value]) => ({
      width: "*",
      stack: [
        { text: label, fontSize: 6.8, bold: true, color: "#66716B" },
        { text: value, fontSize: 12, bold: true, color: "#0F4230", margin: [0, 2, 0, 0] }
      ],
      margin: [6, 5, 6, 5]
    })),
    columnGap: 5,
    margin: [0, 0, 0, 12]
  };
}

async function exportPlannerPdf({ project, activities, indicators, budgetItems, evidence, metrics, view, scale, context }) {
  if (!window.pdfMake || typeof window.pdfMake.createPdf !== "function") {
    throw new Error("El generador PDF no está disponible. Recarga la página y vuelve a intentarlo.");
  }
  const range = deriveTimelineRange(project, activities);
  const stats = activityExportStats({ activities, indicators, evidence, budgetItems, metrics });
  const logo = await logoDataUrl();
  const content = [
    pdfHeader(logo, view === "cronograma" ? "Planeador del Proyecto - Cronograma" : "Planeador del Proyecto - Matriz"),
    pdfMetadata(project, context, view === "cronograma" ? "Cronograma" : "Matriz", view === "cronograma" ? (scale === "trimestral" ? "Trimestral" : "Mensual") : null),
    pdfSummary(metrics, activities, range)
  ];

  if (view === "matriz") {
    const header = ["Código", "Actividad", "Responsable", "Inicio", "Fin", "Estado", "Avance", "Ind.", "Evid.", "Presupuesto"];
    const body = [header.map((text) => ({ text, bold: true, color: "#FFFFFF", fillColor: "#0F4230", fontSize: 6.7, margin: [3, 4, 3, 4] }))];
    stats.forEach((item) => {
      body.push([
        { text: item.activity.codigo || `A${item.index + 1}`, bold: true, color: "#FFFFFF", fillColor: item.color.hex, fontSize: 6.8, margin: [3, 4, 3, 4] },
        { text: item.activity.nombre || "—", fontSize: 6.7, margin: [3, 4, 3, 4] },
        { text: item.activity.responsable || "—", fontSize: 6.4, margin: [3, 4, 3, 4] },
        { text: formatDate(item.activity.fecha_inicio), fontSize: 6.3, margin: [3, 4, 3, 4] },
        { text: formatDate(item.activity.fecha_fin), fontSize: 6.3, margin: [3, 4, 3, 4] },
        { text: item.status.label, fontSize: 6.3, margin: [3, 4, 3, 4] },
        { text: formatPercent(item.progress), bold: true, color: "#0F4230", fontSize: 6.5, alignment: "right", margin: [3, 4, 3, 4] },
        { text: String(item.indicatorCount), fontSize: 6.5, alignment: "center", margin: [3, 4, 3, 4] },
        { text: String(item.evidenceCount), fontSize: 6.5, alignment: "center", margin: [3, 4, 3, 4] },
        { text: formatMoney(item.programmed), fontSize: 6.2, alignment: "right", margin: [3, 4, 3, 4] }
      ]);
    });
    content.push({
      table: { headerRows: 1, widths: [35, "*", 72, 50, 50, 53, 43, 27, 27, 67], body },
      layout: { hLineColor: () => "#DDE5E1", vLineColor: () => "#DDE5E1", fillColor: (rowIndex) => rowIndex > 0 && rowIndex % 2 === 0 ? "#F7F9F8" : null }
    });
    content.push({ text: "El avance técnico se calcula a partir de los indicadores. El presupuesto se presenta como información independiente.", fontSize: 6.5, color: "#66716B", italics: true, margin: [0, 8, 0, 0] });
  } else {
    if (!range) throw new Error("El cronograma requiere fechas del Proyecto o de las Actividades.");
    const periods = makePeriods(range, scale);
    const chunkSize = scale === "trimestral" ? 8 : 12;
    const chunks = [];
    for (let i = 0; i < periods.length; i += chunkSize) chunks.push({ startIndex: i, periods: periods.slice(i, i + chunkSize) });

    chunks.forEach((chunk, chunkIndex) => {
      if (chunkIndex > 0) content.push({ text: "", pageBreak: "before" });
      const endIndex = chunk.startIndex + chunk.periods.length - 1;
      content.push({ text: `${scale === "trimestral" ? "Periodos" : "Meses"} ${chunk.startIndex + 1}–${endIndex + 1}`, bold: true, color: "#0F4230", fontSize: 9, margin: [0, chunkIndex ? 0 : 2, 0, 6] });
      const header = [
        { text: "Actividad", bold: true, color: "#FFFFFF", fillColor: "#0F4230", fontSize: 6.8, margin: [3, 4, 3, 4] },
        ...chunk.periods.map((period) => ({
          text: `${period.label}\n${period.calendarLabel}${periodContainsToday(period) ? "\nHOY" : ""}`,
          bold: true,
          color: periodContainsToday(period) ? "#7A0E1B" : "#0F4230",
          fillColor: periodContainsToday(period) ? "#FDECEF" : "#EEF4F1",
          alignment: "center",
          fontSize: 5.8,
          margin: [1, 3, 1, 3]
        }))
      ];
      const body = [header];
      stats.forEach((item) => {
        const scheduled = activePeriodIndices(item.activity, periods);
        const completedCount = item.progress === null ? 0 : Math.round(scheduled.length * clamp(Number(item.progress), 0, 100) / 100);
        const completed = new Set(scheduled.slice(0, completedCount));
        const scheduledSet = new Set(scheduled);
        const row = [{
          stack: [
            { text: `${item.activity.codigo || `A${item.index + 1}`} · ${item.activity.nombre || "—"}`, bold: true, color: "#1C2B24", fontSize: 6.4 },
            { text: `${formatPercent(item.progress)} · ${item.status.label}`, color: "#66716B", fontSize: 5.8, margin: [0, 2, 0, 0] }
          ],
          border: [true, true, true, true],
          borderColor: ["#DDE5E1", "#DDE5E1", "#DDE5E1", "#DDE5E1"],
          margin: [3, 3, 3, 3]
        }];
        chunk.periods.forEach((period, localIndex) => {
          const globalIndex = chunk.startIndex + localIndex;
          const isPlanned = scheduledSet.has(globalIndex);
          const isCompleted = completed.has(globalIndex);
          row.push({
            text: isCompleted ? "●" : isPlanned ? "•" : "",
            color: isCompleted ? "#FFFFFF" : item.color.hex,
            fillColor: isCompleted ? item.color.hex : isPlanned ? lightenHex(item.color.hex, 0.80) : "#FFFFFF",
            alignment: "center",
            fontSize: 7,
            margin: [0, 5, 0, 5]
          });
        });
        body.push(row);
      });
      content.push({
        table: { headerRows: 1, widths: [190, ...chunk.periods.map(() => "*")], body },
        layout: { hLineColor: () => "#DDE5E1", vLineColor: () => "#DDE5E1" }
      });
      content.push({
        columns: [
          { text: "● Avance técnico aproximado dentro del periodo programado", fontSize: 6.1, color: "#52615A" },
          { text: "• Periodo programado", fontSize: 6.1, color: "#52615A" }
        ],
        margin: [0, 6, 0, 0]
      });
    });
  }

  const definition = {
    pageSize: "LETTER",
    pageOrientation: "landscape",
    pageMargins: [28, 34, 28, 30],
    info: {
      title: `${project.nombre || "Proyecto"} - Planeador`,
      author: "Organización Nacional Indígena de Colombia - ONIC",
      subject: "Planeador del Proyecto",
      creator: "ONIC Buen Gobierno"
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "ONIC - Sistema de Buen Gobierno", color: "#66716B", fontSize: 6.5 },
        { text: `Página ${currentPage} de ${pageCount}`, alignment: "right", color: "#66716B", fontSize: 6.5 }
      ],
      margin: [28, 0, 28, 0]
    }),
    defaultStyle: { font: "Roboto", color: "#26312C" },
    content
  };

  const filename = `${safeFilename(project.codigo || project.nombre_corto || project.nombre)}_Planeador_${view === "cronograma" ? "Cronograma" : "Matriz"}.pdf`;
  window.pdfMake.createPdf(definition).download(filename);
  return filename;
}

function requireExcelJS() {
  if (!window.ExcelJS || typeof window.ExcelJS.Workbook !== "function") {
    throw new Error("El generador Excel no está disponible. Recarga la página y vuelve a intentarlo.");
  }
  return window.ExcelJS;
}

function excelARGB(hex) {
  const clean = String(hex || "#FFFFFF").replace("#", "").toUpperCase();
  return `FF${clean.padStart(6, "F").slice(-6)}`;
}

function excelFill(hex) {
  return { type: "pattern", pattern: "solid", fgColor: { argb: excelARGB(hex) } };
}

function excelBorder() {
  const side = { style: "thin", color: { argb: "FFDDE5E1" } };
  return { top: side, left: side, bottom: side, right: side };
}

function excelHeader(cell, fill = "#0F4230") {
  cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  cell.fill = excelFill(fill);
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = excelBorder();
}

function excelMetadataSheetHeader(ws, project, context, title, metrics, range, totalColumns = 10) {
  const c = plannerExportContext(context);
  ws.mergeCells(1, 1, 1, Math.max(4, totalColumns));
  ws.getCell("A1").value = "ORGANIZACIÓN NACIONAL INDÍGENA DE COLOMBIA - ONIC";
  ws.getCell("A1").font = { bold: true, color: { argb: "FF0F4230" }, size: 11 };
  ws.getCell("A1").alignment = { horizontal: "left" };
  ws.mergeCells(2, 1, 2, Math.max(4, totalColumns));
  ws.getCell("A2").value = title;
  ws.getCell("A2").font = { bold: true, color: { argb: "FF1C2B24" }, size: 16 };

  const rows = [
    ["Proyecto", project.nombre || "—", "Vigencia", c.vigencia],
    ["Consejería", c.consejeria, "Programa", c.programa],
    ["Línea de Acción", c.linea, "Periodo", `${formatDate(project.fecha_inicio)} – ${formatDate(project.fecha_fin)}`]
  ];
  rows.forEach((row, idx) => {
    const excelRow = ws.getRow(4 + idx);
    excelRow.values = [row[0], row[1], row[2], row[3]];
    [1, 3].forEach((col) => {
      excelRow.getCell(col).font = { bold: true, color: { argb: "FF0F4230" } };
    });
  });
  ws.getRow(8).values = [
    "Duración planificada", range ? monthDifferenceInclusive(range.start, range.end) : "—",
    "Actividades", metrics.includedCount || 0,
    "Actividades medibles", metrics.measurableCount || 0,
    "Avance técnico", metrics.technicalProgress === null ? null : Number(metrics.technicalProgress) / 100
  ];
  for (const col of [1, 3, 5, 7]) ws.getRow(8).getCell(col).font = { bold: true, color: { argb: "FF66716B" } };
  ws.getRow(8).getCell(8).numFmt = "0.00%";
}

async function saveExcelWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportPlannerExcel({ project, activities, indicators, budgetItems, evidence, metrics, view, scale, context }) {
  const ExcelJS = requireExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ONIC Buen Gobierno";
  workbook.company = "Organización Nacional Indígena de Colombia - ONIC";
  workbook.created = new Date();
  workbook.modified = new Date();
  const range = deriveTimelineRange(project, activities);
  const stats = activityExportStats({ activities, indicators, evidence, budgetItems, metrics });

  if (view === "matriz") {
    const ws = workbook.addWorksheet("Planeador - Matriz", { views: [{ state: "frozen", ySplit: 10 }] });
    excelMetadataSheetHeader(ws, project, context, "PLANEADOR DEL PROYECTO - MATRIZ", metrics, range, 11);
    const headerRow = 10;
    const headers = ["Código", "Actividad", "Responsable", "Inicio", "Fin", "Estado", "Avance técnico", "Indicadores", "Evidencias", "Presupuesto programado", "Color"];
    ws.getRow(headerRow).values = headers;
    ws.getRow(headerRow).eachCell((cell) => excelHeader(cell));
    stats.forEach((item, idx) => {
      const row = ws.getRow(headerRow + 1 + idx);
      row.values = [
        item.activity.codigo || `A${item.index + 1}`,
        item.activity.nombre || "—",
        item.activity.responsable || "—",
        item.activity.fecha_inicio ? parseDate(item.activity.fecha_inicio) : null,
        item.activity.fecha_fin ? parseDate(item.activity.fecha_fin) : null,
        item.status.label,
        item.progress === null ? null : Number(item.progress) / 100,
        item.indicatorCount,
        item.evidenceCount,
        item.programmed,
        colorLabel(item.activity)
      ];
      row.getCell(1).fill = excelFill(item.color.hex);
      row.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.getCell(4).numFmt = "dd/mm/yyyy";
      row.getCell(5).numFmt = "dd/mm/yyyy";
      row.getCell(7).numFmt = "0.00%";
      row.getCell(10).numFmt = '[$$-es-CO]#,##0';
      row.eachCell((cell) => { cell.border = excelBorder(); cell.alignment = { vertical: "top", wrapText: true }; });
    });
    ws.columns = [
      { width: 12 }, { width: 38 }, { width: 24 }, { width: 13 }, { width: 13 }, { width: 16 }, { width: 15 }, { width: 12 }, { width: 11 }, { width: 22 }, { width: 14 }
    ];
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + stats.length, column: headers.length } };
    ws.pageSetup = { orientation: "landscape", paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    const noteRow = headerRow + stats.length + 2;
    ws.mergeCells(noteRow, 1, noteRow, headers.length);
    ws.getCell(noteRow, 1).value = "El avance técnico se calcula desde los indicadores; el presupuesto se presenta como información independiente.";
    ws.getCell(noteRow, 1).font = { italic: true, color: { argb: "FF66716B" }, size: 9 };
  } else {
    if (!range) throw new Error("El cronograma requiere fechas del Proyecto o de las Actividades.");
    const periods = makePeriods(range, scale);
    const ws = workbook.addWorksheet("Planeador - Cronograma", { views: [{ state: "frozen", xSplit: 6, ySplit: 10 }] });
    excelMetadataSheetHeader(ws, project, context, `PLANEADOR DEL PROYECTO - CRONOGRAMA ${scale === "trimestral" ? "TRIMESTRAL" : "MENSUAL"}`, metrics, range, 6 + periods.length);
    const headerRow = 10;
    const baseHeaders = ["Código", "Actividad", "Responsable", "Inicio", "Fin", "Avance"];
    ws.getRow(headerRow).values = [...baseHeaders, ...periods.map((period) => `${period.label}\n${period.calendarLabel}${periodContainsToday(period) ? "\nHOY" : ""}`)];
    ws.getRow(headerRow).eachCell((cell, col) => excelHeader(cell, col > baseHeaders.length && periodContainsToday(periods[col - baseHeaders.length - 1]) ? "#A30C22" : "#0F4230"));
    stats.forEach((item, idx) => {
      const row = ws.getRow(headerRow + 1 + idx);
      row.values = [
        item.activity.codigo || `A${item.index + 1}`,
        item.activity.nombre || "—",
        item.activity.responsable || "—",
        item.activity.fecha_inicio ? parseDate(item.activity.fecha_inicio) : null,
        item.activity.fecha_fin ? parseDate(item.activity.fecha_fin) : null,
        item.progress === null ? null : Number(item.progress) / 100
      ];
      row.getCell(1).fill = excelFill(item.color.hex);
      row.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.getCell(4).numFmt = "dd/mm/yyyy";
      row.getCell(5).numFmt = "dd/mm/yyyy";
      row.getCell(6).numFmt = "0.00%";
      const scheduled = activePeriodIndices(item.activity, periods);
      const completedCount = item.progress === null ? 0 : Math.round(scheduled.length * clamp(Number(item.progress), 0, 100) / 100);
      const completed = new Set(scheduled.slice(0, completedCount));
      const scheduledSet = new Set(scheduled);
      periods.forEach((period, pIndex) => {
        const cell = row.getCell(baseHeaders.length + 1 + pIndex);
        if (scheduledSet.has(pIndex)) {
          cell.fill = excelFill(completed.has(pIndex) ? item.color.hex : lightenHex(item.color.hex, 0.80));
          cell.value = completed.has(pIndex) ? "●" : "•";
          cell.font = { bold: true, color: { argb: completed.has(pIndex) ? "FFFFFFFF" : excelARGB(item.color.hex) } };
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
        cell.border = excelBorder();
      });
      for (let col = 1; col <= baseHeaders.length; col += 1) {
        row.getCell(col).border = excelBorder();
        row.getCell(col).alignment = { vertical: "top", wrapText: true };
      }
    });
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 36;
    ws.getColumn(3).width = 24;
    ws.getColumn(4).width = 13;
    ws.getColumn(5).width = 13;
    ws.getColumn(6).width = 12;
    periods.forEach((period, idx) => { ws.getColumn(baseHeaders.length + 1 + idx).width = scale === "trimestral" ? 13 : 9; });
    ws.pageSetup = { orientation: "landscape", paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    const legendRow = headerRow + stats.length + 2;
    ws.getCell(legendRow, 1).value = "Leyenda";
    ws.getCell(legendRow, 1).font = { bold: true, color: { argb: "FF0F4230" } };
    ws.getCell(legendRow + 1, 1).value = "●";
    ws.getCell(legendRow + 1, 2).value = "Avance técnico aproximado dentro del periodo programado";
    ws.getCell(legendRow + 2, 1).value = "•";
    ws.getCell(legendRow + 2, 2).value = "Periodo programado";
  }

  const filename = `${safeFilename(project.codigo || project.nombre_corto || project.nombre)}_Planeador_${view === "cronograma" ? "Cronograma" : "Matriz"}.xlsx`;
  await saveExcelWorkbook(workbook, filename);
  return filename;
}

export async function exportProjectPlanner(options) {
  const format = String(options?.format || "").toLowerCase();
  if (format === "pdf") return exportPlannerPdf(options);
  if (format === "excel" || format === "xlsx") return exportPlannerExcel(options);
  throw new Error("Selecciona un formato de exportación válido.");
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
  onChangeColor,
  onExport
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
        <div class="planner-export-actions" role="group" aria-label="Exportar Planeador">
          <button class="btn btn-secondary planner-export-button" data-planner-export="pdf" type="button" title="Exportar la vista actual del Planeador en PDF">PDF</button>
          <button class="btn btn-secondary planner-export-button" data-planner-export="excel" type="button" title="Exportar la vista actual del Planeador en Excel">Excel</button>
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
  body.querySelectorAll("[data-planner-export]").forEach((button) => button.addEventListener("click", async () => {
    const buttons = [...body.querySelectorAll("[data-planner-export]")];
    const original = button.textContent;
    buttons.forEach((item) => { item.disabled = true; });
    button.textContent = "Generando…";
    try {
      await onExport?.({ format: button.dataset.plannerExport, view, scale });
    } finally {
      buttons.forEach((item) => { item.disabled = false; });
      button.textContent = original;
    }
  }));
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
