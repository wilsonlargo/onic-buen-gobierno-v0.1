import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";
import { openVigenciaImportDialog } from "./vigenciaImporter.js";
import { openForceDeleteVigenciaDialog } from "./vigenciaForceDelete.js";
import { openVigenciaBackupDialog } from "./vigenciaBackup.js";
import { openDocumentReportDialog, documentReportIcon } from "./documentReports.js";

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



function backupIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12"></path>
      <path d="M7 10l5 5 5-5"></path>
      <path d="M5 19h14"></path>
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

function statusChip(estado) {
  const labels = {
    borrador: "Borrador",
    activa: "Activa",
    cerrada: "Cerrada"
  };

  const cls = estado === "activa" ? "active" : estado === "cerrada" ? "closed" : "";
  return `<span class="status-chip ${cls}">${labels[estado] || escapeHTML(estado)}</span>`;
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

  const { data, error } = await supabase
    .from("vigencias")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

function openCreateForm(onCreated) {
  openModal({
    title: "Nueva vigencia",
    content: `
      <p class="notice">
        La vigencia define el periodo político y temporal del Plan Estratégico.
        Los mandatos de cada periodo quedarán vinculados a esta vigencia.
      </p>

      <form id="vigenciaForm">
        <div class="form-grid">
          <div class="form-field full">
            <label for="vigenciaNombre">Nombre</label>
            <input
              id="vigenciaNombre"
              name="nombre"
              required
              placeholder="Ej. XI Congreso Nacional de Pueblos Indígenas"
            >
          </div>

          <div class="form-field">
            <label for="fechaInicio">Fecha de inicio</label>
            <input id="fechaInicio" name="fecha_inicio" type="date" required>
          </div>

          <div class="form-field">
            <label for="fechaFin">Fecha de finalización</label>
            <input id="fechaFin" name="fecha_fin" type="date" required>
          </div>

          <div class="form-field full">
            <label for="vigenciaLema">Lema / denominación</label>
            <input id="vigenciaLema" name="lema" placeholder="Opcional">
          </div>

          <div class="form-field full">
            <label for="vigenciaDescripcion">Descripción</label>
            <textarea id="vigenciaDescripcion" name="descripcion"></textarea>
          </div>

          <div class="form-field">
            <label for="vigenciaEstado">Estado</label>
            <select id="vigenciaEstado" name="estado">
              <option value="borrador">Borrador</option>
              <option value="activa">Activa</option>
              <option value="cerrada">Cerrada</option>
            </select>
          </div>
        </div>

        <p id="vigenciaMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelVigencia" class="btn btn-secondary" type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">Guardar vigencia</button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#vigenciaForm");
  const cancel = document.querySelector("#cancelVigencia");
  const message = document.querySelector("#vigenciaMessage");

  cancel.addEventListener("click", closeModal);

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
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      await createVigencia(payload);
      closeModal();
      await onCreated();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible guardar la vigencia.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Guardar vigencia";
    }
  });
}

export async function renderVigencias(container) {
  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Plan Estratégico</p>
        <h2>Vigencias</h2>
      </div>
      <div class="row-actions">
        <button
          id="importVigenciaJsonButton"
          class="btn btn-secondary"
          type="button"
        >
          Importar vigencia
        </button>

        <button
          id="newVigenciaButton"
          class="btn btn-primary"
          type="button"
        >
          + Nueva vigencia
        </button>
      </div>
    </div>

    <section class="panel" style="margin-top: 0">
      <div id="vigenciasContent">
        <div class="empty-state">Cargando vigencias…</div>
      </div>
    </section>
  `;

  const content = document.querySelector("#vigenciasContent");
  const newButton = document.querySelector("#newVigenciaButton");
  const importButton = document.querySelector("#importVigenciaJsonButton");

  async function refresh() {
    try {
      const rows = await getVigencias();

      if (!rows.length) {
        content.innerHTML = `
          <div class="empty-state">
            <strong>No hay vigencias registradas.</strong>
            <p>Empieza creando la primera vigencia del Plan Estratégico.</p>
          </div>
        `;
        return;
      }

      content.innerHTML = `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Periodo</th>
                <th>Lema</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td><strong>${escapeHTML(row.nombre)}</strong></td>
                  <td>${formatDate(row.fecha_inicio)} — ${formatDate(row.fecha_fin)}</td>
                  <td>${escapeHTML(row.lema || "—")}</td>
                  <td>${statusChip(row.estado)}</td>
                  <td>
                    <div class="row-actions compact-actions">
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
                        ${backupIcon()}
                      </button>

                      <button
                        class="icon-btn danger force-delete-vigencia"
                        type="button"
                        data-id="${row.id}"
                        title="Eliminar Vigencia completa"
                        aria-label="Eliminar Vigencia completa: ${escapeHTML(row.nombre)}"
                      >
                        ${trashIcon()}
                      </button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;

      content
        .querySelectorAll(
          ".document-vigencia-report"
        )
        .forEach((button) => {
          button.addEventListener(
            "click",
            () => {
              const vigencia =
                rows.find(
                  (item) =>
                    item.id ===
                    button.dataset.id
                );

              if (!vigencia) return;

              openDocumentReportDialog({
                scope: "vigencia",
                vigenciaId: vigencia.id
              });
            }
          );
        });

      content
        .querySelectorAll(
          ".backup-vigencia"
        )
        .forEach((button) => {
          button.addEventListener(
            "click",
            () => {
              const vigencia =
                rows.find(
                  (item) =>
                    item.id ===
                    button.dataset.id
                );

              if (!vigencia) return;

              openVigenciaBackupDialog({
                vigencia
              });
            }
          );
        });

      content
        .querySelectorAll(
          ".force-delete-vigencia"
        )
        .forEach((button) => {
          button.addEventListener(
            "click",
            () => {
              const vigencia =
                rows.find(
                  (item) =>
                    item.id ===
                    button.dataset.id
                );

              if (!vigencia) return;

              openForceDeleteVigenciaDialog({
                vigencia,
                onDeleted: refresh
              });
            }
          );
        });
    } catch (error) {
      console.error(error);
      content.innerHTML = `
        <div class="empty-state">
          <strong>No fue posible cargar las Vigencias.</strong>
          <p>No fue posible cargar las Vigencias. Intenta nuevamente o informa al administrador del Sistema.</p>
        </div>
      `;
    }
  }

  importButton.addEventListener("click", () => {
    openVigenciaImportDialog({
      onImported: refresh
    });
  });

  newButton.addEventListener("click", () => openCreateForm(refresh));

  await refresh();
}
