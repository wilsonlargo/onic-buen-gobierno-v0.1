import { renderConsejeriasAdmin } from "./consejerias.js?v=5.4.17";
import { renderUsuarios } from "./usuarios.js?v=5.4.17";

function escapeHTML(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function renderConfiguracion(container, navigationTarget = null) {
  let activeTab = navigationTarget?.config_tab || "consejerias";

  container.innerHTML = `
    <div class="page-actions configuration-heading">
      <div>
        <p class="eyebrow">Administración del sistema</p>
        <h2>Configuración</h2>
        <p class="muted">Administra la estructura institucional y los accesos. Estos cambios pueden afectar varias vigencias.</p>
      </div>
    </div>

    <nav class="configuration-tabs" aria-label="Secciones de configuración">
      <button type="button" data-config-tab="consejerias" class="${activeTab === "consejerias" ? "active" : ""}">Consejerías</button>
      <button type="button" data-config-tab="usuarios" class="${activeTab === "usuarios" ? "active" : ""}">Usuarios y permisos</button>
    </nav>

    <div id="configurationBody"></div>
  `;

  const body = container.querySelector("#configurationBody");
  const buttons = [...container.querySelectorAll("[data-config-tab]")];

  async function renderTab() {
    buttons.forEach((button) => {
      button.classList.toggle("active", button.dataset.configTab === activeTab);
    });

    body.innerHTML = `<div class="module-loading"><span class="loading-spinner" aria-hidden="true"></span><span>Cargando configuración…</span></div>`;

    try {
      if (activeTab === "usuarios") {
        await renderUsuarios(body);
      } else {
        await renderConsejeriasAdmin(body, navigationTarget);
      }
    } catch (error) {
      console.error(error);
      body.innerHTML = `
        <section class="panel" style="margin-top:0">
          <p class="eyebrow">Configuración</p>
          <h2>No fue posible cargar esta sección</h2>
          <p class="muted">${escapeHTML(error?.message || "Intenta nuevamente.")}</p>
        </section>
      `;
    }
  }

  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      activeTab = button.dataset.configTab;
      await renderTab();
    });
  });

  await renderTab();
}
