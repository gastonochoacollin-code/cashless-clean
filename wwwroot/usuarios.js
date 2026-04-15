// CAUSA (P0): En el cambio de terminalId se perdiÃ³ este helper y el JS tronaba con ReferenceError,
// evitando cualquier llamada a /api/users. FIX: restaurar $() y documentar la ruta de Network.
requireUiPermission("users_manage");
function $(id){ return document.getElementById(id); }

// Evidencia/diagnostico: capturar errores tempranos de inicializacion
window.addEventListener("error", (ev) => {
  const msg = ev?.error?.message || ev?.message || "Error JS";
  try{
    if(statusEl) setStatus(`ERROR JS: ${msg} (revisa consola)`, true);
  }catch{}
  console.error("USERS_INIT_FAIL", ev?.error || ev);
});

const sessionInfoEl = $("sessionInfo");
const statusEl = $("status");

const btnRefresh = $("btnRefresh");
const btnLogout = $("btnLogout");
const btnGoBarra = $("btnGoBarra");
const btnExportUsers = $("btnExportUsers");
const btnResetAllBalances = $("btnResetAllBalances");

const qEl = $("q");
const tbody = $("tbody");
const countEl = $("count");
const jsDot = $("jsDot");
const btnNewUser = $("btnNewUser");
const userModal = $("userModal");
const btnCloseUserModal = $("btnCloseUserModal");
const btnCreateUser = $("btnCreateUser");
const createUserMsg = $("createUserMsg");
const userModalHelpEl = $("userModalHelp");
const newNameEl = $("newName");
const newEmailEl = $("newEmail");
const newPhoneEl = $("newPhone");
const systemUserFieldsEl = $("systemUserFields");
const newDisplayNameEl = $("newDisplayName");
const newUsernameEl = $("newUsername");
const newPinEl = $("newPin");
const newRoleEl = $("newRole");
const newIsActiveEl = $("newIsActive");

// Reasignacion UI
const selectedUserEl = $("selectedUser");
const btnTakeLastUid = $("btnTakeLastUid");
const uidPreviewEl = $("uidPreview");
const uidManualEl = $("uidManual");
const btnAssign = $("btnAssign");
const btnForceAssign = $("btnForceAssign");
const btnCardStatus = $("btnCardStatus");
const terminalControlsEl = $("terminalControls");
const cardReadControlsEl = $("cardReadControls");
const cardActionControlsEl = $("cardActionControls");
const cardRoleNoticeEl = $("cardRoleNotice");
let terminalBinding = null;
const USERS_TERMINAL_KEY = "cashless_users_terminalId";

function loadTerminalId(){
  return getTerminalId({ fallback: "BARRA-01" });
}

function loadSelectedTerminal(){
  const stored = normalizeTerminalId(localStorage.getItem(USERS_TERMINAL_KEY) || "");
  return stored || loadTerminalId();
}

function getActiveTerminalId(){
  return normalizeTerminalId(loadSelectedTerminal());
}

function getSelectedTerminal(){
  return getActiveTerminalId();
}

function setTerminalId(newId){
  return terminalBinding
    ? terminalBinding.save(newId || "BARRA-01")
    : saveTerminalId(newId || "BARRA-01");
}

function setSelectedTerminal(value){
  const clean = normalizeTerminalId(value || "");
  if(!clean){
    throw new Error("Selecciona una terminal valida.");
  }
  localStorage.setItem(USERS_TERMINAL_KEY, clean);
  return setTerminalId(clean);
}

function initTerminalSelect(){
  const select = $("terminalSelect");
  terminalBinding = bindTerminalUi(select, $("terminalLabel"), { fallback: "BARRA-01" });
  select?.addEventListener("change", () => setSelectedTerminal(select.value));
  setSelectedTerminal(loadSelectedTerminal());
}
const cardStatusEl = $("cardStatus");
const cardOwnerEl = $("cardOwner");
const cardBalanceEl = $("cardBalance");

let session = null;
let users = [];
let selectedUser = null;
let selectedUid = null;
let pendingForce = null;

function canManageUserCards(){
  return currentRoleName() === "Cajero";
}

function setStatus(msg, isError = false){
  if(!statusEl) return;
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
  statusEl.classList.toggle("ok", !isError);
}

function errLabel(e){
  const status = Number(e?.status || 0) || 0;
  const msg = String(e?.message || "Error inesperado");
  const url = String(e?.url || `${API_BASE}${window.location.pathname}`);
  return `ERROR ${status}: ${msg} (URL: ${url})`;
}

function getSession(){
  const raw = localStorage.getItem("cashless.session");
  if(!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function isAdminRole(role){
  if(typeof roleHasPermission === "function"){
    return roleHasPermission("users_manage", role);
  }
  const r = String(role || "").trim().toLowerCase();
  return r === "admin" || r === "superadmin" || r === "jefeoperativo" || r === "cajero";
}

function canCreateSystemUsers(role){
  const r = String(role || "").trim().toLowerCase();
  return r === "admin" || r === "superadmin";
}

function canExportUsers(role){
  const roleName = normalizeRoleName(role || "");
  return roleName === "SuperAdmin" || roleName === "Admin" || roleName === "JefeOperativo";
}

function canResetBalances(role){
  const roleName = normalizeRoleName(role || "");
  return roleName === "SuperAdmin" || roleName === "Admin";
}

function logout(){
  localStorage.removeItem("cashless.session");
  window.location.href = "/login.html";
}

function goBarra(){ window.location.href = "/pos.html"; }

async function api(path, opts = {}){
  return await apiJson(path, opts);
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function money(n){
  const x = Number(n ?? 0);
  return "$" + x.toFixed(2);
}

function setResetButtonsDisabled(disabled){
  if(btnResetAllBalances) btnResetAllBalances.disabled = !!disabled;
  tbody?.querySelectorAll("button[data-reset-balance]").forEach(btn => {
    btn.disabled = !!disabled;
  });
}

function setSelectedUser(u){
  selectedUser = u;
  selectedUserEl.textContent = u ? `#${u.id} - ${u.name}` : "Ninguno";
  updateAssignButtonState();
}

function setSelectedUid(uid){
  selectedUid = uid ? normalizeUid(uid) : null;
  uidPreviewEl.textContent = selectedUid || "-";
  pendingForce = null;
  if(btnForceAssign) btnForceAssign.style.display = "none";
  if(cardStatusEl) cardStatusEl.textContent = selectedUid ? "Pendiente de validar" : "-";
  if(cardOwnerEl) cardOwnerEl.textContent = "-";
  if(cardBalanceEl) cardBalanceEl.textContent = "-";
  updateAssignButtonState();
}

function setCreateUserMsg(msg, isError=false){
  if(!createUserMsg) return;
  createUserMsg.textContent = msg || "";
  createUserMsg.style.color = isError ? "#ffd1d1" : "#9aa0a6";
}

function openUserModal(){
  if(!userModal) return;
  syncUserModalMode();
  userModal.classList.add("open");
  userModal.setAttribute("aria-hidden", "false");
  setCreateUserMsg("");
}

function closeUserModal(){
  if(!userModal) return;
  userModal.classList.remove("open");
  userModal.setAttribute("aria-hidden", "true");
  setCreateUserMsg("");
}

function wantsSystemUserPayload(){
  return !!(
    (newDisplayNameEl?.value || "").trim()
    || (newUsernameEl?.value || "").trim()
    || (newPinEl?.value || "").trim()
    || (newRoleEl?.value || "").trim()
  );
}

function syncUserModalMode(){
  const canManageSystemUsers = canCreateSystemUsers(session?.role);
  if(systemUserFieldsEl) systemUserFieldsEl.style.display = canManageSystemUsers ? "" : "none";
  if(userModalHelpEl){
    userModalHelpEl.textContent = canManageSystemUsers
      ? "Crea usuarios del festival. Si llenas datos de sistema, se crea un colaborador."
      : "Crea usuarios del festival para registro y asignacion de pulseras.";
  }
}

function validateNewUser(){
  const canManageSystemUsers = canCreateSystemUsers(session?.role);
  if(!canManageSystemUsers || !wantsSystemUserPayload()){
    const name = (newNameEl?.value || "").trim();
    if(!name) return "Nombre requerido.";
    return "";
  }

  const username = (newUsernameEl?.value || "").trim();
  const displayName = (newDisplayNameEl?.value || "").trim();
  const pin = (newPinEl?.value || "").trim();
  const role = (newRoleEl?.value || "").trim();

  if(!displayName && !username) return "Nombre y usuario requeridos.";
  if(!username) return "Usuario requerido.";
  if(/\s/.test(username)) return "Usuario no debe contener espacios.";
  if(!displayName) return "Nombre requerido.";
  if(displayName.toLowerCase() !== username.toLowerCase())
    return "Nombre y usuario deben coincidir (compatibilidad).";
  if(!pin || pin.length < 4 || pin.length > 6 || !/^[0-9]+$/.test(pin))
    return "PIN requerido (4-6 dígitos).";
  if(!role) return "Rol requerido.";
  return "";
}

async function createUser(){
  const err = validateNewUser();
  if(err) { setCreateUserMsg(err, true); return; }

  const canManageSystemUsers = canCreateSystemUsers(session?.role);
  const isSystemUser = canManageSystemUsers && wantsSystemUserPayload();
  const payload = isSystemUser
    ? {
        displayName: (newDisplayNameEl?.value || "").trim(),
        username: (newUsernameEl?.value || "").trim(),
        pin: (newPinEl?.value || "").trim(),
        role: (newRoleEl?.value || "").trim(),
        isActive: !!newIsActiveEl?.checked
      }
    : {
        name: (newNameEl?.value || "").trim(),
        email: (newEmailEl?.value || "").trim() || null,
        phone: (newPhoneEl?.value || "").trim() || null
      };

  setCreateUserMsg(isSystemUser ? "Creando colaborador..." : "Creando usuario...");
  try{
    const created = await api("/api/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setCreateUserMsg(`OK - Usuario creado (#${created?.id || "?"})`);
    if(newNameEl) newNameEl.value = "";
    if(newEmailEl) newEmailEl.value = "";
    if(newPhoneEl) newPhoneEl.value = "";
    if(newDisplayNameEl) newDisplayNameEl.value = "";
    if(newUsernameEl) newUsernameEl.value = "";
    if(newPinEl) newPinEl.value = "";
    if(newRoleEl) newRoleEl.value = "";
    if(newIsActiveEl) newIsActiveEl.checked = true;
    await refresh();
    closeUserModal();
  }catch(e){
    setCreateUserMsg(errLabel(e), true);
  }
}

function updateAssignButtonState(){
  if(!canManageUserCards()){
    btnAssign.disabled = true;
    return;
  }
  const terminalId = getActiveTerminalId();
  const manual = normalizeUid(uidManualEl.value);
  const uidToUse = manual || selectedUid;
  btnAssign.disabled = !(terminalId && selectedUser && uidToUse && uidToUse.length >= 4);
}

async function fetchLastUidByTerminal(terminalId){
  const tid = normalizeTerminalId(terminalId || "");
  if(!tid){
    throw new Error("Selecciona una terminal antes de leer la pulsera.");
  }
  return await apiGetLastUid(tid);
}

async function getLastUid(terminalId){
  return await fetchLastUidByTerminal(terminalId);
}

function applyCashierCardGating(){
  const canManageCards = canManageUserCards();
  const controls = [
    $("terminalSelect"),
    $("terminalSave"),
    btnTakeLastUid,
    uidManualEl,
    btnAssign,
    btnForceAssign,
    btnCardStatus
  ];

  for(const control of controls){
    if(control) control.disabled = !canManageCards;
  }

  if(terminalControlsEl) terminalControlsEl.style.display = canManageCards ? "flex" : "none";
  if(cardReadControlsEl) cardReadControlsEl.style.display = canManageCards ? "flex" : "none";
  if(cardActionControlsEl) cardActionControlsEl.style.display = canManageCards ? "flex" : "none";
  if(cardRoleNoticeEl) cardRoleNoticeEl.style.display = canManageCards ? "none" : "block";

  if(!canManageCards){
    setSelectedUid(null);
  }

  updateAssignButtonState();
}

function uidShort(uid){
  const clean = normalizeUid(uid);
  if(clean.length <= 6) return clean || "-";
  return `${clean.slice(0, 4)}...${clean.slice(-2)}`;
}

function makeHttpError(status, message, url, data = null, method = "GET", statusText = ""){
  const err = new Error(message || `Error ${status}`);
  err.status = status;
  err.statusText = statusText || "";
  err.url = String(url || "");
  err.method = String(method || "GET").toUpperCase();
  err.data = data;
  return err;
}

async function requestJson(path, options = {}){
  const method = String(options?.method || "GET").toUpperCase();
  const url = `${API_BASE}${path}`;
  const res = await apiFetch(path, options);
  const text = await res.text().catch(() => "");
  let data = null;
  try{ data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  const msg = data?.message || res.statusText || `Error ${res.status}`;
  return { res, data, msg, method, url };
}

async function postAssign(userId, uid){
  const routes = ["/api/cards/assign", "/api/assign-card", "/assign-card"];
  for(const path of routes){
    const method = "POST";
    const url = `${API_BASE}${path}`;
    const hdr = apiHeaders();
    console.log("ASSIGN_REQUEST", {
      url,
      method,
      hasTenant: !!hdr["X-Tenant-Id"],
      hasFestival: !!hdr["X-Festival-Id"],
      hasAuth: !!hdr["Authorization"],
      hasOpToken: !!hdr["X-Operator-Token"],
      terminalId: getTerminalId(),
      userId,
      uidShort: uidShort(uid)
    });

    const { res, data, msg } = await requestJson(path, {
      method,
      body: JSON.stringify({ userId, uid })
    });

    if(res.status === 404) continue;
    if(!res.ok) throw makeHttpError(res.status, msg, url, data, method, res.statusText);
    return data;
  }

  throw makeHttpError(404, "Not Found", `${API_BASE}/api/assign-card`, null, "POST", "Not Found");
}

async function postReassign(userId, uid){
  const routes = ["/api/cards/reassign", "/api/reassign-card", "/reassign-card"];
  for(const path of routes){
    const method = "POST";
    const url = `${API_BASE}${path}`;
    const hdr = apiHeaders();
    console.log("ASSIGN_REQUEST", {
      url,
      method,
      hasTenant: !!hdr["X-Tenant-Id"],
      hasFestival: !!hdr["X-Festival-Id"],
      hasAuth: !!hdr["Authorization"],
      hasOpToken: !!hdr["X-Operator-Token"],
      terminalId: getTerminalId(),
      userId,
      uidShort: uidShort(uid)
    });

    const { res, data, msg } = await requestJson(path, {
      method,
      body: JSON.stringify({ userId, uid, reason: "Perdida / reasignacion desde usuarios.html" })
    });

    if(res.status === 404) continue;
    if(!res.ok) throw makeHttpError(res.status, msg, url, data, method, res.statusText);
    return data;
  }

  throw makeHttpError(404, "Not Found", `${API_BASE}/api/reassign-card`, null, "POST", "Not Found");
}

async function getCardByUid(uid){
  const clean = normalizeUid(uid);
  try{
    return await api(`/api/cards/${encodeURIComponent(clean)}`, { method: "GET" });
  }catch(e){
    if(Number(e?.status || 0) !== 404) throw e;
    return await api(`/cards/${encodeURIComponent(clean)}`, { method: "GET" });
  }
}

function getCurrentUidInput(){
  const manual = normalizeUid(uidManualEl?.value || "");
  return manual || selectedUid || "";
}

async function checkCardStatus(){
  const uid = getCurrentUidInput();
  if(!uid){
    setStatus("Captura o lee un UID para consultar.", true);
    return;
  }

  setStatus("Consultando estado de tarjeta...");
  try{
    const card = await getCardByUid(uid);
    if(cardStatusEl) cardStatusEl.textContent = "Asignada";
    if(cardOwnerEl) cardOwnerEl.textContent = card.userName || "-";
    if(cardBalanceEl) cardBalanceEl.textContent = money(card.balance);
    setStatus(`OK - Asignada a ${card.userName} (saldo: ${money(card.balance)})`);
  }catch(e){
    if(Number(e?.status || 0) === 404){
      if(cardStatusEl) cardStatusEl.textContent = "No asignada";
      if(cardOwnerEl) cardOwnerEl.textContent = "-";
      if(cardBalanceEl) cardBalanceEl.textContent = "-";
      setStatus("Tarjeta no asignada");
      return;
    }
    setStatus(errLabel(e), true);
  }
}

function matchesQuery(u, q){
  if(!q) return true;
  const t = q.toLowerCase();
  return (
    (u.name || "").toLowerCase().includes(t) ||
    (u.email || "").toLowerCase().includes(t) ||
    (u.phone || "").toLowerCase().includes(t)
  );
}

function render(){
  const q = (qEl.value || "").trim();
  const filtered = users.filter(u => matchesQuery(u, q));
  countEl.textContent = String(filtered.length);
  const canEditUsers = !canManageUserCards();
  const canResetUserBalances = canResetBalances(session?.role);

  if(filtered.length === 0){
    tbody.innerHTML = `<tr><td colspan="8" class="muted">Sin resultados</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(u => `
    <tr>
      <td class="mono">${u.id}</td>
      <td>${esc(u.name)}</td>

      <td>
        <span class="jsEmailView">${esc(u.email ?? "-")}</span>
        <input class="jsEmailEdit" style="display:none; width:100%; min-width:220px;"
               value="${esc(u.email ?? "")}" placeholder="email@..." />
      </td>

      <td class="mono">
        <span class="jsPhoneView">${esc(u.phone ?? "-")}</span>
        <input class="jsPhoneEdit mono" style="display:none; width:100%; min-width:140px;"
               value="${esc(u.phone ?? "")}" placeholder="telefono" />
      </td>

      <td class="mono">${money(u.balance)}</td>
      <td class="mono">${money(u.totalSpent ?? u.totalspent ?? 0)}</td>
      <td class="muted mono">${esc(u.createdAt)}</td>

      <td>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btnSmall alt" data-pick="${u.id}">Asignar tarjeta</button>
          <button class="btnSmall alt" data-repick="${u.id}">Reasignar</button>
          ${canResetUserBalances ? `<button class="btnSmall red" data-reset-balance="${u.id}">Reset saldo</button>` : ""}
          ${canEditUsers ? `<button class="btnSmall alt" data-edit="${u.id}">Editar</button>` : ""}
          ${canEditUsers ? `<button class="btnSmall green" data-save="${u.id}" style="display:none;">Guardar</button>` : ""}
          ${canEditUsers ? `<button class="btnSmall red" data-cancel="${u.id}" style="display:none;">Cancelar</button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");
  console.log("USERS_RENDER_OK", { count: filtered.length });

  tbody.querySelectorAll("button[data-pick]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-pick"));
      const u = users.find(x => x.id === id);
      setSelectedUser(u || null);
      setStatus(u ? `Seleccionado: #${u.id} ${u.name}` : "Selecciona un usuario");
    });
  });

  tbody.querySelectorAll("button[data-repick]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-repick"));
      const u = users.find(x => x.id === id);
      setSelectedUser(u || null);
      setStatus(u ? `Reasignar pulsera para #${u.id} ${u.name}` : "Selecciona un usuario");
    });
  });

  tbody.querySelectorAll("button[data-reset-balance]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-reset-balance"));
      const u = users.find(x => x.id === id);
      resetUserBalance(u || { id });
    });
  });

  tbody.querySelectorAll("button[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => toggleEditRow(btn, true));
  });
  tbody.querySelectorAll("button[data-cancel]").forEach(btn => {
    btn.addEventListener("click", () => toggleEditRow(btn, false, true));
  });
  tbody.querySelectorAll("button[data-save]").forEach(btn => {
    btn.addEventListener("click", () => saveRow(btn));
  });
}

function toggleEditRow(btn, editing, reset=false){
  const tr = btn.closest("tr");
  if(!tr) return;

  const emailView = tr.querySelector(".jsEmailView");
  const emailEdit = tr.querySelector(".jsEmailEdit");
  const phoneView = tr.querySelector(".jsPhoneView");
  const phoneEdit = tr.querySelector(".jsPhoneEdit");

  const editBtn = tr.querySelector('button[data-edit]');
  const saveBtn = tr.querySelector('button[data-save]');
  const cancelBtn = tr.querySelector('button[data-cancel]');

  if(editing){
    emailView.style.display = "none";
    phoneView.style.display = "none";
    emailEdit.style.display = "inline-block";
    phoneEdit.style.display = "inline-block";
    editBtn.style.display = "none";
    saveBtn.style.display = "inline-block";
    cancelBtn.style.display = "inline-block";
    emailEdit.focus();
  } else {
    if(reset){
      const id = Number(editBtn.getAttribute("data-edit"));
      const u = users.find(x => x.id === id);
      emailEdit.value = u?.email ?? "";
      phoneEdit.value = u?.phone ?? "";
    }

    emailView.style.display = "inline";
    phoneView.style.display = "inline";
    emailEdit.style.display = "none";
    phoneEdit.style.display = "none";
    editBtn.style.display = "inline-block";
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";
  }
}

async function saveRow(btn){
  if(canManageUserCards()){
    setStatus("Cajero no puede editar datos administrativos del usuario.", true);
    return;
  }
  const tr = btn.closest("tr");
  if(!tr) return;

  const saveBtn = tr.querySelector('button[data-save]');
  const editBtn = tr.querySelector('button[data-edit]');
  const id = Number((saveBtn || editBtn).getAttribute("data-save") || (saveBtn || editBtn).getAttribute("data-edit"));

  const emailEdit = tr.querySelector(".jsEmailEdit");
  const phoneEdit = tr.querySelector(".jsPhoneEdit");

  const newEmail = (emailEdit.value || "").trim();
  const newPhone = (phoneEdit.value || "").trim();

  setStatus(`Guardando contacto de usuario #${id}...`);
  try{
    const updated = await api(`/api/users/${id}/contact`, {
      method: "PUT",
      body: JSON.stringify({ email: newEmail || null, phone: newPhone || null })
    });

    users = users.map(u => u.id === id ? { ...u, email: updated.email, phone: updated.phone } : u);

    setStatus("OK - Contacto actualizado");
    render();
  } catch(e){
    setStatus(errLabel(e), true);
  }
}

async function refresh(){
  // DevTools Network (Usuarios):
  // - Request URL: /api/users
  // - Status: 200 OK (o 401/403)
  // - Response: lista JSON (array)
  // - Request Headers: X-Operator-Token / Authorization / X-Tenant-Id / X-Festival-Id
  setStatus("Cargando usuarios...");
  try{
    const path = "/api/users";
    const url = `${API_BASE}${path}`;
    const hdr = apiHeaders();
    console.log("USERS_FETCH", {
      url,
      hasTenant: !!hdr["X-Tenant-Id"],
      hasFestival: !!hdr["X-Festival-Id"],
      hasAuth: !!hdr["Authorization"],
      hasOpToken: !!hdr["X-Operator-Token"],
      terminalId: getTerminalId(),
      method: "GET"
    });

    users = await api(path, { method:"GET" });
    if(!Array.isArray(users)) users = [];

    if(users.length === 0){
      countEl.textContent = "0";
      tbody.innerHTML = `<tr><td colspan="8" class="muted">Sin usuarios en este tenant</td></tr>`;
      setStatus("Sin usuarios en este tenant");
      return;
    }

    setStatus(`OK - ${users.length} usuarios cargados`);
    render();
  } catch(e){
    const label = errLabel(e);
    countEl.textContent = "-";
    setStatus(label, true);
    tbody.innerHTML = `<tr><td colspan="8" class="muted">${esc(label)}</td></tr>`;
  }
}

function getDownloadFileName(res, fallback){
  const disposition = res.headers.get("Content-Disposition") || "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if(utf8Match?.[1]){
    try{ return decodeURIComponent(utf8Match[1].replace(/"/g, "")); }catch{}
  }

  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || fallback;
}

async function downloadUsersExcel(){
  setStatus("Generando Excel de usuarios...");
  if(btnExportUsers) btnExportUsers.disabled = true;

  try{
    const path = "/api/export/users-excel";
    const res = await apiFetch(path, {
      method: "GET",
      timeoutMs: 60000
    });

    if(!res.ok){
      let data = null;
      const text = await res.text().catch(() => "");
      try{ data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
      throw makeHttpError(
        res.status,
        data?.message || res.statusText || `Error ${res.status}`,
        `${API_BASE}${path}`,
        data,
        "GET",
        res.statusText
      );
    }

    const blob = await res.blob();
    const fallbackName = `users_export_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.xlsx`;
    const fileName = getDownloadFileName(res, fallbackName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus(`OK - Excel descargado: ${fileName}`);
  }catch(e){
    setStatus(errLabel(e), true);
  }finally{
    if(btnExportUsers) btnExportUsers.disabled = !canExportUsers(session?.role);
  }
}

async function resetUserBalance(user){
  if(!canResetBalances(session?.role)){
    setStatus("Solo Admin/SuperAdmin pueden resetear saldos.", true);
    return;
  }

  const id = Number(user?.id || 0);
  if(!id){
    setStatus("Usuario invalido para reset de saldo.", true);
    return;
  }

  const label = user?.name ? `#${id} ${user.name}` : `#${id}`;
  const ok = window.confirm(`¿Seguro que quieres resetear el saldo de este usuario a 0?\n\nUsuario: ${label}\nEsta accion no borra usuarios, tarjetas ni historial.`);
  if(!ok) return;

  setStatus(`Reseteando saldo de ${label}...`);
  setResetButtonsDisabled(true);

  try{
    const result = await api(`/api/users/${encodeURIComponent(id)}/reset-balance`, {
      method: "POST"
    });
    setStatus(`OK - ${result.message || "Saldo reseteado"} Saldo anterior: ${money(result.previousBalance)}.`);
    window.alert(`Saldo reseteado correctamente.\n\nUsuario: ${label}\nSaldo anterior: ${money(result.previousBalance)}\nNuevo saldo: ${money(result.newBalance)}`);
    await refresh();
  }catch(e){
    setStatus(errLabel(e), true);
    window.alert(`No se pudo resetear el saldo.\n\n${String(e?.message || "Error inesperado")}`);
  }finally{
    setResetButtonsDisabled(false);
  }
}

async function resetAllBalances(){
  if(!canResetBalances(session?.role)){
    setStatus("Solo Admin/SuperAdmin pueden ejecutar reset general de saldos.", true);
    return;
  }

  const first = window.confirm("Esta accion pondra en 0 el saldo de TODOS los usuarios. No borra usuarios, tarjetas ni historial. ¿Deseas continuar?");
  if(!first) return;

  const typed = window.prompt('Confirmacion final: escribe RESET para continuar con el reset general de saldos.');
  if(String(typed || "").trim().toUpperCase() !== "RESET"){
    setStatus("Reset general cancelado.");
    return;
  }

  setStatus("Ejecutando reset general de saldos...");
  setResetButtonsDisabled(true);

  try{
    const result = await api("/api/users/reset-all-balances", {
      method: "POST"
    });
    setStatus(`OK - ${result.message || "Reset general completado"} Total reseteado: ${money(result.totalPreviousBalance)}.`);
    window.alert(`Reset general completado.\n\nUsuarios afectados: ${result.affectedUsers}\nTotal reseteado: ${money(result.totalPreviousBalance)}`);
    await refresh();
  }catch(e){
    setStatus(errLabel(e), true);
    window.alert(`No se pudo ejecutar el reset general.\n\n${String(e?.message || "Error inesperado")}`);
  }finally{
    setResetButtonsDisabled(false);
  }
}

async function takeLastUid(){
  if(!canManageUserCards()){
    setStatus("Solo Cajero puede leer pulseras en esta seccion.", true);
    return;
  }
  setStatus("Leyendo ultima pulsera...");
  try{
    // DevTools Network (UID):
    // - Request URL: /api/last-uid?terminalId=...
    // - Status: 200 OK
    // - Response: { uid: "..." }
    // - Request Headers: X-Operator-Token / Authorization / X-Tenant-Id
    const tid = getSelectedTerminal();
    if(!tid){
      setStatus("Selecciona una terminal antes de leer la pulsera.", true);
      return;
    }
    const uid = await fetchLastUidByTerminal(tid);
    if(!uid){
      setSelectedUid(null);
      setStatus(`No hay pulsera leida en ${tid}. Acerca una tarjeta al lector correcto.`, true);
      return;
    }
    setSelectedUid(uid);
    setStatus(`UID capturado en ${tid}: ${normalizeUid(uid)}`);
  } catch(e){
    setStatus(errLabel(e), true);
  }
}

async function assignCard(forceReassign = false){
  const terminalId = getSelectedTerminal();
  const manual = normalizeUid(uidManualEl.value);
  const uidToUse = manual || selectedUid;

  if(!canManageUserCards()) { setStatus("Solo Cajero puede asignar o reasignar pulseras.", true); return; }
  if(!terminalId) { setStatus("Selecciona una terminal activa antes de asignar.", true); return; }
  if(!selectedUser) { setStatus("Selecciona un usuario."); return; }
  if(!uidToUse) { setStatus("Captura o pega un UID."); return; }

  setStatus(forceReassign ? "Reasignando pulsera..." : "Asignando pulsera...");
  try{
    if(forceReassign) await postReassign(selectedUser.id, uidToUse);
    else await postAssign(selectedUser.id, uidToUse);
    const card = await getCardByUid(uidToUse);

    uidManualEl.value = "";
    setSelectedUid(null);
    pendingForce = null;
    if(btnForceAssign) btnForceAssign.style.display = "none";

    setStatus(`OK - Asignada a ${card.userName} (saldo: ${money(card.balance)})`);
  } catch(e){
    if(!forceReassign && Number(e?.status || 0) === 409){
      pendingForce = { userId: selectedUser?.id, uid: uidToUse };
      if(btnForceAssign) btnForceAssign.style.display = "inline-block";
      setStatus(errLabel(e), true);
      return;
    }
    setStatus(errLabel(e), true);
  }
}

function init(){
  console.log("USERS_INIT_START");
  if(jsDot) jsDot.style.color = "#35ff7a";
  renderAppMenu("appMenu", "/usuarios.html");

  session = getSession();
  if(!session?.operatorId || !session?.token){
    setStatus("Sin sesion. Redirigiendo a login...");
    setTimeout(()=> window.location.href="/login.html", 600);
    return;
  }

  const fest = getFestivalId();
  if(sessionInfoEl){
    sessionInfoEl.textContent = `${session.name} - ${session.role} - tenant ${session.tenantId ?? "-"}${fest ? ` - festival ${fest}` : ""}`;
  }

  initTerminalSelect();
  applyCashierCardGating();
  if(btnNewUser){
    if(!isAdminRole(session?.role)){
      btnNewUser.disabled = true;
      btnNewUser.title = "Sin permiso para crear usuarios";
    }
    btnNewUser.addEventListener("click", openUserModal);
  }
  if(btnExportUsers){
    if(!canExportUsers(session?.role)){
      btnExportUsers.disabled = true;
      btnExportUsers.title = "Sin permiso para exportar usuarios";
    }
    btnExportUsers.addEventListener("click", downloadUsersExcel);
  }
  if(btnResetAllBalances){
    if(canResetBalances(session?.role)){
      btnResetAllBalances.style.display = "inline-block";
      btnResetAllBalances.addEventListener("click", resetAllBalances);
    }else{
      btnResetAllBalances.style.display = "none";
    }
  }
  syncUserModalMode();
  btnCloseUserModal?.addEventListener("click", closeUserModal);
  userModal?.addEventListener("click", (ev) => {
    if(ev.target === userModal) closeUserModal();
  });
  btnCreateUser?.addEventListener("click", createUser);

  $("terminalSave")?.addEventListener("click", () => {
    try{
      setSelectedTerminal($("terminalSelect")?.value || "");
      setStatus(`Terminal activa: ${getSelectedTerminal()}`);
    }catch(e){
      setStatus(String(e?.message || "No se pudo guardar la terminal."), true);
    }
  });

  btnRefresh?.addEventListener("click", () => {
    console.log("USERS_REFRESH_CLICK");
    refresh();
  });
  btnLogout?.addEventListener("click", logout);
  btnGoBarra?.addEventListener("click", goBarra);
  qEl?.addEventListener("input", render);

  btnTakeLastUid?.addEventListener("click", takeLastUid);
  uidManualEl?.addEventListener("input", () => {
    updateAssignButtonState();
    if(cardStatusEl) cardStatusEl.textContent = "Pendiente de validar";
    if(cardOwnerEl) cardOwnerEl.textContent = "-";
    if(cardBalanceEl) cardBalanceEl.textContent = "-";
  });
  btnAssign?.addEventListener("click", () => assignCard(false));
  btnForceAssign?.addEventListener("click", () => {
    if(!pendingForce?.userId || !pendingForce?.uid){
      setStatus("No hay conflicto pendiente para forzar.", true);
      return;
    }
    selectedUid = pendingForce.uid;
    assignCard(true);
  });
  btnCardStatus?.addEventListener("click", checkCardStatus);

    refresh();
  console.log("USERS_INIT_OK");
}

try{
  init();
}catch(e){
  console.error("USERS_INIT_FAIL", e);
  setStatus(`ERROR JS: ${String(e?.message || "init error")} (revisa consola)`, true);
}




