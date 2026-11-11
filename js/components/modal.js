import { confirmNavigationAway } from "./uiSystem.js?v=5.4.5";

const backdrop = document.querySelector("#modalBackdrop");
const body = document.querySelector("#modalBody");
const title = document.querySelector("#modalTitle");
const closeButton = document.querySelector("#modalClose");
const modal = backdrop?.querySelector(".modal");

export function openModal({ title: modalTitle, content, size = "default" }) {
  title.textContent = modalTitle;
  body.innerHTML = content;

  if (modal) {
    modal.classList.toggle("modal-wide", size === "wide");
    modal.classList.toggle("modal-large", size === "large");
  }
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
}

export function closeModal() {
  backdrop.classList.add("hidden");
  if (modal) modal.classList.remove("modal-wide", "modal-large");
  backdrop.setAttribute("aria-hidden", "true");
  body.innerHTML = "";
}

function requestCloseModal() {
  if (!confirmNavigationAway()) return;
  closeModal();
}

closeButton.addEventListener("click", requestCloseModal);

backdrop.addEventListener("click", (event) => {
  if (event.target === backdrop) requestCloseModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !backdrop.classList.contains("hidden")) {
    requestCloseModal();
  }
});
