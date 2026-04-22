(function () {
  const openButton = document.getElementById("openDemoModal");
  const modal = document.getElementById("demoModal");
  const form = document.getElementById("demoForm");
  const status = document.getElementById("demoFormStatus");

  if (!openButton || !modal || !form || !status) return;

  const closeButtons = modal.querySelectorAll("[data-demo-close]");
  const firstInput = form.querySelector("input, select, textarea, button");
  let lastFocusedElement = null;

  function setError(fieldName, message) {
    const error = form.querySelector(`[data-error-for="${fieldName}"]`);
    if (error) error.textContent = message || "";
  }

  function clearErrors() {
    form.querySelectorAll("[data-error-for]").forEach((error) => {
      error.textContent = "";
    });
    status.textContent = "";
    status.classList.remove("is-error");
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function getPayload() {
    const formData = new FormData(form);
    return {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      clientType: String(formData.get("clientType") || "Festival"),
      message: String(formData.get("message") || "").trim()
    };
  }

  function validate(payload) {
    let valid = true;
    clearErrors();

    if (!payload.name) {
      setError("name", "Ingresa tu nombre.");
      valid = false;
    }

    if (!payload.email) {
      setError("email", "Ingresa tu email.");
      valid = false;
    } else if (!isValidEmail(payload.email)) {
      setError("email", "Ingresa un email válido.");
      valid = false;
    }

    return valid;
  }

  function openModal() {
    lastFocusedElement = document.activeElement;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("demo-modal-open");
    window.setTimeout(() => {
      if (firstInput) firstInput.focus();
    }, 80);
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("demo-modal-open");

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  openButton.addEventListener("click", openModal);

  closeButtons.forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("is-open")) {
      closeModal();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const payload = getPayload();
    if (!validate(payload)) {
      status.textContent = "Revisa los campos marcados.";
      status.classList.add("is-error");
      return;
    }

    console.info("Solicitud demo Cashless Social", payload);
    form.reset();
    clearErrors();
    status.textContent = "Gracias, te contactaremos pronto.";
  });
})();
