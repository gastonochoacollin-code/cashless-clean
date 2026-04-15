const session = requireSession();
const role = String(session?.role || session?.Role || "");
const normalizedRole = role.trim().toLowerCase();
const isAdmin = normalizedRole === "admin" || normalizedRole === "superadmin";
const isCashier = normalizedRole === "cajero" || normalizedRole === "cashier";
const isJefeOperativo = normalizedRole === "jefeoperativo";
const isJefeDeBarra = normalizedRole === "jefedebarra";
const isJefeDeStand = normalizedRole === "jefedestand";
const isBarBoss = isJefeDeBarra || isJefeDeStand;

function $(id){ return document.getElementById(id); }

function setSessionInfo(){
  const name = session?.name || session?.operatorName || "Operador";
  const roleText = role ? ` · ${role}` : "";
  const host = $("sessionInfo");
  if(host) host.textContent = `Sesion: ${name}${roleText}`;
}

function disableButton(btn, hintEl, msg){
  if(btn){
    btn.disabled = true;
    btn.title = msg || "pendiente";
  }
  if(hintEl) hintEl.textContent = msg || "pendiente";
}

function wireButton(btnId, url){
  const btn = $(btnId);
  if(!btn) return;
  btn.addEventListener("click", ()=> window.location.href = url);
}

function setupPosAccess(){
  const btn = $("btnPos");
  const hint = $("posHint");
  if(!btn) return;
  if(currentUserCan("pos_use") || currentUserCan("charge")){
    btn.disabled = false;
    btn.title = "";
    if(hint) hint.textContent = "Pantalla de cobro";
    btn.addEventListener("click", ()=> window.location.href = "/pos.html");
    return;
  }
  disableButton(btn, hint, "No autorizado para POS");
}

function setupCatalogAccess(){
  const card = $("catalogCard");
  const btn = $("btnCatalog");
  const hint = $("catalogHint");
  if(!isBarBoss && !currentUserCan("menus_manage") && !currentUserCan("areas_manage")){
    if(card) card.style.display = "none";
    return;
  }
  if(btn){
    if(hint && isBarBoss) hint.textContent = "Menu y catalogo operativo de tu barra";
    btn.addEventListener("click", ()=> window.location.href = "/menus.html");
  }
}

function setupBarReportsAccess(){
  const card = $("barReportsCard");
  const btn = $("btnBarReports");
  const hint = $("barReportsHint");
  if(!btn) return;

  if(isBarBoss || currentUserCan("reports_view")){
    btn.disabled = false;
    btn.title = "";
    if(hint && isBarBoss) hint.textContent = "Tu barra, ventas del dia y turnos de barra";
    btn.addEventListener("click", ()=> window.location.href = "/reportes-barra.html");
    return;
  }

  if(card) card.style.display = "none";
}

function setupInventoryAccess(){
  const card = $("inventoryCard");
  const btn = $("btnInventory");
  const hint = $("inventoryHint");
  if(!btn) return;

  if(isBarBoss || currentUserCan("menus_manage") || currentUserCan("areas_manage")){
    btn.disabled = false;
    btn.title = "";
    if(hint && isBarBoss) hint.textContent = "Vista base de almacen conectada a barras y menus";
    btn.addEventListener("click", ()=> window.location.href = "/inventarios.html");
    return;
  }

  if(card) card.style.display = "none";
}

function setupBarsAccess(){
  const card = $("barsCard");
  const btn = $("btnBars");
  const hint = $("barsHint");
  if(!btn) return;

  if(isBarBoss || currentUserCan("areas_manage")){
    btn.disabled = false;
    btn.title = "";
    if(hint && isBarBoss) hint.textContent = "Alta y baja operativa de barras y stands";
    btn.addEventListener("click", ()=> window.location.href = "/barras.html");
    return;
  }

  if(card) card.style.display = "none";
}

function setupCashierAccess(){
  const card = $("cashierCard");
  const btn = $("btnCashier");
  const hint = $("cashierHint");
  if(!btn) return;

  if(isBarBoss){
    if(card) card.style.display = "none";
    return;
  }

  if(isAdmin || isCashier || isJefeOperativo || currentUserCan("reports_view")){
    btn.disabled = false;
    btn.title = "";
    if(hint) hint.textContent = "Turnos y cortes de caja";
    btn.addEventListener("click", ()=> window.location.href = "/dashboard-caja/reportes.html");
    return;
  }

  disableButton(btn, hint, "No autorizado para caja/cortes");
}

function setupUsersAccess(){
  const card = $("usersCard");
  const btn = $("btnUsers");
  const hint = $("usersHint");
  if(!btn) return;

  if(currentUserCan("users_manage")){
    btn.disabled = false;
    btn.title = "";
    if(hint) hint.textContent = "Registro, edicion y alta de usuarios";
    btn.addEventListener("click", ()=> window.location.href = "/usuarios.html");
    return;
  }

  if(card) card.style.display = "none";
}

function setupTransferBalanceAccess(){
  const card = $("transferBalanceCard");
  const btn = $("btnTransferBalance");
  const hint = $("transferBalanceHint");
  if(!btn) return;

  if(currentUserCan("users_manage")){
    btn.disabled = false;
    btn.title = "";
    if(hint) hint.textContent = "Transferir saldo entre usuarios del mismo tenant";
    btn.addEventListener("click", ()=> window.location.href = "/transferencias-saldo.html");
    return;
  }

  if(card) card.style.display = "none";
}

function setupPriceListAccess(){
  const btn = $("btnPriceList");
  const hint = $("priceListHint");
  if(!btn) return;
  btn.disabled = false;
  btn.title = "";
  if(hint){
    hint.textContent = isBarBoss
      ? "Consulta precios vigentes y donde esta activo cada producto"
      : "Consulta informativa de productos, precios y barras activas";
  }
  btn.addEventListener("click", ()=> window.location.href = "/lista-precios.html");
}

async function refreshLastUid(){
  const status = $("uidStatus");
  const value = $("uidValue");
  if(status) status.textContent = "Leyendo...";
  try{
    const uid = await apiGetLastUid();
    if(value) value.textContent = uid || "-";
    if(status) status.textContent = "OK";
  }catch(e){
    console.error("ops uid error:", e);
    if(status) status.textContent = "sin datos";
  }
}

setSessionInfo();
setupPosAccess();
setupCatalogAccess();
setupBarReportsAccess();
setupInventoryAccess();
setupBarsAccess();
setupUsersAccess();
setupTransferBalanceAccess();
setupPriceListAccess();
setupCashierAccess();
refreshLastUid();
setInterval(refreshLastUid, 2000);

$("btnLogout")?.addEventListener("click", ()=>{
  try{ clearSession(); }catch{}
  window.location.href = "/login.html";
});

