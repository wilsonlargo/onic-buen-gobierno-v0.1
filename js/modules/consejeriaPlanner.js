import { requireSupabase } from "../supabaseClient.js?v=5.4.16";

const COLORS = [
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
const AUTO_COLORS = COLORS.filter((item) => item.value && item.value !== "gris");

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  if (!value) return "—";
  const date = parseDate(value);
  if (!date) return String(value);
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date).replace(".", "");
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(1).replace(".", ",")} %`;
}

function safeFilename(value = "Planeador_Consejeria") {
  return String(value || "Planeador_Consejeria")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 90) || "Planeador_Consejeria";
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

function deriveRange(vigencia, items) {
  const vigStart = parseDate(vigencia?.fecha_inicio);
  const vigEnd = parseDate(vigencia?.fecha_fin);
  if (vigStart && vigEnd) {
    return { start: startOfMonth(vigStart), end: endOfMonth(vigEnd), source: "vigencia" };
  }
  const starts = items.map((item) => parseDate(item.fecha_inicio)).filter(Boolean);
  const ends = items.map((item) => parseDate(item.fecha_fin)).filter(Boolean);
  if (!starts.length && !ends.length) return null;
  const start = starts.length ? new Date(Math.min(...starts.map((date) => date.getTime()))) : ends[0];
  const end = ends.length ? new Date(Math.max(...ends.map((date) => date.getTime()))) : starts[starts.length - 1];
  return { start: startOfMonth(start), end: endOfMonth(end), source: "actividades" };
}

function makePeriods(range, scale) {
  if (!range) return [];
  const months = monthDifferenceInclusive(range.start, range.end);
  const size = scale === "trimestral" ? 3 : 1;
  const periods = [];
  for (let offset = 0; offset < months; offset += size) {
    const periodStart = addMonths(range.start, offset);
    const finalOffset = Math.min(offset + size - 1, months - 1);
    const periodEnd = endOfMonth(addMonths(range.start, finalOffset));
    const calendarStart = new Intl.DateTimeFormat("es-CO", { month: "short", year: "2-digit" })
      .format(periodStart).replace(".", "");
    const calendarEnd = new Intl.DateTimeFormat("es-CO", { month: "short", year: "2-digit" })
      .format(periodEnd).replace(".", "");
    periods.push({
      start: periodStart,
      end: periodEnd,
      label: scale === "trimestral" ? `T${Math.floor(offset / 3) + 1}` : `M${offset + 1}`,
      calendarLabel: scale === "trimestral" ? `${calendarStart}–${calendarEnd}` : calendarStart
    });
  }
  return periods;
}

function periodContainsToday(period) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return today >= period.start && today <= period.end;
}

function periodIntersectsItem(item, period) {
  const start = parseDate(item.fecha_inicio);
  const end = parseDate(item.fecha_fin);
  if (!start || !end) return false;
  const itemEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
  return start <= period.end && itemEnd >= period.start;
}

function itemPosition(item, range) {
  if (!range) return null;
  const start = parseDate(item.fecha_inicio);
  const end = parseDate(item.fecha_fin);
  if (!start || !end) return null;
  const rangeStart = range.start.getTime();
  const rangeEnd = range.end.getTime();
  const total = Math.max(1, rangeEnd - rangeStart);
  const itemStart = clamp(start.getTime(), rangeStart, rangeEnd);
  const itemEnd = clamp(new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime(), rangeStart, rangeEnd);
  const left = ((itemStart - rangeStart) / total) * 100;
  const right = ((itemEnd - rangeStart) / total) * 100;
  return { left: clamp(left, 0, 100), width: Math.max(1, clamp(right - left, 0, 100 - left)) };
}

function todayPosition(range) {
  if (!range) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (today < range.start || today > range.end) return null;
  const total = range.end.getTime() - range.start.getTime();
  return total <= 0 ? null : ((today.getTime() - range.start.getTime()) / total) * 100;
}

function colorForItem(item, index) {
  const stored = COLORS.find((color) => color.value === (item.planeador_color || ""));
  if (stored?.value) return stored;
  return AUTO_COLORS[index % AUTO_COLORS.length] || COLORS[1];
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
  return clamp((numerator / denominator) * 100, 0, 100);
}

function calculateActivityProgress(indicators = []) {
  const active = indicators.filter((indicator) => indicator.estado === "activo");
  if (!active.length) return null;
  const values = active.map(calculateIndicatorProgress).filter((value) => value !== null);
  if (values.length !== active.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stateMeta(item) {
  const value = String(item.estado || "").toLowerCase();
  if (["completada", "cerrado"].includes(value) || Number(item.progress) >= 100) return { label: "Completada", css: "active" };
  if (["cancelada", "cancelado"].includes(value)) return { label: "Cancelada", css: "closed" };
  if (["suspendida", "suspendido"].includes(value)) return { label: "Suspendida", css: "warning" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseDate(item.fecha_inicio);
  const end = parseDate(item.fecha_fin);
  if (!start && !end) return { label: "Sin fechas", css: "draft" };
  if (end && end < today) return { label: "Vencida", css: "danger" };
  if (start && start > today) return { label: "Programada", css: "draft" };
  if (start && end && start <= today && end >= today) return { label: "En curso", css: "active" };
  return { label: "Planificada", css: "draft" };
}

function flattenPlanningStructure(structure) {
  const items = [];
  (structure?.lineas || []).forEach((linea) => {
    (linea.programas || []).forEach((programa) => {
      (programa.unidades || []).forEach((unidad) => {
        const isGeneral = unidad.tipo_unidad === "actividad_general";
        const activityRows = isGeneral
          ? (unidad.actividades || []).filter((item) => !unidad.actividad_principal_id || item.id === unidad.actividad_principal_id).slice(0, 1)
          : (unidad.actividades || []);
        activityRows.forEach((actividad) => {
          items.push({
            ...actividad,
            linea_id: linea.id,
            linea_nombre: linea.nombre,
            linea_corto: linea.nombre_corto || "",
            programa_id: programa.id,
            programa_nombre: programa.nombre,
            programa_corto: programa.nombre_corto || "",
            proyecto_id: unidad.id,
            proyecto_nombre: unidad.nombre,
            proyecto_codigo: unidad.codigo || unidad.nombre_corto || "",
            tipo_unidad: unidad.tipo_unidad,
            actividad_general: isGeneral,
            // Si la Actividad general fue creada antes de que el registro operativo heredara fechas/responsable,
            // se usa el dato del contenedor como respaldo sin modificar la base.
            responsable: actividad.responsable || unidad.responsable || "",
            fecha_inicio: actividad.fecha_inicio || unidad.fecha_inicio || null,
            fecha_fin: actividad.fecha_fin || unidad.fecha_fin || null,
            estado: actividad.estado || unidad.estado,
            planeador_color: actividad.planeador_color || ""
          });
        });
      });
    });
  });
  return items;
}

export async function getConsejeriaPlannerData(structure) {
  const items = flattenPlanningStructure(structure);
  const ids = items.map((item) => item.id).filter(Boolean);
  let indicators = [];
  if (ids.length) {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("indicadores_actividad")
      .select("id,actividad_id,nombre,estado,linea_base,meta,valor_actual,sentido")
      .in("actividad_id", ids)
      .order("orden", { ascending: true });
    if (error) throw error;
    indicators = data || [];
  }
  const byActivity = new Map();
  indicators.forEach((indicator) => {
    if (!byActivity.has(indicator.actividad_id)) byActivity.set(indicator.actividad_id, []);
    byActivity.get(indicator.actividad_id).push(indicator);
  });
  return items.map((item, index) => {
    const activityIndicators = byActivity.get(item.id) || [];
    const progress = calculateActivityProgress(activityIndicators);
    const enriched = { ...item, progress, indicatorCount: activityIndicators.filter((indicator) => indicator.estado === "activo").length };
    return { ...enriched, timing: stateMeta(enriched), color: colorForItem(enriched, index) };
  });
}

function uniqueOptions(items, key, labelKey) {
  const map = new Map();
  items.forEach((item) => {
    const value = item[key];
    if (!value || map.has(value)) return;
    map.set(value, item[labelKey] || value);
  });
  return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "es"));
}

function summary(items) {
  const projects = new Set(items.filter((item) => !item.actividad_general).map((item) => item.proyecto_id));
  const generals = items.filter((item) => item.actividad_general).length;
  const measurable = items.filter((item) => item.progress !== null);
  const progress = measurable.length === items.length && items.length
    ? items.reduce((sum, item) => sum + Number(item.progress || 0), 0) / items.length
    : null;
  return {
    activities: items.length,
    projects: projects.size,
    generalActivities: generals,
    measurable: measurable.length,
    progress
  };
}

function filtersHTML(items, filters) {
  const lines = uniqueOptions(items, "linea_id", "linea_nombre");
  const programs = uniqueOptions(items, "programa_id", "programa_nombre");
  const responsibles = [...new Set(items.map((item) => item.responsable).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const optionHTML = (value, label, selected) => `<option value="${escapeHTML(value)}" ${selected ? "selected" : ""}>${escapeHTML(label)}</option>`;
  return `
    <div class="consejeria-planner-filters">
      <label><span>Buscar</span><input type="search" data-cp-filter="search" value="${escapeHTML(filters.search)}" placeholder="Actividad, proyecto…"></label>
      <label><span>Línea</span><select data-cp-filter="linea"><option value="">Todas</option>${lines.map(([value, label]) => optionHTML(value, label, filters.linea === value)).join("")}</select></label>
      <label><span>Programa</span><select data-cp-filter="programa"><option value="">Todos</option>${programs.map(([value, label]) => optionHTML(value, label, filters.programa === value)).join("")}</select></label>
      <label><span>Estado</span><select data-cp-filter="estado"><option value="">Todos</option>${["En curso","Programada","Planificada","Completada","Vencida","Suspendida","Cancelada","Sin fechas"].map((label) => optionHTML(label, label, filters.estado === label)).join("")}</select></label>
      <label><span>Responsable</span><select data-cp-filter="responsable"><option value="">Todos</option>${responsibles.map((value) => optionHTML(value, value, filters.responsable === value)).join("")}</select></label>
      <button class="btn btn-secondary cp-clear-filters" type="button">Limpiar</button>
    </div>`;
}

function filterItems(items, filters) {
  const search = normalizeText(filters.search);
  return items.filter((item) => {
    if (filters.linea && item.linea_id !== filters.linea) return false;
    if (filters.programa && item.programa_id !== filters.programa) return false;
    if (filters.estado && item.timing.label !== filters.estado) return false;
    if (filters.responsable && item.responsable !== filters.responsable) return false;
    if (search) {
      const haystack = normalizeText([
        item.nombre, item.codigo, item.proyecto_nombre, item.proyecto_codigo,
        item.programa_nombre, item.linea_nombre, item.responsable
      ].filter(Boolean).join(" "));
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function matrixHTML(items) {
  if (!items.length) return `<div class="empty-state workspace-empty"><strong>No hay actividades para los filtros seleccionados.</strong><p>Prueba limpiando los filtros del Planeador.</p></div>`;
  let lastLine = null;
  let lastProgram = null;
  return `<div class="consejeria-planner-matrix">${items.map((item) => {
    const showLine = item.linea_id !== lastLine;
    const showProgram = showLine || item.programa_id !== lastProgram;
    lastLine = item.linea_id;
    lastProgram = item.programa_id;
    return `
      ${showLine ? `<div class="cp-group-line"><span>Línea</span><strong>${escapeHTML(item.linea_nombre)}</strong></div>` : ""}
      ${showProgram ? `<div class="cp-group-program"><span>Programa</span><strong>${escapeHTML(item.programa_nombre)}</strong></div>` : ""}
      <article class="cp-matrix-row" style="--cp-color:${item.color.hex}; --cp-soft:${item.color.hex}18">
        <button class="cp-item-open" type="button" data-cp-open="${item.id}">
          <span class="cp-item-kind">${item.actividad_general ? "Actividad general" : escapeHTML(item.proyecto_codigo || "Proyecto")}</span>
          <strong>${escapeHTML(item.nombre)}</strong>
          <small>${item.actividad_general ? "Unidad directa" : escapeHTML(item.proyecto_nombre)}</small>
        </button>
        <div class="cp-cell"><span>Responsable</span><strong>${escapeHTML(item.responsable || "—")}</strong></div>
        <div class="cp-cell"><span>Periodo</span><strong>${formatDate(item.fecha_inicio)} – ${formatDate(item.fecha_fin)}</strong></div>
        <div class="cp-cell"><span>Estado</span><strong><span class="status-chip ${escapeHTML(item.timing.css)}">${escapeHTML(item.timing.label)}</span></strong></div>
        <div class="cp-progress-cell"><span>Avance</span><strong>${formatPercent(item.progress)}</strong><div><i style="width:${item.progress === null ? 0 : clamp(Number(item.progress),0,100)}%; background:${item.color.hex}"></i></div><small>${item.indicatorCount} indicador${item.indicatorCount === 1 ? "" : "es"}</small></div>
      </article>`;
  }).join("")}</div>`;
}

function timelineHTML(items, vigencia, scale, { zoom = 100, fit = false } = {}) {
  if (!items.length) return `<div class="empty-state workspace-empty"><strong>No hay actividades para los filtros seleccionados.</strong></div>`;
  const range = deriveRange(vigencia, items);
  if (!range) return `<div class="empty-state workspace-empty"><strong>No hay fechas suficientes para construir el cronograma.</strong><p>Completa las fechas de las Actividades generales o de las actividades de los Proyectos.</p></div>`;
  const periods = makePeriods(range, scale);
  const today = todayPosition(range);
  const safeZoom = clamp(Number(zoom) || 100, 60, 180);
  const baseWidth = Math.max(960, 300 + periods.length * (scale === "trimestral" ? 86 : 72));
  const timelineWidth = fit ? "100%" : `${Math.round(baseWidth * safeZoom / 100)}px`;
  return `
    <div class="cp-timeline-scroll ${fit ? "is-fit" : ""}">
      <div class="cp-timeline ${fit ? "is-fit" : ""}" style="--cp-period-count:${periods.length}; --cp-timeline-min:${timelineWidth}">
        <div class="cp-timeline-head">
          <div class="cp-timeline-label-head">Actividad / estructura</div>
          <div class="cp-axis">${periods.map((period) => `<div class="${periodContainsToday(period) ? "is-today" : ""}"><strong>${escapeHTML(period.label)}</strong><small>${escapeHTML(period.calendarLabel)}</small></div>`).join("")}</div>
        </div>
        ${items.map((item) => {
          const pos = itemPosition(item, range);
          return `<div class="cp-timeline-row">
            <button class="cp-timeline-label" type="button" data-cp-open="${item.id}">
              <span class="cp-timeline-kind">${item.actividad_general ? "Actividad general" : escapeHTML(item.proyecto_codigo || "Proyecto")}</span>
              <strong>${escapeHTML(item.nombre)}</strong>
              <small>${escapeHTML(item.linea_corto || item.linea_nombre)} › ${escapeHTML(item.programa_corto || item.programa_nombre)}</small>
            </button>
            <div class="cp-track">
              <div class="cp-grid">${periods.map(() => "<span></span>").join("")}</div>
              ${today !== null ? `<i class="cp-today" style="left:${today}%"><em>Hoy</em></i>` : ""}
              ${pos ? `<button class="cp-timebar" type="button" data-cp-open="${item.id}" style="left:${pos.left}%; width:${pos.width}%; background:${item.color.hex}22; border-color:${item.color.hex}"><i style="width:${item.progress === null ? 0 : clamp(Number(item.progress),0,100)}%; background:${item.color.hex}"></i><strong>${formatPercent(item.progress)}</strong></button>` : `<button class="cp-no-dates" type="button" data-cp-open="${item.id}">Sin fechas</button>`}
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>
    <div class="planner-legend"><span><i class="planner-legend-swatch plan"></i> Periodo programado</span><span><i class="planner-legend-swatch progress"></i> Avance técnico</span><span><i class="planner-legend-line"></i> Hoy</span></div>`;
}

function summaryHTML(items, visibleItems) {
  const all = summary(items);
  const visible = summary(visibleItems);
  return `<div class="cp-summary-grid">
    <div><span>Actividades planificadas</span><strong>${all.activities}</strong><small>${visible.activities !== all.activities ? `${visible.activities} visibles con filtros` : "Total de la Consejería"}</small></div>
    <div><span>Proyectos</span><strong>${all.projects}</strong><small>${all.generalActivities} actividades generales</small></div>
    <div><span>Cobertura técnica</span><strong>${all.activities ? `${all.measurable}/${all.activities}` : "—"}</strong><small>Actividades con avance calculable</small></div>
    <div><span>Avance medio</span><strong>${formatPercent(all.progress)}</strong><small>${all.progress === null && all.activities ? "Requiere indicadores medibles en todas" : "Promedio simple del Planeador"}</small></div>
  </div>`;
}

function exportRows(items) {
  return items.map((item, index) => ({
    index,
    linea: item.linea_nombre,
    programa: item.programa_nombre,
    unidad: item.proyecto_nombre,
    tipo: item.actividad_general ? "Actividad general" : "Proyecto",
    codigo: item.codigo || item.proyecto_codigo || `A${index + 1}`,
    actividad: item.nombre,
    responsable: item.responsable || "—",
    inicio: item.fecha_inicio,
    fin: item.fecha_fin,
    estado: item.timing.label,
    avance: item.progress,
    indicadores: item.indicatorCount,
    color: item.color.hex
  }));
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
  } catch {
    return null;
  }
}

async function exportPdf({ items, vigencia, consejeria }) {
  if (!window.pdfMake?.createPdf) throw new Error("El generador PDF no está disponible.");
  const rows = exportRows(items);
  const logo = await logoDataUrl();
  const range = deriveRange(vigencia, items);
  const periods = makePeriods(range, "trimestral");
  const content = [
    { columns: [
      ...(logo ? [{ image: logo, width: 30, margin: [0,0,10,0] }] : []),
      { stack: [
        { text: "ORGANIZACIÓN NACIONAL INDÍGENA DE COLOMBIA - ONIC", bold: true, color: "#0F4230", fontSize: 9 },
        { text: "Planeador completo de la Consejería", bold: true, color: "#1C2B24", fontSize: 15, margin: [0,3,0,0] }
      ] }
    ], margin: [0,0,0,12] },
    { table: { widths: [72,"*",72,"*"], body: [
      ["Consejería", consejeria, "Vigencia", vigencia?.nombre || "—"],
      ["Periodo", `${formatDate(vigencia?.fecha_inicio)} – ${formatDate(vigencia?.fecha_fin)}`, "Actividades", String(items.length)]
    ].map((row) => row.map((cell, index) => ({ text: String(cell), bold: index % 2 === 0, color: index % 2 === 0 ? "#0F4230" : "#26312C", fontSize: 7.5, margin: [4,3,4,3] }))) }, layout: { hLineColor:()=>"#DCE5E0", vLineColor:()=>"#DCE5E0" }, margin:[0,0,0,12] },
    { text: "Matriz completa", bold: true, color: "#0F4230", fontSize: 10, margin: [0,0,0,6] }
  ];
  const headers = ["Línea","Programa","Proyecto / unidad","Actividad","Responsable","Inicio","Fin","Estado","Avance"];
  const body = [headers.map((text) => ({ text, bold:true, color:"#fff", fillColor:"#0F4230", fontSize:6.2, margin:[2,3,2,3] }))];
  rows.forEach((row) => body.push([
    row.linea, row.programa, `${row.tipo}\n${row.unidad}`, `${row.codigo} · ${row.actividad}`, row.responsable,
    formatDate(row.inicio), formatDate(row.fin), row.estado, formatPercent(row.avance)
  ].map((text, idx) => ({ text:String(text ?? "—"), fontSize: idx === 3 ? 6.1 : 5.8, bold: idx === 8, color: idx === 8 ? "#0F4230" : "#26312C", margin:[2,3,2,3] }))));
  content.push({ table: { headerRows:1, widths:[58,58,72,"*",63,42,42,48,38], body }, layout: { hLineColor:()=>"#DDE5E1", vLineColor:()=>"#DDE5E1", fillColor:(row)=>row>0&&row%2===0?"#F7F9F8":null } });

  if (range && periods.length) {
    const chunkSize = 8;
    for (let offset = 0; offset < periods.length; offset += chunkSize) {
      const chunk = periods.slice(offset, offset + chunkSize);
      content.push({ text: "", pageBreak: "before" });
      content.push({ text: `Cronograma trimestral · periodos ${offset + 1}–${offset + chunk.length}`, bold:true, color:"#0F4230", fontSize:10, margin:[0,0,0,6] });
      const timelineBody = [[
        { text:"Actividad", bold:true, color:"#fff", fillColor:"#0F4230", fontSize:6.4, margin:[2,3,2,3] },
        ...chunk.map((period) => ({ text:`${period.label}\n${period.calendarLabel}`, bold:true, color:"#0F4230", fillColor:periodContainsToday(period)?"#FDECEF":"#EEF4F1", fontSize:5.5, alignment:"center", margin:[1,3,1,3] }))
      ]];
      items.forEach((item) => {
        timelineBody.push([
          { text:`${item.codigo || item.proyecto_codigo || ""} · ${item.nombre}\n${item.linea_corto || item.linea_nombre} › ${item.programa_corto || item.programa_nombre}`, fontSize:5.7, margin:[2,3,2,3] },
          ...chunk.map((period) => {
            const active = periodIntersectsItem(item, period);
            return { text: active ? (item.progress === null ? "•" : `${Math.round(item.progress)}%`) : "", alignment:"center", fontSize:5.4, bold:active, color:active?"#0F4230":"#66716B", fillColor:active?"#EEF4F1":null, margin:[1,4,1,4] };
          })
        ]);
      });
      content.push({ table:{ headerRows:1, widths:[150,...chunk.map(()=>"*")], body:timelineBody }, layout:{ hLineColor:()=>"#DDE5E1", vLineColor:()=>"#DDE5E1" } });
    }
  }
  const filename = `${safeFilename(consejeria)}_Planeador_Completo.pdf`;
  window.pdfMake.createPdf({
    pageSize:"A4", pageOrientation:"landscape", pageMargins:[24,28,24,26], content,
    defaultStyle:{ font:"Roboto", fontSize:7, color:"#26312C" },
    footer:(current,total)=>({ text:`ONIC Buen Gobierno · ${current} / ${total}`, alignment:"right", color:"#7A8580", fontSize:6, margin:[0,0,24,0] })
  }).download(filename);
  return filename;
}

function excelARGB(hex) {
  return `FF${String(hex || "#4f7f67").replace("#","").toUpperCase()}`;
}

function excelFill(hex) {
  return { type:"pattern", pattern:"solid", fgColor:{ argb:excelARGB(hex) } };
}

function excelBorder() {
  const side = { style:"thin", color:{ argb:"FFDCE5E0" } };
  return { top:side,left:side,bottom:side,right:side };
}

async function saveWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportExcel({ items, vigencia, consejeria }) {
  if (!window.ExcelJS?.Workbook) throw new Error("El generador Excel no está disponible.");
  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = "ONIC Buen Gobierno";
  workbook.company = "Organización Nacional Indígena de Colombia - ONIC";
  const rows = exportRows(items);

  const matrix = workbook.addWorksheet("Matriz completa", { views:[{ state:"frozen", ySplit:5 }] });
  matrix.mergeCells(1,1,1,12);
  matrix.getCell("A1").value = "ORGANIZACIÓN NACIONAL INDÍGENA DE COLOMBIA - ONIC";
  matrix.getCell("A1").font = { bold:true, color:{ argb:"FF0F4230" }, size:11 };
  matrix.mergeCells(2,1,2,12);
  matrix.getCell("A2").value = `PLANEADOR COMPLETO · ${consejeria}`;
  matrix.getCell("A2").font = { bold:true, color:{ argb:"FF1C2B24" }, size:15 };
  matrix.getRow(3).values = ["Vigencia", vigencia?.nombre || "—", "Periodo", `${formatDate(vigencia?.fecha_inicio)} – ${formatDate(vigencia?.fecha_fin)}`, "Actividades", items.length];
  [1,3,5].forEach((col)=> matrix.getRow(3).getCell(col).font={ bold:true, color:{ argb:"FF0F4230" } });
  const headers = ["Línea","Programa","Tipo","Proyecto / unidad","Código","Actividad","Responsable","Inicio","Fin","Estado","Avance técnico","Indicadores"];
  matrix.getRow(5).values = headers;
  matrix.getRow(5).eachCell((cell)=>{ cell.font={ bold:true,color:{ argb:"FFFFFFFF" } }; cell.fill=excelFill("#0F4230"); cell.alignment={ vertical:"middle",horizontal:"center",wrapText:true }; cell.border=excelBorder(); });
  rows.forEach((row,index)=>{
    const excelRow=matrix.getRow(6+index);
    excelRow.values=[row.linea,row.programa,row.tipo,row.unidad,row.codigo,row.actividad,row.responsable,row.inicio?parseDate(row.inicio):null,row.fin?parseDate(row.fin):null,row.estado,row.avance===null?null:Number(row.avance)/100,row.indicadores];
    excelRow.getCell(5).fill=excelFill(row.color); excelRow.getCell(5).font={ bold:true,color:{ argb:"FFFFFFFF" } };
    excelRow.getCell(8).numFmt="dd/mm/yyyy"; excelRow.getCell(9).numFmt="dd/mm/yyyy"; excelRow.getCell(11).numFmt="0.0%";
    excelRow.eachCell((cell)=>{ cell.border=excelBorder(); cell.alignment={ vertical:"top",wrapText:true }; });
  });
  [30,30,18,34,14,42,26,13,13,16,16,12].forEach((width,index)=>{ matrix.getColumn(index+1).width=width; });
  matrix.autoFilter={ from:{ row:5,column:1 }, to:{ row:5+rows.length,column:headers.length } };
  matrix.pageSetup={ orientation:"landscape", fitToPage:true, fitToWidth:1, fitToHeight:0, margins:{ left:.25,right:.25,top:.5,bottom:.5,header:.2,footer:.2 } };

  const range = deriveRange(vigencia, items);
  if (range) {
    const periods = makePeriods(range, "trimestral");
    const timeline = workbook.addWorksheet("Cronograma trimestral", { views:[{ state:"frozen", xSplit:6, ySplit:5 }] });
    const totalCols = 6 + periods.length;
    timeline.mergeCells(1,1,1,totalCols);
    timeline.getCell("A1").value = `PLANEADOR COMPLETO · ${consejeria}`;
    timeline.getCell("A1").font={ bold:true,color:{ argb:"FF0F4230" },size:15 };
    timeline.mergeCells(2,1,2,totalCols);
    timeline.getCell("A2").value = `${vigencia?.nombre || "—"} · Cronograma trimestral`;
    timeline.getCell("A2").font={ color:{ argb:"FF66716B" },size:10 };
    const base=["Línea","Programa","Proyecto / unidad","Actividad","Responsable","Avance"];
    timeline.getRow(5).values=[...base,...periods.map((period)=>`${period.label}\n${period.calendarLabel}`)];
    timeline.getRow(5).eachCell((cell,col)=>{ cell.font={ bold:true,color:{ argb: col<=base.length ? "FFFFFFFF" : "FF0F4230" } }; cell.fill=excelFill(col<=base.length?"#0F4230":(periodContainsToday(periods[col-base.length-1])?"#F2C6CD":"#EEF4F1")); cell.alignment={ vertical:"middle",horizontal:"center",wrapText:true }; cell.border=excelBorder(); });
    items.forEach((item,index)=>{
      const row=timeline.getRow(6+index);
      row.values=[item.linea_nombre,item.programa_nombre,item.proyecto_nombre,item.nombre,item.responsable||"—",item.progress===null?null:Number(item.progress)/100];
      row.getCell(6).numFmt="0.0%";
      periods.forEach((period,pIndex)=>{
        const cell=row.getCell(base.length+1+pIndex);
        if(periodIntersectsItem(item,period)){ cell.value=item.progress===null?"•":`${Math.round(item.progress)}%`; cell.fill=excelFill(`${item.color.hex}`); cell.font={ bold:true,color:{ argb:"FFFFFFFF" } }; cell.alignment={ horizontal:"center",vertical:"middle" }; }
        cell.border=excelBorder();
      });
      for(let col=1;col<=base.length;col+=1){ row.getCell(col).border=excelBorder(); row.getCell(col).alignment={ vertical:"top",wrapText:true }; }
    });
    [28,28,34,40,24,12].forEach((width,index)=>timeline.getColumn(index+1).width=width);
    periods.forEach((_period,index)=>timeline.getColumn(base.length+1+index).width=12);
    timeline.pageSetup={ orientation:"landscape", fitToPage:true, fitToWidth:1, fitToHeight:0, margins:{ left:.2,right:.2,top:.5,bottom:.5,header:.2,footer:.2 } };
  }
  const filename=`${safeFilename(consejeria)}_Planeador_Completo.xlsx`;
  await saveWorkbook(workbook,filename);
  return filename;
}

async function exportTimelinePdfStructured({ items, vigencia, consejeria, scale = "trimestral" }) {
  if (!window.pdfMake?.createPdf) throw new Error("El generador PDF no está disponible.");
  if (!items.length) throw new Error("No hay actividades visibles para exportar.");
  const range = deriveRange(vigencia, items);
  if (!range) throw new Error("No hay fechas suficientes para exportar el cronograma.");
  const periods = makePeriods(range, scale);
  const logo = await logoDataUrl();
  const scaleLabel = scale === "mensual" ? "Mensual" : "Trimestral";
  const content = [
    { columns: [
      ...(logo ? [{ image: logo, width: 30, margin: [0,0,10,0] }] : []),
      { stack: [
        { text: "ORGANIZACIÓN NACIONAL INDÍGENA DE COLOMBIA - ONIC", bold: true, color: "#0F4230", fontSize: 9 },
        { text: "Cronograma de la Consejería · vista actual", bold: true, color: "#1C2B24", fontSize: 15, margin: [0,3,0,0] }
      ] }
    ], margin: [0,0,0,12] },
    { table: { widths: [72,"*",72,"*",72,"*"], body: [
      ["Consejería", consejeria, "Vigencia", vigencia?.nombre || "—", "Escala", scaleLabel],
      ["Periodo", `${formatDate(vigencia?.fecha_inicio)} – ${formatDate(vigencia?.fecha_fin)}`, "Actividades visibles", String(items.length), "Alcance", "Filtros actuales"]
    ].map((row) => row.map((cell, index) => ({ text: String(cell), bold: index % 2 === 0, color: index % 2 === 0 ? "#0F4230" : "#26312C", fontSize: 7.2, margin: [4,3,4,3] }))) }, layout: { hLineColor:()=>"#DCE5E0", vLineColor:()=>"#DCE5E0" }, margin:[0,0,0,12] }
  ];
  const chunkSize = scale === "mensual" ? 12 : 8;
  for (let offset = 0; offset < periods.length; offset += chunkSize) {
    const chunk = periods.slice(offset, offset + chunkSize);
    if (offset) content.push({ text: "", pageBreak: "before" });
    content.push({ text: `Cronograma ${scaleLabel.toLowerCase()} · periodos ${offset + 1}–${offset + chunk.length}`, bold:true, color:"#0F4230", fontSize:10, margin:[0,0,0,6] });
    const body = [[
      { text:"Actividad / estructura", bold:true, color:"#fff", fillColor:"#0F4230", fontSize:6.4, margin:[2,3,2,3] },
      ...chunk.map((period) => ({ text:`${period.label}
${period.calendarLabel}`, bold:true, color:"#0F4230", fillColor:periodContainsToday(period)?"#FDECEF":"#EEF4F1", fontSize:5.5, alignment:"center", margin:[1,3,1,3] }))
    ]];
    items.forEach((item) => {
      body.push([
        { text:`${item.codigo || item.proyecto_codigo || ""} · ${item.nombre}
${item.linea_corto || item.linea_nombre} › ${item.programa_corto || item.programa_nombre}`, fontSize:5.7, margin:[2,3,2,3] },
        ...chunk.map((period) => {
          const active = periodIntersectsItem(item, period);
          return { text: active ? (item.progress === null ? "•" : `${Math.round(item.progress)}%`) : "", alignment:"center", fontSize:5.4, bold:active, color:active?"#0F4230":"#66716B", fillColor:active?"#EEF4F1":null, margin:[1,4,1,4] };
        })
      ]);
    });
    content.push({ table:{ headerRows:1, widths:[165,...chunk.map(()=>"*")], body }, layout:{ hLineColor:()=>"#DDE5E1", vLineColor:()=>"#DDE5E1" } });
  }
  const filename = `${safeFilename(consejeria)}_Cronograma_Vista_${scaleLabel}.pdf`;
  window.pdfMake.createPdf({
    pageSize:"A4", pageOrientation:"landscape", pageMargins:[24,28,24,26], content,
    defaultStyle:{ font:"Roboto", fontSize:7, color:"#26312C" },
    footer:(current,total)=>({ text:`ONIC Buen Gobierno · ${current} / ${total}`, alignment:"right", color:"#7A8580", fontSize:6, margin:[0,0,24,0] })
  }).download(filename);
  return filename;
}


function captureCloneForTimeline(element, rowNodes) {
  const sourceWidth = Math.max(
    Math.ceil(element.getBoundingClientRect().width || 0),
    element.scrollWidth || 0,
    720
  );
  const clone = element.cloneNode(true);
  clone.classList.add("cp-export-capture");
  clone.style.width = `${sourceWidth}px`;
  clone.style.minWidth = `${sourceWidth}px`;
  clone.style.maxWidth = "none";
  clone.style.margin = "0";
  clone.style.transform = "none";
  const clonedRows = [...clone.querySelectorAll(".cp-timeline-row")];
  clonedRows.forEach((row, index) => {
    if (!rowNodes.includes(index)) row.remove();
  });
  const head = clone.querySelector(".cp-timeline-head");
  if (head) {
    head.style.position = "relative";
    head.style.top = "auto";
  }
  clone.querySelectorAll("button").forEach((button) => {
    button.style.pointerEvents = "none";
  });
  return { clone, sourceWidth };
}

async function timelinePageImages(element, { targetWidth = 1130, targetHeight = 670 } = {}) {
  if (!element) throw new Error("No se encontró el cronograma visible para exportar.");
  if (typeof window.html2canvas !== "function") throw new Error("El capturador visual del cronograma no está disponible.");

  const rows = [...element.querySelectorAll(".cp-timeline-row")];
  if (!rows.length) throw new Error("No hay actividades visibles para exportar.");

  const sourceWidth = Math.max(
    Math.ceil(element.getBoundingClientRect().width || 0),
    element.scrollWidth || 0,
    720
  );
  const pxPerTargetPoint = sourceWidth / Math.max(1, targetWidth);
  const maxCaptureHeight = Math.max(300, Math.floor(targetHeight * pxPerTargetPoint));
  const headHeight = Math.ceil(element.querySelector(".cp-timeline-head")?.getBoundingClientRect().height || 54);
  const rowHeights = rows.map((row) => Math.ceil(row.getBoundingClientRect().height || 68));

  const chunks = [];
  let current = [];
  let used = headHeight;
  rowHeights.forEach((height, index) => {
    if (current.length && used + height > maxCaptureHeight) {
      chunks.push(current);
      current = [];
      used = headHeight;
    }
    current.push(index);
    used += height;
  });
  if (current.length) chunks.push(current);

  const stage = document.createElement("div");
  stage.className = "cp-export-stage";
  Object.assign(stage.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${sourceWidth}px`,
    zIndex: "-1",
    background: "#ffffff",
    pointerEvents: "none"
  });
  document.body.appendChild(stage);

  const images = [];
  try {
    for (const indexes of chunks) {
      stage.innerHTML = "";
      const { clone } = captureCloneForTimeline(element, indexes);
      stage.appendChild(clone);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await window.html2canvas(clone, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        width: sourceWidth,
        height: Math.ceil(clone.scrollHeight),
        windowWidth: sourceWidth,
        scrollX: 0,
        scrollY: 0
      });
      images.push({
        dataUrl: canvas.toDataURL("image/png", 1),
        width: canvas.width,
        height: canvas.height
      });
    }
  } finally {
    stage.remove();
  }
  return images;
}

function timelineFilterSummary(filters = {}, items = []) {
  const parts = [];
  const line = filters.linea ? items.find((item) => item.linea_id === filters.linea)?.linea_nombre : "";
  const program = filters.programa ? items.find((item) => item.programa_id === filters.programa)?.programa_nombre : "";
  if (filters.search) parts.push(`Búsqueda: “${filters.search}”`);
  if (filters.linea) parts.push(`Línea: ${line || "seleccionada"}`);
  if (filters.programa) parts.push(`Programa: ${program || "seleccionado"}`);
  if (filters.estado) parts.push(`Estado: ${filters.estado}`);
  if (filters.responsable) parts.push(`Responsable: ${filters.responsable}`);
  return parts.length ? parts.join(" · ") : "Sin filtros · vista completa";
}

function generatedAtLabel() {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date()).replace(".", "");
}

async function exportTimelineVisualPdf({ element, consejeria, vigencia, items = [], scale = "trimestral", filters = {} }) {
  if (!window.pdfMake?.createPdf) throw new Error("El generador PDF no está disponible.");

  const pageWidth = 1190.55;
  const pageHeight = 841.89;
  const margins = { left: 30, top: 24, right: 30, bottom: 30 };
  const usableWidth = pageWidth - margins.left - margins.right;
  const headerReserve = 104;
  const footerReserve = 12;
  const timelineHeight = pageHeight - margins.top - margins.bottom - headerReserve - footerReserve;
  const images = await timelinePageImages(element, { targetWidth: usableWidth, targetHeight: timelineHeight });
  if (!images.length) throw new Error("No fue posible capturar el cronograma visible.");

  const logo = await logoDataUrl();
  const scaleLabel = scale === "mensual" ? "Mensual" : "Trimestral";
  const periodLabel = `${formatDate(vigencia?.fecha_inicio)} – ${formatDate(vigencia?.fecha_fin)}`;
  const filtersLabel = timelineFilterSummary(filters, items);
  const generatedLabel = generatedAtLabel();

  const pageBlock = (image, index) => ({
    ...(index ? { pageBreak: "before" } : {}),
    stack: [
      {
        columns: [
          {
            width: "*",
            columns: [
              ...(logo ? [{ image: logo, width: 34, margin: [0, 0, 11, 0] }] : []),
              {
                width: "*",
                stack: [
                  { text: "ORGANIZACIÓN NACIONAL INDÍGENA DE COLOMBIA - ONIC", bold: true, color: "#0F4230", fontSize: 9 },
                  { text: "PLANEADOR DE CONSEJERÍA · CRONOGRAMA", bold: true, color: "#1C2B24", fontSize: 16, margin: [0, 3, 0, 1] },
                  { text: consejeria || "Consejería", color: "#0F4230", bold: true, fontSize: 10 }
                ]
              }
            ]
          },
          {
            width: 190,
            stack: [
              { text: "VISTA CRONOGRAMA", alignment: "right", bold: true, color: "#B11F2D", fontSize: 8 },
              { text: `Escala ${scaleLabel}`, alignment: "right", color: "#26312C", fontSize: 8, margin: [0, 3, 0, 0] },
              { text: `Generado: ${generatedLabel}`, alignment: "right", color: "#6D7772", fontSize: 7, margin: [0, 2, 0, 0] }
            ]
          }
        ],
        margin: [0, 0, 0, 7]
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: usableWidth, y2: 0, lineWidth: 0.7, lineColor: "#CBD7D1" }], margin: [0, 0, 0, 7] },
      {
        table: {
          widths: [52, "*", 48, "*", 45, 72],
          body: [
            [
              { text: "Vigencia", bold: true, color: "#0F4230" }, { text: vigencia?.nombre || "—" },
              { text: "Periodo", bold: true, color: "#0F4230" }, { text: periodLabel },
              { text: "Actividades", bold: true, color: "#0F4230" }, { text: String(items.length), alignment: "center" }
            ],
            [
              { text: "Filtros", bold: true, color: "#0F4230" }, { text: filtersLabel, colSpan: 5 }, { text: "" }, { text: "" }, { text: "" }, { text: "" }
            ]
          ].map((row) => row.map((cell) => typeof cell === "object" ? { fontSize: 7, margin: [3, 2, 3, 2], color: "#26312C", ...cell } : cell))
        },
        layout: {
          hLineColor: () => "#DDE5E1",
          vLineColor: () => "#DDE5E1",
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 1, paddingBottom: () => 1
        },
        margin: [0, 0, 0, 8]
      },
      { image: image.dataUrl, width: usableWidth, margin: [0, 0, 0, 0] }
    ]
  });

  const content = images.map(pageBlock);
  const filename = `${safeFilename(consejeria)}_Cronograma_Vista_${scaleLabel}.pdf`;
  window.pdfMake.createPdf({
    pageSize: "A3",
    pageOrientation: "landscape",
    pageMargins: [margins.left, margins.top, margins.right, margins.bottom],
    content,
    defaultStyle: { font: "Roboto", color: "#26312C" },
    footer: (current, total) => ({
      columns: [
        { text: "ONIC Buen Gobierno · Planeador de Consejería", color: "#7A8580", fontSize: 6.5 },
        { text: `Página ${current} de ${total}`, alignment: "right", color: "#7A8580", fontSize: 6.5 }
      ],
      margin: [margins.left, 0, margins.right, 0]
    })
  }).download(filename);
  return filename;
}

async function exportTimelineExcel({ items, vigencia, consejeria, scale = "trimestral" }) {
  if (!window.ExcelJS?.Workbook) throw new Error("El generador Excel no está disponible.");
  if (!items.length) throw new Error("No hay actividades visibles para exportar.");
  const range = deriveRange(vigencia, items);
  if (!range) throw new Error("No hay fechas suficientes para exportar el cronograma.");
  const periods = makePeriods(range, scale);
  const scaleLabel = scale === "mensual" ? "Mensual" : "Trimestral";
  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = "ONIC Buen Gobierno";
  workbook.company = "Organización Nacional Indígena de Colombia - ONIC";
  const sheetName = scale === "mensual" ? "Cronograma mensual" : "Cronograma trimestral";
  const timeline = workbook.addWorksheet(sheetName, { views:[{ state:"frozen", xSplit:6, ySplit:5 }] });
  const totalCols = 6 + periods.length;
  timeline.mergeCells(1,1,1,totalCols);
  timeline.getCell("A1").value = `CRONOGRAMA · ${consejeria}`;
  timeline.getCell("A1").font={ bold:true,color:{ argb:"FF0F4230" },size:15 };
  timeline.mergeCells(2,1,2,totalCols);
  timeline.getCell("A2").value = `${vigencia?.nombre || "—"} · Vista actual · Escala ${scaleLabel}`;
  timeline.getCell("A2").font={ color:{ argb:"FF66716B" },size:10 };
  timeline.getRow(3).values=["Actividades visibles",items.length,"Periodo",`${formatDate(vigencia?.fecha_inicio)} – ${formatDate(vigencia?.fecha_fin)}`];
  [1,3].forEach((col)=>timeline.getRow(3).getCell(col).font={ bold:true,color:{ argb:"FF0F4230" } });
  const base=["Línea","Programa","Proyecto / unidad","Actividad","Responsable","Avance"];
  timeline.getRow(5).values=[...base,...periods.map((period)=>`${period.label}
${period.calendarLabel}`)];
  timeline.getRow(5).eachCell((cell,col)=>{ cell.font={ bold:true,color:{ argb: col<=base.length ? "FFFFFFFF" : "FF0F4230" } }; cell.fill=excelFill(col<=base.length?"#0F4230":(periodContainsToday(periods[col-base.length-1])?"#F2C6CD":"#EEF4F1")); cell.alignment={ vertical:"middle",horizontal:"center",wrapText:true }; cell.border=excelBorder(); });
  items.forEach((item,index)=>{
    const row=timeline.getRow(6+index);
    row.values=[item.linea_nombre,item.programa_nombre,item.proyecto_nombre,item.nombre,item.responsable||"—",item.progress===null?null:Number(item.progress)/100];
    row.getCell(6).numFmt="0.0%";
    periods.forEach((period,pIndex)=>{
      const cell=row.getCell(base.length+1+pIndex);
      if(periodIntersectsItem(item,period)){ cell.value=item.progress===null?"•":`${Math.round(item.progress)}%`; cell.fill=excelFill(`${item.color.hex}`); cell.font={ bold:true,color:{ argb:"FFFFFFFF" } }; cell.alignment={ horizontal:"center",vertical:"middle" }; }
      cell.border=excelBorder();
    });
    for(let col=1;col<=base.length;col+=1){ row.getCell(col).border=excelBorder(); row.getCell(col).alignment={ vertical:"top",wrapText:true }; }
  });
  [28,28,34,40,24,12].forEach((width,index)=>timeline.getColumn(index+1).width=width);
  periods.forEach((_period,index)=>timeline.getColumn(base.length+1+index).width=scale === "mensual" ? 9 : 12);
  timeline.autoFilter={ from:{ row:5,column:1 }, to:{ row:5+items.length,column:base.length+periods.length } };
  timeline.pageSetup={ orientation:"landscape", fitToPage:true, fitToWidth:1, fitToHeight:0, margins:{ left:.2,right:.2,top:.5,bottom:.5,header:.2,footer:.2 } };
  const filename=`${safeFilename(consejeria)}_Cronograma_Vista_${scaleLabel}.xlsx`;
  await saveWorkbook(workbook,filename);
  return filename;
}

export async function exportConsejeriaPlanner({ format, items, vigencia, consejeria, scope = "completo", scale = "trimestral", timelineElement = null, filters = {} }) {
  const type=String(format||"").toLowerCase();
  if (scope === "cronograma") {
    if(type==="pdf") {
      if (timelineElement && typeof window.html2canvas === "function") return exportTimelineVisualPdf({ element: timelineElement, consejeria, vigencia, items, scale, filters });
      return exportTimelinePdfStructured({ items,vigencia,consejeria,scale });
    }
    if(type==="excel"||type==="xlsx") return exportTimelineExcel({ items,vigencia,consejeria,scale });
  } else {
    if(type==="pdf") return exportPdf({ items,vigencia,consejeria });
    if(type==="excel"||type==="xlsx") return exportExcel({ items,vigencia,consejeria });
  }
  throw new Error("Selecciona un formato de exportación válido.");
}

export function renderConsejeriaPlanner({
  container,
  items,
  vigencia,
  consejeria,
  view = "matriz",
  scale = "trimestral",
  zoom = 100,
  fit = false,
  filters = {},
  onViewChange,
  onScaleChange,
  onZoomChange,
  onFiltersChange,
  onOpenItem,
  onExport
}) {
  const currentFilters = {
    search: filters.search || "",
    linea: filters.linea || "",
    programa: filters.programa || "",
    estado: filters.estado || "",
    responsable: filters.responsable || ""
  };
  const visible = filterItems(items, currentFilters);
  container.innerHTML = `
    <section class="workspace-section workspace-section-flush consejeria-planner-section">
      <div class="workspace-section-heading cp-heading">
        <div>
          <p class="eyebrow">Planeación consolidada</p>
          <h3>Planeador de la Consejería</h3>
          <p class="muted">Integra las Actividades generales y las actividades internas de todos los Proyectos de esta Consejería. Haz clic en cualquier actividad para abrir su registro original.</p>
        </div>
        <div class="cp-export-actions">
          <button class="btn btn-secondary" type="button" data-cp-export="pdf">PDF completo</button>
          <button class="btn btn-secondary" type="button" data-cp-export="excel">Excel completo</button>
        </div>
      </div>
      ${summaryHTML(items, visible)}
      <div class="cp-toolbar">
        <div class="planner-view-switch" role="group" aria-label="Vista del Planeador de la Consejería">
          <button class="${view === "matriz" ? "active" : ""}" type="button" data-cp-view="matriz">Vista matriz</button>
          <button class="${view === "cronograma" ? "active" : ""}" type="button" data-cp-view="cronograma">Vista cronograma</button>
        </div>
        <div class="planner-scale-switch ${view === "cronograma" ? "" : "hidden"}" role="group" aria-label="Escala del cronograma">
          <button class="${scale === "mensual" ? "active" : ""}" type="button" data-cp-scale="mensual">Mensual</button>
          <button class="${scale === "trimestral" ? "active" : ""}" type="button" data-cp-scale="trimestral">Trimestral</button>
        </div>
        <div class="cp-zoom-controls ${view === "cronograma" ? "" : "hidden"}" role="group" aria-label="Zoom del cronograma">
          <button type="button" data-cp-zoom="-10" title="Reducir cronograma" aria-label="Reducir cronograma">−</button>
          <button type="button" data-cp-fit class="${fit ? "active" : ""}">Ajustar</button>
          <button type="button" data-cp-zoom-reset class="${!fit && Number(zoom) === 100 ? "active" : ""}">100%</button>
          <button type="button" data-cp-zoom="10" title="Ampliar cronograma" aria-label="Ampliar cronograma">+</button>
          <span class="cp-zoom-status">${fit ? "Periodo completo" : `${clamp(Number(zoom) || 100,60,180)}%`}</span>
        </div>
        <div class="cp-view-export-actions ${view === "cronograma" ? "" : "hidden"}">
          <button class="btn btn-secondary" type="button" data-cp-view-export="pdf">PDF vista</button>
          <button class="btn btn-secondary" type="button" data-cp-view-export="excel">Excel vista</button>
        </div>
        <span class="cp-visible-count">${visible.length} de ${items.length} actividades</span>
      </div>
      ${filtersHTML(items, currentFilters)}
      <div id="consejeriaPlannerContent">
        ${view === "cronograma" ? timelineHTML(visible, vigencia, scale, { zoom, fit }) : matrixHTML(visible)}
      </div>
    </section>`;

  container.querySelectorAll("[data-cp-view]").forEach((button)=>button.addEventListener("click",()=>onViewChange?.(button.dataset.cpView)));
  container.querySelectorAll("[data-cp-scale]").forEach((button)=>button.addEventListener("click",()=>onScaleChange?.(button.dataset.cpScale)));
  container.querySelectorAll("[data-cp-zoom]").forEach((button)=>button.addEventListener("click",()=>{
    const delta = Number(button.dataset.cpZoom) || 0;
    onZoomChange?.({ zoom: clamp((Number(zoom) || 100) + delta, 60, 180), fit: false });
  }));
  container.querySelector("[data-cp-fit]")?.addEventListener("click",()=>onZoomChange?.({ zoom: Number(zoom) || 100, fit: true }));
  container.querySelector("[data-cp-zoom-reset]")?.addEventListener("click",()=>onZoomChange?.({ zoom: 100, fit: false }));
  const emitFilters=()=>{
    const next={};
    container.querySelectorAll("[data-cp-filter]").forEach((input)=>{ next[input.dataset.cpFilter]=input.value; });
    onFiltersChange?.(next);
  };
  container.querySelectorAll("select[data-cp-filter]").forEach((input)=>input.addEventListener("change",emitFilters));
  let searchTimer=null;
  container.querySelector('input[data-cp-filter="search"]')?.addEventListener("input",()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(emitFilters,220);
  });
  container.querySelector(".cp-clear-filters")?.addEventListener("click",()=>onFiltersChange?.({ search:"",linea:"",programa:"",estado:"",responsable:"" }));
  container.querySelectorAll("[data-cp-open]").forEach((button)=>button.addEventListener("click",()=>{
    const item=items.find((row)=>row.id===button.dataset.cpOpen);
    if(item) onOpenItem?.(item);
  }));
  const exportButtons=[...container.querySelectorAll("[data-cp-export], [data-cp-view-export]")];
  exportButtons.forEach((button)=>button.addEventListener("click",async()=>{
    const original=button.textContent;
    exportButtons.forEach((item)=>item.disabled=true);
    button.textContent="Generando…";
    try {
      const isViewExport = Boolean(button.dataset.cpViewExport);
      const format = button.dataset.cpExport || button.dataset.cpViewExport;
      await onExport?.(format, {
        scope: isViewExport ? "cronograma" : "completo",
        items: isViewExport ? visible : items,
        scale,
        filters: currentFilters,
        timelineElement: isViewExport && format === "pdf" ? container.querySelector(".cp-timeline") : null
      });
    } finally {
      exportButtons.forEach((item)=>item.disabled=false);
      button.textContent=original;
    }
  }));
}
