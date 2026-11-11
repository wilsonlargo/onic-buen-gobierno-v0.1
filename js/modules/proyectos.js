import { requireSupabase } from "../supabaseClient.js?v=5.4.7";
import { updateWithVersion } from "../security.js?v=5.4.7";
import { openModal, closeModal } from "../components/modal.js?v=5.4.7";
import { renderProyectoWorkspace } from "./proyectoWorkspace.js?v=5.4.7";
import { setAuditContext, openAuditPanel } from "./auditoria.js?v=5.4.7";
import { friendlyErrorMessage } from "../userMessages.js?v=5.4.7";

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

function unitType(record) {
  return record?.tipo_unidad === "actividad_general" ? "actividad_general" : "proyecto";
}

function unitTypeLabel(record) {
  return unitType(record) === "actividad_general" ? "Actividad general" : "Proyecto";
}

function unitTypeChip(record) {
  const type = unitType(record);
  return `<span class="unit-type-chip ${type === "actividad_general" ? "activity" : "project"}">${type === "actividad_general" ? "Actividad general" : "Proyecto"}</span>`;
}

function projectStateToActivityState(estado) {
  const map = { borrador: "borrador", formulacion: "programada", activo: "en_ejecucion", suspendido: "suspendida", cerrado: "completada" };
  return map[estado] || "borrador";
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

async function updateProyecto(record, payload, mandatoIds = null) {
  const supabase = requireSupabase();
  const data = await updateWithVersion({
    table: "proyectos",
    record,
    payload,
    entityType: "Proyecto",
    entityName: record?.nombre || record?.codigo || null
  });

  if (Array.isArray(mandatoIds)) {
    const { error: deleteError } = await supabase
      .from("proyecto_mandatos")
      .delete()
      .eq("proyecto_id", record.id);

    if (deleteError) throw deleteError;

    if (mandatoIds.length) {
      const { error: insertError } = await supabase
        .from("proyecto_mandatos")
        .insert(
          mandatoIds.map((mandatoId) => ({
            proyecto_id: record.id,
            mandato_id: mandatoId
          }))
        );

      if (insertError) throw insertError;
    }
  }

  return data;
}

async function createActividadGeneral(payload, mandatoIds = []) {
  const supabase = requireSupabase();
  let proyecto = null;
  let actividad = null;
  try {
    proyecto = await createProyecto({ ...payload, tipo_unidad: "actividad_general" }, mandatoIds);
    const { data: createdActivity, error: activityError } = await supabase
      .from("actividades")
      .insert({
        proyecto_id: proyecto.id,
        codigo: proyecto.codigo,
        nombre: proyecto.nombre,
        descripcion: proyecto.descripcion || proyecto.objetivo_general || null,
        responsable: proyecto.responsable,
        fecha_inicio: proyecto.fecha_inicio,
        fecha_fin: proyecto.fecha_fin,
        estado: projectStateToActivityState(proyecto.estado),
        orden: 0
      })
      .select()
      .single();
    if (activityError) throw activityError;
    actividad = createdActivity;
    const { data: updated, error: updateError } = await supabase
      .from("proyectos")
      .update({ actividad_principal_id: actividad.id })
      .eq("id", proyecto.id)
      .select()
      .single();
    if (updateError) throw updateError;
    return updated;
  } catch (error) {
    if (actividad?.id) {
      try { await supabase.from("actividades").delete().eq("id", actividad.id); } catch (_) {}
    }
    if (proyecto?.id) {
      try { await supabase.from("proyectos").delete().eq("id", proyecto.id); } catch (_) {}
    }
    throw error;
  }
}

async function getProjectActivities(projectId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("actividades")
    .select("*")
    .eq("proyecto_id", projectId)
    .order("orden", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function convertProyectoToActividadGeneral(record) {
  const activities = await getProjectActivities(record.id);
  const currentActivities = activities.filter((activity) => activity.estado !== "cancelada");

  if (currentActivities.length > 1) {
    const error = new Error("MULTIPLE_ACTIVITIES");
    error.code = "MULTIPLE_ACTIVITIES";
    error.activityCount = currentActivities.length;
    error.historicalCount = activities.length - currentActivities.length;
    throw error;
  }

  const supabase = requireSupabase();
  let principal = currentActivities[0] || null;
  let createdPrincipal = false;
  try {
    if (!principal) {
      const { data, error } = await supabase
        .from("actividades")
        .insert({
          proyecto_id: record.id,
          codigo: record.codigo,
          nombre: record.nombre,
          descripcion: record.descripcion || record.objetivo_general || null,
          responsable: record.responsable,
          fecha_inicio: record.fecha_inicio,
          fecha_fin: record.fecha_fin,
          estado: projectStateToActivityState(record.estado),
          orden: 0
        })
        .select()
        .single();
      if (error) throw error;
      principal = data;
      createdPrincipal = true;
    }

    return await updateProyecto(record, { tipo_unidad: "actividad_general", actividad_principal_id: principal.id });
  } catch (error) {
    if (createdPrincipal && principal?.id) {
      try { await supabase.from("actividades").delete().eq("id", principal.id); } catch (_) {}
    }
    throw error;
  }
}

async function convertActividadGeneralToProyecto(record) {
  return updateProyecto(record, { tipo_unidad: "proyecto", actividad_principal_id: null });
}

async function syncGeneralActivityFromProject(project, activityId) {
  if (!activityId) return;
  const supabase = requireSupabase();
  const { data: activity, error: readError } = await supabase.from("actividades").select("*").eq("id", activityId).single();
  if (readError) throw readError;
  await updateWithVersion({
    table: "actividades",
    record: activity,
    payload: {
      codigo: project.codigo,
      nombre: project.nombre,
      descripcion: project.descripcion || project.objetivo_general || null,
      responsable: project.responsable,
      fecha_inicio: project.fecha_inicio,
      fecha_fin: project.fecha_fin,
      estado: projectStateToActivityState(project.estado)
    },
    entityType: "Actividad general",
    entityName: project.nombre
  });
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
  unitTypeRequested = "proyecto",
  onSaved
}) {
  const editing = Boolean(record);
  const selectedType = editing ? unitType(record) : (unitTypeRequested === "actividad_general" ? "actividad_general" : "proyecto");
  const unitLabel = selectedType === "actividad_general" ? "Actividad general" : "Proyecto";

  openModal({
    title: editing ? `Editar ${unitLabel.toLocaleLowerCase("es")}` : `Nueva ${unitLabel.toLocaleLowerCase("es")}`,
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
        <div class="unit-type-callout ${selectedType}">
          <strong>${unitLabel}</strong>
          <p>${selectedType === "actividad_general" ? "Se mide directamente con Indicadores, Seguimiento, Evidencias y Presupuesto. No necesita crear Actividades adicionales." : "Agrupa una o varias Actividades. Su avance se consolida desde las Actividades y sus Indicadores."}</p>
        </div>
        <input type="hidden" name="tipo_unidad" value="${selectedType}">
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
            <label for="proyectoNombre">Nombre de la unidad</label>
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
            <label for="proyectoPonderacion">Ponderación de la unidad</label>

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
              La unidad puede contribuir a uno o varios.
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
            ${editing ? "Guardar cambios" : `Crear ${unitLabel}`}
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
      orden: Number(formData.get("orden") || 0),
      tipo_unidad: selectedType
    };

    if (!payload.nombre) {
      message.textContent = `El nombre de ${selectedType === "actividad_general" ? "la Actividad general" : "el Proyecto"} es obligatorio.`;
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
      payload.metodo_ponderacion = "manual";
      payload.ponderacion = 0;
    }

    const selectedMandates = [
      ...form.querySelectorAll('input[name="mandatos"]:checked')
    ].map((input) => input.value);

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      if (editing) {
        const updated = await updateProyecto(record, payload, selectedMandates);
        if (selectedType === "actividad_general" && updated?.actividad_principal_id) {
          await syncGeneralActivityFromProject(updated, updated.actividad_principal_id);
        }
      } else if (selectedType === "actividad_general") {
        await createActividadGeneral(payload, selectedMandates);
      } else {
        await createProyecto(payload, selectedMandates);
      }

      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent =
        friendlyErrorMessage(error, `No fue posible guardar ${selectedType === "actividad_general" ? "la Actividad general" : "el Proyecto"}.`);

      submit.disabled = false;
      submit.textContent = editing
        ? "Guardar cambios"
        : `Crear ${unitLabel}`;
    }
  });

  syncFinanceField();
}

/* ==========================================================
   BORRADO SEGURO
   ========================================================== */

function openNewUnitChooser({ onProject, onActivity }) {
  openModal({
    title: "Agregar al Programa",
    content: `
      <div class="unit-choice-grid">
        <button id="chooseProjectUnit" class="unit-choice-card" type="button"><strong>Proyecto</strong><span>Agrupa una o varias Actividades y consolida su seguimiento.</span></button>
        <button id="chooseActivityUnit" class="unit-choice-card" type="button"><strong>Actividad general</strong><span>Se mide directamente con Indicadores, Seguimiento, Evidencias y Presupuesto.</span></button>
      </div>
      <div class="form-actions"><button id="cancelUnitChooser" class="btn btn-secondary" type="button">Cancelar</button></div>`
  });
  document.querySelector("#cancelUnitChooser")?.addEventListener("click", closeModal);
  document.querySelector("#chooseProjectUnit")?.addEventListener("click", () => { closeModal(); onProject(); });
  document.querySelector("#chooseActivityUnit")?.addEventListener("click", () => { closeModal(); onActivity(); });
}

function openConvertUnitDialog({ record, onChanged }) {
  const isGeneral = unitType(record) === "actividad_general";
  const targetLabel = isGeneral ? "Proyecto" : "Actividad general";
  openModal({
    title: `Convertir en ${targetLabel}`,
    content: `
      <div class="conversion-summary">${unitTypeChip(record)}<strong>${escapeHTML(record.nombre)}</strong><p>${isGeneral ? "La Actividad general pasará a ser un Proyecto. Sus indicadores, evidencias, presupuesto y seguimientos se conservarán dentro de su Actividad operativa." : "El Proyecto pasará a seguimiento directo. Si no tiene Actividades vigentes se creará su soporte operativo automáticamente; si tiene una sola, se conservará íntegramente."}</p></div>
      ${!isGeneral ? `<div class="notice"><strong>Protección de información</strong><p>Solo cuentan las Actividades vigentes. Las Actividades canceladas se conservan como histórico y no bloquean la conversión. Si existen más de una Actividad vigente, el Sistema detendrá la conversión para no alterar el cálculo ni la trazabilidad.</p></div>` : ""}
      <p id="convertUnitMessage" class="form-message"></p>
      <div class="form-actions"><button id="cancelConvertUnit" class="btn btn-secondary" type="button">Cancelar</button><button id="confirmConvertUnit" class="btn btn-primary" type="button">Convertir</button></div>`
  });
  document.querySelector("#cancelConvertUnit")?.addEventListener("click", closeModal);
  document.querySelector("#confirmConvertUnit")?.addEventListener("click", async () => {
    const button = document.querySelector("#confirmConvertUnit");
    const message = document.querySelector("#convertUnitMessage");
    button.disabled = true; button.textContent = "Convirtiendo…"; message.textContent = "";
    try {
      if (isGeneral) await convertActividadGeneralToProyecto(record);
      else await convertProyectoToActividadGeneral(record);
      closeModal();
      if (typeof onChanged === "function") await onChanged();
    } catch (error) {
      console.error(error);
      message.textContent = error?.code === "MULTIPLE_ACTIVITIES"
        ? `Este Proyecto contiene ${error.activityCount} Actividades vigentes${error.historicalCount ? ` y ${error.historicalCount} cancelada${error.historicalCount === 1 ? "" : "s"}` : ""}. No se modificó nada; primero requiere consolidación de las Actividades vigentes.`
        : friendlyErrorMessage(error, "No fue posible convertir la unidad.");
      button.disabled = false; button.textContent = "Convertir";
    }
  });
}

async function getGeneralActivityDependencyCounts(activityId) {
  if (!activityId) return { indicators: 0, budget: 0, evidence: 0, followups: 0 };
  const supabase = requireSupabase();
  const [indicators, budget, evidence, followups] = await Promise.all([
    supabase.from("indicadores_actividad").select("id", { count: "exact", head: true }).eq("actividad_id", activityId),
    supabase.from("presupuesto_actividad_rubros").select("id", { count: "exact", head: true }).eq("actividad_id", activityId),
    supabase.from("evidencias_actividad").select("id", { count: "exact", head: true }).eq("actividad_id", activityId),
    supabase.from("seguimientos_actividad").select("id", { count: "exact", head: true }).eq("actividad_id", activityId)
  ]);
  const result = { indicators, budget, evidence, followups };
  for (const query of Object.values(result)) if (query.error) throw query.error;
  return {
    indicators: Number(indicators.count || 0),
    budget: Number(budget.count || 0),
    evidence: Number(evidence.count || 0),
    followups: Number(followups.count || 0)
  };
}

async function openDeleteProyectoDialog({ record, onChanged }) {
  const isGeneral = unitType(record) === "actividad_general";
  const unitName = isGeneral ? "Actividad general" : "Proyecto";
  let activityCount = 0;
  let removablePrincipalId = null;

  try {
    activityCount = await getActividadCount(record.id);
    if (isGeneral && activityCount === 1 && record.actividad_principal_id) {
      const usage = await getGeneralActivityDependencyCounts(record.actividad_principal_id);
      const totalUsage = usage.indicators + usage.budget + usage.evidence + usage.followups;
      if (totalUsage === 0) {
        removablePrincipalId = record.actividad_principal_id;
        activityCount = 0;
      }
    }
  } catch (error) {
    console.error(error);

    openModal({
      title: `Eliminar ${unitName}`,
      content: `
        <div class="danger-callout">
          <strong>No se pudo verificar la estructura de la unidad.</strong>
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
      title: isGeneral ? "La Actividad general tiene seguimiento" : "El Proyecto tiene Actividades",
      content: `
        <div class="danger-callout">
          <strong>${escapeHTML(record.nombre)}</strong>
          <p>${isGeneral ? "Esta Actividad general ya contiene información de seguimiento y debe conservarse para mantener su trazabilidad." : `Este Proyecto contiene <strong>${activityCount} ${activityCount === 1 ? "Actividad" : "Actividades"}</strong> y ya forma parte de la estructura operativa. No puede eliminarse físicamente.`}</p>
        </div>
        <p class="muted">Conserva la unidad para mantener indicadores, presupuesto, evidencias y seguimientos.</p>
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
      title: `La ${isGeneral ? "Actividad general" : "unidad"} debe conservarse`,
      content: `
        <div class="danger-callout">
          <strong>${escapeHTML(record.nombre)}</strong>

          <p>
            Esta unidad ya está en estado
            <strong>${escapeHTML(record.estado)}</strong>.
            Para conservar la trazabilidad institucional no puede eliminarse físicamente.
          </p>
        </div>

        <p class="muted">
          Las unidades en ejecución, suspendidas o cerradas forman parte del historial
          del Programa. Puedes conservar su estado o cerrarla cuando corresponda.
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
            record,
            { estado: "cerrado" },
            null
          );

          closeModal();
          await onChanged();
        } catch (error) {
          console.error(error);
          message.textContent =
            friendlyErrorMessage(error, "No fue posible cerrar la unidad.");

          closeRecord.disabled = false;
          closeRecord.textContent = "Marcar como cerrado";
        }
      });
    }

    return;
  }

  openModal({
    title: `Eliminar ${unitName}`,
    content: `
      <div class="danger-callout">
        <strong>${escapeHTML(record.codigo || record.nombre)}</strong>

        <p>
          Esta ${isGeneral ? "Actividad general" : "unidad"} está en ${escapeHTML(record.estado)} y puede eliminarse
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
        .select("estado,tipo_unidad,actividad_principal_id")
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

      if (removablePrincipalId) {
        const { error: activityDeleteError } = await supabase.from("actividades").delete().eq("id", removablePrincipalId);
        if (activityDeleteError) throw activityDeleteError;
      }
      await deleteProyecto(record.id);
      closeModal();
      await onChanged();
    } catch (error) {
      console.error(error);
      message.textContent =
        friendlyErrorMessage(error, "No fue posible eliminar la unidad.");

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
    throw new Error("No hay unidades para copiar.");
  }

  const headers = [
    "codigo",
    "nombre",
    "tipo_unidad",
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
      unitType(proyecto),
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
  const workbook = window.XLSX.read(buffer, {
    cellDates: false
  });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];

  return window.XLSX.utils
    .sheet_to_json(sheet, {
      defval: "",
      raw: true
    })
    .map((row) => {
      const normalized = {};

      Object.entries(row).forEach(([key, value]) => {
        normalized[
          normalizeText(key).replace(/\s+/g, "_")
        ] = value ?? "";
      });

      return normalized;
    });
}

function isoDateFromParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (![y, m, d].every(Number.isInteger)) return "";
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return "";

  const date = new Date(Date.UTC(y, m - 1, d));

  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return "";
  }

  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeImportYear(value) {
  const year = Number(value);

  if (!Number.isInteger(year)) return NaN;
  if (year >= 100) return year;
  return year <= 69 ? 2000 + year : 1900 + year;
}

function excelSerialToISO(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 20000 || number > 100000) return "";

  const parsed = window.XLSX?.SSF?.parse_date_code?.(number);
  if (!parsed) return "";

  return isoDateFromParts(parsed.y, parsed.m, parsed.d);
}

function normalizeImportDate(value, label) {
  const original = value instanceof Date
    ? value.toISOString()
    : String(value ?? "").trim();

  if (value === null || value === undefined || original === "") {
    return {
      value: "",
      original: "",
      valid: true,
      changed: false,
      warning: "",
      error: ""
    };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const normalized = isoDateFromParts(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate()
    );

    return {
      value: normalized,
      original,
      valid: Boolean(normalized),
      changed: Boolean(normalized),
      warning: normalized ? `${label}: se normalizó automáticamente a ${normalized}.` : "",
      error: normalized ? "" : `${label}: la fecha recibida desde Excel no es válida.`
    };
  }

  if (typeof value === "number") {
    const normalized = excelSerialToISO(value);

    return {
      value: normalized,
      original,
      valid: Boolean(normalized),
      changed: Boolean(normalized),
      warning: normalized ? `${label}: Excel guardó la fecha como número (${original}) y se convirtió a ${normalized}.` : "",
      error: normalized ? "" : `${label}: el número ${original} no corresponde a una fecha válida de Excel.`
    };
  }

  const text = original.replace(/ /g, " ").trim();
  const lower = normalizeText(text);

  if (/^(#value!|#num!|#n\/a|n\/a|na|error|fecha invalida|fecha inválida|#####)$/.test(lower)) {
    return {
      value: "",
      original,
      valid: false,
      changed: false,
      warning: "",
      error: `${label}: Excel reporta «${original}». Revisa la celda de origen o selecciona una fecha válida.`
    };
  }

  if (/^\d{4,5}(?:[.,]\d+)?$/.test(text)) {
    const normalized = excelSerialToISO(text.replace(",", "."));

    if (normalized) {
      return {
        value: normalized,
        original,
        valid: true,
        changed: normalized !== original,
        warning: `${label}: se interpretó «${original}» como fecha de Excel y se convirtió a ${normalized}.`,
        error: ""
      };
    }
  }

  let match = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T].*)?$/);

  if (match) {
    const normalized = isoDateFromParts(match[1], match[2], match[3]);

    return {
      value: normalized,
      original,
      valid: Boolean(normalized),
      changed: Boolean(normalized && normalized !== text),
      warning: normalized && normalized !== text ? `${label}: se normalizó «${original}» a ${normalized}.` : "",
      error: normalized ? "" : `${label}: «${original}» no corresponde a una fecha real.`
    };
  }

  match = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})(?:[ T].*)?$/);

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = normalizeImportYear(match[3]);
    const normalized = isoDateFromParts(year, month, day);
    const ambiguous = day <= 12 && month <= 12;

    return {
      value: normalized,
      original,
      valid: Boolean(normalized),
      changed: Boolean(normalized),
      warning: normalized
        ? `${label}: se convirtió «${original}» a ${normalized}${ambiguous ? " interpretando el formato como día/mes/año" : ""}.`
        : "",
      error: normalized
        ? ""
        : `${label}: «${original}» no corresponde a una fecha real. Usa AAAA-MM-DD o DD/MM/AAAA.`
    };
  }

  const monthNames = {
    ene: 1, enero: 1, jan: 1, january: 1,
    feb: 2, febrero: 2, february: 2,
    mar: 3, marzo: 3, march: 3,
    abr: 4, abril: 4, apr: 4, april: 4,
    may: 5, mayo: 5,
    jun: 6, junio: 6, june: 6,
    jul: 7, julio: 7, july: 7,
    ago: 8, agosto: 8, aug: 8, august: 8,
    sep: 9, sept: 9, septiembre: 9, september: 9,
    oct: 10, octubre: 10, october: 10,
    nov: 11, noviembre: 11, november: 11,
    dic: 12, diciembre: 12, dec: 12, december: 12
  };

  match = lower.match(/^(\d{1,2})[\s\-]+([a-z]+)[\s\-,]+(\d{2}|\d{4})(?:\s.*)?$/);

  if (match && monthNames[match[2]]) {
    const normalized = isoDateFromParts(
      normalizeImportYear(match[3]),
      monthNames[match[2]],
      Number(match[1])
    );

    return {
      value: normalized,
      original,
      valid: Boolean(normalized),
      changed: Boolean(normalized),
      warning: normalized ? `${label}: se convirtió «${original}» a ${normalized}.` : "",
      error: normalized ? "" : `${label}: «${original}» no corresponde a una fecha real.`
    };
  }

  return {
    value: "",
    original,
    valid: false,
    changed: false,
    warning: "",
    error: `${label}: no se reconoce «${original}». Formatos admitidos: 2026-12-31, 31/12/2026 o una fecha real de Excel.`
  };
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

  const rawType = normalizeText(pick("tipo_unidad", "tipo", "clase", "unidad"));
  const tipo_unidad = ["actividad", "actividad_general", "actividad general", "general"].includes(rawType)
    ? "actividad_general"
    : "proyecto";
  const fechaInicioMeta = normalizeImportDate(
    pick("fecha_inicio", "inicio"),
    "Fecha de inicio"
  );
  const fechaFinMeta = normalizeImportDate(
    pick("fecha_fin", "fin", "cierre"),
    "Fecha de cierre"
  );

  return {
    codigo: String(pick("codigo", "código") || "").trim(),
    nombre: String(pick("nombre", "proyecto", "actividad") || "").trim(),
    tipo_unidad,
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
    fecha_inicio: fechaInicioMeta.value,
    fecha_fin: fechaFinMeta.value,
    dateMeta: {
      fecha_inicio: fechaInicioMeta,
      fecha_fin: fechaFinMeta
    },
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

    [row.dateMeta?.fecha_inicio, row.dateMeta?.fecha_fin]
      .filter(Boolean)
      .forEach((meta) => {
        if (meta.error) errors.push(meta.error);
        if (meta.warning) warnings.push(meta.warning);
      });

    if (
      row.fecha_inicio &&
      row.fecha_fin &&
      row.fecha_fin < row.fecha_inicio
    ) {
      errors.push(
        `La fecha de cierre (${row.fecha_fin}) es anterior a la fecha de inicio (${row.fecha_inicio}).`
      );
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

function importDateRepair(row, field, label) {
  const meta = row.dateMeta?.[field];

  if (!meta?.error) return "";

  return `
    <div class="import-date-repair">
      <div>
        <strong>${escapeHTML(label)}</strong>
        <small>Valor recibido: ${escapeHTML(meta.original || "vacío")}</small>
      </div>

      <div class="import-date-repair-actions">
        <label>
          <span>Corregir fecha</span>
          <input
            type="date"
            data-import-date-fix
            data-row-index="${row.index - 1}"
            data-field="${field}"
            aria-label="Corregir ${escapeHTML(label)} de la fila ${row.index}"
          >
        </label>

        <button
          class="btn btn-secondary btn-small"
          type="button"
          data-import-date-clear
          data-row-index="${row.index - 1}"
          data-field="${field}"
        >
          Dejar sin fecha
        </button>
      </div>
    </div>
  `;
}

function importPreview(rows) {
  if (!rows.length) {
    return `<div class="empty-state">Aún no hay datos para previsualizar.</div>`;
  }

  const validRows = rows.filter((row) => row.valid);
  const errorRows = rows.filter((row) => !row.valid);
  const correctedDates = rows.reduce((count, row) => {
    return count + [row.dateMeta?.fecha_inicio, row.dateMeta?.fecha_fin]
      .filter((meta) => meta?.valid && meta?.changed)
      .length;
  }, 0);
  const importedWeight = validRows.reduce(
    (sum, row) => sum + Number(row.ponderacion || 0),
    0
  );

  return `
    <div class="import-summary">
      <span class="status-chip active">
        ${validRows.length} válidos
      </span>

      <span class="status-chip ${errorRows.length ? "warning" : ""}">
        ${errorRows.length} con error
      </span>

      ${correctedDates
        ? `<span class="status-chip draft">${correctedDates} ${correctedDates === 1 ? "fecha corregida" : "fechas corregidas"} automáticamente</span>`
        : ""
      }

      <span class="status-chip">
        Peso importado: ${formatPercent(importedWeight)}
      </span>
    </div>

    ${errorRows.some((row) => row.dateMeta?.fecha_inicio?.error || row.dateMeta?.fecha_fin?.error)
      ? `<div class="import-diagnostic-banner">
          <strong>Hay fechas que necesitan revisión.</strong>
          <p>No tienes que borrar la columna. Corrige la fecha directamente en la fila o usa <strong>Dejar sin fecha</strong> si ese dato realmente no aplica.</p>
        </div>`
      : ""
    }

    <div class="table-wrap import-preview-wrap">
      <table class="data-table compact-table import-preview-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Código</th>
            <th>Unidad</th>
            <th>Inicio</th>
            <th>Cierre</th>
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
              <td>
                <strong>${escapeHTML(row.nombre || "—")}</strong>
                <small class="import-unit-type">${row.tipo_unidad === "actividad_general" ? "Actividad general" : "Proyecto"}</small>
              </td>
              <td class="import-date-cell">
                ${row.fecha_inicio ? `<strong>${escapeHTML(row.fecha_inicio)}</strong><small>${escapeHTML(formatDate(row.fecha_inicio))}</small>` : "—"}
              </td>
              <td class="import-date-cell">
                ${row.fecha_fin ? `<strong>${escapeHTML(row.fecha_fin)}</strong><small>${escapeHTML(formatDate(row.fecha_fin))}</small>` : "—"}
              </td>
              <td>${escapeHTML(row.estado)}</td>
              <td>${formatPercent(row.ponderacion)}</td>
              <td>${escapeHTML(row.mandatos || "—")}</td>

              <td class="import-validation-cell">
                ${row.errors.length
                  ? `<div class="validation-error">${escapeHTML(row.errors.join(" · "))}</div>`
                  : `<div class="validation-ok">Listo</div>`
                }

                ${row.warnings.length
                  ? `<div class="validation-warning">${escapeHTML(row.warnings.join(" · "))}</div>`
                  : ""
                }

                ${importDateRepair(row, "fecha_inicio", "Fecha de inicio")}
                ${importDateRepair(row, "fecha_fin", "Fecha de cierre")}
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
  let sourceRows = [];
  let pasteTimer = null;

  openModal({
    title: "Importar Proyectos / Actividades",
    size: "wide",
    content: `
      <div class="context-ribbon project-context-ribbon import-context-ribbon">
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

      <div class="import-assist-callout">
        <div>
          <strong>Importación asistida</strong>
          <p>El sistema valida los datos antes de guardar. Las fechas de Excel se normalizan automáticamente cuando es posible y, si alguna no se reconoce, podrás corregirla en la vista previa sin borrar toda la columna.</p>
        </div>
      </div>

      <div class="import-methods import-methods-clean">
        <section class="import-method">
          <div class="import-method-heading">
            <span class="import-step">1</span>
            <div>
              <h3>Pegar tabla</h3>
              <p class="muted">Copia desde Excel o Google Sheets. La validación comienza al pegar.</p>
            </div>
          </div>

          <textarea
            id="pasteProjects"
            class="import-textarea"
            placeholder="codigo&#9;nombre&#9;tipo_unidad&#9;fecha_inicio&#9;fecha_fin&#9;estado&#9;ponderacion"
          ></textarea>

          <small class="import-auto-hint">No necesitas pulsar otro botón: al pegar se genera la vista previa.</small>
        </section>

        <div class="import-divider"><span>o</span></div>

        <section class="import-method">
          <div class="import-method-heading">
            <span class="import-step">1</span>
            <div>
              <h3>Cargar archivo</h3>
              <p class="muted">CSV, XLSX o XLS. El archivo se lee inmediatamente después de seleccionarlo.</p>
            </div>
          </div>

          <label class="import-file-picker" for="projectsImportFile">
            <span>Seleccionar archivo</span>
            <small id="projectsImportFileName">Ningún archivo seleccionado</small>
          </label>

          <input
            id="projectsImportFile"
            class="import-file-input-hidden"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          >

          <small class="import-auto-hint">Las fechas reales de Excel y formatos como 31/12/2026 se convierten a AAAA-MM-DD.</small>
        </section>
      </div>

      <details class="import-template import-template-details">
        <summary>Ver columnas y formatos aceptados</summary>

        <div class="import-template-body">
          <strong>Encabezados recomendados</strong>

          <code>
            codigo | nombre | tipo_unidad | nombre_corto | descripcion | objetivo_general |
            responsable | fecha_inicio | fecha_fin | estado | tiene_financiacion |
            valor_estimado | ponderacion | mandatos | orden
          </code>

          <div class="import-format-grid">
            <p>
              <strong>Tipo de unidad</strong>
              Usa <code>proyecto</code> o <code>actividad_general</code>.
            </p>

            <p>
              <strong>Fechas</strong>
              Se aceptan fechas reales de Excel, <code>AAAA-MM-DD</code> y <code>DD/MM/AAAA</code>. Si una fecha es ambigua, se interpreta con criterio día/mes/año.
            </p>

            <p>
              <strong>Mandatos</strong>
              Para varios usa <code>|</code> o <code>;</code>. La coincidencia se hace por código o título.
            </p>
          </div>
        </div>
      </details>

      <p id="projectsImportMessage" class="form-message"></p>

      <section class="import-preview-section">
        <div class="import-preview-heading">
          <div>
            <span class="eyebrow">Paso 2</span>
            <h3>Revisar antes de importar</h3>
          </div>
          <small>Solo se guardarán las filas marcadas como válidas.</small>
        </div>

        <div id="projectsImportPreview">
          <div class="empty-state import-empty-state">
            Pega una tabla o selecciona un archivo. La vista previa aparecerá automáticamente.
          </div>
        </div>
      </section>

      <div class="form-actions sticky-actions import-sticky-actions">
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
  const fileInput = document.querySelector("#projectsImportFile");
  const fileName = document.querySelector("#projectsImportFileName");
  const preview = document.querySelector("#projectsImportPreview");
  const message = document.querySelector("#projectsImportMessage");
  const confirm = document.querySelector("#confirmProjectsImport");

  function bindDateRepairs() {
    preview
      .querySelectorAll("[data-import-date-fix]")
      .forEach((input) => {
        input.addEventListener("change", () => {
          const rowIndex = Number(input.dataset.rowIndex);
          const field = input.dataset.field;

          if (!Number.isInteger(rowIndex) || !field || !input.value || !sourceRows[rowIndex]) return;

          sourceRows[rowIndex][field] = input.value;
          message.textContent = "Fecha corregida. La fila se validó nuevamente.";
          setRows(sourceRows);
        });
      });

    preview
      .querySelectorAll("[data-import-date-clear]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const rowIndex = Number(button.dataset.rowIndex);
          const field = button.dataset.field;

          if (!Number.isInteger(rowIndex) || !field || !sourceRows[rowIndex]) return;

          sourceRows[rowIndex][field] = "";
          message.textContent = "La fecha se dejó vacía y la fila se validó nuevamente.";
          setRows(sourceRows);
        });
      });
  }

  function setRows(rawRows) {
    sourceRows = rawRows.map((row) => ({ ...row }));
    validatedRows = validateImportRows(
      sourceRows,
      existingProjects,
      mandatos
    );

    preview.innerHTML = importPreview(validatedRows);
    bindDateRepairs();

    const validCount = validatedRows.filter((row) => row.valid).length;
    const errorCount = validatedRows.length - validCount;

    confirm.disabled = validCount === 0;
    confirm.textContent = validCount
      ? `Importar ${validCount} ${validCount === 1 ? "unidad" : "unidades"}`
      : "Importar registros válidos";

    if (errorCount) {
      message.textContent = `${validCount} ${validCount === 1 ? "fila lista" : "filas listas"} y ${errorCount} ${errorCount === 1 ? "fila requiere revisión" : "filas requieren revisión"}.`;
    } else if (validatedRows.length) {
      message.textContent = `Todo listo: ${validatedRows.length} ${validatedRows.length === 1 ? "fila válida" : "filas válidas"}.`;
    }
  }

  function parsePastedRows() {
    const text = paste.value;

    if (!text.trim()) {
      sourceRows = [];
      validatedRows = [];
      confirm.disabled = true;
      confirm.textContent = "Importar registros válidos";
      message.textContent = "";
      preview.innerHTML = `
        <div class="empty-state import-empty-state">
          Pega una tabla o selecciona un archivo. La vista previa aparecerá automáticamente.
        </div>
      `;
      return;
    }

    const rows = parseDelimitedText(text);

    if (!rows.length) {
      message.textContent = "No se detectaron filas para importar. Comprueba que la primera fila contenga encabezados.";
      return;
    }

    setRows(rows);
  }

  async function loadSelectedFile() {
    message.textContent = "";

    const file = fileInput.files?.[0];

    if (!file) {
      fileName.textContent = "Ningún archivo seleccionado";
      return;
    }

    fileName.textContent = file.name;
    message.textContent = `Analizando ${file.name}…`;

    try {
      const extension = file.name.split(".").pop()?.toLowerCase();

      if (!["csv", "xlsx", "xls"].includes(extension || "")) {
        throw new Error("Formato no admitido. Usa un archivo CSV, XLSX o XLS.");
      }

      const rows = extension === "csv"
        ? parseDelimitedText(await file.text())
        : await readSpreadsheetFile(file);

      if (!rows.length) {
        message.textContent = "El archivo no contiene filas utilizables. Comprueba la primera hoja y los encabezados.";
        return;
      }

      paste.value = "";
      setRows(rows);
    } catch (error) {
      console.error(error);
      message.textContent = friendlyErrorMessage(error, "No fue posible leer el archivo.");
    }
  }

  document
    .querySelector("#cancelProjectsImport")
    .addEventListener("click", closeModal);

  paste.addEventListener("paste", () => {
    window.setTimeout(parsePastedRows, 0);
  });

  paste.addEventListener("input", () => {
    window.clearTimeout(pasteTimer);
    pasteTimer = window.setTimeout(parsePastedRows, 350);
  });

  fileInput.addEventListener("change", loadSelectedFile);

  confirm.addEventListener("click", async () => {
    const validRows = validatedRows.filter((row) => row.valid);

    if (!validRows.length) return;

    confirm.disabled = true;
    confirm.textContent = "Importando…";
    message.textContent = "";

    try {
      let imported = 0;

      for (const row of validRows) {
        const payload = {
          programa_id: programa.id,
          codigo: row.codigo || null,
          nombre: row.nombre,
          nombre_corto: row.nombre_corto || null,
          descripcion: row.descripcion || null,
          objetivo_general: row.objetivo_general || null,
          responsable: row.responsable || null,
          fecha_inicio: row.fecha_inicio || null,
          fecha_fin: row.fecha_fin || null,
          estado: row.estado,
          tiene_financiacion: row.tiene_financiacion,
          valor_estimado: row.tiene_financiacion ? row.valor_estimado : null,
          metodo_ponderacion: "manual",
          ponderacion: row.ponderacion,
          orden: row.orden,
          tipo_unidad: row.tipo_unidad
        };

        if (row.tipo_unidad === "actividad_general") {
          await createActividadGeneral(payload, row.mandateIds);
        } else {
          await createProyecto(payload, row.mandateIds);
        }

        imported++;
      }

      closeModal();
      await onImported(imported);
    } catch (error) {
      console.error(error);
      message.textContent = friendlyErrorMessage(error, "No fue posible completar la importación.");
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
  let unitFilter = "todos";

  let selectedVigenciaId = "";
  let selectedVigenciaConsejeriaId = "";
  let selectedLineaId = "";
  let selectedProgramaId = "";

  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Planeación operativa</p>
        <h2>Proyectos / Actividades</h2>
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
          + Agregar
        </button>
      </div>
    </div>

    <section class="panel strategic-selector-panel project-selector-panel" style="margin-top: 0">
      <div class="strategic-selector-intro">
        <p class="eyebrow">Ubicación de trabajo</p>
        <h2>Selecciona el Programa</h2>

        <p class="muted">
          Cada Programa puede contener Proyectos o Actividades generales. Selecciona
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
          <p class="eyebrow">Unidades del Programa</p>
          <h2 id="projectsPanelTitle">Proyectos / Actividades</h2>
        </div>

        <span id="projectsCount" class="status-chip">0</span>
      </div>

      <div class="unit-filter-tabs" role="tablist" aria-label="Filtrar unidades">
        <button class="unit-filter-tab active" data-unit-filter="todos" type="button">Todos <span id="unitCountAll">0</span></button>
        <button class="unit-filter-tab" data-unit-filter="proyecto" type="button">Proyectos <span id="unitCountProjects">0</span></button>
        <button class="unit-filter-tab" data-unit-filter="actividad_general" type="button">Actividades generales <span id="unitCountActivities">0</span></button>
      </div>
      <div id="projectsContent" style="margin-top: 18px">
        <div class="empty-state">
          <strong>Selecciona un Programa.</strong>
          <p>Sus Proyectos y Actividades generales aparecerán aquí.</p>
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
      title.textContent = "Proyectos / Actividades";
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
      `Proyectos / Actividades · ${programa.nombre}`;
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
        <p>Sus Proyectos y Actividades generales aparecerán aquí.</p>
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
    listView.querySelector("#unitCountAll").textContent = String(proyectos.length);
    listView.querySelector("#unitCountProjects").textContent = String(proyectos.filter((item) => unitType(item) === "proyecto").length);
    listView.querySelector("#unitCountActivities").textContent = String(proyectos.filter((item) => unitType(item) === "actividad_general").length);
    listView.querySelectorAll("[data-unit-filter]").forEach((button) => button.classList.toggle("active", button.dataset.unitFilter === unitFilter));

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
        ruta: `${vigencia.nombre} › ${vc.consejerias.nombre_corto} › ${linea.nombre} › ${programa.nombre} › Proyectos / Actividades`,
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
          <strong>Este Programa aún no tiene unidades de gestión.</strong>
          <p>Crea un Proyecto o una Actividad general. La ponderación del Programa se distribuirá entre ambas clases de unidad.</p>
        </div>
      `;

      return;
    }

    const visibleUnits = unitFilter === "todos" ? proyectos : proyectos.filter((item) => unitType(item) === unitFilter);
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
          <span>Unidades</span>
          <strong>${proyectos.length}</strong>
        </div>

        <div class="project-summary-stat">
          <span>Valor financiado</span>
          <strong>${formatMoney(financedTotal)}</strong>
        </div>
      </div>

      <div class="projects-grid">
        ${visibleUnits.map((proyecto) => {
          const mandates = mandateLabels(proyecto);

          return `
            <article class="project-card">
              <div class="project-card-header">
                <div>
                  <p class="eyebrow">
                    ${escapeHTML(
                      proyecto.codigo ||
                      proyecto.nombre_corto ||
                      `${unitTypeLabel(proyecto)} ${Number(proyecto.orden || 0) + 1}`
                    )}
                  </p>

                  <h3>${escapeHTML(proyecto.nombre)}</h3>
                </div>

                <div class="project-card-chips">${unitTypeChip(proyecto)}${statusChip(proyecto.estado)}</div>
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
                  <span>Avance técnico</span>
                  <strong>—</strong>
                  <small>Ver avance al abrir la unidad</small>
                </div>

                <div class="calculation-item">
                  <span>Contribución</span>
                  <strong>—</strong>
                  <small>${unitType(proyecto) === "actividad_general" ? "Calculada desde sus indicadores" : "Calculada desde las Actividades"}</small>
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
                  Abrir ${unitType(proyecto) === "actividad_general" ? "actividad" : "proyecto"}
                </button>

                <button
                  class="btn btn-secondary audit-project-note"
                  type="button"
                  data-id="${proyecto.id}"
                >
                  Nota
                </button>

                <button
                  class="btn btn-secondary convert-unit"
                  type="button"
                  data-id="${proyecto.id}"
                >
                  ${unitType(proyecto) === "actividad_general" ? "Convertir en Proyecto" : "Convertir en Actividad"}
                </button>

                <button
                  class="icon-btn danger delete-project"
                  type="button"
                  data-id="${proyecto.id}"
                  title="Eliminar unidad"
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
          A diferencia de Líneas y Programas, la ponderación de estas unidades es modificable.
          Proyectos y Actividades generales comparten el mismo nivel dentro del Programa y su total debe sumar exactamente 100,00 %.
          Los Proyectos consolidan sus Actividades; las Actividades generales se miden directamente con sus Indicadores.
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
                { value: "planeador", label: "Planeador", navigation: { project_tab: "planeador" } },
                { value: "actividades", label: "Actividades", navigation: { project_tab: "actividades" } },
                { value: "seguimiento", label: "Seguimiento", navigation: { project_tab: "seguimiento" } }
              ]
            }
          });
        });
      });

    content
      .querySelectorAll(".convert-unit")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const record = proyectos.find((item) => item.id === button.dataset.id);
          if (!record) return;
          openConvertUnitDialog({
            record,
            onChanged: async () => {
              await refreshProjects();
              showToast(unitType(record) === "actividad_general" ? "Actividad general convertida en Proyecto." : "Proyecto convertido en Actividad general.");
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

    listView.querySelectorAll("[data-unit-filter]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (button.dataset.unitFilter === unitFilter) return;
        unitFilter = button.dataset.unitFilter;
        await refreshProjects();
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
        "La Consejería está inactiva. Reactívala antes de agregar unidades."
      );
      return;
    }

    if (linea.estado !== "activa") {
      showToast(
        "La Línea de Acción no está activa. Reactívala antes de agregar unidades."
      );
      return;
    }

    if (programa.estado !== "activo") {
      showToast(
        "El Programa no está activo. Reactívalo antes de agregar unidades."
      );
      return;
    }

    const openUnitForm = (requestedType) => openProyectoForm({
      vigencia,
      vigenciaConsejeria: vc,
      linea,
      programa,
      mandatos,
      unitTypeRequested: requestedType,
      onSaved: async () => {
        await refreshProjects();
        const total = calculateWeightTotal(proyectos);
        showToast(`${requestedType === "actividad_general" ? "Actividad general" : "Proyecto"} creado. Ponderación actual del Programa: ${formatPercent(total)}.`);
      }
    });

    openNewUnitChooser({
      onProject: () => openUnitForm("proyecto"),
      onActivity: () => openUnitForm("actividad_general")
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
          friendlyErrorMessage(error, "No fue posible copiar los Proyectos.")
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
        <strong>No fue posible cargar Proyectos / Actividades.</strong>

        <p>
          ${escapeHTML(
            friendlyErrorMessage(error, "No fue posible cargar las unidades. Intenta nuevamente o informa al administrador del Sistema.")
          )}
        </p>
      </div>
    `;
  }
}
