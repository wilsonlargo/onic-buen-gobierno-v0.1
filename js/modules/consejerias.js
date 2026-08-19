import { requireSupabase } from "../supabaseClient.js";
import { updateWithVersion } from "../security.js";
import { openModal, closeModal } from "../components/modal.js";
import { renderConsejeriaWorkspace } from "./consejeriaWorkspace.js";
import {
  getConsejeriaProgressMap,
  formatConsejeriaProgress,
  getConsejeriaProgressState
} from "./consejeriaProgress.js";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function option(value, label, selected = false) {
  return `<option value="${escapeHTML(value)}" ${selected ? "selected" : ""}>${escapeHTML(label)}</option>`;
}

function statusChip(estado) {
  const active = estado === "activa";
  return `<span class="status-chip ${active ? "active" : "closed"}">${active ? "Activa" : "Inactiva"}</span>`;
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

/**
 * Convierte enlaces comunes de Google Drive a una URL más adecuada para <img>.
 * También acepta URLs normales de imágenes.
 */
function normalizeImageUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);

    if (parsed.hostname.includes("drive.google.com")) {
      let fileId = "";

      // /file/d/FILE_ID/view
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
      if (fileMatch?.[1]) fileId = fileMatch[1];

      // ?id=FILE_ID
      if (!fileId) fileId = parsed.searchParams.get("id") || "";

      // /open?id=FILE_ID
      if (!fileId && parsed.pathname.includes("/open")) {
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

function mediaPreviewHTML({ url, kind = "photo", fallback = "ON", alt = "" }) {
  const normalized = normalizeImageUrl(url);

  if (!normalized) {
    return `
      <div class="${kind === "icon" ? "media-placeholder icon-placeholder" : "media-placeholder photo-placeholder"}">
        ${escapeHTML(fallback)}
      </div>
    `;
  }

  return `
    <img
      src="${escapeHTML(normalized)}"
      alt="${escapeHTML(alt)}"
      class="${kind === "icon" ? "consejeria-icon" : "consejero-photo"}"
      loading="lazy"
      referrerpolicy="no-referrer"
      onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';"
    >
    <div
      class="${kind === "icon" ? "media-placeholder icon-placeholder" : "media-placeholder photo-placeholder"}"
      style="display:none"
    >
      ${escapeHTML(fallback)}
    </div>
  `;
}

function bindLiveImagePreview(inputSelector, previewSelector, { kind, fallback, alt }) {
  const input = document.querySelector(inputSelector);
  const preview = document.querySelector(previewSelector);

  if (!input || !preview) return;

  const render = () => {
    preview.innerHTML = mediaPreviewHTML({
      url: input.value,
      kind,
      fallback,
      alt
    });
  };

  input.addEventListener("input", render);
  input.addEventListener("change", render);
}

async function getConsejerias() {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("consejerias")
    .select("*")
    .order("orden", { ascending: true })
    .order("nombre_corto", { ascending: true });

  if (error) throw error;
  return data || [];
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

async function getVigenciaConsejerias(vigenciaId) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("vigencia_consejerias")
    .select(`
      id,
      vigencia_id,
      consejeria_id,
      responsable,
      pueblo,
      detalle,
      estado,
      foto_url,
      consejerias (
        id,
        nombre_largo,
        nombre_corto,
        descripcion,
        funciones,
        estado,
        icono_url
      )
    `)
    .eq("vigencia_id", vigenciaId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getConsejeriaUsage(consejeriaId) {
  const supabase = requireSupabase();

  const { count, error } = await supabase
    .from("vigencia_consejerias")
    .select("id", { count: "exact", head: true })
    .eq("consejeria_id", consejeriaId);

  if (error) throw error;

  return Number(count || 0);
}

async function insertConsejeria(payload) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("consejerias")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateConsejeria(record, payload) {
  return updateWithVersion({ table: "consejerias", record, payload, entityType: "Consejería", entityName: record?.nombre_corto || record?.nombre_largo || null });
}

async function deleteConsejeria(id) {
  const supabase = requireSupabase();

  const { error } = await supabase
    .from("consejerias")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

async function linkConsejeria(payload) {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("vigencia_consejerias")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateVigenciaConsejeria(record, payload) {
  return updateWithVersion({ table: "vigencia_consejerias", record, payload, entityType: "Consejería en Vigencia", entityName: record?.consejerias?.nombre_corto || record?.responsable || null, vigenciaId: record?.vigencia_id || null, vigenciaConsejeriaId: record?.id || null });
}

function openConsejeriaForm({ record = null, onSaved }) {
  const editing = Boolean(record);
  const fallback = initials(record?.nombre_corto || "ON");

  openModal({
    title: editing ? "Editar consejería" : "Nueva consejería",
    content: `
      <form id="consejeriaForm">
        <div class="form-grid">
          <div class="form-field full">
            <label for="nombreLargo">Nombre largo</label>
            <input
              id="nombreLargo"
              name="nombre_largo"
              required
              value="${escapeHTML(record?.nombre_largo || "")}"
              placeholder="Ej. Consejería Secretaría General"
            >
          </div>

          <div class="form-field full">
            <label for="nombreCorto">Nombre corto</label>
            <input
              id="nombreCorto"
              name="nombre_corto"
              required
              value="${escapeHTML(record?.nombre_corto || "")}"
              placeholder="Ej. Secretaría General"
            >
          </div>

          <div class="form-field full">
            <label for="iconoUrl">Ícono representativo</label>
            <input
              id="iconoUrl"
              name="icono_url"
              type="url"
              value="${escapeHTML(record?.icono_url || "")}"
              placeholder="https://... o enlace público de Google Drive"
            >
            <small class="field-help">
              Puede usar una URL directa o un enlace público de Google Drive.
              El sistema intentará convertir automáticamente los enlaces de Drive.
            </small>
          </div>

          <div class="form-field full">
            <label>Vista previa del ícono</label>
            <div id="iconPreview" class="media-preview-box">
              ${mediaPreviewHTML({
                url: record?.icono_url,
                kind: "icon",
                fallback,
                alt: record?.nombre_corto || "Ícono de consejería"
              })}
            </div>
          </div>

          <div class="form-field full">
            <label for="descripcionConsejeria">Descripción institucional</label>
            <textarea id="descripcionConsejeria" name="descripcion">${escapeHTML(record?.descripcion || "")}</textarea>
          </div>

          <div class="form-field full">
            <label for="funcionesConsejeria">Funciones</label>
            <textarea id="funcionesConsejeria" name="funciones">${escapeHTML(record?.funciones || "")}</textarea>
          </div>

          <div class="form-field">
            <label for="ordenConsejeria">Orden</label>
            <input
              id="ordenConsejeria"
              name="orden"
              type="number"
              min="0"
              step="1"
              value="${Number(record?.orden ?? 0)}"
            >
          </div>

          <div class="form-field">
            <label for="estadoConsejeria">Estado institucional</label>
            <select id="estadoConsejeria" name="estado">
              ${option("activa", "Activa", (record?.estado || "activa") === "activa")}
              ${option("inactiva", "Inactiva", record?.estado === "inactiva")}
            </select>
          </div>
        </div>

        <p id="consejeriaMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelConsejeria" class="btn btn-secondary" type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">${editing ? "Guardar cambios" : "Crear consejería"}</button>
        </div>
      </form>
    `
  });

  bindLiveImagePreview("#iconoUrl", "#iconPreview", {
    kind: "icon",
    fallback,
    alt: record?.nombre_corto || "Ícono de consejería"
  });

  const form = document.querySelector("#consejeriaForm");
  const message = document.querySelector("#consejeriaMessage");

  document.querySelector("#cancelConsejeria").addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const data = new FormData(form);
    const payload = {
      nombre_largo: data.get("nombre_largo").trim(),
      nombre_corto: data.get("nombre_corto").trim(),
      icono_url: data.get("icono_url")?.trim() || null,
      descripcion: data.get("descripcion")?.trim() || null,
      funciones: data.get("funciones")?.trim() || null,
      orden: Number(data.get("orden") || 0),
      estado: data.get("estado")
    };

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      if (editing) {
        await updateConsejeria(record, payload);
      } else {
        await insertConsejeria(payload);
      }

      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible guardar la consejería.";
    } finally {
      submit.disabled = false;
      submit.textContent = editing ? "Guardar cambios" : "Crear consejería";
    }
  });
}

async function openDeleteConsejeriaDialog({ record, onDeleted, onInactivated }) {
  let usage = 0;

  try {
    usage = await getConsejeriaUsage(record.id);
  } catch (error) {
    console.error(error);
    openModal({
      title: "Eliminar consejería",
      content: `
        <p class="notice">
          No fue posible verificar las dependencias de esta consejería.
          Por seguridad, la eliminación ha sido bloqueada.
        </p>
        <div class="form-actions">
          <button id="closeDeleteError" class="btn btn-secondary" type="button">Cerrar</button>
        </div>
      `
    });
    document.querySelector("#closeDeleteError").addEventListener("click", closeModal);
    return;
  }

  if (usage > 0) {
    openModal({
      title: "No se puede eliminar",
      content: `
        <p class="notice">
          <strong>${escapeHTML(record.nombre_corto)}</strong> ya está vinculada a
          ${usage} ${usage === 1 ? "vigencia" : "vigencias"}.
        </p>

        <p class="muted">
          Para proteger la historia del Plan Estratégico, una consejería utilizada
          no puede eliminarse físicamente. Puedes marcarla como inactiva; sus
          relaciones y antecedentes permanecerán disponibles.
        </p>

        <div class="form-actions">
          <button id="cancelProtectedDelete" class="btn btn-secondary" type="button">Cerrar</button>
          ${record.estado === "activa"
            ? `<button id="inactivateConsejeria" class="btn btn-danger" type="button">Inactivar consejería</button>`
            : ""}
        </div>

        <p id="protectedDeleteMessage" class="form-message"></p>
      `
    });

    document.querySelector("#cancelProtectedDelete").addEventListener("click", closeModal);

    const inactivate = document.querySelector("#inactivateConsejeria");
    if (inactivate) {
      inactivate.addEventListener("click", async () => {
        const message = document.querySelector("#protectedDeleteMessage");
        inactivate.disabled = true;
        inactivate.textContent = "Inactivando…";

        try {
          await updateConsejeria(record, { estado: "inactiva" });
          closeModal();
          await onInactivated();
        } catch (error) {
          console.error(error);
          message.textContent = error.message || "No fue posible inactivar la consejería.";
          inactivate.disabled = false;
          inactivate.textContent = "Inactivar consejería";
        }
      });
    }
    return;
  }

  openModal({
    title: "Eliminar consejería",
    content: `
      <p class="notice">
        Estás a punto de eliminar permanentemente
        <strong>${escapeHTML(record.nombre_corto)}</strong>.
      </p>

      <p class="muted">
        Esta consejería nunca ha sido vinculada a una vigencia, por lo que puede
        eliminarse definitivamente. Esta acción no se puede deshacer.
      </p>

      <div class="form-field">
        <label for="deleteConfirmation">
          Escribe <strong>ELIMINAR</strong> para confirmar
        </label>
        <input
          id="deleteConfirmation"
          autocomplete="off"
          placeholder="ELIMINAR"
        >
      </div>

      <p id="deleteConsejeriaMessage" class="form-message"></p>

      <div class="form-actions">
        <button id="cancelDeleteConsejeria" class="btn btn-secondary" type="button">Cancelar</button>
        <button id="confirmDeleteConsejeria" class="btn btn-danger" type="button" disabled>
          Eliminar definitivamente
        </button>
      </div>
    `
  });

  const input = document.querySelector("#deleteConfirmation");
  const confirm = document.querySelector("#confirmDeleteConsejeria");
  const message = document.querySelector("#deleteConsejeriaMessage");

  document.querySelector("#cancelDeleteConsejeria").addEventListener("click", closeModal);

  input.addEventListener("input", () => {
    confirm.disabled = input.value.trim().toUpperCase() !== "ELIMINAR";
  });

  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    confirm.textContent = "Eliminando…";
    message.textContent = "";

    try {
      const currentUsage = await getConsejeriaUsage(record.id);

      if (currentUsage > 0) {
        throw new Error(
          "La consejería fue vinculada a una vigencia mientras confirmabas la operación. Ya no puede eliminarse."
        );
      }

      await deleteConsejeria(record.id);
      closeModal();
      await onDeleted();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible eliminar la consejería.";
      confirm.disabled = false;
      confirm.textContent = "Eliminar definitivamente";
    }
  });
}

function openLinkForm({ vigencia, catalogo, vinculadas, onSaved }) {
  const usedIds = new Set(vinculadas.map((item) => item.consejeria_id));
  const disponibles = catalogo.filter(
    (item) => item.estado === "activa" && !usedIds.has(item.id)
  );

  if (!disponibles.length) {
    openModal({
      title: "Vincular consejería",
      content: `
        <div class="empty-state">
          <strong>No hay consejerías disponibles para vincular.</strong>
          <p>Crea una nueva consejería en el catálogo o revisa las que ya están vinculadas a esta vigencia.</p>
          <button id="closeNoAvailable" class="btn btn-secondary" type="button">Cerrar</button>
        </div>
      `
    });
    document.querySelector("#closeNoAvailable").addEventListener("click", closeModal);
    return;
  }

  openModal({
    title: "Vincular consejería a la vigencia",
    content: `
      <p class="notice">
        Vigencia: <strong>${escapeHTML(vigencia.nombre)}</strong>.
        El responsable, el pueblo y la foto corresponden a esta vigencia.
      </p>

      <form id="linkConsejeriaForm">
        <div class="form-grid">
          <div class="form-field full">
            <label for="linkConsejeriaId">Consejería</label>
            <select id="linkConsejeriaId" name="consejeria_id" required>
              <option value="">Seleccione…</option>
              ${disponibles.map((item) => option(item.id, `${item.nombre_corto} — ${item.nombre_largo}`)).join("")}
            </select>
          </div>

          <div class="form-field full">
            <label for="responsable">Responsable en esta vigencia</label>
            <input id="responsable" name="responsable" placeholder="Nombre de la persona responsable">
          </div>

          <div class="form-field full">
            <label for="fotoUrl">Foto del consejero/a</label>
            <input
              id="fotoUrl"
              name="foto_url"
              type="url"
              placeholder="https://... o enlace público de Google Drive"
            >
            <small class="field-help">
              La foto pertenece a esta vigencia. Si cambia el consejero en otra
              vigencia, puede registrarse una foto diferente.
            </small>
          </div>

          <div class="form-field full">
            <label>Vista previa de la foto</label>
            <div id="photoPreview" class="media-preview-box">
              ${mediaPreviewHTML({
                url: "",
                kind: "photo",
                fallback: "ON",
                alt: "Foto del consejero"
              })}
            </div>
          </div>

          <div class="form-field full">
            <label for="pueblo">Pueblo</label>
            <input id="pueblo" name="pueblo" placeholder="Pueblo de pertenencia">
          </div>

          <div class="form-field full">
            <label for="detalle">Detalle / contexto de la vigencia</label>
            <textarea id="detalle" name="detalle"></textarea>
          </div>

          <div class="form-field">
            <label for="estadoVinculo">Estado</label>
            <select id="estadoVinculo" name="estado">
              <option value="activa">Activa</option>
              <option value="inactiva">Inactiva</option>
            </select>
          </div>
        </div>

        <p id="linkMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelLink" class="btn btn-secondary" type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">Vincular</button>
        </div>
      </form>
    `
  });

  bindLiveImagePreview("#fotoUrl", "#photoPreview", {
    kind: "photo",
    fallback: "ON",
    alt: "Foto del consejero"
  });

  const form = document.querySelector("#linkConsejeriaForm");
  const message = document.querySelector("#linkMessage");

  document.querySelector("#cancelLink").addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const data = new FormData(form);
    const payload = {
      vigencia_id: vigencia.id,
      consejeria_id: data.get("consejeria_id"),
      responsable: data.get("responsable")?.trim() || null,
      foto_url: data.get("foto_url")?.trim() || null,
      pueblo: data.get("pueblo")?.trim() || null,
      detalle: data.get("detalle")?.trim() || null,
      estado: data.get("estado")
    };

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Vinculando…";

    try {
      await linkConsejeria(payload);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible vincular la consejería.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Vincular";
    }
  });
}

function openEditLinkForm({ record, onSaved }) {
  const c = record.consejerias;
  const fallback = initials(record.responsable || c?.nombre_corto || "ON");

  openModal({
    title: "Consejería en la vigencia",
    content: `
      <p class="notice">
        <strong>${escapeHTML(c?.nombre_corto || "Consejería")}</strong><br>
        ${escapeHTML(c?.nombre_largo || "")}
      </p>

      <form id="editLinkForm">
        <div class="form-grid">
          <div class="form-field full">
            <label for="editResponsable">Responsable en esta vigencia</label>
            <input
              id="editResponsable"
              name="responsable"
              value="${escapeHTML(record.responsable || "")}"
            >
          </div>

          <div class="form-field full">
            <label for="editFotoUrl">Foto del consejero/a</label>
            <input
              id="editFotoUrl"
              name="foto_url"
              type="url"
              value="${escapeHTML(record.foto_url || "")}"
              placeholder="https://... o enlace público de Google Drive"
            >
          </div>

          <div class="form-field full">
            <label>Vista previa de la foto</label>
            <div id="editPhotoPreview" class="media-preview-box">
              ${mediaPreviewHTML({
                url: record.foto_url,
                kind: "photo",
                fallback,
                alt: record.responsable || "Foto del consejero"
              })}
            </div>
          </div>

          <div class="form-field full">
            <label for="editPueblo">Pueblo</label>
            <input
              id="editPueblo"
              name="pueblo"
              value="${escapeHTML(record.pueblo || "")}"
            >
          </div>

          <div class="form-field full">
            <label for="editDetalle">Detalle / contexto de la vigencia</label>
            <textarea id="editDetalle" name="detalle">${escapeHTML(record.detalle || "")}</textarea>
          </div>

          <div class="form-field">
            <label for="editEstado">Estado</label>
            <select id="editEstado" name="estado">
              ${option("activa", "Activa", record.estado === "activa")}
              ${option("inactiva", "Inactiva", record.estado === "inactiva")}
            </select>
          </div>
        </div>

        <p id="editLinkMessage" class="form-message"></p>

        <div class="form-actions">
          <button id="cancelEditLink" class="btn btn-secondary" type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">Guardar cambios</button>
        </div>
      </form>
    `
  });

  bindLiveImagePreview("#editFotoUrl", "#editPhotoPreview", {
    kind: "photo",
    fallback,
    alt: record.responsable || "Foto del consejero"
  });

  const form = document.querySelector("#editLinkForm");
  const message = document.querySelector("#editLinkMessage");

  document.querySelector("#cancelEditLink").addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const data = new FormData(form);
    const payload = {
      responsable: data.get("responsable")?.trim() || null,
      foto_url: data.get("foto_url")?.trim() || null,
      pueblo: data.get("pueblo")?.trim() || null,
      detalle: data.get("detalle")?.trim() || null,
      estado: data.get("estado")
    };

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      await updateVigenciaConsejeria(record, payload);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible actualizar la vinculación.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Guardar cambios";
    }
  });
}

function openRetireDialog({ record, onSaved }) {
  const c = record.consejerias;

  if (record.estado === "inactiva") {
    openModal({
      title: "Reactivar en esta vigencia",
      content: `
        <p class="notice">
          ¿Deseas reactivar <strong>${escapeHTML(c?.nombre_corto || "esta consejería")}</strong>
          en la vigencia seleccionada?
        </p>
        <div class="form-actions">
          <button id="cancelReactivate" class="btn btn-secondary" type="button">Cancelar</button>
          <button id="confirmReactivate" class="btn btn-primary" type="button">Reactivar</button>
        </div>
        <p id="reactivateMessage" class="form-message"></p>
      `
    });

    document.querySelector("#cancelReactivate").addEventListener("click", closeModal);
    document.querySelector("#confirmReactivate").addEventListener("click", async () => {
      const button = document.querySelector("#confirmReactivate");
      const message = document.querySelector("#reactivateMessage");
      button.disabled = true;
      button.textContent = "Reactivando…";

      try {
        await updateVigenciaConsejeria(record, { estado: "activa" });
        closeModal();
        await onSaved();
      } catch (error) {
        console.error(error);
        message.textContent = error.message || "No fue posible reactivar la consejería.";
        button.disabled = false;
        button.textContent = "Reactivar";
      }
    });
    return;
  }

  openModal({
    title: "Retirar de la vigencia",
    content: `
      <p class="notice">
        Vas a retirar <strong>${escapeHTML(c?.nombre_corto || "esta consejería")}</strong>
        de la vigencia seleccionada.
      </p>

      <p class="muted">
        La vinculación no se eliminará definitivamente. Quedará marcada como
        <strong>inactiva</strong> para conservar el historial y evitar la pérdida
        de Líneas de Acción, Programas o Proyectos relacionados.
      </p>

      <div class="form-actions">
        <button id="cancelRetire" class="btn btn-secondary" type="button">Cancelar</button>
        <button id="confirmRetire" class="btn btn-danger" type="button">Retirar / Inactivar</button>
      </div>

      <p id="retireMessage" class="form-message"></p>
    `
  });

  document.querySelector("#cancelRetire").addEventListener("click", closeModal);
  document.querySelector("#confirmRetire").addEventListener("click", async () => {
    const button = document.querySelector("#confirmRetire");
    const message = document.querySelector("#retireMessage");
    button.disabled = true;
    button.textContent = "Retirando…";

    try {
      await updateVigenciaConsejeria(record, { estado: "inactiva" });
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible retirar la consejería.";
      button.disabled = false;
      button.textContent = "Retirar / Inactivar";
    }
  });
}

export async function renderConsejerias(container, navigationTarget = null) {
  let vigencias = [];
  let catalogo = [];
  let selectedVigenciaId = "";
  let progressMetrics = new Map();

  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Estructura institucional</p>
        <h2>Consejerías</h2>
      </div>
      <button id="newConsejeriaButton" class="btn btn-secondary" type="button">+ Nueva consejería</button>
    </div>

    <section class="panel" style="margin-top: 0">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Vigencia de trabajo</p>
          <h2>Consejerías vinculadas</h2>
        </div>

        <div class="inline-control">
          <select id="vigenciaSelector" aria-label="Seleccionar vigencia"></select>
          <button id="linkConsejeriaButton" class="btn btn-primary" type="button">+ Vincular</button>
        </div>
      </div>

      <div id="linkedConsejerias" style="margin-top: 18px">
        <div class="empty-state">Cargando…</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Catálogo institucional</p>
          <h2>Consejerías disponibles</h2>
        </div>
        <span id="catalogCount" class="status-chip">0</span>
      </div>

      <div id="catalogoConsejerias" style="margin-top: 18px"></div>
    </section>
  `;

  const consejeriasListView = document.createElement("div");
  consejeriasListView.id = "consejeriasListView";

  while (container.firstChild) {
    consejeriasListView.appendChild(container.firstChild);
  }

  container.appendChild(consejeriasListView);

  const selector = document.querySelector("#vigenciaSelector");
  const linkedContainer = document.querySelector("#linkedConsejerias");
  const catalogContainer = document.querySelector("#catalogoConsejerias");
  const catalogCount = document.querySelector("#catalogCount");
  const newButton = document.querySelector("#newConsejeriaButton");
  const linkButton = document.querySelector("#linkConsejeriaButton");

  async function loadBase() {
    [vigencias, catalogo] = await Promise.all([
      getVigencias(),
      getConsejerias()
    ]);

    selector.innerHTML = vigencias.length
      ? vigencias.map((v) => option(v.id, `${v.nombre}${v.estado === "activa" ? " · activa" : ""}`)).join("")
      : `<option value="">No hay vigencias</option>`;

    if (!selectedVigenciaId && vigencias.length) {
      const requested =
        navigationTarget?.vigencia_id &&
        vigencias.find((v) => v.id === navigationTarget.vigencia_id);

      const active = vigencias.find((v) => v.estado === "activa");
      selectedVigenciaId = requested?.id || active?.id || vigencias[0].id;
    }

    selector.value = selectedVigenciaId;
    linkButton.disabled = !selectedVigenciaId;

    renderCatalog();
    await renderLinked();
  }

  function renderCatalog() {
    catalogCount.textContent = String(catalogo.length);

    if (!catalogo.length) {
      catalogContainer.innerHTML = `
        <div class="empty-state">
          <strong>Aún no existe el catálogo de consejerías.</strong>
          <p>Crea la primera consejería con su nombre largo y nombre corto.</p>
        </div>
      `;
      return;
    }

    catalogContainer.innerHTML = `
      <div class="entity-grid">
        ${catalogo.map((item) => `
          <article class="entity-card">
            <div class="entity-card-top">
              <div class="entity-heading">
                <div class="entity-icon-wrap">
                  ${mediaPreviewHTML({
                    url: item.icono_url,
                    kind: "icon",
                    fallback: initials(item.nombre_corto),
                    alt: `Ícono de ${item.nombre_corto}`
                  })}
                </div>

                <div>
                  <p class="eyebrow">${escapeHTML(item.nombre_corto)}</p>
                  <h3>${escapeHTML(item.nombre_largo)}</h3>
                </div>
              </div>

              ${statusChip(item.estado)}
            </div>

            <p class="muted entity-description">
              ${escapeHTML(item.descripcion || "Sin descripción institucional.")}
            </p>

            <div class="entity-actions">
              <button class="btn btn-secondary edit-catalog" type="button" data-id="${item.id}">
                Editar
              </button>
              <button class="btn btn-danger delete-catalog" type="button" data-id="${item.id}">
                Eliminar
              </button>
            </div>
          </article>
        `).join("")}
      </div>
    `;

    catalogContainer.querySelectorAll(".edit-catalog").forEach((button) => {
      button.addEventListener("click", () => {
        const record = catalogo.find((item) => item.id === button.dataset.id);
        openConsejeriaForm({
          record,
          onSaved: loadBase
        });
      });
    });

    catalogContainer.querySelectorAll(".delete-catalog").forEach((button) => {
      button.addEventListener("click", async () => {
        const record = catalogo.find((item) => item.id === button.dataset.id);
        await openDeleteConsejeriaDialog({
          record,
          onDeleted: loadBase,
          onInactivated: loadBase
        });
      });
    });
  }

  async function openConsejeriaWorkspaceRecord(record, { initialTab = "perfil" } = {}) {
    const vigencia = vigencias.find(
      (item) => item.id === selectedVigenciaId
    );

    if (!record || !vigencia) return;

    consejeriasListView.classList.add("hidden");

    const oldHost = container.querySelector(
      "#activeConsejeriaWorkspace"
    );

    if (oldHost) oldHost.remove();

    const workspaceHost = document.createElement("div");
    workspaceHost.id = "activeConsejeriaWorkspace";
    container.appendChild(workspaceHost);

    await renderConsejeriaWorkspace(workspaceHost, {
      vigencia,
      record,
      initialTab,
      progressMetric:
        progressMetrics.get(record.id) || null,

      onChanged: async () => {
        catalogo = await getConsejerias();
        renderCatalog();
        await renderLinked();
      },

      onBack: async () => {
        workspaceHost.remove();
        consejeriasListView.classList.remove("hidden");
        catalogo = await getConsejerias();
        renderCatalog();
        await renderLinked();
      }
    });
  }

  async function renderLinked() {
    if (!selectedVigenciaId) {
      linkedContainer.innerHTML = `
        <div class="empty-state">
          <strong>No hay una vigencia disponible.</strong>
          <p>Crea primero una vigencia para vincular consejerías.</p>
        </div>
      `;
      return;
    }

    linkedContainer.innerHTML = `<div class="empty-state">Cargando consejerías de la vigencia…</div>`;

    try {
      const [
        vinculadas,
        loadedProgressMetrics
      ] = await Promise.all([
        getVigenciaConsejerias(
          selectedVigenciaId
        ),
        getConsejeriaProgressMap(
          selectedVigenciaId
        )
      ]);

      progressMetrics =
        loadedProgressMetrics;

      if (!vinculadas.length) {
        linkedContainer.innerHTML = `
          <div class="empty-state">
            <strong>Esta vigencia aún no tiene consejerías vinculadas.</strong>
            <p>Usa el botón <strong>Vincular</strong> para agregarlas desde el catálogo institucional.</p>
          </div>
        `;
        return;
      }

      linkedContainer.innerHTML = `
        <div class="vigencia-consejerias-grid">
          ${vinculadas.map((item) => {
            const c = item.consejerias || {};
            const personFallback = initials(
              item.responsable ||
              c.nombre_corto ||
              "ON"
            );

            const metric =
              progressMetrics.get(
                item.id
              ) || {
                progress: 0,
                coverage: 0,
                active:
                  item.estado ===
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
              <article class="vigencia-consejeria-card ${item.estado === "inactiva" ? "is-inactive" : ""}">
                <div class="vc-card-header">
                  <div class="consejero-photo-wrap">
                    ${mediaPreviewHTML({
                      url: item.foto_url,
                      kind: "photo",
                      fallback: personFallback,
                      alt: item.responsable || "Consejero/a"
                    })}
                  </div>

                  <div class="vc-card-title">
                    <div class="vc-title-line">
                      <div class="entity-icon-wrap small">
                        ${mediaPreviewHTML({
                          url: c.icono_url,
                          kind: "icon",
                          fallback: initials(c.nombre_corto),
                          alt: `Ícono de ${c.nombre_corto || "consejería"}`
                        })}
                      </div>

                      <div>
                        <p class="eyebrow">${escapeHTML(c.nombre_corto || "Consejería")}</p>
                        <h3>${escapeHTML(c.nombre_largo || "")}</h3>
                      </div>
                    </div>
                  </div>

                  ${statusChip(item.estado)}
                </div>

                <div class="vc-card-body">
                  <div class="vc-data">
                    <span>Responsable</span>
                    <strong>${escapeHTML(item.responsable || "Sin registrar")}</strong>
                  </div>

                  <div class="vc-data">
                    <span>Pueblo</span>
                    <strong>${escapeHTML(item.pueblo || "Sin registrar")}</strong>
                  </div>

                  <div
                    class="vc-data vc-plan-progress ${escapeHTML(progressState.key)}"
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

                  <div class="vc-data vc-coverage-data">
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
                      class="vc-coverage-bar"
                      aria-hidden="true"
                    >
                      <span
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
                      ></span>
                    </div>
                  </div>

                  ${item.detalle
                    ? `<p class="muted vc-detail">${escapeHTML(item.detalle)}</p>`
                    : ""}
                </div>

                <div class="row-actions">
                  <button
                    class="btn btn-primary open-consejeria-workspace"
                    type="button"
                    data-id="${item.id}"
                  >
                    Abrir consejería
                  </button>

                  <button
                    class="${item.estado === "activa" ? "btn btn-danger" : "btn btn-secondary"} retire-link"
                    type="button"
                    data-id="${item.id}"
                  >
                    ${item.estado === "activa" ? "Retirar" : "Reactivar"}
                  </button>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      `;

      linkedContainer
        .querySelectorAll(".open-consejeria-workspace")
        .forEach((button) => {
          button.addEventListener("click", async () => {
            const record = vinculadas.find(
              (item) => item.id === button.dataset.id
            );

            await openConsejeriaWorkspaceRecord(record);
          });
        });

      linkedContainer.querySelectorAll(".retire-link").forEach((button) => {
        button.addEventListener("click", () => {
          const record = vinculadas.find((item) => item.id === button.dataset.id);
          openRetireDialog({
            record,
            onSaved: renderLinked
          });
        });
      });
    } catch (error) {
      console.error(error);
      linkedContainer.innerHTML = `
        <div class="empty-state">
          <strong>No se pudo cargar la vinculación de consejerías.</strong>
          <p>${escapeHTML(error.message || "Error inesperado")}</p>
        </div>
      `;
    }
  }

  selector.addEventListener("change", async () => {
    selectedVigenciaId = selector.value;
    await renderLinked();
  });

  newButton.addEventListener("click", () => {
    openConsejeriaForm({
      onSaved: loadBase
    });
  });

  linkButton.addEventListener("click", async () => {
    const vigencia = vigencias.find((item) => item.id === selectedVigenciaId);
    if (!vigencia) return;

    const vinculadas = await getVigenciaConsejerias(selectedVigenciaId);

    openLinkForm({
      vigencia,
      catalogo,
      vinculadas,
      onSaved: async () => {
        catalogo = await getConsejerias();
        renderCatalog();
        await renderLinked();
      }
    });
  });

  try {
    await loadBase();

    if (navigationTarget?.vigencia_consejeria_id) {
      const vinculadas = await getVigenciaConsejerias(
        selectedVigenciaId
      );

      const targetRecord = vinculadas.find(
        (item) => item.id === navigationTarget.vigencia_consejeria_id
      );

      if (targetRecord) {
        await openConsejeriaWorkspaceRecord(targetRecord, {
          initialTab: navigationTarget.consejeria_tab || "perfil"
        });
      }
    }
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <section class="panel" style="margin-top: 0">
        <p class="eyebrow">Error</p>
        <h2>No fue posible cargar Consejerías</h2>
        <p class="muted">${escapeHTML(error.message || "No fue posible cargar las Consejerías. Intenta nuevamente.")}</p>
      </section>
    `;
  }
}
