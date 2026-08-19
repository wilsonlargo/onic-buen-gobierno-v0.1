import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";

let currentContext = null;
let initialized = false;
let onNavigateReference = null;
let allNotes = [];
let currentStatusFilter = "abiertas";
let currentScope = "vigencia";
let currentSearch = "";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHTML(value);
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function shortAuthor(email = "") {
  const value = String(email || "Usuario");
  return value.includes("@") ? value.split("@")[0] : value;
}

function statusMeta(status) {
  const map = {
    pendiente: { label: "Pendiente", className: "pending" },
    en_proceso: { label: "En proceso", className: "process" },
    resuelta: { label: "Resuelta", className: "resolved" }
  };
  return map[status] || map.pendiente;
}

function entityLabel(type) {
  const map = {
    vigencia: "Vigencia",
    consejeria: "Consejería",
    linea: "Línea de Acción",
    programa: "Programa",
    proyecto: "Proyecto",
    actividad: "Actividad",
    indicador: "Indicador",
    mandato: "Mandato"
  };
  return map[type] || "Referencia";
}

function locationIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11z"></path>
      <circle cx="12" cy="10" r="2"></circle>
    </svg>
  `;
}

function normalizeContext(context) {
  if (!context?.vigenciaId) return null;

  return {
    vigenciaId: context.vigenciaId,
    vigenciaNombre: context.vigenciaNombre || "Vigencia",
    entidadTipo: context.entidadTipo || "vigencia",
    entidadId: context.entidadId || context.vigenciaId,
    entidadNombre:
      context.entidadNombre || context.vigenciaNombre || "Vigencia",
    seccion: context.seccion || null,
    ruta:
      context.ruta || context.entidadNombre || context.vigenciaNombre || "Vigencia",
    navigation: {
      ...(context.navigation || {}),
      vigencia_id: context.vigenciaId,
      vigencia_nombre:
        context.vigenciaNombre || context.navigation?.vigencia_nombre || ""
    },
    sectionOptions: Array.isArray(context.sectionOptions)
      ? context.sectionOptions
      : []
  };
}

export function setAuditContext(context) {
  currentContext = normalizeContext(context);
  if (initialized) {
    syncAuditButton();
    refreshPanel().catch(console.error);
  }
}

export function clearAuditContext() {
  currentContext = null;
  allNotes = [];
  if (initialized) {
    syncAuditButton();
    renderPanel();
  }
}

export function getAuditContext() {
  return currentContext;
}

async function getNotes(vigenciaId) {
  if (!vigenciaId) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("auditoria_notas")
    .select("*")
    .eq("vigencia_id", vigenciaId)
    .order("creado_en", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createNote(payload) {
  const supabase = requireSupabase();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  const { data, error } = await supabase
    .from("auditoria_notas")
    .insert({
      ...payload,
      autor_id: user?.id || null,
      autor_email: user?.email || "Usuario"
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateNote(id, payload) {
  const supabase = requireSupabase();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  const { data, error } = await supabase
    .from("auditoria_notas")
    .update({
      ...payload,
      modificado_por_id: user?.id || null,
      modificado_por_email: user?.email || "Usuario"
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

function panelElements() {
  return {
    drawer: document.querySelector("#auditDrawer"),
    scrim: document.querySelector("#auditScrim"),
    toggle: document.querySelector("#auditToggleButton"),
    badge: document.querySelector("#auditBadge"),
    context: document.querySelector("#auditContext"),
    list: document.querySelector("#auditNotesList"),
    count: document.querySelector("#auditPanelCount"),
    search: document.querySelector("#auditSearch"),
    status: document.querySelector("#auditStatusFilter"),
    add: document.querySelector("#auditAddButton")
  };
}

function isDrawerOpen() {
  return panelElements().drawer?.classList.contains("open");
}

function syncAuditButton() {
  const { toggle, badge } = panelElements();
  if (!toggle || !badge) return;
  toggle.disabled = !currentContext?.vigenciaId;
  const openCount = allNotes.filter((note) => note.estado !== "resuelta").length;
  badge.textContent = openCount > 99 ? "99+" : String(openCount);
  badge.classList.toggle("hidden", !currentContext?.vigenciaId || openCount === 0);
}

function contextHTML() {
  if (!currentContext) {
    return `
      <div class="audit-no-context">
        <strong>No hay una Vigencia activa en esta vista.</strong>
        <p>Abre una Vigencia, Consejería, Proyecto o Actividad para trabajar con sus notas.</p>
      </div>
    `;
  }

  return `
    <div class="audit-context-card">
      <div class="audit-context-icon">${locationIcon()}</div>
      <div>
        <span>${escapeHTML(entityLabel(currentContext.entidadTipo))}</span>
        <strong>${escapeHTML(currentContext.entidadNombre)}</strong>
        <small>${escapeHTML(currentContext.ruta)}</small>
      </div>
    </div>
  `;
}

function noteMatchesCurrentLocation(note) {
  if (!currentContext) return false;
  return (
    note.entidad_tipo === currentContext.entidadTipo &&
    String(note.entidad_id || "") === String(currentContext.entidadId || "")
  );
}

function filteredNotes() {
  const query = normalizeText(currentSearch);
  return allNotes.filter((note) => {
    if (currentScope === "ubicacion" && !noteMatchesCurrentLocation(note)) return false;
    if (currentStatusFilter === "abiertas" && note.estado === "resuelta") return false;
    if (!["todas", "abiertas"].includes(currentStatusFilter) && note.estado !== currentStatusFilter) return false;
    if (!query) return true;
    return normalizeText([
      note.tema,
      note.comentario,
      note.respuesta,
      note.ruta,
      note.entidad_nombre,
      note.autor_email
    ].join(" ")).includes(query);
  });
}

function renderPanel() {
  const { context, list, count, search, status, add } = panelElements();
  if (!context || !list) return;

  context.innerHTML = contextHTML();
  if (search) {
    search.disabled = !currentContext?.vigenciaId;
    search.value = currentSearch;
  }
  if (status) {
    status.disabled = !currentContext?.vigenciaId;
    status.value = currentStatusFilter;
  }
  if (add) add.disabled = !currentContext?.vigenciaId;

  document.querySelectorAll("[data-audit-scope]").forEach((button) => {
    button.disabled = !currentContext?.vigenciaId;
    button.classList.toggle("active", button.dataset.auditScope === currentScope);
  });

  if (!currentContext?.vigenciaId) {
    if (count) count.textContent = "0";
    list.innerHTML = `<div class="audit-empty">Selecciona primero una Vigencia.</div>`;
    syncAuditButton();
    return;
  }

  const rows = filteredNotes();
  if (count) count.textContent = String(rows.length);

  if (!rows.length) {
    list.innerHTML = `
      <div class="audit-empty">
        <strong>No hay notas con estos filtros.</strong>
        <p>Puedes crear una nueva nota sobre la ubicación actual.</p>
      </div>
    `;
    syncAuditButton();
    return;
  }

  list.innerHTML = rows.map((note) => {
    const meta = statusMeta(note.estado);
    return `
      <article class="audit-note-card" data-note-id="${note.id}">
        <div class="audit-note-card-top">
          <span class="audit-status ${meta.className}">${escapeHTML(meta.label)}</span>
          <span class="audit-note-entity">${escapeHTML(entityLabel(note.entidad_tipo))}</span>
        </div>
        <h4>${escapeHTML(note.tema)}</h4>
        <p>${escapeHTML(note.comentario)}</p>
        ${note.respuesta ? `
          <div class="audit-note-response">
            <span>Respuesta / acción</span>
            <p>${escapeHTML(note.respuesta)}</p>
          </div>
        ` : ""}
        <div class="audit-note-location">${locationIcon()}<span>${escapeHTML(note.ruta)}</span></div>
        <div class="audit-note-meta">
          <span>${escapeHTML(shortAuthor(note.autor_email))}</span>
          <span>${formatDateTime(note.creado_en)}</span>
        </div>
        <div class="audit-note-actions">
          <button class="text-button edit-audit-note" type="button" data-id="${note.id}">Revisar nota</button>
          <button class="text-button go-audit-reference" type="button" data-id="${note.id}">Ir a referencia →</button>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll(".edit-audit-note").forEach((button) => {
    button.addEventListener("click", () => {
      const note = allNotes.find((item) => item.id === button.dataset.id);
      if (note) openEditNote(note);
    });
  });

  list.querySelectorAll(".go-audit-reference").forEach((button) => {
    button.addEventListener("click", () => {
      const note = allNotes.find((item) => item.id === button.dataset.id);
      if (note) goToReference(note);
    });
  });

  syncAuditButton();
}

async function refreshPanel() {
  if (!currentContext?.vigenciaId) {
    allNotes = [];
    renderPanel();
    return;
  }

  try {
    allNotes = await getNotes(currentContext.vigenciaId);
    renderPanel();
  } catch (error) {
    console.error(error);
    const { list } = panelElements();
    if (list) {
      list.innerHTML = `
        <div class="audit-empty audit-error">
          <strong>No fue posible cargar las notas.</strong>
          <p>No fue posible cargar las notas de Auditoría. Intenta nuevamente.</p>
        </div>
      `;
    }
  }
}

function openDrawer() {
  const { drawer, scrim } = panelElements();
  drawer?.classList.add("open");
  scrim?.classList.add("visible");
  document.body.classList.add("audit-drawer-open");
  refreshPanel().catch(console.error);
}

function closeDrawer() {
  const { drawer, scrim } = panelElements();
  drawer?.classList.remove("open");
  scrim?.classList.remove("visible");
  document.body.classList.remove("audit-drawer-open");
}

function selectedSectionData(context, value) {
  return context.sectionOptions.find((item) => item.value === value) || null;
}

function openCreateNote(context = currentContext) {
  const normalized = normalizeContext(context);
  if (!normalized) return;

  const sectionOptions = normalized.sectionOptions;
  const defaultSection = normalized.seccion || sectionOptions[0]?.value || "";

  openModal({
    title: "Nueva nota de Auditoría",
    content: `
      <div class="audit-modal-reference">
        <span>Se registrará en</span>
        <strong>${escapeHTML(normalized.ruta)}</strong>
      </div>
      <form id="auditNoteForm">
        <div class="form-grid">
          <div class="form-field full">
            <label>Tema</label>
            <input name="tema" required placeholder="Ej. Revisar meta del indicador">
          </div>
          ${sectionOptions.length ? `
            <div class="form-field full">
              <label>Ubicación específica</label>
              <select name="seccion">
                ${sectionOptions.map((item) => `
                  <option value="${escapeHTML(item.value)}" ${item.value === defaultSection ? "selected" : ""}>${escapeHTML(item.label)}</option>
                `).join("")}
              </select>
            </div>
          ` : ""}
          <div class="form-field full">
            <label>Comentario</label>
            <textarea name="comentario" rows="6" required placeholder="Describe el asunto identificado..."></textarea>
          </div>
          <div class="form-field">
            <label>Estado</label>
            <select name="estado">
              <option value="pendiente">Pendiente</option>
              <option value="en_proceso">En proceso</option>
              <option value="resuelta">Resuelta</option>
            </select>
          </div>
          <div class="form-field full">
            <label>Respuesta / acción realizada</label>
            <textarea name="respuesta" rows="3" placeholder="Opcional. Puede completarse después."></textarea>
          </div>
        </div>
        <p id="auditNoteMessage" class="form-message"></p>
        <div class="form-actions">
          <button id="cancelAuditNote" class="btn btn-secondary" type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">Guardar nota</button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#auditNoteForm");
  const message = document.querySelector("#auditNoteMessage");
  document.querySelector("#cancelAuditNote").addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const section = String(data.get("seccion") || normalized.seccion || "");
    const sectionData = selectedSectionData(normalized, section);
    const navigation = { ...normalized.navigation, ...(sectionData?.navigation || {}) };
    const sectionLabel = sectionData?.label || section || "";
    const route = sectionLabel && !normalizeText(normalized.ruta).includes(normalizeText(sectionLabel))
      ? `${normalized.ruta} · ${sectionLabel}`
      : normalized.ruta;

    const payload = {
      vigencia_id: normalized.vigenciaId,
      entidad_tipo: normalized.entidadTipo,
      entidad_id: normalized.entidadId || null,
      entidad_nombre: normalized.entidadNombre,
      seccion: section || null,
      ruta: route,
      navegacion: navigation,
      tema: String(data.get("tema") || "").trim(),
      comentario: String(data.get("comentario") || "").trim(),
      estado: String(data.get("estado") || "pendiente"),
      respuesta: String(data.get("respuesta") || "").trim() || null,
      resuelta_en: data.get("estado") === "resuelta" ? new Date().toISOString() : null
    };

    if (!payload.tema || !payload.comentario) {
      message.textContent = "Tema y comentario son obligatorios.";
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      await createNote(payload);
      closeModal();
      openDrawer();
      await refreshPanel();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible guardar la nota.";
      submit.disabled = false;
      submit.textContent = "Guardar nota";
    }
  });
}

function openEditNote(note) {
  openModal({
    title: "Revisar nota de Auditoría",
    content: `
      <div class="audit-modal-reference">
        <span>Referencia</span>
        <strong>${escapeHTML(note.ruta)}</strong>
      </div>
      <div class="audit-read-meta">
        <div><span>Creada</span><strong>${formatDateTime(note.creado_en)}</strong></div>
        <div><span>Por</span><strong>${escapeHTML(note.autor_email)}</strong></div>
        <div><span>Modificada</span><strong>${formatDateTime(note.modificado_en)}</strong></div>
        <div><span>Último usuario</span><strong>${escapeHTML(note.modificado_por_email || note.autor_email)}</strong></div>
      </div>
      <form id="auditEditForm">
        <div class="form-grid">
          <div class="form-field full">
            <label>Tema</label>
            <input name="tema" required value="${escapeHTML(note.tema)}">
          </div>
          <div class="form-field full">
            <label>Comentario</label>
            <textarea name="comentario" rows="6" required>${escapeHTML(note.comentario)}</textarea>
          </div>
          <div class="form-field">
            <label>Estado</label>
            <select name="estado">
              <option value="pendiente" ${note.estado === "pendiente" ? "selected" : ""}>Pendiente</option>
              <option value="en_proceso" ${note.estado === "en_proceso" ? "selected" : ""}>En proceso</option>
              <option value="resuelta" ${note.estado === "resuelta" ? "selected" : ""}>Resuelta</option>
            </select>
          </div>
          <div class="form-field full">
            <label>Respuesta / acción realizada</label>
            <textarea name="respuesta" rows="4">${escapeHTML(note.respuesta || "")}</textarea>
          </div>
        </div>
        <p id="auditEditMessage" class="form-message"></p>
        <div class="form-actions">
          <button id="goAuditReferenceFromModal" class="btn btn-secondary" type="button">Ir a referencia</button>
          <button id="cancelAuditEdit" class="btn btn-secondary" type="button">Cerrar</button>
          <button class="btn btn-primary" type="submit">Guardar cambios</button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#auditEditForm");
  const message = document.querySelector("#auditEditMessage");
  document.querySelector("#cancelAuditEdit").addEventListener("click", closeModal);
  document.querySelector("#goAuditReferenceFromModal").addEventListener("click", () => {
    closeModal();
    goToReference(note);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const status = String(data.get("estado") || "pendiente");
    const payload = {
      tema: String(data.get("tema") || "").trim(),
      comentario: String(data.get("comentario") || "").trim(),
      estado: status,
      respuesta: String(data.get("respuesta") || "").trim() || null,
      resuelta_en: status === "resuelta" ? note.resuelta_en || new Date().toISOString() : null
    };

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      await updateNote(note.id, payload);
      closeModal();
      await refreshPanel();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible actualizar la nota.";
      submit.disabled = false;
      submit.textContent = "Guardar cambios";
    }
  });
}

async function goToReference(note) {
  if (typeof onNavigateReference !== "function") return;
  const navigation = note.navegacion || {};
  if (!navigation.view) {
    openModal({
      title: "Referencia no disponible",
      content: `
        <div class="danger-callout">
          <strong>Esta nota no contiene una ruta navegable.</strong>
          <p>La referencia textual se conserva: ${escapeHTML(note.ruta)}</p>
        </div>
        <div class="form-actions"><button id="closeMissingAuditReference" class="btn btn-secondary" type="button">Cerrar</button></div>
      `
    });
    document.querySelector("#closeMissingAuditReference").addEventListener("click", closeModal);
    return;
  }
  closeDrawer();
  await onNavigateReference(navigation);
}

export function openAuditPanel({ newNote = false, contextOverride = null } = {}) {
  if (contextOverride) setAuditContext(contextOverride);
  openDrawer();
  if (newNote && currentContext) openCreateNote(currentContext);
}

export function initAuditoria({ onNavigate } = {}) {
  if (initialized) {
    onNavigateReference = onNavigate || onNavigateReference;
    return;
  }

  initialized = true;
  onNavigateReference = onNavigate || null;

  const { drawer, scrim, toggle, search, status, add } = panelElements();
  if (!drawer || !scrim || !toggle) {
    console.warn("El panel de Auditoría no está presente en index.html.");
    return;
  }

  toggle.addEventListener("click", () => {
    if (isDrawerOpen()) closeDrawer();
    else openDrawer();
  });

  document.querySelector("#auditCloseButton")?.addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  add?.addEventListener("click", () => {
    if (currentContext) openCreateNote(currentContext);
  });
  search?.addEventListener("input", () => {
    currentSearch = search.value || "";
    renderPanel();
  });
  status?.addEventListener("change", () => {
    currentStatusFilter = status.value;
    renderPanel();
  });
  document.querySelectorAll("[data-audit-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      currentScope = button.dataset.auditScope;
      renderPanel();
    });
  });

  syncAuditButton();
  renderPanel();
}
