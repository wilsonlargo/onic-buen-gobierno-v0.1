import { requireSupabase } from "../supabaseClient.js";
import { openModal, closeModal } from "../components/modal.js";
import { roleLabel, getCurrentProfile } from "../security.js";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusChip(state) {
  return `<span class="status-chip ${state === "activo" ? "active" : "closed"}">${state === "activo" ? "Activo" : "Inactivo"}</span>`;
}

async function loadData() {
  const supabase = requireSupabase();

  const [profilesResult, vigenciasResult, vcResult, assignmentsResult] = await Promise.all([
    supabase
      .from("perfiles_usuario")
      .select("id,email,nombre,rol,estado,created_at,updated_at")
      .order("nombre", { ascending: true }),
    supabase
      .from("vigencias")
      .select("id,nombre,fecha_inicio,estado")
      .order("fecha_inicio", { ascending: false }),
    supabase
      .from("vigencia_consejerias")
      .select(`
        id,
        vigencia_id,
        estado,
        consejerias (
          id,
          nombre_corto,
          nombre_largo
        )
      `)
      .order("created_at", { ascending: true }),
    supabase
      .from("usuario_consejerias")
      .select("id,usuario_id,vigencia_consejeria_id")
  ]);

  const errors = [profilesResult.error, vigenciasResult.error, vcResult.error, assignmentsResult.error].filter(Boolean);
  if (errors.length) throw errors[0];

  return {
    profiles: profilesResult.data || [],
    vigencias: vigenciasResult.data || [],
    consejerias: (vcResult.data || []).filter((row) => row.consejerias),
    assignments: assignmentsResult.data || []
  };
}

async function saveProfile({ userId, name, role, state, vcIds }) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("guardar_perfil_usuario", {
    p_usuario_id: userId,
    p_nombre: name || null,
    p_rol: role,
    p_estado: state,
    p_vigencia_consejeria_ids: vcIds
  });
  if (error) throw error;
  return data;
}

function assignmentsFor(userId, rows) {
  return rows.filter((row) => row.usuario_id === userId).map((row) => row.vigencia_consejeria_id);
}

function openUserForm({ record, data, onSaved }) {
  const current = getCurrentProfile();
  const selected = new Set(assignmentsFor(record.id, data.assignments));
  const vcByVigencia = new Map();

  data.vigencias.forEach((vigencia) => vcByVigencia.set(vigencia.id, []));
  data.consejerias.forEach((vc) => {
    if (!vcByVigencia.has(vc.vigencia_id)) vcByVigencia.set(vc.vigencia_id, []);
    vcByVigencia.get(vc.vigencia_id).push(vc);
  });

  const assignmentHTML = data.vigencias.map((vigencia) => {
    const rows = vcByVigencia.get(vigencia.id) || [];
    if (!rows.length) return "";
    return `
      <div class="user-assignment-group">
        <div class="user-assignment-heading">
          <strong>${escapeHTML(vigencia.nombre)}</strong>
          <span>${vigencia.estado === "activa" ? "Activa" : escapeHTML(vigencia.estado || "")}</span>
        </div>
        <div class="user-assignment-options">
          ${rows.map((vc) => `
            <label class="project-mandate-check">
              <input
                type="checkbox"
                name="consejerias"
                value="${vc.id}"
                ${selected.has(vc.id) ? "checked" : ""}
              >
              <span>
                <strong>${escapeHTML(vc.consejerias.nombre_corto || vc.consejerias.nombre_largo)}</strong>
                <small>${vc.estado === "activa" ? "Activa en esta Vigencia" : "Inactiva en esta Vigencia"}</small>
              </span>
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  openModal({
    title: "Editar usuario",
    content: `
      <div class="modal-context-block">
        <span>Cuenta</span>
        <strong>${escapeHTML(record.email)}</strong>
        <p>Define el rol y el alcance de trabajo dentro del Sistema.</p>
      </div>

      <form id="userProfileForm">
        <div class="form-grid">
          <div class="form-field full">
            <label>Nombre</label>
            <input name="nombre" value="${escapeHTML(record.nombre || "")}" placeholder="Nombre de la persona">
          </div>
          <div class="form-field">
            <label>Rol</label>
            <select id="userRole" name="rol">
              <option value="administrador" ${record.rol === "administrador" ? "selected" : ""}>Administrador</option>
              <option value="coordinador" ${record.rol === "coordinador" ? "selected" : ""}>Coordinador</option>
              <option value="consejeria" ${record.rol === "consejeria" ? "selected" : ""}>Consejería</option>
              <option value="consulta" ${record.rol === "consulta" ? "selected" : ""}>Consulta</option>
            </select>
          </div>
          <div class="form-field">
            <label>Estado</label>
            <select name="estado">
              <option value="activo" ${record.estado === "activo" ? "selected" : ""}>Activo</option>
              <option value="inactivo" ${record.estado === "inactivo" ? "selected" : ""}>Inactivo</option>
            </select>
          </div>
        </div>

        <section id="userConsejeriasSection" class="user-assignment-section">
          <div class="workspace-section-heading">
            <div>
              <p class="eyebrow">Alcance institucional</p>
              <h3>Consejerías asignadas</h3>
              <p class="muted">Se utiliza únicamente para el rol Consejería. Puede asignarse más de una Consejería y en diferentes Vigencias.</p>
            </div>
          </div>
          ${assignmentHTML || `<div class="empty-state workspace-empty"><p>No hay Consejerías disponibles para asignar.</p></div>`}
        </section>

        ${record.id === current?.id ? `
          <div class="notice">
            Estás editando tu propio perfil. El Sistema no permitirá dejarlo sin un Administrador activo si es el único disponible.
          </div>
        ` : ""}

        <p id="userProfileMessage" class="form-message"></p>
        <div class="form-actions">
          <button id="cancelUserProfile" class="btn btn-secondary" type="button">Cancelar</button>
          <button class="btn btn-primary" type="submit">Guardar permisos</button>
        </div>
      </form>
    `
  });

  const form = document.querySelector("#userProfileForm");
  const role = document.querySelector("#userRole");
  const section = document.querySelector("#userConsejeriasSection");
  const message = document.querySelector("#userProfileMessage");

  const syncRole = () => {
    section.classList.toggle("is-disabled", role.value !== "consejeria");
    section.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.disabled = role.value !== "consejeria";
    });
  };

  role.addEventListener("change", syncRole);
  syncRole();
  document.querySelector("#cancelUserProfile").addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    const fd = new FormData(form);
    const userRole = fd.get("rol");
    const vcIds = userRole === "consejeria"
      ? [...form.querySelectorAll('input[name="consejerias"]:checked')].map((input) => input.value)
      : [];

    if (userRole === "consejeria" && !vcIds.length) {
      message.textContent = "Asigna al menos una Consejería para este rol.";
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Guardando…";

    try {
      await saveProfile({
        userId: record.id,
        name: fd.get("nombre")?.trim() || null,
        role: userRole,
        state: fd.get("estado"),
        vcIds
      });
      closeModal();
      await onSaved();
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "No fue posible actualizar los permisos del usuario.";
      submit.disabled = false;
      submit.textContent = "Guardar permisos";
    }
  });
}

export async function renderUsuarios(container) {
  container.innerHTML = `
    <div class="page-actions">
      <div>
        <p class="eyebrow">Administración de acceso</p>
        <h2>Usuarios</h2>
        <p class="muted">Administra roles, estado y Consejerías asignadas a las cuentas institucionales.</p>
      </div>
    </div>

    <section class="panel" style="margin-top:0">
      <div class="notice">
        Las cuentas de acceso se habilitan previamente por la administración institucional. En esta sección se define qué puede hacer cada usuario dentro del Sistema.
      </div>
      <div id="usersContent"><div class="empty-state">Cargando usuarios…</div></div>
    </section>
  `;

  const content = container.querySelector("#usersContent");

  async function refresh() {
    try {
      const data = await loadData();
      const assignmentMap = new Map();
      data.assignments.forEach((row) => {
        if (!assignmentMap.has(row.usuario_id)) assignmentMap.set(row.usuario_id, []);
        assignmentMap.get(row.usuario_id).push(row.vigencia_consejeria_id);
      });

      const active = data.profiles.filter((row) => row.estado === "activo").length;
      const admins = data.profiles.filter((row) => row.rol === "administrador" && row.estado === "activo").length;
      const councilUsers = data.profiles.filter((row) => row.rol === "consejeria" && row.estado === "activo").length;

      content.innerHTML = `
        <div class="tracking-summary-grid user-summary-grid">
          <div class="tracking-summary-card"><span>Usuarios</span><strong>${data.profiles.length}</strong></div>
          <div class="tracking-summary-card"><span>Activos</span><strong>${active}</strong></div>
          <div class="tracking-summary-card"><span>Administradores</span><strong>${admins}</strong></div>
          <div class="tracking-summary-card"><span>Usuarios de Consejería</span><strong>${councilUsers}</strong></div>
        </div>

        <div class="table-wrap user-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Consejerías</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${data.profiles.map((row) => {
                const count = (assignmentMap.get(row.id) || []).length;
                return `
                  <tr>
                    <td>
                      <strong>${escapeHTML(row.nombre || row.email)}</strong>
                      <small>${escapeHTML(row.email)}</small>
                    </td>
                    <td><span class="role-chip role-${escapeHTML(row.rol)}">${escapeHTML(roleLabel(row.rol))}</span></td>
                    <td>${statusChip(row.estado)}</td>
                    <td>${row.rol === "consejeria" ? `${count} asignada${count === 1 ? "" : "s"}` : "Acceso transversal"}</td>
                    <td><button class="btn btn-secondary edit-user" type="button" data-id="${row.id}">Editar</button></td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `;

      content.querySelectorAll(".edit-user").forEach((button) => {
        button.addEventListener("click", () => {
          const record = data.profiles.find((row) => row.id === button.dataset.id);
          if (!record) return;
          openUserForm({ record, data, onSaved: refresh });
        });
      });
    } catch (error) {
      console.error(error);
      content.innerHTML = `
        <div class="empty-state">
          <strong>No fue posible cargar los usuarios.</strong>
          <p>${escapeHTML(error.message || "Intenta nuevamente.")}</p>
        </div>
      `;
    }
  }

  await refresh();
}
