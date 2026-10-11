/*
 * Sistema de interfaz V5.2
 * Unifica iconografía, acciones, accesibilidad y pequeños comportamientos
 * sin alterar la lógica funcional de los módulos.
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
  chevronDown: '<path d="m7 9 5 5 5-5"></path>'
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

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  // Evita modificar tarjetas o botones ricos con contenido estructurado.
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

  let iconName = actionIcon(text, button);
  if (!iconName) return;

  text = text.replace(/^\+\s*/, "").replace(/\s*[→▾]\s*$/, "").trim();
  const icon = uiIcon(iconName);

  if (iconName === "forward" || iconName === "chevronDown") {
    button.innerHTML = `<span class="ui-button-label">${text}</span>${icon}`;
  } else {
    button.innerHTML = `${icon}<span class="ui-button-label">${text}</span>`;
  }
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

    group.addEventListener("click", () => {
      setTimeout(() => refreshTabState(group), 0);
    });
  });
}


function enhanceLoadingStates(root) {
  root.querySelectorAll(".empty-state").forEach((state) => {
    if (state.dataset.uiLoadingEnhanced === "true" || state.children.length) return;
    const text = cleanText(state.textContent);
    if (!/^(cargando|calculando|preparando)/i.test(text)) return;
    state.classList.add("inline-loading-state");
    state.innerHTML = `<span class="loading-spinner" aria-hidden="true"></span><span>${text}</span>`;
    state.dataset.uiLoadingEnhanced = "true";
  });
}

function improveForms(root) {
  root.querySelectorAll("input, select, textarea").forEach((field) => {
    if (!field.getAttribute("autocomplete") && field.type === "search") field.setAttribute("autocomplete", "off");
  });
}

export function enhanceUserInterface(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("button").forEach((button) => {
    normalizeSimpleButton(button);
    improveIconButton(button);
  });
  improveForms(root);
  enhanceLoadingStates(root);
  enhanceTabs(root);
  refreshNavigationGroups(root);
}

let observer = null;
let timer = null;

export function initUserInterface() {
  enhanceUserInterface(document);
  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    if (!mutations.some((m) => m.addedNodes?.length)) return;
    clearTimeout(timer);
    timer = setTimeout(() => enhanceUserInterface(document), 0);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
