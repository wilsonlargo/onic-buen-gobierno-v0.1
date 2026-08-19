import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";

const LOGO_PATH = "./assets/branding/onic-logo.png";

function arr(value) {
  return Array.isArray(value) ? value : [];
}

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
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function safeFilename(value = "") {
  return String(value || "documento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 110) || "documento";
}

function humanDate(value) {
  if (!value) return "—";

  const raw = String(value);

  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T00:00:00`)
      : new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function todayLabel() {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function formatNumber(value, digits = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: digits
  }).format(number);
}

function formatMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(number);
}

function formatPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return `${formatNumber(number, 2)} %`;
}

function statusLabel(value = "") {
  const map = {
    borrador: "Borrador",
    activa: "Activa",
    activo: "Activo",
    inactiva: "Inactiva",
    inactivo: "Inactivo",
    cerrada: "Cerrada",
    cerrado: "Cerrado",
    formulacion: "Formulación",
    suspendido: "Suspendido",
    suspendida: "Suspendida",
    programada: "Programada",
    en_ejecucion: "En ejecución",
    completada: "Completada",
    cancelada: "Cancelada",
    archivado: "Archivado",
    archivada: "Archivada",
    pendiente: "Pendiente",
    en_proceso: "En proceso",
    resuelta: "Resuelta"
  };

  return map[value] || String(value || "—");
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function equalWeights(items = []) {
  const map = new Map();

  items.forEach((item) => {
    map.set(item, 0);
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
      baseUnits +
      (index < remainder ? 1 : 0);

    map.set(item, units / 100);
  });

  return map;
}

function indicatorProgress(indicator) {
  if (
    !indicator ||
    indicator.estado === "inactivo"
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
    numerator / denominator * 100
  );
}

function activityMetric(activity) {
  const indicators =
    arr(activity.indicadores)
      .filter(
        (indicator) =>
          indicator.estado !== "inactivo"
      );

  if (!indicators.length) {
    return {
      progress: null,
      measurable: false
    };
  }

  const values =
    indicators.map(indicatorProgress);

  if (
    values.some(
      (value) => value === null
    )
  ) {
    return {
      progress: null,
      measurable: false
    };
  }

  return {
    progress:
      values.reduce(
        (sum, value) => sum + value,
        0
      ) / values.length,
    measurable: true
  };
}

function projectMetric(project) {
  const activities =
    arr(project.actividades)
      .filter(
        (activity) =>
          activity.estado !== "cancelada"
      );

  const weights =
    equalWeights(activities);

  let accredited = 0;
  let coverage = 0;

  activities.forEach((activity) => {
    const metric =
      activityMetric(activity);

    const weight =
      Number(
        weights.get(activity) || 0
      );

    if (metric.measurable) {
      accredited +=
        metric.progress * weight / 100;

      coverage += weight;
    }
  });

  const budget =
    activities.reduce(
      (totals, activity) => {
        arr(activity.presupuesto)
          .filter(
            (item) =>
              item.estado !== "inactivo"
          )
          .forEach((item) => {
            totals.programmed +=
              Number(item.programado || 0);

            totals.executed +=
              Number(item.ejecutado || 0);
          });

        return totals;
      },
      {
        programmed: 0,
        executed: 0
      }
    );

  return {
    progress:
      activities.length > 0 &&
      coverage >= 99.999
        ? clamp(accredited)
        : null,

    accredited:
      activities.length
        ? clamp(accredited)
        : 0,

    coverage:
      activities.length
        ? clamp(coverage)
        : 0,

    budget: {
      ...budget,

      execution:
        budget.programmed > 0
          ? clamp(
              budget.executed /
              budget.programmed * 100
            )
          : null
    }
  };
}

function programMetric(program) {
  let accredited = 0;
  let coverage = 0;

  arr(program.proyectos).forEach(
    (project) => {
      const metric =
        projectMetric(project);

      const weight =
        Number(
          project.ponderacion || 0
        );

      accredited +=
        metric.accredited *
        weight / 100;

      coverage +=
        metric.coverage *
        weight / 100;
    }
  );

  return {
    accredited: clamp(accredited),
    coverage: clamp(coverage)
  };
}

function lineMetric(line) {
  const programs =
    arr(line.programas)
      .filter(
        (program) =>
          program.estado !== "inactivo" &&
          program.estado !== "archivado"
      );

  const weights =
    equalWeights(programs);

  let accredited = 0;
  let coverage = 0;

  programs.forEach((program) => {
    const metric =
      programMetric(program);

    const weight =
      Number(weights.get(program) || 0);

    accredited +=
      metric.accredited * weight / 100;

    coverage +=
      metric.coverage * weight / 100;
  });

  return {
    accredited: clamp(accredited),
    coverage: clamp(coverage)
  };
}

function consejeriaMetric(consejeria) {
  const lines =
    arr(consejeria.lineas)
      .filter(
        (line) =>
          line.estado !== "inactiva" &&
          line.estado !== "archivada"
      );

  const weights =
    equalWeights(lines);

  let accredited = 0;
  let coverage = 0;

  lines.forEach((line) => {
    const metric =
      lineMetric(line);

    const weight =
      Number(weights.get(line) || 0);

    accredited +=
      metric.accredited * weight / 100;

    coverage +=
      metric.coverage * weight / 100;
  });

  return {
    accredited: clamp(accredited),
    coverage: clamp(coverage)
  };
}

function vigenciaMetric(payload) {
  const consejerias =
    arr(payload.consejerias)
      .filter(
        (consejeria) =>
          consejeria.participacion?.estado !==
          "inactiva"
      );

  const weights =
    equalWeights(consejerias);

  let accredited = 0;
  let coverage = 0;

  consejerias.forEach((consejeria) => {
    const metric =
      consejeriaMetric(consejeria);

    const weight =
      Number(
        weights.get(consejeria) || 0
      );

    accredited +=
      metric.accredited * weight / 100;

    coverage +=
      metric.coverage * weight / 100;
  });

  return {
    accredited:
      consejerias.length
        ? clamp(accredited)
        : null,

    coverage:
      consejerias.length
        ? clamp(coverage)
        : 0
  };
}

function scopeCounts(consejerias = []) {
  const counts = {
    consejerias: 0,
    lineas: 0,
    programas: 0,
    proyectos: 0,
    actividades: 0,
    indicadores: 0,
    evidencias: 0,
    documentos: 0,
    rubros: 0
  };

  arr(consejerias).forEach(
    (consejeria) => {
      counts.consejerias += 1;

      counts.documentos +=
        arr(consejeria.biblioteca).length;

      arr(consejeria.lineas).forEach(
        (line) => {
          counts.lineas += 1;

          arr(line.programas).forEach(
            (program) => {
              counts.programas += 1;

              arr(program.proyectos)
                .forEach((project) => {
                  counts.proyectos += 1;

                  arr(project.actividades)
                    .forEach((activity) => {
                      counts.actividades += 1;

                      counts.indicadores +=
                        arr(
                          activity.indicadores
                        ).length;

                      counts.evidencias +=
                        arr(
                          activity.evidencias
                        ).length;

                      counts.rubros +=
                        arr(
                          activity.presupuesto
                        ).length;
                    });
                });
            });
        });
    }
  );

  return counts;
}

function scopeBudget(consejerias = []) {
  let programmed = 0;
  let executed = 0;

  arr(consejerias).forEach(
    (consejeria) => {
      arr(consejeria.lineas)
        .forEach((line) => {
          arr(line.programas)
            .forEach((program) => {
              arr(program.proyectos)
                .forEach((project) => {
                  const metric =
                    projectMetric(project);

                  programmed +=
                    metric.budget.programmed;

                  executed +=
                    metric.budget.executed;
                });
            });
        });
    }
  );

  return {
    programmed,
    executed,

    execution:
      programmed > 0
        ? clamp(
            executed /
            programmed * 100
          )
        : null
  };
}

/* ==========================================================
   Consulta y localización de alcance
   ========================================================== */

async function getVigenciaPayload(vigenciaId) {
  const supabase = requireSupabase();

  const { data, error } =
    await supabase.rpc(
      "exportar_vigencia_json",
      {
        p_vigencia_id: vigenciaId
      }
    );

  if (error) throw error;
  return data;
}

function findConsejeria(payload, context) {
  return arr(payload.consejerias)
    .find((consejeria) => {
      if (
        context.consejeriaRef &&
        String(consejeria.ref) ===
        String(context.consejeriaRef)
      ) {
        return true;
      }

      return (
        normalize(
          consejeria.catalogo?.nombre_corto
        ) ===
        normalize(
          context.consejeriaName
        )
        ||
        normalize(
          consejeria.catalogo?.nombre_largo
        ) ===
        normalize(
          context.consejeriaName
        )
      );
    });
}

function findProject(payload, context) {
  const consejeria =
    findConsejeria(
      payload,
      context
    );

  if (!consejeria) return null;

  const line =
    arr(consejeria.lineas)
      .find(
        (item) =>
          normalize(item.nombre) ===
          normalize(context.lineName)
      );

  if (!line) return null;

  const program =
    arr(line.programas)
      .find(
        (item) =>
          normalize(item.nombre) ===
          normalize(context.programName)
      );

  if (!program) return null;

  const project =
    arr(program.proyectos)
      .find((item) => {
        if (
          context.projectCode &&
          normalize(item.codigo) ===
          normalize(context.projectCode)
        ) {
          return true;
        }

        return (
          normalize(item.nombre) ===
          normalize(context.projectName)
        );
      });

  if (!project) return null;

  return {
    consejeria,
    line,
    program,
    project
  };
}

/* ==========================================================
   Modelo documental intermedio
   ========================================================== */

function cellText(value) {
  return String(value ?? "—");
}

function infoRows(entries) {
  return entries.map(
    ([label, value]) => [
      label,
      value
    ]
  );
}

function pushHeading(blocks, level, text) {
  blocks.push({
    type: "heading",
    level,
    text
  });
}

function pushParagraph(blocks, text, options = {}) {
  blocks.push({
    type: "paragraph",
    text:
      String(text ?? "").trim() ||
      "Sin información registrada.",
    ...options
  });
}

function pushTable(blocks, headers, rows, options = {}) {
  blocks.push({
    type: "table",
    headers,
    rows,
    ...options
  });
}

function pushMetrics(blocks, items) {
  blocks.push({
    type: "metrics",
    items
  });
}

function renderMandatesToBlocks(
  blocks,
  mandates,
  sourceMap,
  headingLevel = 3
) {
  if (!mandates.length) {
    pushParagraph(
      blocks,
      "No hay Mandatos asociados.",
      {
        italic: true
      }
    );

    return;
  }

  mandates.forEach((mandate) => {
    pushHeading(
      blocks,
      headingLevel,
      mandate.codigo
        ? `Mandato ${mandate.codigo}`
        : mandate.titulo ||
          "Mandato"
    );

    if (mandate.titulo) {
      pushParagraph(
        blocks,
        mandate.titulo,
        {
          bold: true
        }
      );
    }

    pushParagraph(
      blocks,
      mandate.texto
    );

    const source =
      sourceMap.get(
        mandate.fuente_ref
      );

    pushTable(
      blocks,
      ["Campo", "Información"],
      infoRows([
        [
          "Fuente",
          source?.nombre ||
          "Sin fuente específica"
        ],
        [
          "Estado",
          statusLabel(mandate.estado)
        ]
      ]),
      {
        compact: true
      }
    );
  });
}

function renderLibraryToBlocks(
  blocks,
  documents
) {
  if (!documents.length) {
    pushParagraph(
      blocks,
      "No hay documentos registrados en la Biblioteca.",
      {
        italic: true
      }
    );

    return;
  }

  pushTable(
    blocks,
    [
      "Título",
      "Tipo",
      "Palabras clave",
      "Vínculo"
    ],
    documents.map(
      (document) => [
        cellText(document.titulo),
        cellText(
          document.tipo_documento ||
          "Documento"
        ),
        cellText(
          document.palabras_clave ||
          "—"
        ),
        document.url
          ? {
              text: "Abrir documento",
              url: document.url
            }
          : "—"
      ]
    )
  );
}

function renderIndicatorsToBlocks(
  blocks,
  activity
) {
  const indicators =
    arr(activity.indicadores);

  if (!indicators.length) {
    pushParagraph(
      blocks,
      "Sin indicadores registrados.",
      {
        italic: true
      }
    );

    return;
  }

  pushTable(
    blocks,
    [
      "Código",
      "Indicador",
      "Unidad",
      "Línea base",
      "Meta",
      "Actual",
      "Avance"
    ],
    indicators.map(
      (indicator) => [
        cellText(
          indicator.codigo || "—"
        ),
        cellText(indicator.nombre),
        cellText(
          indicator.unidad_medida || "—"
        ),
        formatNumber(
          indicator.linea_base,
          4
        ),
        formatNumber(
          indicator.meta,
          4
        ),
        formatNumber(
          indicator.valor_actual,
          4
        ),
        formatPercent(
          indicatorProgress(
            indicator
          )
        )
      ]
    )
  );

  indicators.forEach((indicator) => {
    const followups =
      arr(indicator.seguimientos);

    if (!followups.length) return;

    pushHeading(
      blocks,
      5,
      `Seguimientos: ${indicator.codigo || indicator.nombre}`
    );

    pushTable(
      blocks,
      [
        "Fecha",
        "Valor",
        "Observación"
      ],
      followups.map(
        (followup) => [
          humanDate(
            followup.fecha_corte
          ),
          formatNumber(
            followup.valor,
            4
          ),
          cellText(
            followup.observacion ||
            "—"
          )
        ]
      ),
      {
        compact: true
      }
    );
  });
}

function renderBudgetToBlocks(
  blocks,
  activity
) {
  const items =
    arr(activity.presupuesto);

  if (!items.length) {
    pushParagraph(
      blocks,
      "Sin rubros presupuestales registrados.",
      {
        italic: true
      }
    );

    return;
  }

  const active =
    items.filter(
      (item) =>
        item.estado !== "inactivo"
    );

  const programmed =
    active.reduce(
      (sum, item) =>
        sum +
        Number(item.programado || 0),
      0
    );

  const executed =
    active.reduce(
      (sum, item) =>
        sum +
        Number(item.ejecutado || 0),
      0
    );

  pushTable(
    blocks,
    [
      "Rubro",
      "Descripción",
      "Programado",
      "Ejecutado"
    ],
    items.map(
      (item) => [
        cellText(item.rubro),
        cellText(
          item.descripcion || "—"
        ),
        formatMoney(
          item.programado
        ),
        formatMoney(
          item.ejecutado
        )
      ]
    )
  );

  pushParagraph(
    blocks,
    `Total programado: ${formatMoney(programmed)}. Total ejecutado: ${formatMoney(executed)}. Ejecución: ${
      programmed > 0
        ? formatPercent(
            executed / programmed * 100
          )
        : "—"
    }.`,
    {
      bold: true
    }
  );
}

function renderEvidenceToBlocks(
  blocks,
  activity
) {
  const evidence =
    arr(activity.evidencias);

  if (!evidence.length) {
    pushParagraph(
      blocks,
      "Sin evidencias registradas.",
      {
        italic: true
      }
    );

    return;
  }

  pushTable(
    blocks,
    [
      "Evidencia",
      "Tipo",
      "Fecha",
      "Descripción / vínculo"
    ],
    evidence.map(
      (item) => [
        cellText(item.nombre),
        cellText(item.tipo || "—"),
        humanDate(item.fecha),
        item.url
          ? {
              text:
                `${item.descripcion || "Abrir evidencia"}`,
              url: item.url
            }
          : cellText(
              item.descripcion || "—"
            )
      ]
    )
  );
}

function renderActivityFollowupsToBlocks(
  blocks,
  activity
) {
  const followups =
    arr(activity.seguimientos);

  if (!followups.length) {
    pushParagraph(
      blocks,
      "Sin seguimientos narrativos registrados.",
      {
        italic: true
      }
    );

    return;
  }

  followups.forEach((followup) => {
    pushHeading(
      blocks,
      5,
      `Corte ${humanDate(followup.fecha_corte)}`
    );

    pushParagraph(
      blocks,
      followup.resumen,
      {
        label: "Resumen"
      }
    );

    pushParagraph(
      blocks,
      followup.logros,
      {
        label: "Logros"
      }
    );

    pushParagraph(
      blocks,
      followup.dificultades,
      {
        label: "Dificultades"
      }
    );

    pushParagraph(
      blocks,
      followup.proximos_pasos,
      {
        label: "Próximos pasos"
      }
    );
  });
}

function renderActivityToBlocks(
  blocks,
  activity
) {
  const metric =
    activityMetric(activity);

  pushHeading(
    blocks,
    4,
    activity.codigo
      ? `${activity.codigo} - ${activity.nombre}`
      : activity.nombre
  );

  pushTable(
    blocks,
    ["Campo", "Información"],
    infoRows([
      [
        "Estado",
        statusLabel(activity.estado)
      ],
      [
        "Responsable",
        activity.responsable || "—"
      ],
      [
        "Periodo",
        `${humanDate(activity.fecha_inicio)} - ${humanDate(activity.fecha_fin)}`
      ],
      [
        "Cumplimiento técnico",
        formatPercent(metric.progress)
      ]
    ]),
    {
      compact: true
    }
  );

  pushParagraph(
    blocks,
    activity.descripcion,
    {
      label: "Descripción"
    }
  );

  pushHeading(
    blocks,
    5,
    "Indicadores"
  );

  renderIndicatorsToBlocks(
    blocks,
    activity
  );

  pushHeading(
    blocks,
    5,
    "Presupuesto"
  );

  renderBudgetToBlocks(
    blocks,
    activity
  );

  pushHeading(
    blocks,
    5,
    "Evidencias"
  );

  renderEvidenceToBlocks(
    blocks,
    activity
  );

  pushHeading(
    blocks,
    5,
    "Seguimiento narrativo"
  );

  renderActivityFollowupsToBlocks(
    blocks,
    activity
  );
}

function renderProjectToBlocks({
  blocks,
  project,
  mandateMap,
  sourceMap,
  headingLevel = 3
}) {
  const metric =
    projectMetric(project);

  const projectMandates =
    arr(project.mandatos)
      .map(
        (ref) =>
          mandateMap.get(ref)
      )
      .filter(Boolean);

  pushHeading(
    blocks,
    headingLevel,
    project.codigo
      ? `${project.codigo} - ${project.nombre}`
      : project.nombre
  );

  pushTable(
    blocks,
    ["Campo", "Información"],
    infoRows([
      [
        "Estado",
        statusLabel(project.estado)
      ],
      [
        "Responsable",
        project.responsable || "—"
      ],
      [
        "Ponderación en Programa",
        formatPercent(
          project.ponderacion
        )
      ],
      [
        "Periodo",
        `${humanDate(project.fecha_inicio)} - ${humanDate(project.fecha_fin)}`
      ],
      [
        "Cumplimiento técnico",
        formatPercent(metric.progress)
      ],
      [
        "Cobertura de medición",
        formatPercent(metric.coverage)
      ],
      [
        "Presupuesto programado",
        metric.budget.programmed > 0
          ? formatMoney(
              metric.budget.programmed
            )
          : formatMoney(
              project.valor_estimado
            )
      ],
      [
        "Presupuesto ejecutado",
        formatMoney(
          metric.budget.executed
        )
      ],
      [
        "Ejecución presupuestal",
        formatPercent(
          metric.budget.execution
        )
      ]
    ])
  );

  pushParagraph(
    blocks,
    project.descripcion,
    {
      label: "Descripción"
    }
  );

  pushHeading(
    blocks,
    Math.min(
      headingLevel + 1,
      5
    ),
    "Objetivo del Proyecto"
  );

  pushParagraph(
    blocks,
    project.objetivo_general
  );

  pushHeading(
    blocks,
    Math.min(
      headingLevel + 1,
      5
    ),
    "Mandatos relacionados"
  );

  renderMandatesToBlocks(
    blocks,
    projectMandates,
    sourceMap,
    Math.min(
      headingLevel + 2,
      5
    )
  );

  pushHeading(
    blocks,
    Math.min(
      headingLevel + 1,
      5
    ),
    "Actividades"
  );

  if (
    !arr(project.actividades).length
  ) {
    pushParagraph(
      blocks,
      "El Proyecto no tiene Actividades registradas.",
      {
        italic: true
      }
    );
  } else {
    arr(project.actividades)
      .forEach((activity) => {
        renderActivityToBlocks(
          blocks,
          activity
        );
      });
  }
}

function renderProgramToBlocks({
  blocks,
  program,
  mandateMap,
  sourceMap
}) {
  const metric =
    programMetric(program);

  pushHeading(
    blocks,
    3,
    `Programa: ${program.nombre}`
  );

  pushTable(
    blocks,
    ["Campo", "Información"],
    infoRows([
      [
        "Estado",
        statusLabel(program.estado)
      ],
      [
        "Avance acreditado",
        formatPercent(
          metric.accredited
        )
      ],
      [
        "Cobertura de medición",
        formatPercent(
          metric.coverage
        )
      ]
    ]),
    {
      compact: true
    }
  );

  pushParagraph(
    blocks,
    program.descripcion
  );

  if (
    !arr(program.proyectos).length
  ) {
    pushParagraph(
      blocks,
      "No hay Proyectos registrados.",
      {
        italic: true
      }
    );

    return;
  }

  arr(program.proyectos)
    .forEach((project) => {
      renderProjectToBlocks({
        blocks,
        project,
        mandateMap,
        sourceMap,
        headingLevel: 4
      });
    });
}

function renderLineToBlocks({
  blocks,
  line,
  mandateMap,
  sourceMap
}) {
  const metric =
    lineMetric(line);

  pushHeading(
    blocks,
    2,
    `Línea de Acción: ${line.nombre}`
  );

  pushTable(
    blocks,
    ["Campo", "Información"],
    infoRows([
      [
        "Estado",
        statusLabel(line.estado)
      ],
      [
        "Avance acreditado",
        formatPercent(
          metric.accredited
        )
      ],
      [
        "Cobertura de medición",
        formatPercent(
          metric.coverage
        )
      ]
    ]),
    {
      compact: true
    }
  );

  pushParagraph(
    blocks,
    line.descripcion
  );

  if (
    !arr(line.programas).length
  ) {
    pushParagraph(
      blocks,
      "No hay Programas registrados.",
      {
        italic: true
      }
    );

    return;
  }

  arr(line.programas)
    .forEach((program) => {
      renderProgramToBlocks({
        blocks,
        program,
        mandateMap,
        sourceMap
      });
    });
}

function auditMatchesConsejeria(
  note,
  consejeria
) {
  const navigation =
    note.navegacion || {};

  return (
    String(
      navigation.vigencia_consejeria_id ||
      ""
    ) ===
    String(consejeria.ref || "")
    ||
    normalize(
      navigation.consejeria_nombre
    ) ===
    normalize(
      consejeria.catalogo?.nombre_corto
    )
    ||
    normalize(
      navigation.consejeria_nombre
    ) ===
    normalize(
      consejeria.catalogo?.nombre_largo
    )
  );
}

function auditMatchesProject(
  note,
  context
) {
  const navigation =
    note.navegacion || {};

  if (
    context.projectId &&
    String(
      navigation.proyecto_id || ""
    ) ===
    String(context.projectId)
  ) {
    return true;
  }

  if (
    context.projectCode &&
    normalize(
      navigation.proyecto_codigo
    ) ===
    normalize(
      context.projectCode
    )
  ) {
    return true;
  }

  return (
    normalize(
      navigation.proyecto_nombre
    ) ===
    normalize(
      context.projectName
    )
    &&
    normalize(
      navigation.programa_nombre
    ) ===
    normalize(
      context.programName
    )
  );
}

function renderAuditToBlocks(
  blocks,
  notes
) {
  if (!notes.length) {
    pushParagraph(
      blocks,
      "No hay notas de Auditoría registradas para este alcance.",
      {
        italic: true
      }
    );

    return;
  }

  notes.forEach((note) => {
    pushHeading(
      blocks,
      3,
      note.tema
    );

    pushTable(
      blocks,
      ["Campo", "Información"],
      infoRows([
        [
          "Estado",
          statusLabel(note.estado)
        ],
        [
          "Referencia",
          note.ruta || "—"
        ],
        [
          "Autor",
          note.autor_email || "—"
        ],
        [
          "Fecha",
          humanDate(note.creado_en)
        ]
      ]),
      {
        compact: true
      }
    );

    pushParagraph(
      blocks,
      note.comentario,
      {
        label: "Comentario"
      }
    );

    if (note.respuesta) {
      pushParagraph(
        blocks,
        note.respuesta,
        {
          label:
            "Respuesta / acción realizada"
        }
      );
    }
  });
}

function renderConsejeriaToBlocks({
  blocks,
  consejeria,
  payload,
  includeAudit = true,
  topHeadingLevel = 1
}) {
  const sourceMap =
    new Map(
      arr(payload.fuentes_mandatos)
        .map(
          (source) => [
            source.ref,
            source
          ]
        )
    );

  const mandateMap =
    new Map(
      arr(payload.mandatos)
        .map(
          (mandate) => [
            mandate.ref,
            mandate
          ]
        )
    );

  const mandates =
    arr(payload.mandatos)
      .filter(
        (mandate) =>
          arr(mandate.consejerias)
            .includes(
              consejeria.ref
            )
      );

  const metric =
    consejeriaMetric(consejeria);

  const counts =
    scopeCounts([consejeria]);

  const budget =
    scopeBudget([consejeria]);

  const title =
    consejeria.catalogo?.nombre_corto ||
    consejeria.catalogo?.nombre_largo ||
    "Consejería";

  pushHeading(
    blocks,
    topHeadingLevel,
    `Consejería: ${title}`
  );

  pushTable(
    blocks,
    ["Campo", "Información"],
    infoRows([
      [
        "Nombre institucional",
        consejeria.catalogo?.nombre_largo ||
        title
      ],
      [
        "Responsable",
        consejeria.participacion?.responsable ||
        "—"
      ],
      [
        "Pueblo",
        consejeria.participacion?.pueblo ||
        "—"
      ],
      [
        "Estado",
        statusLabel(
          consejeria.participacion?.estado
        )
      ],
      [
        "Avance acreditado",
        formatPercent(
          metric.accredited
        )
      ],
      [
        "Cobertura de medición",
        formatPercent(
          metric.coverage
        )
      ],
      [
        "Presupuesto programado",
        formatMoney(
          budget.programmed
        )
      ],
      [
        "Presupuesto ejecutado",
        formatMoney(
          budget.executed
        )
      ],
      [
        "Ejecución presupuestal",
        formatPercent(
          budget.execution
        )
      ]
    ])
  );

  pushHeading(
    blocks,
    Math.min(
      topHeadingLevel + 1,
      5
    ),
    "Descripción institucional"
  );

  pushParagraph(
    blocks,
    consejeria.catalogo?.descripcion
  );

  pushHeading(
    blocks,
    Math.min(
      topHeadingLevel + 1,
      5
    ),
    "Funciones"
  );

  pushParagraph(
    blocks,
    consejeria.catalogo?.funciones
  );

  pushHeading(
    blocks,
    Math.min(
      topHeadingLevel + 1,
      5
    ),
    "Contexto de la Vigencia"
  );

  pushParagraph(
    blocks,
    consejeria.participacion?.detalle
  );

  pushHeading(
    blocks,
    Math.min(
      topHeadingLevel + 1,
      5
    ),
    "Resumen de estructura"
  );

  pushMetrics(
    blocks,
    [
      {
        label: "Líneas de Acción",
        value: counts.lineas
      },
      {
        label: "Programas",
        value: counts.programas
      },
      {
        label: "Proyectos",
        value: counts.proyectos
      },
      {
        label: "Actividades",
        value: counts.actividades
      }
    ]
  );

  pushHeading(
    blocks,
    Math.min(
      topHeadingLevel + 1,
      5
    ),
    "Mandatos asignados"
  );

  renderMandatesToBlocks(
    blocks,
    mandates,
    sourceMap,
    Math.min(
      topHeadingLevel + 2,
      5
    )
  );

  pushHeading(
    blocks,
    Math.min(
      topHeadingLevel + 1,
      5
    ),
    "Biblioteca documental"
  );

  renderLibraryToBlocks(
    blocks,
    arr(consejeria.biblioteca)
  );

  arr(consejeria.lineas)
    .forEach((line) => {
      renderLineToBlocks({
        blocks,
        line,
        mandateMap,
        sourceMap
      });
    });

  if (includeAudit) {
    pushHeading(
      blocks,
      Math.min(
        topHeadingLevel + 1,
        5
      ),
      "Auditoría de la Consejería"
    );

    renderAuditToBlocks(
      blocks,
      arr(payload.auditoria)
        .filter(
          (note) =>
            auditMatchesConsejeria(
              note,
              consejeria
            )
        )
    );
  }
}

function buildVigenciaDocument(payload) {
  const vigencia =
    payload.vigencia || {};

  const blocks = [];

  const counts =
    scopeCounts(
      arr(payload.consejerias)
    );

  const budget =
    scopeBudget(
      arr(payload.consejerias)
    );

  const metric =
    vigenciaMetric(payload);

  const sourceMap =
    new Map(
      arr(payload.fuentes_mandatos)
        .map(
          (source) => [
            source.ref,
            source
          ]
        )
    );

  pushHeading(
    blocks,
    1,
    "Información general"
  );

  pushTable(
    blocks,
    ["Campo", "Información"],
    infoRows([
      [
        "Nombre",
        vigencia.nombre || "—"
      ],
      [
        "Periodo",
        `${humanDate(vigencia.fecha_inicio)} - ${humanDate(vigencia.fecha_fin)}`
      ],
      [
        "Lema",
        vigencia.lema || "—"
      ],
      [
        "Estado",
        statusLabel(vigencia.estado)
      ],
      [
        "Avance acreditado",
        formatPercent(
          metric.accredited
        )
      ],
      [
        "Cobertura de medición",
        formatPercent(
          metric.coverage
        )
      ],
      [
        "Presupuesto programado",
        formatMoney(
          budget.programmed
        )
      ],
      [
        "Presupuesto ejecutado",
        formatMoney(
          budget.executed
        )
      ],
      [
        "Ejecución presupuestal",
        formatPercent(
          budget.execution
        )
      ]
    ])
  );

  pushHeading(
    blocks,
    2,
    "Descripción"
  );

  pushParagraph(
    blocks,
    vigencia.descripcion
  );

  pushHeading(
    blocks,
    1,
    "Resumen de estructura"
  );

  pushMetrics(
    blocks,
    [
      {
        label: "Consejerías",
        value: counts.consejerias
      },
      {
        label: "Líneas de Acción",
        value: counts.lineas
      },
      {
        label: "Programas",
        value: counts.programas
      },
      {
        label: "Proyectos",
        value: counts.proyectos
      },
      {
        label: "Actividades",
        value: counts.actividades
      },
      {
        label: "Indicadores",
        value: counts.indicadores
      }
    ]
  );

  pushHeading(
    blocks,
    1,
    "Mandatos de la Vigencia"
  );

  renderMandatesToBlocks(
    blocks,
    arr(payload.mandatos),
    sourceMap,
    2
  );

  arr(payload.consejerias)
    .forEach((consejeria) => {
      blocks.push({
        type: "pageBreak"
      });

      renderConsejeriaToBlocks({
        blocks,
        consejeria,
        payload,
        includeAudit: false,
        topHeadingLevel: 1
      });
    });

  blocks.push({
    type: "pageBreak"
  });

  pushHeading(
    blocks,
    1,
    "Auditoría de la Vigencia"
  );

  renderAuditToBlocks(
    blocks,
    arr(payload.auditoria)
  );

  return {
    title:
      "Documento integral de la Vigencia",
    subtitle:
      vigencia.nombre || "Vigencia",
    vigencia,
    blocks,
    filename:
      `vigencia_${safeFilename(vigencia.nombre)}`
  };
}

function buildConsejeriaDocument(
  payload,
  context
) {
  const vigencia =
    payload.vigencia || {};

  const consejeria =
    findConsejeria(
      payload,
      context
    );

  if (!consejeria) {
    throw new Error(
      "No fue posible localizar la Consejería dentro de la Vigencia."
    );
  }

  const title =
    consejeria.catalogo?.nombre_corto ||
    consejeria.catalogo?.nombre_largo ||
    "Consejería";

  const blocks = [];

  renderConsejeriaToBlocks({
    blocks,
    consejeria,
    payload,
    includeAudit: true,
    topHeadingLevel: 1
  });

  return {
    title:
      "Documento integral de Consejería",
    subtitle: title,
    vigencia,
    blocks,
    filename:
      `consejeria_${safeFilename(title)}_${safeFilename(vigencia.nombre)}`
  };
}

function buildProjectDocument(
  payload,
  context
) {
  const found =
    findProject(
      payload,
      context
    );

  if (!found) {
    throw new Error(
      "No fue posible localizar el Proyecto dentro de la Vigencia."
    );
  }

  const {
    consejeria,
    line,
    program,
    project
  } = found;

  const vigencia =
    payload.vigencia || {};

  const sourceMap =
    new Map(
      arr(payload.fuentes_mandatos)
        .map(
          (source) => [
            source.ref,
            source
          ]
        )
    );

  const mandateMap =
    new Map(
      arr(payload.mandatos)
        .map(
          (mandate) => [
            mandate.ref,
            mandate
          ]
        )
    );

  const blocks = [];

  pushHeading(
    blocks,
    1,
    "Ubicación estratégica"
  );

  pushTable(
    blocks,
    ["Nivel", "Elemento"],
    [
      [
        "Consejería",
        consejeria.catalogo?.nombre_largo ||
        consejeria.catalogo?.nombre_corto ||
        "—"
      ],
      [
        "Línea de Acción",
        line.nombre
      ],
      [
        "Programa",
        program.nombre
      ]
    ]
  );

  renderProjectToBlocks({
    blocks,
    project,
    mandateMap,
    sourceMap,
    headingLevel: 1
  });

  blocks.push({
    type: "pageBreak"
  });

  pushHeading(
    blocks,
    1,
    "Auditoría del Proyecto"
  );

  renderAuditToBlocks(
    blocks,
    arr(payload.auditoria)
      .filter(
        (note) =>
          auditMatchesProject(
            note,
            context
          )
      )
  );

  return {
    title:
      "Documento integral de Proyecto",
    subtitle:
      project.codigo
        ? `${project.codigo} - ${project.nombre}`
        : project.nombre,
    vigencia,
    blocks,
    filename:
      `proyecto_${safeFilename(project.codigo || project.nombre)}`
  };
}

function createDocumentModel(
  scope,
  payload,
  context
) {
  if (scope === "vigencia") {
    return buildVigenciaDocument(
      payload
    );
  }

  if (scope === "consejeria") {
    return buildConsejeriaDocument(
      payload,
      context
    );
  }

  if (scope === "proyecto") {
    return buildProjectDocument(
      payload,
      context
    );
  }

  throw new Error(
    "Tipo de documento no compatible."
  );
}

function summaryForScope(
  scope,
  payload,
  context
) {
  if (scope === "vigencia") {
    const counts =
      scopeCounts(
        arr(payload.consejerias)
      );

    const metric =
      vigenciaMetric(payload);

    return {
      title:
        payload.vigencia?.nombre ||
        "Vigencia",
      counts,
      progress:
        metric.accredited,
      coverage:
        metric.coverage
    };
  }

  if (scope === "consejeria") {
    const consejeria =
      findConsejeria(
        payload,
        context
      );

    if (!consejeria) {
      throw new Error(
        "No se encontró la Consejería."
      );
    }

    const metric =
      consejeriaMetric(
        consejeria
      );

    return {
      title:
        consejeria.catalogo?.nombre_corto ||
        consejeria.catalogo?.nombre_largo ||
        "Consejería",
      counts:
        scopeCounts(
          [consejeria]
        ),
      progress:
        metric.accredited,
      coverage:
        metric.coverage
    };
  }

  const found =
    findProject(
      payload,
      context
    );

  if (!found) {
    throw new Error(
      "No se encontró el Proyecto."
    );
  }

  const metric =
    projectMetric(
      found.project
    );

  return {
    title:
      found.project.nombre,
    counts: {
      proyectos: 1,
      actividades:
        arr(
          found.project.actividades
        ).length,
      indicadores:
        arr(
          found.project.actividades
        ).reduce(
          (sum, activity) =>
            sum +
            arr(
              activity.indicadores
            ).length,
          0
        )
    },
    progress:
      metric.progress,
    coverage:
      metric.coverage
  };
}

/* ==========================================================
   Logo
   ========================================================== */

async function fetchLogoAssets() {
  const response =
    await fetch(
      LOGO_PATH,
      {
        cache: "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      "No fue posible cargar el logo ONIC."
    );
  }

  const blob =
    await response.blob();

  const arrayBuffer =
    await blob.arrayBuffer();

  const dataUrl =
    await new Promise(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onload =
          () =>
            resolve(
              reader.result
            );

        reader.onerror =
          reject;

        reader.readAsDataURL(
          blob
        );
      }
    );

  return {
    dataUrl,
    bytes:
      new Uint8Array(
        arrayBuffer
      )
  };
}

/* ==========================================================
   Generación de PDF
   ========================================================== */

function pdfCell(value) {
  if (
    value &&
    typeof value === "object" &&
    value.url
  ) {
    return {
      text:
        String(
          value.text ||
          value.url
        ),
      link: value.url,
      color: "#A30C22",
      decoration: "underline",
      fontSize: 8
    };
  }

  return {
    text:
      String(
        value ?? "—"
      ),
    fontSize: 8
  };
}

function pdfHeading(block) {
  const styles = {
    1: "heading1",
    2: "heading2",
    3: "heading3",
    4: "heading4",
    5: "heading5"
  };

  return {
    text: block.text,
    style:
      styles[block.level] ||
      "heading4",
    tocItem:
      block.level <= 3,
    margin:
      block.level <= 2
        ? [0, 12, 0, 6]
        : [0, 8, 0, 4]
  };
}

function pdfTable(block) {
  const body = [
    block.headers.map(
      (header) => ({
        text: String(header),
        style: "tableHeader"
      })
    ),

    ...block.rows.map(
      (row) =>
        row.map(pdfCell)
    )
  ];

  return {
    table: {
      headerRows: 1,
      widths:
        block.headers.length === 2
          ? ["27%", "*"]
          : Array(
              block.headers.length
            ).fill("*"),
      body
    },

    layout: {
      fillColor:
        (rowIndex) =>
          rowIndex === 0
            ? "#EAF1E6"
            : null,

      hLineColor: () =>
        "#CBD4C6",

      vLineColor: () =>
        "#CBD4C6",

      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 4,
      paddingBottom: () => 4
    },

    margin:
      block.compact
        ? [0, 3, 0, 6]
        : [0, 5, 0, 9]
  };
}

function pdfMetrics(block) {
  const items =
    arr(block.items);

  const rows = [];

  for (
    let index = 0;
    index < items.length;
    index += 2
  ) {
    const left =
      items[index];

    const right =
      items[index + 1];

    rows.push([
      {
        stack: [
          {
            text:
              left?.label ||
              "",
            style:
              "metricLabel"
          },
          {
            text:
              String(
                left?.value ??
                "—"
              ),
            style:
              "metricValue"
          }
        ],
        fillColor:
          "#F3F6F0",
        margin:
          [7, 7, 7, 7]
      },

      right
        ? {
            stack: [
              {
                text:
                  right.label,
                style:
                  "metricLabel"
              },
              {
                text:
                  String(
                    right.value ??
                    "—"
                  ),
                style:
                  "metricValue"
              }
            ],
            fillColor:
              "#F3F6F0",
            margin:
              [7, 7, 7, 7]
          }
        : {
            text: "",
            fillColor:
              "#FFFFFF"
          }
    ]);
  }

  return {
    table: {
      widths:
        ["*", "*"],
      body: rows
    },

    layout: {
      hLineColor: () =>
        "#FFFFFF",
      vLineColor: () =>
        "#FFFFFF"
    },

    margin:
      [0, 4, 0, 9]
  };
}

function buildPdfDefinition(
  model,
  logoDataUrl
) {
  const content = [
    {
      stack: [
        {
          image:
            logoDataUrl,
          width: 132,
          alignment:
            "center",
          margin:
            [0, 38, 0, 20]
        },
        {
          text:
            "ORGANIZACIÓN NACIONAL INDÍGENA DE COLOMBIA - ONIC",
          style:
            "coverInstitution",
          alignment:
            "center"
        },
        {
          text:
            model.title,
          style:
            "coverTitle",
          alignment:
            "center",
          margin:
            [25, 22, 25, 8]
        },
        {
          text:
            model.subtitle,
          style:
            "coverSubtitle",
          alignment:
            "center"
        },
        {
          margin:
            [80, 45, 80, 0],
          table: {
            widths:
              [90, "*"],
            body: [
              [
                {
                  text:
                    "Vigencia",
                  bold: true
                },
                {
                  text:
                    model.vigencia?.nombre ||
                    "—"
                }
              ],
              [
                {
                  text:
                    "Periodo",
                  bold: true
                },
                {
                  text:
                    `${humanDate(model.vigencia?.fecha_inicio)} - ${humanDate(model.vigencia?.fecha_fin)}`
                }
              ],
              [
                {
                  text:
                    "Estado",
                  bold: true
                },
                {
                  text:
                    statusLabel(
                      model.vigencia?.estado
                    )
                }
              ],
              [
                {
                  text:
                    "Generado",
                  bold: true
                },
                {
                  text:
                    todayLabel()
                }
              ]
            ]
          },
          layout:
            "lightHorizontalLines"
        }
      ],
      pageBreak:
        "after"
    },

    {
      toc: {
        title: {
          text:
            "Contenido",
          style:
            "heading1"
        },
        numberStyle: {
          color:
            "#0F4230"
        }
      },
      pageBreak:
        "after"
    }
  ];

  model.blocks.forEach(
    (block) => {
      if (
        block.type ===
        "heading"
      ) {
        content.push(
          pdfHeading(block)
        );

        return;
      }

      if (
        block.type ===
        "paragraph"
      ) {
        const stack = [];

        if (block.label) {
          stack.push({
            text:
              `${block.label}.`,
            bold: true,
            color:
              "#0F4230",
            fontSize: 9,
            margin:
              [0, 2, 0, 2]
          });
        }

        stack.push({
          text:
            block.text,
          fontSize: 9,
          italics:
            Boolean(
              block.italic
            ),
          bold:
            Boolean(
              block.bold
            ),
          alignment:
            "justify",
          lineHeight:
            1.15
        });

        content.push({
          stack,
          margin:
            [0, 2, 0, 7]
        });

        return;
      }

      if (
        block.type ===
        "table"
      ) {
        content.push(
          pdfTable(block)
        );

        return;
      }

      if (
        block.type ===
        "metrics"
      ) {
        content.push(
          pdfMetrics(block)
        );

        return;
      }

      if (
        block.type ===
        "pageBreak"
      ) {
        content.push({
          text: "",
          pageBreak:
            "before"
        });
      }
    }
  );

  return {
    pageSize:
      "LETTER",

    pageMargins:
      [48, 60, 48, 50],

    info: {
      title:
        `${model.title} - ${model.subtitle}`,
      author:
        "Organización Nacional Indígena de Colombia - ONIC",
      subject:
        "Sistema de Buen Gobierno",
      creator:
        "ONIC Buen Gobierno"
    },

    header:
      (currentPage) => {
        if (currentPage === 1) {
          return {
            text: ""
          };
        }

        return {
          columns: [
            {
              image:
                logoDataUrl,
              width: 24
            },
            {
              text:
                "ONIC - Sistema de Buen Gobierno",
              color:
                "#0F4230",
              bold: true,
              fontSize: 8,
              margin:
                [7, 7, 0, 0]
            }
          ],
          margin:
            [48, 20, 48, 0]
        };
      },

    footer:
      (currentPage, pageCount) => ({
        columns: [
          {
            text:
              model.subtitle,
            color:
              "#66716B",
            fontSize: 7
          },
          {
            text:
              `Página ${currentPage} de ${pageCount}`,
            alignment:
              "right",
            color:
              "#66716B",
            fontSize: 7
          }
        ],
        margin:
          [48, 0, 48, 20]
      }),

    content,

    defaultStyle: {
      font:
        "Roboto",
      fontSize:
        9,
      color:
        "#26312C"
    },

    styles: {
      coverInstitution: {
        fontSize: 15,
        bold: true,
        color:
          "#0F4230"
      },

      coverTitle: {
        fontSize: 24,
        bold: true,
        color:
          "#19231E"
      },

      coverSubtitle: {
        fontSize: 16,
        bold: true,
        color:
          "#A30C22"
      },

      heading1: {
        fontSize: 17,
        bold: true,
        color:
          "#0F4230"
      },

      heading2: {
        fontSize: 14,
        bold: true,
        color:
          "#0F4230"
      },

      heading3: {
        fontSize: 12,
        bold: true,
        color:
          "#A30C22"
      },

      heading4: {
        fontSize: 10.5,
        bold: true,
        color:
          "#0F4230"
      },

      heading5: {
        fontSize: 9.5,
        bold: true,
        color:
          "#55675C"
      },

      tableHeader: {
        fontSize: 8,
        bold: true,
        color:
          "#0F4230"
      },

      metricLabel: {
        fontSize: 7,
        bold: true,
        color:
          "#66716B"
      },

      metricValue: {
        fontSize: 15,
        bold: true,
        color:
          "#0F4230"
      }
    }
  };
}

async function downloadPdf(
  model,
  logo
) {
  if (
    !window.pdfMake ||
    typeof window.pdfMake.createPdf !==
      "function"
  ) {
    throw new Error(
      "El generador PDF no se cargó correctamente. Recarga la página y vuelve a intentarlo."
    );
  }

  const definition =
    buildPdfDefinition(
      model,
      logo.dataUrl
    );

  window.pdfMake
    .createPdf(definition)
    .download(
      `${model.filename}.pdf`
    );
}

/* ==========================================================
   Generación de Word
   ========================================================== */

function requireDocx() {
  if (!window.docx) {
    throw new Error(
      "El generador Word no se cargó correctamente. Recarga la página y vuelve a intentarlo."
    );
  }

  return window.docx;
}

function wordTextRun(
  text,
  options = {}
) {
  const {
    TextRun
  } = requireDocx();

  return new TextRun({
    text:
      String(text ?? ""),
    bold:
      Boolean(
        options.bold
      ),
    italics:
      Boolean(
        options.italic
      ),
    color:
      options.color,
    size:
      options.size,
    font:
      "Arial"
  });
}

function wordParagraphFromText(
  text,
  options = {}
) {
  const {
    Paragraph,
    AlignmentType
  } = requireDocx();

  const children = [];

  if (options.label) {
    children.push(
      wordTextRun(
        `${options.label}. `,
        {
          bold: true,
          color:
            "0F4230"
        }
      )
    );
  }

  children.push(
    wordTextRun(
      String(text ?? "—"),
      {
        bold:
          options.bold,
        italic:
          options.italic
      }
    )
  );

  return new Paragraph({
    children,
    alignment:
      options.center
        ? AlignmentType.CENTER
        : options.right
          ? AlignmentType.RIGHT
          : AlignmentType.JUSTIFIED,
    spacing: {
      after:
        options.after ?? 120,
      line:
        276
    }
  });
}

function wordHeading(
  block
) {
  const {
    Paragraph,
    HeadingLevel
  } = requireDocx();

  const levels = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5
  };

  return new Paragraph({
    text:
      String(block.text),
    heading:
      levels[block.level] ||
      HeadingLevel.HEADING_4,
    spacing: {
      before:
        block.level <= 2
          ? 240
          : 160,
      after: 100
    }
  });
}

function wordCellChildren(value) {
  const {
    Paragraph,
    ExternalHyperlink,
    TextRun
  } = requireDocx();

  if (
    value &&
    typeof value === "object" &&
    value.url
  ) {
    return [
      new Paragraph({
        children: [
          new ExternalHyperlink({
            link: value.url,
            children: [
              new TextRun({
                text:
                  String(
                    value.text ||
                    "Abrir vínculo"
                  ),
                style:
                  "Hyperlink"
              })
            ]
          })
        ]
      })
    ];
  }

  return [
    new Paragraph({
      children: [
        wordTextRun(
          String(value ?? "—"),
          {
            size: 18
          }
        )
      ],
      spacing: {
        after: 0
      }
    })
  ];
}

function wordTable(block) {
  const {
    Table,
    TableRow,
    TableCell,
    WidthType,
    ShadingType
  } = requireDocx();

  const header =
    new TableRow({
      tableHeader: true,
      children:
        block.headers.map(
          (headerText) =>
            new TableCell({
              shading: {
                fill:
                  "EAF1E6",
                type:
                  ShadingType.CLEAR
              },
              children: [
                new (requireDocx().Paragraph)({
                  children: [
                    wordTextRun(
                      headerText,
                      {
                        bold: true,
                        color:
                          "0F4230",
                        size: 18
                      }
                    )
                  ]
                })
              ]
            })
        )
    });

  const rows =
    block.rows.map(
      (row) =>
        new TableRow({
          children:
            row.map(
              (cell) =>
                new TableCell({
                  children:
                    wordCellChildren(
                      cell
                    )
                })
            )
        })
    );

  return new Table({
    width: {
      size: 100,
      type:
        WidthType.PERCENTAGE
    },
    rows: [
      header,
      ...rows
    ]
  });
}

function wordMetrics(block) {
  const {
    Table,
    TableRow,
    TableCell,
    WidthType,
    Paragraph,
    ShadingType
  } = requireDocx();

  const rows = [];

  for (
    let index = 0;
    index < block.items.length;
    index += 2
  ) {
    const pair = [
      block.items[index],
      block.items[index + 1]
    ];

    rows.push(
      new TableRow({
        children:
          pair.map((item) =>
            new TableCell({
              shading: {
                fill:
                  item
                    ? "F3F6F0"
                    : "FFFFFF",
                type:
                  ShadingType.CLEAR
              },

              children:
                item
                  ? [
                      new Paragraph({
                        children: [
                          wordTextRun(
                            item.label,
                            {
                              bold: true,
                              color:
                                "66716B",
                              size: 16
                            }
                          )
                        ],
                        spacing: {
                          after: 40
                        }
                      }),

                      new Paragraph({
                        children: [
                          wordTextRun(
                            item.value,
                            {
                              bold: true,
                              color:
                                "0F4230",
                              size: 28
                            }
                          )
                        ]
                      })
                    ]
                  : [
                      new Paragraph("")
                    ]
            })
          )
      })
    );
  }

  return new Table({
    width: {
      size: 100,
      type:
        WidthType.PERCENTAGE
    },
    rows
  });
}

function wordPageBreak() {
  const {
    Paragraph,
    PageBreak
  } = requireDocx();

  return new Paragraph({
    children: [
      new PageBreak()
    ]
  });
}

function buildWordChildren(
  model,
  logoBytes
) {
  const {
    Paragraph,
    ImageRun,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
    TableOfContents
  } = requireDocx();

  const children = [
    new Paragraph({
      alignment:
        AlignmentType.CENTER,
      spacing: {
        before: 480,
        after: 240
      },
      children: [
        new ImageRun({
          data: logoBytes,
          transformation: {
            width: 190,
            height: 190
          }
        })
      ]
    }),

    new Paragraph({
      alignment:
        AlignmentType.CENTER,
      children: [
        wordTextRun(
          "ORGANIZACIÓN NACIONAL INDÍGENA DE COLOMBIA - ONIC",
          {
            bold: true,
            color:
              "0F4230",
            size: 28
          }
        )
      ],
      spacing: {
        after: 360
      }
    }),

    new Paragraph({
      alignment:
        AlignmentType.CENTER,
      children: [
        wordTextRun(
          model.title,
          {
            bold: true,
            size: 42
          }
        )
      ],
      spacing: {
        after: 160
      }
    }),

    new Paragraph({
      alignment:
        AlignmentType.CENTER,
      children: [
        wordTextRun(
          model.subtitle,
          {
            bold: true,
            color:
              "A30C22",
            size: 30
          }
        )
      ],
      spacing: {
        after: 500
      }
    }),

    new Table({
      width: {
        size: 70,
        type:
          WidthType.PERCENTAGE
      },
      alignment:
        requireDocx().AlignmentType.CENTER,
      rows: [
        [
          "Vigencia",
          model.vigencia?.nombre ||
          "—"
        ],
        [
          "Periodo",
          `${humanDate(model.vigencia?.fecha_inicio)} - ${humanDate(model.vigencia?.fecha_fin)}`
        ],
        [
          "Estado",
          statusLabel(
            model.vigencia?.estado
          )
        ],
        [
          "Generado",
          todayLabel()
        ]
      ].map(
        ([label, value]) =>
          new TableRow({
            children: [
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      wordTextRun(
                        label,
                        {
                          bold: true,
                          color:
                            "0F4230"
                        }
                      )
                    ]
                  })
                ]
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      wordTextRun(
                        value
                      )
                    ]
                  })
                ]
              })
            ]
          })
      )
    }),

    wordPageBreak(),

    new Paragraph({
      children: [
        wordTextRun(
          "Contenido",
          {
            bold: true,
            color:
              "0F4230",
            size: 32
          }
        )
      ],
      spacing: {
        after: 180
      }
    }),

    new TableOfContents(
      "Contenido",
      {
        hyperlink: true,
        headingStyleRange:
          "1-3"
      }
    ),

    wordPageBreak()
  ];

  model.blocks.forEach(
    (block) => {
      if (
        block.type ===
        "heading"
      ) {
        children.push(
          wordHeading(block)
        );

        return;
      }

      if (
        block.type ===
        "paragraph"
      ) {
        children.push(
          wordParagraphFromText(
            block.text,
            {
              label:
                block.label,
              bold:
                block.bold,
              italic:
                block.italic
            }
          )
        );

        return;
      }

      if (
        block.type ===
        "table"
      ) {
        children.push(
          wordTable(block)
        );

        children.push(
          new Paragraph("")
        );

        return;
      }

      if (
        block.type ===
        "metrics"
      ) {
        children.push(
          wordMetrics(block)
        );

        children.push(
          new Paragraph("")
        );

        return;
      }

      if (
        block.type ===
        "pageBreak"
      ) {
        children.push(
          wordPageBreak()
        );
      }
    }
  );

  return children;
}

async function downloadWord(
  model,
  logo
) {
  const {
    Document,
    Packer,
    Header,
    Footer,
    Paragraph,
    ImageRun,
    AlignmentType,
    TextRun,
    PageNumber
  } = requireDocx();

  const logoRun = () =>
    new ImageRun({
      data:
        logo.bytes,
      transformation: {
        width: 36,
        height: 36
      }
    });

  const document =
    new Document({
      creator:
        "Organización Nacional Indígena de Colombia - ONIC",

      title:
        `${model.title} - ${model.subtitle}`,

      description:
        "Documento generado por el Sistema de Buen Gobierno de la ONIC.",

      styles: {
        default: {
          document: {
            run: {
              font:
                "Arial",
              size: 20,
              color:
                "26312C"
            },
            paragraph: {
              spacing: {
                line: 276,
                after: 100
              }
            }
          }
        },

        paragraphStyles: [
          {
            id: "Heading1",
            name:
              "Heading 1",
            basedOn:
              "Normal",
            next:
              "Normal",
            quickFormat:
              true,
            run: {
              size: 32,
              bold: true,
              color:
                "0F4230",
              font:
                "Arial"
            },
            paragraph: {
              spacing: {
                before: 260,
                after: 120
              },
              outlineLevel: 0
            }
          },

          {
            id: "Heading2",
            name:
              "Heading 2",
            basedOn:
              "Normal",
            next:
              "Normal",
            quickFormat:
              true,
            run: {
              size: 27,
              bold: true,
              color:
                "0F4230",
              font:
                "Arial"
            },
            paragraph: {
              spacing: {
                before: 220,
                after: 100
              },
              outlineLevel: 1
            }
          },

          {
            id: "Heading3",
            name:
              "Heading 3",
            basedOn:
              "Normal",
            next:
              "Normal",
            quickFormat:
              true,
            run: {
              size: 23,
              bold: true,
              color:
                "A30C22",
              font:
                "Arial"
            },
            paragraph: {
              spacing: {
                before: 180,
                after: 90
              },
              outlineLevel: 2
            }
          },

          {
            id: "Heading4",
            name:
              "Heading 4",
            basedOn:
              "Normal",
            next:
              "Normal",
            quickFormat:
              true,
            run: {
              size: 21,
              bold: true,
              color:
                "0F4230",
              font:
                "Arial"
            },
            paragraph: {
              spacing: {
                before: 160,
                after: 80
              },
              outlineLevel: 3
            }
          },

          {
            id: "Heading5",
            name:
              "Heading 5",
            basedOn:
              "Normal",
            next:
              "Normal",
            quickFormat:
              true,
            run: {
              size: 20,
              bold: true,
              color:
                "55675C",
              font:
                "Arial"
            },
            paragraph: {
              spacing: {
                before: 140,
                after: 70
              },
              outlineLevel: 4
            }
          }
        ]
      },

      sections: [
        {
          properties: {
            titlePage: true,
            page: {
              margin: {
                top: 900,
                right: 900,
                bottom: 900,
                left: 900,
                header: 420,
                footer: 420
              }
            }
          },

          headers: {
            first:
              new Header({
                children: [
                  new Paragraph("")
                ]
              }),

            default:
              new Header({
                children: [
                  new Paragraph({
                    children: [
                      logoRun(),

                      wordTextRun(
                        "  ONIC - Sistema de Buen Gobierno",
                        {
                          bold: true,
                          color:
                            "0F4230",
                          size: 17
                        }
                      )
                    ],
                    spacing: {
                      after: 0
                    }
                  })
                ]
              })
          },

          footers: {
            first:
              new Footer({
                children: [
                  new Paragraph("")
                ]
              }),

            default:
              new Footer({
                children: [
                  new Paragraph({
                    alignment:
                      AlignmentType.RIGHT,
                    children: [
                      new TextRun({
                        children: [
                          "Página ",
                          PageNumber.CURRENT,
                          " de ",
                          PageNumber.TOTAL_PAGES
                        ],
                        font:
                          "Arial",
                        size: 16,
                        color:
                          "66716B"
                      })
                    ]
                  })
                ]
              })
          },

          children:
            buildWordChildren(
              model,
              logo.bytes
            )
        }
      ]
    });

  const blob =
    await Packer.toBlob(
      document
    );

  downloadBlob(
    blob,
    `${model.filename}.docx`
  );
}

function downloadBlob(
  blob,
  filename
) {
  const url =
    URL.createObjectURL(blob);

  const anchor =
    document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(
    () =>
      URL.revokeObjectURL(url),
    1200
  );
}

/* ==========================================================
   UI
   ========================================================== */

function scopeLabel(scope) {
  const map = {
    vigencia:
      "Vigencia completa",
    consejeria:
      "Consejería completa",
    proyecto:
      "Proyecto completo"
  };

  return (
    map[scope] ||
    "Documento"
  );
}

export async function openDocumentReportDialog({
  scope,
  vigenciaId,
  context = {}
}) {
  openModal({
    title:
      "Generar documento",

    content: `
      <div class="document-report-loading">
        <div class="document-report-spinner"></div>

        <div>
          <strong>
            Preparando ${escapeHTML(
              scopeLabel(scope)
            )}…
          </strong>

          <p>
            El sistema está consolidando la información
            para generar el PDF y el documento Word.
          </p>
        </div>
      </div>
    `
  });

  let payload;
  let model;
  let summary;

  try {
    payload =
      await getVigenciaPayload(
        vigenciaId
      );

    model =
      createDocumentModel(
        scope,
        payload,
        context
      );

    summary =
      summaryForScope(
        scope,
        payload,
        context
      );
  } catch (error) {
    console.error(error);

    openModal({
      title:
        "No fue posible generar el documento",

      content: `
        <div class="danger-callout">
          <strong>
            La generación fue cancelada.
          </strong>

          <p>
            ${escapeHTML(
              error.message ||
              "No fue posible consolidar la información."
            )}
          </p>
        </div>

        <div class="form-actions">
          <button
            id="closeDocumentReportError"
            class="btn btn-secondary"
            type="button"
          >
            Cerrar
          </button>
        </div>
      `
    });

    document
      .querySelector(
        "#closeDocumentReportError"
      )
      .addEventListener(
        "click",
        closeModal
      );

    return;
  }

  const counts =
    summary.counts;

  openModal({
    title:
      "Generar documento",

    content: `
      <div class="document-report-heading">
        <span class="document-report-icon">
          ${documentReportIcon()}
        </span>

        <div>
          <span class="context-label">
            ${escapeHTML(
              scopeLabel(scope)
            )}
          </span>

          <strong>
            ${escapeHTML(
              summary.title
            )}
          </strong>

          <p>
            El documento se genera directamente desde
            los datos registrados en el sistema.
          </p>
        </div>
      </div>

      <div class="document-report-summary">
        <div>
          <span>Proyectos</span>
          <strong>
            ${counts.proyectos ?? "—"}
          </strong>
        </div>

        <div>
          <span>Actividades</span>
          <strong>
            ${counts.actividades ?? "—"}
          </strong>
        </div>

        <div>
          <span>Indicadores</span>
          <strong>
            ${counts.indicadores ?? "—"}
          </strong>
        </div>

        <div>
          <span>Cobertura</span>
          <strong>
            ${escapeHTML(
              formatPercent(
                summary.coverage
              )
            )}
          </strong>
        </div>
      </div>

      <div class="document-report-features">
        <strong>
          Contenido
        </strong>

        <div>
          <span>✓ Portada institucional ONIC</span>
          <span>✓ Estructura estratégica</span>
          <span>✓ Mandatos relacionados</span>
          <span>✓ Actividades e indicadores</span>
          <span>✓ Presupuesto y ejecución</span>
          <span>✓ Evidencias y seguimientos</span>
          <span>✓ Auditoría y notas</span>
          ${
            scope !== "proyecto"
              ? "<span>✓ Biblioteca documental</span>"
              : ""
          }
        </div>
      </div>

      <div class="document-format-grid">
        <button
          id="downloadDocumentPdf"
          class="document-format-card pdf"
          type="button"
        >
          <span class="document-format-icon">
            PDF
          </span>

          <strong>
            Descargar PDF
          </strong>

          <small>
            Documento final listo para lectura,
            envío o archivo.
          </small>
        </button>

        <button
          id="downloadDocumentWord"
          class="document-format-card word"
          type="button"
        >
          <span class="document-format-icon">
            W
          </span>

          <strong>
            Descargar Word
          </strong>

          <small>
            Documento Word editable para
            ajustes posteriores.
          </small>
        </button>
      </div>

      <p
        id="documentReportMessage"
        class="form-message"
      ></p>

      <div class="form-actions">
        <button
          id="closeDocumentReport"
          class="btn btn-secondary"
          type="button"
        >
          Cerrar
        </button>
      </div>
    `
  });

  const message =
    document.querySelector(
      "#documentReportMessage"
    );

  const pdfButton =
    document.querySelector(
      "#downloadDocumentPdf"
    );

  const wordButton =
    document.querySelector(
      "#downloadDocumentWord"
    );

  document
    .querySelector(
      "#closeDocumentReport"
    )
    .addEventListener(
      "click",
      closeModal
    );

  let logoCache = null;

  async function logo() {
    if (!logoCache) {
      logoCache =
        await fetchLogoAssets();
    }

    return logoCache;
  }

  pdfButton.addEventListener(
    "click",
    async () => {
      pdfButton.disabled = true;
      wordButton.disabled = true;

      pdfButton.querySelector(
        "strong"
      ).textContent =
        "Generando PDF…";

      message.textContent = "";

      try {
        await downloadPdf(
          model,
          await logo()
        );

        message.textContent =
          "PDF generado correctamente.";
      } catch (error) {
        console.error(error);

        message.textContent =
          error.message ||
          "No fue posible generar el PDF.";
      } finally {
        pdfButton.disabled = false;
        wordButton.disabled = false;

        pdfButton.querySelector(
          "strong"
        ).textContent =
          "Descargar PDF";
      }
    }
  );

  wordButton.addEventListener(
    "click",
    async () => {
      pdfButton.disabled = true;
      wordButton.disabled = true;

      wordButton.querySelector(
        "strong"
      ).textContent =
        "Generando Word…";

      message.textContent = "";

      try {
        await downloadWord(
          model,
          await logo()
        );

        message.textContent =
          "Documento Word generado correctamente.";
      } catch (error) {
        console.error(error);

        message.textContent =
          error.message ||
          "No fue posible generar el documento Word.";
      } finally {
        pdfButton.disabled = false;
        wordButton.disabled = false;

        wordButton.querySelector(
          "strong"
        ).textContent =
          "Descargar Word";
      }
    }
  );
}

export function documentReportIcon() {
  return `
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M6 3h8l4 4v14H6z"></path>
      <path d="M14 3v5h5"></path>
      <path d="M9 12h6"></path>
      <path d="M9 16h6"></path>
    </svg>
  `;
}
