import { confirmNavigationAway } from "./uiSystem.js?v=5.3.0";

const backdrop = document.querySelector("#modalBackdrop");
const body = document.querySelector("#modalBody");
const title = document.querySelector("#modalTitle");
const closeButton = document.querySelector("#modalClose");

export function openModal({ title: modalTitle, content }) {
  title.textContent = modalTitle;
  body.innerHTML = content;
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
}

export function closeModal() {
  backdrop.classList.add("hidden");
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
