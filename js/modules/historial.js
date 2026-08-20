import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";
import { logManualEvent } from "../security.js";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const ACTION_LABELS = {
  crear: "Creó",
  actualizar: "Modificó",
  eliminar: "Eliminó",
  aprobar_ponderacion: "Aprobó ponderación",
  resolver_nota: "Resolvió nota",
  iniciar_sesion: "Inició sesión",
  cerrar_sesion: "Cerró sesión",
  conflicto_edicion: "Conflicto de edición",
  generar_respaldo: "Generó respaldo",
  importar_vigencia: "Importó Vigencia",
  restaurar_vigencia: "Restauró Vigencia",
  exportar_historial: "Exportó historial",
  exportar_planeador: "Exportó Planeador",
  generar_documento: "Generó documento",
  crear_corte: "Creó corte de seguimiento",
  actualizar_corte: "Actualizó fotografía del corte",
  corte_revision: "Pasó corte a revisión",
  aprobar_corte: "Aprobó corte de seguimiento",
  cerrar_corte: "Cerró corte de seguimiento",
  eliminar_corte: "Eliminó corte de seguimiento",
  crear_compromiso: "Creó compromiso",
  actualizar_compromiso: "Actualizó compromiso",
  completar_compromiso: "Completó compromiso",
  cancelar_compromiso: "Canceló compromiso",
  reabrir_compromiso: "Reabrió compromiso",
  eliminar_compromiso: "Eliminó compromiso"
};

const ENTITY_LABELS = {
  vigencia: "Vigencia",
  consejeria_catalogo: "Consejería institucional",
  consejeria: "Consejería",
  fuente_mandato: "Fuente de Mandatos",
  mandato: "Mandato",
  vinculo_mandato_consejeria: "Vinculación de Mandato",
  linea: "Línea de Acción",
  programa: "Programa",
  proyecto: "Proyecto",
  vinculo_proyecto_mandato: "Vinculación de Proyecto",
  actividad: "Actividad",
  indicador: "Indicador",
  avance_indicador: "Avance de indicador",
  presupuesto: "Rubro presupuestal",
  evidencia: "Evidencia",
  seguimiento: "Seguimiento",
  biblioteca: "Documento de biblioteca",
  nota_auditoria: "Nota de Auditoría",
  ponderacion: "Ponderación",
  usuario: "Usuario",
  asignacion_usuario: "Asignación de usuario",
  corte_seguimiento: "Corte de seguimiento",
  compromiso: "Compromiso / tarea",
  sesion: "Sesión",
  sistema: "Sistema"
};

const FIELD_LABELS = {
  nombre: "Nombre",
  nombre_corto: "Nombre corto",
  nombre_largo: "Nombre largo",
  descripcion: "Descripción",
  funciones: "Funciones",
  responsable: "Responsable",
  pueblo: "Pueblo",
  detalle: "Detalle",
  estado: "Estado",
  codigo: "Código",
  titulo: "Título",
  texto: "Texto",
  observaciones: "Observaciones",
  objetivo_general: "Objetivo del Proyecto",
  fecha_inicio: "Fecha de inicio",
  fecha_fin: "Fecha de cierre",
  tiene_financiacion: "Tiene financiación",
  valor_estimado: "Valor estimado",
  ponderacion: "Ponderación",
  metodo_ponderacion: "Método de ponderación",
  orden: "Orden",
  unidad_medida: "Unidad de medida",
  linea_base: "Línea base",
  meta: "Meta",
  valor_actual: "Valor actual",
  sentido: "Sentido",
  fecha_corte: "Fecha de corte",
  avance_vigencia: "Avance de la Vigencia",
  cobertura_vigencia: "Cobertura de medición",
  valor: "Valor",
  observacion: "Observación",
  rubro: "Rubro",
  programado: "Programado",
  ejecutado: "Ejecutado",
  tipo: "Tipo",
  fecha: "Fecha",
  url: "Enlace",
  resumen: "Resumen",
  logros: "Logros",
  dificultades: "Dificultades",
  proximos_pasos: "Próximos pasos",
  tema: "Tema",
  comentario: "Comentario",
  respuesta: "Respuesta / acción",
  rol: "Rol",
  email: "Correo",
  lema: "Lema",
  prioridad: "Prioridad",
  fecha_limite: "Fecha límite",
  resultado_cierre: "Resultado / cierre",
  responsable_nombre: "Responsable",
  responsable_email: "Correo del responsable"
};

const HIDDEN_FIELDS = new Set([
  "id",
  "created_at",
  "creado_en",
  "modificado_en",
  "resuelta_en",
  "autor_id",
  "autor_email",
  "modificado_por_id",
  "modificado_por_email",
  "vigencia_id",
  "vigencia_consejeria_id",
  "consejeria_id",
  "fuente_id",
  "mandato_id",
  "programa_id",
  "linea_accion_id",
  "proyecto_id",
  "actividad_id",
  "indicador_id",
  "usuario_id",
  "responsable_usuario_id",
  "navigation",
  "alerta_clave",
  "entidad_id",
  "created_by"
]);

function actionLabel(value) {
  return ACTION_LABELS[value] || String(value || "Actividad").replaceAll("_", " ");
}

function entityLabel(value) {
  return ENTITY_LABELS[value] || String(value || "Registro").replaceAll("_", " ");
}

function fieldLabel(value) {
  if (FIELD_LABELS[value]) return FIELD_LABELS[value];
  const text = String(value || "").replaceAll("_", " ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Campo";
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function changesArray(row) {
  const changes = row.cambios && typeof row.cambios === "object" ? row.cambios : {};
  return Object.entries(changes)
    .filter(([field]) => !HIDDEN_FIELDS.has(field))
    .map(([field, values]) => ({
      field,
      label: fieldLabel(field),
      before: values?.antes,
      after: values?.despues
    }));
}

function recordFields(row) {
  const source = row.datos_nuevos || row.datos_anteriores || {};
  return Object.entries(source)
    .filter(([field, value]) => !HIDDEN_FIELDS.has(field) && value !== null && value !== "")
    .slice(0, 18)
    .map(([field, value]) => ({ field, label: fieldLabel(field), value }));
}

function buildLocationMaps(vigencias, consejerias) {
  const vigenciaMap = new Map(vigencias.map((row) => [row.id, row.nombre]));
  const vcMap = new Map(consejerias.map((row) => [
    row.id,
    row.consejerias?.nombre_corto || row.consejerias?.nombre_largo || "Consejería"
  ]));
  return { vigenciaMap, vcMap };
}

async function loadReferenceData() {
  const supabase = requireSupabase();
  const [vResult, vcResult] = await Promise.all([
    supabase.from("vigencias").select("id,nombre,fecha_inicio").order("fecha_inicio", { ascending: false }),
    supabase.from("vigencia_consejerias").select(`id,vigencia_id,consejerias(id,nombre_corto,nombre_largo)`).order("created_at", { ascending: true })
  ]);
  if (vResult.error) throw vResult.error;
  if (vcResult.error) throw vcResult.error;
  return {
    vigencias: vResult.data || [],
    consejerias: (vcResult.data || []).filter((row) => row.consejerias)
  };
}

async function loadHistory({ days = 7, start = "", end = "", action = "", user = "", vigenciaId = "", vcId = "", search = "" }) {
  const supabase = requireSupabase();
  let query = supabase
    .from("historial_actividad")
    .select("id,vigencia_id,vigencia_consejeria_id,usuario_id,usuario_email,accion,entidad_tipo,entidad_id,entidad_nombre,datos_anteriores,datos_nuevos,cambios,detalle,creado_en")
    .order("creado_en", { ascending: false })
    .limit(2000);

  if (start) {
    query = query.gte("creado_en", `${start}T00:00:00`);
  } else if (Number(days) > 0) {
    const from = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
    query = query.gte("creado_en", from.toISOString());
  }

  if (end) query = query.lte("creado_en", `${end}T23:59:59`);
  if (action) query = query.eq("accion", action);
  if (vigenciaId) query = query.eq("vigencia_id", vigenciaId);
  if (vcId) query = query.eq("vigencia_consejeria_id", vcId);
  if (user) query = query.ilike("usuario_email", `%${user}%`);

  const { data, error } = await query;
  if (error) throw error;

  const term = String(search || "").trim().toLocaleLowerCase("es");
  if (!term) return data || [];

  return (data || []).filter((row) => {
    const haystack = [
      row.usuario_email,
      row.entidad_nombre,
      row.entidad_tipo,
      row.accion,
      JSON.stringify(row.cambios || {}),
      JSON.stringify(row.detalle || {})
    ].join(" ").toLocaleLowerCase("es");
    return haystack.includes(term);
  });
}

function openHistoryDetail(row, maps) {
  const changes = changesArray(row);
  const fields = recordFields(row);
  const vigencia = maps.vigenciaMap.get(row.vigencia_id) || "—";
  const consejeria = maps.vcMap.get(row.vigencia_consejeria_id) || "—";

  openModal({
    title: "Detalle del historial",
    content: `
      <div class="history-detail-head">
        <span class="history-action-chip action-${escapeHTML(row.accion)}">${escapeHTML(actionLabel(row.accion))}</span>
        <h3>${escapeHTML(row.entidad_nombre || entityLabel(row.entidad_tipo))}</h3>
        <p class="muted">${escapeHTML(entityLabel(row.entidad_tipo))}</p>
      </div>

      <div class="history-meta-grid">
        <div><span>Fecha</span><strong>${escapeHTML(formatDateTime(row.creado_en))}</strong></div>
        <div><span>Usuario</span><strong>${escapeHTML(row.usuario_email || "Sistema")}</strong></div>
        <div><span>Vigencia</span><strong>${escapeHTML(vigencia)}</strong></div>
        <div><span>Consejería</span><strong>${escapeHTML(consejeria)}</strong></div>
      </div>

      ${changes.length ? `
        <section class="history-change-section">
          <p class="eyebrow">Cambios registrados</p>
          <div class="table-wrap">
            <table class="data-table history-change-table">
              <thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
              <tbody>
                ${changes.map((item) => `
                  <tr>
                    <td><strong>${escapeHTML(item.label)}</strong></td>
                    <td>${escapeHTML(formatValue(item.before))}</td>
                    <td>${escapeHTML(formatValue(item.after))}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
      ` : fields.length ? `
        <section class="history-change-section">
          <p class="eyebrow">Información registrada</p>
          <div class="history-field-list">
            ${fields.map((item) => `<div><span>${escapeHTML(item.label)}</span><strong>${escapeHTML(formatValue(item.value))}</strong></div>`).join("")}
          </div>
        </section>
      ` : `<p class="muted">Este evento no contiene cambios de campos para mostrar.</p>`}

      <div class="form-actions">
        <button id="closeHistoryDetail" class="btn btn-secondary" type="button">Cerrar</button>
      </div>
    `
  });

  document.querySelector("#closeHistoryDetail")?.addEventListener("click", closeModal);
}

export async function renderHistorial(container) {
  let refs = { vigencias: [], consejerias: [] };
  let rows = [];
  let activeDays = 7;

  container.innerHTML = `
    <div class="page-actions history-page-actions">
      <div>
        <p class="eyebrow">Trazabilidad automática</p>
        <h2>Historial de actividad</h2>
        <p class="muted">Consulta quién realizó cambios, cuándo se hicieron y qué información fue modificada.</p>
      </div>
      <div class="row-actions">
        <button id="exportHistoryTxt" class="btn btn-secondary" type="button">Descargar TXT</button>
        <button id="exportHistoryCsv" class="btn btn-secondary" type="button">Descargar CSV</button>
      </div>
    </div>

    <section class="panel history-filter-panel" style="margin-top:0">
      <div class="history-period-buttons">
        <button class="btn btn-secondary active" type="button" data-days="7">Últimos 7 días</button>
        <button class="btn btn-secondary" type="button" data-days="30">30 días</button>
        <button class="btn btn-secondary" type="button" data-days="90">3 meses</button>
        <button class="btn btn-secondary" type="button" data-days="0">Todo</button>
      </div>

      <div class="history-filter-grid">
        <label><span>Desde</span><input id="historyStart" type="date"></label>
        <label><span>Hasta</span><input id="historyEnd" type="date"></label>
        <label><span>Acción</span><select id="historyAction"><option value="">Todas</option></select></label>
        <label><span>Vigencia</span><select id="historyVigencia"><option value="">Todas</option></select></label>
        <label><span>Consejería</span><select id="historyConsejeria"><option value="">Todas</option></select></label>
        <label><span>Usuario</span><input id="historyUser" type="search" placeholder="Correo"></label>
        <label class="history-search-field"><span>Buscar</span><input id="historySearch" type="search" placeholder="Proyecto, indicador, dato modificado…"></label>
      </div>
      <div class="history-filter-actions">
        <span class="muted">El historial se conserva como registro acumulativo. La vista inicia con la última semana.</span>
        <button id="applyHistoryFilters" class="btn btn-primary" type="button">Aplicar filtros</button>
      </div>
    </section>

    <section class="panel history-results-panel">
      <div class="workspace-section-heading">
        <div>
          <p class="eyebrow">Registro cronológico</p>
          <h3>Actividad registrada</h3>
        </div>
        <span id="historyCount" class="status-chip active">0 eventos</span>
      </div>
      <div id="historyContent"><div class="empty-state">Cargando historial…</div></div>
    </section>
  `;

  const content = container.querySelector("#historyContent");
  const count = container.querySelector("#historyCount");
  const startInput = container.querySelector("#historyStart");
  const endInput = container.querySelector("#historyEnd");
  const actionSelect = container.querySelector("#historyAction");
  const vigenciaSelect = container.querySelector("#historyVigencia");
  const vcSelect = container.querySelector("#historyConsejeria");
  const userInput = container.querySelector("#historyUser");
  const searchInput = container.querySelector("#historySearch");

  function maps() {
    return buildLocationMaps(refs.vigencias, refs.consejerias);
  }

  function syncConsejeriaOptions() {
    const vigenciaId = vigenciaSelect.value;
    const filtered = vigenciaId
      ? refs.consejerias.filter((row) => row.vigencia_id === vigenciaId)
      : refs.consejerias;
    const previous = vcSelect.value;
    vcSelect.innerHTML = `<option value="">Todas</option>${filtered.map((row) => `
      <option value="${row.id}">${escapeHTML(row.consejerias.nombre_corto || row.consejerias.nombre_largo)}</option>
    `).join("")}`;
    if (filtered.some((row) => row.id === previous)) vcSelect.value = previous;
  }

  function renderRows() {
    const locationMaps = maps();
    count.textContent = `${rows.length} evento${rows.length === 1 ? "" : "s"}`;

    if (!rows.length) {
      content.innerHTML = `<div class="empty-state"><strong>No hay actividad para los filtros seleccionados.</strong><p>Prueba ampliando el periodo o retirando algún filtro.</p></div>`;
      return;
    }

    content.innerHTML = `
      <div class="history-list">
        ${rows.map((row) => {
          const vigencia = locationMaps.vigenciaMap.get(row.vigencia_id) || "";
          const consejeria = locationMaps.vcMap.get(row.vigencia_consejeria_id) || "";
          const changes = changesArray(row);
          return `
            <article class="history-item">
              <div class="history-time">
                <strong>${escapeHTML(formatDateTime(row.creado_en))}</strong>
                <span>${escapeHTML(row.usuario_email || "Sistema")}</span>
              </div>
              <div class="history-main">
                <div class="history-main-title">
                  <span class="history-action-chip action-${escapeHTML(row.accion)}">${escapeHTML(actionLabel(row.accion))}</span>
                  <strong>${escapeHTML(row.entidad_nombre || entityLabel(row.entidad_tipo))}</strong>
                </div>
                <p>${escapeHTML(entityLabel(row.entidad_tipo))}${vigencia ? ` · ${escapeHTML(vigencia)}` : ""}${consejeria ? ` · ${escapeHTML(consejeria)}` : ""}</p>
                ${changes.length ? `<small>${changes.length} campo${changes.length === 1 ? "" : "s"} modificado${changes.length === 1 ? "" : "s"}</small>` : ""}
              </div>
              <button class="btn btn-secondary history-detail-button" type="button" data-id="${row.id}">Ver detalle</button>
            </article>
          `;
        }).join("")}
      </div>
    `;

    content.querySelectorAll(".history-detail-button").forEach((button) => {
      button.addEventListener("click", () => {
        const row = rows.find((item) => item.id === button.dataset.id);
        if (row) openHistoryDetail(row, locationMaps);
      });
    });
  }

  async function refresh() {
    content.innerHTML = `<div class="empty-state">Cargando historial…</div>`;
    try {
      rows = await loadHistory({
        days: activeDays,
        start: startInput.value,
        end: endInput.value,
        action: actionSelect.value,
        user: userInput.value.trim(),
        vigenciaId: vigenciaSelect.value,
        vcId: vcSelect.value,
        search: searchInput.value.trim()
      });
      renderRows();
    } catch (error) {
      console.error(error);
      content.innerHTML = `<div class="empty-state"><strong>No fue posible cargar el historial.</strong><p>${escapeHTML(error.message || "Intenta nuevamente.")}</p></div>`;
    }
  }

  function buildTxt() {
    const locationMaps = maps();
    const lines = [
      "ONIC BUEN GOBIERNO",
      "HISTORIAL DE ACTIVIDAD",
      `Generado: ${formatDateTime(new Date().toISOString())}`,
      `Eventos: ${rows.length}`,
      "",
      "============================================================",
      ""
    ];

    rows.forEach((row, index) => {
      const changes = changesArray(row);
      lines.push(`${index + 1}. ${formatDateTime(row.creado_en)}`);
      lines.push(`Usuario: ${row.usuario_email || "Sistema"}`);
      lines.push(`Acción: ${actionLabel(row.accion)}`);
      lines.push(`Elemento: ${entityLabel(row.entidad_tipo)} · ${row.entidad_nombre || "—"}`);
      if (row.vigencia_id) lines.push(`Vigencia: ${locationMaps.vigenciaMap.get(row.vigencia_id) || row.vigencia_id}`);
      if (row.vigencia_consejeria_id) lines.push(`Consejería: ${locationMaps.vcMap.get(row.vigencia_consejeria_id) || row.vigencia_consejeria_id}`);
      if (changes.length) {
        lines.push("Cambios:");
        changes.forEach((change) => {
          lines.push(`- ${change.label}: ${formatValue(change.before)} → ${formatValue(change.after)}`);
        });
      }
      lines.push("");
      lines.push("------------------------------------------------------------");
      lines.push("");
    });

    return lines.join("\n");
  }

  function buildCsv() {
    const locationMaps = maps();
    const header = ["Fecha", "Usuario", "Acción", "Tipo", "Elemento", "Vigencia", "Consejería", "Cambios"];
    const output = [header.map(csvEscape).join(",")];
    rows.forEach((row) => {
      const changeText = changesArray(row)
        .map((change) => `${change.label}: ${formatValue(change.before)} -> ${formatValue(change.after)}`)
        .join(" | ");
      output.push([
        formatDateTime(row.creado_en),
        row.usuario_email || "Sistema",
        actionLabel(row.accion),
        entityLabel(row.entidad_tipo),
        row.entidad_nombre || "",
        locationMaps.vigenciaMap.get(row.vigencia_id) || "",
        locationMaps.vcMap.get(row.vigencia_consejeria_id) || "",
        changeText
      ].map(csvEscape).join(","));
    });
    return `\uFEFF${output.join("\n")}`;
  }

  container.querySelectorAll("[data-days]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeDays = Number(button.dataset.days || 0);
      startInput.value = "";
      endInput.value = "";
      container.querySelectorAll("[data-days]").forEach((item) => item.classList.toggle("active", item === button));
      await refresh();
    });
  });

  container.querySelector("#applyHistoryFilters").addEventListener("click", async () => {
    if (startInput.value || endInput.value) {
      activeDays = 0;
      container.querySelectorAll("[data-days]").forEach((item) => item.classList.remove("active"));
    }
    await refresh();
  });

  vigenciaSelect.addEventListener("change", syncConsejeriaOptions);

  container.querySelector("#exportHistoryTxt").addEventListener("click", async () => {
    if (!rows.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`ONIC_historial_${stamp}.txt`, buildTxt(), "text/plain;charset=utf-8");
    await logManualEvent({ action: "exportar_historial", entityType: "sistema", entityName: "Historial de actividad", detail: { formato: "TXT", eventos: rows.length } });
  });

  container.querySelector("#exportHistoryCsv").addEventListener("click", async () => {
    if (!rows.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`ONIC_historial_${stamp}.csv`, buildCsv(), "text/csv;charset=utf-8");
    await logManualEvent({ action: "exportar_historial", entityType: "sistema", entityName: "Historial de actividad", detail: { formato: "CSV", eventos: rows.length } });
  });

  try {
    refs = await loadReferenceData();
    const actionValues = Object.keys(ACTION_LABELS);
    actionSelect.innerHTML = `<option value="">Todas</option>${actionValues.map((action) => `<option value="${action}">${escapeHTML(actionLabel(action))}</option>`).join("")}`;
    vigenciaSelect.innerHTML = `<option value="">Todas</option>${refs.vigencias.map((row) => `<option value="${row.id}">${escapeHTML(row.nombre)}</option>`).join("")}`;
    syncConsejeriaOptions();
    await refresh();
  } catch (error) {
    console.error(error);
    content.innerHTML = `<div class="empty-state"><strong>No fue posible iniciar el Historial.</strong><p>${escapeHTML(error.message || "Intenta nuevamente.")}</p></div>`;
  }
}
