import { supabaseClient, isSupabaseConfigured } from "./supabaseClient.js";
import { renderInicio } from "./modules/inicio.js";
import { renderVigencias } from "./modules/vigencias.js";
import { renderConsejerias } from "./modules/consejerias.js";
import { renderMandatos } from "./modules/mandatos.js";
import { renderLineas } from "./modules/lineas.js";
import { renderProgramas } from "./modules/programas.js";
import { renderProyectos } from "./modules/proyectos.js";
import { initAuditoria, clearAuditContext } from "./modules/auditoria.js";

const loginView = document.querySelector("#loginView");
const appView = document.querySelector("#appView");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const logoutButton = document.querySelector("#logoutButton");
const userEmail = document.querySelector("#userEmail");
const pageTitle = document.querySelector("#pageTitle");
const mainContent = document.querySelector("#mainContent");
const mainNav = document.querySelector("#mainNav");

const views = {
  inicio: {
    title: "Inicio",
    render: renderInicio
  },
  vigencias: {
    title: "Vigencias",
    render: renderVigencias
  },
  mandatos: {
    title: "Mandatos",
    render: renderMandatos
  },
  consejerias: {
    title: "Consejerías",
    render: renderConsejerias
  },
  lineas: {
    title: "Líneas de Acción",
    render: renderLineas
  },
  programas: {
    title: "Programas",
    render: renderProgramas
  },
  proyectos: {
    title: "Proyectos",
    render: renderProyectos
  }
};

function showLogin(message = "") {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  loginMessage.textContent = message;
}

async function showApp(session) {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  userEmail.textContent = session?.user?.email || "Usuario";

  initAuditoria({
    onNavigate: async (target) => {
      await navigate(target.view || "inicio", target);
    }
  });

  await navigate("inicio");
}

async function navigate(viewName, navigationTarget = null) {
  const selected = views[viewName];
  if (!selected) return;

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });

  pageTitle.textContent = selected.title;
  mainContent.innerHTML = `<div class="empty-state">Cargando…</div>`;
  clearAuditContext();

  try {
    await selected.render(mainContent, navigationTarget);
    mainContent.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    mainContent.innerHTML = `
      <section class="panel" style="margin-top: 0">
        <p class="eyebrow">Error</p>
        <h2>No fue posible cargar el módulo</h2>
        <p class="muted">${error.message || "Error inesperado"}</p>
      </section>
    `;
  }
}

mainNav.addEventListener("click", async (event) => {
  const button = event.target.closest(".nav-item");
  if (!button || button.disabled) return;
  await navigate(button.dataset.view);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";

  if (!isSupabaseConfigured) {
    loginMessage.textContent =
      "Primero configura la URL y la clave pública de Supabase en js/config.js.";
    return;
  }

  const email = loginForm.email.value.trim();
  const password = loginForm.password.value;

  const submit = loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Ingresando…";

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    await showApp(data.session);
  } catch (error) {
    console.error(error);
    loginMessage.textContent =
      error.message || "No fue posible iniciar sesión.";
  } finally {
    submit.disabled = false;
    submit.textContent = "Ingresar";
  }
});

logoutButton.addEventListener("click", async () => {
  if (!supabaseClient) return;

  await supabaseClient.auth.signOut();
  showLogin("Sesión cerrada.");
});

async function boot() {
  if (!isSupabaseConfigured) {
    showLogin(
      "Proyecto listo. Falta configurar Supabase en js/config.js."
    );
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

boot();
