import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";

let cachedIndex = null;
let cachedAt = 0;
const CACHE_MS = 90_000;

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

function iconFor(type) {
  const icons = {
    vigencia: "◫",
    consejeria: "◎",
    linea: "≡",
    programa: "▤",
    proyecto: "▣",
    actividad: "✓",
    indicador: "↗",
    evidencia: "◆",
    mandato: "◇",
    compromiso: "!"
  };
  return icons[type] || "•";
}

function typeLabel(type) {
  const labels = {
    vigencia: "Vigencia",
    consejeria: "Consejería",
    linea: "Línea de Acción",
    programa: "Programa",
    proyecto: "Proyecto",
    actividad: "Actividad",
    indicador: "Indicador",
    evidencia: "Evidencia",
    mandato: "Mandato",
    compromiso: "Compromiso"
  };
  return labels[type] || "Resultado";
}

async function fetchAll() {
  const supabase = requireSupabase();
  const [vigenciasR, vcR, lineasR, programasR, proyectosR, actividadesR, indicadoresR, evidenciasR, mandatosR, compromisosR] = await Promise.all([
    supabase.from("vigencias").select("id,nombre,descripcion,lema,estado,fecha_inicio,fecha_fin"),
    supabase.from("vigencia_consejerias").select("id,vigencia_id,consejeria_id,estado,responsable,pueblo,detalle,consejerias(id,nombre_corto,nombre_largo,descripcion)"),
    supabase.from("lineas_accion").select("id,vigencia_consejeria_id,nombre,nombre_corto,descripcion,estado"),
    supabase.from("programas").select("id,linea_accion_id,nombre,nombre_corto,descripcion,estado"),
    supabase.from("proyectos").select("id,programa_id,codigo,nombre,nombre_corto,descripcion,objetivo_general,responsable,estado"),
    supabase.from("actividades").select("id,proyecto_id,codigo,nombre,descripcion,responsable,estado"),
    supabase.from("indicadores_actividad").select("id,actividad_id,codigo,nombre,unidad_medida,estado"),
    supabase.from("evidencias_actividad").select("id,actividad_id,nombre,descripcion,tipo,estado"),
    supabase.from("mandatos").select("id,vigencia_id,codigo,titulo,texto,observaciones,estado"),
    supabase.from("compromisos_tareas").select("id,vigencia_id,vigencia_consejeria_id,entidad_tipo,entidad_id,entidad_nombre,titulo,descripcion,estado,navigation,ruta,responsable_nombre,responsable_email")
  ]);

  const results = [vigenciasR, vcR, lineasR, programasR, proyectosR, actividadesR, indicadoresR, evidenciasR, mandatosR, compromisosR];
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;

  return {
    vigencias: vigenciasR.data || [],
    vcs: vcR.data || [],
    lineas: lineasR.data || [],
    programas: programasR.data || [],
    proyectos: proyectosR.data || [],
    actividades: actividadesR.data || [],
    indicadores: indicadoresR.data || [],
    evidencias: evidenciasR.data || [],
    mandatos: mandatosR.data || [],
    compromisos: compromisosR.data || []
  };
}

function buildIndex(data) {
  const vigenciaById = new Map(data.vigencias.map((row) => [row.id, row]));
  const vcById = new Map(data.vcs.map((row) => [row.id, row]));
  const lineById = new Map(data.lineas.map((row) => [row.id, row]));
  const programById = new Map(data.programas.map((row) => [row.id, row]));
  const projectById = new Map(data.proyectos.map((row) => [row.id, row]));
  const activityById = new Map(data.actividades.map((row) => [row.id, row]));

  const vcName = (vc) => vc?.consejerias?.nombre_corto || vc?.consejerias?.nombre_largo || "Consejería";
  const contextForLine = (line) => {
    const vc = vcById.get(line?.vigencia_consejeria_id);
    return { vc, vigencia: vigenciaById.get(vc?.vigencia_id) };
  };
  const contextForProgram = (program) => {
    const line = lineById.get(program?.linea_accion_id);
    return { line, ...contextForLine(line) };
  };
  const contextForProject = (project) => {
    const program = programById.get(project?.programa_id);
    return { program, ...contextForProgram(program) };
  };
  const contextForActivity = (activity) => {
    const project = projectById.get(activity?.proyecto_id);
    return { project, ...contextForProject(project) };
  };

  const items = [];
  const add = ({ type, id, title, subtitle = "", text = "", route = "", navigation }) => {
    items.push({
      type,
      id,
      title: title || typeLabel(type),
      subtitle,
      route,
      navigation,
      search: normalize([title, subtitle, text, route, typeLabel(type)].filter(Boolean).join(" "))
    });
  };

  data.vigencias.forEach((vigencia) => add({
    type: "vigencia",
    id: vigencia.id,
    title: vigencia.nombre,
    subtitle: vigencia.lema || vigencia.estado || "Vigencia",
    text: vigencia.descripcion,
    route: vigencia.nombre,
    navigation: { view: "inicio", vigencia_id: vigencia.id }
  }));

  data.vcs.forEach((vc) => {
    const vigencia = vigenciaById.get(vc.vigencia_id);
    add({
      type: "consejeria",
      id: vc.id,
      title: vcName(vc),
      subtitle: vc.responsable || vc.pueblo || "Consejería",
      text: `${vc.detalle || ""} ${vc.consejerias?.descripcion || ""}`,
      route: [vigencia?.nombre, vcName(vc)].filter(Boolean).join(" › "),
      navigation: { view: "consejerias", vigencia_id: vc.vigencia_id, vigencia_consejeria_id: vc.id }
    });
  });

  data.lineas.forEach((line) => {
    const ctx = contextForLine(line);
    add({
      type: "linea",
      id: line.id,
      title: line.nombre,
      subtitle: line.nombre_corto || vcName(ctx.vc),
      text: line.descripcion,
      route: [ctx.vigencia?.nombre, vcName(ctx.vc), line.nombre].filter(Boolean).join(" › "),
      navigation: { view: "lineas", vigencia_id: ctx.vigencia?.id, vigencia_consejeria_id: ctx.vc?.id, linea_id: line.id }
    });
  });

  data.programas.forEach((program) => {
    const ctx = contextForProgram(program);
    add({
      type: "programa",
      id: program.id,
      title: program.nombre,
      subtitle: program.nombre_corto || ctx.line?.nombre || "Programa",
      text: program.descripcion,
      route: [ctx.vigencia?.nombre, vcName(ctx.vc), ctx.line?.nombre, program.nombre].filter(Boolean).join(" › "),
      navigation: { view: "proyectos", vigencia_id: ctx.vigencia?.id, vigencia_consejeria_id: ctx.vc?.id, linea_id: ctx.line?.id, programa_id: program.id }
    });
  });

  data.proyectos.forEach((project) => {
    const ctx = contextForProject(project);
    add({
      type: "proyecto",
      id: project.id,
      title: `${project.codigo ? `${project.codigo} · ` : ""}${project.nombre}`,
      subtitle: project.responsable || ctx.program?.nombre || "Proyecto",
      text: `${project.descripcion || ""} ${project.objetivo_general || ""}`,
      route: [ctx.vigencia?.nombre, vcName(ctx.vc), ctx.line?.nombre, ctx.program?.nombre, project.nombre].filter(Boolean).join(" › "),
      navigation: { view: "proyectos", vigencia_id: ctx.vigencia?.id, vigencia_consejeria_id: ctx.vc?.id, linea_id: ctx.line?.id, programa_id: ctx.program?.id, proyecto_id: project.id }
    });
  });

  data.actividades.forEach((activity) => {
    const ctx = contextForActivity(activity);
    add({
      type: "actividad",
      id: activity.id,
      title: `${activity.codigo ? `${activity.codigo} · ` : ""}${activity.nombre}`,
      subtitle: activity.responsable || ctx.project?.nombre || "Actividad",
      text: activity.descripcion,
      route: [ctx.vigencia?.nombre, vcName(ctx.vc), ctx.project?.nombre, activity.nombre].filter(Boolean).join(" › "),
      navigation: { view: "proyectos", vigencia_id: ctx.vigencia?.id, vigencia_consejeria_id: ctx.vc?.id, linea_id: ctx.line?.id, programa_id: ctx.program?.id, proyecto_id: ctx.project?.id, project_tab: "actividades", actividad_id: activity.id, activity_tab: "general" }
    });
  });

  data.indicadores.forEach((indicator) => {
    const activity = activityById.get(indicator.actividad_id);
    const ctx = contextForActivity(activity);
    add({
      type: "indicador",
      id: indicator.id,
      title: `${indicator.codigo ? `${indicator.codigo} · ` : ""}${indicator.nombre}`,
      subtitle: indicator.unidad_medida || activity?.nombre || "Indicador",
      route: [ctx.vigencia?.nombre, vcName(ctx.vc), ctx.project?.nombre, activity?.nombre, indicator.nombre].filter(Boolean).join(" › "),
      navigation: { view: "proyectos", vigencia_id: ctx.vigencia?.id, vigencia_consejeria_id: ctx.vc?.id, linea_id: ctx.line?.id, programa_id: ctx.program?.id, proyecto_id: ctx.project?.id, project_tab: "actividades", actividad_id: activity?.id, activity_tab: "indicadores" }
    });
  });

  data.evidencias.forEach((evidence) => {
    const activity = activityById.get(evidence.actividad_id);
    const ctx = contextForActivity(activity);
    add({
      type: "evidencia",
      id: evidence.id,
      title: evidence.nombre,
      subtitle: evidence.tipo || activity?.nombre || "Evidencia",
      text: evidence.descripcion,
      route: [ctx.vigencia?.nombre, vcName(ctx.vc), ctx.project?.nombre, activity?.nombre, evidence.nombre].filter(Boolean).join(" › "),
      navigation: { view: "proyectos", vigencia_id: ctx.vigencia?.id, vigencia_consejeria_id: ctx.vc?.id, linea_id: ctx.line?.id, programa_id: ctx.program?.id, proyecto_id: ctx.project?.id, project_tab: "actividades", actividad_id: activity?.id, activity_tab: "evidencias" }
    });
  });

  data.mandatos.forEach((mandate) => {
    const vigencia = vigenciaById.get(mandate.vigencia_id);
    add({
      type: "mandato",
      id: mandate.id,
      title: `${mandate.codigo ? `${mandate.codigo} · ` : ""}${mandate.titulo}`,
      subtitle: mandate.estado || "Mandato",
      text: `${mandate.texto || ""} ${mandate.observaciones || ""}`,
      route: [vigencia?.nombre, mandate.titulo].filter(Boolean).join(" › "),
      navigation: { view: "seguimiento_mandatos", vigencia_id: mandate.vigencia_id, mandato_id: mandate.id }
    });
  });

  data.compromisos.forEach((task) => {
    add({
      type: "compromiso",
      id: task.id,
      title: task.titulo,
      subtitle: task.responsable_nombre || task.responsable_email || task.estado || "Compromiso",
      text: task.descripcion,
      route: task.ruta || vigenciaById.get(task.vigencia_id)?.nombre || "",
      navigation: task.navigation && typeof task.navigation === "object" && Object.keys(task.navigation).length
        ? task.navigation
        : { view: "alertas", vigencia_id: task.vigencia_id, vigencia_consejeria_id: task.vigencia_consejeria_id || null, tab: "compromisos" }
    });
  });

  return items;
}

async function getIndex({ force = false } = {}) {
  if (!force && cachedIndex && Date.now() - cachedAt < CACHE_MS) return cachedIndex;
  const data = await fetchAll();
  cachedIndex = buildIndex(data);
  cachedAt = Date.now();
  return cachedIndex;
}

function scoreItem(item, query) {
  if (!item.search.includes(query)) return -1;
  const title = normalize(item.title);
  const subtitle = normalize(item.subtitle);
  let score = 1;
  if (title === query) score += 100;
  else if (title.startsWith(query)) score += 50;
  else if (title.includes(query)) score += 25;
  if (subtitle.includes(query)) score += 8;
  if (["proyecto", "actividad", "indicador", "mandato"].includes(item.type)) score += 2;
  return score;
}

export function invalidateGlobalSearchCache() {
  cachedIndex = null;
  cachedAt = 0;
}

export function initGlobalSearch({ onNavigate } = {}) {
  const button = document.querySelector("#globalSearchButton");
  if (!button || button.dataset.initialized === "true") return;
  button.dataset.initialized = "true";

  const navigate = typeof onNavigate === "function"
    ? onNavigate
    : async (target) => window.dispatchEvent(new CustomEvent("app:navigate", { detail: { view: target.view, target } }));

  async function openSearch() {
    openModal({
      title: "Buscar en el Sistema",
      content: `
        <div class="global-search-dialog">
          <div class="global-search-input-wrap">
            <span aria-hidden="true">⌕</span>
            <input id="globalSearchInput" type="search" autocomplete="off" placeholder="Busca Proyectos, Actividades, Indicadores, Mandatos…" aria-label="Buscar en el Sistema">
            <kbd>Esc</kbd>
          </div>
          <div class="global-search-help">Escribe al menos 2 caracteres. Los resultados respetan los permisos de tu usuario.</div>
          <div id="globalSearchResults" class="global-search-results"><div class="empty-state">Escribe para comenzar la búsqueda.</div></div>
        </div>
      `
    });

    const input = document.querySelector("#globalSearchInput");
    const resultsHost = document.querySelector("#globalSearchResults");
    let index = null;
    let timer = null;
    let requestId = 0;
    input?.focus();

    async function ensureIndex() {
      if (index) return index;
      resultsHost.innerHTML = `<div class="empty-state">Preparando búsqueda…</div>`;
      index = await getIndex();
      return index;
    }

    function renderResults(items, query) {
      if (!items.length) {
        resultsHost.innerHTML = `<div class="empty-state">No se encontraron resultados para “${escapeHTML(query)}”.</div>`;
        return;
      }
      resultsHost.innerHTML = items.map((item, idx) => `
        <button class="global-search-result" type="button" data-result-index="${idx}">
          <span class="global-search-result-icon">${iconFor(item.type)}</span>
          <span class="global-search-result-copy">
            <span class="global-search-result-type">${typeLabel(item.type)}</span>
            <strong>${escapeHTML(item.title)}</strong>
            ${item.subtitle ? `<small>${escapeHTML(item.subtitle)}</small>` : ""}
            ${item.route ? `<em>${escapeHTML(item.route)}</em>` : ""}
          </span>
          <span class="global-search-open">Abrir →</span>
        </button>
      `).join("");
      resultsHost.querySelectorAll("[data-result-index]").forEach((element) => {
        element.addEventListener("click", async () => {
          const item = items[Number(element.dataset.resultIndex)];
          if (!item?.navigation?.view) return;
          closeModal();
          await navigate(item.navigation);
        });
      });
    }

    input?.addEventListener("input", () => {
      clearTimeout(timer);
      const value = input.value.trim();
      timer = setTimeout(async () => {
        const localRequest = ++requestId;
        const query = normalize(value);
        if (query.length < 2) {
          resultsHost.innerHTML = `<div class="empty-state">Escribe al menos 2 caracteres.</div>`;
          return;
        }
        try {
          const all = await ensureIndex();
          if (localRequest !== requestId) return;
          const matches = all
            .map((item) => ({ item, score: scoreItem(item, query) }))
            .filter((entry) => entry.score >= 0)
            .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "es"))
            .slice(0, 40)
            .map((entry) => entry.item);
          renderResults(matches, value);
        } catch (error) {
          console.error(error);
          resultsHost.innerHTML = `<div class="empty-state">No fue posible realizar la búsqueda. Intenta nuevamente.</div>`;
        }
      }, 140);
    });
  }

  button.addEventListener("click", openSearch);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
  });
}
