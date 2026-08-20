import { requireSupabase } from "../supabaseClient.js";
import { setAuditContext } from "./auditoria.js";
import { openDocumentReportDialog, documentReportIcon } from "./documentReports.js";
import { loadOfficialTrackingSeries, renderTrackingChart } from "./cortesSeguimiento.js?v=0.13.1";
import { loadAlertSummary, updateAlertsNavBadge } from "./alertasTareas.js?v=0.14.0";

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

function formatPercent(value) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {
    return "—";
  }

  return `${Number(value).toFixed(2).replace(".", ",")} %`;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return escapeHTML(value);
  }

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function equalWeights(items = []) {
  const map = new Map();

  items.forEach((item) => {
    map.set(item.id, 0);
  });

  if (!items.length) {
    return map;
  }

  const totalUnits = 10000;
  const baseUnits = Math.floor(totalUnits / items.length);
  const remainder =
    totalUnits - baseUnits * items.length;

  items.forEach((item, index) => {
    const units =
      baseUnits + (index < remainder ? 1 : 0);

    map.set(item.id, units / 100);
  });

  return map;
}

function calculateIndicatorProgress(indicator) {
  if (
    !indicator ||
    indicator.estado !== "activo"
  ) {
    return null;
  }

  const base = Number(indicator.linea_base);
  const meta = Number(indicator.meta);
  const current = Number(indicator.valor_actual);

  if (
    ![base, meta, current].every(Number.isFinite)
  ) {
    return null;
  }

  let numerator;
  let denominator;

  if (indicator.sentido === "descendente") {
    numerator = base - current;
    denominator = base - meta;
  } else {
    numerator = current - base;
    denominator = meta - base;
  }

  if (Math.abs(denominator) < 1e-12) {
    return null;
  }

  return clamp(
    (numerator / denominator) * 100
  );
}

function calculateActivityProgress(indicators = []) {
  const active = indicators.filter(
    (indicator) => indicator.estado === "activo"
  );

  if (!active.length) {
    return null;
  }

  const values = active
    .map(calculateIndicatorProgress)
    .filter((value) => value !== null);

  if (values.length !== active.length) {
    return null;
  }

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function getProgressState(progress, coverage) {
  if (
    progress === null ||
    coverage <= 0
  ) {
    return {
      key: "no-data",
      label: "Sin medición",
      detail:
        "Todavía no hay indicadores suficientes para acreditar avance.",
      color: "#87918c"
    };
  }

  if (progress < 40) {
    return {
      key: "critical",
      label: "Avance bajo",
      detail:
        "El avance acreditado se encuentra por debajo del 40 %.",
      color: "#a30c22"
    };
  }

  if (progress < 70) {
    return {
      key: "attention",
      label: "En proceso",
      detail:
        "El avance acreditado está entre 40 % y 69,99 %.",
      color: "#b27a12"
    };
  }

  if (progress < 90) {
    return {
      key: "good",
      label: "Avance favorable",
      detail:
        "El avance acreditado está entre 70 % y 89,99 %.",
      color: "#4f7a45"
    };
  }

  return {
    key: "high",
    label: "Avance alto",
    detail:
      "El avance acreditado es igual o superior al 90 %.",
    color: "#0f4230"
  };
}

function dashboardIcon(type) {
  const icons = {
    consejerias: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3"></circle>
        <circle cx="17" cy="9" r="2"></circle>
        <path d="M3 20c0-4 2.7-6 6-6s6 2 6 6"></path>
        <path d="M15 15c3 0 5 1.7 5 5"></path>
      </svg>
    `,
    lineas: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="6" r="2"></circle>
        <circle cx="5" cy="18" r="2"></circle>
        <circle cx="19" cy="12" r="2"></circle>
        <path d="M7 6h4c3 0 4 2 4 4v2"></path>
        <path d="M7 18h4c3 0 4-2 4-4v-2"></path>
      </svg>
    `,
    programas: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2"></rect>
        <path d="M8 9h8"></path>
        <path d="M8 13h8"></path>
        <path d="M8 17h5"></path>
      </svg>
    `,
    proyectos: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4h14v16H5z"></path>
        <path d="M8 8h8"></path>
        <path d="M8 12h5"></path>
        <path d="M8 16h3"></path>
        <path d="M15 15l1.5 1.5L20 13"></path>
      </svg>
    `
  };

  return icons[type] || "";
}

/* ==========================================================
   CONSULTAS
   ========================================================== */

async function getVigencias() {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("vigencias")
    .select(
      "id,nombre,fecha_inicio,fecha_fin,lema,descripcion,estado"
    )
    .order("fecha_inicio", { ascending: false });

  if (error) throw error;
  return data || [];
}

async function getRowsIn(table, field, ids, columns = "*") {
  if (!ids.length) return [];

  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .in(field, ids);

  if (error) throw error;
  return data || [];
}

async function getDashboardData(vigenciaId) {
  const supabase = requireSupabase();

  const { data: consejerias, error: vcError } =
    await supabase
      .from("vigencia_consejerias")
      .select(
        "id,consejeria_id,estado,responsable,pueblo"
      )
      .eq("vigencia_id", vigenciaId);

  if (vcError) throw vcError;

  const vcRows = consejerias || [];
  const vcIds = vcRows.map((row) => row.id);

  const lineas = await getRowsIn(
    "lineas_accion",
    "vigencia_consejeria_id",
    vcIds,
    "id,vigencia_consejeria_id,nombre,estado,orden"
  );

  const lineIds = lineas.map((row) => row.id);

  const programas = await getRowsIn(
    "programas",
    "linea_accion_id",
    lineIds,
    "id,linea_accion_id,nombre,estado,orden"
  );

  const programIds = programas.map((row) => row.id);

  const proyectos = await getRowsIn(
    "proyectos",
    "programa_id",
    programIds,
    "id,programa_id,nombre,estado,ponderacion,orden"
  );

  const projectIds = proyectos.map((row) => row.id);

  const actividades = await getRowsIn(
    "actividades",
    "proyecto_id",
    projectIds,
    "id,proyecto_id,nombre,estado,orden"
  );

  const activityIds =
    actividades.map((row) => row.id);

  const indicadores = await getRowsIn(
    "indicadores_actividad",
    "actividad_id",
    activityIds,
    "id,actividad_id,linea_base,meta,valor_actual,sentido,estado,orden"
  );

  return {
    consejerias: vcRows,
    lineas,
    programas,
    proyectos,
    actividades,
    indicadores
  };
}

/* ==========================================================
   CÁLCULO JERÁRQUICO
   ========================================================== */

function calculateDashboardMetrics(data) {
  const {
    consejerias,
    lineas,
    programas,
    proyectos,
    actividades,
    indicadores
  } = data;

  const activeConsejerias =
    consejerias.filter(
      (item) => item.estado === "activa"
    );

  const activeConsejeriaIds =
    new Set(
      activeConsejerias.map((item) => item.id)
    );

  const activeLineas =
    lineas.filter(
      (item) =>
        item.estado === "activa" &&
        activeConsejeriaIds.has(
          item.vigencia_consejeria_id
        )
    );

  const activeLineIds =
    new Set(activeLineas.map((item) => item.id));

  const activeProgramas =
    programas.filter(
      (item) =>
        item.estado === "activo" &&
        activeLineIds.has(item.linea_accion_id)
    );

  const activeProgramIds =
    new Set(
      activeProgramas.map((item) => item.id)
    );

  /*
   * Los Proyectos se incluyen aunque estén en borrador, formulación,
   * suspendidos o cerrados, siempre que pertenezcan a un Programa activo.
   * Su ponderación manual determina su contribución.
   */
  const planProjects =
    proyectos.filter(
      (item) =>
        activeProgramIds.has(item.programa_id)
    );

  const projectIds =
    new Set(planProjects.map((item) => item.id));

  const planActivities =
    actividades.filter(
      (item) =>
        projectIds.has(item.proyecto_id) &&
        item.estado !== "cancelada"
    );

  const activityIds =
    new Set(
      planActivities.map((item) => item.id)
    );

  const planIndicators =
    indicadores.filter(
      (item) =>
        activityIds.has(item.actividad_id)
    );

  const indicatorsByActivity = new Map();

  planIndicators.forEach((indicator) => {
    if (
      !indicatorsByActivity.has(
        indicator.actividad_id
      )
    ) {
      indicatorsByActivity.set(
        indicator.actividad_id,
        []
      );
    }

    indicatorsByActivity
      .get(indicator.actividad_id)
      .push(indicator);
  });

  const activitiesByProject = new Map();

  planActivities.forEach((activity) => {
    if (
      !activitiesByProject.has(
        activity.proyecto_id
      )
    ) {
      activitiesByProject.set(
        activity.proyecto_id,
        []
      );
    }

    activitiesByProject
      .get(activity.proyecto_id)
      .push(activity);
  });

  const projectsByProgram = new Map();

  planProjects.forEach((project) => {
    if (!projectsByProgram.has(project.programa_id)) {
      projectsByProgram.set(
        project.programa_id,
        []
      );
    }

    projectsByProgram
      .get(project.programa_id)
      .push(project);
  });

  const programsByLine = new Map();

  activeProgramas.forEach((program) => {
    if (!programsByLine.has(program.linea_accion_id)) {
      programsByLine.set(
        program.linea_accion_id,
        []
      );
    }

    programsByLine
      .get(program.linea_accion_id)
      .push(program);
  });

  const linesByConsejeria = new Map();

  activeLineas.forEach((linea) => {
    if (
      !linesByConsejeria.has(
        linea.vigencia_consejeria_id
      )
    ) {
      linesByConsejeria.set(
        linea.vigencia_consejeria_id,
        []
      );
    }

    linesByConsejeria
      .get(linea.vigencia_consejeria_id)
      .push(linea);
  });

  /* Proyecto: actividades con peso automático. */
  const projectMetrics = new Map();

  planProjects.forEach((project) => {
    const projectActivities =
      activitiesByProject.get(project.id) || [];

    const activityWeights =
      equalWeights(projectActivities);

    let accreditedProgress = 0;
    let measurementCoverage = 0;

    projectActivities.forEach((activity) => {
      const progress =
        calculateActivityProgress(
          indicatorsByActivity.get(activity.id) || []
        );

      const weight =
        Number(
          activityWeights.get(activity.id) || 0
        );

      if (progress !== null) {
        accreditedProgress +=
          progress * weight / 100;

        measurementCoverage += weight;
      }
    });

    projectMetrics.set(
      project.id,
      {
        progress:
          projectActivities.length
            ? clamp(accreditedProgress)
            : 0,

        coverage:
          projectActivities.length
            ? clamp(measurementCoverage)
            : 0
      }
    );
  });

  /*
   * Programa:
   * La ponderación de sus Proyectos es la configurada manualmente.
   * No se renormaliza: si la suma no es 100 %, el tablero conserva
   * esa diferencia en lugar de ocultarla.
   */
  const programMetrics = new Map();

  activeProgramas.forEach((program) => {
    const programProjects =
      projectsByProgram.get(program.id) || [];

    let progress = 0;
    let coverage = 0;

    programProjects.forEach((project) => {
      const projectMetric =
        projectMetrics.get(project.id) || {
          progress: 0,
          coverage: 0
        };

      const projectWeight =
        Number(project.ponderacion || 0);

      progress +=
        projectMetric.progress *
        projectWeight /
        100;

      coverage +=
        projectMetric.coverage *
        projectWeight /
        100;
    });

    programMetrics.set(
      program.id,
      {
        progress: clamp(progress),
        coverage: clamp(coverage)
      }
    );
  });

  /* Línea: Programas activos con ponderación automática. */
  const lineMetrics = new Map();

  activeLineas.forEach((linea) => {
    const linePrograms =
      programsByLine.get(linea.id) || [];

    const weights =
      equalWeights(linePrograms);

    let progress = 0;
    let coverage = 0;

    linePrograms.forEach((program) => {
      const metric =
        programMetrics.get(program.id) || {
          progress: 0,
          coverage: 0
        };

      const weight =
        Number(weights.get(program.id) || 0);

      progress +=
        metric.progress * weight / 100;

      coverage +=
        metric.coverage * weight / 100;
    });

    lineMetrics.set(
      linea.id,
      {
        progress:
          linePrograms.length
            ? clamp(progress)
            : 0,

        coverage:
          linePrograms.length
            ? clamp(coverage)
            : 0
      }
    );
  });

  /* Consejería: Líneas activas con ponderación automática. */
  const consejeriaMetrics = new Map();

  activeConsejerias.forEach((vc) => {
    const vcLines =
      linesByConsejeria.get(vc.id) || [];

    const weights =
      equalWeights(vcLines);

    let progress = 0;
    let coverage = 0;

    vcLines.forEach((linea) => {
      const metric =
        lineMetrics.get(linea.id) || {
          progress: 0,
          coverage: 0
        };

      const weight =
        Number(weights.get(linea.id) || 0);

      progress +=
        metric.progress * weight / 100;

      coverage +=
        metric.coverage * weight / 100;
    });

    consejeriaMetrics.set(
      vc.id,
      {
        progress:
          vcLines.length
            ? clamp(progress)
            : 0,

        coverage:
          vcLines.length
            ? clamp(coverage)
            : 0
      }
    );
  });

  /* Vigencia: Consejerías activas con ponderación automática. */
  const consejeriaWeights =
    equalWeights(activeConsejerias);

  let vigenciaProgress = 0;
  let vigenciaCoverage = 0;

  activeConsejerias.forEach((vc) => {
    const metric =
      consejeriaMetrics.get(vc.id) || {
        progress: 0,
        coverage: 0
      };

    const weight =
      Number(
        consejeriaWeights.get(vc.id) || 0
      );

    vigenciaProgress +=
      metric.progress * weight / 100;

    vigenciaCoverage +=
      metric.coverage * weight / 100;
  });

  const hasHierarchy =
    activeConsejerias.length > 0;

  return {
    counts: {
      consejerias: consejerias.length,
      consejeriasActivas:
        activeConsejerias.length,

      lineas: lineas.length,
      lineasActivas:
        lineas.filter(
          (item) => item.estado === "activa"
        ).length,

      programas: programas.length,
      programasActivos:
        programas.filter(
          (item) => item.estado === "activo"
        ).length,

      proyectos: proyectos.length,
      proyectosActivos:
        proyectos.filter(
          (item) => item.estado === "activo"
        ).length
    },

    progress:
      hasHierarchy
        ? clamp(vigenciaProgress)
        : null,

    coverage:
      hasHierarchy
        ? clamp(vigenciaCoverage)
        : 0,

    structure: {
      activeConsejerias,
      activeLineas,
      activeProgramas,
      planProjects
    }
  };
}

/* ==========================================================
   UI
   ========================================================== */

function metricCard({
  type,
  label,
  value,
  secondary
}) {
  return `
    <article class="vigencia-structure-card">
      <div class="vigencia-structure-icon ${escapeHTML(type)}">
        ${dashboardIcon(type)}
      </div>

      <div>
        <span>${escapeHTML(label)}</span>
        <strong>${Number(value || 0)}</strong>
        <small>${escapeHTML(secondary)}</small>
      </div>
    </article>
  `;
}

function renderProgressPanel(metrics) {
  const progress =
    metrics.coverage > 0
      ? Number(metrics.progress || 0)
      : null;

  const state =
    getProgressState(
      progress,
      metrics.coverage
    );

  const visualProgress =
    progress === null
      ? 0
      : clamp(progress);

  return `
    <section class="vigencia-progress-panel ${state.key}">
      <div class="vigencia-progress-copy">
        <p class="eyebrow">Indicador general</p>
        <h3>Avance de la Vigencia</h3>

        <p>
          Resultado consolidado desde los indicadores de las
          Actividades y propagado automáticamente por Proyecto,
          Programa, Línea de Acción y Consejería.
        </p>

        <div class="vigencia-progress-status">
          <span
            class="vigencia-progress-dot"
            style="background:${state.color}"
          ></span>

          <div>
            <strong>${escapeHTML(state.label)}</strong>
            <small>${escapeHTML(state.detail)}</small>
          </div>
        </div>
      </div>

      <div class="vigencia-progress-gauge-column">
        <div
          class="vigencia-progress-gauge"
          style="
            --dashboard-progress:${visualProgress * 3.6}deg;
            --dashboard-progress-color:${state.color};
          "
          aria-label="Avance general ${progress === null ? "sin medición" : formatPercent(progress)}"
        >
          <div class="vigencia-progress-gauge-inner">
            <strong>
              ${progress === null
                ? "—"
                : `${progress.toFixed(1).replace(".", ",")}%`
              }
            </strong>

            <span>
              ${progress === null
                ? "Sin datos"
                : "Avance acreditado"
              }
            </span>
          </div>
        </div>

        <div class="measurement-coverage">
          <div>
            <span>Cobertura de medición</span>
            <strong>${formatPercent(metrics.coverage)}</strong>
          </div>

          <div class="measurement-coverage-track">
            <span
              style="width:${clamp(metrics.coverage)}%"
            ></span>
          </div>

          <small>
            Porción ponderada de la Vigencia que ya cuenta
            con indicadores suficientes para acreditar avance.
          </small>
        </div>
      </div>
    </section>
  `;
}

export async function renderInicio(container, navigationTarget = null) {
  let vigencias = [];
  let selectedVigenciaId = "";

  container.innerHTML = `
    <section class="hero-panel dashboard-hero">
      <div class="dashboard-hero-content">
        <p
          class="eyebrow"
          style="color: var(--onic-cream-300)"
        >
          Sistema de gestión institucional
        </p>

        <h2>Plan Estratégico de la ONIC</h2>

        <p>
          Tablero general de estructura y avance de la Vigencia.
        </p>
      </div>

      <div class="dashboard-vigencia-selector">
        <label for="inicioVigenciaSelector">
          Vigencia
        </label>

        <select id="inicioVigenciaSelector">
          <option value="">Cargando…</option>
        </select>

        <button
          id="inicioDocumentReportButton"
          class="dashboard-document-button"
          type="button"
          disabled
        >
          ${documentReportIcon()}
          Generar documento
        </button>
      </div>
    </section>

    <section
      id="inicioVigenciaIdentity"
      class="dashboard-vigencia-identity hidden"
    ></section>

    <section
      id="inicioStructureMetrics"
      class="vigencia-structure-grid"
      aria-label="Indicadores estructurales"
    >
      <div class="empty-state">
        Cargando indicadores…
      </div>
    </section>

    <div id="inicioProgressPanel">
      <section class="panel">
        <div class="empty-state">
          Calculando avance…
        </div>
      </section>
    </div>

    <section class="panel dashboard-history-panel">
      <div class="panel-heading tracking-panel-heading">
        <div>
          <p class="eyebrow">Evolución del Plan</p>
          <h2>Histórico de avance</h2>
          <p class="muted">Compara los cortes aprobados o cerrados con el valor actual de la Vigencia.</p>
        </div>
      </div>
      <div id="inicioHistoricalChart">
        <div class="empty-state">Cargando histórico…</div>
      </div>
    </section>

    <section class="panel dashboard-alerts-panel">
      <div class="panel-heading tracking-panel-heading">
        <div>
          <p class="eyebrow">Seguimiento operativo</p>
          <h2>Alertas y compromisos</h2>
          <p class="muted">Identifica asuntos que requieren atención sin alterar los cálculos de avance.</p>
        </div>
        <button id="inicioOpenAlerts" class="btn btn-secondary" type="button">Abrir centro</button>
      </div>
      <div id="inicioAlertsSummary">
        <div class="empty-state">Cargando alertas…</div>
      </div>
    </section>
  `;

  const selector =
    container.querySelector(
      "#inicioVigenciaSelector"
    );

  const documentButton =
    container.querySelector(
      "#inicioDocumentReportButton"
    );

  const identity =
    container.querySelector(
      "#inicioVigenciaIdentity"
    );

  const structure =
    container.querySelector(
      "#inicioStructureMetrics"
    );

  const progressHost =
    container.querySelector(
      "#inicioProgressPanel"
    );

  const historicalHost =
    container.querySelector(
      "#inicioHistoricalChart"
    );

  const alertsHost =
    container.querySelector(
      "#inicioAlertsSummary"
    );

  const openAlertsButton =
    container.querySelector(
      "#inicioOpenAlerts"
    );

  openAlertsButton?.addEventListener("click", () => {
    if (!selectedVigenciaId) return;
    window.dispatchEvent(new CustomEvent("app:navigate", {
      detail: {
        view: "alertas",
        target: { vigencia_id: selectedVigenciaId, tab: "alertas" }
      }
    }));
  });

  function currentVigencia() {
    return vigencias.find(
      (item) =>
        item.id === selectedVigenciaId
    );
  }

  function renderIdentity() {
    const vigencia = currentVigencia();

    if (!vigencia) {
      identity.classList.add("hidden");
      identity.innerHTML = "";
      return;
    }

    identity.classList.remove("hidden");

    identity.innerHTML = `
      <div>
        <span class="context-label">
          Vigencia seleccionada
        </span>

        <strong>
          ${escapeHTML(vigencia.nombre)}
        </strong>

        <small>
          ${formatDate(vigencia.fecha_inicio)}
          –
          ${formatDate(vigencia.fecha_fin)}
        </small>
      </div>

      <div>
        <span class="context-label">
          Estado
        </span>

        <span class="status-chip ${
          vigencia.estado === "activa"
            ? "active"
            : vigencia.estado === "cerrada"
              ? "closed"
              : "draft"
        }">
          ${
            vigencia.estado === "activa"
              ? "Activa"
              : vigencia.estado === "cerrada"
                ? "Cerrada"
                : "Borrador"
          }
        </span>
      </div>

      ${
        vigencia.lema
          ? `
            <div class="dashboard-vigencia-motto">
              <span class="context-label">
                Lema
              </span>
              <strong>
                ${escapeHTML(vigencia.lema)}
              </strong>
            </div>
          `
          : ""
      }
    `;
  }

  async function refreshDashboard() {
    renderIdentity();

    const selectedVigencia =
      currentVigencia();

    if (selectedVigencia) {
      setAuditContext({
        vigenciaId: selectedVigencia.id,
        vigenciaNombre: selectedVigencia.nombre,
        entidadTipo: "vigencia",
        entidadId: selectedVigencia.id,
        entidadNombre: selectedVigencia.nombre,
        seccion: "tablero",
        ruta: selectedVigencia.nombre,
        navigation: {
          view: "inicio",
          vigencia_id: selectedVigencia.id,
          vigencia_nombre: selectedVigencia.nombre
        },
        sectionOptions: [
          {
            value: "tablero",
            label: "Tablero principal",
            navigation: {
              view: "inicio",
              vigencia_id: selectedVigencia.id
            }
          }
        ]
      });
    }

    if (documentButton) {
      documentButton.disabled =
        !selectedVigenciaId;
    }

    if (!selectedVigenciaId) {
      structure.innerHTML = `
        <div class="empty-state">
          Selecciona una Vigencia.
        </div>
      `;

      progressHost.innerHTML = "";
      historicalHost.innerHTML = `<div class="empty-state">Selecciona una Vigencia.</div>`;
      alertsHost.innerHTML = `<div class="empty-state">Selecciona una Vigencia.</div>`;
      updateAlertsNavBadge(0);
      return;
    }

    structure.innerHTML = `
      <div class="empty-state">
        Cargando estructura…
      </div>
    `;

    progressHost.innerHTML = `
      <section class="panel">
        <div class="empty-state">
          Calculando avance…
        </div>
      </section>
    `;

    historicalHost.innerHTML = `<div class="empty-state">Cargando histórico…</div>`;
    alertsHost.innerHTML = `<div class="empty-state">Cargando alertas…</div>`;

    try {
      const data =
        await getDashboardData(
          selectedVigenciaId
        );

      const metrics =
        calculateDashboardMetrics(data);

      structure.innerHTML = `
        ${metricCard({
          type: "consejerias",
          label: "Consejerías",
          value: metrics.counts.consejerias,
          secondary:
            `${metrics.counts.consejeriasActivas} activas`
        })}

        ${metricCard({
          type: "lineas",
          label: "Líneas de Acción",
          value: metrics.counts.lineas,
          secondary:
            `${metrics.counts.lineasActivas} activas`
        })}

        ${metricCard({
          type: "programas",
          label: "Programas",
          value: metrics.counts.programas,
          secondary:
            `${metrics.counts.programasActivos} activos`
        })}

        ${metricCard({
          type: "proyectos",
          label: "Proyectos",
          value: metrics.counts.proyectos,
          secondary:
            `${metrics.counts.proyectosActivos} activos`
        })}
      `;

      progressHost.innerHTML =
        renderProgressPanel(metrics);

      try {
        const historicalPoints =
          await loadOfficialTrackingSeries(selectedVigenciaId);

        historicalHost.innerHTML =
          renderTrackingChart(
            historicalPoints,
            {
              includeCurrent: {
                progress: metrics.progress,
                coverage: metrics.coverage
              },
              compact: true
            }
          );
      } catch (historyError) {
        console.error(historyError);
        historicalHost.innerHTML = `
          <div class="tracking-chart-empty">
            <strong>No fue posible cargar el histórico de cortes.</strong>
            <p>El avance actual continúa disponible normalmente.</p>
          </div>
        `;
      }

      try {
        const alertSummary = await loadAlertSummary(selectedVigenciaId);
        alertsHost.innerHTML = `
          <div class="dashboard-alerts-summary">
            <article class="dashboard-alert-metric high"><span>Urgentes</span><strong>${alertSummary.altas}</strong></article>
            <article class="dashboard-alert-metric medium"><span>Atención</span><strong>${alertSummary.medias}</strong></article>
            <article class="dashboard-alert-metric tasks"><span>Compromisos abiertos</span><strong>${alertSummary.tareasAbiertas}</strong><small>${alertSummary.tareasVencidas ? `${alertSummary.tareasVencidas} vencido${alertSummary.tareasVencidas === 1 ? "" : "s"}` : "Sin vencidos"}</small></article>
          </div>
        `;
      } catch (alertsError) {
        console.error(alertsError);
        alertsHost.innerHTML = `<div class="tracking-chart-empty"><strong>No fue posible cargar las alertas.</strong><p>El tablero de avance continúa disponible normalmente.</p></div>`;
      }
    } catch (error) {
      console.error(error);

      structure.innerHTML = `
        <div class="empty-state">
          <strong>
            No fue posible cargar los indicadores.
          </strong>

          <p>
            ${escapeHTML(
              error.message ||
              "No fue posible actualizar la información. Intenta nuevamente."
            )}
          </p>
        </div>
      `;

      progressHost.innerHTML = "";
      historicalHost.innerHTML = `<div class="tracking-chart-empty"><strong>Histórico no disponible.</strong></div>`;
      alertsHost.innerHTML = `<div class="tracking-chart-empty"><strong>Alertas no disponibles.</strong></div>`;
    }
  }

  try {
    vigencias = await getVigencias();

    if (!vigencias.length) {
      selector.innerHTML = `
        <option value="">
          No hay Vigencias registradas
        </option>
      `;

      structure.innerHTML = `
        <div class="empty-state">
          <strong>
            Todavía no hay Vigencias.
          </strong>
        </div>
      `;

      progressHost.innerHTML = "";
      historicalHost.innerHTML = `<div class="empty-state">Todavía no hay Vigencias.</div>`;
      alertsHost.innerHTML = `<div class="empty-state">Todavía no hay Vigencias.</div>`;
      updateAlertsNavBadge(0);
      return;
    }

    selectedVigenciaId =
      navigationTarget?.vigencia_id &&
      vigencias.some(
        (item) =>
          item.id === navigationTarget.vigencia_id
      )
        ? navigationTarget.vigencia_id
        : (
            vigencias.find(
              (item) => item.estado === "activa"
            )?.id ||
            vigencias[0].id
          );

    selector.innerHTML =
      vigencias
        .map((vigencia) =>
          option(
            vigencia.id,
            `${vigencia.nombre}${
              vigencia.estado === "activa"
                ? " · activa"
                : ""
            }`,
            vigencia.id === selectedVigenciaId
          )
        )
        .join("");

    selector.value =
      selectedVigenciaId;

    selector.addEventListener(
      "change",
      async () => {
        selectedVigenciaId =
          selector.value;

        await refreshDashboard();
      }
    );

    documentButton?.addEventListener(
      "click",
      () => {
        if (!selectedVigenciaId) return;

        openDocumentReportDialog({
          scope: "vigencia",
          vigenciaId:
            selectedVigenciaId
        });
      }
    );

    await refreshDashboard();
  } catch (error) {
    console.error(error);

    structure.innerHTML = `
      <div class="empty-state">
        <strong>
          No fue posible cargar el tablero.
        </strong>

        <p>
          ${escapeHTML(
            error.message ||
            "No fue posible actualizar la información. Intenta nuevamente."
          )}
        </p>
      </div>
    `;

    progressHost.innerHTML = "";
  }
}
