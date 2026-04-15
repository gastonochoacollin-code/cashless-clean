(() => {
  const session = requireSession();
  requireUiPermission("users_manage", normalizeRoleName(session?.role || session?.Role) === "Cajero" ? "/dashboard-caja/" : "/dashboard.html");

  const roleName = currentRoleName();
  const isCashier = roleName === "Cajero";
  const $ = (id) => document.getElementById(id);

  const statusEl = $("status");
  const qEl = $("q");
  const fromUserEl = $("fromUser");
  const toUserEl = $("toUser");
  const amountEl = $("amount");
  const commentEl = $("comment");
  const userRowsEl = $("userRows");
  const historyRowsEl = $("historyRows");
  const fromBalanceEl = $("fromBalance");
  const toBalanceEl = $("toBalance");

  let users = [];
  let transfers = [];

  function money(value){
    return Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
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

  function fmtDate(value){
    if(!value) return "-";
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString("es-MX");
  }

  function setStatus(message, isError = false, isOk = false){
    if(!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", !!isError);
    statusEl.classList.toggle("ok", !!isOk && !isError);
  }

  function renderMenu(){
    if(isCashier) renderCashierMenu("appMenu", "/transferencias-saldo.html");
    else renderAppMenu("appMenu", "/transferencias-saldo.html");
  }

  function setSessionInfo(){
    const festivalId = session?.festivalId || getFestivalId() || "-";
    $("sessionInfo").textContent = `${session?.name || "Operador"} - ${session?.role || session?.Role || "-"} - tenant ${session?.tenantId ?? "-"} - festival ${festivalId}`;
  }

  function filteredUsers(){
    const q = String(qEl?.value || "").trim().toLowerCase();
    if(!q) return users;
    return users.filter((u) => (
      String(u?.name || "").toLowerCase().includes(q)
      || String(u?.email || "").toLowerCase().includes(q)
      || String(u?.phone || "").toLowerCase().includes(q)
      || String(u?.id || "").includes(q)
    ));
  }

  function renderUsers(){
    const list = filteredUsers();
    if(!userRowsEl) return;

    if(!list.length){
      userRowsEl.innerHTML = `<tr><td colspan="5" class="muted">Sin usuarios</td></tr>`;
      return;
    }

    userRowsEl.innerHTML = list.map((u) => `
      <tr>
        <td class="mono">#${u.id}</td>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email || "-")}</td>
        <td>${esc(u.phone || "-")}</td>
        <td class="mono">${money(u.balance)}</td>
      </tr>
    `).join("");
  }

  function fillUserSelect(selectEl, preferredValue = ""){
    if(!selectEl) return;
    const current = String(preferredValue || selectEl.value || "");
    selectEl.innerHTML = `<option value="">Selecciona</option>` + users.map((u) =>
      `<option value="${u.id}">#${u.id} - ${esc(u.name)} (${money(u.balance)})</option>`
    ).join("");
    if(current && Array.from(selectEl.options).some((opt) => opt.value === current)){
      selectEl.value = current;
    }
  }

  function userById(id){
    return users.find((u) => Number(u?.id || 0) === Number(id || 0)) || null;
  }

  function refreshBalances(){
    const fromUser = userById(fromUserEl?.value);
    const toUser = userById(toUserEl?.value);
    if(fromBalanceEl) fromBalanceEl.textContent = fromUser ? money(fromUser.balance) : "-";
    if(toBalanceEl) toBalanceEl.textContent = toUser ? money(toUser.balance) : "-";
  }

  async function loadUsers(){
    const previousFrom = String(fromUserEl?.value || "");
    const previousTo = String(toUserEl?.value || "");
    const data = await apiJson("/api/clients", { method: "GET" });
    users = Array.isArray(data) ? data : [];
    renderUsers();
    fillUserSelect(fromUserEl, previousFrom);
    fillUserSelect(toUserEl, previousTo);
    refreshBalances();
  }

  async function loadTransfers(){
    const data = await apiJson("/api/clients/transfers", { method: "GET" });
    transfers = Array.isArray(data) ? data : [];
    renderTransfers();
  }

  function renderTransfers(){
    if(!historyRowsEl) return;
    if(!transfers.length){
      historyRowsEl.innerHTML = `<tr><td colspan="6" class="muted">Sin transferencias</td></tr>`;
      return;
    }

    historyRowsEl.innerHTML = transfers.map((row) => `
      <tr>
        <td>${fmtDate(row?.createdAt)}</td>
        <td>#${row?.fromUserId || "-"} - ${esc(row?.fromUserName || "-")}</td>
        <td>#${row?.toUserId || "-"} - ${esc(row?.toUserName || "-")}</td>
        <td class="mono">${money(row?.amount)}</td>
        <td>${esc(row?.operatorName || "-")}</td>
        <td>${esc(row?.comment || "-")}</td>
      </tr>
    `).join("");
  }

  async function reloadAll(statusMessage = "Listo."){
    setStatus("Cargando datos...");
    try{
      await Promise.all([loadUsers(), loadTransfers()]);
      setStatus(statusMessage, false, true);
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudieron cargar datos"} (URL: ${e?.url || `${API_BASE}/api/clients`})`, true);
    }
  }

  async function transferBalance(){
    const fromUserId = Number(fromUserEl?.value || 0) || 0;
    const toUserId = Number(toUserEl?.value || 0) || 0;
    const amount = Math.max(0, Number(amountEl?.value || 0) || 0);
    const comment = String(commentEl?.value || "").trim();

    if(fromUserId <= 0){
      setStatus("Selecciona un usuario origen.", true);
      return;
    }
    if(toUserId <= 0){
      setStatus("Selecciona un usuario destino.", true);
      return;
    }
    if(fromUserId === toUserId){
      setStatus("Origen y destino deben ser distintos.", true);
      return;
    }
    if(amount <= 0){
      setStatus("Captura un monto valido.", true);
      return;
    }

    setStatus("Procesando transferencia...");
    try{
      const data = await apiJson("/api/clients/transfer-balance", {
        method: "POST",
        body: JSON.stringify({
          fromUserId,
          toUserId,
          amount,
          comment: comment || null
        })
      });

      if(commentEl) commentEl.value = "";
      if(amountEl) amountEl.value = "100";
      await reloadAll(`Transferencia realizada: ${money(data?.amount || amount)} de ${data?.fromUser?.name || "origen"} a ${data?.toUser?.name || "destino"}.`);
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo transferir saldo"} (URL: ${e?.url || `${API_BASE}/api/clients/transfer-balance`})`, true);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    renderMenu();
    setSessionInfo();
    fromUserEl?.addEventListener("change", refreshBalances);
    toUserEl?.addEventListener("change", refreshBalances);
    qEl?.addEventListener("input", renderUsers);
    $("btnTransfer")?.addEventListener("click", transferBalance);
    $("btnReloadUsers")?.addEventListener("click", () => reloadAll("Usuarios recargados."));
    $("btnReloadHistory")?.addEventListener("click", () => reloadAll("Historial recargado."));
    await reloadAll("Listo para transferir saldo.");
  });
})();
