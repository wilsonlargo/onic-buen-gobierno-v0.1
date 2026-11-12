import { requireSupabase } from "../supabaseClient.js?v=5.4.17";
import { updateWithVersion } from "../security.js?v=5.4.17";
import { openModal, closeModal } from "../components/modal.js?v=5.4.17";
import { renderConsejeriaWorkspace } from "./consejeriaWorkspace.js?v=5.4.17";
import {
  getConsejeriaProgressMap,
  formatConsejeriaProgress,
  getConsejeriaProgressState
} from "./consejeriaProgress.js?v=5.4.17";
import { friendlyErrorMessage } from "../userMessages.js?v=5.4.17";

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
      message.textContent = friendlyErrorMessage(error, "No fue posible guardar la consejería.");
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
          message.textContent = friendlyErrorMessage(error, "No fue posible inactivar la consejería.");
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
      message.textContent = friendlyErrorMessage(error, "No fue posible eliminar la consejería.");
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
      title: "Agregar Consejería a esta vigencia",
      content: `
        <div class="empty-state">
          <strong>No hay consejerías disponibles para vincular.</strong>
          <p>Revisa las Consejerías institucionales en <strong>Configuración</strong> o las que ya están vinculadas a esta vigencia.</p>
          <button id="closeNoAvailable" class="btn btn-secondary" type="button">Cerrar</button>
        </div>
      `
    });
    document.querySelector("#closeNoAvailable").addEventListener("click", closeModal);
    return;
  }

  openModal({
    title: "Agregar Consejería a esta vigencia",
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
          <button class="btn btn-primary" type="submit">Agregar a la vigencia</button>
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
    submit.textContent = "Agregando…";

    try {
      await linkConsejeria(payload);
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = friendlyErrorMessage(error, "No fue posible agregar la Consejería a esta vigencia.");
    } finally {
      submit.disabled = false;
      submit.textContent = "Agregar a la vigencia";
    }
  });
}

function openEditLinkForm({ record, onSaved }) {
  const c = record.consejerias;
  const fallback = initials(record.responsable || c?.nombre_corto || "ON");

  openModal({
    title: "Editar datos de la vigencia",
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
      message.textContent = friendlyErrorMessage(error, "No fue posible actualizar la vinculación.");
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
        message.textContent = friendlyErrorMessage(error, "No fue posible reactivar la consejería.");
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
        de Líneas de Acción, Programas o unidades relacionadas.
      </p>

      <div class="form-actions">
        <button id="cancelRetire" class="btn btn-secondary" type="button">Cancelar</button>
        <button id="confirmRetire" class="btn btn-danger" type="button">Retirar de la Vigencia</button>
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
      message.textContent = friendlyErrorMessage(error, "No fue posible retirar la consejería.");
      button.disabled = false;
      button.textContent = "Retirar de la Vigencia";
    }
  });
}


async function getConsejeriaStructureSummaryMap(vigenciaId) {
  const vinculadas = await getVigenciaConsejerias(vigenciaId);
  const vcIds = vinculadas.map((item) => item.id);
  const summary = new Map(
    vcIds.map((id) => [id, { lineas: 0, programas: 0, proyectos: 0, actividadesGenerales: 0, actividades: 0 }])
  );

  if (!vcIds.length) return summary;

  const supabase = requireSupabase();
  const { data: lineas, error: lineError } = await supabase
    .from("lineas_accion")
    .select("id,vigencia_consejeria_id")
    .in("vigencia_consejeria_id", vcIds);
  if (lineError) throw lineError;

  const lineRows = lineas || [];
  lineRows.forEach((linea) => {
    const item = summary.get(linea.vigencia_consejeria_id);
    if (item) item.lineas += 1;
  });

  const lineToVc = new Map(lineRows.map((item) => [item.id, item.vigencia_consejeria_id]));
  const lineIds = lineRows.map((item) => item.id);
  if (!lineIds.length) return summary;

  const { data: programas, error: programError } = await supabase
    .from("programas")
    .select("id,linea_accion_id")
    .in("linea_accion_id", lineIds);
  if (programError) throw programError;

  const programRows = programas || [];
  const programToVc = new Map();
  programRows.forEach((programa) => {
    const vcId = lineToVc.get(programa.linea_accion_id);
    if (!vcId) return;
    programToVc.set(programa.id, vcId);
    const item = summary.get(vcId);
    if (item) item.programas += 1;
  });

  const programIds = programRows.map((item) => item.id);
  if (!programIds.length) return summary;

  const { data: proyectos, error: projectError } = await supabase
    .from("proyectos")
    .select("id,programa_id,tipo_unidad")
    .in("programa_id", programIds);
  if (projectError) throw projectError;

  const projectRows = proyectos || [];
  const projectToVc = new Map();
  const projectType = new Map();
  projectRows.forEach((proyecto) => {
    const vcId = programToVc.get(proyecto.programa_id);
    if (!vcId) return;
    projectToVc.set(proyecto.id, vcId);
    projectType.set(proyecto.id, proyecto.tipo_unidad);
    const item = summary.get(vcId);
    if (!item) return;
    if (proyecto.tipo_unidad === "actividad_general") item.actividadesGenerales += 1;
    else item.proyectos += 1;
  });

  const projectIds = projectRows.map((item) => item.id);
  if (!projectIds.length) return summary;

  const { data: actividades, error: activityError } = await supabase
    .from("actividades")
    .select("id,proyecto_id")
    .in("proyecto_id", projectIds);
  if (activityError) throw activityError;

  (actividades || []).forEach((actividad) => {
    if (projectType.get(actividad.proyecto_id) === "actividad_general") return;
    const vcId = projectToVc.get(actividad.proyecto_id);
    const item = summary.get(vcId);
    if (item) item.actividades += 1;
  });

  return summary;
}

export async function renderConsejerias(container, navigationTarget = null) {
  let vigencias = [];
  let selectedVigenciaId = "";
  let vinculadas = [];
  let progressMetrics = new Map();
  let structureSummary = new Map();

  container.innerHTML = `
    <div class="page-actions consejerias-operational-heading">
      <div>
        <p class="eyebrow">Gestión por vigencia</p>
        <h2>Consejerías</h2>
        <p class="muted">Consulta la estructura, responsables y avance de cada Consejería en la vigencia seleccionada.</p>
      </div>
      <div class="consejerias-operational-actions">
        <div class="inline-control consejerias-vigencia-control">
          <label class="sr-only" for="vigenciaSelector">Vigencia</label>
          <select id="vigenciaSelector" aria-label="Seleccionar vigencia"></select>
        </div>
        <button id="addConsejeriaToVigencia" class="btn btn-primary" type="button">+ Agregar Consejería a esta vigencia</button>
      </div>
    </div>

    <section id="consejeriasVigenciaSummary" class="tracking-summary-grid consejerias-summary-grid" aria-live="polite"></section>

    <section class="panel consejerias-operational-panel" style="margin-top: 0">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Estructura de la vigencia</p>
          <h2 id="linkedConsejeriasTitle">Consejerías vinculadas</h2>
        </div>
        <span id="linkedConsejeriasCount" class="status-chip">0</span>
      </div>
      <div id="linkedConsejerias" style="margin-top: 18px">
        <div class="empty-state">Cargando…</div>
      </div>
    </section>
  `;

  const listView = document.createElement("div");
  listView.id = "consejeriasListView";
  while (container.firstChild) listView.appendChild(container.firstChild);
  container.appendChild(listView);

  const selector = listView.querySelector("#vigenciaSelector");
  const linkedContainer = listView.querySelector("#linkedConsejerias");
  const summaryContainer = listView.querySelector("#consejeriasVigenciaSummary");
  const countChip = listView.querySelector("#linkedConsejeriasCount");
  const title = listView.querySelector("#linkedConsejeriasTitle");
  const addConsejeriaButton = listView.querySelector("#addConsejeriaToVigencia");

  function summaryTotals() {
    return vinculadas.reduce((acc, item) => {
      const metric = structureSummary.get(item.id) || {};
      acc.lineas += Number(metric.lineas || 0);
      acc.programas += Number(metric.programas || 0);
      acc.proyectos += Number(metric.proyectos || 0);
      acc.actividadesGenerales += Number(metric.actividadesGenerales || 0);
      acc.actividades += Number(metric.actividades || 0);
      return acc;
    }, { lineas: 0, programas: 0, proyectos: 0, actividadesGenerales: 0, actividades: 0 });
  }

  function renderVigenciaSummary() {
    const totals = summaryTotals();
    const active = vinculadas.filter((item) => item.estado === "activa").length;
    summaryContainer.innerHTML = `
      <article class="tracking-summary-card primary">
        <span>Consejerías</span>
        <strong>${vinculadas.length}</strong>
        <small>${active} activa${active === 1 ? "" : "s"} en la vigencia</small>
      </article>
      <article class="tracking-summary-card">
        <span>Líneas de acción</span>
        <strong>${totals.lineas}</strong>
        <small>Estructura vinculada</small>
      </article>
      <article class="tracking-summary-card">
        <span>Programas</span>
        <strong>${totals.programas}</strong>
        <small>Programas registrados</small>
      </article>
      <article class="tracking-summary-card">
        <span>Proyectos / Actividades</span>
        <strong>${totals.proyectos + totals.actividadesGenerales}</strong>
        <small>${totals.proyectos} proyectos · ${totals.actividadesGenerales} actividades generales · ${totals.actividades} actividades internas</small>
      </article>
    `;
  }

  async function openWorkspace(record, { initialTab = "resumen" } = {}) {
    const vigencia = vigencias.find((item) => item.id === selectedVigenciaId);
    if (!record || !vigencia) return;

    listView.classList.add("hidden");
    container.querySelector("#activeConsejeriaWorkspace")?.remove();
    const workspaceHost = document.createElement("div");
    workspaceHost.id = "activeConsejeriaWorkspace";
    container.appendChild(workspaceHost);

    await renderConsejeriaWorkspace(workspaceHost, {
      vigencia,
      record,
      initialTab,
      progressMetric: progressMetrics.get(record.id) || null,
      onChanged: async () => {
        await renderLinked();
      },
      onBack: async () => {
        workspaceHost.remove();
        listView.classList.remove("hidden");
        await renderLinked();
      }
    });
  }

  async function renderLinked() {
    if (!selectedVigenciaId) {
      linkedContainer.innerHTML = `<div class="empty-state"><strong>No hay una vigencia disponible.</strong></div>`;
      summaryContainer.innerHTML = "";
      countChip.textContent = "0";
      return;
    }

    linkedContainer.innerHTML = `<div class="empty-state">Cargando Consejerías y estructura…</div>`;

    try {
      [vinculadas, progressMetrics, structureSummary] = await Promise.all([
        getVigenciaConsejerias(selectedVigenciaId),
        getConsejeriaProgressMap(selectedVigenciaId),
        getConsejeriaStructureSummaryMap(selectedVigenciaId)
      ]);

      const vigencia = vigencias.find((item) => item.id === selectedVigenciaId);
      title.textContent = vigencia ? `Consejerías · ${vigencia.nombre}` : "Consejerías vinculadas";
      countChip.textContent = String(vinculadas.length);
      renderVigenciaSummary();

      if (!vinculadas.length) {
        linkedContainer.innerHTML = `
          <div class="empty-state">
            <strong>Esta vigencia aún no tiene Consejerías vinculadas.</strong>
            <p>Usa <strong>+ Agregar Consejería a esta vigencia</strong> para incorporar una Consejería institucional a este periodo.</p>
          </div>
        `;
        return;
      }

      linkedContainer.innerHTML = `
        <div class="vigencia-consejerias-grid operational">
          ${vinculadas.map((item) => {
            const c = item.consejerias || {};
            const fallback = initials(item.responsable || c.nombre_corto || "ON");
            const metric = progressMetrics.get(item.id) || { progress: 0, coverage: 0, active: item.estado === "activa" };
            const progressState = getConsejeriaProgressState(metric);
            const hasMeasurement = metric.active !== false && Number(metric.coverage || 0) > 0;
            const structure = structureSummary.get(item.id) || { lineas: 0, programas: 0, proyectos: 0, actividadesGenerales: 0, actividades: 0 };
            return `
              <article class="vigencia-consejeria-card operational ${item.estado === "inactiva" ? "is-inactive" : ""}">
                <div class="vc-card-header">
                  <div class="consejero-photo-wrap">
                    ${mediaPreviewHTML({ url: item.foto_url, kind: "photo", fallback, alt: item.responsable || "Consejero/a" })}
                  </div>
                  <div class="vc-card-title">
                    <div class="vc-title-line">
                      <div class="entity-icon-wrap small">
                        ${mediaPreviewHTML({ url: c.icono_url, kind: "icon", fallback: initials(c.nombre_corto), alt: `Ícono de ${c.nombre_corto || "Consejería"}` })}
                      </div>
                      <div>
                        <p class="eyebrow">Consejería</p>
                        <h3>${escapeHTML(c.nombre_corto || c.nombre_largo || "Consejería")}</h3>
                        ${c.nombre_largo && c.nombre_largo !== c.nombre_corto ? `<p class="vc-card-long-name">${escapeHTML(c.nombre_largo)}</p>` : ""}
                      </div>
                    </div>
                  </div>
                  ${statusChip(item.estado)}
                </div>

                <div class="vc-card-body">
                  <div class="vc-operational-person">
                    <div class="vc-data"><span>Responsable</span><strong>${escapeHTML(item.responsable || "Sin registrar")}</strong></div>
                    <div class="vc-data"><span>Pueblo</span><strong>${escapeHTML(item.pueblo || "Sin registrar")}</strong></div>
                  </div>

                  <div class="vc-structure-strip" aria-label="Estructura de planeación">
                    <div><strong>${structure.lineas}</strong><span>Líneas</span></div>
                    <div><strong>${structure.programas}</strong><span>Programas</span></div>
                    <div><strong>${structure.proyectos}</strong><span>Proyectos</span></div>
                    <div><strong>${structure.actividadesGenerales + structure.actividades}</strong><span>Actividades</span></div>
                  </div>

                  <div class="vc-progress-row">
                    <div class="vc-data vc-plan-progress ${escapeHTML(progressState.key)}" style="--vc-progress-color:${escapeHTML(progressState.color)}">
                      <span>Avance del Plan</span>
                      <strong>${hasMeasurement ? formatConsejeriaProgress(metric.progress) : "—"}</strong>
                      <small>${escapeHTML(progressState.label)}</small>
                    </div>
                    <div class="vc-data vc-coverage-data">
                      <span>Cobertura de medición</span>
                      <strong>${metric.active === false ? "—" : formatConsejeriaProgress(metric.coverage)}</strong>
                    </div>
                  </div>
                </div>

                <div class="row-actions vc-card-actions">
                  <button class="btn btn-secondary edit-vigencia-consejeria" type="button" data-id="${item.id}">Editar datos de la vigencia</button>
                  <button class="btn btn-secondary open-consejeria-planner" type="button" data-id="${item.id}">Planeador</button>
                  <button class="btn btn-primary open-consejeria-workspace" type="button" data-id="${item.id}">Ver Consejería</button>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      `;

      linkedContainer.querySelectorAll(".open-consejeria-workspace").forEach((button) => {
        button.addEventListener("click", async () => {
          const record = vinculadas.find((item) => item.id === button.dataset.id);
          await openWorkspace(record);
        });
      });

      linkedContainer.querySelectorAll(".open-consejeria-planner").forEach((button) => {
        button.addEventListener("click", async () => {
          const record = vinculadas.find((item) => item.id === button.dataset.id);
          await openWorkspace(record, { initialTab: "planeador" });
        });
      });

      linkedContainer.querySelectorAll(".edit-vigencia-consejeria").forEach((button) => {
        button.addEventListener("click", () => {
          const record = vinculadas.find((item) => item.id === button.dataset.id);
          if (!record) return;
          openEditLinkForm({
            record,
            onSaved: renderLinked
          });
        });
      });
    } catch (error) {
      console.error(error);
      linkedContainer.innerHTML = `
        <div class="empty-state">
          <strong>No se pudo cargar la información de las Consejerías.</strong>
          <p>${escapeHTML(friendlyErrorMessage(error, "Error inesperado"))}</p>
        </div>
      `;
    }
  }

  try {
    vigencias = await getVigencias();
    selector.innerHTML = vigencias.length
      ? vigencias.map((v) => option(v.id, `${v.nombre}${v.estado === "activa" ? " · activa" : ""}`)).join("")
      : `<option value="">No hay vigencias</option>`;

    if (vigencias.length) {
      const requested = navigationTarget?.vigencia_id && vigencias.find((v) => v.id === navigationTarget.vigencia_id);
      const active = vigencias.find((v) => v.estado === "activa");
      selectedVigenciaId = requested?.id || active?.id || vigencias[0].id;
      selector.value = selectedVigenciaId;
    }

    addConsejeriaButton.disabled = !selectedVigenciaId;

    selector.addEventListener("change", async () => {
      selectedVigenciaId = selector.value;
      addConsejeriaButton.disabled = !selectedVigenciaId;
      await renderLinked();
    });

    addConsejeriaButton?.addEventListener("click", async () => {
      const vigencia = vigencias.find((item) => item.id === selectedVigenciaId);
      if (!vigencia) return;

      addConsejeriaButton.disabled = true;
      const previousLabel = addConsejeriaButton.textContent;
      addConsejeriaButton.textContent = "Cargando…";

      try {
        const catalogo = await getConsejerias();
        openLinkForm({
          vigencia,
          catalogo,
          vinculadas,
          onSaved: renderLinked
        });
      } catch (error) {
        console.error(error);
        openModal({
          title: "Agregar Consejería a esta vigencia",
          content: `<div class="empty-state"><strong>No fue posible cargar el catálogo de Consejerías.</strong><p>${escapeHTML(friendlyErrorMessage(error, "Intenta nuevamente."))}</p><button id="closeLinkLoadError" class="btn btn-secondary" type="button">Cerrar</button></div>`
        });
        document.querySelector("#closeLinkLoadError")?.addEventListener("click", closeModal);
      } finally {
        addConsejeriaButton.disabled = false;
        addConsejeriaButton.textContent = previousLabel;
      }
    });

    await renderLinked();

    if (navigationTarget?.vigencia_consejeria_id) {
      const targetRecord = vinculadas.find((item) => item.id === navigationTarget.vigencia_consejeria_id);
      if (targetRecord) {
        await openWorkspace(targetRecord, { initialTab: navigationTarget.consejeria_tab || "resumen" });
      }
    }
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <section class="panel" style="margin-top:0">
        <p class="eyebrow">Error</p>
        <h2>No fue posible cargar Consejerías</h2>
        <p class="muted">${escapeHTML(friendlyErrorMessage(error, "Intenta nuevamente."))}</p>
      </section>
    `;
  }
}

export async function renderConsejeriasAdmin(container, navigationTarget = null) {
  let catalogo = [];

  container.innerHTML = `
    <div class="page-actions configuration-consejerias-heading">
      <div>
        <p class="eyebrow">Catálogo institucional</p>
        <h2>Consejerías</h2>
        <p class="muted">Administra únicamente la definición institucional. La vinculación a periodos y los datos del consejero se gestionan desde el módulo Consejerías.</p>
      </div>
      <button id="newConsejeriaButton" class="btn btn-primary" type="button">+ Nueva Consejería</button>
    </div>

    <section class="panel" style="margin-top:0">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Estructura institucional</p>
          <h2>Consejerías disponibles</h2>
        </div>
        <span id="catalogCount" class="status-chip">0</span>
      </div>

      <div id="catalogoConsejerias" style="margin-top:18px">
        <div class="empty-state">Cargando…</div>
      </div>
    </section>
  `;

  const catalogContainer = container.querySelector("#catalogoConsejerias");
  const catalogCount = container.querySelector("#catalogCount");
  const newButton = container.querySelector("#newConsejeriaButton");

  async function loadCatalog() {
    catalogo = await getConsejerias();
    renderCatalog();
  }

  function renderCatalog() {
    catalogCount.textContent = String(catalogo.length);

    if (!catalogo.length) {
      catalogContainer.innerHTML = `
        <div class="empty-state">
          <strong>Aún no existe el catálogo de Consejerías.</strong>
          <p>Crea la primera Consejería institucional. Después podrá agregarse a una vigencia desde el módulo Consejerías.</p>
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
              <button class="btn btn-secondary edit-catalog" type="button" data-id="${item.id}">Editar</button>
              <button class="btn btn-danger delete-catalog" type="button" data-id="${item.id}">Eliminar</button>
            </div>
          </article>
        `).join("")}
      </div>
    `;

    catalogContainer.querySelectorAll(".edit-catalog").forEach((button) => {
      button.addEventListener("click", () => {
        const record = catalogo.find((item) => item.id === button.dataset.id);
        openConsejeriaForm({ record, onSaved: loadCatalog });
      });
    });

    catalogContainer.querySelectorAll(".delete-catalog").forEach((button) => {
      button.addEventListener("click", async () => {
        const record = catalogo.find((item) => item.id === button.dataset.id);
        await openDeleteConsejeriaDialog({
          record,
          onDeleted: loadCatalog,
          onInactivated: loadCatalog
        });
      });
    });
  }

  newButton.addEventListener("click", () => {
    openConsejeriaForm({ onSaved: loadCatalog });
  });

  try {
    await loadCatalog();
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <section class="panel" style="margin-top:0">
        <p class="eyebrow">Error</p>
        <h2>No fue posible cargar el catálogo de Consejerías</h2>
        <p class="muted">${escapeHTML(friendlyErrorMessage(error, "Intenta nuevamente."))}</p>
      </section>
    `;
  }
}
