import { requireSupabase } from "../supabaseClient.js";
import {
  canManageGlobalStructure,
  getCurrentProfile,
  isReadOnlyUser,
  updateWithVersion
} from "../security.js";
import { openModal, closeModal } from "../components/modal.js";
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

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(2).replace(".", ",")} %`;
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(number);
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysISO(days) {
  const date = new Date(`${todayISO()}T12:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function daysBetweenToday(value) {
  if (!value) return null;
  const today = new Date(`${todayISO()}T00:00:00`);
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - today.getTime()) / 86400000);
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function equalWeights(items = []) {
  const map = new Map(items.map((item) => [item.id, 0]));
  if (!items.length) return map;
  const totalUnits = 10000;
  const base = Math.floor(totalUnits / items.length);
  const remainder = totalUnits - base * items.length;
  items.forEach((item, index) => map.set(item.id, (base + (index < remainder ? 1 : 0)) / 100));
  return map;
}

function calculateIndicatorProgress(indicator) {
  if (!indicator || indicator.estado !== "activo") return null;
  const base = numericValue(indicator.linea_base);
  const meta = numericValue(indicator.meta);
  const current = numericValue(indicator.valor_actual);
  if ([base, meta, current].some((value) => value === null)) return null;
  const denominator = indicator.sentido === "descendente" ? base - meta : meta - base;
  const numerator = indicator.sentido === "descendente" ? base - current : current - base;
  if (Math.abs(denominator) < 1e-12) return null;
  return clamp((numerator / denominator) * 100);
}

function calculateActivityProgress(indicators = []) {
  const active = indicators.filter((indicator) => indicator.estado === "activo");
  if (!active.length) return null;
  const values = active.map(calculateIndicatorProgress);
  if (values.some((value) => value === null)) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function severityMeta(severity) {
  const map = {
    alta: { label: "Urgente", className: "high" },
    media: { label: "Atención", className: "medium" },
    baja: { label: "Informativa", className: "low" }
  };
  return map[severity] || map.media;
}

function priorityMeta(priority) {
  const map = {
    alta: { label: "Alta", className: "high" },
    media: { label: "Media", className: "medium" },
    baja: { label: "Baja", className: "low" }
  };
  return map[priority] || map.media;
}

function taskStatusMeta(status) {
  const map = {
    pendiente: { label: "Pendiente", className: "pending" },
    en_proceso: { label: "En proceso", className: "process" },
    completada: { label: "Completada", className: "completed" },
    cancelada: { label: "Cancelada", className: "cancelled" }
  };
  return map[status] || map.pendiente;
}

function alertTypeLabel(type) {
  const map = {
    actividad_vencida: "Actividad vencida",
    actividad_proxima: "Próximo vencimiento",
    indicador_sin_medicion: "Indicador sin medición",
    indicador_invalido: "Indicador por revisar",
    avance_sin_evidencia: "Avance sin evidencia",
    proyecto_sin_actividades: "Proyecto sin actividades",
    programa_sin_proyectos: "Programa sin proyectos",
    ponderacion_incompleta: "Ponderación incompleta",
    desfase_presupuestal: "Desfase técnico-presupuestal",
    compromiso_vencido: "Compromiso vencido",
    compromiso_proximo: "Compromiso próximo"
  };
  return map[type] || "Alerta";
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

async function getConsejerias(vigenciaId) {
  if (!vigenciaId) return [];
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("vigencia_consejerias")
    .select("id,vigencia_id,consejeria_id,estado,responsable,consejerias(nombre_corto,nombre_largo)")
    .eq("vigencia_id", vigenciaId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getTasks(vigenciaId, vigenciaConsejeriaId = "") {
  if (!vigenciaId) return [];
  const supabase = requireSupabase();
  let query = supabase
    .from("compromisos_tareas")
    .select("*")
    .eq("vigencia_id", vigenciaId)
    .order("fecha_limite", { ascending: true, nullsFirst: false })
    .order("creado_en", { ascending: false });
  if (vigenciaConsejeriaId) query = query.eq("vigencia_consejeria_id", vigenciaConsejeriaId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadOperationalData(vigenciaId, vigenciaConsejeriaId = "") {
  const allConsejerias = await getConsejerias(vigenciaId);
  const consejerias = vigenciaConsejeriaId
    ? allConsejerias.filter((row) => row.id === vigenciaConsejeriaId)
    : allConsejerias;

  const vcIds = consejerias.map((row) => row.id);
  const lineas = await getRowsIn(
    "lineas_accion",
    "vigencia_consejeria_id",
    vcIds,
    "id,vigencia_consejeria_id,nombre,nombre_corto,estado,orden"
  );
  const lineaIds = lineas.map((row) => row.id);
  const programas = await getRowsIn(
    "programas",
    "linea_accion_id",
    lineaIds,
    "id,linea_accion_id,nombre,nombre_corto,estado,orden"
  );
  const programIds = programas.map((row) => row.id);
  const proyectos = await getRowsIn(
    "proyectos",
    "programa_id",
    programIds,
    "id,programa_id,codigo,nombre,nombre_corto,estado,ponderacion,fecha_inicio,fecha_fin,responsable,orden"
  );
  const projectIds = proyectos.map((row) => row.id);
  const actividades = await getRowsIn(
    "actividades",
    "proyecto_id",
    projectIds,
    "id,proyecto_id,codigo,nombre,estado,responsable,fecha_inicio,fecha_fin,orden"
  );
  const activityIds = actividades.map((row) => row.id);
  const [indicadores, presupuestos, evidencias, tasks] = await Promise.all([
    getRowsIn(
      "indicadores_actividad",
      "actividad_id",
      activityIds,
      "id,actividad_id,codigo,nombre,estado,linea_base,meta,valor_actual,sentido,unidad_medida,orden"
    ),
    getRowsIn(
      "presupuesto_actividad_rubros",
      "actividad_id",
      activityIds,
      "id,actividad_id,rubro,programado,ejecutado,estado"
    ),
    getRowsIn(
      "evidencias_actividad",
      "actividad_id",
      activityIds,
      "id,actividad_id,nombre,estado,fecha"
    ),
    getTasks(vigenciaId, vigenciaConsejeriaId)
  ]);

  return {
    allConsejerias,
    consejerias,
    lineas,
    programas,
    proyectos,
    actividades,
    indicadores,
    presupuestos,
    evidencias,
    tasks
  };
}

function consejeriaName(vc) {
  return vc?.consejerias?.nombre_corto || vc?.consejerias?.nombre_largo || "Consejería";
}

function makeHierarchyMaps(data) {
  const vcById = new Map(data.consejerias.map((row) => [row.id, row]));
  const lineById = new Map(data.lineas.map((row) => [row.id, row]));
  const programById = new Map(data.programas.map((row) => [row.id, row]));
  const projectById = new Map(data.proyectos.map((row) => [row.id, row]));
  const activityById = new Map(data.actividades.map((row) => [row.id, row]));

  function contextForProgram(program) {
    const line = lineById.get(program?.linea_accion_id);
    const vc = vcById.get(line?.vigencia_consejeria_id);
    return { vc, line, program };
  }

  function contextForProject(project) {
    const program = programById.get(project?.programa_id);
    return { ...contextForProgram(program), project };
  }

  function contextForActivity(activity) {
    const project = projectById.get(activity?.proyecto_id);
    return { ...contextForProject(project), activity };
  }

  return { vcById, lineById, programById, projectById, activityById, contextForProgram, contextForProject, contextForActivity };
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

function routeText(vigenciaName, ctx, tail = null) {
  return [
    vigenciaName,
    ctx.vc ? consejeriaName(ctx.vc) : null,
    ctx.line?.nombre,
    ctx.program?.nombre,
    ctx.project?.nombre,
    ctx.activity?.nombre,
    tail
  ].filter(Boolean).join(" › ");
}

function buildAlerts(vigencia, data) {
  const alerts = [];
  const maps = makeHierarchyMaps(data);
  const activeVcIds = new Set(data.consejerias.filter((row) => row.estado === "activa").map((row) => row.id));
  const activeLines = data.lineas.filter((row) => row.estado === "activa" && activeVcIds.has(row.vigencia_consejeria_id));
  const activeLineIds = new Set(activeLines.map((row) => row.id));
  const activePrograms = data.programas.filter((row) => row.estado === "activo" && activeLineIds.has(row.linea_accion_id));
  const activeProgramIds = new Set(activePrograms.map((row) => row.id));
  const planProjects = data.proyectos.filter((row) => activeProgramIds.has(row.programa_id));
  const projectIds = new Set(planProjects.map((row) => row.id));
  const planActivities = data.actividades.filter((row) => projectIds.has(row.proyecto_id) && row.estado !== "cancelada");
  const activityIds = new Set(planActivities.map((row) => row.id));
  const activeIndicators = data.indicadores.filter((row) => activityIds.has(row.actividad_id) && row.estado === "activo");

  const projectsByProgram = new Map();
  planProjects.forEach((project) => {
    if (!projectsByProgram.has(project.programa_id)) projectsByProgram.set(project.programa_id, []);
    projectsByProgram.get(project.programa_id).push(project);
  });

  const activitiesByProject = new Map();
  planActivities.forEach((activity) => {
    if (!activitiesByProject.has(activity.proyecto_id)) activitiesByProject.set(activity.proyecto_id, []);
    activitiesByProject.get(activity.proyecto_id).push(activity);
  });

  const indicatorsByActivity = new Map();
  activeIndicators.forEach((indicator) => {
    if (!indicatorsByActivity.has(indicator.actividad_id)) indicatorsByActivity.set(indicator.actividad_id, []);
    indicatorsByActivity.get(indicator.actividad_id).push(indicator);
  });

  const evidenceCountByActivity = new Map();
  data.evidencias
    .filter((row) => row.estado === "activa" && activityIds.has(row.actividad_id))
    .forEach((row) => evidenceCountByActivity.set(row.actividad_id, Number(evidenceCountByActivity.get(row.actividad_id) || 0) + 1));

  const budgetByProject = new Map();
  data.presupuestos.filter((row) => row.estado === "activo").forEach((row) => {
    const activity = maps.activityById.get(row.actividad_id);
    if (!activity || !projectIds.has(activity.proyecto_id)) return;
    const current = budgetByProject.get(activity.proyecto_id) || { programmed: 0, executed: 0 };
    current.programmed += Number(row.programado || 0);
    current.executed += Number(row.ejecutado || 0);
    budgetByProject.set(activity.proyecto_id, current);
  });

  const activityProgress = new Map();
  planActivities.forEach((activity) => {
    activityProgress.set(activity.id, calculateActivityProgress(indicatorsByActivity.get(activity.id) || []));
  });

  activePrograms.forEach((program) => {
    const ctx = maps.contextForProgram(program);
    const projects = projectsByProgram.get(program.id) || [];
    const route = routeText(vigencia.nombre, ctx);

    if (!projects.length) {
      alerts.push({
        key: `programa_sin_proyectos:${program.id}`,
        type: "programa_sin_proyectos",
        severity: "media",
        title: "Programa activo sin Proyectos",
        description: `El Programa “${program.nombre}” no tiene Proyectos registrados.`,
        vigenciaConsejeriaId: ctx.vc?.id || null,
        entityType: "programa",
        entityId: program.id,
        entityName: program.nombre,
        route,
        navigation: projectNavigation(vigencia.id, ctx)
      });
      return;
    }

    const totalWeight = projects.reduce((sum, project) => sum + Number(project.ponderacion || 0), 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      alerts.push({
        key: `ponderacion_incompleta:${program.id}`,
        type: "ponderacion_incompleta",
        severity: "alta",
        title: "La ponderación del Programa no suma 100 %",
        description: `La suma actual es ${formatPercent(totalWeight)}. Revisa y aprueba la ponderación de sus Proyectos.`,
        vigenciaConsejeriaId: ctx.vc?.id || null,
        entityType: "programa",
        entityId: program.id,
        entityName: program.nombre,
        route,
        navigation: {
          view: "ponderaciones",
          vigencia_id: vigencia.id,
          vigencia_consejeria_id: ctx.vc?.id || null,
          programa_id: program.id
        }
      });
    }
  });

  planProjects.forEach((project) => {
    const ctx = maps.contextForProject(project);
    const activities = activitiesByProject.get(project.id) || [];
    const route = routeText(vigencia.nombre, ctx);

    if (!activities.length && project.estado !== "cerrado") {
      alerts.push({
        key: `proyecto_sin_actividades:${project.id}`,
        type: "proyecto_sin_actividades",
        severity: "media",
        title: "Proyecto sin Actividades",
        description: `El Proyecto “${project.nombre}” todavía no tiene Actividades que permitan ejecutar y medir su objetivo.`,
        vigenciaConsejeriaId: ctx.vc?.id || null,
        entityType: "proyecto",
        entityId: project.id,
        entityName: project.nombre,
        route,
        navigation: projectNavigation(vigencia.id, ctx, { project_tab: "actividades" })
      });
      return;
    }

    const weights = equalWeights(activities);
    let accredited = 0;
    let coverage = 0;
    activities.forEach((activity) => {
      const progress = activityProgress.get(activity.id);
      const weight = Number(weights.get(activity.id) || 0);
      if (progress !== null) {
        accredited += progress * weight / 100;
        coverage += weight;
      }
    });

    const budget = budgetByProject.get(project.id);
    const budgetExecution = budget?.programmed > 0 ? clamp((budget.executed / budget.programmed) * 100) : null;
    const technicalProgress = activities.length && coverage >= 99.999 ? clamp(accredited) : null;

    if (
      project.estado !== "cerrado" &&
      technicalProgress !== null &&
      budgetExecution !== null &&
      Math.abs(technicalProgress - budgetExecution) >= 30
    ) {
      alerts.push({
        key: `desfase_presupuestal:${project.id}`,
        type: "desfase_presupuestal",
        severity: "baja",
        title: "Diferencia amplia entre avance técnico y ejecución presupuestal",
        description: `Avance técnico ${formatPercent(technicalProgress)} y ejecución presupuestal ${formatPercent(budgetExecution)} (${formatMoney(budget.executed)} ejecutado). Conviene revisar la explicación de la diferencia.`,
        vigenciaConsejeriaId: ctx.vc?.id || null,
        entityType: "proyecto",
        entityId: project.id,
        entityName: project.nombre,
        route,
        navigation: projectNavigation(vigencia.id, ctx, { project_tab: "seguimiento" })
      });
    }
  });

  planActivities.forEach((activity) => {
    const ctx = maps.contextForActivity(activity);
    const progress = activityProgress.get(activity.id);
    const route = routeText(vigencia.nombre, ctx);
    const days = daysBetweenToday(activity.fecha_fin);
    const completed = activity.estado === "completada" || (progress !== null && progress >= 99.999);

    if (!completed && days !== null && days < 0) {
      alerts.push({
        key: `actividad_vencida:${activity.id}`,
        type: "actividad_vencida",
        severity: "alta",
        title: "Actividad vencida con cumplimiento pendiente",
        description: `La Actividad finalizó el ${formatDate(activity.fecha_fin)} y registra ${progress === null ? "avance sin medición completa" : formatPercent(progress)}.`,
        vigenciaConsejeriaId: ctx.vc?.id || null,
        entityType: "actividad",
        entityId: activity.id,
        entityName: activity.nombre,
        route,
        navigation: projectNavigation(vigencia.id, ctx, {
          project_tab: "actividades",
          actividad_id: activity.id,
          activity_tab: "seguimiento"
        })
      });
    } else if (!completed && days !== null && days >= 0 && days <= 15) {
      alerts.push({
        key: `actividad_proxima:${activity.id}`,
        type: "actividad_proxima",
        severity: "media",
        title: "Actividad próxima a su fecha de cierre",
        description: `Faltan ${days} día${days === 1 ? "" : "s"} para el cierre programado (${formatDate(activity.fecha_fin)}). Avance: ${progress === null ? "sin medición completa" : formatPercent(progress)}.`,
        vigenciaConsejeriaId: ctx.vc?.id || null,
        entityType: "actividad",
        entityId: activity.id,
        entityName: activity.nombre,
        route,
        navigation: projectNavigation(vigencia.id, ctx, {
          project_tab: "planeador",
          actividad_id: activity.id,
          activity_tab: "general"
        })
      });
    }

    if (progress !== null && progress > 0 && Number(evidenceCountByActivity.get(activity.id) || 0) === 0) {
      alerts.push({
        key: `avance_sin_evidencia:${activity.id}`,
        type: "avance_sin_evidencia",
        severity: "media",
        title: "Actividad con avance y sin Evidencias activas",
        description: `La Actividad acredita ${formatPercent(progress)}, pero todavía no tiene Evidencias activas registradas.`,
        vigenciaConsejeriaId: ctx.vc?.id || null,
        entityType: "actividad",
        entityId: activity.id,
        entityName: activity.nombre,
        route,
        navigation: projectNavigation(vigencia.id, ctx, {
          project_tab: "actividades",
          actividad_id: activity.id,
          activity_tab: "evidencias"
        })
      });
    }
  });

  activeIndicators.forEach((indicator) => {
    const activity = maps.activityById.get(indicator.actividad_id);
    if (!activity) return;
    const ctx = maps.contextForActivity(activity);
    const base = numericValue(indicator.linea_base);
    const meta = numericValue(indicator.meta);
    const current = numericValue(indicator.valor_actual);
    const route = routeText(vigencia.nombre, ctx, indicator.nombre);
    const common = {
      vigenciaConsejeriaId: ctx.vc?.id || null,
      entityType: "indicador",
      entityId: indicator.id,
      entityName: indicator.nombre,
      route,
      navigation: projectNavigation(vigencia.id, ctx, {
        project_tab: "actividades",
        actividad_id: activity.id,
        activity_tab: "indicadores"
      })
    };

    if (base !== null && meta !== null && Math.abs(meta - base) < 1e-12) {
      alerts.push({
        key: `indicador_invalido:${indicator.id}`,
        type: "indicador_invalido",
        severity: "alta",
        title: "Indicador con meta igual a la línea base",
        description: `El indicador “${indicator.nombre}” no puede calcular avance porque la meta y la línea base tienen el mismo valor.`,
        ...common
      });
    } else if (base === null || meta === null || current === null) {
      const missing = [
        base === null ? "línea base" : null,
        meta === null ? "meta" : null,
        current === null ? "valor alcanzado" : null
      ].filter(Boolean).join(", ");
      alerts.push({
        key: `indicador_sin_medicion:${indicator.id}`,
        type: "indicador_sin_medicion",
        severity: "media",
        title: "Indicador sin información suficiente para medir",
        description: `Falta registrar ${missing} en “${indicator.nombre}”.`,
        ...common
      });
    }
  });

  data.tasks
    .filter((task) => !["completada", "cancelada"].includes(task.estado))
    .forEach((task) => {
      const days = daysBetweenToday(task.fecha_limite);
      if (days === null) return;
      const common = {
        vigenciaConsejeriaId: task.vigencia_consejeria_id || null,
        entityType: "compromiso",
        entityId: task.id,
        entityName: task.titulo,
        route: task.ruta || vigencia.nombre,
        navigation: task.navigation || {},
        taskId: task.id
      };
      if (days < 0) {
        alerts.push({
          key: `compromiso_vencido:${task.id}`,
          type: "compromiso_vencido",
          severity: "alta",
          title: "Compromiso vencido",
          description: `“${task.titulo}” tenía fecha límite ${formatDate(task.fecha_limite)}.`,
          ...common
        });
      } else if (days <= 3) {
        alerts.push({
          key: `compromiso_proximo:${task.id}`,
          type: "compromiso_proximo",
          severity: "media",
          title: "Compromiso próximo a vencer",
          description: `“${task.titulo}” vence ${days === 0 ? "hoy" : `en ${days} día${days === 1 ? "" : "s"}`}.`,
          ...common
        });
      }
    });

  const severityOrder = { alta: 0, media: 1, baja: 2 };
  alerts.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || a.title.localeCompare(b.title, "es"));
  return alerts;
}

function summarize(alerts, tasks) {
  const openTasks = tasks.filter((task) => !["completada", "cancelada"].includes(task.estado));
  const overdueTasks = openTasks.filter((task) => {
    const days = daysBetweenToday(task.fecha_limite);
    return days !== null && days < 0;
  });
  return {
    total: alerts.length,
    altas: alerts.filter((item) => item.severity === "alta").length,
    medias: alerts.filter((item) => item.severity === "media").length,
    bajas: alerts.filter((item) => item.severity === "baja").length,
    tareasAbiertas: openTasks.length,
    tareasVencidas: overdueTasks.length
  };
}

export function updateAlertsNavBadge(count = 0) {
  const badge = document.querySelector("#alertsNavBadge");
  if (!badge) return;
  const value = Number(count || 0);
  badge.textContent = value > 99 ? "99+" : String(value);
  badge.classList.toggle("hidden", value <= 0);
}

export async function loadAlertSummary(vigenciaId) {
  if (!vigenciaId) {
    updateAlertsNavBadge(0);
    return { total: 0, altas: 0, medias: 0, bajas: 0, tareasAbiertas: 0, tareasVencidas: 0 };
  }
  const vigencias = await getVigencias();
  const vigencia = vigencias.find((row) => row.id === vigenciaId);
  if (!vigencia) return { total: 0, altas: 0, medias: 0, bajas: 0, tareasAbiertas: 0, tareasVencidas: 0 };
  const data = await loadOperationalData(vigenciaId);
  const alerts = buildAlerts(vigencia, data);
  const summary = summarize(alerts, data.tasks);
  updateAlertsNavBadge(summary.total);
  return summary;
}

async function listResponsibles(vigenciaId, vigenciaConsejeriaId = null) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("listar_responsables_tareas", {
    p_vigencia_id: vigenciaId,
    p_vigencia_consejeria_id: vigenciaConsejeriaId || null
  });
  if (error) throw error;
  return data || [];
}

async function insertTask(payload) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("compromisos_tareas").insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function updateTask(record, payload) {
  return updateWithVersion({
    table: "compromisos_tareas",
    record,
    payload,
    entityType: "Compromiso",
    entityName: record?.titulo || null,
    vigenciaId: record?.vigencia_id || null,
    vigenciaConsejeriaId: record?.vigencia_consejeria_id || null
  });
}

function normalizeNavigation(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export async function renderAlertasTareas(container, navigationTarget = null, options = {}) {
  const onNavigate = typeof options.onNavigate === "function" ? options.onNavigate : async () => {};
  const profile = getCurrentProfile();
  const readOnly = isReadOnlyUser();
  const globalWriter = canManageGlobalStructure();

  let vigencias = [];
  let consejerias = [];
  let selectedVigenciaId = "";
  let selectedVcId = "";
  let currentTab = navigationTarget?.tab === "compromisos" ? "compromisos" : "alertas";
  let currentAlertSeverity = "todas";
  let currentAlertType = "";
  let currentTaskStatus = "abiertas";
  let onlyMine = false;
  let data = null;
  let alerts = [];
  let summary = null;

  container.innerHTML = `
    <section class="hero-panel alerts-hero">
      <div>
        <p class="eyebrow" style="color:var(--onic-cream-300)">Seguimiento operativo</p>
        <h2>Centro de alertas y compromisos</h2>
        <p>Identifica situaciones que requieren atención y conviértelas en compromisos con responsable y fecha límite.</p>
      </div>
      <div class="alerts-hero-actions">
        <button id="refreshAlertsButton" class="btn btn-light" type="button">Actualizar</button>
        ${readOnly ? "" : `<button id="newCommitmentButton" class="btn btn-light" type="button">+ Nuevo compromiso</button>`}
      </div>
    </section>

    <section class="panel alerts-context-panel">
      <div class="alerts-context-grid">
        <div class="form-field">
          <label for="alertsVigenciaSelector">Vigencia</label>
          <select id="alertsVigenciaSelector"><option value="">Cargando…</option></select>
        </div>
        <div class="form-field">
          <label for="alertsConsejeriaSelector">Consejería</label>
          <select id="alertsConsejeriaSelector" disabled><option value="">Todas las autorizadas</option></select>
        </div>
      </div>
    </section>

    <section id="alertsSummary" class="alerts-summary-grid">
      <div class="empty-state">Cargando alertas…</div>
    </section>

    <nav class="alerts-tabs" aria-label="Centro de seguimiento">
      <button type="button" data-alerts-tab="alertas" class="${currentTab === "alertas" ? "active" : ""}">Alertas <span id="alertsTabCount">0</span></button>
      <button type="button" data-alerts-tab="compromisos" class="${currentTab === "compromisos" ? "active" : ""}">Compromisos <span id="tasksTabCount">0</span></button>
    </nav>

    <section id="alertsBody" class="panel alerts-main-panel">
      <div class="empty-state">Cargando…</div>
    </section>
  `;

  const vigenciaSelector = container.querySelector("#alertsVigenciaSelector");
  const consejeriaSelector = container.querySelector("#alertsConsejeriaSelector");
  const summaryHost = container.querySelector("#alertsSummary");
  const body = container.querySelector("#alertsBody");

  function currentVigencia() {
    return vigencias.find((row) => row.id === selectedVigenciaId);
  }

  function currentConsejeria() {
    return consejerias.find((row) => row.id === selectedVcId);
  }

  function setContext() {
    const vigencia = currentVigencia();
    const vc = currentConsejeria();
    if (!vigencia) return;
    setAuditContext({
      vigenciaId: vigencia.id,
      vigenciaNombre: vigencia.nombre,
      entidadTipo: vc ? "consejeria" : "vigencia",
      entidadId: vc?.id || vigencia.id,
      entidadNombre: vc ? consejeriaName(vc) : vigencia.nombre,
      seccion: "alertas",
      ruta: vc ? `${vigencia.nombre} › ${consejeriaName(vc)} › Alertas y compromisos` : `${vigencia.nombre} › Alertas y compromisos`,
      navigation: {
        view: "alertas",
        vigencia_id: vigencia.id,
        vigencia_consejeria_id: vc?.id || null,
        tab: currentTab
      },
      sectionOptions: [
        { value: "alertas", label: "Alertas", navigation: { view: "alertas", tab: "alertas" } },
        { value: "compromisos", label: "Compromisos", navigation: { view: "alertas", tab: "compromisos" } }
      ]
    });
  }

  function renderSummary() {
    summaryHost.innerHTML = `
      <article class="alert-summary-card high"><span>Urgentes</span><strong>${summary?.altas || 0}</strong><small>Requieren revisión prioritaria</small></article>
      <article class="alert-summary-card medium"><span>Atención</span><strong>${summary?.medias || 0}</strong><small>Situaciones por gestionar</small></article>
      <article class="alert-summary-card low"><span>Informativas</span><strong>${summary?.bajas || 0}</strong><small>Conviene revisar</small></article>
      <article class="alert-summary-card tasks"><span>Compromisos abiertos</span><strong>${summary?.tareasAbiertas || 0}</strong><small>${summary?.tareasVencidas ? `${summary.tareasVencidas} vencido${summary.tareasVencidas === 1 ? "" : "s"}` : "Sin vencidos"}</small></article>
    `;
    container.querySelector("#alertsTabCount").textContent = String(summary?.total || 0);
    container.querySelector("#tasksTabCount").textContent = String(summary?.tareasAbiertas || 0);
    updateAlertsNavBadge(summary?.total || 0);
  }

  function openAlertTask(alert) {
    openTaskForm({
      alert,
      scopeVcId: alert.vigenciaConsejeriaId || "",
      title: alert.title,
      description: alert.description,
      priority: alert.severity === "alta" ? "alta" : alert.severity === "baja" ? "baja" : "media",
      dueDate: addDaysISO(alert.severity === "alta" ? 5 : 10)
    });
  }

  async function openTaskForm({
    record = null,
    alert = null,
    scopeVcId = "",
    title = "",
    description = "",
    priority = "media",
    dueDate = ""
  } = {}) {
    const vigencia = currentVigencia();
    if (!vigencia || readOnly) return;

    let selectedScope = record?.vigencia_consejeria_id || scopeVcId || "";
    if (!globalWriter && !selectedScope) selectedScope = consejerias[0]?.id || "";

    const scopeOptions = [
      ...(globalWriter ? [{ id: "", label: "General de la Vigencia" }] : []),
      ...consejerias.map((vc) => ({ id: vc.id, label: consejeriaName(vc) }))
    ];

    openModal({
      title: record ? "Editar compromiso" : "Nuevo compromiso",
      content: `
        <form id="commitmentForm" class="workspace-form-page compact-modal-form">
          <div class="workspace-form-grid">
            <div class="form-field full">
              <label>Ámbito</label>
              <select id="commitmentScope" name="scope" ${record ? "disabled" : ""}>
                ${scopeOptions.map((item) => option(item.id, item.label, item.id === selectedScope)).join("")}
              </select>
              ${record ? `<small class="field-help">El ámbito se conserva para mantener la referencia histórica.</small>` : ""}
            </div>
            <div class="form-field full"><label>Título</label><input name="titulo" required maxlength="220" value="${escapeHTML(record?.titulo || title)}"></div>
            <div class="form-field full"><label>Descripción / acción esperada</label><textarea name="descripcion" rows="4">${escapeHTML(record?.descripcion || description)}</textarea></div>
            <div class="form-field">
              <label>Responsable</label>
              <select id="commitmentResponsible" name="responsable_usuario_id"><option value="">Cargando…</option></select>
            </div>
            <div class="form-field"><label>Fecha límite</label><input name="fecha_limite" type="date" value="${escapeHTML(record?.fecha_limite || dueDate)}"></div>
            <div class="form-field"><label>Prioridad</label><select name="prioridad">${option("alta", "Alta", (record?.prioridad || priority) === "alta")}${option("media", "Media", (record?.prioridad || priority) === "media")}${option("baja", "Baja", (record?.prioridad || priority) === "baja")}</select></div>
            ${record ? `<div class="form-field"><label>Estado</label><select name="estado">${option("pendiente", "Pendiente", record.estado === "pendiente")}${option("en_proceso", "En proceso", record.estado === "en_proceso")}${option("completada", "Completada", record.estado === "completada")}${option("cancelada", "Cancelada", record.estado === "cancelada")}</select></div>` : ""}
          </div>
          ${alert ? `<div class="task-origin-note"><strong>Origen:</strong> ${escapeHTML(alertTypeLabel(alert.type))}<span>${escapeHTML(alert.route || "")}</span></div>` : ""}
          <p id="commitmentFormMessage" class="form-message"></p>
          <div class="form-actions"><button id="cancelCommitmentForm" class="btn btn-secondary" type="button">Cancelar</button><button class="btn btn-primary" type="submit">${record ? "Guardar cambios" : "Crear compromiso"}</button></div>
        </form>
      `
    });

    const form = document.querySelector("#commitmentForm");
    const scope = document.querySelector("#commitmentScope");
    const responsible = document.querySelector("#commitmentResponsible");
    const message = document.querySelector("#commitmentFormMessage");
    document.querySelector("#cancelCommitmentForm")?.addEventListener("click", closeModal);

    async function refreshResponsibleOptions() {
      responsible.disabled = true;
      responsible.innerHTML = `<option value="">Cargando…</option>`;
      try {
        const rows = await listResponsibles(vigencia.id, scope.value || null);
        const selected = record?.responsable_usuario_id || profile?.id || "";
        responsible.innerHTML = `<option value="">Sin asignar</option>${rows.map((user) => option(user.id, user.nombre || user.email, user.id === selected)).join("")}`;
      } catch (error) {
        console.error(error);
        responsible.innerHTML = `<option value="">Sin asignar</option>`;
        message.textContent = "No fue posible cargar la lista de responsables.";
      } finally {
        responsible.disabled = false;
      }
    }

    scope?.addEventListener("change", refreshResponsibleOptions);
    await refreshResponsibleOptions();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      message.textContent = "";
      try {
        const values = new FormData(form);
        const vcId = record?.vigencia_consejeria_id || values.get("scope") || null;
        const vc = consejerias.find((item) => item.id === vcId);
        const payload = {
          vigencia_id: vigencia.id,
          vigencia_consejeria_id: vcId || null,
          titulo: String(values.get("titulo") || "").trim(),
          descripcion: String(values.get("descripcion") || "").trim() || null,
          responsable_usuario_id: values.get("responsable_usuario_id") || null,
          fecha_limite: values.get("fecha_limite") || null,
          prioridad: values.get("prioridad") || "media"
        };

        if (record) {
          payload.estado = values.get("estado") || record.estado;
          await updateTask(record, payload);
        } else if (alert) {
          Object.assign(payload, {
            entidad_tipo: alert.entityType || "vigencia",
            entidad_id: alert.entityId || null,
            entidad_nombre: alert.entityName || alert.title,
            ruta: alert.route || vigencia.nombre,
            navigation: alert.navigation || {},
            alerta_clave: alert.key || null
          });
          await insertTask(payload);
        } else {
          Object.assign(payload, {
            entidad_tipo: vc ? "consejeria" : "vigencia",
            entidad_id: vc?.id || vigencia.id,
            entidad_nombre: vc ? consejeriaName(vc) : vigencia.nombre,
            ruta: vc ? `${vigencia.nombre} › ${consejeriaName(vc)}` : vigencia.nombre,
            navigation: vc
              ? { view: "consejerias", vigencia_id: vigencia.id, vigencia_consejeria_id: vc.id }
              : { view: "inicio", vigencia_id: vigencia.id }
          });
          await insertTask(payload);
        }

        closeModal();
        currentTab = "compromisos";
        await refreshData();
      } catch (error) {
        console.error(error);
        message.textContent = error.message || "No fue posible guardar el compromiso.";
        submit.disabled = false;
      }
    });
  }

  function openCompleteTask(task) {
    if (readOnly) return;
    openModal({
      title: "Completar compromiso",
      content: `
        <form id="completeTaskForm" class="compact-modal-form">
          <div class="task-complete-intro"><strong>${escapeHTML(task.titulo)}</strong><p>Registra brevemente el resultado o la acción realizada antes de completar el compromiso.</p></div>
          <div class="form-field"><label>Resultado / cierre</label><textarea name="resultado" rows="5" required>${escapeHTML(task.resultado_cierre || "")}</textarea></div>
          <p id="completeTaskMessage" class="form-message"></p>
          <div class="form-actions"><button id="cancelCompleteTask" class="btn btn-secondary" type="button">Cancelar</button><button class="btn btn-primary" type="submit">Marcar completado</button></div>
        </form>`
    });
    document.querySelector("#cancelCompleteTask")?.addEventListener("click", closeModal);
    document.querySelector("#completeTaskForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('button[type="submit"]');
      const message = form.querySelector("#completeTaskMessage");
      submit.disabled = true;
      try {
        const values = new FormData(form);
        await updateTask(task, {
          estado: "completada",
          resultado_cierre: String(values.get("resultado") || "").trim()
        });
        closeModal();
        await refreshData();
      } catch (error) {
        console.error(error);
        message.textContent = error.message || "No fue posible completar el compromiso.";
        submit.disabled = false;
      }
    });
  }

  async function quickTaskState(task, estado) {
    if (readOnly) return;
    try {
      await updateTask(task, { estado });
      await refreshData();
    } catch (error) {
      console.error(error);
      alert(error.message || "No fue posible actualizar el compromiso.");
    }
  }

  function goToReference(item) {
    const navigation = normalizeNavigation(item.navigation);
    if (navigation?.view) onNavigate(navigation.view, navigation);
  }

  function renderAlerts() {
    const types = [...new Set(alerts.map((item) => item.type))].sort((a, b) => alertTypeLabel(a).localeCompare(alertTypeLabel(b), "es"));
    const filtered = alerts.filter((item) => {
      if (currentAlertSeverity !== "todas" && item.severity !== currentAlertSeverity) return false;
      if (currentAlertType && item.type !== currentAlertType) return false;
      return true;
    });
    const activeTaskByAlert = new Map(
      data.tasks
        .filter((task) => task.alerta_clave && !["completada", "cancelada"].includes(task.estado))
        .map((task) => [task.alerta_clave, task])
    );

    body.innerHTML = `
      <div class="alerts-main-heading">
        <div><p class="eyebrow">Detección automática</p><h3>Alertas de seguimiento</h3><p class="muted">Las alertas desaparecen cuando se corrige la situación que las origina. No modifican por sí mismas la información del Plan.</p></div>
        <div class="alerts-filter-row">
          <select id="alertSeverityFilter">${option("todas", "Todas las prioridades", currentAlertSeverity === "todas")}${option("alta", "Urgentes", currentAlertSeverity === "alta")}${option("media", "Atención", currentAlertSeverity === "media")}${option("baja", "Informativas", currentAlertSeverity === "baja")}</select>
          <select id="alertTypeFilter"><option value="">Todos los tipos</option>${types.map((type) => option(type, alertTypeLabel(type), currentAlertType === type)).join("")}</select>
        </div>
      </div>
      ${filtered.length ? `<div class="alerts-list">${filtered.map((item) => {
        const meta = severityMeta(item.severity);
        const existingTask = activeTaskByAlert.get(item.key);
        return `
          <article class="alert-card ${meta.className}">
            <div class="alert-card-top"><span class="alert-severity ${meta.className}">${escapeHTML(meta.label)}</span><span class="alert-type">${escapeHTML(alertTypeLabel(item.type))}</span></div>
            <h4>${escapeHTML(item.title)}</h4>
            <p>${escapeHTML(item.description)}</p>
            <div class="alert-route">${escapeHTML(item.route || "")}</div>
            <div class="alert-card-actions">
              ${item.navigation?.view ? `<button class="text-button go-alert-reference" type="button" data-key="${escapeHTML(item.key)}">Ir a referencia →</button>` : ""}
              ${readOnly || item.taskId ? "" : existingTask
                ? `<button class="text-button show-alert-task" type="button" data-task-id="${existingTask.id}">Compromiso en curso</button>`
                : `<button class="btn btn-secondary create-alert-task" type="button" data-key="${escapeHTML(item.key)}">Crear compromiso</button>`}
              ${item.taskId ? `<button class="btn btn-secondary show-alert-task" type="button" data-task-id="${item.taskId}">Ver compromiso</button>` : ""}
            </div>
          </article>`;
      }).join("")}</div>` : `<div class="alerts-clear-state"><strong>No hay alertas con estos filtros.</strong><p>Si no existen alertas, la estructura consultada no presenta actualmente las situaciones automáticas que vigila este Centro.</p></div>`}
    `;

    body.querySelector("#alertSeverityFilter")?.addEventListener("change", (event) => { currentAlertSeverity = event.target.value; renderAlerts(); });
    body.querySelector("#alertTypeFilter")?.addEventListener("change", (event) => { currentAlertType = event.target.value; renderAlerts(); });
    body.querySelectorAll(".go-alert-reference").forEach((button) => button.addEventListener("click", () => {
      const item = alerts.find((alert) => alert.key === button.dataset.key);
      if (item) goToReference(item);
    }));
    body.querySelectorAll(".create-alert-task").forEach((button) => button.addEventListener("click", () => {
      const item = alerts.find((alert) => alert.key === button.dataset.key);
      if (item) openAlertTask(item);
    }));
    body.querySelectorAll(".show-alert-task").forEach((button) => button.addEventListener("click", () => {
      currentTab = "compromisos";
      renderCurrentTab();
      setTimeout(() => container.querySelector(`[data-task-card="${button.dataset.taskId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    }));
  }

  function taskDueClass(task) {
    if (["completada", "cancelada"].includes(task.estado)) return "";
    const days = daysBetweenToday(task.fecha_limite);
    if (days === null) return "";
    if (days < 0) return "overdue";
    if (days <= 3) return "due-soon";
    return "";
  }

  function taskDueText(task) {
    if (!task.fecha_limite) return "Sin fecha límite";
    if (["completada", "cancelada"].includes(task.estado)) return `Fecha límite: ${formatDate(task.fecha_limite)}`;
    const days = daysBetweenToday(task.fecha_limite);
    if (days === null) return `Fecha límite: ${formatDate(task.fecha_limite)}`;
    if (days < 0) return `Vencido hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}`;
    if (days === 0) return "Vence hoy";
    if (days <= 7) return `Vence en ${days} día${days === 1 ? "" : "s"}`;
    return `Fecha límite: ${formatDate(task.fecha_limite)}`;
  }

  function renderTasks() {
    const currentUser = profile?.id || "";
    const filtered = data.tasks.filter((task) => {
      if (currentTaskStatus === "abiertas" && ["completada", "cancelada"].includes(task.estado)) return false;
      if (currentTaskStatus !== "todas" && currentTaskStatus !== "abiertas" && task.estado !== currentTaskStatus) return false;
      if (onlyMine && task.responsable_usuario_id !== currentUser) return false;
      return true;
    });

    body.innerHTML = `
      <div class="alerts-main-heading">
        <div><p class="eyebrow">Gestión de compromisos</p><h3>Compromisos y tareas</h3><p class="muted">Asigna responsables y fechas límite. Completar un compromiso conserva su resultado en el Historial.</p></div>
        <div class="alerts-filter-row">
          <select id="taskStatusFilter">${option("abiertas", "Abiertas", currentTaskStatus === "abiertas")}${option("pendiente", "Pendientes", currentTaskStatus === "pendiente")}${option("en_proceso", "En proceso", currentTaskStatus === "en_proceso")}${option("completada", "Completadas", currentTaskStatus === "completada")}${option("cancelada", "Canceladas", currentTaskStatus === "cancelada")}${option("todas", "Todas", currentTaskStatus === "todas")}</select>
          <label class="alerts-mine-filter"><input id="onlyMyTasks" type="checkbox" ${onlyMine ? "checked" : ""}> <span>Solo asignadas a mí</span></label>
        </div>
      </div>
      ${filtered.length ? `<div class="tasks-list">${filtered.map((task) => {
        const status = taskStatusMeta(task.estado);
        const priority = priorityMeta(task.prioridad);
        const dueClass = taskDueClass(task);
        return `
          <article class="task-card ${dueClass}" data-task-card="${task.id}">
            <div class="task-card-head">
              <div><span class="task-status ${status.className}">${escapeHTML(status.label)}</span><span class="task-priority ${priority.className}">Prioridad ${escapeHTML(priority.label)}</span></div>
              <span class="task-due ${dueClass}">${escapeHTML(taskDueText(task))}</span>
            </div>
            <h4>${escapeHTML(task.titulo)}</h4>
            ${task.descripcion ? `<p>${escapeHTML(task.descripcion)}</p>` : ""}
            <div class="task-meta-grid">
              <div><span>Responsable</span><strong>${escapeHTML(task.responsable_nombre || task.responsable_email || "Sin asignar")}</strong></div>
              <div><span>Referencia</span><strong>${escapeHTML(task.entidad_nombre || "Vigencia")}</strong></div>
            </div>
            ${task.ruta ? `<div class="alert-route">${escapeHTML(task.ruta)}</div>` : ""}
            ${task.resultado_cierre ? `<div class="task-result"><span>Resultado / cierre</span><p>${escapeHTML(task.resultado_cierre)}</p></div>` : ""}
            <div class="task-card-actions">
              ${normalizeNavigation(task.navigation)?.view ? `<button class="text-button go-task-reference" type="button" data-id="${task.id}">Ir a referencia →</button>` : ""}
              ${readOnly ? "" : `<button class="text-button edit-task" type="button" data-id="${task.id}">Editar</button>`}
              ${readOnly || task.estado !== "pendiente" ? "" : `<button class="btn btn-secondary start-task" type="button" data-id="${task.id}">Iniciar</button>`}
              ${readOnly || !["pendiente", "en_proceso"].includes(task.estado) ? "" : `<button class="btn btn-primary complete-task" type="button" data-id="${task.id}">Completar</button>`}
              ${readOnly || !["pendiente", "en_proceso"].includes(task.estado) ? "" : `<button class="text-button cancel-task" type="button" data-id="${task.id}">Cancelar</button>`}
              ${readOnly || !["completada", "cancelada"].includes(task.estado) ? "" : `<button class="text-button reopen-task" type="button" data-id="${task.id}">Reabrir</button>`}
            </div>
          </article>`;
      }).join("")}</div>` : `<div class="alerts-clear-state"><strong>No hay compromisos con estos filtros.</strong><p>Puedes crear uno manualmente o convertir una Alerta en un compromiso de seguimiento.</p></div>`}
    `;

    body.querySelector("#taskStatusFilter")?.addEventListener("change", (event) => { currentTaskStatus = event.target.value; renderTasks(); });
    body.querySelector("#onlyMyTasks")?.addEventListener("change", (event) => { onlyMine = event.target.checked; renderTasks(); });
    body.querySelectorAll(".go-task-reference").forEach((button) => button.addEventListener("click", () => {
      const task = data.tasks.find((item) => item.id === button.dataset.id);
      if (task) goToReference(task);
    }));
    body.querySelectorAll(".edit-task").forEach((button) => button.addEventListener("click", () => {
      const task = data.tasks.find((item) => item.id === button.dataset.id);
      if (task) openTaskForm({ record: task });
    }));
    body.querySelectorAll(".start-task").forEach((button) => button.addEventListener("click", () => {
      const task = data.tasks.find((item) => item.id === button.dataset.id);
      if (task) quickTaskState(task, "en_proceso");
    }));
    body.querySelectorAll(".complete-task").forEach((button) => button.addEventListener("click", () => {
      const task = data.tasks.find((item) => item.id === button.dataset.id);
      if (task) openCompleteTask(task);
    }));
    body.querySelectorAll(".cancel-task").forEach((button) => button.addEventListener("click", async () => {
      const task = data.tasks.find((item) => item.id === button.dataset.id);
      if (task && window.confirm(`¿Cancelar el compromiso “${task.titulo}”?`)) await quickTaskState(task, "cancelada");
    }));
    body.querySelectorAll(".reopen-task").forEach((button) => button.addEventListener("click", () => {
      const task = data.tasks.find((item) => item.id === button.dataset.id);
      if (task) quickTaskState(task, "en_proceso");
    }));
  }

  function renderCurrentTab() {
    container.querySelectorAll("[data-alerts-tab]").forEach((button) => button.classList.toggle("active", button.dataset.alertsTab === currentTab));
    setContext();
    if (currentTab === "compromisos") renderTasks(); else renderAlerts();
  }

  async function refreshData() {
    const vigencia = currentVigencia();
    if (!vigencia) {
      summaryHost.innerHTML = `<div class="empty-state">Selecciona una Vigencia.</div>`;
      body.innerHTML = `<div class="empty-state">Selecciona una Vigencia.</div>`;
      updateAlertsNavBadge(0);
      return;
    }

    summaryHost.innerHTML = `<div class="empty-state">Actualizando alertas…</div>`;
    body.innerHTML = `<div class="empty-state">Cargando información…</div>`;
    try {
      data = await loadOperationalData(vigencia.id, selectedVcId);
      alerts = buildAlerts(vigencia, data);
      summary = summarize(alerts, data.tasks);
      renderSummary();
      renderCurrentTab();
    } catch (error) {
      console.error(error);
      summaryHost.innerHTML = `<div class="empty-state"><strong>No fue posible cargar el Centro.</strong><p>${escapeHTML(error.message || "Intenta nuevamente.")}</p></div>`;
      body.innerHTML = `<div class="empty-state">No fue posible cargar las alertas y compromisos.</div>`;
    }
  }

  async function loadConsejeriaSelector() {
    consejerias = await getConsejerias(selectedVigenciaId);
    if (navigationTarget?.vigencia_consejeria_id && consejerias.some((row) => row.id === navigationTarget.vigencia_consejeria_id)) {
      selectedVcId = navigationTarget.vigencia_consejeria_id;
    } else if (selectedVcId && !consejerias.some((row) => row.id === selectedVcId)) {
      selectedVcId = "";
    }
    consejeriaSelector.innerHTML = `<option value="">Todas las autorizadas</option>${consejerias.map((vc) => option(vc.id, consejeriaName(vc), vc.id === selectedVcId)).join("")}`;
    consejeriaSelector.disabled = !consejerias.length;
    consejeriaSelector.value = selectedVcId;
    await refreshData();
  }

  container.querySelectorAll("[data-alerts-tab]").forEach((button) => button.addEventListener("click", () => {
    currentTab = button.dataset.alertsTab;
    renderCurrentTab();
  }));
  container.querySelector("#refreshAlertsButton")?.addEventListener("click", refreshData);
  container.querySelector("#newCommitmentButton")?.addEventListener("click", () => openTaskForm());

  vigenciaSelector.addEventListener("change", async () => {
    selectedVigenciaId = vigenciaSelector.value;
    selectedVcId = "";
    navigationTarget = null;
    await loadConsejeriaSelector();
  });
  consejeriaSelector.addEventListener("change", async () => {
    selectedVcId = consejeriaSelector.value;
    navigationTarget = null;
    await refreshData();
  });

  try {
    vigencias = await getVigencias();
    if (!vigencias.length) {
      vigenciaSelector.innerHTML = `<option value="">No hay Vigencias disponibles</option>`;
      consejeriaSelector.disabled = true;
      summaryHost.innerHTML = `<div class="empty-state">Todavía no hay Vigencias disponibles.</div>`;
      body.innerHTML = "";
      return;
    }

    selectedVigenciaId = navigationTarget?.vigencia_id && vigencias.some((row) => row.id === navigationTarget.vigencia_id)
      ? navigationTarget.vigencia_id
      : vigencias[0].id;

    vigenciaSelector.innerHTML = vigencias.map((vigencia) => option(vigencia.id, vigencia.nombre, vigencia.id === selectedVigenciaId)).join("");
    vigenciaSelector.value = selectedVigenciaId;
    await loadConsejeriaSelector();
  } catch (error) {
    console.error(error);
    body.innerHTML = `<div class="empty-state"><strong>No fue posible iniciar el Centro de alertas.</strong><p>${escapeHTML(error.message || "Intenta nuevamente.")}</p></div>`;
  }
}
