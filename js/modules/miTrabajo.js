import { requireSupabase } from "../supabaseClient.js";
import { getCurrentProfile } from "../security.js";
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
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function daysUntil(value) {
  if (!value) return null;
  const today = new Date(`${todayISO()}T00:00:00`);
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - today.getTime()) / 86400000);
}

function dueLabel(value) {
  const days = daysUntil(value);
  if (days === null) return { label: "Sin fecha límite", className: "neutral" };
  if (days < 0) return { label: `Vencido hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}`, className: "overdue" };
  if (days === 0) return { label: "Vence hoy", className: "due" };
  if (days <= 7) return { label: `Vence en ${days} día${days === 1 ? "" : "s"}`, className: "due" };
  return { label: formatDate(value), className: "normal" };
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

function responsibleMatches(text, profile) {
  const responsible = normalize(text);
  if (!responsible) return false;
  const email = normalize(profile?.email);
  const name = normalize(profile?.nombre);
  if (email && responsible.includes(email)) return true;
  if (name && name.length >= 4 && responsible.includes(name)) return true;

  const tokens = name.split(" ").filter((token) => token.length >= 4);
  if (tokens.length >= 2) {
    const matches = tokens.filter((token) => responsible.includes(token));
    if (matches.length >= 2) return true;
  }
  return false;
}

async function loadWorkData(vigenciaId, profile) {
  const supabase = requireSupabase();
  const [vcResult, tasksResult, notesResult] = await Promise.all([
    supabase
      .from("vigencia_consejerias")
      .select("id,vigencia_id,estado,responsable,consejerias(id,nombre_corto,nombre_largo)")
      .eq("vigencia_id", vigenciaId),
    supabase
      .from("compromisos_tareas")
      .select("*")
      .eq("vigencia_id", vigenciaId)
      .eq("responsable_usuario_id", profile.id)
      .order("fecha_limite", { ascending: true, nullsFirst: false })
      .order("creado_en", { ascending: false }),
    supabase
      .from("auditoria_notas")
      .select("*")
      .eq("vigencia_id", vigenciaId)
      .eq("autor_id", profile.id)
      .neq("estado", "resuelta")
      .order("creado_en", { ascending: false })
  ]);
  const error = vcResult.error || tasksResult.error || notesResult.error;
  if (error) throw error;

  const vcs = vcResult.data || [];
  const vcIds = vcs.map((row) => row.id);
  const lineas = await getRowsIn("lineas_accion", "vigencia_consejeria_id", vcIds, "id,vigencia_consejeria_id,nombre,estado");
  const lineIds = lineas.map((row) => row.id);
  const programas = await getRowsIn("programas", "linea_accion_id", lineIds, "id,linea_accion_id,nombre,estado");
  const programIds = programas.map((row) => row.id);
  const proyectos = await getRowsIn("proyectos", "programa_id", programIds, "id,programa_id,codigo,nombre,responsable,fecha_inicio,fecha_fin,estado");
  const projectIds = proyectos.map((row) => row.id);
  const actividades = await getRowsIn("actividades", "proyecto_id", projectIds, "id,proyecto_id,codigo,nombre,responsable,fecha_inicio,fecha_fin,estado");

  return {
    vcs,
    lineas,
    programas,
    proyectos,
    actividades,
    tasks: tasksResult.data || [],
    notes: notesResult.data || []
  };
}

function vcName(vc) {
  return vc?.consejerias?.nombre_corto || vc?.consejerias?.nombre_largo || "Consejería";
}

function parseNavigation(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function dispatchNavigate(target) {
  if (!target?.view) return;
  window.dispatchEvent(new CustomEvent("app:navigate", { detail: { view: target.view, target } }));
}

function hierarchy(data) {
  const vcById = new Map(data.vcs.map((row) => [row.id, row]));
  const lineById = new Map(data.lineas.map((row) => [row.id, row]));
  const programById = new Map(data.programas.map((row) => [row.id, row]));
  const projectById = new Map(data.proyectos.map((row) => [row.id, row]));

  const projectContext = (project) => {
    const program = programById.get(project?.programa_id);
    const line = lineById.get(program?.linea_accion_id);
    const vc = vcById.get(line?.vigencia_consejeria_id);
    return { project, program, line, vc };
  };
  const activityContext = (activity) => {
    const project = projectById.get(activity?.proyecto_id);
    return { activity, ...projectContext(project) };
  };
  return { projectById, projectContext, activityContext };
}

function projectNavigation(vigenciaId, ctx, extras = {}) {
  return {
    view: "proyectos",
    vigencia_id: vigenciaId,
    vigencia_consejeria_id: ctx.vc?.id || null,
    linea_id: ctx.line?.id || null,
    programa_id: ctx.program?.id || null,
    proyecto_id: ctx.project?.id || null,
    ...extras
  };
}

export async function renderMiTrabajo(container, navigationTarget = null) {
  const profile = getCurrentProfile();
  let vigencias = [];
  let selectedVigenciaId = navigationTarget?.vigencia_id || "";
  let data = null;
  let maps = null;
  let currentTab = navigationTarget?.tab || "pendientes";

  container.innerHTML = `
    <section class="hero-panel my-work-hero">
      <div>
        <p class="eyebrow" style="color:var(--onic-cream-300)">Espacio personal</p>
        <h2>Mi trabajo</h2>
        <p>Reúne tus compromisos, responsabilidades y notas abiertas para que puedas identificar rápidamente qué requiere tu atención.</p>
      </div>
      <div class="my-work-person"><strong>${escapeHTML(profile?.nombre || profile?.email || "Usuario")}</strong><span>${escapeHTML(profile?.email || "")}</span></div>
    </section>

    <section class="panel my-work-context">
      <div class="form-field">
        <label for="myWorkVigencia">Vigencia</label>
        <select id="myWorkVigencia"><option value="">Cargando…</option></select>
      </div>
      <p class="muted">Los compromisos se asignan directamente a tu usuario. Los Proyectos y Actividades se reconocen cuando el campo Responsable coincide con tu nombre o correo.</p>
    </section>

    <section id="myWorkSummary" class="my-work-summary"><div class="empty-state">Cargando…</div></section>

    <nav class="my-work-tabs" aria-label="Mi trabajo">
      <button type="button" data-work-tab="pendientes" class="${currentTab === "pendientes" ? "active" : ""}">Pendientes</button>
      <button type="button" data-work-tab="responsabilidades" class="${currentTab === "responsabilidades" ? "active" : ""}">Mis responsabilidades</button>
      <button type="button" data-work-tab="notas" class="${currentTab === "notas" ? "active" : ""}">Mis notas abiertas</button>
    </nav>

    <section id="myWorkBody" class="my-work-body"><div class="empty-state">Cargando…</div></section>
  `;

  const vigenciaSelect = container.querySelector("#myWorkVigencia");
  const summaryHost = container.querySelector("#myWorkSummary");
  const body = container.querySelector("#myWorkBody");

  function currentVigencia() {
    return vigencias.find((row) => row.id === selectedVigenciaId);
  }

  function ownProjects() {
    return (data?.proyectos || []).filter((project) => responsibleMatches(project.responsable, profile));
  }

  function ownActivities() {
    return (data?.actividades || []).filter((activity) => responsibleMatches(activity.responsable, profile));
  }

  function openTasks() {
    return (data?.tasks || []).filter((task) => !["completada", "cancelada"].includes(task.estado));
  }

  function renderSummary() {
    const tasks = openTasks();
    const overdue = tasks.filter((task) => {
      const days = daysUntil(task.fecha_limite);
      return days !== null && days < 0;
    });
    const near = tasks.filter((task) => {
      const days = daysUntil(task.fecha_limite);
      return days !== null && days >= 0 && days <= 7;
    });
    const projects = ownProjects();
    const activities = ownActivities();
    const notes = data?.notes || [];

    summaryHost.innerHTML = `
      <article class="my-work-summary-card"><span>Compromisos abiertos</span><strong>${tasks.length}</strong><small>${overdue.length ? `${overdue.length} vencido${overdue.length === 1 ? "" : "s"}` : "Sin vencidos"}</small></article>
      <article class="my-work-summary-card due"><span>Próximos 7 días</span><strong>${near.length}</strong><small>Compromisos por atender</small></article>
      <article class="my-work-summary-card"><span>Proyectos a mi cargo</span><strong>${projects.length}</strong><small>Según el campo Responsable</small></article>
      <article class="my-work-summary-card"><span>Actividades a mi cargo</span><strong>${activities.length}</strong><small>Según el campo Responsable</small></article>
      <article class="my-work-summary-card"><span>Notas abiertas</span><strong>${notes.length}</strong><small>Notas de Auditoría creadas por ti</small></article>
    `;
  }

  function taskNavigation(task) {
    return parseNavigation(task.navigation) || { view: "alertas", vigencia_id: task.vigencia_id, vigencia_consejeria_id: task.vigencia_consejeria_id || null, tab: "compromisos" };
  }

  function renderPending() {
    const tasks = openTasks().slice().sort((a, b) => {
      const da = a.fecha_limite || "9999-12-31";
      const db = b.fecha_limite || "9999-12-31";
      return da.localeCompare(db);
    });
    if (!tasks.length) {
      body.innerHTML = `<div class="empty-state">No tienes compromisos abiertos asignados en esta Vigencia.</div>`;
      return;
    }
    body.innerHTML = `<div class="my-work-card-list">${tasks.map((task) => {
      const due = dueLabel(task.fecha_limite);
      return `
        <article class="my-work-item task ${due.className}">
          <div class="my-work-item-head"><div><p class="eyebrow">${task.prioridad === "alta" ? "Prioridad alta" : task.prioridad === "baja" ? "Prioridad baja" : "Prioridad media"}</p><h3>${escapeHTML(task.titulo)}</h3></div><span class="my-work-due ${due.className}">${escapeHTML(due.label)}</span></div>
          ${task.descripcion ? `<p>${escapeHTML(task.descripcion)}</p>` : ""}
          <p class="muted">${escapeHTML(task.ruta || task.entidad_nombre || "Compromiso de la Vigencia")}</p>
          <div class="my-work-item-actions"><span>Estado: <strong>${task.estado === "en_proceso" ? "En proceso" : "Pendiente"}</strong></span><button class="btn btn-secondary open-work-task" type="button" data-id="${task.id}">Ir a referencia</button></div>
        </article>`;
    }).join("")}</div>`;
    body.querySelectorAll(".open-work-task").forEach((button) => button.addEventListener("click", () => {
      const task = data.tasks.find((item) => item.id === button.dataset.id);
      if (task) dispatchNavigate(taskNavigation(task));
    }));
  }

  function renderResponsibilities() {
    const projects = ownProjects();
    const activities = ownActivities();
    if (!projects.length && !activities.length) {
      body.innerHTML = `<div class="empty-state">No se encontraron Proyectos o Actividades cuyo campo Responsable coincida con tu perfil. Los compromisos asignados directamente a tu usuario siguen apareciendo en Pendientes.</div>`;
      return;
    }
    body.innerHTML = `
      <div class="my-work-section-heading"><div><p class="eyebrow">Responsabilidad registrada</p><h3>Proyectos</h3></div><strong>${projects.length}</strong></div>
      <div class="my-work-card-list compact">
        ${projects.map((project) => {
          const ctx = maps.projectContext(project);
          return `<article class="my-work-item"><div><p class="eyebrow">${escapeHTML(vcName(ctx.vc))} · ${escapeHTML(ctx.program?.nombre || "Programa")}</p><h3>${escapeHTML(project.codigo || "Proyecto")} · ${escapeHTML(project.nombre)}</h3><p class="muted">${escapeHTML(project.responsable || "")}</p></div><button class="btn btn-secondary open-own-project" data-id="${project.id}" type="button">Abrir Proyecto</button></article>`;
        }).join("") || `<div class="empty-state">Sin Proyectos identificados.</div>`}
      </div>
      <div class="my-work-section-heading"><div><p class="eyebrow">Responsabilidad registrada</p><h3>Actividades</h3></div><strong>${activities.length}</strong></div>
      <div class="my-work-card-list compact">
        ${activities.map((activity) => {
          const ctx = maps.activityContext(activity);
          const due = dueLabel(activity.fecha_fin);
          return `<article class="my-work-item"><div><p class="eyebrow">${escapeHTML(ctx.project?.nombre || "Proyecto")}</p><h3>${escapeHTML(activity.codigo || "Actividad")} · ${escapeHTML(activity.nombre)}</h3><p class="muted">${escapeHTML(activity.responsable || "")} · ${formatDate(activity.fecha_inicio)} → ${formatDate(activity.fecha_fin)}</p></div><div class="my-work-item-side"><span class="my-work-due ${due.className}">${escapeHTML(due.label)}</span><button class="btn btn-secondary open-own-activity" data-id="${activity.id}" type="button">Abrir Actividad</button></div></article>`;
        }).join("") || `<div class="empty-state">Sin Actividades identificadas.</div>`}
      </div>
    `;
    body.querySelectorAll(".open-own-project").forEach((button) => button.addEventListener("click", () => {
      const project = data.proyectos.find((item) => item.id === button.dataset.id);
      if (!project) return;
      dispatchNavigate(projectNavigation(selectedVigenciaId, maps.projectContext(project)));
    }));
    body.querySelectorAll(".open-own-activity").forEach((button) => button.addEventListener("click", () => {
      const activity = data.actividades.find((item) => item.id === button.dataset.id);
      if (!activity) return;
      dispatchNavigate(projectNavigation(selectedVigenciaId, maps.activityContext(activity), { project_tab: "actividades", actividad_id: activity.id, activity_tab: "general" }));
    }));
  }

  function renderNotes() {
    const notes = data?.notes || [];
    if (!notes.length) {
      body.innerHTML = `<div class="empty-state">No tienes Notas de Auditoría abiertas creadas por ti en esta Vigencia.</div>`;
      return;
    }
    body.innerHTML = `<div class="my-work-card-list">${notes.map((note) => `
      <article class="my-work-item note">
        <div><p class="eyebrow">${note.estado === "en_proceso" ? "En proceso" : "Pendiente"}</p><h3>${escapeHTML(note.tema || "Nota de Auditoría")}</h3><p>${escapeHTML(note.comentario || "")}</p><p class="muted">${escapeHTML(note.ruta || note.entidad_nombre || "")}</p></div>
        <button class="btn btn-secondary open-own-note" data-id="${note.id}" type="button">Ir a referencia</button>
      </article>`).join("")}</div>`;
    body.querySelectorAll(".open-own-note").forEach((button) => button.addEventListener("click", () => {
      const note = notes.find((item) => item.id === button.dataset.id);
      const navigation = parseNavigation(note?.navegacion);
      if (navigation) dispatchNavigate(navigation);
    }));
  }

  function renderBody() {
    container.querySelectorAll("[data-work-tab]").forEach((button) => button.classList.toggle("active", button.dataset.workTab === currentTab));
    if (currentTab === "responsabilidades") renderResponsibilities();
    else if (currentTab === "notas") renderNotes();
    else renderPending();
  }

  function setAudit() {
    const vigencia = currentVigencia();
    if (!vigencia) return;
    setAuditContext({
      vigenciaId: vigencia.id,
      vigenciaNombre: vigencia.nombre,
      entidadTipo: "vigencia",
      entidadId: vigencia.id,
      entidadNombre: vigencia.nombre,
      seccion: "mi_trabajo",
      ruta: `${vigencia.nombre} › Mi trabajo`,
      navigation: { view: "mi_trabajo", vigencia_id: vigencia.id, tab: currentTab }
    });
  }

  async function loadSelected() {
    if (!selectedVigenciaId) {
      data = { proyectos: [], actividades: [], tasks: [], notes: [], vcs: [], lineas: [], programas: [] };
      maps = hierarchy(data);
      renderSummary();
      renderBody();
      return;
    }
    body.innerHTML = `<div class="empty-state">Cargando tu trabajo…</div>`;
    data = await loadWorkData(selectedVigenciaId, profile);
    maps = hierarchy(data);
    renderSummary();
    renderBody();
    setAudit();
  }

  vigencias = await getVigencias();
  if (!selectedVigenciaId || !vigencias.some((row) => row.id === selectedVigenciaId)) selectedVigenciaId = vigencias[0]?.id || "";
  vigenciaSelect.innerHTML = vigencias.map((row) => option(row.id, row.nombre, row.id === selectedVigenciaId)).join("") || `<option value="">Sin Vigencias</option>`;
  await loadSelected();

  vigenciaSelect.addEventListener("change", async () => {
    selectedVigenciaId = vigenciaSelect.value;
    await loadSelected();
  });

  container.querySelectorAll("[data-work-tab]").forEach((button) => button.addEventListener("click", () => {
    currentTab = button.dataset.workTab;
    renderBody();
    setAudit();
  }));
}
