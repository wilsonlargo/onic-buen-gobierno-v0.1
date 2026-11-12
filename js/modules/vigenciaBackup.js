import { requireSupabase } from "../supabaseClient.js?v=5.4.17";
import { logManualEvent } from "../security.js?v=5.4.17";
import { openModal, closeModal } from "../components/modal.js?v=5.4.17";
import { friendlyErrorMessage } from "../userMessages.js?v=5.4.17";
import { uiIcon } from "../components/uiSystem.js?v=5.4.17";

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

async function getUnitTypeMetadata(vigenciaId) {
  const supabase = requireSupabase();
  const { data: vcs, error: vcError } = await supabase
    .from("vigencia_consejerias")
    .select("id,consejerias(nombre_corto,nombre_largo)")
    .eq("vigencia_id", vigenciaId);
  if (vcError) throw vcError;
  const vcIds = (vcs || []).map((row) => row.id);
  if (!vcIds.length) return [];

  const { data: lines, error: lineError } = await supabase.from("lineas_accion").select("id,vigencia_consejeria_id,nombre").in("vigencia_consejeria_id", vcIds);
  if (lineError) throw lineError;
  const lineIds = (lines || []).map((row) => row.id);
  if (!lineIds.length) return [];

  const { data: programs, error: programError } = await supabase.from("programas").select("id,linea_accion_id,nombre").in("linea_accion_id", lineIds);
  if (programError) throw programError;
  const programIds = (programs || []).map((row) => row.id);
  if (!programIds.length) return [];

  const { data: projects, error: projectError } = await supabase.from("proyectos").select("id,programa_id,codigo,nombre,tipo_unidad,actividad_principal_id").in("programa_id", programIds);
  if (projectError) throw projectError;
  const principalIds = (projects || []).map((row) => row.actividad_principal_id).filter(Boolean);
  let activities = [];
  if (principalIds.length) {
    const { data, error } = await supabase.from("actividades").select("id,codigo,nombre").in("id", principalIds);
    if (error) throw error;
    activities = data || [];
  }

  const vcMap = new Map((vcs || []).map((row) => [row.id, row]));
  const lineMap = new Map((lines || []).map((row) => [row.id, row]));
  const programMap = new Map((programs || []).map((row) => [row.id, row]));
  const activityMap = new Map(activities.map((row) => [row.id, row]));

  return (projects || []).map((project) => {
    const program = programMap.get(project.programa_id);
    const line = lineMap.get(program?.linea_accion_id);
    const vc = vcMap.get(line?.vigencia_consejeria_id);
    const principal = activityMap.get(project.actividad_principal_id);
    return {
      consejeria: vc?.consejerias?.nombre_corto || vc?.consejerias?.nombre_largo || null,
      linea: line?.nombre || null,
      programa: program?.nombre || null,
      codigo: project.codigo || null,
      nombre: project.nombre,
      tipo_unidad: project.tipo_unidad || "proyecto",
      actividad_principal: principal ? { codigo: principal.codigo || null, nombre: principal.nombre } : null
    };
  }).filter((row) => row.tipo_unidad === "actividad_general");
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
  const unitTypes = await getUnitTypeMetadata(vigenciaId);
  if (unitTypes.length) {
    data.metadata = { ...(data.metadata || {}), version_aplicacion: "5.4.0", unidad_tipos: unitTypes };
  }
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
            Programas, Proyectos / Actividades generales, Indicadores,
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
            <span class="json-import-success-icon">${uiIcon("check")}</span>

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
        friendlyErrorMessage(error, "No fue posible generar la copia de seguridad.");

      generate.disabled = false;
      generate.textContent =
        "Generar copia de seguridad";
    }
  });
}
