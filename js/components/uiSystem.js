/*
 * Sistema de interfaz V5.3
 * Unifica iconografía, acciones, accesibilidad, contexto de navegación,
 * protección de cambios sin guardar y ayuda contextual sin alterar
 * la lógica de negocio de los módulos.
 */

const ICON_PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"></path><path d="M5.5 10.5V20h13v-9.5"></path><path d="M9.5 20v-6h5v6"></path>',
  work: '<path d="M9 11l2 2 4-4"></path><path d="M5 4h14v16H5z"></path><path d="M8 4V2h8v2"></path>',
  calendar: '<path d="M5 3v3M19 3v3"></path><path d="M4 7h16v13H4z"></path><path d="M4 10h16"></path>',
  mandate: '<path d="M7 3h10l3 3v15H4V3z"></path><path d="M8 8h8M8 12h8M8 16h5"></path>',
  trend: '<path d="M4 17l5-5 4 4 7-8"></path><path d="M15 8h5v5"></path>',
  users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 17 9 5 9-5"></path>',
  programs: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 8h10M7 12h10M7 16h6"></path>',
  projects: '<path d="M4 5h6l2 2h8v12H4z"></path><path d="M8 11h8M8 15h5"></path>',
  percent: '<path d="M19 5 5 19"></path><circle cx="7" cy="7" r="2"></circle><circle cx="17" cy="17" r="2"></circle>',
  cut: '<circle cx="12" cy="12" r="9"></circle><path d="M12 3v9l6 3"></path>',
  alert: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>',
  quality: '<path d="m12 3 7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z"></path><path d="m9 12 2 2 4-4"></path>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path><path d="M12 7v5l3 2"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
  message: '<path d="M5 4h14v13H9l-4 4z"></path><path d="M9 8h6M9 12h4"></path>',
  logout: '<path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path><path d="M14 4h6v16h-6"></path>',
  login: '<path d="m14 7 5 5-5 5"></path><path d="M19 12H7"></path><path d="M10 4H4v16h6"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  save: '<path d="M5 3h12l2 2v16H5z"></path><path d="M8 3v6h8V3M8 21v-7h8v7"></path>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4z"></path><path d="m13 7 4 4"></path>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  back: '<path d="m15 18-6-6 6-6"></path>',
  forward: '<path d="m9 18 6-6-6-6"></path>',
  refresh: '<path d="M20 6v5h-5"></path><path d="M4 18v-5h5"></path><path d="M18 9a7 7 0 0 0-12-3L4 8M6 15a7 7 0 0 0 12 3l2-2"></path>',
  archive: '<path d="M4 7h16v13H4z"></path><path d="M3 4h18v3H3zM9 11h6"></path>',
  check: '<path d="m5 12 4 4L19 6"></path>',
  download: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
  upload: '<path d="M12 16V4"></path><path d="m7 9 5-5 5 5"></path><path d="M5 20h14"></path>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path>',
  external: '<path d="M14 4h6v6"></path><path d="M20 4 11 13"></path><path d="M19 13v7H4V5h7"></path>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>',
  file: '<path d="M6 2h8l4 4v16H6z"></path><path d="M14 2v5h5M9 12h6M9 16h6"></path>',
  play: '<path d="m8 5 11 7-11 7V5z"></path>',
  filter: '<path d="M4 5h16l-6 7v6l-4 2v-8L4 5z"></path>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"></path>',
  chevronDown: '<path d="m7 9 5 5 5-5"></path>',
  info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v6"></path><path d="M12 7h.01"></path>',
  compass: '<circle cx="12" cy="12" r="9"></circle><path d="m15.5 8.5-2 5-5 2 2-5 5-2z"></path>'
};

export function uiIcon(name, className = "ui-icon") {
  const path = ICON_PATHS[name] || ICON_PATHS.forward;
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
}

const LABEL_NORMALIZATIONS = new Map([
  ["abrir proyecto →", "Abrir Proyecto"],
  ["ir a referencia →", "Ir a referencia"],
  ["seguimiento →", "Seguimiento"],
  ["más acciones ▾", "Más acciones"]
]);

const HELP_TERMS = [
  ["ponderación", "Peso relativo que determina cuánto aporta un elemento al resultado del nivel superior."],
  ["cobertura", "Porción de la estructura que ya cuenta con información suficiente para medir avance."],
  ["línea base", "Valor inicial del indicador antes de registrar el avance."],
  ["meta", "Valor que se espera alcanzar con el indicador."],
  ["avance técnico", "Avance calculado a partir de los indicadores de las actividades."],
  ["cumplimiento técnico", "Avance calculado a partir de los indicadores de las actividades."],
  ["contribución", "Aporte ponderado del avance de este elemento al nivel superior."],
  ["corte", "Fotografía del avance en una fecha determinada. Los cortes aprobados conservan el histórico."],
  ["avance asociado", "Promedio del avance de los proyectos vinculados. No equivale por sí solo al cumplimiento político del Mandato."]
];

const CONTEXT_STORAGE_KEY = "onic_ui_context_v53";
const VIEW_STORAGE_KEY = "onic_ui_view_context_v53";

const CONTEXT_SELECTS = new Map([
  ["inicioVigenciaSelector", "vigencia"],
  ["vigenciaSelector", "vigencia"],
  ["mandatosVigenciaSelector", "vigencia"],
  ["lineasVigenciaSelector", "vigencia"],
  ["programasVigenciaSelector", "vigencia"],
  ["projectsVigenciaSelector", "vigencia"],
  ["ponderacionVigenciaSelector", "vigencia"],
  ["trackingVigenciaSelector", "vigencia"],
  ["alertsVigenciaSelector", "vigencia"],
  ["mandateTrackingVigencia", "vigencia"],
  ["qualityVigencia", "vigencia"],
  ["myWorkVigencia", "vigencia"],
  ["historyVigencia", "vigencia"],
  ["lineasConsejeriaSelector", "consejeria"],
  ["programasConsejeriaSelector", "consejeria"],
  ["projectsConsejeriaSelector", "consejeria"],
  ["ponderacionConsejeriaSelector", "consejeria"],
  ["alertsConsejeriaSelector", "consejeria"],
  ["mandateTrackingConsejeria", "consejeria"],
  ["qualityConsejeria", "consejeria"],
  ["historyConsejeria", "consejeria"],
  ["programasLineaSelector", "linea"],
  ["projectsLineaSelector", "linea"],
  ["projectsProgramaSelector", "programa"]
]);

const CONTEXT_KEYS = {
  vigencia: { id: "vigencia_id", label: "vigencia_nombre" },
  consejeria: { id: "vigencia_consejeria_id", label: "consejeria_nombre" },
  linea: { id: "linea_id", label: "linea_nombre" },
  programa: { id: "programa_id", label: "programa_nombre" },
  proyecto: { id: "proyecto_id", label: "proyecto_nombre" }
};

const VIEW_CONTEXT_FIELDS = {
  inicio: ["vigencia"],
  mi_trabajo: ["vigencia"],
  mandatos: ["vigencia"],
  consejerias: ["vigencia"],
  lineas: ["vigencia", "consejeria"],
  programas: ["vigencia", "consejeria", "linea"],
  proyectos: ["vigencia", "consejeria", "linea", "programa"],
  ponderaciones: ["vigencia", "consejeria"],
  seguimiento_mandatos: ["vigencia", "consejeria"],
  cortes: ["vigencia"],
  alertas: ["vigencia", "consejeria"],
  calidad: ["vigencia", "consejeria"]
};

const dirtyForms = new Set();
let interfaceView = { viewName: "inicio", title: "Inicio", root: document, navigationTarget: null };
let observer = null;
let timer = null;
let bypassDirtyGuard = false;
let toastTimer = null;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function actionIcon(text, button) {
  const t = text.toLocaleLowerCase("es");
  if (button.classList.contains("btn-danger") || /eliminar|borrar/.test(t)) return "trash";
  if (/^\+\s*/.test(text) || /^(nuevo|nueva)\b/.test(t) || /^crear\b/.test(t)) return "plus";
  if (/^ingresar$/.test(t)) return "login";
  if (/^salir$/.test(t)) return "logout";
  if (/guardar/.test(t)) return "save";
  if (/editar/.test(t)) return "edit";
  if (/cancelar|^cerrar$|descartar/.test(t)) return "close";
  if (/volver/.test(t)) return "back";
  if (/abrir|ver detalle|ir a referencia|previsualizar/.test(t)) return "eye";
  if (/actualizar|restablecer|reactivar|reabrir/.test(t)) return "refresh";
  if (/archivar|inactivar|retirar/.test(t)) return "archive";
  if (/aprobar|completar|marcar completado|guardar asignación/.test(t)) return "check";
  if (/descargar|\bpdf\b|\bexcel\b|\bcsv\b|\btxt\b/.test(t)) return "download";
  if (/importar|leer archivo/.test(t)) return "upload";
  if (/copiar/.test(t)) return "copy";
  if (/nota/.test(t)) return "message";
  if (/ponderación/.test(t)) return "percent";
  if (/registrar avance|seguimiento|planificar|definir fechas/.test(t)) return "trend";
  if (/^iniciar$/.test(t)) return "play";
  if (/aplicar filtros/.test(t)) return "filter";
  if (/más acciones/.test(t)) return "chevronDown";
  return null;
}

function normalizeSimpleButton(button) {
  if (button.dataset.uiEnhanced === "true") return;
  if (button.classList.contains("nav-item")) return;
  if (button.querySelector("svg")) {
    button.dataset.uiEnhanced = "true";
    return;
  }
  if (button.children.length > 0) return;

  let text = cleanText(button.textContent);
  if (!text) return;

  if (text === "×") {
    button.innerHTML = uiIcon("close");
    button.dataset.uiEnhanced = "true";
    return;
  }

  const mapped = LABEL_NORMALIZATIONS.get(text.toLocaleLowerCase("es"));
  if (mapped) text = mapped;

  const iconName = actionIcon(text, button);
  if (!iconName) return;

  text = text.replace(/^\+\s*/, "").replace(/\s*[→▾]\s*$/, "").trim();
  const icon = uiIcon(iconName);
  button.innerHTML = `${icon}<span class="ui-button-label">${escapeHTML(text)}</span>`;
  button.dataset.uiEnhanced = "true";
}

function improveIconButton(button) {
  if (!(button.classList.contains("icon-button") || button.classList.contains("icon-btn"))) return;
  if (!button.getAttribute("aria-label")) {
    const label = cleanText(button.getAttribute("title") || button.textContent || "Acción");
    button.setAttribute("aria-label", label || "Acción");
  }
}

function refreshNavigationGroups(root) {
  const scope = root?.querySelectorAll ? root : document;
  scope.querySelectorAll(".nav-group").forEach((group) => {
    const items = [...group.querySelectorAll(".nav-item")];
    const hasVisible = items.some((item) => !item.classList.contains("security-hidden") && !item.classList.contains("hidden"));
    group.classList.toggle("nav-group-empty", !hasVisible);
  });
}

const TAB_GROUP_SELECTOR = ".project-workspace-tabs, .consejeria-workspace-tabs, .my-work-tabs, .alerts-tabs";

function refreshTabState(group) {
  const buttons = [...group.querySelectorAll(":scope > button")];
  buttons.forEach((button) => {
    const active = button.classList.contains("active");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function enhanceTabs(root) {
  root.querySelectorAll(TAB_GROUP_SELECTOR).forEach((group) => {
    group.setAttribute("role", "tablist");
    refreshTabState(group);
    if (group.dataset.uiTabsEnhanced === "true") return;
    group.dataset.uiTabsEnhanced = "true";

    group.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...group.querySelectorAll(":scope > button")].filter((button) => !button.disabled);
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement);
      let next = current < 0 ? 0 : current;
      if (event.key === "ArrowRight") next = (next + 1) % buttons.length;
      if (event.key === "ArrowLeft") next = (next - 1 + buttons.length) % buttons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      event.preventDefault();
      buttons[next].focus();
    });

    group.addEventListener("click", () => setTimeout(() => refreshTabState(group), 0));
  });
}

function enhanceLoadingStates(root) {
  root.querySelectorAll(".empty-state").forEach((state) => {
    if (state.dataset.uiLoadingEnhanced === "true" || state.children.length) return;
    const text = cleanText(state.textContent);
    if (!/^(cargando|calculando|preparando|actualizando)/i.test(text)) return;
    state.classList.add("inline-loading-state");
    state.innerHTML = `<span class="loading-spinner" aria-hidden="true"></span><span>${escapeHTML(text)}</span>`;
    state.dataset.uiLoadingEnhanced = "true";
  });
}

function improveForms(root) {
  root.querySelectorAll("input, select, textarea").forEach((field) => {
    if (!field.getAttribute("autocomplete") && field.type === "search") field.setAttribute("autocomplete", "off");
  });
}

function helpTextFor(text) {
  const normalized = cleanText(text).toLocaleLowerCase("es").replace(/[:*]/g, "");
  for (const [term, help] of HELP_TERMS) {
    if (normalized === term || normalized.startsWith(`${term} `)) return help;
  }
  return "";
}

function enhanceContextualHelp(root) {
  root.querySelectorAll("label, .calculation-item > span, .workspace-metric > span, .project-summary-stat > span, .tracking-summary-card > span").forEach((label) => {
    if (label.dataset.uiHelpEnhanced === "true") return;
    const help = helpTextFor(label.textContent);
    if (!help) return;
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "ui-help-dot";
    dot.setAttribute("aria-label", `Ayuda: ${cleanText(label.textContent)}`);
    dot.title = help;
    dot.innerHTML = uiIcon("info", "ui-help-icon");
    dot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showGlobalStatus(help, "info", 5200);
    });
    label.append(" ", dot);
    label.dataset.uiHelpEnhanced = "true";
  });
}

function enhanceEmptyStates(root) {
  root.querySelectorAll(".empty-state").forEach((state) => {
    if (state.dataset.uiEmptyEnhanced === "true") return;
    const text = cleanText(state.textContent);
    if (!text || /^(cargando|calculando|preparando|actualizando)/i.test(text)) return;
    state.classList.add("guided-empty-state");
    if (!state.querySelector(".empty-state-icon")) {
      const icon = document.createElement("span");
      icon.className = "empty-state-icon";
      icon.innerHTML = uiIcon(/alerta|error|no fue posible/i.test(text) ? "alert" : "compass");
      state.prepend(icon);
    }

    const lower = text.toLocaleLowerCase("es");
    let view = null;
    let label = null;
    if (/módulo consejerías|vincula.*consejer/i.test(lower)) { view = "consejerias"; label = "Ir a Consejerías"; }
    else if (/módulo líneas|líneas de acción/.test(lower) && /cré|primero|aún no/.test(lower)) { view = "lineas"; label = "Ir a Líneas de Acción"; }
    else if (/módulo programas|no tiene programas|aún no tiene programas/.test(lower)) { view = "programas"; label = "Ir a Programas"; }
    else if (/módulo proyectos|sin proyectos/.test(lower) && /primero|crear|aún/.test(lower)) { view = "proyectos"; label = "Ir a Proyectos"; }

    if (view && !state.querySelector(".empty-state-action")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-secondary empty-state-action";
      button.textContent = label;
      button.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("app:navigate", { detail: { view } }));
      });
      state.append(button);
    }
    state.dataset.uiEmptyEnhanced = "true";
  });
}

function enhanceTables(root) {
  root.querySelectorAll("table.data-table").forEach((table) => {
    if (table.dataset.uiTableEnhanced === "true") return;
    const headers = [...table.querySelectorAll("thead th")].map((th) => cleanText(th.textContent));
    table.querySelectorAll("tbody tr").forEach((row) => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName === "TD" && headers[index]) cell.dataset.label = headers[index];
      });
    });
    if (headers.length >= 2 && headers.length <= 6) table.classList.add("mobile-card-table");
    table.dataset.uiTableEnhanced = "true";
  });
}

function readStoredContext() {
  try {
    return JSON.parse(sessionStorage.getItem(CONTEXT_STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeStoredContext(context) {
  try { sessionStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(context || {})); } catch {}
}

function readViewContexts() {
  try { return JSON.parse(sessionStorage.getItem(VIEW_STORAGE_KEY) || "{}") || {}; } catch { return {}; }
}

function writeViewContexts(contexts) {
  try { sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(contexts || {})); } catch {}
}

function optionLabel(select) {
  const option = select?.selectedOptions?.[0];
  if (!option) return "";
  return cleanText(option.textContent)
    .replace(/\s*·\s*(activa|activo|inactiva|inactivo|archivada|archivado)$/i, "")
    .replace(/^\d+\.\s*/, "");
}

function clearContextDescendants(context, level) {
  const order = ["vigencia", "consejeria", "linea", "programa", "proyecto"];
  const index = order.indexOf(level);
  if (index < 0) return;
  order.slice(index + 1).forEach((key) => delete context[key]);
}

function rememberSelectContext(select, { explicitClear = false } = {}) {
  const level = CONTEXT_SELECTS.get(select?.id);
  if (!level) return;
  const context = readStoredContext();
  const value = select.value || "";

  if (!value) {
    if (explicitClear) {
      delete context[level];
      clearContextDescendants(context, level);
      writeStoredContext(context);
    }
    return;
  }

  context[level] = { id: value, label: optionLabel(select) || value };
  clearContextDescendants(context, level);
  writeStoredContext(context);
}

function scanContext(root) {
  const scope = root?.querySelectorAll ? root : document;
  scope.querySelectorAll("select[id]").forEach((select) => {
    if (CONTEXT_SELECTS.has(select.id) && select.value) rememberSelectContext(select);
  });
}

export function rememberNavigationTarget(target = null) {
  if (!target || typeof target !== "object") return;
  const context = readStoredContext();
  const order = ["vigencia", "consejeria", "linea", "programa", "proyecto"];
  let deepest = -1;
  Object.entries(CONTEXT_KEYS).forEach(([level, keys]) => {
    const id = target[keys.id];
    if (!id) return;
    const label = target[keys.label] || context[level]?.label || id;
    context[level] = { id, label };
    deepest = Math.max(deepest, order.indexOf(level));
  });
  if (deepest >= 0) {
    order.slice(deepest + 1).forEach((level) => delete context[level]);
  }
  writeStoredContext(context);
}

function targetFromContext(viewName) {
  const context = readStoredContext();
  const allowed = VIEW_CONTEXT_FIELDS[viewName] || [];
  const target = {};
  allowed.forEach((level) => {
    const item = context[level];
    if (!item?.id) return;
    const keys = CONTEXT_KEYS[level];
    target[keys.id] = item.id;
    if (item.label) target[keys.label] = item.label;
  });
  return target;
}

export function getContextualNavigationTarget(viewName, explicitTarget = null) {
  if (explicitTarget && typeof explicitTarget === "object") {
    rememberNavigationTarget(explicitTarget);
    return explicitTarget;
  }

  const viewContexts = readViewContexts();
  const own = viewContexts[viewName] || {};
  const inherited = targetFromContext(viewName);
  const result = { ...own, ...inherited };
  return Object.keys(result).length ? result : null;
}

function persistViewContext(viewName) {
  if (!viewName) return;
  const target = targetFromContext(viewName);
  if (!Object.keys(target).length) return;
  const contexts = readViewContexts();
  contexts[viewName] = target;
  writeViewContexts(contexts);
}

function contextSegmentsForView(viewName) {
  const context = readStoredContext();
  const levels = VIEW_CONTEXT_FIELDS[viewName] || [];
  return levels.map((level) => ({ level, ...(context[level] || {}) })).filter((item) => item.id && item.label);
}

function breadcrumbTargetFor(level, context) {
  const base = {};
  if (context.vigencia?.id) {
    base.vigencia_id = context.vigencia.id;
    base.vigencia_nombre = context.vigencia.label;
  }
  if (["consejeria", "linea", "programa"].includes(level) && context.consejeria?.id) {
    base.vigencia_consejeria_id = context.consejeria.id;
    base.consejeria_nombre = context.consejeria.label;
  }
  if (["linea", "programa"].includes(level) && context.linea?.id) {
    base.linea_id = context.linea.id;
    base.linea_nombre = context.linea.label;
  }
  if (level === "programa" && context.programa?.id) {
    base.programa_id = context.programa.id;
    base.programa_nombre = context.programa.label;
  }
  return base;
}

function breadcrumbViewFor(level) {
  if (level === "vigencia") return "inicio";
  if (level === "consejeria") return "lineas";
  if (level === "linea") return "programas";
  if (level === "programa") return "proyectos";
  return "inicio";
}

function refreshContextBar({ scan = true } = {}) {
  const bar = document.querySelector("#contextBar");
  if (!bar) return;
  const root = interfaceView.root || document;

  if (root.querySelector?.(".project-workspace-breadcrumbs")) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }

  if (scan) scanContext(root);
  const segments = contextSegmentsForView(interfaceView.viewName);
  if (!segments.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }

  const context = readStoredContext();
  bar.innerHTML = `
    <span class="context-bar-label">Contexto</span>
    <nav class="context-breadcrumbs" aria-label="Contexto de trabajo">
      ${segments.map((segment, index) => `
        ${index ? '<span class="context-separator" aria-hidden="true">›</span>' : ""}
        <button type="button" class="context-crumb" data-context-level="${segment.level}" title="Abrir ${escapeHTML(segment.label)}">${escapeHTML(segment.label)}</button>
      `).join("")}
    </nav>
  `;
  bar.classList.remove("hidden");
  bar.querySelectorAll("[data-context-level]").forEach((button) => {
    button.addEventListener("click", () => {
      const level = button.dataset.contextLevel;
      window.dispatchEvent(new CustomEvent("app:navigate", {
        detail: {
          view: breadcrumbViewFor(level),
          target: breadcrumbTargetFor(level, context)
        }
      }));
    });
  });
}

export function setInterfaceView(viewName, title, root = document, navigationTarget = null) {
  interfaceView = { viewName, title, root, navigationTarget };
  rememberNavigationTarget(navigationTarget);
  scanContext(root);
  persistViewContext(viewName);
  refreshContextBar();
}

function isMutationForm(form) {
  if (!form || form.dataset.uiIgnoreDirty === "true") return false;
  if (form.id === "loginForm") return false;
  const submits = [...form.querySelectorAll('button[type="submit"], input[type="submit"]')];
  if (!submits.length) return false;
  return submits.some((button) => /guardar|crear|registrar|aprobar|vincular|actualizar|importar|marcar completado|ingresar datos/i.test(cleanText(button.textContent || button.value)));
}

function markFormDirty(form) {
  if (!isMutationForm(form)) return;
  form.dataset.uiDirty = "true";
  dirtyForms.add(form);
  updateDirtyIndicator();
}

function markFormClean(form) {
  if (!form) return;
  delete form.dataset.uiDirty;
  dirtyForms.delete(form);
  updateDirtyIndicator();
}

function cleanupDirtyForms() {
  [...dirtyForms].forEach((form) => {
    if (!form.isConnected) dirtyForms.delete(form);
  });
  updateDirtyIndicator();
}

export function hasUnsavedChanges() {
  cleanupDirtyForms();
  return [...dirtyForms].some((form) => form.isConnected && form.dataset.uiDirty === "true");
}

export function clearInterfaceDirtyState() {
  [...dirtyForms].forEach(markFormClean);
  dirtyForms.clear();
  updateDirtyIndicator();
}

export function confirmNavigationAway() {
  if (bypassDirtyGuard || !hasUnsavedChanges()) return true;
  const confirmed = window.confirm("Hay cambios sin guardar. Si continúas, esos cambios se perderán. ¿Deseas salir de esta pantalla?");
  if (confirmed) clearInterfaceDirtyState();
  return confirmed;
}

function updateDirtyIndicator() {
  const indicator = document.querySelector("#unsavedChangesIndicator");
  if (!indicator) return;
  const dirty = [...dirtyForms].some((form) => form.isConnected && form.dataset.uiDirty === "true");
  indicator.classList.toggle("hidden", !dirty);
  indicator.setAttribute("aria-hidden", String(!dirty));
}

export function showGlobalStatus(message, type = "success", duration = 3200) {
  const toast = document.querySelector("#globalStatusToast");
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.className = `global-status-toast ${type}`;
  toast.innerHTML = `${uiIcon(type === "success" ? "check" : type === "info" ? "info" : "alert")}<span>${escapeHTML(message)}</span>`;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), duration);
}

function handleFormSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !dirtyForms.has(form)) return;
  form.dataset.uiSavePending = "true";
  setTimeout(() => {
    if (!form.isConnected && form.dataset.uiCancelled !== "true") {
      dirtyForms.delete(form);
      updateDirtyIndicator();
      const hasVisibleModuleToast = [...document.querySelectorAll(".app-toast")]
        .some((toast) => !toast.classList.contains("hidden") && cleanText(toast.textContent));
      if (!hasVisibleModuleToast) showGlobalStatus("Cambios guardados.", "success", 2400);
    }
  }, 650);
}

function handleDocumentChange(event) {
  const target = event.target;
  if (target instanceof HTMLSelectElement && CONTEXT_SELECTS.has(target.id)) {
    rememberSelectContext(target, { explicitClear: true });
    persistViewContext(interfaceView.viewName);
    // No volver a escanear inmediatamente: los selectores dependientes todavía pueden
    // conservar el valor anterior hasta que el módulo procese el cambio.
    refreshContextBar({ scan: false });
  }

  const form = target?.closest?.("form");
  if (form && !target.matches('[type="search"]')) markFormDirty(form);
}

function handlePotentialNavigation(event) {
  if (bypassDirtyGuard || !hasUnsavedChanges()) return;
  const control = event.target?.closest?.(
    ".nav-item, [data-project-tab], [data-activity-tab], .workspace-back-button, #modalClose, .my-work-tabs button, .alerts-tabs button"
  );
  if (!control) return;
  const activeForm = event.target?.closest?.("form");
  if (activeForm && dirtyForms.has(activeForm)) return;
  if (!confirmNavigationAway()) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

function handleCancelClick(event) {
  const button = event.target?.closest?.("button");
  if (!button) return;
  const text = cleanText(button.textContent).toLocaleLowerCase("es");
  if (!/cancelar|cerrar|descartar/.test(text)) return;
  const form = button.closest("form") || document.querySelector("#modalBody form[data-ui-dirty='true']");
  if (!form) return;
  form.dataset.uiCancelled = "true";
  markFormClean(form);
}

export function enhanceUserInterface(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("button").forEach((button) => {
    normalizeSimpleButton(button);
    improveIconButton(button);
  });
  improveForms(root);
  enhanceLoadingStates(root);
  enhanceEmptyStates(root);
  enhanceTabs(root);
  enhanceContextualHelp(root);
  enhanceTables(root);
  refreshNavigationGroups(root);
  scanContext(root);
  if (root === interfaceView.root || root.contains?.(interfaceView.root)) refreshContextBar();
}

export function initUserInterface() {
  enhanceUserInterface(document);

  document.addEventListener("input", handleDocumentChange, true);
  document.addEventListener("change", handleDocumentChange, true);
  document.addEventListener("submit", handleFormSubmit, true);
  document.addEventListener("click", handleCancelClick, true);
  document.addEventListener("click", handlePotentialNavigation, true);

  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    if (!mutations.some((m) => m.addedNodes?.length || m.removedNodes?.length)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      cleanupDirtyForms();
      enhanceUserInterface(document);
    }, 0);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
