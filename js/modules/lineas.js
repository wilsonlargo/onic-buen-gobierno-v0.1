import { requireSupabase } from "../supabaseClient.js";
import { updateWithVersion } from "../security.js";
import { openModal, closeModal } from "../components/modal.js";
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

function statusChip(estado) {
  const labels = {
    activa: "Activa",
    inactiva: "Inactiva",
    archivada: "Archivada"
  };

  const cssClass =
    estado === "activa"
      ? "active"
      : estado === "archivada"
        ? "archived"
        : "closed";

  return `<span class="status-chip ${cssClass}">${labels[estado] || escapeHTML(estado)}</span>`;
}


function formatPercent(value) {
  return `${Number(value || 0).toFixed(2).replace(".", ",")} %`;
}

/**
 * Distribuye exactamente 100,00 % entre las Líneas activas.
 *
 * Se trabaja en centésimas (10.000 unidades = 100,00 %) para evitar
 * errores acumulados de redondeo.
 *
 * Ejemplo con 3 Líneas:
 * 33,34 % + 33,33 % + 33,33 % = 100,00 %
 */
function calculateAutomaticWeights(lineas = []) {
  const active = lineas
    .filter((linea) => linea.estado === "activa")
    .sort((a, b) => {
      const orderDiff = Number(a.orden || 0) - Number(b.orden || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
    });

  const weights = new Map();

  lineas.forEach((linea) => weights.set(linea.id, 0));

  if (!active.length) {
    return weights;
  }

  const totalUnits = 10000;
  const baseUnits = Math.floor(totalUnits / active.length);
  const remainder = totalUnits - (baseUnits * active.length);

  active.forEach((linea, index) => {
    const units = baseUnits + (index < remainder ? 1 : 0);
    weights.set(linea.id, units / 100);
  });

  return weights;
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
        nombre_largo,
        icono_url
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

async function createLinea(payload) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("lineas_accion")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateLinea(record, payload) {
  return updateWithVersion({
    table: "lineas_accion",
    record,
    payload,
    entityType: "Línea de Acción",
    entityName: record?.nombre || record?.nombre_corto || null,
    vigenciaConsejeriaId: record?.vigencia_consejeria_id || null
  });
}


async function getProgramCounts(lineaIds = []) {
  const counts = new Map();

  lineaIds.forEach((id) => counts.set(id, 0));

  if (!lineaIds.length) {
    return counts;
  }

  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("programas")
    .select("id,linea_accion_id")
    .in("linea_accion_id", lineaIds);

  if (error) throw error;

  (data || []).forEach((programa) => {
    counts.set(
      programa.linea_accion_id,
      (counts.get(programa.linea_accion_id) || 0) + 1
    );
  });

  return counts;
}

async function getProgramaCount(lineaId) {
  const supabase = requireSupabase();

  const { count, error } = await supabase
    .from("programas")
    .select("id", { count: "exact", head: true })
    .eq("linea_accion_id", lineaId);

  if (error) throw error;
  return Number(count || 0);
}

async function deleteLinea(id) {
  const supabase = requireSupabase();

  const { error } = await supabase
    .from("lineas_accion")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

function openLineaForm({
  vigencia,
  vigenciaConsejeria,
  record = null,
  onSaved
}) {
  const editing = Boolean(record);
  const consejeria = vigenciaConsejeria.consejerias;

  openModal({
    title: editing ? "Editar Línea de Acción" : "Nueva Línea de Acción",
    content: `
      <div class="context-ribbon">
        <div>
          <span>Vigencia</span>
          <strong>${escapeHTML(vigencia.nombre)}</strong>
        </div>
        <div>
          <span>Consejería</span>
          <strong>${escapeHTML(consejeria.nombre_corto)}</strong>
        </div>
      </div>

      <form id="lineaForm">
        <div class="form-grid">
          <div class="form-field full">
            <label for="lineaNombre">Nombre de la Línea de Acción</label>
            <input
              id="lineaNombre"
              name="nombre"
              required
              value="${escapeHTML(record?.nombre || "")}"
              placeholder="Ej. Derechos de los Pueblos Indígenas"
            >
          </div>

          <div class="form-field full">
            <label for="lineaNombreCorto">Nombre corto</label>
            <input
              id="lineaNombreCorto"
              name="nombre_corto"
              value="${escapeHTML(record?.nombre_corto || "")}"
              placeholder="Opcional"
            >
          </div>

          <div class="form-field full">
            <label for="lineaDescripcion">Descripción</label>
            <textarea
              id="lineaDescripcion"
              name="descripcion"
              placeholder="Alcance y orientación general de la Línea de Acción"
            >${escapeHTML(record?.descripcion || "")}</textarea>
          </div>

          <div class="form-field">
            <label for="lineaOrden">Orden</label>
            <input
              id="lineaOrden"
              name="orden"
              type="number"
              min="0"
              step="1"
              value="${Number(record?.orden ?? 0)}"
            >
          </div>

          <div class="form-field">
            <label for="lineaEstado">Estado</label>
            <select id="lineaEstado" name="estado">
              ${option("activa", "Activa", (record?.estado || "activa") === "activa")}
              ${option("inactiva", "Inactiva", record?.estado === "inactiva")}
              ${option("archivada", "Archivada", record?.estado === "archivada")}
            </select>
          </div>
        </div>

        <p class="field-help">
          La Línea de Acción quedará vinculada exclusivamente a la Consejería
          seleccionada dentro de esta vigencia.
        </p>

        <p id="lineaMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelLinea" class="btn btn-secondary" type="button">
            Cancelar
          </button>
          <button class="btn btn-primary" type="submit">
            ${editing ? "Guardar cambios" : "Crear Línea de Acción"}
          </button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#lineaForm");
  const message = document.querySelector("#lineaMessage");

  document.querySelector("#cancelLinea").addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const formData = new FormData(form);

    const payload = {
      nombre: formData.get("nombre")?.trim(),
      nombre_corto: formData.get("nombre_corto")?.trim() || null,
      descripcion: formData.get("descripcion")?.trim() || null,
      orden: Number(formData.get("orden") || 0),
      estado: formData.get("estado")
    };

    if (!payload.nombre) {
      message.textContent = "El nombre de la Línea de Acción es obligatorio.";
      return;
    }

    if (!editing) {
      payload.vigencia_consejeria_id = vigenciaConsejeria.id;
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      if (editing) {
        await updateLinea(record, payload);
      } else {
        await createLinea(payload);
      }

      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent =
        error.message || "No fue posible guardar la Línea de Acción.";
      submit.disabled = false;
      submit.textContent = editing
        ? "Guardar cambios"
        : "Crear Línea de Acción";
    }
  });
}

async function openDeleteLineaDialog({ record, onChanged }) {
  let programas = 0;

  try {
    programas = await getProgramaCount(record.id);
  } catch (error) {
    console.error(error);

    openModal({
      title: "Eliminar Línea de Acción",
      content: `
        <div class="danger-callout">
          <strong>No se pudo verificar la estructura dependiente.</strong>
          <p>
            Por seguridad, la eliminación está bloqueada hasta poder comprobar
            si existen Programas asociados.
          </p>
        </div>

        <div class="form-actions">
          <button id="closeLineaDeleteError" class="btn btn-secondary" type="button">
            Cerrar
          </button>
        </div>
      `
    });

    document
      .querySelector("#closeLineaDeleteError")
      .addEventListener("click", closeModal);

    return;
  }

  if (programas > 0) {
    openModal({
      title: "La Línea de Acción tiene Programas",
      content: `
        <div class="danger-callout">
          <strong>${escapeHTML(record.nombre)}</strong>
          <p>
            Esta Línea de Acción contiene
            <strong>${programas} ${programas === 1 ? "Programa" : "Programas"}</strong>.
            No puede eliminarse físicamente porque se perdería la estructura histórica.
          </p>
        </div>

        <p class="muted">
          Puedes marcarla como <strong>Inactiva</strong> o <strong>Archivada</strong>.
          Sus Programas permanecerán intactos.
        </p>

        <p id="protectedLineaMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelProtectedLinea" class="btn btn-secondary" type="button">
            Cerrar
          </button>

          ${record.estado !== "inactiva"
            ? `<button id="inactivateLinea" class="btn btn-secondary" type="button">Inactivar</button>`
            : ""}

          ${record.estado !== "archivada"
            ? `<button id="archiveLinea" class="btn btn-danger" type="button">Archivar</button>`
            : ""}
        </div>
      `
    });

    document
      .querySelector("#cancelProtectedLinea")
      .addEventListener("click", closeModal);

    const inactivate = document.querySelector("#inactivateLinea");
    const archive = document.querySelector("#archiveLinea");
    const message = document.querySelector("#protectedLineaMessage");

    async function changeState(button, estado, label) {
      button.disabled = true;
      button.textContent = `${label}…`;

      try {
        await updateLinea(record, { estado });
        closeModal();
        await onChanged();
      } catch (error) {
        console.error(error);
        message.textContent =
          error.message || "No fue posible actualizar el estado.";
        button.disabled = false;
        button.textContent = label;
      }
    }

    if (inactivate) {
      inactivate.addEventListener("click", () =>
        changeState(inactivate, "inactiva", "Inactivar")
      );
    }

    if (archive) {
      archive.addEventListener("click", () =>
        changeState(archive, "archivada", "Archivar")
      );
    }

    return;
  }

  openModal({
    title: "Eliminar Línea de Acción",
    content: `
      <div class="danger-callout">
        <strong>${escapeHTML(record.nombre)}</strong>
        <p>
          Esta Línea de Acción no contiene Programas, por lo que puede eliminarse
          definitivamente.
        </p>
      </div>

      <p class="muted">
        Esta acción no se puede deshacer.
      </p>

      <div class="form-field">
        <label for="deleteLineaConfirmation">
          Escribe <strong>ELIMINAR</strong> para confirmar
        </label>
        <input
          id="deleteLineaConfirmation"
          autocomplete="off"
          placeholder="ELIMINAR"
        >
      </div>

      <p id="deleteLineaMessage" class="form-message"></p>

      <div class="form-actions">
        <button id="cancelDeleteLinea" class="btn btn-secondary" type="button">
          Cancelar
        </button>
        <button id="confirmDeleteLinea" class="btn btn-danger" type="button" disabled>
          Eliminar definitivamente
        </button>
      </div>
    `
  });

  const input = document.querySelector("#deleteLineaConfirmation");
  const confirm = document.querySelector("#confirmDeleteLinea");
  const message = document.querySelector("#deleteLineaMessage");

  document
    .querySelector("#cancelDeleteLinea")
    .addEventListener("click", closeModal);

  input.addEventListener("input", () => {
    confirm.disabled = input.value.trim().toUpperCase() !== "ELIMINAR";
  });

  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    confirm.textContent = "Eliminando…";
    message.textContent = "";

    try {
      // Revalidación inmediatamente antes del borrado.
      const currentProgramas = await getProgramaCount(record.id);

      if (currentProgramas > 0) {
        throw new Error(
          "La Línea de Acción ahora tiene Programas asociados y ya no puede eliminarse."
        );
      }

      await deleteLinea(record.id);
      closeModal();
      await onChanged();
    } catch (error) {
      console.error(error);
      message.textContent =
        error.message || "No fue posible eliminar la Línea de Acción.";
      confirm.disabled = false;
      confirm.textContent = "Eliminar definitivamente";
    }
  });
}

/* ==========================================================
   COPIAR / IMPORTAR
   ========================================================== */

async function copyLineasToClipboard(lineas) {
  if (!lineas.length) {
    throw new Error("No hay Líneas de Acción para copiar.");
  }

  const headers = [
    "nombre",
    "nombre_corto",
    "descripcion",
    "orden",
    "estado"
  ];

  const text = [
    headers.join("\t"),
    ...lineas.map((linea) => [
      linea.nombre || "",
      linea.nombre_corto || "",
      linea.descripcion || "",
      linea.orden ?? 0,
      linea.estado || "activa"
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

  const delimiter = detectDelimiter(source.split("\n")[0] || "");
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
    .filter((r) => r.some((value) => String(value ?? "").trim()))
    .map((r) => {
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] = String(r[index] ?? "").trim();
      });

      return obj;
    });
}

async function readSpreadsheetFile(file) {
  if (!window.XLSX) {
    throw new Error("No se pudo cargar el lector de archivos Excel.");
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

function normalizeImportRow(raw) {
  function pick(...keys) {
    for (const key of keys) {
      const normalizedKey = normalizeText(key).replace(/\s+/g, "_");

      if (raw[normalizedKey] !== undefined) {
        return raw[normalizedKey];
      }
    }

    return "";
  }

  const estadoRaw = normalizeText(pick("estado"));

  return {
    nombre: String(
      pick("nombre", "linea", "línea", "linea_de_accion", "línea_de_acción") || ""
    ).trim(),
    nombre_corto: String(
      pick("nombre_corto", "corto", "sigla") || ""
    ).trim(),
    descripcion: String(
      pick("descripcion", "descripción", "detalle") || ""
    ).trim(),
    orden: Number(pick("orden") || 0),
    estado: ["activa", "inactiva", "archivada"].includes(estadoRaw)
      ? estadoRaw
      : "activa"
  };
}

function validateImportRows(rawRows, existingLineas) {
  const existingNames = new Set(
    existingLineas.map((item) => normalizeText(item.nombre))
  );

  const incomingNames = new Set();

  return rawRows.map((raw, index) => {
    const row = normalizeImportRow(raw);
    const errors = [];
    const warnings = [];

    if (!row.nombre) {
      errors.push("Falta el nombre");
    }

    const nameKey = normalizeText(row.nombre);

    if (nameKey) {
      if (existingNames.has(nameKey)) {
        errors.push("La Línea ya existe en esta Consejería");
      } else if (incomingNames.has(nameKey)) {
        errors.push("Nombre repetido dentro de la importación");
      } else {
        incomingNames.add(nameKey);
      }
    }

    if (!Number.isFinite(row.orden)) {
      row.orden = 0;
      warnings.push("Orden inválido: se usará 0");
    }

    return {
      index: index + 1,
      ...row,
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

  return `
    <div class="import-summary">
      <span class="status-chip active">
        ${rows.filter((row) => row.valid).length} válidas
      </span>
      <span class="status-chip">
        ${rows.filter((row) => !row.valid).length} con error
      </span>
    </div>

    <div class="table-wrap import-preview-wrap">
      <table class="data-table compact-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Nombre</th>
            <th>Nombre corto</th>
            <th>Orden</th>
            <th>Estado</th>
            <th>Validación</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr class="${row.valid ? "" : "row-error"}">
              <td>${row.index}</td>
              <td>${escapeHTML(row.nombre || "—")}</td>
              <td>${escapeHTML(row.nombre_corto || "—")}</td>
              <td>${escapeHTML(row.orden)}</td>
              <td>${escapeHTML(row.estado)}</td>
              <td>
                ${row.errors.length
                  ? `<div class="validation-error">${escapeHTML(row.errors.join(" · "))}</div>`
                  : `<div class="validation-ok">Lista</div>`
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

function openImportLineas({
  vigencia,
  vigenciaConsejeria,
  existingLineas,
  onImported
}) {
  let validatedRows = [];

  openModal({
    title: "Importar Líneas de Acción",
    content: `
      <div class="context-ribbon">
        <div>
          <span>Vigencia</span>
          <strong>${escapeHTML(vigencia.nombre)}</strong>
        </div>
        <div>
          <span>Consejería destino</span>
          <strong>${escapeHTML(vigenciaConsejeria.consejerias.nombre_corto)}</strong>
        </div>
      </div>

      <div class="danger-callout soft-callout">
        <strong>La importación se realizará únicamente en esta Consejería.</strong>
        <p>
          Cambia la Consejería antes de abrir este formulario si deseas importar
          Líneas de Acción en otra dependencia.
        </p>
      </div>

      <div class="import-methods">
        <section class="import-method">
          <h3>Pegar desde una tabla</h3>
          <p class="muted">
            Copia filas desde Excel o Google Sheets y pégalas aquí.
          </p>

          <textarea
            id="pasteLineas"
            class="import-textarea"
            placeholder="nombre&#9;nombre_corto&#9;descripcion&#9;orden&#9;estado"
          ></textarea>

          <button id="parseLineasPaste" class="btn btn-secondary" type="button">
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
            id="lineasImportFile"
            class="file-input"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          >

          <button id="parseLineasFile" class="btn btn-secondary" type="button">
            Leer archivo
          </button>
        </section>
      </div>

      <section class="import-template">
        <strong>Encabezados recomendados</strong>
        <code>nombre | nombre_corto | descripcion | orden | estado</code>
      </section>

      <p id="lineasImportMessage" class="form-message"></p>

      <div id="lineasImportPreview">
        <div class="empty-state">
          Pega una tabla o selecciona un archivo para comenzar.
        </div>
      </div>

      <div class="form-actions sticky-actions">
        <button id="cancelLineasImport" class="btn btn-secondary" type="button">
          Cancelar
        </button>

        <button id="confirmLineasImport" class="btn btn-primary" type="button" disabled>
          Importar registros válidos
        </button>
      </div>
    `
  });

  const paste = document.querySelector("#pasteLineas");
  const fileInput = document.querySelector("#lineasImportFile");
  const preview = document.querySelector("#lineasImportPreview");
  const message = document.querySelector("#lineasImportMessage");
  const confirm = document.querySelector("#confirmLineasImport");

  function setRows(rawRows) {
    validatedRows = validateImportRows(rawRows, existingLineas);
    preview.innerHTML = importPreview(validatedRows);

    const validCount = validatedRows.filter((row) => row.valid).length;
    confirm.disabled = validCount === 0;
    confirm.textContent = validCount
      ? `Importar ${validCount} ${validCount === 1 ? "Línea" : "Líneas"}`
      : "Importar registros válidos";
  }

  document
    .querySelector("#cancelLineasImport")
    .addEventListener("click", closeModal);

  document
    .querySelector("#parseLineasPaste")
    .addEventListener("click", () => {
      message.textContent = "";

      const rows = parseDelimitedText(paste.value);

      if (!rows.length) {
        message.textContent = "No se detectaron filas para importar.";
        return;
      }

      setRows(rows);
    });

  document
    .querySelector("#parseLineasFile")
    .addEventListener("click", async () => {
      message.textContent = "";

      const file = fileInput.files?.[0];

      if (!file) {
        message.textContent = "Selecciona primero un archivo.";
        return;
      }

      try {
        const extension = file.name.split(".").pop()?.toLowerCase();
        const rows = extension === "csv"
          ? parseDelimitedText(await file.text())
          : await readSpreadsheetFile(file);

        if (!rows.length) {
          message.textContent = "El archivo no contiene filas utilizables.";
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
    const validRows = validatedRows.filter((row) => row.valid);

    if (!validRows.length) return;

    confirm.disabled = true;
    confirm.textContent = "Importando…";
    message.textContent = "";

    try {
      const supabase = requireSupabase();

      const payload = validRows.map((row) => ({
        vigencia_consejeria_id: vigenciaConsejeria.id,
        nombre: row.nombre,
        nombre_corto: row.nombre_corto || null,
        descripcion: row.descripcion || null,
        orden: row.orden,
        estado: row.estado
      }));

      const { data, error } = await supabase
        .from("lineas_accion")
        .insert(payload)
        .select("id");

      if (error) throw error;

      closeModal();
      await onImported(data?.length || 0);
    } catch (error) {
      console.error(error);
      message.textContent =
        error.message || "No fue posible completar la importación.";
      confirm.disabled = false;
      confirm.textContent = "Importar registros válidos";
    }
  });
}

export async function renderLineas(container, navigationTarget = null) {
  let vigencias = [];
  let consejerias = [];
  let lineas = [];

  let selectedVigenciaId = "";
  let selectedVigenciaConsejeriaId = "";

  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Estructura programática</p>
        <h2>Líneas de Acción</h2>
      </div>

      <div class="page-action-group">
        <button id="copyLineasButton" class="btn btn-secondary" type="button" disabled>
          Copiar tabla
        </button>

        <button id="importLineasButton" class="btn btn-secondary" type="button" disabled>
          Importar
        </button>

        <button id="newLineaButton" class="btn btn-primary" type="button" disabled>
          + Nueva Línea
        </button>
      </div>
    </div>

    <section class="panel strategic-selector-panel" style="margin-top: 0">
      <div class="strategic-selector-intro">
        <p class="eyebrow">Ubicación de trabajo</p>
        <h2>Selecciona la Consejería</h2>
        <p class="muted">
          Las Líneas de Acción pertenecen a una Consejería específica dentro de
          una Vigencia. Primero selecciona ambos niveles.
        </p>
      </div>

      <div class="strategic-selector-grid">
        <div class="form-field">
          <label for="lineasVigenciaSelector">1. Vigencia</label>
          <select id="lineasVigenciaSelector"></select>
        </div>

        <div class="form-field">
          <label for="lineasConsejeriaSelector">2. Consejería</label>
          <select id="lineasConsejeriaSelector" disabled>
            <option value="">Seleccione una Vigencia primero</option>
          </select>
        </div>
      </div>
    </section>

    <section id="selectedConsejeriaSummary" class="selected-strategic-context hidden"></section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Estructura de la Consejería</p>
          <h2 id="lineasPanelTitle">Líneas de Acción</h2>
        </div>

        <span id="lineasCount" class="status-chip">0</span>
      </div>

      <div id="lineasContent" style="margin-top: 18px">
        <div class="empty-state">
          <strong>Selecciona una Consejería.</strong>
          <p>Sus Líneas de Acción aparecerán aquí.</p>
        </div>
      </div>
    </section>

    <div id="lineasToast" class="app-toast hidden" role="status"></div>
  `;

  const vigenciaSelector = document.querySelector("#lineasVigenciaSelector");
  const consejeriaSelector = document.querySelector("#lineasConsejeriaSelector");

  const newButton = document.querySelector("#newLineaButton");
  const importButton = document.querySelector("#importLineasButton");
  const copyButton = document.querySelector("#copyLineasButton");

  const content = document.querySelector("#lineasContent");
  const count = document.querySelector("#lineasCount");
  const title = document.querySelector("#lineasPanelTitle");
  const summary = document.querySelector("#selectedConsejeriaSummary");
  const toast = document.querySelector("#lineasToast");

  function showToast(text) {
    toast.textContent = text;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3200);
  }

  function currentVigencia() {
    return vigencias.find((item) => item.id === selectedVigenciaId);
  }

  function currentConsejeria() {
    return consejerias.find(
      (item) => item.id === selectedVigenciaConsejeriaId
    );
  }

  function updateActions() {
    const hasContext = Boolean(
      selectedVigenciaId && selectedVigenciaConsejeriaId
    );

    newButton.disabled = !hasContext;
    importButton.disabled = !hasContext;
    copyButton.disabled = !hasContext || lineas.length === 0;
  }

  function renderContextSummary() {
    const vc = currentConsejeria();

    if (!vc) {
      summary.classList.add("hidden");
      summary.innerHTML = "";
      title.textContent = "Líneas de Acción";
      return;
    }

    const c = vc.consejerias;

    summary.classList.remove("hidden");
    summary.innerHTML = `
      <div>
        <span class="context-label">Consejería seleccionada</span>
        <strong>${escapeHTML(c.nombre_corto)}</strong>
        <small>${escapeHTML(c.nombre_largo)}</small>
      </div>

      <div>
        <span class="context-label">Responsable</span>
        <strong>${escapeHTML(vc.responsable || "Sin registrar")}</strong>
        <small>${escapeHTML(vc.pueblo || "")}</small>
      </div>

      <div>
        <span class="context-label">Estado en la vigencia</span>
        ${vc.estado === "activa"
          ? `<span class="status-chip active">Activa</span>`
          : `<span class="status-chip closed">Inactiva</span>`
        }
      </div>
    `;

    title.textContent = `Líneas · ${c.nombre_corto}`;
  }

  async function loadVigencias() {
    vigencias = await getVigencias();

    if (!selectedVigenciaId && vigencias.length) {
      selectedVigenciaId =
        navigationTarget?.vigencia_id &&
        vigencias.some((item) => item.id === navigationTarget.vigencia_id)
          ? navigationTarget.vigencia_id
          : (
              vigencias.find((item) => item.estado === "activa")?.id ||
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
    lineas = [];
    count.textContent = "0";
    updateActions();
    renderContextSummary();

    if (!selectedVigenciaId) {
      consejeriaSelector.disabled = true;
      consejeriaSelector.innerHTML =
        `<option value="">No hay Vigencia seleccionada</option>`;
      return;
    }

    consejerias = await getConsejeriasVigencia(selectedVigenciaId);

    if (!consejerias.length) {
      consejeriaSelector.disabled = true;
      consejeriaSelector.innerHTML =
        `<option value="">Esta Vigencia no tiene Consejerías</option>`;

      content.innerHTML = `
        <div class="empty-state">
          <strong>No hay Consejerías vinculadas a esta Vigencia.</strong>
          <p>Vincúlalas primero desde el módulo Consejerías.</p>
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
          `${item.consejerias.nombre_corto}${item.estado === "inactiva" ? " · inactiva" : ""}`
        )
      ).join("")}
    `;

    content.innerHTML = `
      <div class="empty-state">
        <strong>Selecciona una Consejería.</strong>
        <p>Sus Líneas de Acción aparecerán aquí.</p>
      </div>
    `;

    if (
      navigationTarget?.vigencia_consejeria_id &&
      consejerias.some((item) => item.id === navigationTarget.vigencia_consejeria_id)
    ) {
      selectedVigenciaConsejeriaId = navigationTarget.vigencia_consejeria_id;
      consejeriaSelector.value = selectedVigenciaConsejeriaId;
      await refreshLineas();
    }
  }

  async function refreshLineas() {
    renderContextSummary();

    const vc = currentConsejeria();

    if (!vc) {
      lineas = [];
      count.textContent = "0";
      updateActions();

      content.innerHTML = `
        <div class="empty-state">
          <strong>Selecciona una Consejería.</strong>
          <p>Sus Líneas de Acción aparecerán aquí.</p>
        </div>
      `;

      return;
    }

    content.innerHTML =
      `<div class="empty-state">Cargando Líneas de Acción…</div>`;

    lineas = await getLineas(vc.id);

    count.textContent = String(lineas.length);
    updateActions();

    const vigencia = currentVigencia();

    if (vigencia && vc) {
      setAuditContext({
        vigenciaId: vigencia.id,
        vigenciaNombre: vigencia.nombre,
        entidadTipo: "consejeria",
        entidadId: vc.id,
        entidadNombre: vc.consejerias.nombre_corto,
        seccion: "lineas",
        ruta: `${vigencia.nombre} › ${vc.consejerias.nombre_corto} › Líneas de Acción`,
        navigation: {
          view: "lineas",
          vigencia_id: vigencia.id,
          vigencia_nombre: vigencia.nombre,
          vigencia_consejeria_id: vc.id,
          consejeria_nombre: vc.consejerias.nombre_corto
        }
      });
    }

    if (!lineas.length) {
      content.innerHTML = `
        <div class="empty-state">
          <strong>Esta Consejería aún no tiene Líneas de Acción.</strong>
          <p>
            Usa <strong>+ Nueva Línea</strong> para crear la primera o
            <strong>Importar</strong> para cargar varias.
          </p>
        </div>
      `;

      return;
    }

    const weights = calculateAutomaticWeights(lineas);
    const programCounts = await getProgramCounts(lineas.map((linea) => linea.id));

    const activeLineas = lineas.filter((linea) => linea.estado === "activa");
    const automaticTotal = activeLineas.reduce(
      (sum, linea) => sum + Number(weights.get(linea.id) || 0),
      0
    );

    content.innerHTML = `
      <div class="automatic-weight-summary">
        <div>
          <span class="context-label">Ponderación automática</span>
          <strong>${activeLineas.length} ${activeLineas.length === 1 ? "Línea activa" : "Líneas activas"}</strong>
          <small>
            Las Líneas inactivas o archivadas quedan fuera del cálculo.
          </small>
        </div>

        <div class="weight-total-block">
          <span>Total</span>
          <strong>${formatPercent(automaticTotal)}</strong>
        </div>
      </div>

      <div class="lineas-grid">
        ${lineas.map((linea) => {
          const weight = Number(weights.get(linea.id) || 0);
          const programas = Number(programCounts.get(linea.id) || 0);
          const isActive = linea.estado === "activa";

          return `
            <article id="audit-linea-${linea.id}" class="linea-card ${!isActive ? "is-inactive" : ""}">
              <div class="linea-card-header">
                <div>
                  <p class="eyebrow">
                    ${linea.nombre_corto
                      ? escapeHTML(linea.nombre_corto)
                      : `Línea ${Number(linea.orden || 0) + 1}`
                    }
                  </p>
                  <h3>${escapeHTML(linea.nombre)}</h3>
                </div>

                ${statusChip(linea.estado)}
              </div>

              <p class="muted linea-card-description">
                ${escapeHTML(linea.descripcion || "Sin descripción registrada.")}
              </p>

              <div class="linea-calculation-grid">
                <div class="calculation-item weight">
                  <span>Ponderación</span>
                  <strong>${formatPercent(weight)}</strong>
                  <small>${isActive ? "Automática" : "Fuera del cálculo"}</small>
                </div>

                <div class="calculation-item">
                  <span>Programas</span>
                  <strong>${programas}</strong>
                  <small>${programas === 1 ? "Programa registrado" : "Programas registrados"}</small>
                </div>

                <div class="calculation-item">
                  <span>Cumplimiento</span>
                  <strong>—</strong>
                  <small>${programas ? "Se calculará desde Programas" : "Sin Programas"}</small>
                </div>

                <div class="calculation-item">
                  <span>Contribución</span>
                  <strong>—</strong>
                  <small>${programas ? "Pendiente de cálculo" : "Sin Programas"}</small>
                </div>
              </div>

              <div class="linea-card-meta">
                <span>
                  Orden <strong>${Number(linea.orden || 0)}</strong>
                </span>

                <span>
                  Regla <strong>${isActive ? "Automática" : "Excluida"}</strong>
                </span>
              </div>

              <div class="entity-actions">
                <button
                  class="btn btn-secondary audit-linea-note"
                  type="button"
                  data-id="${linea.id}"
                >
                  Nota
                </button>

                <button
                  class="btn btn-secondary edit-linea"
                  type="button"
                  data-id="${linea.id}"
                >
                  Editar
                </button>

                <button
                  class="icon-btn danger delete-linea"
                  type="button"
                  data-id="${linea.id}"
                  title="Eliminar Línea de Acción"
                  aria-label="Eliminar ${escapeHTML(linea.nombre)}"
                >
                  ${trashIcon()}
                </button>
              </div>
            </article>
          `;
        }).join("")}
      </div>

      <div class="calculation-note">
        <strong>Cómo se calcula</strong>
        <p>
          El 100 % se distribuye automáticamente entre las Líneas de Acción
          activas de esta Consejería. Si una Línea se inactiva o se archiva,
          su ponderación pasa a 0 % y el sistema redistribuye el 100 % entre
          las Líneas activas restantes.
        </p>
      </div>
    `;

    content.querySelectorAll(".audit-linea-note").forEach((button) => {
      button.addEventListener("click", () => {
        const linea = lineas.find((item) => item.id === button.dataset.id);
        const vigencia = currentVigencia();
        const vc = currentConsejeria();
        if (!linea || !vigencia || !vc) return;

        openAuditPanel({
          newNote: true,
          contextOverride: {
            vigenciaId: vigencia.id,
            vigenciaNombre: vigencia.nombre,
            entidadTipo: "linea",
            entidadId: linea.id,
            entidadNombre: linea.nombre,
            seccion: "general",
            ruta: `${vigencia.nombre} › ${vc.consejerias.nombre_corto} › ${linea.nombre}`,
            navigation: {
              view: "lineas",
              vigencia_id: vigencia.id,
              vigencia_nombre: vigencia.nombre,
              vigencia_consejeria_id: vc.id,
              consejeria_nombre: vc.consejerias.nombre_corto,
              linea_id: linea.id,
              linea_nombre: linea.nombre,
              anchor: `audit-linea-${linea.id}`
            }
          }
        });
      });
    });

    content.querySelectorAll(".edit-linea").forEach((button) => {
      button.addEventListener("click", () => {
        const record = lineas.find(
          (item) => item.id === button.dataset.id
        );

        openLineaForm({
          vigencia: currentVigencia(),
          vigenciaConsejeria: currentConsejeria(),
          record,
          onSaved: refreshLineas
        });
      });
    });

    content.querySelectorAll(".delete-linea").forEach((button) => {
      button.addEventListener("click", async () => {
        const record = lineas.find(
          (item) => item.id === button.dataset.id
        );

        await openDeleteLineaDialog({
          record,
          onChanged: async () => {
            await refreshLineas();
            showToast("Línea de Acción actualizada.");
          }
        });
      });
    });

    if (navigationTarget?.linea_id) {
      const target = content.querySelector(
        `#audit-linea-${CSS.escape(navigationTarget.linea_id)}`
      );

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("audit-reference-highlight");
        setTimeout(() => target.classList.remove("audit-reference-highlight"), 2600);

        const targetLinea = lineas.find((item) => item.id === navigationTarget.linea_id);
        if (targetLinea && vigencia && vc) {
          setAuditContext({
            vigenciaId: vigencia.id,
            vigenciaNombre: vigencia.nombre,
            entidadTipo: "linea",
            entidadId: targetLinea.id,
            entidadNombre: targetLinea.nombre,
            seccion: "general",
            ruta: `${vigencia.nombre} › ${vc.consejerias.nombre_corto} › ${targetLinea.nombre}`,
            navigation: navigationTarget
          });
        }
      }

      navigationTarget = null;
    }
  }

  vigenciaSelector.addEventListener("change", async () => {
    selectedVigenciaId = vigenciaSelector.value;
    await loadConsejerias();
  });

  consejeriaSelector.addEventListener("change", async () => {
    selectedVigenciaConsejeriaId = consejeriaSelector.value;
    await refreshLineas();
  });

  newButton.addEventListener("click", () => {
    const vigencia = currentVigencia();
    const vc = currentConsejeria();

    if (!vigencia || !vc) return;

    if (vc.estado !== "activa") {
      showToast(
        "La Consejería está inactiva en esta Vigencia. Reactívala antes de crear nuevas Líneas."
      );
      return;
    }

    openLineaForm({
      vigencia,
      vigenciaConsejeria: vc,
      onSaved: async () => {
        await refreshLineas();
        showToast("Línea de Acción creada.");
      }
    });
  });

  importButton.addEventListener("click", () => {
    const vigencia = currentVigencia();
    const vc = currentConsejeria();

    if (!vigencia || !vc) return;

    if (vc.estado !== "activa") {
      showToast(
        "La Consejería está inactiva en esta Vigencia. Reactívala antes de importar Líneas."
      );
      return;
    }

    openImportLineas({
      vigencia,
      vigenciaConsejeria: vc,
      existingLineas: lineas,
      onImported: async (imported) => {
        await refreshLineas();
        showToast(
          `${imported} ${imported === 1 ? "Línea importada" : "Líneas importadas"} en ${vc.consejerias.nombre_corto}.`
        );
      }
    });
  });

  copyButton.addEventListener("click", async () => {
    try {
      await copyLineasToClipboard(lineas);
      showToast(
        `${lineas.length} ${lineas.length === 1 ? "Línea copiada" : "Líneas copiadas"} al portapapeles.`
      );
    } catch (error) {
      console.error(error);
      showToast(error.message || "No fue posible copiar las Líneas.");
    }
  });

  try {
    await loadVigencias();
  } catch (error) {
    console.error(error);

    content.innerHTML = `
      <div class="empty-state">
        <strong>No fue posible cargar Líneas de Acción.</strong>
        <p>${escapeHTML(error.message || "No fue posible cargar las Líneas de Acción. Intenta nuevamente.")}</p>
      </div>
    `;
  }
}
