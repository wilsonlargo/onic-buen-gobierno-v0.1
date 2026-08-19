import { requireSupabase } from "../supabaseClient.js";
import { logManualEvent } from "../security.js";
import { openModal, closeModal } from "../components/modal.js";

const SUPPORTED_SCHEMA = "onic-buen-gobierno.v1";
const MAX_FILE_BYTES = 12 * 1024 * 1024;

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);

  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getArray(value) {
  return Array.isArray(value) ? value : [];
}

function validatePayload(payload) {
  const errors = [];
  const warnings = [];

  const isBackup =
    payload?.metadata?.tipo ===
    "copia_seguridad";

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return {
      errors: [
        "El archivo seleccionado no tiene una estructura válida."
      ],
      warnings
    };
  }

  if (payload.schema !== SUPPORTED_SCHEMA) {
    errors.push(
      "El archivo no corresponde a una copia compatible con esta versión del Sistema."
    );
  }

  const vigencia = payload.vigencia;

  if (
    !vigencia ||
    typeof vigencia !== "object" ||
    Array.isArray(vigencia)
  ) {
    errors.push(
      'Falta el objeto "vigencia".'
    );
  } else {
    if (!String(vigencia.nombre || "").trim()) {
      errors.push(
        "La Vigencia requiere nombre."
      );
    }

    if (!vigencia.fecha_inicio) {
      errors.push(
        "La Vigencia requiere fecha_inicio."
      );
    }

    if (!vigencia.fecha_fin) {
      errors.push(
        "La Vigencia requiere fecha_fin."
      );
    }

    if (
      vigencia.fecha_inicio &&
      vigencia.fecha_fin &&
      vigencia.fecha_fin < vigencia.fecha_inicio
    ) {
      errors.push(
        "fecha_fin no puede ser anterior a fecha_inicio."
      );
    }
  }

  if (!Array.isArray(payload.consejerias)) {
    errors.push(
      '"consejerias" debe ser un arreglo.'
    );
    return { errors, warnings };
  }

  if (!payload.consejerias.length) {
    errors.push(
      "La importación requiere al menos una Consejería."
    );
  }

  const consejeriaRefs = new Set();
  const sourceRefs = new Set();
  const mandateRefs = new Set();

  payload.consejerias.forEach(
    (consejeria, consejeriaIndex) => {
      const path =
        `Consejería ${consejeriaIndex + 1}`;

      const ref =
        String(consejeria?.ref || "").trim();

      if (!ref) {
        errors.push(
          `${path}: falta ref.`
        );
      } else if (consejeriaRefs.has(ref)) {
        errors.push(
          `${path}: ref duplicado "${ref}".`
        );
      } else {
        consejeriaRefs.add(ref);
      }

      if (
        !String(
          consejeria?.catalogo?.nombre_largo || ""
        ).trim()
      ) {
        errors.push(
          `${path}: falta catalogo.nombre_largo.`
        );
      }

      if (
        !String(
          consejeria?.catalogo?.nombre_corto || ""
        ).trim()
      ) {
        errors.push(
          `${path}: falta catalogo.nombre_corto.`
        );
      }

      getArray(consejeria.lineas).forEach(
        (linea, lineaIndex) => {
          const linePath =
            `${path} > Línea ${lineaIndex + 1}`;

          if (!String(linea?.nombre || "").trim()) {
            errors.push(
              `${linePath}: falta nombre.`
            );
          }

          getArray(linea.programas).forEach(
            (programa, programaIndex) => {
              const programPath =
                `${linePath} > Programa ${programaIndex + 1}`;

              if (
                !String(
                  programa?.nombre || ""
                ).trim()
              ) {
                errors.push(
                  `${programPath}: falta nombre.`
                );
              }

              const proyectos =
                getArray(programa.proyectos);

              if (proyectos.length) {
                const weightSum =
                  proyectos.reduce(
                    (sum, proyecto) =>
                      sum +
                      numberOrZero(
                        proyecto?.ponderacion
                      ),
                    0
                  );

                if (
                  !isBackup &&
                  Math.abs(weightSum - 100) > 0.01
                ) {
                  errors.push(
                    `${programPath}: las ponderaciones de los Proyectos suman ${weightSum.toFixed(2)} y deben sumar 100.`
                  );
                }
              }

              proyectos.forEach(
                (proyecto, projectIndex) => {
                  const projectPath =
                    `${programPath} > Proyecto ${projectIndex + 1}`;

                  if (
                    !String(
                      proyecto?.nombre || ""
                    ).trim()
                  ) {
                    errors.push(
                      `${projectPath}: falta nombre.`
                    );
                  }

                  const weight =
                    Number(proyecto?.ponderacion);

                  if (
                    !Number.isFinite(weight) ||
                    weight < 0 ||
                    weight > 100
                  ) {
                    errors.push(
                      `${projectPath}: ponderacion inválida.`
                    );
                  }

                  getArray(
                    proyecto.actividades
                  ).forEach(
                    (actividad, activityIndex) => {
                      const activityPath =
                        `${projectPath} > Actividad ${activityIndex + 1}`;

                      if (
                        !String(
                          actividad?.nombre || ""
                        ).trim()
                      ) {
                        errors.push(
                          `${activityPath}: falta nombre.`
                        );
                      }

                      const indicatorRefs =
                        new Set();

                      getArray(
                        actividad.indicadores
                      ).forEach(
                        (
                          indicador,
                          indicatorIndex
                        ) => {
                          const indicatorPath =
                            `${activityPath} > Indicador ${indicatorIndex + 1}`;

                          const indicatorRef =
                            String(
                              indicador?.ref || ""
                            ).trim();

                          if (!indicatorRef) {
                            errors.push(
                              `${indicatorPath}: falta ref.`
                            );
                          } else if (
                            indicatorRefs.has(
                              indicatorRef
                            )
                          ) {
                            errors.push(
                              `${indicatorPath}: ref duplicado "${indicatorRef}".`
                            );
                          } else {
                            indicatorRefs.add(
                              indicatorRef
                            );
                          }

                          if (
                            !String(
                              indicador?.nombre ||
                              ""
                            ).trim()
                          ) {
                            errors.push(
                              `${indicatorPath}: falta nombre.`
                            );
                          }

                          const base =
                            Number(
                              indicador?.linea_base ??
                              0
                            );

                          const meta =
                            Number(indicador?.meta);

                          if (
                            !Number.isFinite(base) ||
                            !Number.isFinite(meta)
                          ) {
                            errors.push(
                              `${indicatorPath}: línea base y meta deben ser numéricas.`
                            );
                          } else if (
                            Math.abs(
                              meta - base
                            ) < 1e-12
                          ) {
                            errors.push(
                              `${indicatorPath}: la meta debe ser diferente de la línea base.`
                            );
                          }
                        }
                      );

                      getArray(
                        actividad.evidencias
                      ).forEach(
                        (evidencia, evidenceIndex) => {
                          const ref =
                            String(
                              evidencia?.indicador_ref ||
                              ""
                            ).trim();

                          if (
                            ref &&
                            !indicatorRefs.has(ref)
                          ) {
                            errors.push(
                              `${activityPath} > Evidencia ${evidenceIndex + 1}: indicador_ref "${ref}" no existe en la Actividad.`
                            );
                          }
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );

  getArray(payload.fuentes_mandatos).forEach(
    (fuente, index) => {
      const ref =
        String(fuente?.ref || "").trim();

      if (!ref) {
        errors.push(
          `Fuente ${index + 1}: falta ref.`
        );
      } else if (sourceRefs.has(ref)) {
        errors.push(
          `Fuente ${index + 1}: ref duplicado "${ref}".`
        );
      } else {
        sourceRefs.add(ref);
      }

      if (!String(fuente?.nombre || "").trim()) {
        errors.push(
          `Fuente ${index + 1}: falta nombre.`
        );
      }
    }
  );

  getArray(payload.mandatos).forEach(
    (mandato, index) => {
      const path = `Mandato ${index + 1}`;
      const ref =
        String(mandato?.ref || "").trim();

      if (!ref) {
        errors.push(`${path}: falta ref.`);
      } else if (mandateRefs.has(ref)) {
        errors.push(
          `${path}: ref duplicado "${ref}".`
        );
      } else {
        mandateRefs.add(ref);
      }

      const sourceRef =
        String(
          mandato?.fuente_ref || ""
        ).trim();

      if (
        sourceRef &&
        !sourceRefs.has(sourceRef)
      ) {
        errors.push(
          `${path}: fuente_ref "${sourceRef}" no existe.`
        );
      }

      if (!String(mandato?.texto || "").trim()) {
        errors.push(
          `${path}: falta texto.`
        );
      }

      getArray(mandato.consejerias).forEach(
        (consejeriaRef) => {
          if (
            !consejeriaRefs.has(
              String(consejeriaRef)
            )
          ) {
            errors.push(
              `${path}: Consejería "${consejeriaRef}" no existe.`
            );
          }
        }
      );
    }
  );

  payload.consejerias.forEach((consejeria) => {
    getArray(consejeria.lineas).forEach(
      (linea) => {
        getArray(linea.programas).forEach(
          (programa) => {
            getArray(programa.proyectos).forEach(
              (proyecto) => {
                getArray(proyecto.mandatos).forEach(
                  (mandateRef) => {
                    if (
                      !mandateRefs.has(
                        String(mandateRef)
                      )
                    ) {
                      errors.push(
                        `Proyecto "${proyecto.nombre || "sin nombre"}": Mandato "${mandateRef}" no existe.`
                      );
                    }
                  }
                );
              }
            );
          }
        );
      }
    );
  });

  if (
    payload.metadata?.tipo === "prueba"
  ) {
    warnings.push(
      "El archivo está marcado como Vigencia de prueba."
    );
  }

  if (
    payload.metadata?.tipo === "copia_seguridad"
  ) {
    warnings.push(
      "Copia de seguridad detectada. La Vigencia se restaurará conservando sus ponderaciones registradas."
    );
  }

  return {
    errors,
    warnings
  };
}

function countPayload(payload) {
  const counts = {
    consejerias: 0,
    documentos: 0,
    fuentes: getArray(
      payload.fuentes_mandatos
    ).length,
    mandatos: getArray(
      payload.mandatos
    ).length,
    lineas: 0,
    programas: 0,
    proyectos: 0,
    actividades: 0,
    indicadores: 0,
    seguimientosIndicador: 0,
    rubros: 0,
    evidencias: 0,
    seguimientosActividad: 0
  };

  getArray(payload.consejerias).forEach(
    (consejeria) => {
      counts.consejerias += 1;
      counts.documentos +=
        getArray(
          consejeria.biblioteca
        ).length;

      getArray(consejeria.lineas).forEach(
        (linea) => {
          counts.lineas += 1;

          getArray(linea.programas).forEach(
            (programa) => {
              counts.programas += 1;

              getArray(
                programa.proyectos
              ).forEach((proyecto) => {
                counts.proyectos += 1;

                getArray(
                  proyecto.actividades
                ).forEach((actividad) => {
                  counts.actividades += 1;

                  getArray(
                    actividad.indicadores
                  ).forEach(
                    (indicador) => {
                      counts.indicadores += 1;
                      counts.seguimientosIndicador +=
                        getArray(
                          indicador.seguimientos
                        ).length;
                    }
                  );

                  counts.rubros +=
                    getArray(
                      actividad.presupuesto
                    ).length;

                  counts.evidencias +=
                    getArray(
                      actividad.evidencias
                    ).length;

                  counts.seguimientosActividad +=
                    getArray(
                      actividad.seguimientos
                    ).length;
                });
              });
            }
          );
        }
      );
    }
  );

  return counts;
}

async function checkDuplicateVigencia(
  vigencia
) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("vigencias")
    .select("id,nombre")
    .eq("nombre", vigencia.nombre)
    .eq(
      "fecha_inicio",
      vigencia.fecha_inicio
    )
    .eq("fecha_fin", vigencia.fecha_fin)
    .limit(1);

  if (error) throw error;

  return (data || [])[0] || null;
}

function previewMetric(label, value) {
  return `
    <div class="json-import-metric">
      <span>${escapeHTML(label)}</span>
      <strong>${Number(value || 0)}</strong>
    </div>
  `;
}

function expectedResultHTML(payload) {
  const expected =
    payload?.metadata?.resultado_esperado;

  if (!expected) return "";

  return `
    <div class="json-import-expected">
      <span class="context-label">
        Resultado esperado del archivo de prueba
      </span>

      <div>
        ${
          expected.avance_general_aprox !==
          undefined
            ? `
              <strong>
                Avance general ≈
                ${Number(
                  expected.avance_general_aprox
                )
                  .toFixed(2)
                  .replace(".", ",")} %
              </strong>
            `
            : ""
        }

        ${
          expected.cobertura_medicion !==
          undefined
            ? `
              <strong>
                Cobertura de medición =
                ${Number(
                  expected.cobertura_medicion
                )
                  .toFixed(2)
                  .replace(".", ",")} %
              </strong>
            `
            : ""
        }
      </div>
    </div>
  `;
}

export function openVigenciaImportDialog({
  onImported
}) {
  let payload = null;
  let file = null;

  openModal({
    title: "Importar / restaurar Vigencia",

    content: `
      <div class="json-import-intro">
        <p>
          Carga una Vigencia completa con Consejerías,
          Mandatos, Biblioteca, Líneas, Programas,
          Proyectos, Actividades, Indicadores,
          Presupuesto, Evidencias y Seguimientos.
        </p>

        <p>
          También puedes seleccionar una
          <strong>copia de seguridad</strong> generada por el
          sistema para restaurar una Vigencia previamente eliminada.
        </p>

        <p>
          La importación es <strong>segura</strong>:
          si ocurre un error, no se guardará información incompleta
          de la Vigencia.
        </p>
      </div>

      <input
        id="vigenciaJsonFileInput"
        type="file"
        accept=".json,application/json"
        hidden
      >

      <button
        id="vigenciaJsonDropzone"
        class="json-import-dropzone"
        type="button"
      >
        <span class="json-import-file-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h8l4 4v14H6z"></path>
            <path d="M14 3v5h5"></path>
            <path d="M12 17V10"></path>
            <path d="M9 13l3-3 3 3"></path>
          </svg>
        </span>

        <strong>
          Seleccionar archivo de Vigencia
        </strong>

        <span>
          o arrástralo aquí
        </span>

        <small>
          Archivo compatible con el formato del Sistema de Buen Gobierno
        </small>
      </button>

      <div
        id="vigenciaJsonFileInfo"
        class="json-import-file-info hidden"
      ></div>

      <div
        id="vigenciaJsonValidation"
        class="json-import-validation hidden"
      ></div>

      <div
        id="vigenciaJsonPreview"
        class="json-import-preview hidden"
      ></div>

      <p
        id="vigenciaJsonMessage"
        class="form-message"
      ></p>

      <div class="form-actions">
        <button
          id="cancelVigenciaJsonImport"
          class="btn btn-secondary"
          type="button"
        >
          Cancelar
        </button>

        <button
          id="executeVigenciaJsonImport"
          class="btn btn-primary"
          type="button"
          disabled
        >
          Importar Vigencia
        </button>
      </div>
    `
  });

  const input =
    document.querySelector(
      "#vigenciaJsonFileInput"
    );

  const dropzone =
    document.querySelector(
      "#vigenciaJsonDropzone"
    );

  const fileInfo =
    document.querySelector(
      "#vigenciaJsonFileInfo"
    );

  const validation =
    document.querySelector(
      "#vigenciaJsonValidation"
    );

  const preview =
    document.querySelector(
      "#vigenciaJsonPreview"
    );

  const message =
    document.querySelector(
      "#vigenciaJsonMessage"
    );

  const executeButton =
    document.querySelector(
      "#executeVigenciaJsonImport"
    );

  document
    .querySelector(
      "#cancelVigenciaJsonImport"
    )
    .addEventListener("click", closeModal);

  dropzone.addEventListener(
    "click",
    () => input.click()
  );

  dropzone.addEventListener(
    "dragover",
    (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    }
  );

  dropzone.addEventListener(
    "dragleave",
    () => {
      dropzone.classList.remove(
        "is-dragging"
      );
    }
  );

  dropzone.addEventListener(
    "drop",
    (event) => {
      event.preventDefault();

      dropzone.classList.remove(
        "is-dragging"
      );

      const droppedFile =
        event.dataTransfer?.files?.[0];

      if (droppedFile) {
        processFile(droppedFile);
      }
    }
  );

  input.addEventListener(
    "change",
    () => {
      const selectedFile =
        input.files?.[0];

      if (selectedFile) {
        processFile(selectedFile);
      }
    }
  );

  async function processFile(selectedFile) {
    payload = null;
    file = selectedFile;

    executeButton.disabled = true;
    message.textContent = "";

    validation.classList.add("hidden");
    validation.innerHTML = "";

    preview.classList.add("hidden");
    preview.innerHTML = "";

    fileInfo.classList.remove("hidden");
    fileInfo.innerHTML = `
      <strong>
        ${escapeHTML(selectedFile.name)}
      </strong>
      <span>
        ${formatBytes(selectedFile.size)}
      </span>
    `;

    if (
      selectedFile.size > MAX_FILE_BYTES
    ) {
      validation.classList.remove(
        "hidden"
      );

      validation.innerHTML = `
        <div class="json-import-error">
          El archivo supera el límite de
          ${formatBytes(MAX_FILE_BYTES)}.
        </div>
      `;

      return;
    }

    try {
      const text =
        await selectedFile.text();

      payload = JSON.parse(text);

      const result =
        validatePayload(payload);

      if (result.errors.length) {
        validation.classList.remove(
          "hidden"
        );

        validation.innerHTML = `
          <div class="json-import-error">
            <strong>
              Se encontraron
              ${result.errors.length}
              ${
                result.errors.length === 1
                  ? "error"
                  : "errores"
              }
            </strong>

            <ul>
              ${result.errors
                .slice(0, 20)
                .map(
                  (error) =>
                    `<li>${escapeHTML(error)}</li>`
                )
                .join("")}
            </ul>

            ${
              result.errors.length > 20
                ? `
                  <small>
                    Se muestran los primeros 20 errores.
                  </small>
                `
                : ""
            }
          </div>
        `;

        payload = null;
        return;
      }

      const duplicate =
        await checkDuplicateVigencia(
          payload.vigencia
        );

      if (duplicate) {
        validation.classList.remove(
          "hidden"
        );

        validation.innerHTML = `
          <div class="json-import-error">
            Ya existe una Vigencia con este mismo
            nombre y periodo:
            <strong>
              ${escapeHTML(duplicate.nombre)}
            </strong>.
          </div>
        `;

        payload = null;
        return;
      }

      if (result.warnings.length) {
        validation.classList.remove(
          "hidden"
        );

        validation.innerHTML = `
          <div class="json-import-warning">
            ${result.warnings
              .map(
                (warning) =>
                  `<p>${escapeHTML(warning)}</p>`
              )
              .join("")}
          </div>
        `;
      }

      const counts =
        countPayload(payload);

      preview.classList.remove("hidden");

      preview.innerHTML = `
        <div class="json-import-vigencia">
          <span class="context-label">
            Vigencia a crear
          </span>

          <strong>
            ${escapeHTML(
              payload.vigencia.nombre
            )}
          </strong>

          <small>
            ${escapeHTML(
              payload.vigencia.fecha_inicio
            )}
            —
            ${escapeHTML(
              payload.vigencia.fecha_fin
            )}
            ·
            ${escapeHTML(
              payload.vigencia.estado ||
              "borrador"
            )}
          </small>
        </div>

        <div class="json-import-metrics">
          ${previewMetric(
            "Consejerías",
            counts.consejerias
          )}
          ${previewMetric(
            "Líneas",
            counts.lineas
          )}
          ${previewMetric(
            "Programas",
            counts.programas
          )}
          ${previewMetric(
            "Proyectos",
            counts.proyectos
          )}
          ${previewMetric(
            "Actividades",
            counts.actividades
          )}
          ${previewMetric(
            "Indicadores",
            counts.indicadores
          )}
          ${previewMetric(
            "Mandatos",
            counts.mandatos
          )}
          ${previewMetric(
            "Documentos",
            counts.documentos
          )}
        </div>

        <details class="json-import-details">
          <summary>
            Ver otros elementos
          </summary>

          <div class="json-import-detail-grid">
            <span>
              Fuentes:
              <strong>${counts.fuentes}</strong>
            </span>

            <span>
              Seguimientos de indicador:
              <strong>
                ${counts.seguimientosIndicador}
              </strong>
            </span>

            <span>
              Rubros:
              <strong>${counts.rubros}</strong>
            </span>

            <span>
              Evidencias:
              <strong>${counts.evidencias}</strong>
            </span>

            <span>
              Seguimientos narrativos:
              <strong>
                ${counts.seguimientosActividad}
              </strong>
            </span>
          </div>
        </details>

        ${expectedResultHTML(payload)}
      `;

      executeButton.disabled = false;
    } catch (error) {
      console.error(error);

      validation.classList.remove(
        "hidden"
      );

      validation.innerHTML = `
        <div class="json-import-error">
          <strong>
            No fue posible leer el archivo.
          </strong>

          <p>
            ${escapeHTML(
              "El archivo seleccionado no es válido o está dañado."
            )}
          </p>
        </div>
      `;

      payload = null;
    }
  }

  executeButton.addEventListener(
    "click",
    async () => {
      if (!payload) return;

      executeButton.disabled = true;
      executeButton.textContent =
        "Importando…";

      message.textContent = "";

      try {
        const supabase =
          requireSupabase();

        const { data, error } =
          await supabase.rpc(
            "importar_vigencia_json",
            {
              p_payload: payload
            }
          );

        if (error) throw error;

        const summary =
          data?.resumen || {};

        await logManualEvent({
          action: payload?.metadata?.tipo === "copia_seguridad" ? "restaurar_vigencia" : "importar_vigencia",
          entityType: "Vigencia",
          entityId: data?.vigencia_id || null,
          entityName: data?.vigencia_nombre || payload?.vigencia?.nombre || null,
          vigenciaId: data?.vigencia_id || null,
          detail: { resumen: summary }
        });

        if (
          typeof onImported ===
          "function"
        ) {
          await onImported(data);
        }

        openModal({
          title:
            "Vigencia importada correctamente",

          content: `
            <div class="json-import-success">
              <span class="json-import-success-icon">
                ✓
              </span>

              <div>
                <strong>
                  ${escapeHTML(
                    data?.vigencia_nombre ||
                    payload.vigencia.nombre
                  )}
                </strong>

                <p>
                  La Vigencia completa fue creada correctamente
                  en el Sistema.
                </p>
              </div>
            </div>

            <div class="json-import-metrics">
              ${previewMetric(
                "Consejerías",
                summary.consejerias
              )}
              ${previewMetric(
                "Líneas",
                summary.lineas
              )}
              ${previewMetric(
                "Programas",
                summary.programas
              )}
              ${previewMetric(
                "Proyectos",
                summary.proyectos
              )}
              ${previewMetric(
                "Actividades",
                summary.actividades
              )}
              ${previewMetric(
                "Indicadores",
                summary.indicadores
              )}
            </div>

            <div class="json-import-result-note">
              <span>
                Consejerías reutilizadas:
                <strong>
                  ${
                    summary.consejerias_reutilizadas ||
                    0
                  }
                </strong>
              </span>

              <span>
                Consejerías nuevas:
                <strong>
                  ${
                    summary.consejerias_nuevas ||
                    0
                  }
                </strong>
              </span>
            </div>

            <p class="notice">
              Ya puedes ir a <strong>Inicio</strong>,
              seleccionar esta Vigencia y comprobar
              sus indicadores estructurales y el
              avance general.
            </p>

            <div class="form-actions">
              <button
                id="closeImportSuccess"
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
            "#closeImportSuccess"
          )
          .addEventListener(
            "click",
            closeModal
          );
      } catch (error) {
        console.error(error);

        message.textContent =
          error.message ||
          "No fue posible importar la Vigencia.";

        executeButton.disabled = false;
        executeButton.textContent =
          "Importar Vigencia";
      }
    }
  );
}
