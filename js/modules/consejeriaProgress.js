import { requireSupabase } from "../supabaseClient.js";

function clamp(value, min = 0, max = 100) {
  return Math.min(
    max,
    Math.max(
      min,
      Number(value || 0)
    )
  );
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
  const baseUnits =
    Math.floor(
      totalUnits / items.length
    );

  const remainder =
    totalUnits -
    baseUnits * items.length;

  items.forEach(
    (item, index) => {
      const units =
        baseUnits +
        (
          index < remainder
            ? 1
            : 0
        );

      map.set(
        item.id,
        units / 100
      );
    }
  );

  return map;
}

function indicatorProgress(indicator) {
  if (
    !indicator ||
    indicator.estado !== "activo"
  ) {
    return null;
  }

  const base =
    Number(
      indicator.linea_base
    );

  const meta =
    Number(
      indicator.meta
    );

  const current =
    Number(
      indicator.valor_actual
    );

  if (
    ![
      base,
      meta,
      current
    ].every(Number.isFinite)
  ) {
    return null;
  }

  let numerator;
  let denominator;

  if (
    indicator.sentido ===
    "descendente"
  ) {
    numerator =
      base - current;

    denominator =
      base - meta;
  } else {
    numerator =
      current - base;

    denominator =
      meta - base;
  }

  if (
    Math.abs(denominator) <
    1e-12
  ) {
    return null;
  }

  return clamp(
    numerator /
    denominator *
    100
  );
}

function activityProgress(
  indicators = []
) {
  const active =
    indicators.filter(
      (indicator) =>
        indicator.estado ===
        "activo"
    );

  if (!active.length) {
    return null;
  }

  const values =
    active.map(
      indicatorProgress
    );

  if (
    values.some(
      (value) =>
        value === null
    )
  ) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length
  );
}

async function getRowsIn(
  table,
  field,
  ids,
  columns = "*"
) {
  if (!ids.length) {
    return [];
  }

  const supabase =
    requireSupabase();

  const { data, error } =
    await supabase
      .from(table)
      .select(columns)
      .in(field, ids);

  if (error) throw error;

  return data || [];
}

/**
 * Calcula el avance de cada Consejería utilizando exactamente
 * la misma lógica jerárquica del tablero Inicio:
 *
 * Indicadores → Actividades → Proyectos → Programas
 * → Líneas de Acción → Consejería.
 *
 * Retorna Map(vigencia_consejeria_id => metric).
 */
export async function getConsejeriaProgressMap(
  vigenciaId
) {
  const supabase =
    requireSupabase();

  const {
    data: consejerias,
    error: consejeriasError
  } =
    await supabase
      .from(
        "vigencia_consejerias"
      )
      .select(
        "id,estado"
      )
      .eq(
        "vigencia_id",
        vigenciaId
      );

  if (consejeriasError) {
    throw consejeriasError;
  }

  const vcRows =
    consejerias || [];

  const vcIds =
    vcRows.map(
      (row) => row.id
    );

  const lineas =
    await getRowsIn(
      "lineas_accion",
      "vigencia_consejeria_id",
      vcIds,
      "id,vigencia_consejeria_id,estado,orden"
    );

  const lineIds =
    lineas.map(
      (row) => row.id
    );

  const programas =
    await getRowsIn(
      "programas",
      "linea_accion_id",
      lineIds,
      "id,linea_accion_id,estado,orden"
    );

  const programIds =
    programas.map(
      (row) => row.id
    );

  const proyectos =
    await getRowsIn(
      "proyectos",
      "programa_id",
      programIds,
      "id,programa_id,estado,ponderacion,orden"
    );

  const projectIds =
    proyectos.map(
      (row) => row.id
    );

  const actividades =
    await getRowsIn(
      "actividades",
      "proyecto_id",
      projectIds,
      "id,proyecto_id,estado,orden"
    );

  const activityIds =
    actividades.map(
      (row) => row.id
    );

  const indicadores =
    await getRowsIn(
      "indicadores_actividad",
      "actividad_id",
      activityIds,
      "id,actividad_id,linea_base,meta,valor_actual,sentido,estado,orden"
    );

  const activeConsejerias =
    vcRows.filter(
      (item) =>
        item.estado ===
        "activa"
    );

  const activeConsejeriaIds =
    new Set(
      activeConsejerias.map(
        (item) => item.id
      )
    );

  const activeLineas =
    lineas.filter(
      (item) =>
        item.estado ===
          "activa" &&
        activeConsejeriaIds.has(
          item.vigencia_consejeria_id
        )
    );

  const activeLineIds =
    new Set(
      activeLineas.map(
        (item) => item.id
      )
    );

  const activeProgramas =
    programas.filter(
      (item) =>
        item.estado ===
          "activo" &&
        activeLineIds.has(
          item.linea_accion_id
        )
    );

  const activeProgramIds =
    new Set(
      activeProgramas.map(
        (item) => item.id
      )
    );

  /*
   * Los Proyectos pertenecientes a Programas activos participan
   * según su ponderación manual, sin renormalizarla.
   */
  const planProjects =
    proyectos.filter(
      (item) =>
        activeProgramIds.has(
          item.programa_id
        )
    );

  const planProjectIds =
    new Set(
      planProjects.map(
        (item) => item.id
      )
    );

  const planActivities =
    actividades.filter(
      (item) =>
        planProjectIds.has(
          item.proyecto_id
        ) &&
        item.estado !==
          "cancelada"
    );

  const planActivityIds =
    new Set(
      planActivities.map(
        (item) => item.id
      )
    );

  const planIndicators =
    indicadores.filter(
      (item) =>
        planActivityIds.has(
          item.actividad_id
        )
    );

  const indicatorsByActivity =
    new Map();

  planIndicators.forEach(
    (indicator) => {
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
        .get(
          indicator.actividad_id
        )
        .push(indicator);
    }
  );

  const activitiesByProject =
    new Map();

  planActivities.forEach(
    (activity) => {
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
    }
  );

  const projectsByProgram =
    new Map();

  planProjects.forEach(
    (project) => {
      if (
        !projectsByProgram.has(
          project.programa_id
        )
      ) {
        projectsByProgram.set(
          project.programa_id,
          []
        );
      }

      projectsByProgram
        .get(project.programa_id)
        .push(project);
    }
  );

  const programsByLine =
    new Map();

  activeProgramas.forEach(
    (program) => {
      if (
        !programsByLine.has(
          program.linea_accion_id
        )
      ) {
        programsByLine.set(
          program.linea_accion_id,
          []
        );
      }

      programsByLine
        .get(
          program.linea_accion_id
        )
        .push(program);
    }
  );

  const linesByConsejeria =
    new Map();

  activeLineas.forEach(
    (linea) => {
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
        .get(
          linea.vigencia_consejeria_id
        )
        .push(linea);
    }
  );

  /* Proyecto */
  const projectMetrics =
    new Map();

  planProjects.forEach(
    (project) => {
      const projectActivities =
        activitiesByProject.get(
          project.id
        ) || [];

      const weights =
        equalWeights(
          projectActivities
        );

      let progress = 0;
      let coverage = 0;

      projectActivities.forEach(
        (activity) => {
          const activityValue =
            activityProgress(
              indicatorsByActivity.get(
                activity.id
              ) || []
            );

          const weight =
            Number(
              weights.get(
                activity.id
              ) || 0
            );

          if (
            activityValue !== null
          ) {
            progress +=
              activityValue *
              weight /
              100;

            coverage += weight;
          }
        }
      );

      projectMetrics.set(
        project.id,
        {
          progress:
            projectActivities.length
              ? clamp(progress)
              : 0,

          coverage:
            projectActivities.length
              ? clamp(coverage)
              : 0
        }
      );
    }
  );

  /* Programa */
  const programMetrics =
    new Map();

  activeProgramas.forEach(
    (program) => {
      const programProjects =
        projectsByProgram.get(
          program.id
        ) || [];

      let progress = 0;
      let coverage = 0;

      programProjects.forEach(
        (project) => {
          const metric =
            projectMetrics.get(
              project.id
            ) || {
              progress: 0,
              coverage: 0
            };

          const weight =
            Number(
              project.ponderacion ||
              0
            );

          progress +=
            metric.progress *
            weight /
            100;

          coverage +=
            metric.coverage *
            weight /
            100;
        }
      );

      programMetrics.set(
        program.id,
        {
          progress:
            clamp(progress),

          coverage:
            clamp(coverage)
        }
      );
    }
  );

  /* Línea */
  const lineMetrics =
    new Map();

  activeLineas.forEach(
    (linea) => {
      const linePrograms =
        programsByLine.get(
          linea.id
        ) || [];

      const weights =
        equalWeights(
          linePrograms
        );

      let progress = 0;
      let coverage = 0;

      linePrograms.forEach(
        (program) => {
          const metric =
            programMetrics.get(
              program.id
            ) || {
              progress: 0,
              coverage: 0
            };

          const weight =
            Number(
              weights.get(
                program.id
              ) || 0
            );

          progress +=
            metric.progress *
            weight /
            100;

          coverage +=
            metric.coverage *
            weight /
            100;
        }
      );

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
    }
  );

  /* Consejería */
  const result =
    new Map();

  vcRows.forEach(
    (vc) => {
      if (
        vc.estado !== "activa"
      ) {
        result.set(
          vc.id,
          {
            progress: null,
            coverage: null,
            active: false
          }
        );

        return;
      }

      const vcLines =
        linesByConsejeria.get(
          vc.id
        ) || [];

      const weights =
        equalWeights(
          vcLines
        );

      let progress = 0;
      let coverage = 0;

      vcLines.forEach(
        (linea) => {
          const metric =
            lineMetrics.get(
              linea.id
            ) || {
              progress: 0,
              coverage: 0
            };

          const weight =
            Number(
              weights.get(
                linea.id
              ) || 0
            );

          progress +=
            metric.progress *
            weight /
            100;

          coverage +=
            metric.coverage *
            weight /
            100;
        }
      );

      result.set(
        vc.id,
        {
          progress:
            vcLines.length
              ? clamp(progress)
              : 0,

          coverage:
            vcLines.length
              ? clamp(coverage)
              : 0,

          active: true
        }
      );
    }
  );

  return result;
}

export function formatConsejeriaProgress(
  value
) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(
      Number(value)
    )
  ) {
    return "—";
  }

  return (
    Number(value)
      .toFixed(2)
      .replace(".", ",") +
    " %"
  );
}

export function getConsejeriaProgressState(
  metric
) {
  if (
    !metric ||
    metric.active === false
  ) {
    return {
      key: "inactive",
      label: "Fuera del cálculo",
      detail:
        "La Consejería está inactiva en esta Vigencia.",
      color: "#87918c"
    };
  }

  if (
    metric.coverage === null ||
    Number(metric.coverage) <= 0
  ) {
    return {
      key: "no-data",
      label: "Sin medición",
      detail:
        "Todavía no hay indicadores suficientes para acreditar avance.",
      color: "#87918c"
    };
  }

  const progress =
    Number(
      metric.progress || 0
    );

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
