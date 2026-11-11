import { requireSupabase } from "../supabaseClient.js?v=5.3.1";
import { openModal, closeModal } from "../components/modal.js?v=5.3.1";
import { uiIcon } from "../components/uiSystem.js?v=5.3.1";
import { openVigenciaImportDialog } from "./vigenciaImporter.js?v=5.3.1";
import { openForceDeleteVigenciaDialog } from "./vigenciaForceDelete.js?v=5.3.1";
import { openVigenciaBackupDialog } from "./vigenciaBackup.js?v=5.3.1";
import { openDocumentReportDialog, documentReportIcon } from "./documentReports.js?v=5.3.1";
import { updateWithVersion } from "../security.js?v=5.3.1";
import { friendlyErrorMessage } from "../userMessages.js?v=5.3.1";

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(dateString) {
  if (!dateString) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(`${dateString}T00:00:00`));
}

const STATUS_META = {
  borrador: {
    label: "Borrador",
    description: "En preparación. Todavía no se toma como la Vigencia actual del Sistema."
  },
  activa: {
    label: "Activa",
    description: "Periodo institucional vigente. El Sistema la reconoce como la Vigencia actual."
  },
  cerrada: {
    label: "Cerrada",
    description: "Periodo finalizado. Sus datos se conservan para consulta e histórico."
  }
};

function statusChip(estado) {
  const cls = estado === "activa" ? "active" : estado === "cerrada" ? "closed" : "";
  return `<span class="status-chip ${cls}">${STATUS_META[estado]?.label || escapeHTML(estado)}</span>`;
}

function stateAction(row) {
  if (row.estado === "borrador") {
    return `
      <button
        class="btn btn-secondary vigencia-state-action edit-vigencia-state"
        type="button"
        data-id="${row.id}"
        data-state="activa"
        title="Convertir esta Vigencia en la Vigencia actual"
      >
        ${uiIcon("check")}<span>Activar</span>
      </button>
    `;
  }

  if (row.estado === "activa") {
    return `
      <button
        class="btn btn-secondary vigencia-state-action edit-vigencia-state"
        type="button"
        data-id="${row.id}"
        data-state="cerrada"
        title="Cerrar esta Vigencia y conservarla como histórico"
      >
        ${uiIcon("archive")}<span>Cerrar</span>
      </button>
    `;
  }

  return `
    <button
      class="btn btn-secondary vigencia-state-action edit-vigencia-state"
      type="button"
      data-id="${row.id}"
      data-state="borrador"
      title="Reabrir esta Vigencia para volver a prepararla"
    >
      ${uiIcon("refresh")}<span>Reabrir</span>
    </button>
  `;
}

export async function getVigencias() {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("vigencias")
    .select("*")
    .order("fecha_inicio", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getVigenciaMetrics() {
  const rows = await getVigencias();
  const activa = rows.find((item) => item.estado === "activa");

  return {
    total: rows.length,
    activas: rows.filter((item) => item.estado === "activa").length,
    cerradas: rows.filter((item) => item.estado === "cerrada").length,
    actual: activa ? `${activa.nombre}` : "Sin definir"
  };
}

async function createVigencia(payload) {
  const supabase = requireSupabase();

  if (payload.estado === "activa") {
    const rows = await getVigencias();
    const currentActive = rows.find((item) => item.estado === "activa");
    if (currentActive) {
      throw new Error(`Ya existe una Vigencia activa: ${currentActive.nombre}. Primero ciérrala antes de activar otra.`);
    }
  }

  const { data, error } = await supabase
    .from("vigencias")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateVigencia(record, payload) {
  if (payload.estado === "activa" && record.estado !== "activa") {
    const rows = await getVigencias();
    const currentActive = rows.find((item) => item.estado === "activa" && item.id !== record.id);
    if (currentActive) {
      throw new Error(`Ya existe una Vigencia activa: ${currentActive.nombre}. Primero ciérrala antes de activar otra.`);
    }
  }

  return updateWithVersion({
    table: "vigencias",
    record,
    payload,
    entityType: "vigencia",
    entityName: record.nombre,
    vigenciaId: record.id
  });
}

function stateConflictMessage(error, fallback) {
  const text = String(error?.message || "");
  if (text.startsWith("Ya existe una Vigencia activa:")) return text;
  return friendlyErrorMessage(error, fallback);
}

function vigenciaFormContent({ vigencia = null } = {}) {
  const editing = Boolean(vigencia);
  const estado = vigencia?.estado || "borrador";

  return `
    <p class="notice">
      ${editing
        ? "Actualiza los datos generales de la Vigencia. El cambio de estado determina si el periodo está en preparación, vigente o cerrado."
        : "La Vigencia define el periodo político y temporal del Plan Estratégico. Los mandatos de cada periodo quedarán vinculados a ella."}
    </p>

    <form id="vigenciaForm">
      <div class="form-grid">
        <div class="form-field full">
          <label for="vigenciaNombre">Nombre</label>
          <input
            id="vigenciaNombre"
            name="nombre"
            required
            value="${escapeHTML(vigencia?.nombre || "")}"
            placeholder="Ej. XI Congreso Nacional de Pueblos Indígenas"
          >
        </div>

        <div class="form-field">
          <label for="fechaInicio">Fecha de inicio</label>
          <input id="fechaInicio" name="fecha_inicio" type="date" required value="${escapeHTML(vigencia?.fecha_inicio || "")}">
        </div>

        <div class="form-field">
          <label for="fechaFin">Fecha de finalización</label>
          <input id="fechaFin" name="fecha_fin" type="date" required value="${escapeHTML(vigencia?.fecha_fin || "")}">
        </div>

        <div class="form-field full">
          <label for="vigenciaLema">Lema / denominación</label>
          <input id="vigenciaLema" name="lema" value="${escapeHTML(vigencia?.lema || "")}" placeholder="Opcional">
        </div>

        <div class="form-field full">
          <label for="vigenciaDescripcion">Descripción</label>
          <textarea id="vigenciaDescripcion" name="descripcion">${escapeHTML(vigencia?.descripcion || "")}</textarea>
        </div>

        <div class="form-field full">
          <label for="vigenciaEstado">Estado de la Vigencia</label>
          <select id="vigenciaEstado" name="estado">
            <option value="borrador" ${estado === "borrador" ? "selected" : ""}>Borrador · En preparación</option>
            <option value="activa" ${estado === "activa" ? "selected" : ""}>Activa · Vigencia actual</option>
            <option value="cerrada" ${estado === "cerrada" ? "selected" : ""}>Cerrada · Histórico</option>
          </select>
          <small id="vigenciaEstadoHelp" class="field-help">${escapeHTML(STATUS_META[estado]?.description || "")}</small>
        </div>
      </div>

      <p id="vigenciaMessage" class="form-message" role="status"></p>

      <div class="form-actions">
        <button id="cancelVigencia" class="btn btn-secondary" type="button">Cancelar</button>
        <button class="btn btn-primary" type="submit">${editing ? "Guardar cambios" : "Guardar Vigencia"}</button>
      </div>
    </form>
  `;
}

function wireVigenciaForm({ vigencia = null, onSaved }) {
  const form = document.querySelector("#vigenciaForm");
  const cancel = document.querySelector("#cancelVigencia");
  const message = document.querySelector("#vigenciaMessage");
  const statusSelect = document.querySelector("#vigenciaEstado");
  const statusHelp = document.querySelector("#vigenciaEstadoHelp");
  const editing = Boolean(vigencia);

  cancel.addEventListener("click", closeModal);

  statusSelect.addEventListener("change", () => {
    statusHelp.textContent = STATUS_META[statusSelect.value]?.description || "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const data = new FormData(form);
    const payload = {
      nombre: data.get("nombre").trim(),
      fecha_inicio: data.get("fecha_inicio"),
      fecha_fin: data.get("fecha_fin"),
      lema: data.get("lema")?.trim() || null,
      descripcion: data.get("descripcion")?.trim() || null,
      estado: data.get("estado")
    };

    if (payload.fecha_fin < payload.fecha_inicio) {
      message.textContent = "La fecha de finalización no puede ser anterior a la fecha de inicio.";
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    const originalLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      if (editing) await updateVigencia(vigencia, payload);
      else await createVigencia(payload);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = stateConflictMessage(
        error,
        editing ? "No fue posible guardar los cambios de la Vigencia." : "No fue posible guardar la Vigencia."
      );
    } finally {
      submit.disabled = false;
      submit.textContent = originalLabel;
    }
  });
}

function openCreateForm(onCreated) {
  openModal({
    title: "Nueva Vigencia",
    content: vigenciaFormContent()
  });
  wireVigenciaForm({ onSaved: onCreated });
}

function openEditForm(vigencia, onSaved) {
  openModal({
    title: "Editar Vigencia",
    content: vigenciaFormContent({ vigencia })
  });
  wireVigenciaForm({ vigencia, onSaved });
}

function stateChangeCopy(vigencia, targetState) {
  if (targetState === "activa") {
    return {
      title: "Activar Vigencia",
      action: "Activar Vigencia",
      icon: "check",
      text: `La Vigencia “${vigencia.nombre}” pasará a ser el periodo institucional actual del Sistema.`,
      note: "Solo puede existir una Vigencia activa al mismo tiempo."
    };
  }

  if (targetState === "cerrada") {
    return {
      title: "Cerrar Vigencia",
      action: "Cerrar Vigencia",
      icon: "archive",
      text: `La Vigencia “${vigencia.nombre}” quedará como periodo finalizado y se conservará para consulta histórica.`,
      note: "Cerrar una Vigencia no elimina ninguno de sus datos."
    };
  }

  return {
    title: "Reabrir Vigencia",
    action: "Reabrir como borrador",
    icon: "refresh",
    text: `La Vigencia “${vigencia.nombre}” volverá a estado Borrador para poder prepararla nuevamente.`,
    note: "Reabrir no la convierte automáticamente en la Vigencia actual."
  };
}

function openStateChangeDialog({ vigencia, targetState, onUpdated }) {
  const copy = stateChangeCopy(vigencia, targetState);

  openModal({
    title: copy.title,
    content: `
      <div class="vigencia-state-confirmation">
        <div class="vigencia-state-confirmation-icon">${uiIcon(copy.icon)}</div>
        <div>
          <p>${escapeHTML(copy.text)}</p>
          <p class="muted">${escapeHTML(copy.note)}</p>
        </div>
      </div>
      <p id="vigenciaStateMessage" class="form-message" role="status"></p>
      <div class="form-actions">
        <button id="cancelVigenciaState" class="btn btn-secondary" type="button">Cancelar</button>
        <button id="confirmVigenciaState" class="btn btn-primary edit-vigencia-state" type="button">
          ${uiIcon(copy.icon)}<span>${escapeHTML(copy.action)}</span>
        </button>
      </div>
    `
  });

  const cancel = document.querySelector("#cancelVigenciaState");
  const confirm = document.querySelector("#confirmVigenciaState");
  const message = document.querySelector("#vigenciaStateMessage");

  cancel.addEventListener("click", closeModal);
  confirm.addEventListener("click", async () => {
    message.textContent = "";
    confirm.disabled = true;

    try {
      await updateVigencia(vigencia, { estado: targetState });
      closeModal();
      await onUpdated();
    } catch (error) {
      console.error(error);
      message.textContent = stateConflictMessage(error, "No fue posible cambiar el estado de la Vigencia.");
    } finally {
      confirm.disabled = false;
    }
  });
}

function renderStateGuide() {
  return `
    <div class="vigencia-state-guide" aria-label="Estados de una Vigencia">
      <div>${statusChip("borrador")}<span>En preparación</span></div>
      <div>${statusChip("activa")}<span>Periodo actual</span></div>
      <div>${statusChip("cerrada")}<span>Consulta histórica</span></div>
    </div>
  `;
}

export async function renderVigencias(container) {
  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Plan Estratégico</p>
        <h2>Vigencias</h2>
        <p class="page-intro">Administra los periodos institucionales y define cuál es la Vigencia actual del Sistema.</p>
      </div>
      <div class="row-actions">
        <button id="importVigenciaJsonButton" class="btn btn-secondary" type="button">Importar Vigencia</button>
        <button id="newVigenciaButton" class="btn btn-primary" type="button">+ Nueva Vigencia</button>
      </div>
    </div>

    ${renderStateGuide()}

    <section class="panel vigencias-panel" style="margin-top: 12px">
      <div id="vigenciasContent">
        <div class="empty-state">Cargando Vigencias…</div>
      </div>
    </section>
  `;

  const content = container.querySelector("#vigenciasContent");
  const newButton = container.querySelector("#newVigenciaButton");
  const importButton = container.querySelector("#importVigenciaJsonButton");

  async function refresh() {
    try {
      const rows = await getVigencias();

      if (!rows.length) {
        content.innerHTML = `
          <div class="empty-state">
            <strong>No hay Vigencias registradas.</strong>
            <p>Empieza creando la primera Vigencia del Plan Estratégico.</p>
            <button class="btn btn-primary empty-new-vigencia edit-vigencia" type="button">+ Nueva Vigencia</button>
          </div>
        `;
        content.querySelector(".empty-new-vigencia")?.addEventListener("click", () => openCreateForm(refresh));
        return;
      }

      content.innerHTML = `
        <div class="table-wrap">
          <table class="data-table vigencias-table">
            <thead>
              <tr>
                <th>Vigencia</th>
                <th>Periodo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td>
                    <strong>${escapeHTML(row.nombre)}</strong>
                    ${row.lema ? `<div class="vigencia-subtitle">${escapeHTML(row.lema)}</div>` : ""}
                  </td>
                  <td class="vigencia-period">${formatDate(row.fecha_inicio)} — ${formatDate(row.fecha_fin)}</td>
                  <td>
                    <div class="vigencia-state-cell">
                      ${statusChip(row.estado)}
                      ${stateAction(row)}
                    </div>
                  </td>
                  <td>
                    <div class="row-actions compact-actions vigencia-row-actions">
                      <button
                        class="btn btn-secondary edit-vigencia"
                        type="button"
                        data-id="${row.id}"
                        title="Editar datos y estado de la Vigencia"
                      >
                        ${uiIcon("edit")}<span>Editar</span>
                      </button>

                      <button
                        class="icon-btn document-vigencia-report"
                        type="button"
                        data-id="${row.id}"
                        title="Generar documento"
                        aria-label="Generar documento: ${escapeHTML(row.nombre)}"
                      >
                        ${documentReportIcon()}
                      </button>

                      <button
                        class="icon-btn backup-vigencia"
                        type="button"
                        data-id="${row.id}"
                        title="Generar copia de seguridad"
                        aria-label="Generar copia de seguridad: ${escapeHTML(row.nombre)}"
                      >
                        ${uiIcon("download")}
                      </button>

                      <button
                        class="icon-btn danger force-delete-vigencia"
                        type="button"
                        data-id="${row.id}"
                        title="Eliminar Vigencia completa"
                        aria-label="Eliminar Vigencia completa: ${escapeHTML(row.nombre)}"
                      >
                        ${uiIcon("trash")}
                      </button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;

      content.querySelectorAll(".edit-vigencia").forEach((button) => {
        button.addEventListener("click", () => {
          const vigencia = rows.find((item) => item.id === button.dataset.id);
          if (vigencia) openEditForm(vigencia, refresh);
        });
      });

      content.querySelectorAll(".edit-vigencia-state").forEach((button) => {
        if (!button.dataset.id || !button.dataset.state) return;
        button.addEventListener("click", () => {
          const vigencia = rows.find((item) => item.id === button.dataset.id);
          if (!vigencia) return;
          openStateChangeDialog({ vigencia, targetState: button.dataset.state, onUpdated: refresh });
        });
      });

      content.querySelectorAll(".document-vigencia-report").forEach((button) => {
        button.addEventListener("click", () => {
          const vigencia = rows.find((item) => item.id === button.dataset.id);
          if (!vigencia) return;
          openDocumentReportDialog({ scope: "vigencia", vigenciaId: vigencia.id });
        });
      });

      content.querySelectorAll(".backup-vigencia").forEach((button) => {
        button.addEventListener("click", () => {
          const vigencia = rows.find((item) => item.id === button.dataset.id);
          if (vigencia) openVigenciaBackupDialog({ vigencia });
        });
      });

      content.querySelectorAll(".force-delete-vigencia").forEach((button) => {
        button.addEventListener("click", () => {
          const vigencia = rows.find((item) => item.id === button.dataset.id);
          if (!vigencia) return;
          openForceDeleteVigenciaDialog({ vigencia, onDeleted: refresh });
        });
      });
    } catch (error) {
      console.error(error);
      content.innerHTML = `
        <div class="empty-state">
          <strong>No fue posible cargar las Vigencias.</strong>
          <p>Intenta nuevamente o informa al Administrador del Sistema.</p>
          <button id="retryVigencias" class="btn btn-secondary" type="button">Intentar nuevamente</button>
        </div>
      `;
      content.querySelector("#retryVigencias")?.addEventListener("click", refresh);
    }
  }

  importButton.addEventListener("click", () => openVigenciaImportDialog({ onImported: refresh }));
  newButton.addEventListener("click", () => openCreateForm(refresh));

  await refresh();
}
