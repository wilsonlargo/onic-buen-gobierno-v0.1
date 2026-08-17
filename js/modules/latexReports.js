import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";

const REPORT_VERSION = "1.0";
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
  return String(value || "informe")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 110) || "informe";
}

function todayISO() {
  const date = new Date();
  const local = new Date(
    date.getTime() -
    date.getTimezoneOffset() * 60000
  );

  return local.toISOString().slice(0, 10);
}

function humanDate(value) {
  if (!value) return "—";

  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? new Date(`${value}T00:00:00`)
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
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

  items.forEach((item, index) => {
    map.set(item, 0);
  });

  if (!items.length) return map;

  const totalUnits = 10000;
  const base = Math.floor(totalUnits / items.length);
  const remainder =
    totalUnits - base * items.length;

  items.forEach((item, index) => {
    map.set(
      item,
      (base + (index < remainder ? 1 : 0)) / 100
    );
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

  const base =
    Number(indicator.linea_base);
  const meta =
    Number(indicator.meta);
  const current =
    Number(indicator.valor_actual);

  if (
    ![base, meta, current]
      .every(Number.isFinite)
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
  const activeIndicators =
    arr(activity.indicadores)
      .filter(
        (indicator) =>
          indicator.estado !== "inactivo"
      );

  if (!activeIndicators.length) {
    return {
      progress: null,
      measurable: false
    };
  }

  const values =
    activeIndicators.map(indicatorProgress);

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

  const complete =
    activities.length > 0 &&
    coverage >= 99.999;

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
      complete
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
        arr(consejeria.biblioteca)
          .length;

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
   LaTeX
   ========================================================== */

function latexEscape(value = "") {
  let text =
    String(value ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "");

  const replacements = [
    ["\\", "\\textbackslash{}"],
    ["{", "\\{"],
    ["}", "\\}"],
    ["$", "\\$"],
    ["&", "\\&"],
    ["#", "\\#"],
    ["%", "\\%"],
    ["_", "\\_"],
    ["~", "\\textasciitilde{}"],
    ["^", "\\textasciicircum{}"]
  ];

  replacements.forEach(
    ([from, to]) => {
      text = text.split(from).join(to);
    }
  );

  return text;
}

function latexText(value, fallback = "—") {
  const text =
    String(value ?? "").trim();

  return latexEscape(
    text || fallback
  );
}

function latexParagraph(value) {
  const text =
    String(value ?? "").trim();

  if (!text) {
    return "\\textit{Sin información registrada.}";
  }

  return text
    .split(/\n{2,}/)
    .map((part) =>
      latexEscape(
        part.replace(/\n/g, " ")
      )
    )
    .join("\n\n\\par\n");
}

function latexURL(value) {
  const raw =
    String(value ?? "").trim();

  if (!raw) {
    return "\\textit{Sin vínculo}";
  }

  const escaped =
    raw
      .replaceAll("\\", "/")
      .replaceAll("%", "\\%")
      .replaceAll("#", "\\#")
      .replaceAll("{", "\\{")
      .replaceAll("}", "\\}");

  return `\\url{${escaped}}`;
}

function latexTable(rows, widths = null) {
  if (!rows.length) {
    return "\\textit{Sin registros.}";
  }

  const columnCount =
    rows[0].length;

  const spec =
    widths?.length === columnCount
      ? widths
        .map(
          (width) =>
            `>{\\RaggedRight\\arraybackslash}p{${width}\\textwidth}`
        )
        .join("")
      : Array(columnCount)
        .fill(
          `>{\\RaggedRight\\arraybackslash}X`
        )
        .join("");

  const env =
    widths
      ? "longtable"
      : "tabularx";

  const widthArg =
    widths
      ? `{${spec}}`
      : `{\\textwidth}{${spec}}`;

  const [header, ...body] =
    rows;

  const headerLine =
    header
      .map(
        (cell) =>
          `\\textbf{${cell}}`
      )
      .join(" & ");

  const bodyLines =
    body
      .map(
        (row) =>
          row.join(" & ") + " \\\\"
      )
      .join("\n");

  if (env === "longtable") {
    return `
\\begin{longtable}${widthArg}
\\toprule
${headerLine} \\\\
\\midrule
\\endfirsthead
\\toprule
${headerLine} \\\\
\\midrule
\\endhead
${bodyLines}
\\bottomrule
\\end{longtable}
`;
  }

  return `
\\begin{tabularx}${widthArg}
\\toprule
${headerLine} \\\\
\\midrule
${bodyLines}
\\bottomrule
\\end{tabularx}
`;
}

function infoTable(entries) {
  const rows = [
    ["Campo", "Información"],
    ...entries.map(
      ([label, value]) => [
        latexText(label),
        value
      ]
    )
  ];

  return latexTable(
    rows,
    [0.25, 0.68]
  );
}

function reportPreamble({
  title,
  subtitle
}) {
  return `\\documentclass[11pt,letterpaper]{article}
\\usepackage{fontspec}
\\defaultfontfeatures{Ligatures=TeX}
\\setmainfont{TeX Gyre Pagella}
\\setsansfont{TeX Gyre Heros}
\\usepackage[spanish,es-nodecimaldot]{babel}
\\usepackage{geometry}
\\geometry{top=2.4cm,bottom=2.3cm,left=2.3cm,right=2.3cm}
\\usepackage{graphicx}
\\usepackage{array}
\\usepackage{tabularx}
\\usepackage{longtable}
\\usepackage{booktabs}
\\usepackage{ragged2e}
\\usepackage{enumitem}
\\usepackage{hyperref}
\\usepackage{url}
\\usepackage{xcolor}
\\usepackage{fancyhdr}
\\usepackage{titlesec}
\\usepackage{lastpage}
\\usepackage{microtype}
\\usepackage{parskip}
\\usepackage{float}
\\usepackage{amssymb}
\\usepackage{needspace}

\\definecolor{OnicGreen}{HTML}{0F4230}
\\definecolor{OnicRed}{HTML}{A30C22}
\\definecolor{OnicSage}{HTML}{728266}
\\definecolor{OnicCream}{HTML}{F5F5F0}
\\definecolor{SoftGray}{HTML}{66716B}

\\hypersetup{
  colorlinks=true,
  linkcolor=OnicGreen,
  urlcolor=OnicRed,
  pdftitle={${latexText(title)}},
  pdfsubject={${latexText(subtitle)}},
  pdfauthor={Organización Nacional Indígena de Colombia - ONIC}
}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{5pt}
\\renewcommand{\\arraystretch}{1.2}
\\setlist[itemize]{leftmargin=1.4em,itemsep=2pt,topsep=3pt}

\\titleformat{\\section}
  {\\Large\\bfseries\\color{OnicGreen}}
  {\\thesection}{0.6em}{}
\\titleformat{\\subsection}
  {\\large\\bfseries\\color{OnicGreen}}
  {\\thesubsection}{0.6em}{}
\\titleformat{\\subsubsection}
  {\\normalsize\\bfseries\\color{OnicRed}}
  {\\thesubsubsection}{0.6em}{}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{
  \\IfFileExists{onic-logo.png}
    {\\includegraphics[height=0.65cm]{onic-logo.png}}
    {\\textbf{ONIC}}
}
\\fancyhead[R]{\\small Sistema de Buen Gobierno}
\\fancyfoot[L]{\\small ${latexText(subtitle)}}
\\fancyfoot[R]{\\small Página \\thepage\\ de \\pageref{LastPage}}
\\renewcommand{\\headrulewidth}{0.3pt}
\\renewcommand{\\footrulewidth}{0.3pt}

\\newcommand{\\OnicMetric}[2]{%
  \\begin{minipage}[t]{0.47\\textwidth}
    \\colorbox{OnicCream}{%
      \\parbox{0.93\\linewidth}{%
        \\textcolor{SoftGray}{\\footnotesize\\textbf{#1}}\\\\
        \\textcolor{OnicGreen}{\\Large\\textbf{#2}}
      }
    }
  \\end{minipage}
}

\\begin{document}
`;
}

function reportCover({
  title,
  subtitle,
  vigencia
}) {
  return `
\\begin{titlepage}
\\centering
\\vspace*{1.1cm}

\\IfFileExists{onic-logo.png}
  {\\includegraphics[width=4.4cm]{onic-logo.png}}
  {\\fbox{\\parbox[c][3.2cm][c]{4.4cm}{\\centering\\Large\\textbf{ONIC}}}}

\\vspace{1.2cm}

{\\Large\\bfseries\\color{OnicGreen}
Organización Nacional Indígena de Colombia - ONIC\\par}

\\vspace{1cm}

{\\Huge\\bfseries
${latexText(title)}\\par}

\\vspace{0.5cm}

{\\Large\\color{OnicRed}
${latexText(subtitle)}\\par}

\\vfill

\\begin{tabular}{rl}
\\textbf{Vigencia:} &
${latexText(vigencia?.nombre)} \\\\
\\textbf{Periodo:} &
${latexText(humanDate(vigencia?.fecha_inicio))}
-- ${latexText(humanDate(vigencia?.fecha_fin))} \\\\
\\textbf{Estado:} &
${latexText(statusLabel(vigencia?.estado))} \\\\
\\textbf{Generado:} &
${latexText(humanDate(todayISO()))}
\\end{tabular}

\\vfill

{\\small
Sistema de Gestión del Plan Estratégico\\par
Versión documental LaTeX ${REPORT_VERSION}\\par}

\\end{titlepage}

\\tableofcontents
\\clearpage
`;
}

function reportEnd() {
  return `
\\clearpage
\\section*{Nota técnica}
Este documento fue generado automáticamente por el Sistema de Buen Gobierno
de la ONIC a partir de los datos registrados en la Vigencia seleccionada.
Los porcentajes de avance se calculan con las reglas vigentes del sistema:
indicadores de Actividad, ponderación automática de Actividades, ponderación
manual de Proyectos y consolidación automática de los niveles superiores.

\\end{document}
`;
}

function renderMandates(
  mandates,
  sourceMap
) {
  if (!mandates.length) {
    return "\\textit{No hay Mandatos asociados.}";
  }

  return mandates
    .map((mandate) => {
      const source =
        sourceMap.get(
          mandate.fuente_ref
        );

      return `
\\Needspace{5\\baselineskip}
\\subsubsection*{${latexText(
  mandate.codigo
    ? `Mandato ${mandate.codigo}`
    : mandate.titulo ||
      "Mandato"
)}}

${mandate.titulo
  ? `\\textbf{${latexText(mandate.titulo)}}\\par`
  : ""
}
${latexParagraph(mandate.texto)}

\\textbf{Fuente:}
${latexText(source?.nombre || "Sin fuente específica")}.

\\textbf{Estado:}
${latexText(statusLabel(mandate.estado))}.
`;
    })
    .join("\n");
}

function renderLibrary(documents) {
  if (!documents.length) {
    return "\\textit{No hay documentos registrados en la Biblioteca.}";
  }

  const rows = [
    [
      "Título",
      "Tipo",
      "Palabras clave",
      "Vínculo"
    ],
    ...documents.map(
      (document) => [
        latexText(document.titulo),
        latexText(
          document.tipo_documento ||
          "Documento"
        ),
        latexText(
          document.palabras_clave ||
          "—"
        ),
        latexURL(document.url)
      ]
    )
  ];

  return latexTable(
    rows,
    [0.31, 0.13, 0.22, 0.27]
  );
}

function renderIndicators(activity) {
  const indicators =
    arr(activity.indicadores);

  if (!indicators.length) {
    return "\\textit{Sin indicadores registrados.}";
  }

  const rows = [
    [
      "Código",
      "Indicador",
      "Unidad",
      "Línea base",
      "Meta",
      "Actual",
      "Avance"
    ],
    ...indicators.map(
      (indicator) => [
        latexText(indicator.codigo || "—"),
        latexText(indicator.nombre),
        latexText(indicator.unidad_medida || "—"),
        latexText(formatNumber(indicator.linea_base, 4)),
        latexText(formatNumber(indicator.meta, 4)),
        latexText(formatNumber(indicator.valor_actual, 4)),
        latexText(formatPercent(indicatorProgress(indicator)))
      ]
    )
  ];

  let output =
    latexTable(
      rows,
      [
        0.09,
        0.30,
        0.10,
        0.10,
        0.10,
        0.10,
        0.10
      ]
    );

  indicators.forEach(
    (indicator) => {
      const followups =
        arr(indicator.seguimientos);

      if (!followups.length) return;

      output += `
\\paragraph{Seguimientos: ${latexText(
  indicator.codigo ||
  indicator.nombre
)}}`;

      output += latexTable(
        [
          [
            "Fecha",
            "Valor",
            "Observación"
          ],
          ...followups.map(
            (followup) => [
              latexText(
                humanDate(
                  followup.fecha_corte
                )
              ),
              latexText(
                formatNumber(
                  followup.valor,
                  4
                )
              ),
              latexText(
                followup.observacion ||
                "—"
              )
            ]
          )
        ],
        [0.16, 0.13, 0.64]
      );
    }
  );

  return output;
}

function renderBudget(activity) {
  const items =
    arr(activity.presupuesto);

  if (!items.length) {
    return "\\textit{Sin rubros presupuestales registrados.}";
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

  return (
    latexTable(
      [
        [
          "Rubro",
          "Descripción",
          "Programado",
          "Ejecutado"
        ],
        ...items.map(
          (item) => [
            latexText(item.rubro),
            latexText(
              item.descripcion ||
              "—"
            ),
            latexText(
              formatMoney(
                item.programado
              )
            ),
            latexText(
              formatMoney(
                item.ejecutado
              )
            )
          ]
        )
      ],
      [0.22, 0.37, 0.17, 0.17]
    )
    +
    `
\\textbf{Total programado:} ${latexText(formatMoney(programmed))}.\\quad
\\textbf{Total ejecutado:} ${latexText(formatMoney(executed))}.\\quad
\\textbf{Ejecución:} ${latexText(
  programmed > 0
    ? formatPercent(
        executed / programmed * 100
      )
    : "—"
)}.
`
  );
}

function renderEvidence(activity) {
  const evidence =
    arr(activity.evidencias);

  if (!evidence.length) {
    return "\\textit{Sin evidencias registradas.}";
  }

  return latexTable(
    [
      [
        "Evidencia",
        "Tipo",
        "Fecha",
        "Descripción / vínculo"
      ],
      ...evidence.map(
        (item) => [
          latexText(item.nombre),
          latexText(item.tipo || "—"),
          latexText(
            humanDate(item.fecha)
          ),
          `${latexText(
            item.descripcion || "—"
          )}${item.url
            ? `\\par ${latexURL(item.url)}`
            : ""
          }`
        ]
      )
    ],
    [0.23, 0.13, 0.14, 0.43]
  );
}

function renderActivityFollowups(activity) {
  const followups =
    arr(activity.seguimientos);

  if (!followups.length) {
    return "\\textit{Sin seguimientos narrativos registrados.}";
  }

  return followups
    .map(
      (followup) => `
\\Needspace{6\\baselineskip}
\\paragraph{Corte ${latexText(
  humanDate(followup.fecha_corte)
)}}

\\textbf{Resumen.}
${latexParagraph(followup.resumen)}

\\textbf{Logros.}
${latexParagraph(followup.logros)}

\\textbf{Dificultades.}
${latexParagraph(followup.dificultades)}

\\textbf{Próximos pasos.}
${latexParagraph(followup.proximos_pasos)}
`
    )
    .join("\n");
}

function renderActivity(activity, level = 4) {
  const metric =
    activityMetric(activity);

  const command =
    level <= 3
      ? "subsubsection"
      : "paragraph";

  return `
\\Needspace{8\\baselineskip}
\\${command}{${latexText(
  activity.codigo
    ? `${activity.codigo} - ${activity.nombre}`
    : activity.nombre
)}}

${infoTable([
  [
    "Estado",
    latexText(
      statusLabel(activity.estado)
    )
  ],
  [
    "Responsable",
    latexText(
      activity.responsable || "—"
    )
  ],
  [
    "Periodo",
    latexText(
      `${humanDate(activity.fecha_inicio)} — ${humanDate(activity.fecha_fin)}`
    )
  ],
  [
    "Cumplimiento técnico",
    latexText(
      formatPercent(metric.progress)
    )
  ]
])}

\\textbf{Descripción.}

${latexParagraph(activity.descripcion)}

\\paragraph{Indicadores}
${renderIndicators(activity)}

\\paragraph{Presupuesto}
${renderBudget(activity)}

\\paragraph{Evidencias}
${renderEvidence(activity)}

\\paragraph{Seguimiento narrativo}
${renderActivityFollowups(activity)}
`;
}

function renderProject({
  project,
  mandateMap,
  sourceMap,
  heading = "subsection"
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

  return `
\\Needspace{10\\baselineskip}
\\${heading}{${latexText(
  project.codigo
    ? `${project.codigo} - ${project.nombre}`
    : project.nombre
)}}

${infoTable([
  [
    "Estado",
    latexText(
      statusLabel(project.estado)
    )
  ],
  [
    "Responsable",
    latexText(
      project.responsable || "—"
    )
  ],
  [
    "Ponderación en Programa",
    latexText(
      formatPercent(
        project.ponderacion
      )
    )
  ],
  [
    "Periodo",
    latexText(
      `${humanDate(project.fecha_inicio)} — ${humanDate(project.fecha_fin)}`
    )
  ],
  [
    "Cumplimiento técnico",
    latexText(
      formatPercent(metric.progress)
    )
  ],
  [
    "Cobertura de medición",
    latexText(
      formatPercent(metric.coverage)
    )
  ],
  [
    "Presupuesto programado",
    latexText(
      metric.budget.programmed > 0
        ? formatMoney(
            metric.budget.programmed
          )
        : formatMoney(
            project.valor_estimado
          )
    )
  ],
  [
    "Presupuesto ejecutado",
    latexText(
      formatMoney(
        metric.budget.executed
      )
    )
  ],
  [
    "Ejecución presupuestal",
    latexText(
      formatPercent(
        metric.budget.execution
      )
    )
  ]
])}

\\textbf{Descripción.}

${latexParagraph(project.descripcion)}

\\subsubsection*{Objetivo del Proyecto}
${latexParagraph(project.objetivo_general)}

\\subsubsection*{Mandatos relacionados}
${renderMandates(
  projectMandates,
  sourceMap
)}

\\subsubsection*{Actividades}
${arr(project.actividades).length
  ? arr(project.actividades)
      .map(
        (activity) =>
          renderActivity(activity, 4)
      )
      .join("\n")
  : "\\textit{El Proyecto no tiene Actividades registradas.}"
}
`;
}

function renderProgram({
  program,
  mandateMap,
  sourceMap
}) {
  const metric =
    programMetric(program);

  return `
\\subsection{${latexText(program.nombre)}}

${infoTable([
  [
    "Estado",
    latexText(
      statusLabel(program.estado)
    )
  ],
  [
    "Avance acreditado",
    latexText(
      formatPercent(metric.accredited)
    )
  ],
  [
    "Cobertura de medición",
    latexText(
      formatPercent(metric.coverage)
    )
  ]
])}

${latexParagraph(program.descripcion)}

${arr(program.proyectos).length
  ? arr(program.proyectos)
      .map(
        (project) =>
          renderProject({
            project,
            mandateMap,
            sourceMap,
            heading: "subsubsection"
          })
      )
      .join("\n")
  : "\\textit{No hay Proyectos registrados.}"
}
`;
}

function renderLine({
  line,
  mandateMap,
  sourceMap
}) {
  const metric =
    lineMetric(line);

  return `
\\section{Línea de Acción: ${latexText(line.nombre)}}

${infoTable([
  [
    "Estado",
    latexText(
      statusLabel(line.estado)
    )
  ],
  [
    "Avance acreditado",
    latexText(
      formatPercent(metric.accredited)
    )
  ],
  [
    "Cobertura de medición",
    latexText(
      formatPercent(metric.coverage)
    )
  ]
])}

${latexParagraph(line.descripcion)}

${arr(line.programas).length
  ? arr(line.programas)
      .map(
        (program) =>
          renderProgram({
            program,
            mandateMap,
            sourceMap
          })
      )
      .join("\n")
  : "\\textit{No hay Programas registrados.}"
}
`;
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
  projectContext
) {
  const navigation =
    note.navegacion || {};

  if (
    projectContext?.projectId &&
    String(
      navigation.proyecto_id || ""
    ) ===
    String(projectContext.projectId)
  ) {
    return true;
  }

  const code =
    projectContext?.projectCode;

  if (
    code &&
    normalize(
      navigation.proyecto_codigo
    ) ===
    normalize(code)
  ) {
    return true;
  }

  return (
    normalize(
      navigation.proyecto_nombre
    ) ===
    normalize(
      projectContext?.projectName
    )
    &&
    normalize(
      navigation.programa_nombre
    ) ===
    normalize(
      projectContext?.programName
    )
  );
}

function renderAudit(notes) {
  if (!notes.length) {
    return "\\textit{No hay notas de Auditoría registradas para este alcance.}";
  }

  return notes
    .map((note) => `
\\Needspace{6\\baselineskip}
\\subsubsection*{${latexText(note.tema)}}

${infoTable([
  [
    "Estado",
    latexText(
      statusLabel(note.estado)
    )
  ],
  [
    "Referencia",
    latexText(note.ruta)
  ],
  [
    "Autor",
    latexText(note.autor_email)
  ],
  [
    "Fecha",
    latexText(
      humanDate(note.creado_en)
    )
  ]
])}

\\textbf{Comentario.}

${latexParagraph(note.comentario)}

${note.respuesta
  ? `
\\textbf{Respuesta / acción realizada.}

${latexParagraph(note.respuesta)}
`
  : ""
}
`)
    .join("\n");
}

function renderConsejeria({
  consejeria,
  payload,
  includeAudit = true
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

  let output = `
\\section{Consejería: ${latexText(title)}}

${infoTable([
  [
    "Nombre institucional",
    latexText(
      consejeria.catalogo?.nombre_largo ||
      title
    )
  ],
  [
    "Responsable",
    latexText(
      consejeria.participacion?.responsable ||
      "—"
    )
  ],
  [
    "Pueblo",
    latexText(
      consejeria.participacion?.pueblo ||
      "—"
    )
  ],
  [
    "Estado",
    latexText(
      statusLabel(
        consejeria.participacion?.estado
      )
    )
  ],
  [
    "Avance acreditado",
    latexText(
      formatPercent(metric.accredited)
    )
  ],
  [
    "Cobertura de medición",
    latexText(
      formatPercent(metric.coverage)
    )
  ],
  [
    "Presupuesto programado",
    latexText(
      formatMoney(
        budget.programmed
      )
    )
  ],
  [
    "Presupuesto ejecutado",
    latexText(
      formatMoney(
        budget.executed
      )
    )
  ],
  [
    "Ejecución presupuestal",
    latexText(
      formatPercent(
        budget.execution
      )
    )
  ]
])}

\\subsection*{Descripción institucional}
${latexParagraph(
  consejeria.catalogo?.descripcion
)}

\\subsection*{Funciones}
${latexParagraph(
  consejeria.catalogo?.funciones
)}

\\subsection*{Contexto de la Vigencia}
${latexParagraph(
  consejeria.participacion?.detalle
)}

\\subsection*{Resumen de estructura}

\\OnicMetric{Líneas de Acción}{${counts.lineas}}\\hfill
\\OnicMetric{Programas}{${counts.programas}}

\\vspace{0.4cm}

\\OnicMetric{Proyectos}{${counts.proyectos}}\\hfill
\\OnicMetric{Actividades}{${counts.actividades}}

\\subsection*{Mandatos asignados}
${renderMandates(
  mandates,
  sourceMap
)}

\\subsection*{Biblioteca documental}
${renderLibrary(
  arr(consejeria.biblioteca)
)}

\\clearpage
`;

  arr(consejeria.lineas)
    .forEach((line) => {
      output +=
        renderLine({
          line,
          mandateMap,
          sourceMap
        });
    });

  if (includeAudit) {
    output += `
\\clearpage
\\section{Auditoría de la Consejería}
${renderAudit(
  arr(payload.auditoria)
    .filter(
      (note) =>
        auditMatchesConsejeria(
          note,
          consejeria
        )
    )
)}
`;
  }

  return output;
}

function reportVigencia(payload) {
  const vigencia =
    payload.vigencia || {};

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

  let content =
    reportPreamble({
      title:
        "Informe integral de la Vigencia",
      subtitle:
        vigencia.nombre || "Vigencia"
    })
    +
    reportCover({
      title:
        "Informe integral de la Vigencia",
      subtitle:
        vigencia.nombre || "Vigencia",
      vigencia
    });

  content += `
\\section{Información general}

${infoTable([
  [
    "Nombre",
    latexText(vigencia.nombre)
  ],
  [
    "Periodo",
    latexText(
      `${humanDate(vigencia.fecha_inicio)} — ${humanDate(vigencia.fecha_fin)}`
    )
  ],
  [
    "Lema",
    latexText(vigencia.lema || "—")
  ],
  [
    "Estado",
    latexText(
      statusLabel(vigencia.estado)
    )
  ],
  [
    "Avance acreditado",
    latexText(
      formatPercent(metric.accredited)
    )
  ],
  [
    "Cobertura de medición",
    latexText(
      formatPercent(metric.coverage)
    )
  ],
  [
    "Presupuesto programado",
    latexText(
      formatMoney(
        budget.programmed
      )
    )
  ],
  [
    "Presupuesto ejecutado",
    latexText(
      formatMoney(
        budget.executed
      )
    )
  ],
  [
    "Ejecución presupuestal",
    latexText(
      formatPercent(
        budget.execution
      )
    )
  ]
])}

\\subsection*{Descripción}
${latexParagraph(
  vigencia.descripcion
)}

\\section{Resumen de estructura}

\\OnicMetric{Consejerías}{${counts.consejerias}}\\hfill
\\OnicMetric{Líneas de Acción}{${counts.lineas}}

\\vspace{0.4cm}

\\OnicMetric{Programas}{${counts.programas}}\\hfill
\\OnicMetric{Proyectos}{${counts.proyectos}}

\\vspace{0.4cm}

\\OnicMetric{Actividades}{${counts.actividades}}\\hfill
\\OnicMetric{Indicadores}{${counts.indicadores}}

\\section{Mandatos de la Vigencia}
${renderMandates(
  arr(payload.mandatos),
  sourceMap
)}

\\clearpage
`;

  arr(payload.consejerias)
    .forEach((consejeria) => {
      content +=
        renderConsejeria({
          consejeria,
          payload,
          includeAudit: false
        });

      content += "\\clearpage\n";
    });

  content += `
\\section{Auditoría de la Vigencia}
${renderAudit(
  arr(payload.auditoria)
)}
`;

  content += reportEnd();

  return {
    latex: content,
    title:
      `Informe integral - ${vigencia.nombre || "Vigencia"}`,
    filename:
      `informe_vigencia_${safeFilename(vigencia.nombre)}`
  };
}

function reportConsejeria(
  payload,
  consejeria
) {
  const vigencia =
    payload.vigencia || {};

  const title =
    consejeria.catalogo?.nombre_corto ||
    consejeria.catalogo?.nombre_largo ||
    "Consejería";

  let content =
    reportPreamble({
      title:
        `Informe de Consejería - ${title}`,
      subtitle:
        vigencia.nombre || "Vigencia"
    })
    +
    reportCover({
      title:
        "Informe integral de Consejería",
      subtitle:
        title,
      vigencia
    });

  content +=
    renderConsejeria({
      consejeria,
      payload,
      includeAudit: true
    });

  content += reportEnd();

  return {
    latex: content,
    title:
      `Informe de Consejería - ${title}`,
    filename:
      `informe_consejeria_${safeFilename(title)}_${safeFilename(vigencia.nombre)}`
  };
}

function findProject(
  payload,
  context
) {
  const targetConsejeria =
    arr(payload.consejerias)
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

  if (!targetConsejeria) {
    return null;
  }

  const targetLine =
    arr(targetConsejeria.lineas)
      .find(
        (line) =>
          normalize(line.nombre) ===
          normalize(context.lineName)
      );

  if (!targetLine) return null;

  const targetProgram =
    arr(targetLine.programas)
      .find(
        (program) =>
          normalize(program.nombre) ===
          normalize(context.programName)
      );

  if (!targetProgram) return null;

  const targetProject =
    arr(targetProgram.proyectos)
      .find((project) => {
        if (
          context.projectCode &&
          normalize(project.codigo) ===
          normalize(context.projectCode)
        ) {
          return true;
        }

        return (
          normalize(project.nombre) ===
          normalize(context.projectName)
        );
      });

  if (!targetProject) {
    return null;
  }

  return {
    consejeria: targetConsejeria,
    line: targetLine,
    program: targetProgram,
    project: targetProject
  };
}

function reportProject(
  payload,
  context
) {
  const found =
    findProject(payload, context);

  if (!found) {
    throw new Error(
      "No fue posible localizar el Proyecto dentro de la copia estructurada de la Vigencia."
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

  let content =
    reportPreamble({
      title:
        `Informe de Proyecto - ${project.nombre}`,
      subtitle:
        vigencia.nombre || "Vigencia"
    })
    +
    reportCover({
      title:
        "Informe integral de Proyecto",
      subtitle:
        project.codigo
          ? `${project.codigo} - ${project.nombre}`
          : project.nombre,
      vigencia
    });

  content += `
\\section{Ubicación estratégica}

${infoTable([
  [
    "Consejería",
    latexText(
      consejeria.catalogo?.nombre_largo ||
      consejeria.catalogo?.nombre_corto
    )
  ],
  [
    "Línea de Acción",
    latexText(line.nombre)
  ],
  [
    "Programa",
    latexText(program.nombre)
  ]
])}

`;

  content +=
    renderProject({
      project,
      mandateMap,
      sourceMap,
      heading: "section"
    });

  content += `
\\clearpage
\\section{Auditoría del Proyecto}
${renderAudit(
  arr(payload.auditoria)
    .filter(
      (note) =>
        auditMatchesProject(
          note,
          context
        )
    )
)}
`;

  content += reportEnd();

  return {
    latex: content,
    title:
      `Informe de Proyecto - ${project.nombre}`,
    filename:
      `informe_proyecto_${safeFilename(project.codigo || project.nombre)}`
  };
}

/* ==========================================================
   Datos / descargas
   ========================================================== */

async function getVigenciaPayload(
  vigenciaId
) {
  const supabase =
    requireSupabase();

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

function findConsejeria(
  payload,
  context
) {
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

function createReport(
  scope,
  payload,
  context
) {
  if (scope === "vigencia") {
    return reportVigencia(payload);
  }

  if (scope === "consejeria") {
    const consejeria =
      findConsejeria(
        payload,
        context
      );

    if (!consejeria) {
      throw new Error(
        "No fue posible localizar la Consejería dentro de la Vigencia exportada."
      );
    }

    return reportConsejeria(
      payload,
      consejeria
    );
  }

  if (scope === "proyecto") {
    return reportProject(
      payload,
      context
    );
  }

  throw new Error(
    "Tipo de informe no compatible."
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

function downloadText(
  text,
  filename
) {
  downloadBlob(
    new Blob(
      [text],
      {
        type:
          "text/x-tex;charset=utf-8"
      }
    ),
    filename
  );
}

async function fetchLogo() {
  const response =
    await fetch(
      LOGO_PATH,
      {
        cache: "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      "No fue posible incorporar el logo ONIC al paquete."
    );
  }

  return response.blob();
}

function compileInstructions(
  texFilename
) {
  return `ONIC - Sistema de Buen Gobierno
Paquete documental LaTeX

ARCHIVO PRINCIPAL
${texFilename}

COMPILADOR RECOMENDADO
XeLaTeX

OPCIÓN 1 - OVERLEAF
1. Crea un proyecto nuevo en Overleaf.
2. Sube ${texFilename} y onic-logo.png.
3. En Menu > Compiler selecciona XeLaTeX.
4. Compila el documento.

OPCIÓN 2 - LINUX / TEX LIVE
Ejecuta:

latexmk -xelatex ${texFilename}

o, alternativamente:

xelatex ${texFilename}
xelatex ${texFilename}

Se recomienda compilar dos veces para actualizar el índice
y la numeración total de páginas.

El archivo fue generado automáticamente por
ONIC Buen Gobierno.
`;
}

async function downloadPackage(
  report
) {
  if (!window.JSZip) {
    throw new Error(
      "No se cargó el componente de empaquetado JSZip. Puedes descargar el archivo .tex directamente."
    );
  }

  const zip =
    new window.JSZip();

  const texFilename =
    `${report.filename}.tex`;

  zip.file(
    texFilename,
    report.latex
  );

  zip.file(
    "README_COMPILAR.txt",
    compileInstructions(
      texFilename
    )
  );

  zip.file(
    ".latexmkrc",
    "$pdf_mode = 5;\n"
  );

  const logo =
    await fetchLogo();

  zip.file(
    "onic-logo.png",
    logo
  );

  const blob =
    await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: {
        level: 6
      }
    });

  downloadBlob(
    blob,
    `${report.filename}_latex.zip`
  );
}

function scopeLabel(scope) {
  const map = {
    vigencia: "Vigencia completa",
    consejeria: "Consejería completa",
    proyecto: "Proyecto completo"
  };

  return map[scope] || "Informe";
}

function summaryForReport(
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

  const counts =
    {
      consejerias: 1,
      lineas: 1,
      programas: 1,
      proyectos: 1,
      actividades:
        arr(
          found.project.actividades
        ).length,
      indicadores:
        arr(
          found.project.actividades
        )
          .reduce(
            (sum, activity) =>
              sum +
              arr(
                activity.indicadores
              ).length,
            0
          ),
      evidencias:
        arr(
          found.project.actividades
        )
          .reduce(
            (sum, activity) =>
              sum +
              arr(
                activity.evidencias
              ).length,
            0
          ),
      documentos: 0,
      rubros:
        arr(
          found.project.actividades
        )
          .reduce(
            (sum, activity) =>
              sum +
              arr(
                activity.presupuesto
              ).length,
            0
          )
    };

  return {
    title:
      found.project.nombre,
    counts,
    progress:
      metric.progress,
    coverage:
      metric.coverage
  };
}

export async function openLatexReportDialog({
  scope,
  vigenciaId,
  context = {}
}) {
  openModal({
    title:
      "Generar documento LaTeX",

    content: `
      <div class="latex-report-loading">
        <div class="latex-report-spinner"></div>

        <div>
          <strong>
            Preparando ${escapeHTML(
              scopeLabel(scope)
            )}…
          </strong>

          <p>
            El sistema está consolidando toda la información
            necesaria para formar el documento.
          </p>
        </div>
      </div>
    `
  });

  let payload;
  let report;
  let summary;

  try {
    payload =
      await getVigenciaPayload(
        vigenciaId
      );

    report =
      createReport(
        scope,
        payload,
        context
      );

    summary =
      summaryForReport(
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
            id="closeLatexReportError"
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
        "#closeLatexReportError"
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
      "Generar documento LaTeX",

    content: `
      <div class="latex-report-heading">
        <span class="latex-report-icon">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M6 3h8l4 4v14H6z"></path>
            <path d="M14 3v5h5"></path>
            <path d="M9 12h6"></path>
            <path d="M9 16h6"></path>
          </svg>
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
            Documento institucional con portada ONIC,
            tabla de contenido y estructura completa
            del alcance seleccionado.
          </p>
        </div>
      </div>

      <div class="latex-report-summary">
        <div>
          <span>Proyectos</span>
          <strong>
            ${counts.proyectos}
          </strong>
        </div>

        <div>
          <span>Actividades</span>
          <strong>
            ${counts.actividades}
          </strong>
        </div>

        <div>
          <span>Indicadores</span>
          <strong>
            ${counts.indicadores}
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

      <div class="latex-report-features">
        <strong>
          Contenido incluido
        </strong>

        <div>
          <span>✓ Perfil y estructura estratégica</span>
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

      <div class="latex-report-note">
        <strong>
          Paquete LaTeX
        </strong>

        <p>
          El ZIP incluye el archivo
          <code>.tex</code>, el logo ONIC y las
          instrucciones para compilar con XeLaTeX.
          También puedes descargar únicamente la fuente
          LaTeX.
        </p>
      </div>

      <p
        id="latexReportMessage"
        class="form-message"
      ></p>

      <div class="form-actions latex-report-actions">
        <button
          id="cancelLatexReport"
          class="btn btn-secondary"
          type="button"
        >
          Cerrar
        </button>

        <button
          id="downloadLatexSource"
          class="btn btn-secondary"
          type="button"
        >
          Descargar .tex
        </button>

        <button
          id="downloadLatexPackage"
          class="btn btn-primary"
          type="button"
        >
          Descargar paquete LaTeX
        </button>
      </div>
    `
  });

  const message =
    document.querySelector(
      "#latexReportMessage"
    );

  const sourceButton =
    document.querySelector(
      "#downloadLatexSource"
    );

  const packageButton =
    document.querySelector(
      "#downloadLatexPackage"
    );

  document
    .querySelector(
      "#cancelLatexReport"
    )
    .addEventListener(
      "click",
      closeModal
    );

  sourceButton.addEventListener(
    "click",
    () => {
      downloadText(
        report.latex,
        `${report.filename}.tex`
      );

      message.textContent =
        "Archivo LaTeX generado.";
    }
  );

  packageButton.addEventListener(
    "click",
    async () => {
      packageButton.disabled = true;
      packageButton.textContent =
        "Generando paquete…";

      message.textContent = "";

      try {
        await downloadPackage(
          report
        );

        message.textContent =
          "Paquete LaTeX generado correctamente.";
      } catch (error) {
        console.error(error);

        message.textContent =
          error.message ||
          "No fue posible generar el paquete.";
      } finally {
        packageButton.disabled = false;
        packageButton.textContent =
          "Descargar paquete LaTeX";
      }
    }
  );
}

export function latexReportIcon() {
  return `
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M6 3h8l4 4v14H6z"></path>
      <path d="M14 3v5h5"></path>
      <path d="M8 13h8"></path>
      <path d="M9 17h6"></path>
    </svg>
  `;
}
