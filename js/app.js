import { supabaseClient, isSupabaseConfigured } from "./supabaseClient.js?v=5.2.0";
import { renderInicio } from "./modules/inicio.js?v=5.2.0";
import { renderVigencias } from "./modules/vigencias.js?v=5.2.0";
import { renderConsejerias } from "./modules/consejerias.js?v=5.2.0";
import { renderMandatos } from "./modules/mandatos.js?v=5.2.0";
import { renderSeguimientoMandatos } from "./modules/seguimientoMandatos.js?v=5.2.0";
import { renderMiTrabajo } from "./modules/miTrabajo.js?v=5.2.0";
import { renderControlCalidad } from "./modules/controlCalidad.js?v=5.2.0";
import { initGlobalSearch } from "./modules/buscadorGlobal.js?v=5.2.0";
import { renderLineas } from "./modules/lineas.js?v=5.2.0";
import { renderProgramas } from "./modules/programas.js?v=5.2.0";
import { renderProyectos } from "./modules/proyectos.js?v=5.2.0";
import { renderPonderaciones } from "./modules/ponderaciones.js?v=5.2.0";
import { renderCortesSeguimiento } from "./modules/cortesSeguimiento.js?v=5.2.0";
import { renderAlertasTareas } from "./modules/alertasTareas.js?v=5.2.0";
import { renderHistorial } from "./modules/historial.js?v=5.2.0";
import { renderUsuarios } from "./modules/usuarios.js?v=5.2.0";
import { initAuditoria, clearAuditContext } from "./modules/auditoria.js?v=5.2.0";
import {
  loadCurrentUserProfile,
  clearSecuritySession,
  roleLabel,
  canManageUsers,
  canViewHistory,
  applyNavigationPermissions,
  applyViewPermissions,
  startPermissionObserver,
  logSessionEvent
} from "./security.js?v=5.2.0";
import { friendlyErrorMessage } from "./userMessages.js?v=5.2.0";
import { initUserInterface, enhanceUserInterface } from "./components/uiSystem.js?v=5.2.0";

const loginView = document.querySelector("#loginView");
const appView = document.querySelector("#appView");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const logoutButton = document.querySelector("#logoutButton");
const userDisplayName = document.querySelector("#userDisplayName");
const userRoleLabel = document.querySelector("#userRoleLabel");
const pageTitle = document.querySelector("#pageTitle");
const mainContent = document.querySelector("#mainContent");
const mainNav = document.querySelector("#mainNav");
const sidebar = document.querySelector(".sidebar");
const mobileMenuButton = document.querySelector("#mobileMenuButton");
const mobileNavScrim = document.querySelector("#mobileNavScrim");

let currentViewName = "inicio";

const views = {
  inicio: { title: "Inicio", render: renderInicio },
  mi_trabajo: { title: "Mi trabajo", render: renderMiTrabajo },
  vigencias: { title: "Vigencias", render: renderVigencias },
  mandatos: { title: "Mandatos", render: renderMandatos },
  seguimiento_mandatos: { title: "Seguimiento de Mandatos", render: renderSeguimientoMandatos },
  consejerias: { title: "Consejerías", render: renderConsejerias },
  lineas: { title: "Líneas de Acción", render: renderLineas },
  programas: { title: "Programas", render: renderProgramas },
  proyectos: { title: "Proyectos", render: renderProyectos },
  ponderaciones: { title: "Ponderaciones", render: renderPonderaciones },
  cortes: { title: "Cortes de seguimiento", render: renderCortesSeguimiento },
  alertas: { title: "Alertas y tareas", render: (container, target) => renderAlertasTareas(container, target, { onNavigate: navigate }) },
  calidad: { title: "Control de calidad", render: renderControlCalidad },
  historial: { title: "Historial", render: renderHistorial },
  usuarios: { title: "Usuarios", render: renderUsuarios }
};

function isMobileLayout() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function setMobileNav(open) {
  if (!sidebar || !mobileMenuButton || !mobileNavScrim) return;
  const shouldOpen = Boolean(open) && isMobileLayout();
  sidebar.classList.toggle("mobile-open", shouldOpen);
  mobileNavScrim.classList.toggle("visible", shouldOpen);
  mobileNavScrim.setAttribute("aria-hidden", String(!shouldOpen));
  mobileMenuButton.setAttribute("aria-expanded", String(shouldOpen));
  mobileMenuButton.setAttribute("aria-label", shouldOpen ? "Cerrar menú principal" : "Abrir menú principal");
  document.body.classList.toggle("mobile-nav-open", shouldOpen);
}

function loginErrorMessage(error) {
  const raw = String(error?.message || "").toLowerCase();
  if (raw.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (raw.includes("email not confirmed")) return "El correo electrónico aún no ha sido confirmado.";
  return "No fue posible iniciar sesión. Intenta nuevamente.";
}

function showLogin(message = "") {
  clearSecuritySession();
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  loginMessage.textContent = message;
}

function viewAllowed(viewName) {
  if (viewName === "usuarios") return canManageUsers();
  if (viewName === "historial") return canViewHistory();
  return true;
}

async function showApp(session, { registerLogin = false } = {}) {
  try {
    const profile = await loadCurrentUserProfile(session);

    if (profile.estado !== "activo") {
      await supabaseClient.auth.signOut();
      showLogin("Tu acceso al Sistema está inactivo. Contacta al Administrador.");
      return;
    }

    loginView.classList.add("hidden");
    appView.classList.remove("hidden");

    userDisplayName.textContent = profile.nombre || profile.email || "Usuario";
    userRoleLabel.textContent = roleLabel(profile.rol);
    userDisplayName.title = profile.email || "";

    applyNavigationPermissions(document);
    enhanceUserInterface(mainNav);
    startPermissionObserver(mainContent, () => currentViewName);

    initAuditoria({
      onNavigate: async (target) => {
        await navigate(target.view || "inicio", target);
      }
    });

    initGlobalSearch({
      onNavigate: async (target) => {
        await navigate(target.view || "inicio", target);
      }
    });

    if (registerLogin) await logSessionEvent("iniciar_sesion");
    await navigate("inicio");
  } catch (error) {
    console.error(error);
    await supabaseClient?.auth?.signOut();
    showLogin(friendlyErrorMessage(error, "No fue posible validar tus permisos de acceso."));
  }
}

async function navigate(viewName, navigationTarget = null) {
  if (!viewAllowed(viewName)) viewName = "inicio";
  const selected = views[viewName];
  if (!selected) return;

  currentViewName = viewName;

  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.view === viewName;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });

  pageTitle.textContent = selected.title;
  mainContent.setAttribute("aria-busy", "true");
  mainContent.innerHTML = `<div class="module-loading"><span class="loading-spinner" aria-hidden="true"></span><span>Cargando ${selected.title.toLocaleLowerCase("es")}…</span></div>`;
  clearAuditContext();

  try {
    await selected.render(mainContent, navigationTarget);
    applyViewPermissions(viewName, mainContent);
    enhanceUserInterface(mainContent);
    window.scrollTo({ top: 0, behavior: "auto" });
    mainContent.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    mainContent.innerHTML = `
      <section class="panel module-error-panel" style="margin-top: 0">
        <p class="eyebrow">No disponible</p>
        <h2>No fue posible cargar este módulo</h2>
        <p class="muted">${friendlyErrorMessage(error, "Intenta nuevamente. Si el problema continúa, informa al Administrador del Sistema.")}</p>
        <button class="btn btn-secondary" type="button" data-retry-view="${viewName}">Intentar nuevamente</button>
      </section>
    `;
    mainContent.querySelector("[data-retry-view]")?.addEventListener("click", () => navigate(viewName, navigationTarget));
    enhanceUserInterface(mainContent);
  } finally {
    mainContent.setAttribute("aria-busy", "false");
  }
}

mainNav.addEventListener("click", async (event) => {
  const button = event.target.closest(".nav-item");
  if (!button || button.disabled || button.classList.contains("security-hidden")) return;
  setMobileNav(false);
  await navigate(button.dataset.view);
});

mobileMenuButton?.addEventListener("click", () => {
  setMobileNav(!sidebar?.classList.contains("mobile-open"));
});

mobileNavScrim?.addEventListener("click", () => setMobileNav(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebar?.classList.contains("mobile-open")) {
    setMobileNav(false);
    mobileMenuButton?.focus();
  }
});

window.addEventListener("resize", () => {
  if (!isMobileLayout()) setMobileNav(false);
});

window.addEventListener("app:navigate", async (event) => {
  const detail = event?.detail || {};
  if (!detail.view) return;
  await navigate(detail.view, detail.target || detail.navigationTarget || null);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";

  if (!isSupabaseConfigured) {
    loginMessage.textContent = "El Sistema no está disponible en este momento. Contacta al Administrador.";
    return;
  }

  const email = loginForm.email.value.trim();
  const password = loginForm.password.value;
  const submit = loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Ingresando…";

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await showApp(data.session, { registerLogin: true });
  } catch (error) {
    console.error(error);
    loginMessage.textContent = loginErrorMessage(error);
  } finally {
    submit.disabled = false;
    submit.textContent = "Ingresar";
  }
});

logoutButton.addEventListener("click", async () => {
  if (!supabaseClient) return;
  await logSessionEvent("cerrar_sesion");
  await supabaseClient.auth.signOut();
  showLogin("Sesión cerrada.");
});

async function boot() {
  if (!isSupabaseConfigured) {
    showLogin("El Sistema no está disponible en este momento. Contacta al Administrador.");
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error(error);
    showLogin("No se pudo validar la sesión.");
    return;
  }

  if (data.session) {
    await showApp(data.session);
  } else {
    showLogin();
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT") {
      showLogin();
    } else if (session && appView.classList.contains("hidden")) {
      await showApp(session);
    }
  });
}

initUserInterface();
boot();
