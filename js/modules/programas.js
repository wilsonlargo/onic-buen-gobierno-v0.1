import { requireSupabase } from "../supabaseClient.js";
import { updateWithVersion } from "../security.js";
import { openModal, closeModal } from "../components/modal.js";

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
    activo: "Activo",
    inactivo: "Inactivo",
    archivado: "Archivado"
  };

  const cssClass =
    estado === "activo"
      ? "active"
      : estado === "archivado"
        ? "archived"
        : "closed";

  return `<span class="status-chip ${cssClass}">${labels[estado] || escapeHTML(estado)}</span>`;
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

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2).replace(".", ",")} %`;
}

/**
 * Distribuye exactamente 100,00 % entre Programas activos.
 * Trabaja en centésimas para evitar errores de redondeo.
 */
function calculateAutomaticWeights(programas = []) {
  const active = programas
    .filter((programa) => programa.estado === "activo")
    .sort((a, b) => {
      const orderDiff = Number(a.orden || 0) - Number(b.orden || 0);
      if (orderDiff !== 0) return orderDiff;

      return String(a.nombre || "").localeCompare(
        String(b.nombre || ""),
        "es"
      );
    });

  const weights = new Map();

  programas.forEach((programa) => weights.set(programa.id, 0));

  if (!active.length) {
    return weights;
  }

  const totalUnits = 10000;
  const baseUnits = Math.floor(totalUnits / active.length);
  const remainder = totalUnits - (baseUnits * active.length);

  active.forEach((programa, index) => {
    const units = baseUnits + (index < remainder ? 1 : 0);
    weights.set(programa.id, units / 100);
  });

  return weights;
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

async function createPrograma(payload) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("programas")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updatePrograma(record, payload) {
  return updateWithVersion({
    table: "programas",
    record,
    payload,
    entityType: "Programa",
    entityName: record?.nombre || record?.nombre_corto || null
  });
}

async function getProyectoCount(programaId) {
  const supabase = requireSupabase();

  const { count, error } = await supabase
    .from("proyectos")
    .select("id", { count: "exact", head: true })
    .eq("programa_id", programaId);

  if (error) throw error;
  return Number(count || 0);
}

async function getProjectCounts(programaIds = []) {
  const counts = new Map();

  programaIds.forEach((id) => counts.set(id, 0));

  if (!programaIds.length) {
    return counts;
  }

  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("proyectos")
    .select("id,programa_id")
    .in("programa_id", programaIds);

  if (error) throw error;

  (data || []).forEach((proyecto) => {
    counts.set(
      proyecto.programa_id,
      (counts.get(proyecto.programa_id) || 0) + 1
    );
  });

  return counts;
}

async function deletePrograma(id) {
  const supabase = requireSupabase();

  const { error } = await supabase
    .from("programas")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

function calculateLineWeight(lineas, selectedLineaId) {
  const active = lineas
    .filter((linea) => linea.estado === "activa")
    .sort((a, b) => {
      const orderDiff = Number(a.orden || 0) - Number(b.orden || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
    });

  if (!active.length) return 0;

  const totalUnits = 10000;
  const baseUnits = Math.floor(totalUnits / active.length);
  const remainder = totalUnits - (baseUnits * active.length);

  for (let index = 0; index < active.length; index++) {
    const linea = active[index];
    if (linea.id === selectedLineaId) {
      return (baseUnits + (index < remainder ? 1 : 0)) / 100;
    }
  }

  return 0;
}

function openProgramaForm({
  vigencia,
  vigenciaConsejeria,
  linea,
  record = null,
  onSaved
}) {
  const editing = Boolean(record);

  openModal({
    title: editing ? "Editar Programa" : "Nuevo Programa",
    content: `
      <div class="context-ribbon context-ribbon-three">
        <div>
          <span>Vigencia</span>
          <strong>${escapeHTML(vigencia.nombre)}</strong>
        </div>

        <div>
          <span>Consejería</span>
          <strong>${escapeHTML(vigenciaConsejeria.consejerias.nombre_corto)}</strong>
        </div>

        <div>
          <span>Línea de Acción</span>
          <strong>${escapeHTML(linea.nombre)}</strong>
        </div>
      </div>

      <form id="programaForm">
        <div class="form-grid">
          <div class="form-field full">
            <label for="programaNombre">Nombre del Programa</label>
            <input
              id="programaNombre"
              name="nombre"
              required
              value="${escapeHTML(record?.nombre || "")}"
              placeholder="Ej. Fortalecimiento del Gobierno Propio"
            >
          </div>

          <div class="form-field full">
            <label for="programaNombreCorto">Nombre corto</label>
            <input
              id="programaNombreCorto"
              name="nombre_corto"
              value="${escapeHTML(record?.nombre_corto || "")}"
              placeholder="Opcional"
            >
          </div>

          <div class="form-field full">
            <label for="programaDescripcion">Descripción</label>
            <textarea
              id="programaDescripcion"
              name="descripcion"
              placeholder="Descripción general del Programa"
            >${escapeHTML(record?.descripcion || "")}</textarea>
          </div>

          <div class="form-field">
            <label for="programaOrden">Orden</label>
            <input
              id="programaOrden"
              name="orden"
              type="number"
              min="0"
              step="1"
              value="${Number(record?.orden ?? 0)}"
            >
          </div>

          <div class="form-field">
            <label for="programaEstado">Estado</label>
            <select id="programaEstado" name="estado">
              ${option("activo", "Activo", (record?.estado || "activo") === "activo")}
              ${option("inactivo", "Inactivo", record?.estado === "inactivo")}
              ${option("archivado", "Archivado", record?.estado === "archivado")}
            </select>
          </div>
        </div>

        <p class="field-help">
          El Programa quedará vinculado exclusivamente a la Línea de Acción seleccionada.
          Su ponderación se calcula automáticamente y no es editable.
        </p>

        <p id="programaMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelPrograma" class="btn btn-secondary" type="button">
            Cancelar
          </button>

          <button class="btn btn-primary" type="submit">
            ${editing ? "Guardar cambios" : "Crear Programa"}
          </button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#programaForm");
  const message = document.querySelector("#programaMessage");

  document
    .querySelector("#cancelPrograma")
    .addEventListener("click", closeModal);

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
      message.textContent = "El nombre del Programa es obligatorio.";
      return;
    }

    if (!editing) {
      payload.linea_accion_id = linea.id;
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      if (editing) {
        await updatePrograma(record, payload);
      } else {
        await createPrograma(payload);
      }

      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent =
        error.message || "No fue posible guardar el Programa.";

      submit.disabled = false;
      submit.textContent = editing
        ? "Guardar cambios"
        : "Crear Programa";
    }
  });
}

async function openDeleteProgramaDialog({ record, onChanged }) {
  let proyectos = 0;

  try {
    proyectos = await getProyectoCount(record.id);
  } catch (error) {
    console.error(error);

    openModal({
      title: "Eliminar Programa",
      content: `
        <div class="danger-callout">
          <strong>No se pudo verificar la estructura dependiente.</strong>
          <p>
            Por seguridad, la eliminación queda bloqueada hasta poder comprobar
            si existen Proyectos asociados.
          </p>
        </div>

        <div class="form-actions">
          <button id="closeProgramaDeleteError" class="btn btn-secondary" type="button">
            Cerrar
          </button>
        </div>
      `
    });

    document
      .querySelector("#closeProgramaDeleteError")
      .addEventListener("click", closeModal);

    return;
  }

  if (proyectos > 0) {
    openModal({
      title: "El Programa tiene Proyectos",
      content: `
        <div class="danger-callout">
          <strong>${escapeHTML(record.nombre)}</strong>
          <p>
            Este Programa contiene
            <strong>${proyectos} ${proyectos === 1 ? "Proyecto" : "Proyectos"}</strong>.
            No puede eliminarse físicamente porque forma parte de la estructura histórica.
          </p>
        </div>

        <p class="muted">
          Puedes marcarlo como <strong>Inactivo</strong> o <strong>Archivado</strong>.
          Sus Proyectos permanecerán intactos.
        </p>

        <p id="protectedProgramaMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelProtectedPrograma" class="btn btn-secondary" type="button">
            Cerrar
          </button>

          ${record.estado !== "inactivo"
            ? `<button id="inactivatePrograma" class="btn btn-secondary" type="button">Inactivar</button>`
            : ""}

          ${record.estado !== "archivado"
            ? `<button id="archivePrograma" class="btn btn-danger" type="button">Archivar</button>`
            : ""}
        </div>
      `
    });

    document
      .querySelector("#cancelProtectedPrograma")
      .addEventListener("click", closeModal);

    const inactivate = document.querySelector("#inactivatePrograma");
    const archive = document.querySelector("#archivePrograma");
    const message = document.querySelector("#protectedProgramaMessage");

    async function changeState(button, estado, label) {
      button.disabled = true;
      button.textContent = `${label}…`;

      try {
        await updatePrograma(record, { estado });
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
        changeState(inactivate, "inactivo", "Inactivar")
      );
    }

    if (archive) {
      archive.addEventListener("click", () =>
        changeState(archive, "archivado", "Archivar")
      );
    }

    return;
  }

  openModal({
    title: "Eliminar Programa",
    content: `
      <div class="danger-callout">
        <strong>${escapeHTML(record.nombre)}</strong>
        <p>
          Este Programa no contiene Proyectos, por lo que puede eliminarse
          definitivamente.
        </p>
      </div>

      <p class="muted">
        Esta acción no se puede deshacer.
      </p>

      <div class="form-field">
        <label for="deleteProgramaConfirmation">
          Escribe <strong>ELIMINAR</strong> para confirmar
        </label>

        <input
          id="deleteProgramaConfirmation"
          autocomplete="off"
          placeholder="ELIMINAR"
        >
      </div>

      <p id="deleteProgramaMessage" class="form-message"></p>

      <div class="form-actions">
        <button id="cancelDeletePrograma" class="btn btn-secondary" type="button">
          Cancelar
        </button>

        <button id="confirmDeletePrograma" class="btn btn-danger" type="button" disabled>
          Eliminar definitivamente
        </button>
      </div>
    `
  });

  const input = document.querySelector("#deleteProgramaConfirmation");
  const confirm = document.querySelector("#confirmDeletePrograma");
  const message = document.querySelector("#deleteProgramaMessage");

  document
    .querySelector("#cancelDeletePrograma")
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
      const currentProjects = await getProyectoCount(record.id);

      if (currentProjects > 0) {
        throw new Error(
          "El Programa ahora tiene Proyectos asociados y ya no puede eliminarse."
        );
      }

      await deletePrograma(record.id);
      closeModal();
      await onChanged();
    } catch (error) {
      console.error(error);

      message.textContent =
        error.message || "No fue posible eliminar el Programa.";

      confirm.disabled = false;
      confirm.textContent = "Eliminar definitivamente";
    }
  });
}

/* ==========================================================
   COPIAR / IMPORTAR
   ========================================================== */

async function copyProgramasToClipboard(programas) {
  if (!programas.length) {
    throw new Error("No hay Programas para copiar.");
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
    ...programas.map((programa) => [
      programa.nombre || "",
      programa.nombre_corto || "",
      programa.descripcion || "",
      programa.orden ?? 0,
      programa.estado || "activo"
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
    .filter((r) =>
      r.some((value) => String(value ?? "").trim())
    )
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
      const normalizedKey =
        normalizeText(key).replace(/\s+/g, "_");

      if (raw[normalizedKey] !== undefined) {
        return raw[normalizedKey];
      }
    }

    return "";
  }

  let estadoRaw = normalizeText(pick("estado"));

  if (estadoRaw === "activa") estadoRaw = "activo";
  if (estadoRaw === "inactiva") estadoRaw = "inactivo";
  if (estadoRaw === "archivada") estadoRaw = "archivado";

  return {
    nombre: String(
      pick("nombre", "programa") || ""
    ).trim(),

    nombre_corto: String(
      pick("nombre_corto", "corto", "sigla") || ""
    ).trim(),

    descripcion: String(
      pick("descripcion", "descripción", "detalle") || ""
    ).trim(),

    orden: Number(pick("orden") || 0),

    estado: ["activo", "inactivo", "archivado"].includes(estadoRaw)
      ? estadoRaw
      : "activo"
  };
}

function validateImportRows(rawRows, existingProgramas) {
  const existingNames = new Set(
    existingProgramas.map((item) =>
      normalizeText(item.nombre)
    )
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
        errors.push("El Programa ya existe en esta Línea");
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
        ${rows.filter((row) => row.valid).length} válidos
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

function openImportProgramas({
  vigencia,
  vigenciaConsejeria,
  linea,
  existingProgramas,
  onImported
}) {
  let validatedRows = [];

  openModal({
    title: "Importar Programas",
    content: `
      <div class="context-ribbon context-ribbon-three">
        <div>
          <span>Vigencia</span>
          <strong>${escapeHTML(vigencia.nombre)}</strong>
        </div>

        <div>
          <span>Consejería</span>
          <strong>${escapeHTML(vigenciaConsejeria.consejerias.nombre_corto)}</strong>
        </div>

        <div>
          <span>Línea destino</span>
          <strong>${escapeHTML(linea.nombre)}</strong>
        </div>
      </div>

      <div class="danger-callout soft-callout">
        <strong>La importación se realizará únicamente en esta Línea de Acción.</strong>
        <p>
          Si necesitas cargar Programas en otra Línea, cambia la selección antes
          de abrir este formulario.
        </p>
      </div>

      <div class="import-methods">
        <section class="import-method">
          <h3>Pegar desde una tabla</h3>

          <p class="muted">
            Copia filas desde Excel o Google Sheets y pégalas aquí.
          </p>

          <textarea
            id="pasteProgramas"
            class="import-textarea"
            placeholder="nombre&#9;nombre_corto&#9;descripcion&#9;orden&#9;estado"
          ></textarea>

          <button id="parseProgramasPaste" class="btn btn-secondary" type="button">
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
            id="programasImportFile"
            class="file-input"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          >

          <button id="parseProgramasFile" class="btn btn-secondary" type="button">
            Leer archivo
          </button>
        </section>
      </div>

      <section class="import-template">
        <strong>Encabezados recomendados</strong>
        <code>nombre | nombre_corto | descripcion | orden | estado</code>
      </section>

      <p id="programasImportMessage" class="form-message"></p>

      <div id="programasImportPreview">
        <div class="empty-state">
          Pega una tabla o selecciona un archivo para comenzar.
        </div>
      </div>

      <div class="form-actions sticky-actions">
        <button id="cancelProgramasImport" class="btn btn-secondary" type="button">
          Cancelar
        </button>

        <button id="confirmProgramasImport" class="btn btn-primary" type="button" disabled>
          Importar registros válidos
        </button>
      </div>
    `
  });

  const paste = document.querySelector("#pasteProgramas");
  const fileInput = document.querySelector("#programasImportFile");
  const preview = document.querySelector("#programasImportPreview");
  const message = document.querySelector("#programasImportMessage");
  const confirm = document.querySelector("#confirmProgramasImport");

  function setRows(rawRows) {
    validatedRows = validateImportRows(
      rawRows,
      existingProgramas
    );

    preview.innerHTML = importPreview(validatedRows);

    const validCount =
      validatedRows.filter((row) => row.valid).length;

    confirm.disabled = validCount === 0;

    confirm.textContent = validCount
      ? `Importar ${validCount} ${validCount === 1 ? "Programa" : "Programas"}`
      : "Importar registros válidos";
  }

  document
    .querySelector("#cancelProgramasImport")
    .addEventListener("click", closeModal);

  document
    .querySelector("#parseProgramasPaste")
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
    .querySelector("#parseProgramasFile")
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
      const supabase = requireSupabase();

      const payload = validRows.map((row) => ({
        linea_accion_id: linea.id,
        nombre: row.nombre,
        nombre_corto: row.nombre_corto || null,
        descripcion: row.descripcion || null,
        orden: row.orden,
        estado: row.estado
      }));

      const { data, error } = await supabase
        .from("programas")
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

export async function renderProgramas(container) {
  let vigencias = [];
  let consejerias = [];
  let lineas = [];
  let programas = [];

  let selectedVigenciaId = "";
  let selectedVigenciaConsejeriaId = "";
  let selectedLineaId = "";

  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Estructura programática</p>
        <h2>Programas</h2>
      </div>

      <div class="page-action-group">
        <button id="copyProgramasButton" class="btn btn-secondary" type="button" disabled>
          Copiar tabla
        </button>

        <button id="importProgramasButton" class="btn btn-secondary" type="button" disabled>
          Importar
        </button>

        <button id="newProgramaButton" class="btn btn-primary" type="button" disabled>
          + Nuevo Programa
        </button>
      </div>
    </div>

    <section class="panel strategic-selector-panel program-selector-panel" style="margin-top: 0">
      <div class="strategic-selector-intro">
        <p class="eyebrow">Ubicación de trabajo</p>
        <h2>Selecciona la Línea de Acción</h2>

        <p class="muted">
          Cada Programa pertenece a una Línea de Acción específica. Selecciona
          primero la Vigencia, luego la Consejería y finalmente la Línea.
        </p>
      </div>

      <div class="strategic-selector-grid program-selector-grid">
        <div class="form-field">
          <label for="programasVigenciaSelector">1. Vigencia</label>
          <select id="programasVigenciaSelector"></select>
        </div>

        <div class="form-field">
          <label for="programasConsejeriaSelector">2. Consejería</label>
          <select id="programasConsejeriaSelector" disabled>
            <option value="">Seleccione una Vigencia primero</option>
          </select>
        </div>

        <div class="form-field">
          <label for="programasLineaSelector">3. Línea de Acción</label>
          <select id="programasLineaSelector" disabled>
            <option value="">Seleccione una Consejería primero</option>
          </select>
        </div>
      </div>
    </section>

    <section id="selectedProgramaContext" class="selected-strategic-context program-context hidden"></section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Estructura de la Línea</p>
          <h2 id="programasPanelTitle">Programas</h2>
        </div>

        <span id="programasCount" class="status-chip">0</span>
      </div>

      <div id="programasContent" style="margin-top: 18px">
        <div class="empty-state">
          <strong>Selecciona una Línea de Acción.</strong>
          <p>Sus Programas aparecerán aquí.</p>
        </div>
      </div>
    </section>

    <div id="programasToast" class="app-toast hidden" role="status"></div>
  `;

  const vigenciaSelector =
    document.querySelector("#programasVigenciaSelector");

  const consejeriaSelector =
    document.querySelector("#programasConsejeriaSelector");

  const lineaSelector =
    document.querySelector("#programasLineaSelector");

  const newButton =
    document.querySelector("#newProgramaButton");

  const importButton =
    document.querySelector("#importProgramasButton");

  const copyButton =
    document.querySelector("#copyProgramasButton");

  const content =
    document.querySelector("#programasContent");

  const count =
    document.querySelector("#programasCount");

  const title =
    document.querySelector("#programasPanelTitle");

  const summary =
    document.querySelector("#selectedProgramaContext");

  const toast =
    document.querySelector("#programasToast");

  function showToast(text) {
    toast.textContent = text;
    toast.classList.remove("hidden");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(
      () => toast.classList.add("hidden"),
      3200
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

  function updateActions() {
    const hasContext = Boolean(
      selectedVigenciaId &&
      selectedVigenciaConsejeriaId &&
      selectedLineaId
    );

    newButton.disabled = !hasContext;
    importButton.disabled = !hasContext;
    copyButton.disabled =
      !hasContext || programas.length === 0;
  }

  function renderContextSummary() {
    const vc = currentConsejeria();
    const linea = currentLinea();

    if (!vc || !linea) {
      summary.classList.add("hidden");
      summary.innerHTML = "";
      title.textContent = "Programas";
      return;
    }

    const lineWeight =
      calculateLineWeight(lineas, linea.id);

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
        <small>
          ${linea.nombre_corto
            ? escapeHTML(linea.nombre_corto)
            : "Sin nombre corto"}
        </small>
      </div>

      <div>
        <span class="context-label">Peso de la Línea</span>
        <strong>${formatPercent(lineWeight)}</strong>
        <small>
          ${linea.estado === "activa"
            ? "Ponderación automática"
            : "Fuera del cálculo"}
        </small>
      </div>

      <div>
        <span class="context-label">Estado</span>
        ${linea.estado === "activa"
          ? `<span class="status-chip active">Activa</span>`
          : linea.estado === "archivada"
            ? `<span class="status-chip archived">Archivada</span>`
            : `<span class="status-chip closed">Inactiva</span>`
        }
      </div>
    `;

    title.textContent = `Programas · ${linea.nombre}`;
  }

  async function loadVigencias() {
    vigencias = await getVigencias();

    if (!selectedVigenciaId && vigencias.length) {
      selectedVigenciaId =
        vigencias.find(
          (item) => item.estado === "activa"
        )?.id ||
        vigencias[0].id;
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
    programas = [];
    lineas = [];

    count.textContent = "0";
    updateActions();
    renderContextSummary();

    lineaSelector.disabled = true;
    lineaSelector.innerHTML =
      `<option value="">Seleccione una Consejería primero</option>`;

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
        <p>Después podrás elegir una Línea de Acción.</p>
      </div>
    `;
  }

  async function loadLineas() {
    selectedLineaId = "";
    programas = [];

    count.textContent = "0";
    updateActions();
    renderContextSummary();

    if (!selectedVigenciaConsejeriaId) {
      lineaSelector.disabled = true;
      lineaSelector.innerHTML =
        `<option value="">Seleccione una Consejería primero</option>`;
      return;
    }

    lineas = await getLineas(
      selectedVigenciaConsejeriaId
    );

    if (!lineas.length) {
      lineaSelector.disabled = true;

      lineaSelector.innerHTML =
        `<option value="">Esta Consejería no tiene Líneas</option>`;

      content.innerHTML = `
        <div class="empty-state">
          <strong>Esta Consejería aún no tiene Líneas de Acción.</strong>
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
        <p>Sus Programas aparecerán aquí.</p>
      </div>
    `;
  }

  async function refreshProgramas() {
    renderContextSummary();

    const linea = currentLinea();

    if (!linea) {
      programas = [];
      count.textContent = "0";
      updateActions();

      content.innerHTML = `
        <div class="empty-state">
          <strong>Selecciona una Línea de Acción.</strong>
          <p>Sus Programas aparecerán aquí.</p>
        </div>
      `;

      return;
    }

    content.innerHTML =
      `<div class="empty-state">Cargando Programas…</div>`;

    programas = await getProgramas(linea.id);

    count.textContent = String(programas.length);
    updateActions();

    if (!programas.length) {
      content.innerHTML = `
        <div class="empty-state">
          <strong>Esta Línea aún no tiene Programas.</strong>
          <p>
            Usa <strong>+ Nuevo Programa</strong> para crear el primero o
            <strong>Importar</strong> para cargar varios.
          </p>
        </div>
      `;

      return;
    }

    const weights =
      calculateAutomaticWeights(programas);

    const projectCounts =
      await getProjectCounts(
        programas.map((programa) => programa.id)
      );

    const activePrograms =
      programas.filter(
        (programa) => programa.estado === "activo"
      );

    const automaticTotal =
      activePrograms.reduce(
        (sum, programa) =>
          sum + Number(weights.get(programa.id) || 0),
        0
      );

    content.innerHTML = `
      <div class="automatic-weight-summary">
        <div>
          <span class="context-label">Ponderación automática</span>

          <strong>
            ${activePrograms.length}
            ${activePrograms.length === 1 ? "Programa activo" : "Programas activos"}
          </strong>

          <small>
            Los Programas inactivos o archivados quedan fuera del cálculo.
          </small>
        </div>

        <div class="weight-total-block">
          <span>Total</span>
          <strong>${formatPercent(automaticTotal)}</strong>
        </div>
      </div>

      <div class="programas-grid">
        ${programas.map((programa) => {
          const weight =
            Number(weights.get(programa.id) || 0);

          const proyectos =
            Number(projectCounts.get(programa.id) || 0);

          const isActive =
            programa.estado === "activo";

          return `
            <article class="programa-card ${!isActive ? "is-inactive" : ""}">
              <div class="programa-card-header">
                <div>
                  <p class="eyebrow">
                    ${programa.nombre_corto
                      ? escapeHTML(programa.nombre_corto)
                      : `Programa ${Number(programa.orden || 0) + 1}`}
                  </p>

                  <h3>${escapeHTML(programa.nombre)}</h3>
                </div>

                ${statusChip(programa.estado)}
              </div>

              <p class="muted programa-card-description">
                ${escapeHTML(
                  programa.descripcion ||
                  "Sin descripción registrada."
                )}
              </p>

              <div class="linea-calculation-grid">
                <div class="calculation-item weight">
                  <span>Ponderación</span>
                  <strong>${formatPercent(weight)}</strong>
                  <small>
                    ${isActive ? "Automática" : "Fuera del cálculo"}
                  </small>
                </div>

                <div class="calculation-item">
                  <span>Proyectos</span>
                  <strong>${proyectos}</strong>
                  <small>
                    ${proyectos === 1
                      ? "Proyecto registrado"
                      : "Proyectos registrados"}
                  </small>
                </div>

                <div class="calculation-item">
                  <span>Cumplimiento</span>
                  <strong>—</strong>
                  <small>
                    ${proyectos
                      ? "Se calculará desde Proyectos"
                      : "Sin Proyectos"}
                  </small>
                </div>

                <div class="calculation-item">
                  <span>Contribución</span>
                  <strong>—</strong>
                  <small>
                    ${proyectos
                      ? "Pendiente de cálculo"
                      : "Sin Proyectos"}
                  </small>
                </div>
              </div>

              <div class="programa-card-meta">
                <span>
                  Orden
                  <strong>${Number(programa.orden || 0)}</strong>
                </span>

                <span>
                  Regla
                  <strong>${isActive ? "Automática" : "Excluido"}</strong>
                </span>
              </div>

              <div class="entity-actions">
                <button
                  class="btn btn-secondary edit-programa"
                  type="button"
                  data-id="${programa.id}"
                >
                  Editar
                </button>

                <button
                  class="icon-btn danger delete-programa"
                  type="button"
                  data-id="${programa.id}"
                  title="Eliminar Programa"
                  aria-label="Eliminar ${escapeHTML(programa.nombre)}"
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
          El 100 % se distribuye automáticamente entre los Programas activos
          de esta Línea de Acción. Si un Programa se inactiva o archiva, su
          ponderación pasa a 0 % y el sistema redistribuye el total entre los
          Programas activos restantes.
        </p>
      </div>
    `;

    content
      .querySelectorAll(".edit-programa")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const record =
            programas.find(
              (item) => item.id === button.dataset.id
            );

          openProgramaForm({
            vigencia: currentVigencia(),
            vigenciaConsejeria: currentConsejeria(),
            linea: currentLinea(),
            record,
            onSaved: refreshProgramas
          });
        });
      });

    content
      .querySelectorAll(".delete-programa")
      .forEach((button) => {
        button.addEventListener("click", async () => {
          const record =
            programas.find(
              (item) => item.id === button.dataset.id
            );

          await openDeleteProgramaDialog({
            record,

            onChanged: async () => {
              await refreshProgramas();
              showToast("Programa actualizado.");
            }
          });
        });
      });
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

      await refreshProgramas();
    }
  );

  newButton.addEventListener("click", () => {
    const vigencia = currentVigencia();
    const vc = currentConsejeria();
    const linea = currentLinea();

    if (!vigencia || !vc || !linea) return;

    if (vc.estado !== "activa") {
      showToast(
        "La Consejería está inactiva en esta Vigencia. Reactívala antes de crear Programas."
      );
      return;
    }

    if (linea.estado !== "activa") {
      showToast(
        "La Línea de Acción no está activa. Reactívala antes de crear Programas."
      );
      return;
    }

    openProgramaForm({
      vigencia,
      vigenciaConsejeria: vc,
      linea,

      onSaved: async () => {
        await refreshProgramas();
        showToast("Programa creado.");
      }
    });
  });

  importButton.addEventListener(
    "click",
    () => {
      const vigencia = currentVigencia();
      const vc = currentConsejeria();
      const linea = currentLinea();

      if (!vigencia || !vc || !linea) return;

      if (vc.estado !== "activa") {
        showToast(
          "La Consejería está inactiva en esta Vigencia. Reactívala antes de importar Programas."
        );
        return;
      }

      if (linea.estado !== "activa") {
        showToast(
          "La Línea de Acción no está activa. Reactívala antes de importar Programas."
        );
        return;
      }

      openImportProgramas({
        vigencia,
        vigenciaConsejeria: vc,
        linea,
        existingProgramas: programas,

        onImported: async (imported) => {
          await refreshProgramas();

          showToast(
            `${imported} ${imported === 1 ? "Programa importado" : "Programas importados"} en ${linea.nombre}.`
          );
        }
      });
    }
  );

  copyButton.addEventListener(
    "click",
    async () => {
      try {
        await copyProgramasToClipboard(programas);

        showToast(
          `${programas.length} ${programas.length === 1 ? "Programa copiado" : "Programas copiados"} al portapapeles.`
        );
      } catch (error) {
        console.error(error);

        showToast(
          error.message ||
          "No fue posible copiar los Programas."
        );
      }
    }
  );

  try {
    await loadVigencias();
  } catch (error) {
    console.error(error);

    content.innerHTML = `
      <div class="empty-state">
        <strong>No fue posible cargar Programas.</strong>

        <p>
          ${escapeHTML(
            error.message ||
            "No fue posible cargar los Programas. Intenta nuevamente."
          )}
        </p>
      </div>
    `;
  }
}
