import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";
import { renderProyectoWorkspace } from "./proyectoWorkspace.js";
import { setAuditContext, openAuditPanel } from "./auditoria.js";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value = "") {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function option(value, label, selected = false) {
  return `<option value="${escapeHTML(value)}" ${selected ? "selected" : ""}>${escapeHTML(label)}</option>`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2).replace(".", ",")} %`;
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

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

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function statusChip(estado) {
  const labels = {
    borrador: "Borrador",
    formulacion: "Formulación",
    activo: "Activo",
    suspendido: "Suspendido",
    cerrado: "Cerrado"
  };

  const classes = {
    borrador: "",
    formulacion: "draft",
    activo: "active",
    suspendido: "warning",
    cerrado: "closed"
  };

  return `<span class="status-chip ${classes[estado] || ""}">${labels[estado] || escapeHTML(estado)}</span>`;
}

function trashIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16"></path>
      <path d="M9 7V4h6v3"></path>
      <path d="M7 7l1 13h8l1-13"></path>
      <path d="M10 11v5"></path>
      <path d="M14 11v5"></path>
    </svg>
  `;
}

function scaleIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 20h16"></path>
      <path d="M7 16V9"></path>
      <path d="M12 16V5"></path>
      <path d="M17 16v-4"></path>
    </svg>
  `;
}

function mandateIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 3h12v18H6z"></path>
      <path d="M9 8h6"></path>
      <path d="M9 12h6"></path>
      <path d="M9 16h4"></path>
    </svg>
  `;
}

/* ==========================================================
   DATOS
   ========================================================== */

async function getVigencias() {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("vigencias")
    .select("id,nombre,fecha_inicio,fecha_fin,estado")
    .order("fecha_inicio", { ascending: false });

  if (error) throw error;
  return data || [];
}

async function getConsejeriasVigencia(vigenciaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("vigencia_consejerias")
    .select(`
      id,
      estado,
      responsable,
      pueblo,
      consejerias (
        id,
        nombre_corto,
        nombre_largo
      )
    `)
    .eq("vigencia_id", vigenciaId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).filter((item) => item.consejerias);
}

async function getLineas(vigenciaConsejeriaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("lineas_accion")
    .select("*")
    .eq("vigencia_consejeria_id", vigenciaConsejeriaId)
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getProgramas(lineaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("programas")
    .select("*")
    .eq("linea_accion_id", lineaId)
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getProyectos(programaId) {
  const supabase = requireSupabase();

  // 1. Cargar los Proyectos sin depender del schema cache de relaciones.
  const { data: proyectos, error: proyectosError } = await supabase
    .from("proyectos")
    .select("*")
    .eq("programa_id", programaId)
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });

  if (proyectosError) throw proyectosError;

  const rows = proyectos || [];

  if (!rows.length) {
    return [];
  }

  const projectIds = rows.map((proyecto) => proyecto.id);

  // 2. Cargar directamente la tabla puente.
  // Esto evita el error PGRST200 causado por una relación nueva
  // que todavía no esté reflejada en el schema cache de PostgREST.
  const { data: links, error: linksError } = await supabase
    .from("proyecto_mandatos")
    .select("proyecto_id,mandato_id")
    .in("proyecto_id", projectIds);

  if (linksError) throw linksError;

  const mandateIds = [
    ...new Set(
      (links || [])
        .map((link) => link.mandato_id)
        .filter(Boolean)
    )
  ];

  let mandates = [];

  // 3. Cargar los Mandatos por ID, también sin embedding.
  if (mandateIds.length) {
    const { data, error } = await supabase
      .from("mandatos")
      .select("id,codigo,titulo,texto,estado")
      .in("id", mandateIds);

    if (error) throw error;

    mandates = data || [];
  }

  const mandateMap = new Map(
    mandates.map((mandato) => [mandato.id, mandato])
  );

  const linksByProject = new Map();

  (links || []).forEach((link) => {
    if (!linksByProject.has(link.proyecto_id)) {
      linksByProject.set(link.proyecto_id, []);
    }

    linksByProject.get(link.proyecto_id).push({
      mandato_id: link.mandato_id,
      mandatos: mandateMap.get(link.mandato_id) || null
    });
  });

  // 4. Reconstruir la misma forma de datos que utiliza la interfaz.
  return rows.map((proyecto) => ({
    ...proyecto,
    proyecto_mandatos:
      linksByProject.get(proyecto.id) || []
  }));
}


async function getMandatosConsejeria(vigenciaConsejeriaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("mandato_consejerias")
    .select(`
      mandato_id,
      mandatos (
        id,
        codigo,
        titulo,
        texto,
        estado,
        fuente_id,
        fuentes_mandatos (
          nombre
        )
      )
    `)
    .eq("vigencia_consejeria_id", vigenciaConsejeriaId);

  if (error) throw error;

  return (data || [])
    .map((item) => item.mandatos)
    .filter(Boolean)
    .sort((a, b) =>
      String(a.codigo || a.titulo || a.texto || "").localeCompare(
        String(b.codigo || b.titulo || b.texto || ""),
        "es"
      )
    );
}

async function createProyecto(payload, mandatoIds = []) {
  const supabase = requireSupabase();

  const { data: proyecto, error } = await supabase
    .from("proyectos")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  if (mandatoIds.length) {
    const { error: linkError } = await supabase
      .from("proyecto_mandatos")
      .insert(
        mandatoIds.map((mandatoId) => ({
          proyecto_id: proyecto.id,
          mandato_id: mandatoId
        }))
      );

    if (linkError) throw linkError;
  }

  return proyecto;
}

async function updateProyecto(id, payload, mandatoIds = null) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("proyectos")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  if (Array.isArray(mandatoIds)) {
    const { error: deleteError } = await supabase
      .from("proyecto_mandatos")
      .delete()
      .eq("proyecto_id", id);

    if (deleteError) throw deleteError;

    if (mandatoIds.length) {
      const { error: insertError } = await supabase
        .from("proyecto_mandatos")
        .insert(
          mandatoIds.map((mandatoId) => ({
            proyecto_id: id,
            mandato_id: mandatoId
          }))
        );

      if (insertError) throw insertError;
    }
  }

  return data;
}

async function getActividadCount(projectId) {
  const supabase = requireSupabase();

  const { count, error } = await supabase
    .from("actividades")
    .select("id", { count: "exact", head: true })
    .eq("proyecto_id", projectId);

  if (error) throw error;
  return Number(count || 0);
}

async function deleteProyecto(id) {
  const supabase = requireSupabase();

  const { error } = await supabase
    .from("proyectos")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

async function saveWeights(rows) {
  const supabase = requireSupabase();

  for (const row of rows) {
    const { error } = await supabase
      .from("proyectos")
      .update({
        ponderacion: row.ponderacion,
        metodo_ponderacion: row.metodo_ponderacion
      })
      .eq("id", row.id);

    if (error) throw error;
  }
}

/* ==========================================================
   PONDERACIONES
   ========================================================== */

function calculateWeightTotal(proyectos = []) {
  return proyectos.reduce(
    (sum, proyecto) => sum + Number(proyecto.ponderacion || 0),
    0
  );
}

function weightState(total) {
  const rounded = Math.round(total * 100) / 100;
  const diff = Math.round((100 - rounded) * 100) / 100;

  if (Math.abs(diff) < 0.005) {
    return {
      type: "ok",
      label: "Ponderación completa",
      detail: "El Programa suma exactamente 100,00 %."
    };
  }

  if (diff > 0) {
    return {
      type: "pending",
      label: `Falta ${formatPercent(diff)}`,
      detail: "Distribuye el porcentaje restante entre los Proyectos."
    };
  }

  return {
    type: "over",
    label: `Excede ${formatPercent(Math.abs(diff))}`,
    detail: "Reduce la ponderación de uno o varios Proyectos."
  };
}

function equalWeightRows(proyectos = []) {
  if (!proyectos.length) return [];

  const sorted = [...proyectos].sort((a, b) => {
    const orderDiff = Number(a.orden || 0) - Number(b.orden || 0);
    if (orderDiff !== 0) return orderDiff;

    return String(a.nombre || "").localeCompare(
      String(b.nombre || ""),
      "es"
    );
  });

  const totalUnits = 10000;
  const baseUnits = Math.floor(totalUnits / sorted.length);
  const remainder = totalUnits - (baseUnits * sorted.length);

  return sorted.map((proyecto, index) => ({
    id: proyecto.id,
    ponderacion:
      (baseUnits + (index < remainder ? 1 : 0)) / 100,
    metodo_ponderacion: "sugerida"
  }));
}

function openWeightsDialog({ programa, proyectos, onSaved }) {
  if (!proyectos.length) return;

  openModal({
    title: "Ponderación de Proyectos",
    content: `
      <div class="weight-dialog-intro">
        <div>
          <span class="context-label">Programa</span>
          <strong>${escapeHTML(programa.nombre)}</strong>
        </div>

        <p class="muted">
          Los Proyectos son el único nivel con ponderación modificable.
          La suma del Programa debe ser exactamente <strong>100,00 %</strong>.
        </p>
      </div>

      <div class="weight-dialog-actions">
        <button id="equalizeProjectWeights" class="btn btn-secondary" type="button">
          ${scaleIcon()}
          Distribuir equitativamente
        </button>
      </div>

      <form id="projectWeightsForm">
        <div class="weight-editor-list">
          ${proyectos.map((proyecto) => `
            <div class="weight-editor-row">
              <div>
                <strong>${escapeHTML(proyecto.codigo || proyecto.nombre)}</strong>
                <small>${escapeHTML(proyecto.nombre)}</small>
              </div>

              <label>
                <span>Ponderación</span>
                <div class="percent-input">
                  <input
                    class="weight-input"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value="${Number(proyecto.ponderacion || 0).toFixed(2)}"
                    data-id="${proyecto.id}"
                  >
                  <span>%</span>
                </div>
              </label>
            </div>
          `).join("")}
        </div>

        <div id="weightDialogTotal" class="weight-dialog-total"></div>

        <p id="weightsMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelProjectWeights" class="btn btn-secondary" type="button">
            Cancelar
          </button>

          <button id="saveProjectWeights" class="btn btn-primary" type="submit">
            Guardar ponderaciones
          </button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#projectWeightsForm");
  const inputs = [...form.querySelectorAll(".weight-input")];
  const totalBox = document.querySelector("#weightDialogTotal");
  const message = document.querySelector("#weightsMessage");
  const equalButton = document.querySelector("#equalizeProjectWeights");

  function currentTotal() {
    return inputs.reduce(
      (sum, input) => sum + Number(input.value || 0),
      0
    );
  }

  function renderTotal() {
    const total = currentTotal();
    const state = weightState(total);

    totalBox.className = `weight-dialog-total ${state.type}`;
    totalBox.innerHTML = `
      <span>Total</span>
      <strong>${formatPercent(total)}</strong>
      <small>${escapeHTML(state.detail)}</small>
    `;
  }

  inputs.forEach((input) =>
    input.addEventListener("input", renderTotal)
  );

  document
    .querySelector("#cancelProjectWeights")
    .addEventListener("click", closeModal);

  equalButton.addEventListener("click", () => {
    const rows = equalWeightRows(proyectos);
    const byId = new Map(rows.map((row) => [row.id, row]));

    inputs.forEach((input) => {
      const row = byId.get(input.dataset.id);

      if (row) {
        input.value = row.ponderacion.toFixed(2);
      }
    });

    renderTotal();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const total = currentTotal();

    if (Math.abs(total - 100) > 0.005) {
      message.textContent =
        `La suma debe ser exactamente 100,00 %. Actualmente es ${formatPercent(total)}.`;
      return;
    }

    const rows = inputs.map((input) => ({
      id: input.dataset.id,
      ponderacion: Number(input.value || 0),
      metodo_ponderacion: "manual"
    }));

    const save = document.querySelector("#saveProjectWeights");
    save.disabled = true;
    save.textContent = "Guardando…";

    try {
      await saveWeights(rows);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent =
        error.message || "No fue posible guardar las ponderaciones.";
      save.disabled = false;
      save.textContent = "Guardar ponderaciones";
    }
  });

  renderTotal();
}

/* ==========================================================
   FORMULARIO DE PROYECTO
   ========================================================== */

function projectMandateIds(record) {
  return (record?.proyecto_mandatos || [])
    .map((item) => item.mandato_id)
    .filter(Boolean);
}

function mandateChecks(mandatos, selectedIds = []) {
  if (!mandatos.length) {
    return `
      <div class="empty-inline">
        No hay Mandatos vinculados a esta Consejería en la Vigencia.
      </div>
    `;
  }

  const selected = new Set(selectedIds);

  return `
    <div class="project-mandates-grid">
      ${mandatos.map((mandato) => `
        <label class="project-mandate-check">
          <input
            type="checkbox"
            name="mandatos"
            value="${mandato.id}"
            ${selected.has(mandato.id) ? "checked" : ""}
          >

          <span>
            <strong>${escapeHTML(mandato.codigo || mandato.titulo || "Mandato")}</strong>
            <small>${escapeHTML(mandato.titulo || mandato.texto)}</small>
          </span>
        </label>
      `).join("")}
    </div>
  `;
}

function openProyectoForm({
  vigencia,
  vigenciaConsejeria,
  linea,
  programa,
  mandatos,
  record = null,
  onSaved
}) {
  const editing = Boolean(record);

  openModal({
    title: editing ? "Editar Proyecto" : "Nuevo Proyecto",
    content: `
      <div class="context-ribbon project-context-ribbon">
        <div>
          <span>Vigencia</span>
          <strong>${escapeHTML(vigencia.nombre)}</strong>
        </div>

        <div>
          <span>Consejería</span>
          <strong>${escapeHTML(vigenciaConsejeria.consejerias.nombre_corto)}</strong>
        </div>

        <div>
          <span>Línea</span>
          <strong>${escapeHTML(linea.nombre)}</strong>
        </div>

        <div>
          <span>Programa</span>
          <strong>${escapeHTML(programa.nombre)}</strong>
        </div>
      </div>

      <form id="proyectoForm">
        <div class="form-grid">
          <div class="form-field">
            <label for="proyectoCodigo">Código</label>
            <input
              id="proyectoCodigo"
              name="codigo"
              value="${escapeHTML(record?.codigo || "")}"
              placeholder="Ej. PR-01"
            >
          </div>

          <div class="form-field">
            <label for="proyectoNombreCorto">Nombre corto</label>
            <input
              id="proyectoNombreCorto"
              name="nombre_corto"
              value="${escapeHTML(record?.nombre_corto || "")}"
              placeholder="Opcional"
            >
          </div>

          <div class="form-field full">
            <label for="proyectoNombre">Nombre del Proyecto</label>
            <input
              id="proyectoNombre"
              name="nombre"
              required
              value="${escapeHTML(record?.nombre || "")}"
            >
          </div>

          <div class="form-field full">
            <label for="proyectoDescripcion">Descripción</label>
            <textarea
              id="proyectoDescripcion"
              name="descripcion"
            >${escapeHTML(record?.descripcion || "")}</textarea>
          </div>

          <div class="form-field full">
            <label for="proyectoObjetivoGeneral">Objetivo general</label>
            <textarea
              id="proyectoObjetivoGeneral"
              name="objetivo_general"
            >${escapeHTML(record?.objetivo_general || "")}</textarea>
          </div>

          <div class="form-field full">
            <label for="proyectoResponsable">Responsable / coordinación</label>
            <input
              id="proyectoResponsable"
              name="responsable"
              value="${escapeHTML(record?.responsable || "")}"
            >
          </div>

          <div class="form-field">
            <label for="proyectoFechaInicio">Fecha de inicio</label>
            <input
              id="proyectoFechaInicio"
              name="fecha_inicio"
              type="date"
              value="${escapeHTML(record?.fecha_inicio || "")}"
            >
          </div>

          <div class="form-field">
            <label for="proyectoFechaFin">Fecha de cierre</label>
            <input
              id="proyectoFechaFin"
              name="fecha_fin"
              type="date"
              value="${escapeHTML(record?.fecha_fin || "")}"
            >
          </div>

          <div class="form-field">
            <label for="proyectoEstado">Estado</label>
            <select id="proyectoEstado" name="estado">
              ${option("borrador", "Borrador", (record?.estado || "borrador") === "borrador")}
              ${option("formulacion", "Formulación", record?.estado === "formulacion")}
              ${option("activo", "Activo", record?.estado === "activo")}
              ${option("suspendido", "Suspendido", record?.estado === "suspendido")}
              ${option("cerrado", "Cerrado", record?.estado === "cerrado")}
            </select>
          </div>

          <div class="form-field">
            <label for="proyectoPonderacion">Ponderación del Proyecto</label>

            <div class="percent-input">
              <input
                id="proyectoPonderacion"
                name="ponderacion"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value="${Number(record?.ponderacion || 0).toFixed(2)}"
                readonly
              >
              <span>%</span>
            </div>

            <small class="field-help">
              Se administra desde el módulo Ponderaciones y solo cambia al aprobar la propuesta de la Consejería.
            </small>
          </div>

          <div class="form-field">
            <label class="checkbox-inline">
              <input
                id="proyectoFinanciado"
                name="tiene_financiacion"
                type="checkbox"
                ${record?.tiene_financiacion ? "checked" : ""}
              >
              <span>Tiene financiación</span>
            </label>
          </div>

          <div class="form-field">
            <label for="proyectoValor">Valor estimado (COP)</label>
            <input
              id="proyectoValor"
              name="valor_estimado"
              type="number"
              min="0"
              step="0.01"
              value="${record?.valor_estimado ?? ""}"
            >
          </div>

          <div class="form-field">
            <label for="proyectoOrden">Orden</label>
            <input
              id="proyectoOrden"
              name="orden"
              type="number"
              min="0"
              step="1"
              value="${Number(record?.orden ?? 0)}"
            >
          </div>

          <div class="form-field full">
            <label>Mandatos relacionados</label>
            <p class="field-help">
              Se muestran los Mandatos asignados a esta Consejería para la Vigencia.
              Un Proyecto puede contribuir a uno o varios.
            </p>

            ${mandateChecks(
              mandatos.filter((mandato) => mandato.estado !== "archivado"),
              projectMandateIds(record)
            )}
          </div>
        </div>

        <p id="proyectoMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelProyecto" class="btn btn-secondary" type="button">
            Cancelar
          </button>

          <button class="btn btn-primary" type="submit">
            ${editing ? "Guardar cambios" : "Crear Proyecto"}
          </button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#proyectoForm");
  const message = document.querySelector("#proyectoMessage");
  const financed = document.querySelector("#proyectoFinanciado");
  const valueInput = document.querySelector("#proyectoValor");

  function syncFinanceField() {
    valueInput.disabled = !financed.checked;

    if (!financed.checked) {
      valueInput.value = "";
    }
  }

  financed.addEventListener("change", syncFinanceField);

  document
    .querySelector("#cancelProyecto")
    .addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const formData = new FormData(form);

    const ponderacion = Number(formData.get("ponderacion") || 0);

    if (ponderacion < 0 || ponderacion > 100) {
      message.textContent =
        "La ponderación debe estar entre 0 y 100 %.";
      return;
    }

    const payload = {
      codigo: formData.get("codigo")?.trim() || null,
      nombre: formData.get("nombre")?.trim(),
      nombre_corto: formData.get("nombre_corto")?.trim() || null,
      descripcion: formData.get("descripcion")?.trim() || null,
      objetivo_general:
        formData.get("objetivo_general")?.trim() || null,
      responsable:
        formData.get("responsable")?.trim() || null,
      fecha_inicio: formData.get("fecha_inicio") || null,
      fecha_fin: formData.get("fecha_fin") || null,
      estado: formData.get("estado"),
      tiene_financiacion: financed.checked,
      valor_estimado:
        financed.checked && formData.get("valor_estimado") !== ""
          ? Number(formData.get("valor_estimado"))
          : null,
      metodo_ponderacion: "manual",
      ponderacion,
      orden: Number(formData.get("orden") || 0)
    };

    if (!payload.nombre) {
      message.textContent = "El nombre del Proyecto es obligatorio.";
      return;
    }

    if (
      payload.fecha_inicio &&
      payload.fecha_fin &&
      payload.fecha_fin < payload.fecha_inicio
    ) {
      message.textContent =
        "La fecha de cierre no puede ser anterior a la fecha de inicio.";
      return;
    }

    if (!editing) {
      payload.programa_id = programa.id;
    }

    const selectedMandates = [
      ...form.querySelectorAll('input[name="mandatos"]:checked')
    ].map((input) => input.value);

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      if (editing) {
        await updateProyecto(
          record.id,
          payload,
          selectedMandates
        );
      } else {
        await createProyecto(
          payload,
          selectedMandates
        );
      }

      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent =
        error.message || "No fue posible guardar el Proyecto.";

      submit.disabled = false;
      submit.textContent = editing
        ? "Guardar cambios"
        : "Crear Proyecto";
    }
  });

  syncFinanceField();
}

/* ==========================================================
   BORRADO SEGURO
   ========================================================== */

async function openDeleteProyectoDialog({ record, onChanged }) {
  let activityCount = 0;

  try {
    activityCount = await getActividadCount(record.id);
  } catch (error) {
    console.error(error);

    openModal({
      title: "Eliminar Proyecto",
      content: `
        <div class="danger-callout">
          <strong>No se pudo verificar la estructura del Proyecto.</strong>
          <p>Por seguridad, la eliminación queda bloqueada.</p>
        </div>
        <div class="form-actions">
          <button id="closeProjectDeleteCheck" class="btn btn-secondary" type="button">Cerrar</button>
        </div>
      `
    });

    document.querySelector("#closeProjectDeleteCheck").addEventListener("click", closeModal);
    return;
  }

  if (activityCount > 0) {
    openModal({
      title: "El Proyecto tiene Actividades",
      content: `
        <div class="danger-callout">
          <strong>${escapeHTML(record.nombre)}</strong>
          <p>Este Proyecto contiene <strong>${activityCount} ${activityCount === 1 ? "Actividad" : "Actividades"}</strong> y ya forma parte de la estructura operativa. No puede eliminarse físicamente.</p>
        </div>
        <p class="muted">Conserva el Proyecto para mantener indicadores, presupuesto, evidencias y seguimientos.</p>
        <div class="form-actions">
          <button id="closeProjectWithActivities" class="btn btn-secondary" type="button">Cerrar</button>
        </div>
      `
    });

    document.querySelector("#closeProjectWithActivities").addEventListener("click", closeModal);
    return;
  }

  const canHardDelete =
    record.estado === "borrador" ||
    record.estado === "formulacion";

  if (!canHardDelete) {
    openModal({
      title: "El Proyecto debe conservarse",
      content: `
        <div class="danger-callout">
          <strong>${escapeHTML(record.nombre)}</strong>

          <p>
            Este Proyecto ya está en estado
            <strong>${escapeHTML(record.estado)}</strong>.
            Para conservar la trazabilidad institucional no puede eliminarse físicamente.
          </p>
        </div>

        <p class="muted">
          Los Proyectos en ejecución, suspendidos o cerrados forman parte del historial
          del Programa. Puedes conservar su estado o cerrarlo cuando corresponda.
        </p>

        <p id="protectedProjectMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="closeProtectedProject" class="btn btn-secondary" type="button">
            Cerrar
          </button>

          ${record.estado !== "cerrado"
            ? `<button id="closeProjectRecord" class="btn btn-danger" type="button">Marcar como cerrado</button>`
            : ""}
        </div>
      `
    });

    document
      .querySelector("#closeProtectedProject")
      .addEventListener("click", closeModal);

    const closeRecord = document.querySelector("#closeProjectRecord");

    if (closeRecord) {
      closeRecord.addEventListener("click", async () => {
        const message =
          document.querySelector("#protectedProjectMessage");

        closeRecord.disabled = true;
        closeRecord.textContent = "Actualizando…";

        try {
          await updateProyecto(
            record.id,
            { estado: "cerrado" },
            null
          );

          closeModal();
          await onChanged();
        } catch (error) {
          console.error(error);
          message.textContent =
            error.message || "No fue posible cerrar el Proyecto.";

          closeRecord.disabled = false;
          closeRecord.textContent = "Marcar como cerrado";
        }
      });
    }

    return;
  }

  openModal({
    title: "Eliminar Proyecto",
    content: `
      <div class="danger-callout">
        <strong>${escapeHTML(record.codigo || record.nombre)}</strong>

        <p>
          Este Proyecto está en ${escapeHTML(record.estado)} y puede eliminarse
          definitivamente. También se eliminarán sus vínculos con Mandatos.
        </p>
      </div>

      <p class="muted">
        Esta acción no se puede deshacer.
      </p>

      <div class="form-field">
        <label for="deleteProjectConfirmation">
          Escribe <strong>ELIMINAR</strong> para confirmar
        </label>

        <input
          id="deleteProjectConfirmation"
          autocomplete="off"
          placeholder="ELIMINAR"
        >
      </div>

      <p id="deleteProjectMessage" class="form-message"></p>

      <div class="form-actions">
        <button id="cancelDeleteProject" class="btn btn-secondary" type="button">
          Cancelar
        </button>

        <button id="confirmDeleteProject" class="btn btn-danger" type="button" disabled>
          Eliminar definitivamente
        </button>
      </div>
    `
  });

  const input =
    document.querySelector("#deleteProjectConfirmation");

  const confirm =
    document.querySelector("#confirmDeleteProject");

  const message =
    document.querySelector("#deleteProjectMessage");

  document
    .querySelector("#cancelDeleteProject")
    .addEventListener("click", closeModal);

  input.addEventListener("input", () => {
    confirm.disabled =
      input.value.trim().toUpperCase() !== "ELIMINAR";
  });

  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    confirm.textContent = "Eliminando…";
    message.textContent = "";

    try {
      const supabase = requireSupabase();

      const { data: current, error } = await supabase
        .from("proyectos")
        .select("estado")
        .eq("id", record.id)
        .single();

      if (error) throw error;

      if (
        !["borrador", "formulacion"].includes(current.estado)
      ) {
        throw new Error(
          "El estado del Proyecto cambió y ya no permite eliminación física."
        );
      }

      await deleteProyecto(record.id);
      closeModal();
      await onChanged();
    } catch (error) {
      console.error(error);
      message.textContent =
        error.message || "No fue posible eliminar el Proyecto.";

      confirm.disabled = false;
      confirm.textContent = "Eliminar definitivamente";
    }
  });
}

/* ==========================================================
   COPIAR / IMPORTAR
   ========================================================== */

function mandateLabels(record) {
  return (record.proyecto_mandatos || [])
    .map((item) => item.mandatos?.codigo || item.mandatos?.titulo)
    .filter(Boolean);
}

async function copyProyectosToClipboard(proyectos) {
  if (!proyectos.length) {
    throw new Error("No hay Proyectos para copiar.");
  }

  const headers = [
    "codigo",
    "nombre",
    "nombre_corto",
    "descripcion",
    "objetivo_general",
    "responsable",
    "fecha_inicio",
    "fecha_fin",
    "estado",
    "tiene_financiacion",
    "valor_estimado",
    "ponderacion",
    "mandatos",
    "orden"
  ];

  const text = [
    headers.join("\t"),

    ...proyectos.map((proyecto) => [
      proyecto.codigo || "",
      proyecto.nombre || "",
      proyecto.nombre_corto || "",
      proyecto.descripcion || "",
      proyecto.objetivo_general || "",
      proyecto.responsable || "",
      proyecto.fecha_inicio || "",
      proyecto.fecha_fin || "",
      proyecto.estado || "borrador",
      proyecto.tiene_financiacion ? "SI" : "NO",
      proyecto.valor_estimado ?? "",
      proyecto.ponderacion ?? 0,
      mandateLabels(proyecto).join(" | "),
      proyecto.orden ?? 0
    ]
      .map((value) =>
        String(value)
          .replace(/\t/g, " ")
          .replace(/\r?\n/g, " ")
      )
      .join("\t"))
  ].join("\n");

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function detectDelimiter(line = "") {
  const candidates = ["\t", ";", ","];
  let best = "\t";
  let max = -1;

  for (const delimiter of candidates) {
    const count = delimiter === "\t"
      ? (line.match(/\t/g) || []).length
      : line.split(delimiter).length - 1;

    if (count > max) {
      max = count;
      best = delimiter;
    }
  }

  return best;
}

function parseDelimitedText(text = "") {
  const source = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!source) return [];

  const delimiter =
    detectDelimiter(source.split("\n")[0] || "");

  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  const headers = (rows[0] || []).map((header) =>
    normalizeText(header).replace(/\s+/g, "_")
  );

  return rows
    .slice(1)
    .filter((r) =>
      r.some((value) => String(value ?? "").trim())
    )
    .map((r) => {
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] =
          String(r[index] ?? "").trim();
      });

      return obj;
    });
}

async function readSpreadsheetFile(file) {
  if (!window.XLSX) {
    throw new Error(
      "No se pudo cargar el lector de archivos Excel."
    );
  }

  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer);
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];

  return window.XLSX.utils
    .sheet_to_json(sheet, {
      defval: "",
      raw: false
    })
    .map((row) => {
      const normalized = {};

      Object.entries(row).forEach(([key, value]) => {
        normalized[
          normalizeText(key).replace(/\s+/g, "_")
        ] = String(value ?? "").trim();
      });

      return normalized;
    });
}

function normalizeBoolean(value) {
  const normalized = normalizeText(value);

  return [
    "si",
    "sí",
    "true",
    "1",
    "x",
    "financiado"
  ].includes(normalized);
}

function normalizeImportRow(raw) {
  function pick(...keys) {
    for (const key of keys) {
      const normalizedKey =
        normalizeText(key).replace(/\s+/g, "_");

      if (raw[normalizedKey] !== undefined) {
        return raw[normalizedKey];
      }
    }

    return "";
  }

  let estado = normalizeText(pick("estado"));

  const allowedStates = [
    "borrador",
    "formulacion",
    "activo",
    "suspendido",
    "cerrado"
  ];

  if (!allowedStates.includes(estado)) {
    estado = "borrador";
  }

  return {
    codigo: String(pick("codigo", "código") || "").trim(),
    nombre: String(pick("nombre", "proyecto") || "").trim(),
    nombre_corto: String(
      pick("nombre_corto", "corto", "sigla") || ""
    ).trim(),
    descripcion: String(
      pick("descripcion", "descripción", "detalle") || ""
    ).trim(),
    objetivo_general: String(
      pick("objetivo_general", "objetivo") || ""
    ).trim(),
    responsable: String(
      pick("responsable", "coordinador", "manager") || ""
    ).trim(),
    fecha_inicio: String(
      pick("fecha_inicio", "inicio") || ""
    ).trim(),
    fecha_fin: String(
      pick("fecha_fin", "fin", "cierre") || ""
    ).trim(),
    estado,
    tiene_financiacion: normalizeBoolean(
      pick("tiene_financiacion", "financiado", "financiacion")
    ),
    valor_estimado:
      pick("valor_estimado", "valor", "presupuesto") === ""
        ? null
        : Number(
            String(
              pick("valor_estimado", "valor", "presupuesto")
            )
              .replace(/\./g, "")
              .replace(",", ".")
          ),
    ponderacion: Number(
      String(
        pick("ponderacion", "ponderación", "peso") || 0
      ).replace(",", ".")
    ),
    mandatos: String(
      pick("mandatos", "mandato") || ""
    ).trim(),
    orden: Number(pick("orden") || 0)
  };
}

function buildMandateLookup(mandatos) {
  const map = new Map();

  mandatos.forEach((mandato) => {
    [
      mandato.codigo,
      mandato.titulo
    ].filter(Boolean).forEach((label) => {
      map.set(normalizeText(label), mandato.id);
    });
  });

  return map;
}

function validateImportRows(
  rawRows,
  existingProjects,
  mandatos
) {
  const existingCodes = new Set(
    existingProjects
      .map((item) => normalizeText(item.codigo))
      .filter(Boolean)
  );

  const existingNames = new Set(
    existingProjects
      .map((item) => normalizeText(item.nombre))
      .filter(Boolean)
  );

  const incomingCodes = new Set();
  const incomingNames = new Set();
  const mandateLookup = buildMandateLookup(mandatos);

  return rawRows.map((raw, index) => {
    const row = normalizeImportRow(raw);
    const errors = [];
    const warnings = [];

    if (!row.nombre) {
      errors.push("Falta el nombre");
    }

    const codeKey = normalizeText(row.codigo);
    const nameKey = normalizeText(row.nombre);

    if (codeKey) {
      if (existingCodes.has(codeKey)) {
        errors.push("El código ya existe en este Programa");
      } else if (incomingCodes.has(codeKey)) {
        errors.push("Código repetido en la importación");
      } else {
        incomingCodes.add(codeKey);
      }
    }

    if (nameKey) {
      if (existingNames.has(nameKey)) {
        errors.push("El nombre ya existe en este Programa");
      } else if (incomingNames.has(nameKey)) {
        errors.push("Nombre repetido en la importación");
      } else {
        incomingNames.add(nameKey);
      }
    }

    if (
      !Number.isFinite(row.ponderacion) ||
      row.ponderacion < 0 ||
      row.ponderacion > 100
    ) {
      errors.push("Ponderación inválida");
    }

    if (
      row.valor_estimado !== null &&
      !Number.isFinite(row.valor_estimado)
    ) {
      errors.push("Valor estimado inválido");
    }

    if (
      row.fecha_inicio &&
      row.fecha_fin &&
      row.fecha_fin < row.fecha_inicio
    ) {
      errors.push("Fechas inconsistentes");
    }

    const mandateIds = [];
    const unmatchedMandates = [];

    String(row.mandatos || "")
      .split(/[|;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((label) => {
        const id = mandateLookup.get(
          normalizeText(label)
        );

        if (id) {
          mandateIds.push(id);
        } else {
          unmatchedMandates.push(label);
        }
      });

    if (unmatchedMandates.length) {
      warnings.push(
        `Mandatos no encontrados: ${unmatchedMandates.join(", ")}`
      );
    }

    return {
      index: index + 1,
      ...row,
      mandateIds: [...new Set(mandateIds)],
      errors,
      warnings,
      valid: errors.length === 0
    };
  });
}

function importPreview(rows) {
  if (!rows.length) {
    return `<div class="empty-state">Aún no hay datos para previsualizar.</div>`;
  }

  const importedWeight = rows
    .filter((row) => row.valid)
    .reduce(
      (sum, row) => sum + Number(row.ponderacion || 0),
      0
    );

  return `
    <div class="import-summary">
      <span class="status-chip active">
        ${rows.filter((row) => row.valid).length} válidos
      </span>

      <span class="status-chip">
        ${rows.filter((row) => !row.valid).length} con error
      </span>

      <span class="status-chip">
        Peso importado: ${formatPercent(importedWeight)}
      </span>
    </div>

    <div class="table-wrap import-preview-wrap">
      <table class="data-table compact-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Código</th>
            <th>Proyecto</th>
            <th>Estado</th>
            <th>Ponderación</th>
            <th>Mandatos</th>
            <th>Validación</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map((row) => `
            <tr class="${row.valid ? "" : "row-error"}">
              <td>${row.index}</td>
              <td>${escapeHTML(row.codigo || "—")}</td>
              <td>${escapeHTML(row.nombre || "—")}</td>
              <td>${escapeHTML(row.estado)}</td>
              <td>${formatPercent(row.ponderacion)}</td>
              <td>${escapeHTML(row.mandatos || "—")}</td>

              <td>
                ${row.errors.length
                  ? `<div class="validation-error">${escapeHTML(row.errors.join(" · "))}</div>`
                  : `<div class="validation-ok">Listo</div>`
                }

                ${row.warnings.length
                  ? `<div class="validation-warning">${escapeHTML(row.warnings.join(" · "))}</div>`
                  : ""
                }
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function openImportProyectos({
  vigencia,
  vigenciaConsejeria,
  linea,
  programa,
  mandatos,
  existingProjects,
  onImported
}) {
  let validatedRows = [];

  openModal({
    title: "Importar Proyectos",
    content: `
      <div class="context-ribbon project-context-ribbon">
        <div>
          <span>Vigencia</span>
          <strong>${escapeHTML(vigencia.nombre)}</strong>
        </div>

        <div>
          <span>Consejería</span>
          <strong>${escapeHTML(vigenciaConsejeria.consejerias.nombre_corto)}</strong>
        </div>

        <div>
          <span>Línea</span>
          <strong>${escapeHTML(linea.nombre)}</strong>
        </div>

        <div>
          <span>Programa destino</span>
          <strong>${escapeHTML(programa.nombre)}</strong>
        </div>
      </div>

      <div class="danger-callout soft-callout">
        <strong>La importación se realizará únicamente en este Programa.</strong>
        <p>
          Después de importar revisa la ponderación total. El sistema no
          modifica automáticamente los pesos existentes.
        </p>
      </div>

      <div class="import-methods">
        <section class="import-method">
          <h3>Pegar desde una tabla</h3>

          <p class="muted">
            Copia filas desde Excel o Google Sheets.
          </p>

          <textarea
            id="pasteProjects"
            class="import-textarea"
            placeholder="codigo&#9;nombre&#9;objetivo_general&#9;estado&#9;ponderacion&#9;mandatos"
          ></textarea>

          <button id="parseProjectsPaste" class="btn btn-secondary" type="button">
            Previsualizar
          </button>
        </section>

        <div class="import-divider"><span>o</span></div>

        <section class="import-method">
          <h3>Importar archivo</h3>

          <p class="muted">
            Formatos admitidos: CSV, XLSX y XLS.
          </p>

          <input
            id="projectsImportFile"
            class="file-input"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          >

          <button id="parseProjectsFile" class="btn btn-secondary" type="button">
            Leer archivo
          </button>
        </section>
      </div>

      <section class="import-template">
        <strong>Encabezados recomendados</strong>

        <code>
          codigo | nombre | nombre_corto | descripcion | objetivo_general |
          responsable | fecha_inicio | fecha_fin | estado | tiene_financiacion |
          valor_estimado | ponderacion | mandatos | orden
        </code>

        <p>
          Para varios Mandatos usa <strong>|</strong> o <strong>;</strong>.
          La coincidencia se hace por código o título del Mandato.
        </p>
      </section>

      <p id="projectsImportMessage" class="form-message"></p>

      <div id="projectsImportPreview">
        <div class="empty-state">
          Pega una tabla o selecciona un archivo para comenzar.
        </div>
      </div>

      <div class="form-actions sticky-actions">
        <button id="cancelProjectsImport" class="btn btn-secondary" type="button">
          Cancelar
        </button>

        <button id="confirmProjectsImport" class="btn btn-primary" type="button" disabled>
          Importar registros válidos
        </button>
      </div>
    `
  });

  const paste = document.querySelector("#pasteProjects");
  const fileInput =
    document.querySelector("#projectsImportFile");
  const preview =
    document.querySelector("#projectsImportPreview");
  const message =
    document.querySelector("#projectsImportMessage");
  const confirm =
    document.querySelector("#confirmProjectsImport");

  function setRows(rawRows) {
    validatedRows = validateImportRows(
      rawRows,
      existingProjects,
      mandatos
    );

    preview.innerHTML = importPreview(validatedRows);

    const validCount =
      validatedRows.filter((row) => row.valid).length;

    confirm.disabled = validCount === 0;

    confirm.textContent = validCount
      ? `Importar ${validCount} ${validCount === 1 ? "Proyecto" : "Proyectos"}`
      : "Importar registros válidos";
  }

  document
    .querySelector("#cancelProjectsImport")
    .addEventListener("click", closeModal);

  document
    .querySelector("#parseProjectsPaste")
    .addEventListener("click", () => {
      message.textContent = "";

      const rows = parseDelimitedText(paste.value);

      if (!rows.length) {
        message.textContent =
          "No se detectaron filas para importar.";
        return;
      }

      setRows(rows);
    });

  document
    .querySelector("#parseProjectsFile")
    .addEventListener("click", async () => {
      message.textContent = "";

      const file = fileInput.files?.[0];

      if (!file) {
        message.textContent =
          "Selecciona primero un archivo.";
        return;
      }

      try {
        const extension =
          file.name.split(".").pop()?.toLowerCase();

        const rows = extension === "csv"
          ? parseDelimitedText(await file.text())
          : await readSpreadsheetFile(file);

        if (!rows.length) {
          message.textContent =
            "El archivo no contiene filas utilizables.";
          return;
        }

        setRows(rows);
      } catch (error) {
        console.error(error);

        message.textContent =
          error.message || "No fue posible leer el archivo.";
      }
    });

  confirm.addEventListener("click", async () => {
    const validRows =
      validatedRows.filter((row) => row.valid);

    if (!validRows.length) return;

    confirm.disabled = true;
    confirm.textContent = "Importando…";
    message.textContent = "";

    try {
      let imported = 0;

      for (const row of validRows) {
        await createProyecto(
          {
            programa_id: programa.id,
            codigo: row.codigo || null,
            nombre: row.nombre,
            nombre_corto: row.nombre_corto || null,
            descripcion: row.descripcion || null,
            objetivo_general:
              row.objetivo_general || null,
            responsable: row.responsable || null,
            fecha_inicio: row.fecha_inicio || null,
            fecha_fin: row.fecha_fin || null,
            estado: row.estado,
            tiene_financiacion:
              row.tiene_financiacion,
            valor_estimado:
              row.tiene_financiacion
                ? row.valor_estimado
                : null,
            metodo_ponderacion: "manual",
            ponderacion: row.ponderacion,
            orden: row.orden
          },
          row.mandateIds
        );

        imported++;
      }

      closeModal();
      await onImported(imported);
    } catch (error) {
      console.error(error);

      message.textContent =
        error.message || "No fue posible completar la importación.";

      confirm.disabled = false;
      confirm.textContent = "Importar registros válidos";
    }
  });
}

/* ==========================================================
   RENDER
   ========================================================== */

export async function renderProyectos(container, navigationTarget = null) {
  let vigencias = [];
  let consejerias = [];
  let lineas = [];
  let programas = [];
  let proyectos = [];
  let mandatos = [];

  let selectedVigenciaId = "";
  let selectedVigenciaConsejeriaId = "";
  let selectedLineaId = "";
  let selectedProgramaId = "";

  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Nodo operativo central</p>
        <h2>Proyectos</h2>
      </div>

      <div class="page-action-group">
        <button id="copyProjectsButton" class="btn btn-secondary" type="button" disabled>
          Copiar tabla
        </button>

        <button id="importProjectsButton" class="btn btn-secondary" type="button" disabled>
          Importar
        </button>

        <button id="weightsProjectsButton" class="btn btn-secondary" type="button" disabled>
          ${scaleIcon()}
          Ponderaciones
        </button>

        <button id="newProjectButton" class="btn btn-primary" type="button" disabled>
          + Nuevo Proyecto
        </button>
      </div>
    </div>

    <section class="panel strategic-selector-panel project-selector-panel" style="margin-top: 0">
      <div class="strategic-selector-intro">
        <p class="eyebrow">Ubicación de trabajo</p>
        <h2>Selecciona el Programa</h2>

        <p class="muted">
          Cada Proyecto pertenece a un Programa específico. Selecciona
          Vigencia, Consejería, Línea de Acción y Programa.
        </p>
      </div>

      <div class="strategic-selector-grid project-selector-grid">
        <div class="form-field">
          <label for="projectsVigenciaSelector">1. Vigencia</label>
          <select id="projectsVigenciaSelector"></select>
        </div>

        <div class="form-field">
          <label for="projectsConsejeriaSelector">2. Consejería</label>
          <select id="projectsConsejeriaSelector" disabled>
            <option value="">Seleccione una Vigencia primero</option>
          </select>
        </div>

        <div class="form-field">
          <label for="projectsLineaSelector">3. Línea de Acción</label>
          <select id="projectsLineaSelector" disabled>
            <option value="">Seleccione una Consejería primero</option>
          </select>
        </div>

        <div class="form-field">
          <label for="projectsProgramaSelector">4. Programa</label>
          <select id="projectsProgramaSelector" disabled>
            <option value="">Seleccione una Línea primero</option>
          </select>
        </div>
      </div>
    </section>

    <section id="selectedProjectContext" class="selected-strategic-context project-context hidden"></section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Proyectos del Programa</p>
          <h2 id="projectsPanelTitle">Proyectos</h2>
        </div>

        <span id="projectsCount" class="status-chip">0</span>
      </div>

      <div id="projectsContent" style="margin-top: 18px">
        <div class="empty-state">
          <strong>Selecciona un Programa.</strong>
          <p>Sus Proyectos aparecerán aquí.</p>
        </div>
      </div>
    </section>

    <div id="projectsToast" class="app-toast hidden" role="status"></div>
  `;

  const listView = document.createElement("div");
  listView.id = "projectsListView";

  while (container.firstChild) {
    listView.appendChild(container.firstChild);
  }

  container.appendChild(listView);

  const vigenciaSelector =
    listView.querySelector("#projectsVigenciaSelector");

  const consejeriaSelector =
    listView.querySelector("#projectsConsejeriaSelector");

  const lineaSelector =
    listView.querySelector("#projectsLineaSelector");

  const programaSelector =
    listView.querySelector("#projectsProgramaSelector");

  const copyButton =
    listView.querySelector("#copyProjectsButton");

  const importButton =
    listView.querySelector("#importProjectsButton");

  const weightsButton =
    listView.querySelector("#weightsProjectsButton");

  const newButton =
    listView.querySelector("#newProjectButton");

  const content =
    listView.querySelector("#projectsContent");

  const count =
    listView.querySelector("#projectsCount");

  const title =
    listView.querySelector("#projectsPanelTitle");

  const summary =
    listView.querySelector("#selectedProjectContext");

  const toast =
    listView.querySelector("#projectsToast");

  function showToast(text) {
    toast.textContent = text;
    toast.classList.remove("hidden");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(
      () => toast.classList.add("hidden"),
      3400
    );
  }

  function currentVigencia() {
    return vigencias.find(
      (item) => item.id === selectedVigenciaId
    );
  }

  function currentConsejeria() {
    return consejerias.find(
      (item) => item.id === selectedVigenciaConsejeriaId
    );
  }

  function currentLinea() {
    return lineas.find(
      (item) => item.id === selectedLineaId
    );
  }

  function currentPrograma() {
    return programas.find(
      (item) => item.id === selectedProgramaId
    );
  }

  function updateActions() {
    const hasContext = Boolean(
      selectedVigenciaId &&
      selectedVigenciaConsejeriaId &&
      selectedLineaId &&
      selectedProgramaId
    );

    copyButton.disabled =
      !hasContext || proyectos.length === 0;

    importButton.disabled = !hasContext;
    newButton.disabled = !hasContext;

    weightsButton.disabled =
      !hasContext || proyectos.length === 0;
  }

  function renderContextSummary() {
    const vc = currentConsejeria();
    const linea = currentLinea();
    const programa = currentPrograma();

    if (!vc || !linea || !programa) {
      summary.classList.add("hidden");
      summary.innerHTML = "";
      title.textContent = "Proyectos";
      return;
    }

    summary.classList.remove("hidden");

    summary.innerHTML = `
      <div>
        <span class="context-label">Consejería</span>
        <strong>${escapeHTML(vc.consejerias.nombre_corto)}</strong>
        <small>${escapeHTML(vc.consejerias.nombre_largo)}</small>
      </div>

      <div>
        <span class="context-label">Línea de Acción</span>
        <strong>${escapeHTML(linea.nombre)}</strong>
        <small>${linea.estado === "activa" ? "Activa" : escapeHTML(linea.estado)}</small>
      </div>

      <div>
        <span class="context-label">Programa</span>
        <strong>${escapeHTML(programa.nombre)}</strong>
        <small>${programa.estado === "activo" ? "Activo" : escapeHTML(programa.estado)}</small>
      </div>

      <div>
        <span class="context-label">Mandatos disponibles</span>
        <strong>${mandatos.length}</strong>
        <small>Asignados a la Consejería</small>
      </div>
    `;

    title.textContent =
      `Proyectos · ${programa.nombre}`;
  }

  async function loadVigencias() {
    vigencias = await getVigencias();

    if (!selectedVigenciaId && vigencias.length) {
      selectedVigenciaId =
        navigationTarget?.vigencia_id &&
        vigencias.some((item) => item.id === navigationTarget.vigencia_id)
          ? navigationTarget.vigencia_id
          : (
              vigencias.find(
                (item) => item.estado === "activa"
              )?.id ||
              vigencias[0].id
            );
    }

    vigenciaSelector.innerHTML = vigencias.length
      ? vigencias.map((item) =>
          option(
            item.id,
            `${item.nombre}${item.estado === "activa" ? " · activa" : ""}`,
            item.id === selectedVigenciaId
          )
        ).join("")
      : `<option value="">No hay Vigencias</option>`;

    vigenciaSelector.value = selectedVigenciaId;

    await loadConsejerias();
  }

  async function loadConsejerias() {
    selectedVigenciaConsejeriaId = "";
    selectedLineaId = "";
    selectedProgramaId = "";

    lineas = [];
    programas = [];
    proyectos = [];
    mandatos = [];

    count.textContent = "0";

    lineaSelector.disabled = true;
    lineaSelector.innerHTML =
      `<option value="">Seleccione una Consejería primero</option>`;

    programaSelector.disabled = true;
    programaSelector.innerHTML =
      `<option value="">Seleccione una Línea primero</option>`;

    renderContextSummary();
    updateActions();

    if (!selectedVigenciaId) {
      consejeriaSelector.disabled = true;
      consejeriaSelector.innerHTML =
        `<option value="">No hay Vigencia seleccionada</option>`;
      return;
    }

    consejerias = await getConsejeriasVigencia(
      selectedVigenciaId
    );

    if (!consejerias.length) {
      consejeriaSelector.disabled = true;
      consejeriaSelector.innerHTML =
        `<option value="">Esta Vigencia no tiene Consejerías</option>`;

      content.innerHTML = `
        <div class="empty-state">
          <strong>No hay Consejerías vinculadas.</strong>
          <p>Configúralas primero desde el módulo Consejerías.</p>
        </div>
      `;

      return;
    }

    consejeriaSelector.disabled = false;

    consejeriaSelector.innerHTML = `
      <option value="">Seleccione una Consejería…</option>

      ${consejerias.map((item) =>
        option(
          item.id,
          `${item.consejerias.nombre_corto}${item.estado !== "activa" ? " · inactiva" : ""}`
        )
      ).join("")}
    `;

    content.innerHTML = `
      <div class="empty-state">
        <strong>Selecciona una Consejería.</strong>
        <p>Después podrás elegir Línea de Acción y Programa.</p>
      </div>
    `;

    if (
      navigationTarget?.vigencia_consejeria_id &&
      consejerias.some(
        (item) => item.id === navigationTarget.vigencia_consejeria_id
      )
    ) {
      selectedVigenciaConsejeriaId = navigationTarget.vigencia_consejeria_id;
      consejeriaSelector.value = selectedVigenciaConsejeriaId;
      await loadLineas();
    }
  }

  async function loadLineas() {
    selectedLineaId = "";
    selectedProgramaId = "";
    programas = [];
    proyectos = [];
    mandatos = [];

    count.textContent = "0";

    programaSelector.disabled = true;
    programaSelector.innerHTML =
      `<option value="">Seleccione una Línea primero</option>`;

    renderContextSummary();
    updateActions();

    if (!selectedVigenciaConsejeriaId) {
      lineaSelector.disabled = true;
      lineaSelector.innerHTML =
        `<option value="">Seleccione una Consejería primero</option>`;
      return;
    }

    [lineas, mandatos] = await Promise.all([
      getLineas(selectedVigenciaConsejeriaId),
      getMandatosConsejeria(selectedVigenciaConsejeriaId)
    ]);

    if (!lineas.length) {
      lineaSelector.disabled = true;
      lineaSelector.innerHTML =
        `<option value="">Esta Consejería no tiene Líneas</option>`;

      content.innerHTML = `
        <div class="empty-state">
          <strong>No hay Líneas de Acción.</strong>
          <p>Créala primero desde el módulo Líneas de Acción.</p>
        </div>
      `;

      return;
    }

    lineaSelector.disabled = false;

    lineaSelector.innerHTML = `
      <option value="">Seleccione una Línea de Acción…</option>

      ${lineas.map((item) =>
        option(
          item.id,
          `${item.nombre}${item.estado !== "activa" ? ` · ${item.estado}` : ""}`
        )
      ).join("")}
    `;

    content.innerHTML = `
      <div class="empty-state">
        <strong>Selecciona una Línea de Acción.</strong>
        <p>Después podrás elegir el Programa.</p>
      </div>
    `;

    if (
      navigationTarget?.linea_id &&
      lineas.some((item) => item.id === navigationTarget.linea_id)
    ) {
      selectedLineaId = navigationTarget.linea_id;
      lineaSelector.value = selectedLineaId;
      await loadProgramas();
    }
  }

  async function loadProgramas() {
    selectedProgramaId = "";
    proyectos = [];

    count.textContent = "0";
    renderContextSummary();
    updateActions();

    if (!selectedLineaId) {
      programaSelector.disabled = true;
      programaSelector.innerHTML =
        `<option value="">Seleccione una Línea primero</option>`;
      return;
    }

    programas = await getProgramas(
      selectedLineaId
    );

    if (!programas.length) {
      programaSelector.disabled = true;
      programaSelector.innerHTML =
        `<option value="">Esta Línea no tiene Programas</option>`;

      content.innerHTML = `
        <div class="empty-state">
          <strong>No hay Programas.</strong>
          <p>Créalo primero desde el módulo Programas.</p>
        </div>
      `;

      return;
    }

    programaSelector.disabled = false;

    programaSelector.innerHTML = `
      <option value="">Seleccione un Programa…</option>

      ${programas.map((item) =>
        option(
          item.id,
          `${item.nombre}${item.estado !== "activo" ? ` · ${item.estado}` : ""}`
        )
      ).join("")}
    `;

    content.innerHTML = `
      <div class="empty-state">
        <strong>Selecciona un Programa.</strong>
        <p>Sus Proyectos aparecerán aquí.</p>
      </div>
    `;

    if (
      navigationTarget?.programa_id &&
      programas.some((item) => item.id === navigationTarget.programa_id)
    ) {
      selectedProgramaId = navigationTarget.programa_id;
      programaSelector.value = selectedProgramaId;
      await refreshProjects();
    }
  }

  async function openProjectWorkspaceRecord(record, target = {}) {
    if (!record) return;

    listView.classList.add("hidden");

    const oldHost = container.querySelector(
      "#activeProjectWorkspace"
    );

    if (oldHost) oldHost.remove();

    const workspaceHost = document.createElement("div");
    workspaceHost.id = "activeProjectWorkspace";
    container.appendChild(workspaceHost);

    await renderProyectoWorkspace(workspaceHost, {
      projectId: record.id,
      vigencia: currentVigencia(),
      vigenciaConsejeria: currentConsejeria(),
      linea: currentLinea(),
      programa: currentPrograma(),
      initialProjectTab: target.project_tab || "perfil",
      initialActivityId: target.actividad_id || null,
      initialActivityTab: target.activity_tab || "general",
      initialAnchor: target.anchor || null,

      onProjectChanged: async () => {
        await refreshProjects();
      },

      onBack: async () => {
        workspaceHost.remove();
        listView.classList.remove("hidden");
      }
    });
  }

  async function refreshProjects() {
    renderContextSummary();

    const programa = currentPrograma();

    if (!programa) {
      proyectos = [];
      count.textContent = "0";
      updateActions();

      content.innerHTML = `
        <div class="empty-state">
          <strong>Selecciona un Programa.</strong>
          <p>Sus Proyectos aparecerán aquí.</p>
        </div>
      `;

      return;
    }

    content.innerHTML =
      `<div class="empty-state">Cargando Proyectos…</div>`;

    proyectos = await getProyectos(programa.id);

    count.textContent = String(proyectos.length);
    updateActions();

    const vigencia = currentVigencia();
    const vc = currentConsejeria();
    const linea = currentLinea();

    if (vigencia && vc && linea && programa) {
      setAuditContext({
        vigenciaId: vigencia.id,
        vigenciaNombre: vigencia.nombre,
        entidadTipo: "programa",
        entidadId: programa.id,
        entidadNombre: programa.nombre,
        seccion: "proyectos",
        ruta: `${vigencia.nombre} › ${vc.consejerias.nombre_corto} › ${linea.nombre} › ${programa.nombre} › Proyectos`,
        navigation: {
          view: "proyectos",
          vigencia_id: vigencia.id,
          vigencia_nombre: vigencia.nombre,
          vigencia_consejeria_id: vc.id,
          consejeria_nombre: vc.consejerias.nombre_corto,
          linea_id: linea.id,
          linea_nombre: linea.nombre,
          programa_id: programa.id,
          programa_nombre: programa.nombre
        }
      });
    }

    if (!proyectos.length) {
      content.innerHTML = `
        <div class="empty-state">
          <strong>Este Programa aún no tiene Proyectos.</strong>

          <p>
            Crea el primero o importa varios. La ponderación del Programa
            se configurará desde los Proyectos.
          </p>
        </div>
      `;

      return;
    }

    const total = calculateWeightTotal(proyectos);
    const state = weightState(total);
    const financedTotal = proyectos.reduce(
      (sum, proyecto) =>
        sum +
        (
          proyecto.tiene_financiacion
            ? Number(proyecto.valor_estimado || 0)
            : 0
        ),
      0
    );

    content.innerHTML = `
      <div class="project-weight-summary ${state.type}">
        <div>
          <span class="context-label">Ponderación del Programa</span>
          <strong>${escapeHTML(state.label)}</strong>
          <small>${escapeHTML(state.detail)}</small>
        </div>

        <div class="project-summary-stat">
          <span>Total ponderación</span>
          <strong>${formatPercent(total)}</strong>
        </div>

        <div class="project-summary-stat">
          <span>Proyectos</span>
          <strong>${proyectos.length}</strong>
        </div>

        <div class="project-summary-stat">
          <span>Valor financiado</span>
          <strong>${formatMoney(financedTotal)}</strong>
        </div>
      </div>

      <div class="projects-grid">
        ${proyectos.map((proyecto) => {
          const mandates = mandateLabels(proyecto);

          return `
            <article class="project-card">
              <div class="project-card-header">
                <div>
                  <p class="eyebrow">
                    ${escapeHTML(
                      proyecto.codigo ||
                      proyecto.nombre_corto ||
                      `Proyecto ${Number(proyecto.orden || 0) + 1}`
                    )}
                  </p>

                  <h3>${escapeHTML(proyecto.nombre)}</h3>
                </div>

                ${statusChip(proyecto.estado)}
              </div>

              <p class="muted project-card-description">
                ${escapeHTML(
                  proyecto.objetivo_general ||
                  proyecto.descripcion ||
                  "Sin objetivo general registrado."
                )}
              </p>

              <div class="project-metric-grid">
                <div class="calculation-item weight">
                  <span>Ponderación</span>
                  <strong>${formatPercent(proyecto.ponderacion)}</strong>
                  <small>
                    ${proyecto.metodo_ponderacion === "sugerida"
                      ? "Distribución sugerida"
                      : "Configuración manual"}
                  </small>
                </div>

                <div class="calculation-item">
                  <span>Cumplimiento</span>
                  <strong>—</strong>
                  <small>Ver avance en Abrir proyecto</small>
                </div>

                <div class="calculation-item">
                  <span>Contribución</span>
                  <strong>—</strong>
                  <small>Calculada desde las actividades</small>
                </div>

                <div class="calculation-item">
                  <span>Financiación</span>
                  <strong>
                    ${proyecto.tiene_financiacion ? "Sí" : "No"}
                  </strong>
                  <small>${formatMoney(proyecto.valor_estimado)}</small>
                </div>
              </div>

              <div class="project-detail-grid">
                <div>
                  <span>Responsable</span>
                  <strong>${escapeHTML(proyecto.responsable || "Sin registrar")}</strong>
                </div>

                <div>
                  <span>Inicio</span>
                  <strong>${formatDate(proyecto.fecha_inicio)}</strong>
                </div>

                <div>
                  <span>Cierre</span>
                  <strong>${formatDate(proyecto.fecha_fin)}</strong>
                </div>

                <div>
                  <span>Mandatos</span>
                  <strong>${mandates.length}</strong>
                </div>
              </div>

              ${mandates.length
                ? `
                  <div class="project-mandate-tags">
                    ${mandates.map((label) => `
                      <span>${mandateIcon()}${escapeHTML(label)}</span>
                    `).join("")}
                  </div>
                `
                : ""
              }

              <div class="entity-actions">
                <button
                  class="btn btn-primary open-project"
                  type="button"
                  data-id="${proyecto.id}"
                >
                  Abrir proyecto
                </button>

                <button
                  class="btn btn-secondary audit-project-note"
                  type="button"
                  data-id="${proyecto.id}"
                >
                  Nota
                </button>

                <button
                  class="icon-btn danger delete-project"
                  type="button"
                  data-id="${proyecto.id}"
                  title="Eliminar Proyecto"
                  aria-label="Eliminar ${escapeHTML(proyecto.nombre)}"
                >
                  ${trashIcon()}
                </button>
              </div>
            </article>
          `;
        }).join("")}
      </div>

      <div class="calculation-note">
        <strong>Regla de ponderación</strong>

        <p>
          A diferencia de Líneas y Programas, la ponderación de los Proyectos
          es modificable. El total de los Proyectos de este Programa debe sumar
          exactamente 100,00 %. El cumplimiento y la contribución se calculan
          dentro de cada Proyecto a partir de sus Actividades e Indicadores.
        </p>
      </div>
    `;

    content
      .querySelectorAll(".open-project")
      .forEach((button) => {
        button.addEventListener("click", async () => {
          const record = proyectos.find(
            (item) => item.id === button.dataset.id
          );

          await openProjectWorkspaceRecord(record);
        });
      });

    content
      .querySelectorAll(".audit-project-note")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const record = proyectos.find(
            (item) => item.id === button.dataset.id
          );

          const vigencia = currentVigencia();
          const vc = currentConsejeria();
          const linea = currentLinea();
          const programa = currentPrograma();

          if (!record || !vigencia || !vc || !linea || !programa) return;

          openAuditPanel({
            newNote: true,
            contextOverride: {
              vigenciaId: vigencia.id,
              vigenciaNombre: vigencia.nombre,
              entidadTipo: "proyecto",
              entidadId: record.id,
              entidadNombre: record.nombre,
              seccion: "perfil",
              ruta: `${vigencia.nombre} › ${vc.consejerias.nombre_corto} › ${linea.nombre} › ${programa.nombre} › ${record.nombre}`,
              navigation: {
                view: "proyectos",
                vigencia_id: vigencia.id,
                vigencia_nombre: vigencia.nombre,
                vigencia_consejeria_id: vc.id,
                consejeria_nombre: vc.consejerias.nombre_corto,
                linea_id: linea.id,
                linea_nombre: linea.nombre,
                programa_id: programa.id,
                programa_nombre: programa.nombre,
                proyecto_id: record.id,
                proyecto_codigo: record.codigo || "",
                proyecto_nombre: record.nombre,
                project_tab: "perfil"
              },
              sectionOptions: [
                { value: "perfil", label: "Perfil del Proyecto", navigation: { project_tab: "perfil" } },
                { value: "objetivo", label: "Objetivo del Proyecto", navigation: { project_tab: "perfil", anchor: "projectObjectiveField" } },
                { value: "actividades", label: "Actividades", navigation: { project_tab: "actividades" } },
                { value: "seguimiento", label: "Seguimiento", navigation: { project_tab: "seguimiento" } }
              ]
            }
          });
        });
      });

    content
      .querySelectorAll(".delete-project")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const record =
            proyectos.find(
              (item) => item.id === button.dataset.id
            );

          openDeleteProyectoDialog({
            record,

            onChanged: async () => {
              await refreshProjects();
              showToast("Proyecto actualizado.");
            }
          });
        });
      });

    if (navigationTarget?.proyecto_id) {
      const targetProject = proyectos.find(
        (item) => item.id === navigationTarget.proyecto_id
      );

      if (targetProject) {
        const target = { ...navigationTarget };
        navigationTarget = null;
        await openProjectWorkspaceRecord(targetProject, target);
      }
    }
  }

  vigenciaSelector.addEventListener(
    "change",
    async () => {
      selectedVigenciaId =
        vigenciaSelector.value;

      await loadConsejerias();
    }
  );

  consejeriaSelector.addEventListener(
    "change",
    async () => {
      selectedVigenciaConsejeriaId =
        consejeriaSelector.value;

      await loadLineas();
    }
  );

  lineaSelector.addEventListener(
    "change",
    async () => {
      selectedLineaId =
        lineaSelector.value;

      await loadProgramas();
    }
  );

  programaSelector.addEventListener(
    "change",
    async () => {
      selectedProgramaId =
        programaSelector.value;

      await refreshProjects();
    }
  );

  newButton.addEventListener("click", () => {
    const vigencia = currentVigencia();
    const vc = currentConsejeria();
    const linea = currentLinea();
    const programa = currentPrograma();

    if (!vigencia || !vc || !linea || !programa) {
      return;
    }

    if (vc.estado !== "activa") {
      showToast(
        "La Consejería está inactiva. Reactívala antes de crear Proyectos."
      );
      return;
    }

    if (linea.estado !== "activa") {
      showToast(
        "La Línea de Acción no está activa. Reactívala antes de crear Proyectos."
      );
      return;
    }

    if (programa.estado !== "activo") {
      showToast(
        "El Programa no está activo. Reactívalo antes de crear Proyectos."
      );
      return;
    }

    openProyectoForm({
      vigencia,
      vigenciaConsejeria: vc,
      linea,
      programa,
      mandatos,

      onSaved: async () => {
        await refreshProjects();

        const total = calculateWeightTotal(proyectos);

        showToast(
          `Proyecto creado. Ponderación actual del Programa: ${formatPercent(total)}.`
        );
      }
    });
  });

  importButton.addEventListener(
    "click",
    () => {
      const vigencia = currentVigencia();
      const vc = currentConsejeria();
      const linea = currentLinea();
      const programa = currentPrograma();

      if (!vigencia || !vc || !linea || !programa) {
        return;
      }

      if (
        vc.estado !== "activa" ||
        linea.estado !== "activa" ||
        programa.estado !== "activo"
      ) {
        showToast(
          "Consejería, Línea y Programa deben estar activos para importar Proyectos."
        );
        return;
      }

      openImportProyectos({
        vigencia,
        vigenciaConsejeria: vc,
        linea,
        programa,
        mandatos,
        existingProjects: proyectos,

        onImported: async (imported) => {
          await refreshProjects();

          showToast(
            `${imported} ${imported === 1 ? "Proyecto importado" : "Proyectos importados"}. Revisa la ponderación total.`
          );
        }
      });
    }
  );

  copyButton.addEventListener(
    "click",
    async () => {
      try {
        await copyProyectosToClipboard(proyectos);

        showToast(
          `${proyectos.length} ${proyectos.length === 1 ? "Proyecto copiado" : "Proyectos copiados"} al portapapeles.`
        );
      } catch (error) {
        console.error(error);

        showToast(
          error.message ||
          "No fue posible copiar los Proyectos."
        );
      }
    }
  );

  weightsButton.addEventListener(
    "click",
    () => {
      const vigencia = currentVigencia();
      const vc = currentConsejeria();
      if (!vigencia || !vc) return;

      sessionStorage.setItem(
        "onic_ponderaciones_target",
        JSON.stringify({
          vigencia_id: vigencia.id,
          vigencia_consejeria_id: vc.id
        })
      );

      const navButton = document.querySelector(
        '.nav-item[data-view="ponderaciones"]'
      );

      if (navButton) {
        navButton.click();
        return;
      }

      openModal({
        title: "Ponderaciones",
        content: `
          <div class="danger-callout soft">
            <strong>La ponderación se administra desde el módulo Ponderaciones.</strong>
            <p>Allí los cambios se preparan como borrador y solo se guardan al aprobar la propuesta completa de la Consejería.</p>
          </div>
          <div class="form-actions">
            <button id="closeWeightsInfo" class="btn btn-secondary" type="button">Cerrar</button>
          </div>
        `
      });
      document.querySelector("#closeWeightsInfo")?.addEventListener("click", closeModal);
    }
  );

  try {
    await loadVigencias();
  } catch (error) {
    console.error(error);

    content.innerHTML = `
      <div class="empty-state">
        <strong>No fue posible cargar Proyectos.</strong>

        <p>
          ${escapeHTML(
            error.message ||
            "Revisa la conexión con Supabase y confirma que ejecutaste 006_proyecto_mandatos.sql."
          )}
        </p>
      </div>
    `;
  }
}
