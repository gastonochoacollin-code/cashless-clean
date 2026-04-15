(() => {
  const session = requireSession();
  const roleName = currentRoleName();
  const isSuperAdmin = roleName === "SuperAdmin" && currentUserCan("permissions_manage");

  function $(selector){
    return document.querySelector(selector);
  }

  function escapeHtml(value){
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(kind, message){
    const node = $("#status");
    if(!node) return;
    node.className = `status${kind ? ` ${kind}` : ""}`;
    node.textContent = message || "";
  }

  function cloneSchema(){
    return JSON.parse(JSON.stringify(getPermissionSchema()));
  }

  let state = cloneSchema();

  function render(){
    const thead = $("#tbl thead");
    const tbody = $("#tbl tbody");
    if(!thead || !tbody) return;

    thead.innerHTML = `
      <tr>
        <th style="min-width:320px;text-align:left">Permiso</th>
        ${state.roles.map((role) => `<th style="min-width:120px;text-align:center">${role.toUpperCase()}</th>`).join("")}
      </tr>
    `;

    tbody.innerHTML = state.permissions.map((permission) => `
      <tr>
        <td>
          <div class="perm-title">${escapeHtml(permission.title)}</div>
          <div class="perm-desc">${escapeHtml(permission.desc || "")}</div>
        </td>
        ${state.roles.map((role) => `
          <td style="text-align:center">
            <input
              class="toggle"
              type="checkbox"
              data-role="${role}"
              data-permission="${permission.key}"
              ${state.matrix?.[role]?.[permission.key] ? "checked" : ""}
              ${isSuperAdmin ? "" : "disabled"}
            >
          </td>
        `).join("")}
      </tr>
    `).join("");

    tbody.querySelectorAll("input[data-role][data-permission]").forEach((input) => {
      input.addEventListener("change", () => {
        const role = input.getAttribute("data-role");
        const permission = input.getAttribute("data-permission");
        if(!role || !permission || !state.matrix?.[role]) return;
        state.matrix[role][permission] = !!input.checked;
      });
    });

    $("#btnSave").disabled = !isSuperAdmin;
    $("#btnReset").disabled = !isSuperAdmin;
  }

  function save(){
    if(!isSuperAdmin){
      setStatus("warn", "Solo SuperAdmin puede guardar cambios.");
      return;
    }
    savePermissionSchema(state);
    setStatus("ok", "Permisos por rol guardados en este navegador.");
  }

  function reset(){
    if(!isSuperAdmin){
      setStatus("warn", "Solo SuperAdmin puede restaurar permisos.");
      return;
    }
    resetPermissionSchema();
    state = cloneSchema();
    render();
    setStatus("ok", "Permisos restaurados a la configuracion base.");
  }

  window.addEventListener("DOMContentLoaded", () => {
    renderAppMenu("appMenu", "/permisos.html");
    render();
    setStatus(isSuperAdmin ? "" : "warn", isSuperAdmin ? "Edita y guarda cambios por rol." : "Vista de solo lectura. Solo SuperAdmin con permiso de administracion puede editar.");
    $("#btnSave")?.addEventListener("click", save);
    $("#btnReset")?.addEventListener("click", reset);
  });
})();
