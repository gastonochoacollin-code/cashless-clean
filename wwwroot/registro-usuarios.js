(() => {
  const session = requireSession();
  requireUiPermission("users_manage", normalizeRoleName(session?.role || session?.Role) === "Cajero" ? "/dashboard-caja/" : "/dashboard.html");

  const roleName = currentRoleName();
  const isCashier = roleName === "Cajero";
  const $ = (id) => document.getElementById(id);

  const nameEl = $("name");
  const emailEl = $("email");
  const phoneEl = $("phone");
  const uidEl = $("uid");
  const uidPreviewEl = $("uidPreview");
  const qEl = $("q");
  const rowsEl = $("rows");
  const statusEl = $("status");
  const selectedUserEl = $("selectedUser");
  const btnAssign = $("btnAssign");
  const btnReassign = $("btnReassign");

  let users = [];
  let selectedUserId = null;

  function setStatus(message, isError = false, isOk = false){
    if(!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
    statusEl.classList.toggle("ok", !!isOk && !isError);
  }

  function esc(value){
    return String(value ?? "").replace(/[&<>\"']/g, (m) => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      "\"":"&quot;",
      "'":"&#039;"
    }[m]));
  }

  function normalizeCurrentUid(){
    const uid = normalizeUid(uidEl?.value || "");
    if(uidEl) uidEl.value = uid;
    if(uidPreviewEl) uidPreviewEl.textContent = uid || "-";
    btnAssign.disabled = !(selectedUserId && uid);
    if(btnReassign) btnReassign.disabled = !(selectedUserId && uid);
    return uid;
  }

  function renderMenu(){
    const host = $("appMenu");
    if(!host) return;

    const isAdmin = roleName === "Admin" || roleName === "SuperAdmin";
    const isOpsRole = roleName === "JefeOperativo" || roleName === "JefeDeBarra" || roleName === "JefeDeStand";
    const backHref = isCashier
      ? "/dashboard-caja/"
      : (isOpsRole && !isAdmin ? "/ops.html" : "/dashboard.html");
    const backLabel = isCashier
      ? "Dashboard Caja"
      : (isOpsRole && !isAdmin ? "Ops" : "Dashboard");
    const baseStyle = "display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:#2a2a3a;color:#fff;text-decoration:none;font-weight:800;border:1px solid rgba(255,255,255,.08)";
    const activeStyle = ";outline:1px solid rgba(47,124,255,.6);background:rgba(47,124,255,.18)";

    host.innerHTML = `
      <div class="brand" style="margin-right:8px">
        <img src="/assets/logo-horizontal.png" alt="Cashless Logo" class="logo-horizontal">
      </div>
      <a class="btn alt" href="${backHref}" style="${baseStyle}">${backLabel}</a>
      <a class="btn alt" href="/registro-usuarios.html" style="${baseStyle}${activeStyle}">Usuarios</a>
    `;
  }

  function setSessionInfo(){
    const festivalId = session?.festivalId || getFestivalId() || "-";
    $("sessionInfo").textContent = `${session?.name || "Operador"} - ${session?.role || session?.Role || "-"} - tenant ${session?.tenantId ?? "-"} - festival ${festivalId}`;
  }

  function pickUser(user){
    selectedUserId = user?.id || null;
    selectedUserEl.textContent = user ? `#${user.id} - ${user.name}` : "Ninguno";
    normalizeCurrentUid();
  }

  function filteredUsers(){
    const q = String(qEl?.value || "").trim().toLowerCase();
    if(!q) return users;
    return users.filter((u) => {
      return String(u?.name || "").toLowerCase().includes(q)
        || String(u?.email || "").toLowerCase().includes(q)
        || String(u?.phone || "").toLowerCase().includes(q)
        || String(u?.id || "").includes(q);
    });
  }

  function renderUsers(){
    const list = filteredUsers();
    if(!rowsEl) return;
    if(!Array.isArray(list) || list.length === 0){
      rowsEl.innerHTML = `<tr><td colspan="6" class="muted">Sin usuarios</td></tr>`;
      return;
    }

    rowsEl.innerHTML = list.map((u) => `
      <tr>
        <td class="mono">#${u.id}</td>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email || "-")}</td>
        <td>${esc(u.phone || "-")}</td>
        <td class="mono">${Number(u.balance || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}</td>
        <td><button class="btn alt" type="button" data-pick="${u.id}">Seleccionar</button></td>
      </tr>
    `).join("");

    rowsEl.querySelectorAll("button[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.getAttribute("data-pick"));
        const user = users.find((x) => Number(x.id) === id) || null;
        pickUser(user);
        setStatus(user ? `Seleccionado ${user.name}` : "Selecciona un usuario.");
      });
    });
  }

  async function loadUsers(){
    setStatus("Cargando usuarios...");
    try{
      const data = await apiJson("/api/clients", { method: "GET" });
      users = Array.isArray(data) ? data : [];
      renderUsers();
      setStatus(users.length ? `OK - ${users.length} usuarios cargados` : "Sin usuarios registrados", false, true);
    }catch(e){
      rowsEl.innerHTML = `<tr><td colspan="6" class="muted">${esc(`ERROR ${Number(e?.status || 0)}: ${e?.message || "Error"} (URL: ${e?.url || `${API_BASE}/api/clients`})`)}</td></tr>`;
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "Error"} (URL: ${e?.url || `${API_BASE}/api/clients`})`, true);
    }
  }

  async function takeLastUid(){
    setStatus("Leyendo ultima pulsera...");
    try{
      const uid = await apiGetLastUid();
      if(uidEl) uidEl.value = uid || "";
      normalizeCurrentUid();
      setStatus(uid ? `UID capturado: ${uid}` : "No hay pulsera leida");
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo leer UID"} (URL: ${e?.url || `${API_BASE}/api/last-uid`})`, true);
    }
  }

  async function assignCard(userId){
    const uid = normalizeCurrentUid();
    if(!userId){
      setStatus("Selecciona un usuario.", true);
      return false;
    }
    if(!uid){
      setStatus("UID requerido para asignar tarjeta.", true);
      return false;
    }

    try{
      await apiJson("/api/assign-card", {
        method: "POST",
        body: JSON.stringify({ userId, uid })
      });
      setStatus(`Tarjeta ${uid} asignada al usuario #${userId}`, false, true);
      return true;
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "Error al asignar"} (URL: ${e?.url || `${API_BASE}/api/assign-card`})`, true);
      return false;
    }
  }

  async function reassignCard(userId){
    const uid = normalizeCurrentUid();
    if(!userId){
      setStatus("Selecciona un usuario.", true);
      return false;
    }
    if(!uid){
      setStatus("UID requerido para reasignar tarjeta.", true);
      return false;
    }

    try{
      await apiJson("/api/reassign-card", {
        method: "POST",
        body: JSON.stringify({ userId, uid })
      });
      setStatus(`Tarjeta reasignada a ${uid} para el usuario #${userId}`, false, true);
      return true;
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "Error al reasignar"} (URL: ${e?.url || `${API_BASE}/api/reassign-card`})`, true);
      return false;
    }
  }

  async function createUser(){
    const name = String(nameEl?.value || "").trim();
    const email = String(emailEl?.value || "").trim();
    const phone = String(phoneEl?.value || "").trim();
    const uid = normalizeCurrentUid();

    if(!name){
      setStatus("Nombre requerido.", true);
      nameEl?.focus();
      return;
    }

    setStatus("Guardando usuario...");
    try{
      const created = await apiJson("/api/clients", {
        method: "POST",
        body: JSON.stringify({
          name,
          email: email || null,
          phone: phone || null
        })
      });

      pickUser(created || null);

      if(uid){
        const assigned = await assignCard(created?.id);
        if(!assigned) return;
      }else{
        setStatus(`Usuario creado: #${created?.id || "?"} ${created?.name || name}`, false, true);
      }

      if(nameEl) nameEl.value = "";
      if(emailEl) emailEl.value = "";
      if(phoneEl) phoneEl.value = "";
      await loadUsers();
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "Error al guardar"} (URL: ${e?.url || `${API_BASE}/api/clients`})`, true);
    }
  }

  function clearForm(){
    if(nameEl) nameEl.value = "";
    if(emailEl) emailEl.value = "";
    if(phoneEl) phoneEl.value = "";
    if(uidEl) uidEl.value = "";
    normalizeCurrentUid();
    setStatus("Formulario limpio.");
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderMenu();
    setSessionInfo();
    normalizeCurrentUid();

    $("btnRefresh")?.addEventListener("click", loadUsers);
    $("btnTakeUid")?.addEventListener("click", takeLastUid);
    $("btnCreate")?.addEventListener("click", createUser);
    $("btnClear")?.addEventListener("click", clearForm);
    $("btnAssign")?.addEventListener("click", () => assignCard(selectedUserId));
    $("btnReassign")?.addEventListener("click", () => reassignCard(selectedUserId));
    uidEl?.addEventListener("input", normalizeCurrentUid);
    qEl?.addEventListener("input", renderUsers);

    loadUsers();
  });
})();
