(() => {
  const session = requireSession();
  const roleName = currentRoleName();
  const isSuperAdmin = roleName === "SuperAdmin" && currentUserCan("permissions_manage");
  const canView = currentUserCan("permissions_view");
  const ROLES = ["SuperAdmin", "Admin", "JefeOperativo", "JefeDeBarra", "JefeDeStand", "CajeroDeBarra", "Cajero"];
  let operators = [];

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

  function normalized(){
    return operators.map((item) => ({
      id: item.id ?? item.Id,
      name: item.name ?? item.Name ?? "-",
      role: (typeof normalizeRoleName === "function"
        ? (normalizeRoleName(item.role ?? item.Role) || (item.role ?? item.Role))
        : (item.role ?? item.Role)) ?? "-",
      areaId: item.areaId ?? item.AreaId ?? null,
      area: item.area ?? item.Area ?? null,
      isActive: (item.isActive ?? item.IsActive) === true
    }));
  }

  function render(){
    const list = $("#list");
    if(!list) return;
    const q = String($("#q")?.value || "").trim().toLowerCase();
    const rows = normalized()
      .filter((item) => {
        if(!q) return true;
        return String(item.name).toLowerCase().includes(q)
          || String(item.role).toLowerCase().includes(q)
          || String(item.id).includes(q);
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    if(!rows.length){
      list.innerHTML = `<div class="muted">Sin colaboradores.</div>`;
      return;
    }

    list.innerHTML = rows.map((item) => {
      const isSelf = Number(item.id) === Number(session?.operatorId || 0);
      const disabled = !isSuperAdmin || isSelf;
      return `
        <div class="operator">
          <div>
            <div class="name">${escapeHtml(item.name)}</div>
            <div class="muted">ID ${escapeHtml(item.id)} | Rol actual: ${escapeHtml(item.role)} | Area ${escapeHtml(item.area || item.areaId || "-")} | ${item.isActive ? "Activo" : "Inactivo"}</div>
          </div>
          <div>
            <select class="field" data-role-id="${item.id}" ${disabled ? "disabled" : ""}>
              ${ROLES.map((role) => `<option value="${role}" ${role === item.role ? "selected" : ""}>${role}</option>`).join("")}
            </select>
          </div>
          <div>
            <button class="btn blue" data-save-id="${item.id}" ${disabled ? "disabled" : ""}>Guardar</button>
          </div>
        </div>
      `;
    }).join("");

    list.querySelectorAll("[data-save-id]").forEach((button) => {
      button.addEventListener("click", () => saveRole(Number(button.getAttribute("data-save-id"))));
    });
  }

  async function load(){
    if(!canView){
      setStatus("err", "No autorizado para esta pantalla.");
      return;
    }

    try{
      operators = await apiJson("/api/operators", { method:"GET" });
      render();
      setStatus(isSuperAdmin ? "" : "warn", isSuperAdmin ? "Listo para asignar roles." : "Vista de solo lectura. Solo SuperAdmin con permiso de administracion puede guardar.");
    }catch(error){
      operators = [];
      render();
      setStatus("err", `No se pudieron cargar colaboradores: ${error?.message || error}`);
    }
  }

  async function saveRole(id){
    if(!isSuperAdmin){
      setStatus("warn", "Solo SuperAdmin puede guardar cambios.");
      return;
    }

    const row = normalized().find((item) => Number(item.id) === Number(id));
    if(!row){
      setStatus("err", "Colaborador no encontrado.");
      return;
    }

    if(Number(row.id) === Number(session?.operatorId || 0)){
      setStatus("warn", "No puedes cambiar tu propio rol aqui.");
      return;
    }

    const select = $(`[data-role-id="${id}"]`);
    const nextRole = String(select?.value || row.role);
    if(nextRole === row.role){
      setStatus("warn", "No hay cambios por guardar.");
      return;
    }

    try{
      setStatus("", `Guardando rol de ${row.name}...`);
      await apiJson(`/api/operators/${id}`, {
        method:"PUT",
        body: JSON.stringify({
          name: row.name,
          role: nextRole,
          areaId: row.areaId,
          isActive: row.isActive
        })
      });
      await load();
      setStatus("ok", `Rol actualizado: ${row.name} ahora es ${nextRole}.`);
    }catch(error){
      if(select) select.value = row.role;
      setStatus("err", `No se pudo actualizar el rol: ${error?.message || error}`);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    renderAppMenu("appMenu", "/asignacion-roles.html");
    $("#q")?.addEventListener("input", render);
    $("#btnReload")?.addEventListener("click", () => load());
    load();
  });
})();
