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
  const active = estado === "activo";
  return `<span class="status-chip ${active ? "active" : "closed"}">${active ? "Activo" : estado === "archivado" ? "Archivado" : "Inactivo"}</span>`;
}

function splitConsejerias(value = "") {
  return String(value || "")
    .split(/[|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

async function getFuentes(vigenciaId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("fuentes_mandatos")
    .select("*")
    .eq("vigencia_id", vigenciaId)
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });

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
      consejerias (
        id,
        nombre_corto,
        nombre_largo,
        icono_url
      )
    `)
    .eq("vigencia_id", vigenciaId);

  if (error) throw error;
  return (data || []).filter((item) => item.consejerias);
}

async function getMandatos(vigenciaId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("mandatos")
    .select(`
      id,
      codigo,
      titulo,
      texto,
      observaciones,
      orden,
      estado,
      fuente_id,
      fuentes_mandatos (
        id,
        nombre
      ),
      mandato_consejerias (
        id,
        vigencia_consejeria_id,
        vigencia_consejerias (
          id,
          consejerias (
            id,
            nombre_corto,
            nombre_largo
          )
        )
      )
    `)
    .eq("vigencia_id", vigenciaId)
    .order("orden", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function createFuente(vigenciaId, nombre) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("fuentes_mandatos")
    .insert({
      vigencia_id: vigenciaId,
      nombre: nombre.trim()
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createMandato(payload, consejeriaLinkIds = []) {
  const supabase = requireSupabase();

  const { data: mandato, error } = await supabase
    .from("mandatos")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  if (consejeriaLinkIds.length) {
    const links = consejeriaLinkIds.map((vigenciaConsejeriaId) => ({
      mandato_id: mandato.id,
      vigencia_consejeria_id: vigenciaConsejeriaId
    }));

    const { error: linkError } = await supabase
      .from("mandato_consejerias")
      .insert(links);

    if (linkError) throw linkError;
  }

  return mandato;
}

async function updateMandato(record, payload, consejeriaLinkIds = []) {
  const supabase = requireSupabase();

  const data = await updateWithVersion({
    table: "mandatos",
    record,
    payload,
    entityType: "Mandato",
    entityName: record?.codigo || record?.titulo || null,
    vigenciaId: record?.vigencia_id || null
  });

  const { error: deleteLinksError } = await supabase
    .from("mandato_consejerias")
    .delete()
    .eq("mandato_id", record.id);

  if (deleteLinksError) throw deleteLinksError;

  if (consejeriaLinkIds.length) {
    const { error: insertLinksError } = await supabase
      .from("mandato_consejerias")
      .insert(
        consejeriaLinkIds.map((vigenciaConsejeriaId) => ({
          mandato_id: record.id,
          vigencia_consejeria_id: vigenciaConsejeriaId
        }))
      );

    if (insertLinksError) throw insertLinksError;
  }

  return data;
}


async function getMandatoCount(vigenciaId) {
  const supabase = requireSupabase();

  const { count, error } = await supabase
    .from("mandatos")
    .select("id", { count: "exact", head: true })
    .eq("vigencia_id", vigenciaId);

  if (error) throw error;
  return Number(count || 0);
}

async function getExistingMandatoIds(vigenciaId, ids = []) {
  if (!ids.length) return [];

  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("mandatos")
    .select("id")
    .eq("vigencia_id", vigenciaId)
    .in("id", ids);

  if (error) throw error;
  return (data || []).map((item) => item.id);
}


async function getMandatoProjectCount(mandatoId) {
  const supabase = requireSupabase();

  const { count, error } = await supabase
    .from("proyecto_mandatos")
    .select("id", { count: "exact", head: true })
    .eq("mandato_id", mandatoId);

  if (error) throw error;

  return Number(count || 0);
}

async function getProtectedMandatoIds(ids = []) {
  if (!ids.length) return [];

  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("proyecto_mandatos")
    .select("mandato_id")
    .in("mandato_id", ids);

  if (error) throw error;

  return [
    ...new Set(
      (data || [])
        .map((item) => item.mandato_id)
        .filter(Boolean)
    )
  ];
}

async function deleteMandato(id) {
  const supabase = requireSupabase();

  const { error } = await supabase
    .from("mandatos")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

async function deleteMandatosByIds(vigenciaId, ids = []) {
  if (!ids.length) return;

  const existingIds = await getExistingMandatoIds(vigenciaId, ids);

  if (existingIds.length !== ids.length) {
    throw new Error(
      "La selección cambió mientras confirmabas la operación. Actualiza la tabla e inténtalo nuevamente."
    );
  }

  const protectedIds = await getProtectedMandatoIds(ids);

  if (protectedIds.length) {
    throw new Error(
      `${protectedIds.length} ${protectedIds.length === 1 ? "mandato está vinculado" : "mandatos están vinculados"} a Proyectos y no pueden eliminarse. Archívalos para conservar la trazabilidad.`
    );
  }

  const supabase = requireSupabase();

  const { error } = await supabase
    .from("mandatos")
    .delete()
    .eq("vigencia_id", vigenciaId)
    .in("id", ids);

  if (error) throw error;
}

async function deleteAllMandatos(vigenciaId, expectedCount) {
  const currentCount = await getMandatoCount(vigenciaId);

  if (currentCount !== expectedCount) {
    throw new Error(
      `La cantidad de mandatos cambió de ${expectedCount} a ${currentCount}. Cierra esta ventana y vuelve a confirmar la operación.`
    );
  }

  const supabase = requireSupabase();

  const { data: idsData, error: idsError } = await supabase
    .from("mandatos")
    .select("id")
    .eq("vigencia_id", vigenciaId);

  if (idsError) throw idsError;

  const ids = (idsData || []).map((item) => item.id);
  const protectedIds = await getProtectedMandatoIds(ids);

  if (protectedIds.length) {
    throw new Error(
      `${protectedIds.length} ${protectedIds.length === 1 ? "mandato está vinculado" : "mandatos están vinculados"} a Proyectos. No se eliminó ningún mandato.`
    );
  }

  const { error } = await supabase
    .from("mandatos")
    .delete()
    .eq("vigencia_id", vigenciaId);

  if (error) throw error;
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

async function openDeleteMandatoDialog({ record, onDeleted }) {
  let projectCount = 0;

  try {
    projectCount = await getMandatoProjectCount(record.id);
  } catch (error) {
    console.error(error);

    openModal({
      title: "Eliminar mandato",
      content: `
        <div class="danger-callout">
          <strong>No se pudo verificar el uso del Mandato.</strong>

          <p>
            Por seguridad, la eliminación queda bloqueada hasta poder
            comprobar si está relacionado con algún Proyecto.
          </p>
        </div>

        <div class="form-actions">
          <button id="closeMandatoProtectionError" class="btn btn-secondary" type="button">
            Cerrar
          </button>
        </div>
      `
    });

    document
      .querySelector("#closeMandatoProtectionError")
      .addEventListener("click", closeModal);

    return;
  }

  if (projectCount > 0) {
    openModal({
      title: "Mandato vinculado a Proyectos",
      content: `
        <div class="danger-callout">
          <strong>${escapeHTML(record.codigo || record.titulo || "Mandato")}</strong>

          <p>
            Este Mandato está relacionado con
            <strong>${projectCount} ${projectCount === 1 ? "Proyecto" : "Proyectos"}</strong>.
            No puede eliminarse físicamente porque forma parte de la trazabilidad
            del Plan Estratégico.
          </p>
        </div>

        <p class="muted">
          Puedes archivarlo. Los Proyectos conservarán su relación histórica.
        </p>

        <p id="protectedMandatoMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelProtectedMandato" class="btn btn-secondary" type="button">
            Cerrar
          </button>

          ${record.estado !== "archivado"
            ? `<button id="archiveProtectedMandato" class="btn btn-danger" type="button">Archivar mandato</button>`
            : ""}
        </div>
      `
    });

    document
      .querySelector("#cancelProtectedMandato")
      .addEventListener("click", closeModal);

    const archive =
      document.querySelector("#archiveProtectedMandato");

    if (archive) {
      archive.addEventListener("click", async () => {
        const message =
          document.querySelector("#protectedMandatoMessage");

        archive.disabled = true;
        archive.textContent = "Archivando…";

        try {
          await updateMandato(record, { estado: "archivado" },
            (record.mandato_consejerias || []).map((item) => item.vigencia_consejeria_id).filter(Boolean)
          );

          closeModal();
          await onDeleted();
        } catch (error) {
          console.error(error);

          message.textContent =
            error.message || "No fue posible archivar el Mandato.";

          archive.disabled = false;
          archive.textContent = "Archivar mandato";
        }
      });
    }

    return;
  }

  openModal({
    title: "Eliminar mandato",
    content: `
      <div class="danger-callout">
        <strong>Eliminar ${escapeHTML(record.codigo || "este mandato")}</strong>
        <p>
          Esta acción eliminará permanentemente el mandato y sus vínculos con las Consejerías.
          No se eliminarán las Consejerías ni las fuentes de mandato.
        </p>
      </div>

      <div class="delete-record-preview">
        ${record.titulo ? `<strong>${escapeHTML(record.titulo)}</strong>` : ""}
        <p>${escapeHTML(record.texto)}</p>
      </div>

      <p class="muted">
        Esta acción no se puede deshacer.
      </p>

      <p id="deleteMandatoMessage" class="form-message"></p>

      <div class="form-actions">
        <button id="cancelDeleteMandato" class="btn btn-secondary" type="button">
          Cancelar
        </button>
        <button id="confirmDeleteMandato" class="btn btn-danger" type="button">
          Eliminar mandato
        </button>
      </div>
    `
  });

  document.querySelector("#cancelDeleteMandato").addEventListener("click", closeModal);

  document.querySelector("#confirmDeleteMandato").addEventListener("click", async () => {
    const button = document.querySelector("#confirmDeleteMandato");
    const message = document.querySelector("#deleteMandatoMessage");

    button.disabled = true;
    button.textContent = "Eliminando…";
    message.textContent = "";

    try {
      const currentProjectCount =
        await getMandatoProjectCount(record.id);

      if (currentProjectCount > 0) {
        throw new Error(
          "El Mandato ahora está vinculado a un Proyecto y ya no puede eliminarse."
        );
      }

      await deleteMandato(record.id);
      closeModal();
      await onDeleted();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible eliminar el mandato.";
      button.disabled = false;
      button.textContent = "Eliminar mandato";
    }
  });
}


function openBulkDeleteDialog({
  mode,
  vigencia,
  ids = [],
  count,
  onDeleted
}) {
  const deletingAll = mode === "all";
  const confirmationText = `ELIMINAR ${count} ${count === 1 ? "MANDATO" : "MANDATOS"}`;

  openModal({
    title: deletingAll ? "Eliminar todos los mandatos" : "Eliminar mandatos seleccionados",
    content: `
      <div class="danger-callout">
        <strong>
          ${deletingAll
            ? `Eliminar todos los mandatos de ${escapeHTML(vigencia.nombre)}`
            : `Eliminar ${count} ${count === 1 ? "mandato seleccionado" : "mandatos seleccionados"}`
          }
        </strong>

        <p>
          ${deletingAll
            ? `Se eliminarán permanentemente los ${count} mandatos actualmente registrados en esta vigencia.`
            : `Se eliminarán permanentemente ${count} ${count === 1 ? "mandato" : "mandatos"} de esta vigencia.`
          }
          También se eliminarán sus vínculos con Consejerías.
        </p>
      </div>

      <p class="muted">
        Las Consejerías y las fuentes de mandato <strong>no</strong> serán eliminadas.
        Esta acción no se puede deshacer.
      </p>

      <div class="form-field">
        <label for="bulkDeleteConfirmation">
          Escribe <strong>${escapeHTML(confirmationText)}</strong> para confirmar
        </label>
        <input
          id="bulkDeleteConfirmation"
          autocomplete="off"
          placeholder="${escapeHTML(confirmationText)}"
        >
      </div>

      <p id="bulkDeleteMessage" class="form-message"></p>

      <div class="form-actions">
        <button id="cancelBulkDelete" class="btn btn-secondary" type="button">
          Cancelar
        </button>
        <button id="confirmBulkDelete" class="btn btn-danger" type="button" disabled>
          ${deletingAll ? "Eliminar todos" : "Eliminar seleccionados"}
        </button>
      </div>
    `
  });

  const input = document.querySelector("#bulkDeleteConfirmation");
  const confirm = document.querySelector("#confirmBulkDelete");
  const message = document.querySelector("#bulkDeleteMessage");

  document.querySelector("#cancelBulkDelete").addEventListener("click", closeModal);

  input.addEventListener("input", () => {
    confirm.disabled = input.value.trim().toUpperCase() !== confirmationText;
  });

  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    confirm.textContent = "Eliminando…";
    message.textContent = "";

    try {
      if (deletingAll) {
        await deleteAllMandatos(vigencia.id, count);
      } else {
        await deleteMandatosByIds(vigencia.id, ids);
      }

      closeModal();
      await onDeleted(count);
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible completar la eliminación.";
      confirm.disabled = false;
      confirm.textContent = deletingAll ? "Eliminar todos" : "Eliminar seleccionados";
    }
  });
}


function getMandatoConsejeriaIds(record) {
  return (record?.mandato_consejerias || [])
    .map((link) => link.vigencia_consejeria_id)
    .filter(Boolean);
}

function consejeriaChecks(consejerias, selectedIds = []) {
  if (!consejerias.length) {
    return `<p class="muted">No hay consejerías vinculadas a esta vigencia.</p>`;
  }

  const selected = new Set(selectedIds);

  return `
    <div class="check-grid">
      ${consejerias.map((item) => `
        <label class="check-card">
          <input
            type="checkbox"
            name="consejerias"
            value="${item.id}"
            ${selected.has(item.id) ? "checked" : ""}
          >
          <span>
            <strong>${escapeHTML(item.consejerias.nombre_corto)}</strong>
            <small>${escapeHTML(item.consejerias.nombre_largo)}</small>
          </span>
        </label>
      `).join("")}
    </div>
  `;
}

function openFuenteForm({ vigencia, onSaved }) {
  openModal({
    title: "Nueva fuente de mandatos",
    content: `
      <p class="notice">
        Vigencia: <strong>${escapeHTML(vigencia.nombre)}</strong>
      </p>

      <form id="fuenteForm">
        <div class="form-field">
          <label for="fuenteNombre">Nombre de la fuente</label>
          <input
            id="fuenteNombre"
            name="nombre"
            required
            placeholder="Ej. XI Congreso Nacional, Estatutos ONIC..."
          >
        </div>

        <p id="fuenteMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelFuente" class="btn btn-secondary" type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">Crear fuente</button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#fuenteForm");
  const message = document.querySelector("#fuenteMessage");

  document.querySelector("#cancelFuente").addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nombre = form.nombre.value.trim();
    if (!nombre) return;

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Guardando…";

    try {
      await createFuente(vigencia.id, nombre);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible crear la fuente.";
      button.disabled = false;
      button.textContent = "Crear fuente";
    }
  });
}

function openMandatoForm({ vigencia, fuentes, consejerias, record = null, onSaved }) {
  const editing = Boolean(record);
  const selectedConsejerias = getMandatoConsejeriaIds(record);

  openModal({
    title: editing ? "Editar mandato" : "Nuevo mandato",
    content: `
      <p class="notice">
        Los códigos visibles de los mandatos son definidos por los usuarios.
        El mandato quedará asociado a <strong>${escapeHTML(vigencia.nombre)}</strong>.
      </p>

      <form id="mandatoForm">
        <div class="form-grid">
          <div class="form-field">
            <label for="mandatoCodigo">Código / indicador</label>
            <input
              id="mandatoCodigo"
              name="codigo"
              value="${escapeHTML(record?.codigo || "")}"
              placeholder="Ej. M-01"
            >
          </div>

          <div class="form-field">
            <label for="mandatoFuente">Fuente</label>
            <select id="mandatoFuente" name="fuente_id">
              <option value="">Sin fuente especificada</option>
              ${fuentes.map((f) => option(f.id, f.nombre, record?.fuente_id === f.id)).join("")}
            </select>
          </div>

          <div class="form-field full">
            <label for="mandatoTitulo">Título</label>
            <input
              id="mandatoTitulo"
              name="titulo"
              value="${escapeHTML(record?.titulo || "")}"
              placeholder="Título breve opcional"
            >
          </div>

          <div class="form-field full">
            <label for="mandatoTexto">Texto del mandato</label>
            <textarea id="mandatoTexto" name="texto" required>${escapeHTML(record?.texto || "")}</textarea>
          </div>

          <div class="form-field full">
            <label>Consejerías responsables / vinculadas</label>
            ${consejeriaChecks(consejerias, selectedConsejerias)}
          </div>

          <div class="form-field full">
            <label for="mandatoObservaciones">Observaciones</label>
            <textarea id="mandatoObservaciones" name="observaciones">${escapeHTML(record?.observaciones || "")}</textarea>
          </div>

          <div class="form-field">
            <label for="mandatoOrden">Orden</label>
            <input
              id="mandatoOrden"
              name="orden"
              type="number"
              min="0"
              step="1"
              value="${Number(record?.orden ?? 0)}"
            >
          </div>

          <div class="form-field">
            <label for="mandatoEstado">Estado</label>
            <select id="mandatoEstado" name="estado">
              ${option("activo", "Activo", (record?.estado || "activo") === "activo")}
              ${option("inactivo", "Inactivo", record?.estado === "inactivo")}
              ${option("archivado", "Archivado", record?.estado === "archivado")}
            </select>
          </div>
        </div>

        <p id="mandatoMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelMandato" class="btn btn-secondary" type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">${editing ? "Guardar cambios" : "Crear mandato"}</button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#mandatoForm");
  const message = document.querySelector("#mandatoMessage");

  document.querySelector("#cancelMandato").addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      vigencia_id: vigencia.id,
      fuente_id: formData.get("fuente_id") || null,
      codigo: formData.get("codigo")?.trim() || null,
      titulo: formData.get("titulo")?.trim() || null,
      texto: formData.get("texto")?.trim(),
      observaciones: formData.get("observaciones")?.trim() || null,
      orden: Number(formData.get("orden") || 0),
      estado: formData.get("estado")
    };

    if (!payload.texto) {
      message.textContent = "El texto del mandato es obligatorio.";
      return;
    }

    const selected = [...form.querySelectorAll('input[name="consejerias"]:checked')]
      .map((input) => input.value);

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Guardando…";

    try {
      if (editing) {
        delete payload.vigencia_id;
        await updateMandato(record, payload, selected);
      } else {
        await createMandato(payload, selected);
      }

      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible guardar el mandato.";
      button.disabled = false;
      button.textContent = editing ? "Guardar cambios" : "Crear mandato";
    }
  });
}

/* ==========================================================
   IMPORTACIÓN MASIVA
   ========================================================== */

function detectDelimiter(line = "") {
  const candidates = ["\t", ";", ","];
  let best = "\t";
  let max = -1;

  for (const delimiter of candidates) {
    const count = (line.match(new RegExp(
      delimiter === "\t" ? "\\t" : `\\${delimiter}`,
      "g"
    )) || []).length;

    if (count > max) {
      max = count;
      best = delimiter;
    }
  }

  return best;
}

function parseDelimitedText(text = "") {
  const source = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!source) return [];

  const firstLine = source.split("\n")[0] || "";
  const delimiter = detectDelimiter(firstLine);

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

  if (!rows.length) return [];

  const headers = rows[0].map((h) => normalizeText(h).replace(/\s+/g, "_"));

  return rows
    .slice(1)
    .filter((r) => r.some((v) => String(v || "").trim()))
    .map((r) => {
      const obj = {};
      headers.forEach((h, index) => {
        obj[h] = String(r[index] ?? "").trim();
      });
      return obj;
    });
}

function normalizeImportRow(raw) {
  const aliases = {
    codigo: ["codigo", "código", "indicador", "codigo_indicador"],
    titulo: ["titulo", "título", "nombre"],
    texto: ["texto", "mandato", "texto_del_mandato", "descripcion", "descripción"],
    fuente: ["fuente", "origen", "fuente_mandato"],
    consejerias: ["consejerias", "consejerías", "consejeria", "consejería", "responsables"],
    observaciones: ["observaciones", "observacion", "observación", "notas"],
    orden: ["orden"],
    estado: ["estado"]
  };

  function pick(keys) {
    for (const key of keys) {
      const normalizedKey = normalizeText(key).replace(/\s+/g, "_");
      if (raw[normalizedKey] !== undefined) return raw[normalizedKey];
    }
    return "";
  }

  return {
    codigo: String(pick(aliases.codigo) || "").trim(),
    titulo: String(pick(aliases.titulo) || "").trim(),
    texto: String(pick(aliases.texto) || "").trim(),
    fuente: String(pick(aliases.fuente) || "").trim(),
    consejerias: String(pick(aliases.consejerias) || "").trim(),
    observaciones: String(pick(aliases.observaciones) || "").trim(),
    orden: Number(pick(aliases.orden) || 0),
    estado: ["activo", "inactivo", "archivado"].includes(normalizeText(pick(aliases.estado)))
      ? normalizeText(pick(aliases.estado))
      : "activo"
  };
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
  const data = window.XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false
  });

  return data.map((row) => {
    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeText(key).replace(/\s+/g, "_")] = String(value ?? "").trim();
    });
    return normalized;
  });
}

function buildConsejeriaLookup(consejerias) {
  const map = new Map();

  consejerias.forEach((item) => {
    const c = item.consejerias;
    [
      c?.nombre_corto,
      c?.nombre_largo
    ].filter(Boolean).forEach((name) => {
      map.set(normalizeText(name), item.id);
    });
  });

  return map;
}

function validateImportRows(rows, existingMandatos, consejerias) {
  const existingCodes = new Set(
    existingMandatos
      .map((m) => normalizeText(m.codigo))
      .filter(Boolean)
  );

  const incomingCodes = new Set();
  const consejeriaLookup = buildConsejeriaLookup(consejerias);

  return rows.map((row, index) => {
    const normalized = normalizeImportRow(row);
    const errors = [];
    const warnings = [];

    if (!normalized.texto) {
      errors.push("Falta el texto del mandato");
    }

    const codeKey = normalizeText(normalized.codigo);

    if (codeKey) {
      if (existingCodes.has(codeKey)) {
        errors.push("El código ya existe en esta vigencia");
      } else if (incomingCodes.has(codeKey)) {
        errors.push("Código repetido dentro de la importación");
      } else {
        incomingCodes.add(codeKey);
      }
    }

    const requestedConsejerias = splitConsejerias(normalized.consejerias);
    const matchedIds = [];
    const unmatchedNames = [];

    requestedConsejerias.forEach((name) => {
      const id = consejeriaLookup.get(normalizeText(name));
      if (id) {
        matchedIds.push(id);
      } else {
        unmatchedNames.push(name);
      }
    });

    if (unmatchedNames.length) {
      warnings.push(`Consejerías no encontradas: ${unmatchedNames.join(", ")}`);
    }

    return {
      index: index + 1,
      ...normalized,
      consejeriaLinkIds: [...new Set(matchedIds)],
      errors,
      warnings,
      valid: errors.length === 0
    };
  });
}

async function importValidatedRows({
  vigenciaId,
  rows,
  fuentesActuales
}) {
  const supabase = requireSupabase();

  const validRows = rows.filter((row) => row.valid);
  if (!validRows.length) {
    return { imported: 0, linked: 0, sourcesCreated: 0 };
  }

  // Mapa de fuentes existentes, sin distinguir mayúsculas/acentos.
  const sourceMap = new Map();
  fuentesActuales.forEach((f) => {
    sourceMap.set(normalizeText(f.nombre), f);
  });

  const uniqueSourceNames = [
    ...new Set(
      validRows
        .map((row) => row.fuente.trim())
        .filter(Boolean)
    )
  ];

  let sourcesCreated = 0;

  for (const sourceName of uniqueSourceNames) {
    const key = normalizeText(sourceName);
    if (!sourceMap.has(key)) {
      const created = await createFuente(vigenciaId, sourceName);
      sourceMap.set(key, created);
      sourcesCreated++;
    }
  }

  const payloads = validRows.map((row) => ({
    vigencia_id: vigenciaId,
    fuente_id: row.fuente ? sourceMap.get(normalizeText(row.fuente))?.id || null : null,
    codigo: row.codigo || null,
    titulo: row.titulo || null,
    texto: row.texto,
    observaciones: row.observaciones || null,
    orden: Number.isFinite(row.orden) ? row.orden : 0,
    estado: row.estado
  }));

  const { data: inserted, error } = await supabase
    .from("mandatos")
    .insert(payloads)
    .select("id");

  if (error) throw error;

  const linkPayloads = [];

  (inserted || []).forEach((mandato, index) => {
    const sourceRow = validRows[index];
    if (!sourceRow) return;

    sourceRow.consejeriaLinkIds.forEach((vcId) => {
      linkPayloads.push({
        mandato_id: mandato.id,
        vigencia_consejeria_id: vcId
      });
    });
  });

  if (linkPayloads.length) {
    const { error: linkError } = await supabase
      .from("mandato_consejerias")
      .insert(linkPayloads);

    if (linkError) throw linkError;
  }

  return {
    imported: inserted?.length || 0,
    linked: linkPayloads.length,
    sourcesCreated
  };
}

function importPreviewTable(rows) {
  if (!rows.length) {
    return `<div class="empty-state">Aún no hay datos para previsualizar.</div>`;
  }

  return `
    <div class="import-summary">
      <span class="status-chip active">${rows.filter((r) => r.valid).length} válidos</span>
      <span class="status-chip">${rows.filter((r) => !r.valid).length} con error</span>
      <span class="status-chip">${rows.filter((r) => r.warnings.length).length} con advertencia</span>
    </div>

    <div class="table-wrap import-preview-wrap">
      <table class="data-table compact-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Código</th>
            <th>Mandato</th>
            <th>Fuente</th>
            <th>Consejerías</th>
            <th>Validación</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr class="${row.valid ? "" : "row-error"}">
              <td>${row.index}</td>
              <td>${escapeHTML(row.codigo || "—")}</td>
              <td class="preview-text">${escapeHTML(row.texto || "—")}</td>
              <td>${escapeHTML(row.fuente || "—")}</td>
              <td>${escapeHTML(row.consejerias || "—")}</td>
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

function openBulkImport({
  vigencia,
  fuentes,
  consejerias,
  mandatos,
  onImported
}) {
  let validatedRows = [];

  openModal({
    title: "Importar mandatos",
    content: `
      <p class="notice">
        Los datos se importarán en la vigencia
        <strong>${escapeHTML(vigencia.nombre)}</strong>.
        Antes de guardar podrás revisar los registros y sus advertencias.
      </p>

      <div class="import-methods">
        <section class="import-method">
          <h3>Pegar desde una tabla</h3>
          <p class="muted">
            Puedes copiar filas desde Excel, Google Sheets u otra tabla y pegarlas aquí.
          </p>

          <textarea
            id="pasteImport"
            class="import-textarea"
            placeholder="codigo&#9;titulo&#9;texto&#9;fuente&#9;consejerias&#10;M-01&#9;Territorio&#9;Texto del mandato...&#9;XI Congreso&#9;Territorio | Secretaría General"
          ></textarea>

          <button id="parsePaste" class="btn btn-secondary" type="button">
            Previsualizar datos pegados
          </button>
        </section>

        <div class="import-divider"><span>o</span></div>

        <section class="import-method">
          <h3>Importar archivo</h3>
          <p class="muted">
            Formatos admitidos: CSV, XLSX y XLS.
          </p>

          <input
            id="importFile"
            class="file-input"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          >

          <button id="parseFile" class="btn btn-secondary" type="button">
            Leer archivo
          </button>
        </section>
      </div>

      <section class="import-template">
        <strong>Encabezados recomendados</strong>
        <code>codigo | titulo | texto | fuente | consejerias | observaciones | orden | estado</code>
        <p>
          Para varias consejerías en una misma celda usa <strong>|</strong> o <strong>;</strong>.
          Se pueden usar nombres cortos o nombres largos.
        </p>
      </section>

      <p id="importMessage" class="form-message"></p>

      <div id="importPreview">
        <div class="empty-state">Pega una tabla o selecciona un archivo para comenzar.</div>
      </div>

      <div class="form-actions sticky-actions">
        <button id="cancelImport" class="btn btn-secondary" type="button">Cancelar</button>
        <button id="confirmImport" class="btn btn-primary" type="button" disabled>
          Importar registros válidos
        </button>
      </div>
    `
  });

  const paste = document.querySelector("#pasteImport");
  const fileInput = document.querySelector("#importFile");
  const preview = document.querySelector("#importPreview");
  const message = document.querySelector("#importMessage");
  const confirm = document.querySelector("#confirmImport");

  function setRows(rawRows) {
    validatedRows = validateImportRows(rawRows, mandatos, consejerias);
    preview.innerHTML = importPreviewTable(validatedRows);

    const validCount = validatedRows.filter((row) => row.valid).length;
    confirm.disabled = validCount === 0;
    confirm.textContent = validCount
      ? `Importar ${validCount} ${validCount === 1 ? "mandato" : "mandatos"}`
      : "Importar registros válidos";
  }

  document.querySelector("#cancelImport").addEventListener("click", closeModal);

  document.querySelector("#parsePaste").addEventListener("click", () => {
    message.textContent = "";

    try {
      const rawRows = parseDelimitedText(paste.value);
      if (!rawRows.length) {
        message.textContent = "No se detectaron filas para importar.";
        return;
      }
      setRows(rawRows);
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible interpretar los datos pegados.";
    }
  });

  document.querySelector("#parseFile").addEventListener("click", async () => {
    message.textContent = "";
    const file = fileInput.files?.[0];

    if (!file) {
      message.textContent = "Selecciona primero un archivo.";
      return;
    }

    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      let rawRows = [];

      if (extension === "csv") {
        rawRows = parseDelimitedText(await file.text());
      } else {
        rawRows = await readSpreadsheetFile(file);
      }

      if (!rawRows.length) {
        message.textContent = "El archivo no contiene filas utilizables.";
        return;
      }

      setRows(rawRows);
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible leer el archivo.";
    }
  });

  confirm.addEventListener("click", async () => {
    const validCount = validatedRows.filter((row) => row.valid).length;
    if (!validCount) return;

    confirm.disabled = true;
    confirm.textContent = "Importando…";
    message.textContent = "";

    try {
      const result = await importValidatedRows({
        vigenciaId: vigencia.id,
        rows: validatedRows,
        fuentesActuales: fuentes
      });

      closeModal();
      await onImported(result);
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "La importación no pudo completarse.";
      confirm.disabled = false;
      confirm.textContent = `Importar ${validCount} ${validCount === 1 ? "mandato" : "mandatos"}`;
    }
  });
}

/* ==========================================================
   PORTAPAPELES
   ========================================================== */

function mandatoConsejeriaNames(record) {
  return (record.mandato_consejerias || [])
    .map((link) => link.vigencia_consejerias?.consejerias?.nombre_corto)
    .filter(Boolean);
}

async function copyMandatosToClipboard(rows) {
  if (!rows.length) {
    throw new Error("No hay mandatos para copiar.");
  }

  const headers = [
    "codigo",
    "titulo",
    "texto",
    "fuente",
    "consejerias",
    "observaciones",
    "orden",
    "estado"
  ];

  const lines = [
    headers.join("\t"),
    ...rows.map((row) => [
      row.codigo || "",
      row.titulo || "",
      row.texto || "",
      row.fuentes_mandatos?.nombre || "",
      mandatoConsejeriaNames(row).join(" | "),
      row.observaciones || "",
      row.orden ?? 0,
      row.estado || "activo"
    ].map((value) => String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"))
  ];

  const text = lines.join("\n");

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}


export async function renderMandatos(container) {
  let vigencias = [];
  let selectedVigenciaId = "";
  let fuentes = [];
  let consejerias = [];
  let mandatos = [];
  let selectedMandatoIds = new Set();

  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Orientaciones políticas</p>
        <h2>Mandatos</h2>
      </div>

      <div class="page-action-group">
        <button id="copyMandatosButton" class="btn btn-secondary" type="button">
          Copiar tabla
        </button>
        <button id="importMandatosButton" class="btn btn-secondary" type="button">
          Importar
        </button>

        <div class="actions-menu-wrap">
          <button
            id="moreMandatosButton"
            class="btn btn-secondary"
            type="button"
            aria-haspopup="true"
            aria-expanded="false"
          >
            Más acciones ▾
          </button>

          <div id="mandatosActionsMenu" class="actions-menu hidden">
            <button id="deleteAllMandatosButton" class="actions-menu-danger" type="button">
              ${trashIcon()}
              <span>Eliminar todos los mandatos</span>
            </button>
          </div>
        </div>

        <button id="newMandatoButton" class="btn btn-primary" type="button">
          + Nuevo mandato
        </button>
      </div>
    </div>

    <section class="panel" style="margin-top: 0">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Vigencia de trabajo</p>
          <h2>Mandatos de la vigencia</h2>
        </div>

        <div class="inline-control">
          <select id="mandatosVigenciaSelector" aria-label="Seleccionar vigencia"></select>
          <button id="newFuenteButton" class="btn btn-secondary" type="button">
            + Fuente
          </button>
        </div>
      </div>

      <div class="mandatos-stats">
        <div>
          <span>Mandatos</span>
          <strong id="mandatoCount">0</strong>
        </div>
        <div>
          <span>Fuentes</span>
          <strong id="fuenteCount">0</strong>
        </div>
        <div>
          <span>Consejerías vinculadas</span>
          <strong id="consejeriaCount">0</strong>
        </div>
      </div>

      <div id="selectionToolbar" class="selection-toolbar hidden">
        <div>
          <strong id="selectionCount">0 seleccionados</strong>
          <button id="clearSelectionButton" class="text-button" type="button">
            Limpiar selección
          </button>
        </div>

        <button id="deleteSelectedButton" class="btn btn-danger" type="button">
          ${trashIcon()}
          Eliminar seleccionados
        </button>
      </div>

      <div id="mandatosContent" style="margin-top: 18px">
        <div class="empty-state">Cargando…</div>
      </div>
    </section>

    <div id="mandatosToast" class="app-toast hidden" role="status"></div>
  `;

  const selector = document.querySelector("#mandatosVigenciaSelector");
  const content = document.querySelector("#mandatosContent");
  const mandatoCount = document.querySelector("#mandatoCount");
  const fuenteCount = document.querySelector("#fuenteCount");
  const consejeriaCount = document.querySelector("#consejeriaCount");
  const toast = document.querySelector("#mandatosToast");

  const newMandatoButton = document.querySelector("#newMandatoButton");
  const newFuenteButton = document.querySelector("#newFuenteButton");
  const importButton = document.querySelector("#importMandatosButton");
  const copyButton = document.querySelector("#copyMandatosButton");
  const moreButton = document.querySelector("#moreMandatosButton");
  const actionsMenu = document.querySelector("#mandatosActionsMenu");
  const deleteAllButton = document.querySelector("#deleteAllMandatosButton");

  const selectionToolbar = document.querySelector("#selectionToolbar");
  const selectionCount = document.querySelector("#selectionCount");
  const clearSelectionButton = document.querySelector("#clearSelectionButton");
  const deleteSelectedButton = document.querySelector("#deleteSelectedButton");

  function showToast(text) {
    toast.textContent = text;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3200);
  }

  function currentVigencia() {
    return vigencias.find((v) => v.id === selectedVigenciaId);
  }

  function closeActionsMenu() {
    actionsMenu.classList.add("hidden");
    moreButton.setAttribute("aria-expanded", "false");
  }

  function updateSelectionToolbar() {
    const count = selectedMandatoIds.size;

    selectionCount.textContent = `${count} ${count === 1 ? "seleccionado" : "seleccionados"}`;
    selectionToolbar.classList.toggle("hidden", count === 0);
    deleteSelectedButton.disabled = count === 0;

    const master = content.querySelector("#selectAllMandatos");
    if (master) {
      const selectableIds = mandatos.map((m) => m.id);
      const selectedVisible = selectableIds.filter((id) => selectedMandatoIds.has(id)).length;

      master.checked = selectableIds.length > 0 && selectedVisible === selectableIds.length;
      master.indeterminate = selectedVisible > 0 && selectedVisible < selectableIds.length;
    }
  }

  function clearSelection() {
    selectedMandatoIds.clear();

    content.querySelectorAll(".mandato-select").forEach((input) => {
      input.checked = false;
    });

    updateSelectionToolbar();
  }

  async function loadVigencias() {
    vigencias = await getVigencias();

    if (!selectedVigenciaId && vigencias.length) {
      selectedVigenciaId =
        vigencias.find((v) => v.estado === "activa")?.id ||
        vigencias[0].id;
    }

    selector.innerHTML = vigencias.length
      ? vigencias.map((v) =>
          option(v.id, `${v.nombre}${v.estado === "activa" ? " · activa" : ""}`, v.id === selectedVigenciaId)
        ).join("")
      : `<option value="">No hay vigencias</option>`;

    selector.value = selectedVigenciaId;
  }

  async function refresh() {
    selectedMandatoIds.clear();
    updateSelectionToolbar();

    if (!selectedVigenciaId) {
      content.innerHTML = `
        <div class="empty-state">
          <strong>No hay una vigencia disponible.</strong>
          <p>Crea primero una vigencia.</p>
        </div>
      `;
      deleteAllButton.disabled = true;
      return;
    }

    content.innerHTML = `<div class="empty-state">Cargando mandatos…</div>`;

    [fuentes, consejerias, mandatos] = await Promise.all([
      getFuentes(selectedVigenciaId),
      getConsejeriasVigencia(selectedVigenciaId),
      getMandatos(selectedVigenciaId)
    ]);

    mandatoCount.textContent = String(mandatos.length);
    fuenteCount.textContent = String(fuentes.length);
    consejeriaCount.textContent = String(consejerias.length);
    deleteAllButton.disabled = mandatos.length === 0;

    if (!mandatos.length) {
      content.innerHTML = `
        <div class="empty-state">
          <strong>Aún no hay mandatos en esta vigencia.</strong>
          <p>Puedes crearlos uno a uno o utilizar la importación masiva.</p>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="table-wrap">
        <table class="data-table mandatos-table">
          <thead>
            <tr>
              <th class="checkbox-column">
                <input
                  id="selectAllMandatos"
                  class="table-checkbox"
                  type="checkbox"
                  aria-label="Seleccionar todos los mandatos"
                >
              </th>
              <th>Código</th>
              <th>Mandato</th>
              <th>Fuente</th>
              <th>Consejerías</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${mandatos.map((record) => {
              const names = mandatoConsejeriaNames(record);

              return `
                <tr data-mandato-row="${record.id}">
                  <td class="checkbox-column">
                    <input
                      class="table-checkbox mandato-select"
                      type="checkbox"
                      value="${record.id}"
                      aria-label="Seleccionar ${escapeHTML(record.codigo || "mandato")}"
                    >
                  </td>

                  <td><strong>${escapeHTML(record.codigo || "—")}</strong></td>

                  <td class="mandato-main-cell">
                    ${record.titulo ? `<strong>${escapeHTML(record.titulo)}</strong>` : ""}
                    <p>${escapeHTML(record.texto)}</p>
                  </td>

                  <td>${escapeHTML(record.fuentes_mandatos?.nombre || "—")}</td>

                  <td>
                    ${names.length
                      ? `<div class="tag-list">${names.map((n) => `<span>${escapeHTML(n)}</span>`).join("")}</div>`
                      : "—"
                    }
                  </td>

                  <td>${statusChip(record.estado)}</td>

                  <td>
                    <div class="row-actions compact-actions">
                      <button
                        class="btn btn-secondary edit-mandato"
                        type="button"
                        data-id="${record.id}"
                      >
                        Editar
                      </button>

                      <button
                        class="icon-btn danger delete-mandato"
                        type="button"
                        data-id="${record.id}"
                        aria-label="Eliminar ${escapeHTML(record.codigo || "mandato")}"
                        title="Eliminar mandato"
                      >
                        ${trashIcon()}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    const selectAll = content.querySelector("#selectAllMandatos");

    selectAll.addEventListener("change", () => {
      content.querySelectorAll(".mandato-select").forEach((input) => {
        input.checked = selectAll.checked;

        if (selectAll.checked) {
          selectedMandatoIds.add(input.value);
        } else {
          selectedMandatoIds.delete(input.value);
        }
      });

      updateSelectionToolbar();
    });

    content.querySelectorAll(".mandato-select").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) {
          selectedMandatoIds.add(input.value);
        } else {
          selectedMandatoIds.delete(input.value);
        }

        updateSelectionToolbar();
      });
    });

    content.querySelectorAll(".edit-mandato").forEach((button) => {
      button.addEventListener("click", () => {
        const record = mandatos.find((m) => m.id === button.dataset.id);
        const vigencia = currentVigencia();

        openMandatoForm({
          vigencia,
          fuentes,
          consejerias,
          record,
          onSaved: refresh
        });
      });
    });

    content.querySelectorAll(".delete-mandato").forEach((button) => {
      button.addEventListener("click", () => {
        const record = mandatos.find((m) => m.id === button.dataset.id);

        openDeleteMandatoDialog({
          record,
          onDeleted: async () => {
            await refresh();
            showToast("Mandato eliminado.");
          }
        });
      });
    });

    updateSelectionToolbar();
  }

  selector.addEventListener("change", async () => {
    selectedVigenciaId = selector.value;
    closeActionsMenu();
    await refresh();
  });

  newFuenteButton.addEventListener("click", () => {
    const vigencia = currentVigencia();
    if (!vigencia) return;

    openFuenteForm({
      vigencia,
      onSaved: refresh
    });
  });

  newMandatoButton.addEventListener("click", () => {
    const vigencia = currentVigencia();
    if (!vigencia) return;

    openMandatoForm({
      vigencia,
      fuentes,
      consejerias,
      onSaved: refresh
    });
  });

  importButton.addEventListener("click", () => {
    const vigencia = currentVigencia();
    if (!vigencia) return;

    openBulkImport({
      vigencia,
      fuentes,
      consejerias,
      mandatos,
      onImported: async (result) => {
        await refresh();

        showToast(
          `${result.imported} mandato(s) importado(s), ${result.sourcesCreated} fuente(s) creada(s) y ${result.linked} vinculación(es) con consejerías.`
        );
      }
    });
  });

  copyButton.addEventListener("click", async () => {
    try {
      await copyMandatosToClipboard(mandatos);
      showToast(`${mandatos.length} mandato(s) copiados al portapapeles.`);
    } catch (error) {
      console.error(error);
      showToast(error.message || "No fue posible copiar la tabla.");
    }
  });

  moreButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = actionsMenu.classList.contains("hidden");

    actionsMenu.classList.toggle("hidden", !opening);
    moreButton.setAttribute("aria-expanded", opening ? "true" : "false");
  });

  actionsMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", closeActionsMenu);

  deleteAllButton.addEventListener("click", () => {
    closeActionsMenu();

    const vigencia = currentVigencia();
    if (!vigencia || !mandatos.length) return;

    openBulkDeleteDialog({
      mode: "all",
      vigencia,
      count: mandatos.length,
      onDeleted: async (count) => {
        await refresh();
        showToast(`${count} ${count === 1 ? "mandato eliminado" : "mandatos eliminados"} de la vigencia.`);
      }
    });
  });

  clearSelectionButton.addEventListener("click", clearSelection);

  deleteSelectedButton.addEventListener("click", () => {
    const ids = [...selectedMandatoIds];
    const vigencia = currentVigencia();

    if (!vigencia || !ids.length) return;

    openBulkDeleteDialog({
      mode: "selected",
      vigencia,
      ids,
      count: ids.length,
      onDeleted: async (count) => {
        await refresh();
        showToast(`${count} ${count === 1 ? "mandato seleccionado eliminado" : "mandatos seleccionados eliminados"}.`);
      }
    });
  });

  try {
    await loadVigencias();
    await refresh();
  } catch (error) {
    console.error(error);

    content.innerHTML = `
      <div class="empty-state">
        <strong>No fue posible cargar Mandatos.</strong>
        <p>${escapeHTML(error.message || "No fue posible cargar los Mandatos. Intenta nuevamente.")}</p>
      </div>
    `;
  }
}
