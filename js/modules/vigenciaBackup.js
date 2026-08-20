import { requireSupabase } from "../supabaseClient.js";
import { logManualEvent } from "../security.js";
import { openModal, closeModal } from "../components/modal.js";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeFilename(value = "") {
  return String(value || "vigencia")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "vigencia";
}

function todayStamp() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function downloadJSON(payload, filename) {
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], {
    type: "application/json;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

async function exportVigencia(vigenciaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase.rpc(
    "exportar_vigencia_json",
    {
      p_vigencia_id: vigenciaId
    }
  );

  if (error) throw error;
  return data;
}

export function openVigenciaBackupDialog({
  vigencia
}) {
  openModal({
    title: "Copia de seguridad de la Vigencia",

    content: `
      <div class="backup-vigencia-intro">
        <div class="backup-vigencia-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v12"></path>
            <path d="M7 10l5 5 5-5"></path>
            <path d="M5 19h14"></path>
          </svg>
        </div>

        <div>
          <strong>
            ${escapeHTML(vigencia.nombre)}
          </strong>

          <p>
            Se generará un archivo con toda la estructura de esta
            Vigencia: Consejerías, Mandatos, Biblioteca, Líneas,
            Programas, Proyectos, Actividades, Indicadores,
            seguimientos, presupuesto, evidencias, cortes históricos y compromisos.
          </p>
        </div>
      </div>

      <div class="backup-vigencia-restore-note">
        <strong>El archivo es restaurable.</strong>

        <p>
          Si posteriormente eliminas esta Vigencia, puedes reconstruirla
          desde <strong>Vigencias → Importar vigencia</strong> seleccionando
          la copia de seguridad generada aquí.
        </p>
      </div>

      <p
        id="backupVigenciaMessage"
        class="form-message"
      ></p>

      <div class="form-actions">
        <button
          id="cancelBackupVigencia"
          class="btn btn-secondary"
          type="button"
        >
          Cancelar
        </button>

        <button
          id="generateBackupVigencia"
          class="btn btn-primary"
          type="button"
        >
          Generar copia de seguridad
        </button>
      </div>
    `
  });

  const cancel =
    document.querySelector("#cancelBackupVigencia");

  const generate =
    document.querySelector("#generateBackupVigencia");

  const message =
    document.querySelector("#backupVigenciaMessage");

  cancel.addEventListener("click", closeModal);

  generate.addEventListener("click", async () => {
    generate.disabled = true;
    generate.textContent = "Generando copia…";
    message.textContent = "";

    try {
      const payload =
        await exportVigencia(vigencia.id);

      const filename =
        `copia_seguridad_${safeFilename(vigencia.nombre)}_${todayStamp()}.json`;

      downloadJSON(payload, filename);

      await logManualEvent({
        action: "generar_respaldo",
        entityType: "Vigencia",
        entityId: vigencia.id,
        entityName: vigencia.nombre,
        vigenciaId: vigencia.id,
        detail: { archivo: filename }
      });

      openModal({
        title: "Copia de seguridad generada",

        content: `
          <div class="json-import-success">
            <span class="json-import-success-icon">✓</span>

            <div>
              <strong>
                ${escapeHTML(vigencia.nombre)}
              </strong>

              <p>
                El archivo de copia de seguridad fue generado
                correctamente.
              </p>
            </div>
          </div>

          <div class="backup-vigencia-filename">
            <span>Archivo</span>
            <strong>${escapeHTML(filename)}</strong>
          </div>

          <p class="notice">
            Conserva este archivo en un lugar seguro. Es compatible
            directamente con <strong>Importar vigencia</strong>.
          </p>

          <div class="form-actions">
            <button
              id="closeBackupVigenciaSuccess"
              class="btn btn-primary"
              type="button"
            >
              Cerrar
            </button>
          </div>
        `
      });

      document
        .querySelector("#closeBackupVigenciaSuccess")
        .addEventListener("click", closeModal);
    } catch (error) {
      console.error(error);

      message.textContent =
        error.message ||
        "No fue posible generar la copia de seguridad.";

      generate.disabled = false;
      generate.textContent =
        "Generar copia de seguridad";
    }
  });
}
