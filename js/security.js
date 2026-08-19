import { requireSupabase } from "./supabaseClient.js";

let currentProfile = null;
let currentAssignments = [];
let permissionObserver = null;
let activeViewName = "inicio";
let observerTimer = null;

const ROLE_LABELS = {
  administrador: "Administrador",
  coordinador: "Coordinador",
  consejeria: "Consejería",
  consulta: "Consulta"
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || "Usuario";
}

export function getCurrentProfile() {
  return currentProfile;
}

export function getCurrentAssignments() {
  return [...currentAssignments];
}

export function isAdmin() {
  return currentProfile?.rol === "administrador" && currentProfile?.estado === "activo";
}

export function isCoordinator() {
  return currentProfile?.rol === "coordinador" && currentProfile?.estado === "activo";
}

export function isConsejeriaUser() {
  return currentProfile?.rol === "consejeria" && currentProfile?.estado === "activo";
}

export function isReadOnlyUser() {
  return currentProfile?.rol === "consulta" || currentProfile?.estado !== "activo";
}

export function canManageUsers() {
  return isAdmin();
}

export function canViewHistory() {
  return isAdmin() || isCoordinator();
}

export function canApproveWeights() {
  return isAdmin() || isCoordinator();
}

export function canManageGlobalStructure() {
  return isAdmin() || isCoordinator();
}

export async function loadCurrentUserProfile(session) {
  const supabase = requireSupabase();
  const userId = session?.user?.id;

  if (!userId) {
    throw new Error("No fue posible identificar al usuario de la sesión.");
  }

  const { data: profile, error } = await supabase
    .from("perfiles_usuario")
    .select("id,email,nombre,rol,estado,created_at,updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    const message = String(error.message || "").toLowerCase();
    if (message.includes("perfiles_usuario") || message.includes("schema cache")) {
      throw new Error(
        "La seguridad multiusuario todavía no está habilitada. Solicita al Administrador que revise la configuración de acceso."
      );
    }
    throw error;
  }

  if (!profile) {
    throw new Error(
      "Tu cuenta todavía no tiene un perfil de acceso. Solicita al Administrador que revise tu usuario."
    );
  }

  currentProfile = profile;

  if (profile.estado !== "activo") {
    currentAssignments = [];
    return profile;
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from("usuario_consejerias")
    .select("vigencia_consejeria_id")
    .eq("usuario_id", userId);

  if (assignmentsError) throw assignmentsError;
  currentAssignments = (assignments || []).map((row) => row.vigencia_consejeria_id);

  return profile;
}

export function clearSecuritySession() {
  currentProfile = null;
  currentAssignments = [];
  stopPermissionObserver();
}

export async function logSessionEvent(eventName) {
  try {
    const supabase = requireSupabase();
    await supabase.rpc("registrar_evento_sesion", { p_evento: eventName });
  } catch (error) {
    // El registro de sesión no debe impedir el uso normal del Sistema.
    console.warn("No fue posible registrar el evento de sesión.", error);
  }
}

export async function logManualEvent({
  action,
  entityType = "sistema",
  entityId = null,
  entityName = null,
  vigenciaId = null,
  vigenciaConsejeriaId = null,
  detail = {}
}) {
  try {
    const supabase = requireSupabase();
    await supabase.rpc("registrar_evento_manual", {
      p_accion: action,
      p_entidad_tipo: entityType,
      p_entidad_id: entityId,
      p_entidad_nombre: entityName,
      p_vigencia_id: vigenciaId,
      p_vigencia_consejeria_id: vigenciaConsejeriaId,
      p_detalle: detail || {}
    });
  } catch (error) {
    console.warn("No fue posible registrar el evento del historial.", error);
  }
}

export async function updateWithVersion({
  table,
  record,
  payload,
  entityType = "registro",
  entityName = null,
  vigenciaId = null,
  vigenciaConsejeriaId = null
}) {
  const supabase = requireSupabase();

  if (!record?.id) {
    throw new Error("No fue posible identificar el registro que se desea actualizar.");
  }

  const version = Number(record.row_version || 0);
  let query = supabase
    .from(table)
    .update(payload)
    .eq("id", record.id);

  if (version > 0) {
    query = query.eq("row_version", version);
  }

  const { data, error } = await query.select().maybeSingle();

  if (error) throw error;

  if (!data) {
    await logManualEvent({
      action: "conflicto_edicion",
      entityType,
      entityId: record.id,
      entityName: entityName || record.nombre || record.titulo || record.codigo || null,
      vigenciaId,
      vigenciaConsejeriaId,
      detail: {
        version_abierta: version || null
      }
    });

    const conflict = new Error(
      "Este registro fue modificado por otro usuario mientras lo estabas editando. Recarga la información, revisa los cambios actuales y vuelve a guardar."
    );
    conflict.code = "APP_EDIT_CONFLICT";
    throw conflict;
  }

  return data;
}

function hideElement(element) {
  if (!element) return;
  element.classList.add("security-hidden");
  element.setAttribute("aria-hidden", "true");
}

function showElement(element) {
  if (!element) return;
  element.classList.remove("security-hidden");
  element.removeAttribute("aria-hidden");
}

function hideAll(root, selectors = []) {
  selectors.forEach((selector) => {
    root.querySelectorAll(selector).forEach(hideElement);
  });
}

function mutationText(button) {
  return String(button.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function applyReadOnly(root) {
  const mutationPattern = /(^\+|guardar|crear|editar|eliminar|retirar|vincular|archivar|reactivar|registrar avance|nuevo seguimiento|nueva nota|aprobar|restablecer|ponderación sugerida|completar restante|importar vigencia|importar$|borrar|inactivar|marcar como cancelada)/i;

  root.querySelectorAll("button").forEach((button) => {
    const text = mutationText(button);
    const classText = button.className?.toString?.() || "";
    const id = button.id || "";

    if (
      mutationPattern.test(text) ||
      /(^|\s)(edit-|delete-|archive-|restore-|force-delete|new-)/.test(classText) ||
      /new|delete|edit|approve|import|link|retire/i.test(id)
    ) {
      hideElement(button);
    }
  });

  root.querySelectorAll("form").forEach((form) => {
    form.querySelectorAll('button[type="submit"]').forEach(hideElement);
  });
}

function applyConsejeriaRestrictions(viewName, root) {
  if (viewName === "vigencias") {
    hideAll(root, [
      "#newVigenciaButton",
      "#importVigenciaJsonButton",
      ".backup-vigencia",
      ".force-delete-vigencia"
    ]);
  }

  if (viewName === "mandatos") {
    hideAll(root, [
      "#importMandatosButton",
      "#moreMandatosButton",
      "#deleteAllMandatosButton",
      "#newMandatoButton",
      "#newFuenteButton",
      ".edit-mandato",
      ".delete-mandato",
      "#confirmImport",
      "#archiveProtectedMandato",
      "#confirmDeleteMandato"
    ]);
  }

  if (viewName === "consejerias") {
    hideAll(root, [
      "#newConsejeriaButton",
      "#linkConsejeriaButton",
      ".edit-catalog",
      ".delete-catalog",
      ".retire-consejeria",
      "#saveMandateAssignments",
      "#selectVisibleMandates",
      "#clearVisibleMandates"
    ]);

    root.querySelectorAll(".mandate-assignment-checkbox").forEach((input) => {
      input.disabled = true;
    });

    const vcState = root.querySelector("#vcState");
    if (vcState) {
      vcState.disabled = true;
      vcState.title = "El estado institucional es administrado por Coordinación.";
    }
  }

  if (viewName === "ponderaciones") {
    hideAll(root, [
      "#approveAllWeights",
      "#approvePonderacionBottom",
      "#confirmPonderacionApproval"
    ]);
  }
}

function applyCoordinatorRestrictions(viewName, root) {
  if (viewName === "vigencias") {
    hideAll(root, [".force-delete-vigencia"]);
  }
}

export function applyNavigationPermissions(navRoot = document) {
  const userNav = navRoot.querySelector('.nav-item[data-view="usuarios"]');
  const historyNav = navRoot.querySelector('.nav-item[data-view="historial"]');

  if (canManageUsers()) showElement(userNav); else hideElement(userNav);
  if (canViewHistory()) showElement(historyNav); else hideElement(historyNav);
}

export function applyViewPermissions(viewName, root = document) {
  activeViewName = viewName || activeViewName;

  root.querySelectorAll(".security-hidden").forEach((element) => {
    // Solo restablecemos elementos de vistas para volver a evaluar el rol actual.
    showElement(element);
  });

  if (isReadOnlyUser()) {
    applyReadOnly(root);
  } else if (isConsejeriaUser()) {
    applyConsejeriaRestrictions(activeViewName, root);
  } else if (isCoordinator()) {
    applyCoordinatorRestrictions(activeViewName, root);
  }
}

export function startPermissionObserver(root, getViewName = () => activeViewName) {
  stopPermissionObserver();
  if (!root) return;

  permissionObserver = new MutationObserver((mutations) => {
    const hasNewNodes = mutations.some((mutation) => mutation.addedNodes?.length);
    if (!hasNewNodes) return;
    clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      applyViewPermissions(getViewName(), root);
    }, 0);
  });

  permissionObserver.observe(root, { childList: true, subtree: true });
}

export function stopPermissionObserver() {
  if (permissionObserver) permissionObserver.disconnect();
  permissionObserver = null;
  clearTimeout(observerTimer);
}
