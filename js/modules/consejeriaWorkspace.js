import { requireSupabase } from "../supabaseClient.js?v=5.4.9";
import { updateWithVersion } from "../security.js?v=5.4.9";
import { openModal, closeModal } from "../components/modal.js?v=5.4.9";
import { setAuditContext } from "./auditoria.js?v=5.4.9";
import { openDocumentReportDialog, documentReportIcon } from "./documentReports.js?v=5.4.9";
import {
  formatConsejeriaProgress,
  getConsejeriaProgressState
} from "./consejeriaProgress.js?v=5.4.9";
import { friendlyErrorMessage } from "../userMessages.js?v=5.4.9";

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

function initials(value = "") {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "ON";

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
}

function normalizeImageUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);

    if (parsed.hostname.includes("drive.google.com")) {
      let fileId = "";

      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
      if (fileMatch?.[1]) fileId = fileMatch[1];

      if (!fileId) {
        fileId = parsed.searchParams.get("id") || "";
      }

      if (fileId) {
        return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1000`;
      }
    }

    return raw;
  } catch {
    return raw;
  }
}

function photoHTML(url, fallback, alt = "") {
  const normalized = normalizeImageUrl(url);

  if (!normalized) {
    return `<div class="media-placeholder photo-placeholder">${escapeHTML(fallback)}</div>`;
  }

  return `
    <img
      src="${escapeHTML(normalized)}"
      alt="${escapeHTML(alt)}"
      class="consejero-photo"
      loading="lazy"
      referrerpolicy="no-referrer"
      onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';"
    >
    <div class="media-placeholder photo-placeholder" style="display:none">
      ${escapeHTML(fallback)}
    </div>
  `;
}

function statusChip(estado) {
  const active = estado === "activa";

  return `
    <span class="status-chip ${active ? "active" : "closed"}">
      ${active ? "Activa" : "Inactiva"}
    </span>
  `;
}

function mandateStatusChip(estado) {
  const css =
    estado === "activo"
      ? "active"
      : estado === "archivado"
        ? "closed"
        : "warning";

  const label =
    estado === "activo"
      ? "Activo"
      : estado === "archivado"
        ? "Archivado"
        : "Inactivo";

  return `<span class="status-chip ${css}">${label}</span>`;
}

function arrowIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5"></path>
      <path d="M12 19l-7-7 7-7"></path>
    </svg>
  `;
}


function trashIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16"></path>
      <path d="M9 7V4h6v3"></path>
      <path d="M7 7l1 13h8l1-13"></path>
      <path d="M10 11v5"></path>
      <path d="M14 11v5"></path>
    </svg>
  `;
}

function externalIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5"></path>
      <path d="M19 5l-9 9"></path>
      <path d="M18 13v6H5V6h6"></path>
    </svg>
  `;
}

function documentTypeMeta(type = "enlace") {
  const metas = {
    texto: {
      label: "Texto / documento",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3h8l4 4v14H6z"></path>
          <path d="M14 3v5h5"></path>
          <path d="M9 12h6"></path>
          <path d="M9 16h6"></path>
        </svg>
      `
    },
    video: {
      label: "Video",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="14" height="14" rx="2"></rect>
          <path d="M17 10l4-3v10l-4-3z"></path>
        </svg>
      `
    },
    pdf: {
      label: "PDF",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3h8l4 4v14H6z"></path>
          <path d="M14 3v5h5"></path>
          <path d="M8.5 16h7"></path>
          <path d="M9 12.5h6"></path>
        </svg>
      `
    },
    word: {
      label: "Word",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 3h10l4 4v14H5z"></path>
          <path d="M15 3v5h5"></path>
          <path d="M8 12l1.3 5 1.7-4 1.7 4 1.3-5"></path>
        </svg>
      `
    },
    presentacion: {
      label: "Presentación",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="16" height="11" rx="1"></rect>
          <path d="M12 15v5"></path>
          <path d="M8 20h8"></path>
          <path d="M8 8h8"></path>
          <path d="M8 11h5"></path>
        </svg>
      `
    },
    hoja_calculo: {
      label: "Hoja de cálculo",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="1"></rect>
          <path d="M4 9h16"></path>
          <path d="M10 9v12"></path>
          <path d="M4 15h16"></path>
        </svg>
      `
    },
    imagen: {
      label: "Imagen",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2"></rect>
          <circle cx="8" cy="9" r="1.5"></circle>
          <path d="M4 17l5-5 4 4 2-2 5 4"></path>
        </svg>
      `
    },
    audio: {
      label: "Audio",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 18V6l9-2v12"></path>
          <circle cx="6.5" cy="18" r="2.5"></circle>
          <circle cx="15.5" cy="16" r="2.5"></circle>
        </svg>
      `
    },
    enlace: {
      label: "Enlace web",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"></path>
          <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"></path>
        </svg>
      `
    },
    otro: {
      label: "Otro",
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3h8l4 4v14H6z"></path>
          <path d="M14 3v5h5"></path>
        </svg>
      `
    }
  };

  return metas[type] || metas.enlace;
}

function documentIconHTML(type, sizeClass = "") {
  const meta = documentTypeMeta(type);

  return `
    <span class="document-type-icon ${escapeHTML(type)} ${escapeHTML(sizeClass)}" title="${escapeHTML(meta.label)}">
      ${meta.icon}
    </span>
  `;
}

function keywords(value = "") {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/* ==========================================================
   DATOS
   ========================================================== */

async function updateVigenciaConsejeria(record, payload) {
  return updateWithVersion({
    table: "vigencia_consejerias",
    record,
    payload,
    entityType: "Consejería en Vigencia",
    entityName: record?.consejerias?.nombre_corto || record?.consejerias?.nombre_largo || record?.responsable || null,
    vigenciaId: record?.vigencia_id || null,
    vigenciaConsejeriaId: record?.id || null
  });
}

async function getMandatosVigencia(vigenciaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("mandatos")
    .select("id,codigo,titulo,texto,observaciones,orden,estado,fuente_id")
    .eq("vigencia_id", vigenciaId)
    .order("orden", { ascending: true })
    .order("codigo", { ascending: true });

  if (error) throw error;

  const rows = data || [];
  const sourceIds = [
    ...new Set(
      rows.map((item) => item.fuente_id).filter(Boolean)
    )
  ];

  let sources = [];

  if (sourceIds.length) {
    const { data: sourceData, error: sourceError } = await supabase
      .from("fuentes_mandatos")
      .select("id,nombre")
      .in("id", sourceIds);

    if (sourceError) throw sourceError;
    sources = sourceData || [];
  }

  const sourceMap = new Map(
    sources.map((source) => [source.id, source.nombre])
  );

  return rows.map((item) => ({
    ...item,
    fuente_nombre: sourceMap.get(item.fuente_id) || null
  }));
}

async function getAssignedMandateIds(vigenciaConsejeriaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("mandato_consejerias")
    .select("mandato_id")
    .eq("vigencia_consejeria_id", vigenciaConsejeriaId);

  if (error) throw error;

  return (data || []).map((item) => item.mandato_id);
}

async function getMandatesUsedByProjects(
  vigenciaConsejeriaId,
  mandateIds
) {
  if (!mandateIds.length) return [];

  const supabase = requireSupabase();

  const { data: lineas, error: lineError } = await supabase
    .from("lineas_accion")
    .select("id")
    .eq("vigencia_consejeria_id", vigenciaConsejeriaId);

  if (lineError) throw lineError;

  const lineIds = (lineas || []).map((item) => item.id);
  if (!lineIds.length) return [];

  const { data: programas, error: programError } = await supabase
    .from("programas")
    .select("id")
    .in("linea_accion_id", lineIds);

  if (programError) throw programError;

  const programIds = (programas || []).map((item) => item.id);
  if (!programIds.length) return [];

  const { data: proyectos, error: projectError } = await supabase
    .from("proyectos")
    .select("id")
    .in("programa_id", programIds);

  if (projectError) throw projectError;

  const projectIds = (proyectos || []).map((item) => item.id);
  if (!projectIds.length) return [];

  const { data: links, error: linkError } = await supabase
    .from("proyecto_mandatos")
    .select("mandato_id")
    .in("proyecto_id", projectIds)
    .in("mandato_id", mandateIds);

  if (linkError) throw linkError;

  return [
    ...new Set(
      (links || [])
        .map((item) => item.mandato_id)
        .filter(Boolean)
    )
  ];
}

async function saveMandateAssignments(
  vigenciaConsejeriaId,
  desiredIds
) {
  const supabase = requireSupabase();

  const currentIds = await getAssignedMandateIds(
    vigenciaConsejeriaId
  );

  const current = new Set(currentIds);
  const desired = new Set(desiredIds);

  const additions = desiredIds.filter(
    (id) => !current.has(id)
  );

  const removals = currentIds.filter(
    (id) => !desired.has(id)
  );

  if (removals.length) {
    const protectedIds = await getMandatesUsedByProjects(
      vigenciaConsejeriaId,
      removals
    );

    if (protectedIds.length) {
      const error = new Error(
        "Uno o varios Mandatos que intentas retirar ya están vinculados a Proyectos de esta Consejería. Deben conservarse para mantener la trazabilidad."
      );

      error.protectedMandateIds = protectedIds;
      throw error;
    }
  }

  if (removals.length) {
    const { error } = await supabase
      .from("mandato_consejerias")
      .delete()
      .eq("vigencia_consejeria_id", vigenciaConsejeriaId)
      .in("mandato_id", removals);

    if (error) throw error;
  }

  if (additions.length) {
    const { error } = await supabase
      .from("mandato_consejerias")
      .insert(
        additions.map((mandatoId) => ({
          mandato_id: mandatoId,
          vigencia_consejeria_id: vigenciaConsejeriaId
        }))
      );

    if (error) throw error;
  }

  return {
    added: additions.length,
    removed: removals.length
  };
}

async function getDocuments(vigenciaConsejeriaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("biblioteca_consejeria_documentos")
    .select("*")
    .eq("vigencia_consejeria_id", vigenciaConsejeriaId)
    .order("orden", { ascending: true })
    .order("titulo", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function createDocument(payload) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("biblioteca_consejeria_documentos")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateDocument(record, payload) {
  return updateWithVersion({
    table: "biblioteca_consejeria_documentos",
    record,
    payload,
    entityType: "Documento de biblioteca",
    entityName: record?.titulo || null,
    vigenciaConsejeriaId: record?.vigencia_consejeria_id || null
  });
}

async function deleteDocument(id) {
  const supabase = requireSupabase();

  const { error } = await supabase
    .from("biblioteca_consejeria_documentos")
    .delete()
    .eq("id", id);

  if (error) throw error;
}


/* ==========================================================
   DOCUMENTO
   ========================================================== */

function documentTypeOptions(selected = "enlace") {
  const types = [
    "texto",
    "video",
    "pdf",
    "word",
    "presentacion",
    "hoja_calculo",
    "imagen",
    "audio",
    "enlace",
    "otro"
  ];

  return types
    .map((type) =>
      option(
        type,
        documentTypeMeta(type).label,
        type === selected
      )
    )
    .join("");
}


function openDeleteDocumentDialog({
  record,
  onDeleted
}) {
  openModal({
    title: "Eliminar documento de la Biblioteca",

    content: `
      <div class="danger-callout">
        <strong>${escapeHTML(record.titulo)}</strong>

        <p>
          El vínculo documental será eliminado definitivamente de esta
          Consejería. Esta acción no elimina el archivo en Google Drive,
          YouTube, OneDrive u otra plataforma externa; únicamente elimina
          su registro en la Biblioteca.
        </p>
      </div>

      <p class="muted">
        Si solo deseas conservarlo fuera de la vista principal, utiliza
        <strong>Archivar</strong> en lugar de eliminarlo.
      </p>

      <div class="form-field">
        <label for="deleteConsejeriaDocumentConfirmation">
          Escribe <strong>ELIMINAR</strong> para confirmar
        </label>

        <input
          id="deleteConsejeriaDocumentConfirmation"
          autocomplete="off"
          placeholder="ELIMINAR"
        >
      </div>

      <p
        id="deleteConsejeriaDocumentMessage"
        class="form-message"
      ></p>

      <div class="form-actions">
        <button
          id="cancelDeleteConsejeriaDocument"
          class="btn btn-secondary"
          type="button"
        >
          Cancelar
        </button>

        <button
          id="confirmDeleteConsejeriaDocument"
          class="btn btn-danger"
          type="button"
          disabled
        >
          Eliminar definitivamente
        </button>
      </div>
    `
  });

  const input =
    document.querySelector(
      "#deleteConsejeriaDocumentConfirmation"
    );

  const confirm =
    document.querySelector(
      "#confirmDeleteConsejeriaDocument"
    );

  const message =
    document.querySelector(
      "#deleteConsejeriaDocumentMessage"
    );

  document
    .querySelector(
      "#cancelDeleteConsejeriaDocument"
    )
    .addEventListener("click", closeModal);

  input.addEventListener("input", () => {
    confirm.disabled =
      input.value.trim().toUpperCase() !==
      "ELIMINAR";
  });

  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    confirm.textContent = "Eliminando…";
    message.textContent = "";

    try {
      await deleteDocument(record.id);
      closeModal();
      await onDeleted();
    } catch (error) {
      console.error(error);

      message.textContent =
        friendlyErrorMessage(error, "No fue posible eliminar el documento.");

      confirm.disabled = false;
      confirm.textContent =
        "Eliminar definitivamente";
    }
  });
}

function openDocumentForm({
  vigenciaConsejeriaId,
  record = null,
  onSaved
}) {
  const editing = Boolean(record);
  const initialType = record?.tipo_documento || "enlace";

  openModal({
    title: editing
      ? "Editar documento"
      : "Agregar documento a la Biblioteca",

    content: `
      <form id="consejeriaDocumentForm">
        <div class="document-editor-preview">
          <div id="documentTypePreview">
            ${documentIconHTML(initialType, "large")}
          </div>

          <div>
            <span class="context-label">Tipo de documento</span>
            <strong id="documentTypePreviewLabel">
              ${escapeHTML(documentTypeMeta(initialType).label)}
            </strong>
          </div>
        </div>

        <div class="form-grid">
          <div class="form-field full">
            <label for="documentTitle">Título del documento</label>
            <input
              id="documentTitle"
              name="titulo"
              required
              value="${escapeHTML(record?.titulo || "")}"
              placeholder="Ej. Capítulo Indígena del Acuerdo de Paz 2016"
            >
          </div>

          <div class="form-field full">
            <label for="documentKeywords">Palabras claves / categorías</label>
            <input
              id="documentKeywords"
              name="palabras_clave"
              value="${escapeHTML(record?.palabras_clave || "")}"
              placeholder="paz, acuerdos, derechos"
            >
            <small class="field-help">
              Separa las palabras con coma.
            </small>
          </div>

          <div class="form-field full">
            <label for="documentDescription">Descripción / Tema del documento</label>
            <textarea
              id="documentDescription"
              name="descripcion"
              rows="4"
            >${escapeHTML(record?.descripcion || "")}</textarea>
          </div>

          <div class="form-field full">
            <label for="documentUrl">Vínculo al documento</label>
            <input
              id="documentUrl"
              name="url"
              type="url"
              required
              value="${escapeHTML(record?.url || "")}"
              placeholder="https://..."
            >
            <small class="field-help">
              La Biblioteca registra vínculos. El archivo permanece en su plataforma de origen.
            </small>
          </div>

          <div class="form-field">
            <label for="documentType">Tipo</label>
            <select id="documentType" name="tipo_documento">
              ${documentTypeOptions(initialType)}
            </select>
          </div>

          <div class="form-field">
            <label for="documentOrder">Orden</label>
            <input
              id="documentOrder"
              name="orden"
              type="number"
              min="0"
              step="1"
              value="${Number(record?.orden ?? 0)}"
            >
          </div>

          <div class="form-field">
            <label for="documentState">Estado</label>
            <select id="documentState" name="estado">
              ${option(
                "activo",
                "Activo",
                (record?.estado || "activo") === "activo"
              )}
              ${option(
                "archivado",
                "Archivado",
                record?.estado === "archivado"
              )}
            </select>
          </div>
        </div>

        <p id="documentFormMessage" class="form-message"></p>

        <div class="form-actions">
          <button
            id="cancelDocumentForm"
            class="btn btn-secondary"
            type="button"
          >
            Cancelar
          </button>

          <button class="btn btn-primary" type="submit">
            ${editing ? "Guardar cambios" : "Agregar a Biblioteca"}
          </button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#consejeriaDocumentForm");
  const typeSelect = document.querySelector("#documentType");
  const preview = document.querySelector("#documentTypePreview");
  const previewLabel =
    document.querySelector("#documentTypePreviewLabel");
  const message =
    document.querySelector("#documentFormMessage");

  typeSelect.addEventListener("change", () => {
    const meta = documentTypeMeta(typeSelect.value);
    preview.innerHTML =
      documentIconHTML(typeSelect.value, "large");
    previewLabel.textContent = meta.label;
  });

  document
    .querySelector("#cancelDocumentForm")
    .addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const data = new FormData(form);

    const payload = {
      titulo: data.get("titulo")?.trim(),
      palabras_clave:
        data.get("palabras_clave")?.trim() || null,
      descripcion:
        data.get("descripcion")?.trim() || null,
      url: data.get("url")?.trim(),
      tipo_documento: data.get("tipo_documento"),
      orden: Number(data.get("orden") || 0),
      estado: data.get("estado")
    };

    if (!payload.titulo || !payload.url) {
      message.textContent =
        "Título y vínculo son obligatorios.";
      return;
    }

    if (!editing) {
      payload.vigencia_consejeria_id =
        vigenciaConsejeriaId;
    }

    const submit =
      form.querySelector('button[type="submit"]');

    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      if (editing) {
        await updateDocument(record, payload);
      } else {
        await createDocument(payload);
      }

      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent =
        friendlyErrorMessage(error, "No fue posible guardar el documento.");

      submit.disabled = false;
      submit.textContent =
        editing
          ? "Guardar cambios"
          : "Agregar a Biblioteca";
    }
  });
}


function planningStatusChip(estado = "") {
  const value = String(estado || "").toLowerCase();
  const active = ["activa", "activo", "en_ejecucion"].includes(value);
  const closed = ["inactiva", "inactivo", "cerrado", "archivado", "cancelado"].includes(value);
  const css = active ? "active" : closed ? "closed" : "warning";
  const labels = {
    activa: "Activa",
    activo: "Activo",
    inactiva: "Inactiva",
    inactivo: "Inactivo",
    formulacion: "Formulación",
    cerrado: "Cerrado",
    archivado: "Archivado",
    cancelado: "Cancelado"
  };
  return `<span class="status-chip ${css}">${escapeHTML(labels[value] || estado || "Sin estado")}</span>`;
}

async function getPlanningStructure(vigenciaConsejeriaId) {
  const supabase = requireSupabase();

  const { data: lineas, error: lineError } = await supabase
    .from("lineas_accion")
    .select("id,nombre,nombre_corto,descripcion,orden,estado")
    .eq("vigencia_consejeria_id", vigenciaConsejeriaId)
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });
  if (lineError) throw lineError;

  const lineRows = lineas || [];
  const lineIds = lineRows.map((item) => item.id);
  let programas = [];
  if (lineIds.length) {
    const { data, error } = await supabase
      .from("programas")
      .select("id,linea_accion_id,nombre,nombre_corto,descripcion,orden,estado")
      .in("linea_accion_id", lineIds)
      .order("orden", { ascending: true })
      .order("nombre", { ascending: true });
    if (error) throw error;
    programas = data || [];
  }

  const programIds = programas.map((item) => item.id);
  let proyectos = [];
  if (programIds.length) {
    const { data, error } = await supabase
      .from("proyectos")
      .select("id,programa_id,codigo,nombre,nombre_corto,descripcion,responsable,fecha_inicio,fecha_fin,estado,orden,tipo_unidad,actividad_principal_id")
      .in("programa_id", programIds)
      .order("orden", { ascending: true })
      .order("nombre", { ascending: true });
    if (error) throw error;
    proyectos = data || [];
  }

  const projectIds = proyectos.map((item) => item.id);
  let actividades = [];
  if (projectIds.length) {
    const { data, error } = await supabase
      .from("actividades")
      .select("id,proyecto_id,codigo,nombre,descripcion,responsable,fecha_inicio,fecha_fin,estado,orden")
      .in("proyecto_id", projectIds)
      .order("orden", { ascending: true })
      .order("nombre", { ascending: true });
    if (error) throw error;
    actividades = data || [];
  }

  const activitiesByProject = new Map();
  actividades.forEach((actividad) => {
    if (!activitiesByProject.has(actividad.proyecto_id)) activitiesByProject.set(actividad.proyecto_id, []);
    activitiesByProject.get(actividad.proyecto_id).push(actividad);
  });

  const projectsByProgram = new Map();
  proyectos.forEach((proyecto) => {
    if (!projectsByProgram.has(proyecto.programa_id)) projectsByProgram.set(proyecto.programa_id, []);
    projectsByProgram.get(proyecto.programa_id).push({
      ...proyecto,
      actividades: activitiesByProject.get(proyecto.id) || []
    });
  });

  const programsByLine = new Map();
  programas.forEach((programa) => {
    if (!programsByLine.has(programa.linea_accion_id)) programsByLine.set(programa.linea_accion_id, []);
    programsByLine.get(programa.linea_accion_id).push({
      ...programa,
      unidades: projectsByProgram.get(programa.id) || []
    });
  });

  return {
    lineas: lineRows.map((linea) => ({
      ...linea,
      programas: programsByLine.get(linea.id) || []
    }))
  };
}

function structureTotals(structure) {
  const totals = {
    lineas: 0,
    programas: 0,
    proyectos: 0,
    actividadesGenerales: 0,
    actividades: 0,
    activas: 0,
    cerradas: 0
  };

  (structure?.lineas || []).forEach((linea) => {
    totals.lineas += 1;
    (linea.programas || []).forEach((programa) => {
      totals.programas += 1;
      (programa.unidades || []).forEach((unidad) => {
        if (unidad.tipo_unidad === "actividad_general") totals.actividadesGenerales += 1;
        else totals.proyectos += 1;
        if (["activo", "activa"].includes(unidad.estado)) totals.activas += 1;
        if (["cerrado", "inactivo", "inactiva", "cancelado"].includes(unidad.estado)) totals.cerradas += 1;
        if (unidad.tipo_unidad !== "actividad_general") {
          totals.actividades += (unidad.actividades || []).length;
        }
      });
    });
  });

  return totals;
}

/* ==========================================================
   WORKSPACE
   ========================================================== */

export async function renderConsejeriaWorkspace(
  container,
  {
    vigencia,
    record,
    onBack,
    onChanged,
    initialTab = "resumen",
    progressMetric = null
  }
) {
  let currentRecord = { ...record };
  let activeTab = initialTab || "perfil";

  let allMandates = [];
  let assignedMandateIds = [];
  let documents = [];
  let planningStructure = { lineas: [] };

  let mandateSearch = "";
  let mandateFilter = "todos";
  let documentSearch = "";
  let documentTypeFilter = "todos";
  let documentStateFilter = "activos";

  async function loadWorkspaceData() {
    [
      allMandates,
      assignedMandateIds,
      documents,
      planningStructure
    ] = await Promise.all([
      getMandatosVigencia(vigencia.id),
      getAssignedMandateIds(currentRecord.id),
      getDocuments(currentRecord.id),
      getPlanningStructure(currentRecord.id)
    ]);
  }

  function showToast(text) {
    const toast =
      container.querySelector("#consejeriaWorkspaceToast");

    if (!toast) return;

    toast.textContent = text;
    toast.classList.remove("hidden");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(
      () => toast.classList.add("hidden"),
      3200
    );
  }

  function headerHTML() {
    const c = currentRecord.consejerias || {};
    const fallback =
      initials(currentRecord.responsable || c.nombre_corto);

    const metric =
      progressMetric || {
        progress: 0,
        coverage: 0,
        active:
          currentRecord.estado ===
          "activa"
      };

    const progressState =
      getConsejeriaProgressState(
        metric
      );

    const hasMeasurement =
      metric.active !== false &&
      Number(
        metric.coverage || 0
      ) > 0;

    return `
      <div class="consejeria-workspace-title">
        <div class="consejeria-workspace-person">
          <div class="consejero-photo-wrap large">
            ${photoHTML(
              currentRecord.foto_url,
              fallback,
              currentRecord.responsable || c.nombre_corto
            )}
          </div>

          <div>
            <div class="consejeria-workspace-breadcrumbs">
              <span>${escapeHTML(vigencia.nombre)}</span>
              <span>›</span>
              <span>Consejerías</span>
            </div>

            <p class="eyebrow">
              ${escapeHTML(c.nombre_corto || "Consejería")}
            </p>

            <h2>
              ${escapeHTML(c.nombre_largo || "")}
            </h2>

            <p class="muted">
              ${escapeHTML(
                currentRecord.responsable
                  ? `Responsable: ${currentRecord.responsable}`
                  : "Responsable sin registrar"
              )}
            </p>
          </div>
        </div>

        <div class="consejeria-workspace-header-actions">
          <button
            id="consejeriaDocumentReportButton"
            class="btn btn-secondary document-report-button"
            type="button"
          >
            ${documentReportIcon()}
            Generar documento
          </button>

          ${statusChip(currentRecord.estado)}
        </div>
      </div>

      <div class="consejeria-workspace-metrics">
        <div
          class="consejeria-progress-metric ${escapeHTML(progressState.key)}"
          style="--vc-progress-color: ${escapeHTML(progressState.color)}"
        >
          <span>Avance del Plan</span>

          <strong>
            ${
              hasMeasurement
                ? formatConsejeriaProgress(
                    metric.progress
                  )
                : "—"
            }
          </strong>

          <small>
            ${escapeHTML(progressState.label)}
          </small>
        </div>

        <div class="consejeria-coverage-metric">
          <span>Cobertura de medición</span>

          <strong>
            ${
              metric.active === false
                ? "—"
                : formatConsejeriaProgress(
                    metric.coverage
                  )
            }
          </strong>

          <div
            class="consejeria-coverage-bar"
            aria-hidden="true"
          >
            <i
              style="width: ${
                metric.active === false
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        100,
                        Number(
                          metric.coverage ||
                          0
                        )
                      )
                    )
              }%"
            ></i>
          </div>
        </div>

        <div>
          <span>Mandatos asignados</span>
          <strong>${assignedMandateIds.length}</strong>
        </div>

        <div>
          <span>Biblioteca</span>
          <strong>
            ${documents.filter((item) => item.estado === "activo").length}
          </strong>
        </div>

        <div>
          <span>Pueblo</span>
          <strong>
            ${escapeHTML(currentRecord.pueblo || "Sin registrar")}
          </strong>
        </div>
      </div>
    `;
  }

  function tabsHTML() {
    const totals = structureTotals(planningStructure);
    return `
      <nav class="consejeria-workspace-tabs">
        <button type="button" data-consejeria-tab="resumen" class="${activeTab === "resumen" ? "active" : ""}">
          Resumen
        </button>
        <button type="button" data-consejeria-tab="estructura" class="${activeTab === "estructura" ? "active" : ""}">
          Estructura
          <span>${totals.lineas}</span>
        </button>
        <button type="button" data-consejeria-tab="perfil" class="${activeTab === "perfil" ? "active" : ""}">
          Perfil de vigencia
        </button>
        <button type="button" data-consejeria-tab="mandatos" class="${activeTab === "mandatos" ? "active" : ""}">
          Mandatos
          <span>${assignedMandateIds.length}</span>
        </button>
        <button type="button" data-consejeria-tab="biblioteca" class="${activeTab === "biblioteca" ? "active" : ""}">
          Biblioteca
          <span>${documents.filter((item) => item.estado === "activo").length}</span>
        </button>
      </nav>
    `;
  }

  function renderShell() {
    container.innerHTML = `
      <section class="consejeria-workspace">
        <button
          id="backToConsejerias"
          class="workspace-back-button"
          type="button"
        >
          ${arrowIcon()}
          Volver a Consejerías
        </button>

        <header class="consejeria-workspace-header">
          ${headerHTML()}
        </header>

        ${tabsHTML()}

        <div id="consejeriaWorkspaceBody"></div>
      </section>

      <div
        id="consejeriaWorkspaceToast"
        class="app-toast hidden"
        role="status"
      ></div>
    `;

    container
      .querySelector("#backToConsejerias")
      .addEventListener("click", async () => {
        if (typeof onChanged === "function") {
          await onChanged();
        }

        await onBack();
      });

    container
      .querySelector(
        "#consejeriaDocumentReportButton"
      )
      ?.addEventListener(
        "click",
        () => {
          const c =
            currentRecord.consejerias || {};

          openDocumentReportDialog({
            scope: "consejeria",
            vigenciaId: vigencia.id,
            context: {
              consejeriaRef:
                currentRecord.id,
              consejeriaName:
                c.nombre_corto ||
                c.nombre_largo
            }
          });
        }
      );

    container
      .querySelectorAll("[data-consejeria-tab]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          activeTab = button.dataset.consejeriaTab;
          renderCurrentTab();
        });
      });

    renderCurrentTab();
  }

  function renderSummary() {
    const body = container.querySelector("#consejeriaWorkspaceBody");
    const totals = structureTotals(planningStructure);
    const lineCards = (planningStructure.lineas || []).map((linea) => {
      const programs = linea.programas || [];
      const units = programs.flatMap((programa) => programa.unidades || []);
      const projects = units.filter((unit) => unit.tipo_unidad !== "actividad_general").length;
      const generalActivities = units.filter((unit) => unit.tipo_unidad === "actividad_general").length;
      const activities = units.reduce(
        (sum, unit) => sum + (unit.tipo_unidad === "actividad_general" ? 0 : (unit.actividades || []).length),
        0
      );
      return `
        <article class="consejeria-line-summary-card">
          <div class="consejeria-line-summary-head">
            <div>
              <p class="eyebrow">${escapeHTML(linea.nombre_corto || "Línea de acción")}</p>
              <h4>${escapeHTML(linea.nombre)}</h4>
            </div>
            ${planningStatusChip(linea.estado)}
          </div>
          <div class="consejeria-line-summary-metrics">
            <span><strong>${programs.length}</strong> Programas</span>
            <span><strong>${projects}</strong> Proyectos</span>
            <span><strong>${generalActivities + activities}</strong> Actividades</span>
          </div>
        </article>
      `;
    }).join("");

    body.innerHTML = `
      <section class="workspace-section consejeria-summary-section">
        <div class="workspace-section-heading">
          <div>
            <p class="eyebrow">Resumen de gestión</p>
            <h3>Estructura de planeación de la Consejería</h3>
          </div>
          <button id="openConsejeriaStructure" class="btn btn-secondary" type="button">Ver estructura completa</button>
        </div>

        <div class="tracking-summary-grid consejeria-structure-summary-grid">
          <article class="tracking-summary-card primary"><span>Líneas de acción</span><strong>${totals.lineas}</strong><small>Estructura estratégica</small></article>
          <article class="tracking-summary-card"><span>Programas</span><strong>${totals.programas}</strong><small>Programas vinculados</small></article>
          <article class="tracking-summary-card"><span>Proyectos</span><strong>${totals.proyectos}</strong><small>Unidades tipo proyecto</small></article>
          <article class="tracking-summary-card"><span>Actividades</span><strong>${totals.actividadesGenerales + totals.actividades}</strong><small>${totals.actividadesGenerales} generales · ${totals.actividades} internas</small></article>
        </div>
      </section>

      <section class="workspace-section">
        <div class="workspace-section-heading">
          <div>
            <p class="eyebrow">Lectura rápida</p>
            <h3>Líneas de acción</h3>
          </div>
          <p class="muted">Una vista resumida de cómo se distribuyen programas, proyectos y actividades.</p>
        </div>
        ${lineCards ? `<div class="consejeria-line-summary-grid">${lineCards}</div>` : `
          <div class="empty-state workspace-empty">
            <strong>Esta Consejería todavía no tiene estructura de planeación.</strong>
            <p>Las Líneas, Programas y Proyectos aparecerán aquí automáticamente cuando sean registrados.</p>
          </div>
        `}
      </section>
    `;

    body.querySelector("#openConsejeriaStructure")?.addEventListener("click", () => {
      activeTab = "estructura";
      renderCurrentTab();
    });
  }

  function renderStructure() {
    const body = container.querySelector("#consejeriaWorkspaceBody");
    const lines = planningStructure.lineas || [];

    if (!lines.length) {
      body.innerHTML = `
        <section class="workspace-section">
          <div class="empty-state workspace-empty">
            <strong>No hay Líneas de Acción registradas para esta Consejería.</strong>
            <p>La estructura se construye desde los módulos de Líneas, Programas y Proyectos / Actividades.</p>
          </div>
        </section>
      `;
      return;
    }

    body.innerHTML = `
      <section class="workspace-section workspace-section-flush consejeria-structure-section">
        <div class="workspace-section-heading consejeria-structure-heading">
          <div>
            <p class="eyebrow">Estructura completa</p>
            <h3>Líneas → Programas → Proyectos / Actividades</h3>
          </div>
          <p class="muted">Despliega cada nivel y abre el registro original cuando necesites trabajar sobre él.</p>
        </div>

        <div class="consejeria-structure-tree">
          ${lines.map((linea, lineIndex) => `
            <details class="structure-line" ${lineIndex === 0 ? "open" : ""}>
              <summary>
                <div class="structure-node-main">
                  <span class="structure-level-label">Línea</span>
                  <div>
                    <strong>${escapeHTML(linea.nombre)}</strong>
                    <small>${escapeHTML(linea.nombre_corto || "")}</small>
                  </div>
                </div>
                <div class="structure-node-meta">
                  <span>${(linea.programas || []).length} programa${(linea.programas || []).length === 1 ? "" : "s"}</span>
                  ${planningStatusChip(linea.estado)}
                  <button class="btn btn-secondary btn-sm structure-open-line" type="button" data-linea-id="${linea.id}" title="Abrir Línea de Acción">Abrir</button>
                </div>
              </summary>
              <div class="structure-children">
                ${(linea.programas || []).length ? (linea.programas || []).map((programa) => {
                  const units = programa.unidades || [];
                  return `
                    <details class="structure-program">
                      <summary>
                        <div class="structure-node-main">
                          <span class="structure-level-label">Programa</span>
                          <div>
                            <strong>${escapeHTML(programa.nombre)}</strong>
                            <small>${escapeHTML(programa.nombre_corto || "")}</small>
                          </div>
                        </div>
                        <div class="structure-node-meta">
                          <span>${units.length} unidad${units.length === 1 ? "" : "es"}</span>
                          ${planningStatusChip(programa.estado)}
                          <button class="btn btn-secondary btn-sm structure-open-program" type="button" data-linea-id="${linea.id}" data-programa-id="${programa.id}" title="Abrir Programa">Abrir</button>
                        </div>
                      </summary>
                      <div class="structure-children structure-units">
                        ${units.length ? units.map((unidad) => {
                          const isGeneral = unidad.tipo_unidad === "actividad_general";
                          const activities = unidad.actividades || [];
                          return `
                            <article class="structure-unit ${isGeneral ? "is-general-activity" : ""}">
                              <div class="structure-unit-head">
                                <div class="structure-node-main">
                                  <span class="structure-level-label">${isGeneral ? "Actividad general" : "Proyecto"}</span>
                                  <div>
                                    <strong>${escapeHTML(unidad.nombre)}</strong>
                                    <small>${escapeHTML(unidad.codigo || unidad.nombre_corto || "")}</small>
                                  </div>
                                </div>
                                <div class="structure-node-meta">
                                  ${!isGeneral ? `<span>${activities.length} actividad${activities.length === 1 ? "" : "es"}</span>` : ""}
                                  ${planningStatusChip(unidad.estado)}
                                  <button class="btn btn-secondary btn-sm structure-open-unit" type="button" data-linea-id="${linea.id}" data-programa-id="${programa.id}" data-proyecto-id="${unidad.id}" data-actividad-id="${isGeneral ? escapeHTML(unidad.actividad_principal_id || "") : ""}">Abrir</button>
                                </div>
                              </div>
                              ${!isGeneral && activities.length ? `
                                <div class="structure-activity-list">
                                  ${activities.map((actividad) => `
                                    <div class="structure-activity-row">
                                      <div>
                                        <span class="structure-level-label">Actividad</span>
                                        <strong>${escapeHTML(actividad.nombre)}</strong>
                                        ${actividad.codigo ? `<small>${escapeHTML(actividad.codigo)}</small>` : ""}
                                      </div>
                                      <div class="structure-node-meta">
                                        ${planningStatusChip(actividad.estado)}
                                        <button class="btn btn-secondary btn-sm structure-open-activity" type="button" data-linea-id="${linea.id}" data-programa-id="${programa.id}" data-proyecto-id="${unidad.id}" data-actividad-id="${actividad.id}">Abrir</button>
                                      </div>
                                    </div>
                                  `).join("")}
                                </div>
                              ` : ""}
                            </article>
                          `;
                        }).join("") : `<div class="structure-empty">Sin proyectos o actividades registrados.</div>`}
                      </div>
                    </details>
                  `;
                }).join("") : `<div class="structure-empty">Esta Línea aún no tiene Programas.</div>`}
              </div>
            </details>
          `).join("")}
        </div>
      </section>
    `;

    body.querySelectorAll(".structure-open-line, .structure-open-program, .structure-open-unit, .structure-open-activity").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const target = {
          vigencia_id: vigencia.id,
          vigencia_consejeria_id: currentRecord.id
        };

        if (button.dataset.lineaId) target.linea_id = button.dataset.lineaId;
        if (button.dataset.programaId) target.programa_id = button.dataset.programaId;
        if (button.dataset.proyectoId) target.proyecto_id = button.dataset.proyectoId;
        if (button.dataset.actividadId) target.actividad_id = button.dataset.actividadId;

        const view = button.classList.contains("structure-open-line")
          ? "lineas"
          : button.classList.contains("structure-open-program")
            ? "programas"
            : "proyectos";

        window.dispatchEvent(new CustomEvent("app:navigate", { detail: { view, target } }));
      });
    });
  }

  function renderProfile() {
    const body =
      container.querySelector("#consejeriaWorkspaceBody");
    const c = currentRecord.consejerias || {};
    const fallback =
      initials(currentRecord.responsable || c.nombre_corto);

    body.innerHTML = `
      <form id="consejeriaProfileForm">
        <section class="workspace-section">
          <div class="workspace-section-heading">
            <div>
              <p class="eyebrow">Identidad institucional</p>
              <h3>${escapeHTML(c.nombre_corto || "Consejería")}</h3>
            </div>

            <p class="muted">
              Estos datos pertenecen al catálogo institucional y son
              comunes a todas las Vigencias.
            </p>
          </div>

          <div class="consejeria-institutional-summary">
            <div>
              <span>Nombre completo</span>
              <strong>${escapeHTML(c.nombre_largo || "—")}</strong>
            </div>

            <div>
              <span>Descripción</span>
              <p>${escapeHTML(c.descripcion || "Sin descripción institucional.")}</p>
            </div>

            <div>
              <span>Funciones</span>
              <p>${escapeHTML(c.funciones || "Sin funciones registradas.")}</p>
            </div>
          </div>
        </section>

        <section class="workspace-section">
          <div class="workspace-section-heading">
            <div>
              <p class="eyebrow">Vigencia</p>
              <h3>Información de la Consejería en ${escapeHTML(vigencia.nombre)}</h3>
            </div>
          </div>

          <div class="workspace-form-grid">
            <div class="form-field full">
              <label for="vcResponsible">
                Responsable en esta Vigencia
              </label>

              <input
                id="vcResponsible"
                name="responsable"
                value="${escapeHTML(currentRecord.responsable || "")}"
              >
            </div>

            <div class="form-field full">
              <label for="vcPhoto">
                Foto del consejero/a
              </label>

              <input
                id="vcPhoto"
                name="foto_url"
                type="url"
                value="${escapeHTML(currentRecord.foto_url || "")}"
                placeholder="https://... o enlace público de Google Drive"
              >
            </div>

            <div class="form-field full">
              <label>Vista previa</label>

              <div
                id="vcPhotoPreview"
                class="consejeria-workspace-photo-preview"
              >
                ${photoHTML(
                  currentRecord.foto_url,
                  fallback,
                  currentRecord.responsable || c.nombre_corto
                )}
              </div>
            </div>

            <div class="form-field">
              <label for="vcPueblo">Pueblo</label>

              <input
                id="vcPueblo"
                name="pueblo"
                value="${escapeHTML(currentRecord.pueblo || "")}"
              >
            </div>

            <div class="form-field">
              <label for="vcState">Estado</label>

              <select id="vcState" name="estado">
                ${option(
                  "activa",
                  "Activa",
                  currentRecord.estado === "activa"
                )}
                ${option(
                  "inactiva",
                  "Inactiva",
                  currentRecord.estado === "inactiva"
                )}
              </select>
            </div>

            <div class="form-field full">
              <label for="vcDetail">
                Detalle / contexto de la Vigencia
              </label>

              <textarea
                id="vcDetail"
                name="detalle"
                rows="7"
              >${escapeHTML(currentRecord.detalle || "")}</textarea>
            </div>
          </div>
        </section>

        <div class="workspace-form-footer">
          <p
            id="consejeriaProfileMessage"
            class="form-message"
          ></p>

          <button class="btn btn-primary" type="submit">
            Guardar perfil
          </button>
        </div>
      </form>
    `;

    const form =
      body.querySelector("#consejeriaProfileForm");

    const photoInput =
      body.querySelector("#vcPhoto");

    const photoPreview =
      body.querySelector("#vcPhotoPreview");

    const message =
      body.querySelector("#consejeriaProfileMessage");

    function updatePhotoPreview() {
      const responsible =
        body.querySelector("#vcResponsible").value;

      photoPreview.innerHTML = photoHTML(
        photoInput.value,
        initials(responsible || c.nombre_corto),
        responsible || c.nombre_corto
      );
    }

    photoInput.addEventListener(
      "input",
      updatePhotoPreview
    );

    body
      .querySelector("#vcResponsible")
      .addEventListener("input", updatePhotoPreview);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const data = new FormData(form);
      const submit =
        form.querySelector('button[type="submit"]');

      submit.disabled = true;
      submit.textContent = "Guardando…";

      try {
        const updated =
          await updateVigenciaConsejeria(
            currentRecord,
            {
              responsable:
                data.get("responsable")?.trim() || null,
              foto_url:
                data.get("foto_url")?.trim() || null,
              pueblo:
                data.get("pueblo")?.trim() || null,
              detalle:
                data.get("detalle")?.trim() || null,
              estado: data.get("estado") || currentRecord.estado
            }
          );

        currentRecord = {
          ...currentRecord,
          ...updated
        };

        renderShell();
        activeTab = "perfil";
        renderCurrentTab();

        showToast(
          "Perfil de la Consejería actualizado."
        );
      } catch (error) {
        console.error(error);

        message.textContent =
          friendlyErrorMessage(error, "No fue posible guardar el Perfil.");

        submit.disabled = false;
        submit.textContent = "Guardar perfil";
      }
    });
  }

  function filteredMandates() {
    const selected = new Set(assignedMandateIds);

    return allMandates.filter((mandato) => {
      const haystack = normalizeText(
        [
          mandato.codigo,
          mandato.titulo,
          mandato.texto,
          mandato.fuente_nombre
        ]
          .filter(Boolean)
          .join(" ")
      );

      if (
        mandateSearch &&
        !haystack.includes(normalizeText(mandateSearch))
      ) {
        return false;
      }

      if (
        mandateFilter === "asignados" &&
        !selected.has(mandato.id)
      ) {
        return false;
      }

      if (
        mandateFilter === "disponibles" &&
        selected.has(mandato.id)
      ) {
        return false;
      }

      if (
        mandateFilter === "activos" &&
        mandato.estado !== "activo"
      ) {
        return false;
      }

      return true;
    });
  }

  function renderMandates() {
    const body =
      container.querySelector("#consejeriaWorkspaceBody");

    const selected = new Set(assignedMandateIds);
    const visible = filteredMandates();

    body.innerHTML = `
      <section class="workspace-section workspace-section-flush">
        <div class="workspace-section-heading">
          <div>
            <p class="eyebrow">Articulación estratégica</p>
            <h3>Mandatos de la Consejería</h3>

            <p class="muted">
              Selecciona uno, varios o todos los Mandatos existentes
              de esta Vigencia. La asignación se guarda sobre la
              Consejería de esta Vigencia.
            </p>
          </div>

          <div class="mandate-assignment-total">
            <span>Asignados</span>
            <strong>${assignedMandateIds.length}</strong>
          </div>
        </div>

        <div class="consejeria-mandate-toolbar">
          <div class="form-field">
            <label for="consejeriaMandateSearch">
              Buscar Mandatos
            </label>

            <input
              id="consejeriaMandateSearch"
              value="${escapeHTML(mandateSearch)}"
              placeholder="Código, título, texto o fuente..."
            >
          </div>

          <div class="form-field">
            <label for="consejeriaMandateFilter">
              Mostrar
            </label>

            <select id="consejeriaMandateFilter">
              ${option(
                "todos",
                "Todos",
                mandateFilter === "todos"
              )}
              ${option(
                "activos",
                "Solo activos",
                mandateFilter === "activos"
              )}
              ${option(
                "asignados",
                "Asignados",
                mandateFilter === "asignados"
              )}
              ${option(
                "disponibles",
                "No asignados",
                mandateFilter === "disponibles"
              )}
            </select>
          </div>

          <div class="consejeria-mandate-selection-actions">
            <button
              id="selectVisibleMandates"
              class="btn btn-secondary"
              type="button"
              ${visible.length ? "" : "disabled"}
            >
              Seleccionar visibles
            </button>

            <button
              id="clearVisibleMandates"
              class="btn btn-secondary"
              type="button"
              ${visible.length ? "" : "disabled"}
            >
              Quitar visibles
            </button>
          </div>
        </div>

        <div
          id="consejeriaMandatesList"
          class="consejeria-mandates-list"
        >
          ${visible.length
            ? visible.map((mandato) => {
                const checked =
                  selected.has(mandato.id);

                const disabled =
                  mandato.estado === "archivado" &&
                  !checked;

                return `
                  <label class="consejeria-mandate-item ${checked ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}">
                    <input
                      type="checkbox"
                      class="mandate-assignment-checkbox"
                      value="${mandato.id}"
                      ${checked ? "checked" : ""}
                      ${disabled ? "disabled" : ""}
                    >

                    <span class="mandate-assignment-main">
                      <span class="mandate-assignment-heading">
                        <strong>
                          ${escapeHTML(
                            mandato.codigo ||
                            mandato.titulo ||
                            "Mandato"
                          )}
                        </strong>

                        ${mandateStatusChip(mandato.estado)}
                      </span>

                      ${mandato.titulo
                        ? `
                          <span class="mandate-assignment-title">
                            ${escapeHTML(mandato.titulo)}
                          </span>
                        `
                        : ""
                      }

                      <span class="mandate-assignment-text">
                        ${escapeHTML(mandato.texto)}
                      </span>

                      ${mandato.fuente_nombre
                        ? `
                          <small>
                            Fuente:
                            ${escapeHTML(mandato.fuente_nombre)}
                          </small>
                        `
                        : ""
                      }
                    </span>
                  </label>
                `;
              }).join("")
            : `
              <div class="empty-state workspace-empty">
                <strong>No se encontraron Mandatos.</strong>
                <p>
                  Ajusta la búsqueda o el filtro seleccionado.
                </p>
              </div>
            `
          }
        </div>

        <div class="workspace-form-footer mandate-save-footer">
          <p
            id="mandateAssignmentMessage"
            class="form-message"
          ></p>

          <span id="mandatePendingCount" class="muted">
            ${assignedMandateIds.length} seleccionados
          </span>

          <button
            id="saveMandateAssignments"
            class="btn btn-primary"
            type="button"
          >
            Guardar asignación
          </button>
        </div>
      </section>
    `;

    const search =
      body.querySelector("#consejeriaMandateSearch");

    const filter =
      body.querySelector("#consejeriaMandateFilter");

    const checkboxes = [
      ...body.querySelectorAll(
        ".mandate-assignment-checkbox"
      )
    ];

    const pendingCount =
      body.querySelector("#mandatePendingCount");

    function currentSelection() {
      const originalSelected =
        new Set(assignedMandateIds);

      // Los Mandatos no visibles deben conservar su selección.
      visible.forEach((mandato) => {
        originalSelected.delete(mandato.id);
      });

      checkboxes
        .filter((checkbox) => checkbox.checked)
        .forEach((checkbox) => {
          originalSelected.add(checkbox.value);
        });

      return [...originalSelected];
    }

    function updatePending() {
      const count = currentSelection().length;
      pendingCount.textContent =
        `${count} ${count === 1 ? "seleccionado" : "seleccionados"}`;

      checkboxes.forEach((checkbox) => {
        checkbox
          .closest(".consejeria-mandate-item")
          ?.classList.toggle(
            "is-selected",
            checkbox.checked
          );
      });
    }

    search.addEventListener("input", () => {
      mandateSearch = search.value;

      clearTimeout(renderMandates.searchTimer);

      renderMandates.searchTimer = setTimeout(
        renderMandates,
        160
      );
    });

    filter.addEventListener("change", () => {
      mandateFilter = filter.value;
      renderMandates();
    });

    checkboxes.forEach((checkbox) => {
      checkbox.addEventListener(
        "change",
        updatePending
      );
    });

    body
      .querySelector("#selectVisibleMandates")
      .addEventListener("click", () => {
        checkboxes.forEach((checkbox) => {
          if (!checkbox.disabled) {
            checkbox.checked = true;
          }
        });

        updatePending();
      });

    body
      .querySelector("#clearVisibleMandates")
      .addEventListener("click", () => {
        checkboxes.forEach((checkbox) => {
          checkbox.checked = false;
        });

        updatePending();
      });

    body
      .querySelector("#saveMandateAssignments")
      .addEventListener("click", async () => {
        const button =
          body.querySelector("#saveMandateAssignments");

        const message =
          body.querySelector("#mandateAssignmentMessage");

        const desiredIds = currentSelection();

        button.disabled = true;
        button.textContent = "Guardando…";
        message.textContent = "";

        try {
          const result =
            await saveMandateAssignments(
              currentRecord.id,
              desiredIds
            );

          assignedMandateIds =
            await getAssignedMandateIds(
              currentRecord.id
            );

          renderShell();
          activeTab = "mandatos";
          renderCurrentTab();

          showToast(
            `Asignación actualizada: ${result.added} agregados y ${result.removed} retirados.`
          );
        } catch (error) {
          console.error(error);

          if (error.protectedMandateIds?.length) {
            const protectedMandates =
              allMandates.filter((mandato) =>
                error.protectedMandateIds.includes(
                  mandato.id
                )
              );

            message.innerHTML = `
              No se puede retirar:
              <strong>
                ${protectedMandates
                  .map((item) =>
                    escapeHTML(
                      item.codigo ||
                      item.titulo ||
                      "Mandato"
                    )
                  )
                  .join(", ")}
              </strong>.
              Está vinculado a uno o más Proyectos de esta Consejería.
            `;
          } else {
            message.textContent =
              friendlyErrorMessage(error, "No fue posible actualizar los Mandatos.");
          }

          button.disabled = false;
          button.textContent =
            "Guardar asignación";
        }
      });

    updatePending();
  }

  function filteredDocuments() {
    return documents.filter((document) => {
      if (
        documentStateFilter === "activos" &&
        document.estado !== "activo"
      ) {
        return false;
      }

      if (
        documentStateFilter === "archivados" &&
        document.estado !== "archivado"
      ) {
        return false;
      }

      if (
        documentTypeFilter !== "todos" &&
        document.tipo_documento !== documentTypeFilter
      ) {
        return false;
      }

      if (documentSearch) {
        const haystack =
          normalizeText(
            [
              document.titulo,
              document.palabras_clave,
              document.descripcion,
              document.url
            ]
              .filter(Boolean)
              .join(" ")
          );

        if (
          !haystack.includes(
            normalizeText(documentSearch)
          )
        ) {
          return false;
        }
      }

      return true;
    });
  }

  function renderLibrary() {
    const body =
      container.querySelector("#consejeriaWorkspaceBody");

    const visibleDocuments =
      filteredDocuments();

    const activeCount =
      documents.filter(
        (document) => document.estado === "activo"
      ).length;

    body.innerHTML = `
      <section class="workspace-section workspace-section-flush">
        <div class="workspace-section-heading">
          <div>
            <p class="eyebrow">Centro documental</p>
            <h3>Biblioteca de la Consejería</h3>

            <p class="muted">
              Organiza enlaces a documentos, videos, presentaciones,
              PDF, Word, hojas de cálculo, imágenes, audios y otros
              recursos relevantes para esta Consejería.
            </p>
          </div>

          <button
            id="newConsejeriaDocument"
            class="btn btn-primary"
            type="button"
          >
            + Agregar documento
          </button>
        </div>

        <div class="consejeria-library-summary">
          <div>
            <span>Documentos activos</span>
            <strong>${activeCount}</strong>
          </div>

          <div>
            <span>Total histórico</span>
            <strong>${documents.length}</strong>
          </div>

          <div>
            <span>Tipos utilizados</span>
            <strong>
              ${
                new Set(
                  documents
                    .filter(
                      (document) =>
                        document.estado === "activo"
                    )
                    .map(
                      (document) =>
                        document.tipo_documento
                    )
                ).size
              }
            </strong>
          </div>
        </div>

        <div class="consejeria-library-toolbar">
          <div class="form-field">
            <label for="consejeriaDocumentSearch">
              Buscar
            </label>

            <input
              id="consejeriaDocumentSearch"
              value="${escapeHTML(documentSearch)}"
              placeholder="Título, palabra clave, tema..."
            >
          </div>

          <div class="form-field">
            <label for="consejeriaDocumentType">
              Tipo
            </label>

            <select id="consejeriaDocumentType">
              ${option(
                "todos",
                "Todos los tipos",
                documentTypeFilter === "todos"
              )}
              ${[
                "texto",
                "video",
                "pdf",
                "word",
                "presentacion",
                "hoja_calculo",
                "imagen",
                "audio",
                "enlace",
                "otro"
              ]
                .map((type) =>
                  option(
                    type,
                    documentTypeMeta(type).label,
                    documentTypeFilter === type
                  )
                )
                .join("")}
            </select>
          </div>

          <div class="form-field">
            <label for="consejeriaDocumentState">
              Estado
            </label>

            <select id="consejeriaDocumentState">
              ${option(
                "activos",
                "Activos",
                documentStateFilter === "activos"
              )}
              ${option(
                "todos",
                "Todos",
                documentStateFilter === "todos"
              )}
              ${option(
                "archivados",
                "Archivados",
                documentStateFilter === "archivados"
              )}
            </select>
          </div>
        </div>

        ${visibleDocuments.length
          ? `
            <div class="consejeria-document-list">
              ${visibleDocuments
                .map((document, index) => {
                  const meta =
                    documentTypeMeta(
                      document.tipo_documento
                    );

                  const tags =
                    keywords(
                      document.palabras_clave
                    );

                  return `
                    <article class="consejeria-document-card ${document.estado === "archivado" ? "is-archived" : ""}">
                      <div class="consejeria-document-heading">
                        <div class="consejeria-document-title">
                          ${documentIconHTML(
                            document.tipo_documento
                          )}

                          <div>
                            <p class="eyebrow">
                              ${index + 1}. ${escapeHTML(meta.label)}
                            </p>

                            <h4>
                              ${escapeHTML(document.titulo)}
                            </h4>
                          </div>
                        </div>

                        <a
                          href="${escapeHTML(document.url)}"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="document-external-link"
                          title="Abrir documento"
                          aria-label="Abrir ${escapeHTML(document.titulo)}"
                        >
                          ${externalIcon()}
                        </a>
                      </div>

                      ${tags.length
                        ? `
                          <div class="document-keyword-tags">
                            ${tags
                              .map(
                                (tag) =>
                                  `<span>${escapeHTML(tag)}</span>`
                              )
                              .join("")}
                          </div>
                        `
                        : ""
                      }

                      <p class="muted consejeria-document-description">
                        ${escapeHTML(
                          document.descripcion ||
                          "Sin descripción registrada."
                        )}
                      </p>

                      <div class="consejeria-document-url">
                        <span>Vínculo</span>
                        <a
                          href="${escapeHTML(document.url)}"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          ${escapeHTML(document.url)}
                        </a>
                      </div>

                      <div class="consejeria-document-footer">
                        <span class="document-type-pill">
                          ${documentIconHTML(
                            document.tipo_documento,
                            "small"
                          )}
                          ${escapeHTML(meta.label)}
                        </span>

                        <div class="entity-actions">
                          <button
                            class="btn btn-secondary edit-consejeria-document"
                            type="button"
                            data-id="${document.id}"
                          >
                            Editar
                          </button>

                          ${
                            document.estado === "activo"
                              ? `
                                <button
                                  class="btn btn-secondary archive-consejeria-document"
                                  type="button"
                                  data-id="${document.id}"
                                >
                                  Archivar
                                </button>
                              `
                              : `
                                <button
                                  class="btn btn-secondary restore-consejeria-document"
                                  type="button"
                                  data-id="${document.id}"
                                >
                                  Reactivar
                                </button>
                              `
                          }

                          <button
                            class="icon-btn danger delete-consejeria-document"
                            type="button"
                            data-id="${document.id}"
                            title="Eliminar definitivamente"
                            aria-label="Eliminar ${escapeHTML(document.titulo)}"
                          >
                            ${trashIcon()}
                          </button>
                        </div>
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>
          `
          : `
            <div class="empty-state workspace-empty">
              <strong>
                No hay documentos para mostrar.
              </strong>

              <p>
                Agrega el primer vínculo o modifica los filtros.
              </p>
            </div>
          `
        }
      </section>
    `;

    body
      .querySelector("#newConsejeriaDocument")
      .addEventListener("click", () => {
        openDocumentForm({
          vigenciaConsejeriaId:
            currentRecord.id,

          onSaved: async () => {
            documents =
              await getDocuments(
                currentRecord.id
              );

            renderShell();
            activeTab = "biblioteca";
            renderCurrentTab();

            showToast(
              "Documento agregado a la Biblioteca."
            );
          }
        });
      });

    const search =
      body.querySelector("#consejeriaDocumentSearch");

    search.addEventListener("input", () => {
      documentSearch = search.value;

      clearTimeout(renderLibrary.searchTimer);

      renderLibrary.searchTimer = setTimeout(
        renderLibrary,
        160
      );
    });

    body
      .querySelector("#consejeriaDocumentType")
      .addEventListener("change", (event) => {
        documentTypeFilter =
          event.target.value;
        renderLibrary();
      });

    body
      .querySelector("#consejeriaDocumentState")
      .addEventListener("change", (event) => {
        documentStateFilter =
          event.target.value;
        renderLibrary();
      });

    body
      .querySelectorAll(
        ".edit-consejeria-document"
      )
      .forEach((button) => {
        button.addEventListener("click", () => {
          const record =
            documents.find(
              (item) =>
                item.id === button.dataset.id
            );

          openDocumentForm({
            vigenciaConsejeriaId:
              currentRecord.id,
            record,

            onSaved: async () => {
              documents =
                await getDocuments(
                  currentRecord.id
                );

              renderShell();
              activeTab = "biblioteca";
              renderCurrentTab();

              showToast(
                "Documento actualizado."
              );
            }
          });
        });
      });

    body
      .querySelectorAll(
        ".archive-consejeria-document"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          async () => {
            const record = documents.find((item) => item.id === button.dataset.id);
            await updateDocument(
              record,
              { estado: "archivado" }
            );

            documents =
              await getDocuments(
                currentRecord.id
              );

            renderShell();
            activeTab = "biblioteca";
            renderCurrentTab();

            showToast(
              "Documento archivado."
            );
          }
        );
      });

    body
      .querySelectorAll(
        ".restore-consejeria-document"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          async () => {
            const record = documents.find((item) => item.id === button.dataset.id);
            await updateDocument(
              record,
              { estado: "activo" }
            );

            documents =
              await getDocuments(
                currentRecord.id
              );

            renderShell();
            activeTab = "biblioteca";
            renderCurrentTab();

            showToast(
              "Documento reactivado."
            );
          }
        );
      });

    body
      .querySelectorAll(
        ".delete-consejeria-document"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            const record =
              documents.find(
                (item) =>
                  item.id === button.dataset.id
              );

            if (!record) return;

            openDeleteDocumentDialog({
              record,

              onDeleted: async () => {
                documents =
                  await getDocuments(
                    currentRecord.id
                  );

                renderShell();
                activeTab = "biblioteca";
                renderCurrentTab();

                showToast(
                  "Documento eliminado de la Biblioteca."
                );
              }
            });
          }
        );
      });
  }

  function syncAuditContext() {
    const c = currentRecord.consejerias || {};
    const labels = {
      resumen: "Resumen",
      estructura: "Estructura",
      perfil: "Perfil de vigencia",
      mandatos: "Mandatos",
      biblioteca: "Biblioteca"
    };

    setAuditContext({
      vigenciaId: vigencia.id,
      vigenciaNombre: vigencia.nombre,
      entidadTipo: "consejeria",
      entidadId: currentRecord.id,
      entidadNombre: c.nombre_corto || c.nombre_largo || "Consejería",
      seccion: activeTab,
      ruta: `${vigencia.nombre} › ${c.nombre_corto || c.nombre_largo || "Consejería"} › ${labels[activeTab] || activeTab}`,
      navigation: {
        view: "consejerias",
        vigencia_id: vigencia.id,
        vigencia_nombre: vigencia.nombre,
        vigencia_consejeria_id: currentRecord.id,
        consejeria_nombre: c.nombre_corto || c.nombre_largo || "Consejería",
        consejeria_tab: activeTab
      },
      sectionOptions: [
        { value: "resumen", label: "Resumen", navigation: { consejeria_tab: "resumen" } },
        { value: "estructura", label: "Estructura", navigation: { consejeria_tab: "estructura" } },
        { value: "perfil", label: "Perfil de vigencia", navigation: { consejeria_tab: "perfil" } },
        { value: "mandatos", label: "Mandatos", navigation: { consejeria_tab: "mandatos" } },
        { value: "biblioteca", label: "Biblioteca", navigation: { consejeria_tab: "biblioteca" } }
      ]
    });
  }

  function renderCurrentTab() {
    syncAuditContext();

    container
      .querySelectorAll(
        "[data-consejeria-tab]"
      )
      .forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.consejeriaTab === activeTab
        );
      });

    if (activeTab === "resumen") {
      renderSummary();
    } else if (activeTab === "estructura") {
      renderStructure();
    } else if (activeTab === "mandatos") {
      renderMandates();
    } else if (activeTab === "biblioteca") {
      renderLibrary();
    } else {
      renderProfile();
    }
  }

  try {
    await loadWorkspaceData();
    renderShell();
  } catch (error) {
    console.error(error);

    container.innerHTML = `
      <section class="panel" style="margin-top:0">
        <p class="eyebrow">Consejería</p>
        <h2>No fue posible abrir la edición extendida</h2>

        <p class="muted">
          ${escapeHTML(
            friendlyErrorMessage(error, "No fue posible abrir la información de la Consejería. Intenta nuevamente o informa al administrador del Sistema.")
          )}
        </p>

        <div style="margin-top:16px">
          <button
            id="consejeriaWorkspaceErrorBack"
            class="btn btn-secondary"
            type="button"
          >
            Volver
          </button>
        </div>
      </section>
    `;

    container
      .querySelector(
        "#consejeriaWorkspaceErrorBack"
      )
      .addEventListener(
        "click",
        onBack
      );
  }
}
