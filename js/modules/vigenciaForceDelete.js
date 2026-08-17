import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("es-CO").format(
    Number.isFinite(number) ? number : 0
  );
}

async function getDeleteSummary(vigenciaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase.rpc(
    "resumen_eliminacion_vigencia",
    {
      p_vigencia_id: vigenciaId
    }
  );

  if (error) throw error;
  return data;
}

async function forceDeleteVigencia({
  vigenciaId,
  confirmation,
  nameConfirmation
}) {
  const supabase = requireSupabase();

  const { data, error } = await supabase.rpc(
    "forzar_eliminar_vigencia",
    {
      p_vigencia_id: vigenciaId,
      p_confirmacion: confirmation,
      p_nombre_confirmacion: nameConfirmation
    }
  );

  if (error) throw error;
  return data;
}

function summaryCard(label, value) {
  return `
    <div class="force-delete-summary-card">
      <span>${escapeHTML(label)}</span>
      <strong>${formatNumber(value)}</strong>
    </div>
  `;
}

export async function openForceDeleteVigenciaDialog({
  vigencia,
  onDeleted
}) {
  openModal({
    title: "Eliminar Vigencia completa",
    content: `
      <div class="force-delete-loading">
        <strong>Calculando todo lo que será eliminado…</strong>
        <p>
          La eliminación forzada revisará la estructura completa
          antes de habilitar la confirmación.
        </p>
      </div>
    `
  });

  let summary;

  try {
    summary = await getDeleteSummary(vigencia.id);
  } catch (error) {
    console.error(error);

    openModal({
      title: "No fue posible preparar la eliminación",
      content: `
        <div class="danger-callout">
          <strong>La operación permanece bloqueada.</strong>
          <p>
            ${escapeHTML(
              error.message ||
              "No fue posible consultar las dependencias de la Vigencia."
            )}
          </p>
        </div>

        <div class="form-actions">
          <button
            id="closeForceDeleteError"
            class="btn btn-secondary"
            type="button"
          >
            Cerrar
          </button>
        </div>
      `
    });

    document
      .querySelector("#closeForceDeleteError")
      .addEventListener("click", closeModal);

    return;
  }

  const totalChildren =
    Number(summary.documentos_biblioteca || 0) +
    Number(summary.fuentes_mandatos || 0) +
    Number(summary.mandatos || 0) +
    Number(summary.mandato_consejerias || 0) +
    Number(summary.lineas || 0) +
    Number(summary.programas || 0) +
    Number(summary.proyectos || 0) +
    Number(summary.proyecto_mandatos || 0) +
    Number(summary.actividades || 0) +
    Number(summary.indicadores || 0) +
    Number(summary.seguimientos_indicador || 0) +
    Number(summary.rubros_presupuesto || 0) +
    Number(summary.evidencias || 0) +
    Number(summary.seguimientos_actividad || 0) +
    Number(summary.consejerias_vigencia || 0);

  openModal({
    title: "Eliminar Vigencia completa",

    content: `
      <div class="force-delete-warning">
        <div class="force-delete-warning-icon">!</div>

        <div>
          <strong>
            Esta acción elimina de forma permanente la Vigencia
            y toda su estructura operativa.
          </strong>

          <p>
            No es equivalente a cerrar o archivar una Vigencia.
            Después de confirmar, los datos eliminados no podrán
            recuperarse desde el sistema.
          </p>
        </div>
      </div>

      <div class="force-delete-vigencia">
        <span class="context-label">
          Vigencia seleccionada
        </span>

        <strong>
          ${escapeHTML(vigencia.nombre)}
        </strong>

        <small>
          Estado actual:
          ${escapeHTML(vigencia.estado)}
        </small>
      </div>

      <div class="force-delete-section">
        <h4>Se eliminará</h4>

        <div class="force-delete-summary-grid">
          ${summaryCard(
            "Consejerías en la Vigencia",
            summary.consejerias_vigencia
          )}

          ${summaryCard(
            "Líneas",
            summary.lineas
          )}

          ${summaryCard(
            "Programas",
            summary.programas
          )}

          ${summaryCard(
            "Proyectos",
            summary.proyectos
          )}

          ${summaryCard(
            "Actividades",
            summary.actividades
          )}

          ${summaryCard(
            "Indicadores",
            summary.indicadores
          )}

          ${summaryCard(
            "Seguimientos indicador",
            summary.seguimientos_indicador
          )}

          ${summaryCard(
            "Rubros presupuestales",
            summary.rubros_presupuesto
          )}

          ${summaryCard(
            "Evidencias",
            summary.evidencias
          )}

          ${summaryCard(
            "Seguimientos actividad",
            summary.seguimientos_actividad
          )}

          ${summaryCard(
            "Mandatos",
            summary.mandatos
          )}

          ${summaryCard(
            "Fuentes de Mandatos",
            summary.fuentes_mandatos
          )}

          ${summaryCard(
            "Asignaciones de Mandatos",
            summary.mandato_consejerias
          )}

          ${summaryCard(
            "Vínculos Proyecto–Mandato",
            summary.proyecto_mandatos
          )}

          ${summaryCard(
            "Documentos de Biblioteca",
            summary.documentos_biblioteca
          )}
        </div>

        <p class="force-delete-total">
          Registros relacionados identificados:
          <strong>${formatNumber(totalChildren)}</strong>
          más el registro principal de la Vigencia.
        </p>
      </div>

      <div class="force-delete-preserved">
        <strong>El catálogo institucional de Consejerías se conserva.</strong>

        <p>
          Se eliminarán sus participaciones dentro de esta Vigencia,
          pero no las Consejerías del catálogo general, porque pueden
          pertenecer a otras Vigencias.
        </p>

        <div>
          <span>
            Consejerías de catálogo preservadas:
            <strong>
              ${formatNumber(
                summary.consejerias_catalogo_preservadas
              )}
            </strong>
          </span>

          <span>
            Compartidas con otras Vigencias:
            <strong>
              ${formatNumber(
                summary.consejerias_compartidas_otras_vigencias
              )}
            </strong>
          </span>
        </div>
      </div>

      <div class="force-delete-confirmations">
        <div class="form-field">
          <label for="forceDeletePhrase">
            Escribe
            <strong>ELIMINAR VIGENCIA</strong>
          </label>

          <input
            id="forceDeletePhrase"
            autocomplete="off"
            placeholder="ELIMINAR VIGENCIA"
          >
        </div>

        <div class="form-field">
          <label for="forceDeleteName">
            Escribe exactamente el nombre de la Vigencia
          </label>

          <input
            id="forceDeleteName"
            autocomplete="off"
            placeholder="${escapeHTML(vigencia.nombre)}"
          >
        </div>
      </div>

      <label class="force-delete-checkbox">
        <input
          id="forceDeleteAcknowledgement"
          type="checkbox"
        >

        <span>
          Entiendo que esta operación elimina permanentemente
          toda la información relacionada con esta Vigencia.
        </span>
      </label>

      <p
        id="forceDeleteMessage"
        class="form-message"
      ></p>

      <div class="form-actions">
        <button
          id="cancelForceDelete"
          class="btn btn-secondary"
          type="button"
        >
          Cancelar
        </button>

        <button
          id="confirmForceDelete"
          class="btn btn-danger"
          type="button"
          disabled
        >
          Eliminar toda la Vigencia
        </button>
      </div>
    `
  });

  const phrase =
    document.querySelector("#forceDeletePhrase");

  const name =
    document.querySelector("#forceDeleteName");

  const acknowledgement =
    document.querySelector(
      "#forceDeleteAcknowledgement"
    );

  const confirm =
    document.querySelector("#confirmForceDelete");

  const message =
    document.querySelector("#forceDeleteMessage");

  function syncConfirmation() {
    const validPhrase =
      phrase.value.trim().toUpperCase() ===
      "ELIMINAR VIGENCIA";

    const validName =
      name.value === vigencia.nombre;

    confirm.disabled =
      !validPhrase ||
      !validName ||
      !acknowledgement.checked;
  }

  phrase.addEventListener(
    "input",
    syncConfirmation
  );

  name.addEventListener(
    "input",
    syncConfirmation
  );

  acknowledgement.addEventListener(
    "change",
    syncConfirmation
  );

  document
    .querySelector("#cancelForceDelete")
    .addEventListener("click", closeModal);

  confirm.addEventListener(
    "click",
    async () => {
      confirm.disabled = true;
      confirm.textContent =
        "Eliminando toda la Vigencia…";

      message.textContent = "";

      try {
        const result =
          await forceDeleteVigencia({
            vigenciaId: vigencia.id,
            confirmation: phrase.value,
            nameConfirmation: name.value
          });

        closeModal();

        if (
          typeof onDeleted ===
          "function"
        ) {
          await onDeleted(result);
        }

        openModal({
          title: "Vigencia eliminada",

          content: `
            <div class="json-import-success">
              <span class="json-import-success-icon">
                ✓
              </span>

              <div>
                <strong>
                  ${escapeHTML(
                    result?.vigencia_nombre ||
                    vigencia.nombre
                  )}
                </strong>

                <p>
                  La Vigencia y toda su estructura
                  relacionada fueron eliminadas.
                </p>
              </div>
            </div>

            <div class="force-delete-result">
              <span>
                Registros eliminados
                <strong>
                  ${formatNumber(
                    result?.registros_eliminados
                  )}
                </strong>
              </span>

              <span>
                Consejerías de catálogo preservadas
                <strong>
                  ${formatNumber(
                    result?.consejerias_catalogo_preservadas
                  )}
                </strong>
              </span>
            </div>

            <p class="notice">
              Las Consejerías institucionales permanecen
              disponibles para otras Vigencias.
            </p>

            <div class="form-actions">
              <button
                id="closeForceDeleteSuccess"
                class="btn btn-primary"
                type="button"
              >
                Cerrar
              </button>
            </div>
          `
        });

        document
          .querySelector(
            "#closeForceDeleteSuccess"
          )
          .addEventListener(
            "click",
            closeModal
          );
      } catch (error) {
        console.error(error);

        message.textContent =
          error.message ||
          "No fue posible eliminar la Vigencia. La operación fue cancelada.";

        confirm.disabled = false;
        confirm.textContent =
          "Eliminar toda la Vigencia";
      }
    }
  );
}
