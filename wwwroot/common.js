// wwwroot/common.js
const API_BASE = window.location.origin;
const API = API_BASE; // compat

function $(id){ return document.getElementById(id); }

// ---------- Session ----------
function getSession(){
  const raw = localStorage.getItem("cashless.session");
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch{ return null; }
}
function saveSession(s){
  localStorage.setItem("cashless.session", JSON.stringify(s));
}
function clearSession(){
  localStorage.removeItem("cashless.session");
  localStorage.removeItem("token");
  localStorage.removeItem("jwt");
  localStorage.removeItem("authToken");
}
function requireSession(){
  const s = getSession();
  if(!s || !s.operatorId || !s.token){
    window.location.href = "/login.html";
    throw new Error("No session");
  }
  return s;
}

// ---------- Festival ----------
function getFestivalId(){
  return localStorage.getItem("cashless.festivalId") || "";
}
function setFestivalId(id){
  if(!id) localStorage.removeItem("cashless.festivalId");
  else localStorage.setItem("cashless.festivalId", String(id));

  const s = getSession();
  if(s && typeof s === "object"){
    if(id) s.festivalId = String(id);
    else delete s.festivalId;
    saveSession(s);
  }
}

function normalizeUid(uid){
  return String(uid || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

const TERMINAL_STORAGE_KEY = "cashless.terminalId";
const KNOWN_TERMINAL_IDS = ["BARRA-01", "BARRA-02", "BARRA-03", "COMIDA-01", "CAJA-01", "CAJA-02"];

function normalizeTerminalId(value){
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isValidTerminalId(value){
  const clean = normalizeTerminalId(value);
  return /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(clean) && clean !== "DEFAULT";
}

function getKnownTerminalIds(){
  return [...KNOWN_TERMINAL_IDS];
}

function loadStoredTerminalId(){
  const fromSession = normalizeTerminalId(sessionStorage.getItem(TERMINAL_STORAGE_KEY) || "");
  if(isValidTerminalId(fromSession)) return fromSession;

  const fromLocal = normalizeTerminalId(localStorage.getItem(TERMINAL_STORAGE_KEY) || "");
  if(isValidTerminalId(fromLocal)) return fromLocal;

  return "";
}

function saveTerminalId(value){
  const clean = normalizeTerminalId(value);
  if(!isValidTerminalId(clean)){
    throw new Error("terminalId invalido. Usa un valor como BARRA-01, BARRA-02 o COMIDA-01.");
  }
  sessionStorage.setItem(TERMINAL_STORAGE_KEY, clean);
  localStorage.setItem(TERMINAL_STORAGE_KEY, clean);
  return clean;
}

function getTerminalId(options = {}){
  const required = !!options.required;
  const fallback = normalizeTerminalId(options.fallback || "");
  const stored = loadStoredTerminalId();
  const terminalId = stored || (isValidTerminalId(fallback) ? fallback : "");
  if(required && !terminalId){
    throw new Error("terminalId no configurado en esta PC. Selecciona una terminal antes de operar.");
  }
  return terminalId;
}

function ensureTerminalOption(select, terminalId){
  if(!select || !terminalId) return;
  let opt = Array.from(select.options).find((o) => o.value === terminalId);
  if(!opt){
    opt = document.createElement("option");
    opt.value = terminalId;
    opt.textContent = terminalId;
    select.appendChild(opt);
  }
}

function bindTerminalUi(selectId, labelId, options = {}){
  const select = typeof selectId === "string" ? $(selectId) : selectId;
  const label = typeof labelId === "string" ? $(labelId) : labelId;
  const fallback = normalizeTerminalId(options.fallback || "");
  const defaults = Array.isArray(options.terminals) && options.terminals.length
    ? options.terminals.map(normalizeTerminalId).filter(isValidTerminalId)
    : getKnownTerminalIds();

  if(select){
    select.innerHTML = "";
    for(const terminalId of defaults){
      const opt = document.createElement("option");
      opt.value = terminalId;
      opt.textContent = terminalId;
      select.appendChild(opt);
    }
  }

  const current = getTerminalId({ fallback });
  if(current){
    ensureTerminalOption(select, current);
    if(select) select.value = current;
    if(label) label.textContent = current;
  }else if(label){
    label.textContent = "-";
  }

  return {
    get value(){
      return getTerminalId({ fallback });
    },
    save(value){
      const clean = saveTerminalId(value);
      ensureTerminalOption(select, clean);
      if(select) select.value = clean;
      if(label) label.textContent = clean;
      return clean;
    }
  };
}

(function bootstrapTerminalIdFromQuery(){
  try{
    const url = new URL(window.location.href);
    const fromQuery = normalizeTerminalId(url.searchParams.get("terminalId") || "");
    if(isValidTerminalId(fromQuery)){
      saveTerminalId(fromQuery);
    }
  }catch{}
})();

function apiHeaders(extraHeaders = {}){
  const s = requireSession();
  const terminalId = getTerminalId();
  return {
    "Content-Type": "application/json",
    "X-Operator-Id": String(s.operatorId),
    "X-Operator-Token": String(s.token),
    ...(s.tenantId ? { "X-Tenant-Id": String(s.tenantId) } : {}),
    ...(s.token ? { "Authorization": `Bearer ${s.token}` } : {}),
    ...(getFestivalId() ? { "X-Festival-Id": String(getFestivalId()) } : {}),
    ...(terminalId ? { "X-Terminal-Id": terminalId } : {}),
    ...(extraHeaders || {})
  };
}

// ---------- API ----------
function withTimeout(ms){
  const controller = new AbortController();
  const timer = setTimeout(()=> controller.abort(), ms);
  return { signal: controller.signal, cancel: ()=> clearTimeout(timer) };
}

async function apiFetch(path, options = {}){
  requireSession();
  const timeoutMs = options.timeoutMs ?? 12000;
  const { signal, cancel } = withTimeout(timeoutMs);
  const method = String(options?.method || "GET").toUpperCase();
  const url = `${API_BASE}${path}`;

  try{
    cashlessPendingRequests += 1;
    setGlobalBusy(true);
    const res = await fetch(url, {
      ...options,
      headers: apiHeaders(options.headers || {}),
      cache: "no-store",
      signal
    });

    if(res.status === 401){
      clearSession();
      showToast("Sesion expirada. Inicia sesion nuevamente.", "error", 4500);
      window.location.href = "/login.html";
    }

    return res;
  }catch(e){
    if(e && typeof e === "object"){
      e.status = Number(e.status || 0);
      e.statusText = String(e.statusText || e.name || "NetworkError");
      e.data = e.data ?? null;
      e.url = e.url || url;
      e.method = e.method || method;
    }
    if(e?.name === "AbortError"){
      showToast("La solicitud tardo demasiado. Revisa red o servidor.", "error", 4500);
    }else{
      showToast("No se pudo completar la solicitud.", "error", 3600);
    }
    throw e;
  }finally{
    cashlessPendingRequests = Math.max(0, cashlessPendingRequests - 1);
    setGlobalBusy(cashlessPendingRequests > 0);
    cancel();
  }
}

async function apiJson(path, options = {}){
  const res = await apiFetch(path, options);
  const text = await res.text();

  let data = null;
  try{ data = text ? JSON.parse(text) : null; }
  catch{ data = { message: text }; }

  if(!res.ok){
    const msg = data?.message || res.statusText || `Error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.statusText = res.statusText;
    err.data = data;
    err.url = `${API_BASE}${path}`;
    err.method = String(options?.method || "GET").toUpperCase();
    throw err;
  }
  return data;
}

async function apiGetLastUid(terminalId = ""){
  const tid = normalizeTerminalId(terminalId || "") || getTerminalId({ required: true });
  const qs = `?terminalId=${encodeURIComponent(tid)}`;
  const data = await apiJson(`/api/last-uid${qs}`, { method: "GET" });
  return normalizeUid(data?.uid || "");
}

async function apiGetCardByUid(uid){
  const clean = normalizeUid(uid);
  if(!clean) throw new Error("UID requerido");
  return await apiJson(`/api/cards/${encodeURIComponent(clean)}`, { method: "GET" });
}

function syncInventoryFromSale(areaId, saleItems){
  void areaId;
  void saleItems;
}

const PERMISSIONS_STORAGE_KEY = "cashless.permissions.schema.v1";

function normalizeRoleName(role){
  const raw = String(role || "").trim().toLowerCase().replace(/[\s_\-]/g, "");
  if(raw === "superadmin") return "SuperAdmin";
  if(raw === "admin") return "Admin";
  if(raw === "jefeoperativo" || raw === "jefedecaja") return "JefeOperativo";
  if(raw === "jefedebarra") return "JefeDeBarra";
  if(raw === "jefedestand") return "JefeDeStand";
  if(raw === "cajerodebarra" || raw === "bartender") return "CajeroDeBarra";
  if(raw === "cajero" || raw === "cashier") return "Cajero";
  return "";
}

function defaultPermissionSchema(){
  return {
    roles: ["SuperAdmin", "Admin", "JefeOperativo", "JefeDeBarra", "JefeDeStand", "CajeroDeBarra", "Cajero"],
    permissions: [
      { key:"dashboard_view", title:"Ver dashboard", desc:"Acceso al panel principal." },
      { key:"pos_use", title:"Usar POS", desc:"Cobrar con pulsera en barra o stand." },
      { key:"topup", title:"Recargar saldo", desc:"Hacer recargas de saldo a pulseras." },
      { key:"charge", title:"Cobrar", desc:"Aplicar cargos a pulseras." },
      { key:"users_manage", title:"Usuarios", desc:"Crear o editar usuarios y asignar pulseras." },
      { key:"areas_manage", title:"Barras / Areas", desc:"Crear o editar barras, stands y tipos." },
      { key:"products_manage", title:"Productos", desc:"Administrar catalogo de productos." },
      { key:"menus_manage", title:"Menus por barra", desc:"Asignar productos por barra." },
      { key:"operators_manage", title:"Colaboradores", desc:"Crear o editar colaboradores." },
      { key:"reports_view", title:"Reportes", desc:"Ver estadisticas y cortes." },
      { key:"permissions_view", title:"Ver permisos", desc:"Consultar la matriz de permisos." },
      { key:"permissions_manage", title:"Administrar permisos", desc:"Editar permisos por rol y asignar roles." }
    ],
    matrix: {
      SuperAdmin: {
        dashboard_view:true, pos_use:true, topup:true, charge:true, users_manage:true, areas_manage:true,
        products_manage:true, menus_manage:true, operators_manage:true, reports_view:true, permissions_view:true, permissions_manage:true
      },
      Admin: {
        dashboard_view:true, pos_use:true, topup:true, charge:true, users_manage:true, areas_manage:true,
        products_manage:true, menus_manage:true, operators_manage:true, reports_view:true, permissions_view:true, permissions_manage:false
      },
      JefeOperativo: {
        dashboard_view:true, pos_use:false, topup:true, charge:false, users_manage:true, areas_manage:true,
        products_manage:true, menus_manage:true, operators_manage:false, reports_view:true, permissions_view:true, permissions_manage:false
      },
      JefeDeBarra: {
        dashboard_view:true, pos_use:true, topup:false, charge:true, users_manage:false, areas_manage:true,
        products_manage:false, menus_manage:true, operators_manage:false, reports_view:true, permissions_view:false, permissions_manage:false
      },
      JefeDeStand: {
        dashboard_view:true, pos_use:true, topup:false, charge:true, users_manage:false, areas_manage:true,
        products_manage:false, menus_manage:true, operators_manage:false, reports_view:true, permissions_view:false, permissions_manage:false
      },
      CajeroDeBarra: {
        dashboard_view:false, pos_use:true, topup:false, charge:true, users_manage:false, areas_manage:false,
        products_manage:false, menus_manage:false, operators_manage:false, reports_view:false, permissions_view:false, permissions_manage:false
      },
      Cajero: {
        dashboard_view:true, pos_use:false, topup:true, charge:false, users_manage:true, areas_manage:false,
        products_manage:false, menus_manage:false, operators_manage:false, reports_view:false, permissions_view:false, permissions_manage:false
      }
    }
  };
}

function getPermissionSchema(){
  const fallback = defaultPermissionSchema();
  const raw = localStorage.getItem(PERMISSIONS_STORAGE_KEY);
  if(!raw) return fallback;
  try{
    const parsed = JSON.parse(raw);
    if(!parsed || !Array.isArray(parsed.roles) || !Array.isArray(parsed.permissions) || typeof parsed.matrix !== "object"){
      return fallback;
    }
    const roles = Array.from(new Set([...(parsed.roles || []), ...(fallback.roles || [])]));
    const permissionMap = new Map();
    for(const item of [...(parsed.permissions || []), ...(fallback.permissions || [])]){
      if(item && item.key && !permissionMap.has(item.key)) permissionMap.set(item.key, item);
    }
    const matrix = { ...(parsed.matrix || {}) };
    for(const roleName of fallback.roles){
      if(!matrix[roleName] || typeof matrix[roleName] !== "object"){
        matrix[roleName] = { ...(fallback.matrix?.[roleName] || {}) };
      }
    }
    return {
      ...parsed,
      roles,
      permissions: Array.from(permissionMap.values()),
      matrix
    };
  }catch{
    return fallback;
  }
}

function savePermissionSchema(schema){
  localStorage.setItem(PERMISSIONS_STORAGE_KEY, JSON.stringify(schema));
}

function resetPermissionSchema(){
  localStorage.removeItem(PERMISSIONS_STORAGE_KEY);
}

function roleHasPermission(permissionKey, role){
  const schema = getPermissionSchema();
  const roleName = normalizeRoleName(role || getSession()?.role || getSession()?.Role);
  if(!roleName) return false;
  if(permissionKey === "areas_manage" && (roleName === "JefeDeBarra" || roleName === "JefeDeStand")) return true;
  return !!schema?.matrix?.[roleName]?.[permissionKey];
}

function currentRoleName(){
  return normalizeRoleName(getSession()?.role || getSession()?.Role);
}

function currentUserCan(permissionKey){
  return roleHasPermission(permissionKey, currentRoleName());
}

function requireUiPermission(permissionKey, redirectTo = "/dashboard.html"){
  requireSession();
  if(currentUserCan(permissionKey)) return true;
  window.location.href = redirectTo;
  throw new Error(`Missing UI permission: ${permissionKey}`);
}

function currentSessionLabel(){
  const s = getSession();
  if(!s) return "Sin sesion";
  const name = s.name || s.operatorName || "Operador";
  const role = normalizeRoleName(s.role || s.Role) || s.role || s.Role || "";
  const tenant = s.tenantId ? `Tenant ${s.tenantId}` : "Tenant -";
  return `${name}${role ? ` · ${role}` : ""} · ${tenant}`;
}

const CASHLESS_NAV_ITEMS = [
  { label:"Inicio", href:"/ops.html", permission:"dashboard_view", roles:["JefeDeBarra", "JefeDeStand"] },
  { label:"Dashboard", href:"/dashboard.html", permission:"dashboard_view", roles:["SuperAdmin", "Admin", "JefeOperativo"] },
  { label:"Caja", href:"/dashboard-caja/", permission:"topup", roles:["Cajero", "SuperAdmin", "Admin", "JefeOperativo"] },
  { label:"Recargas", href:"/recargas.html", permission:"topup" },
  { label:"Usuarios", href:"/usuarios.html", permission:"users_manage" },
  { label:"POS", href:"/pos.html", anyPermission:["pos_use", "charge"] },
  { label:"Barras", href:"/barras.html", permission:"areas_manage" },
  { label:"Menus", href:"/menus.html", anyPermission:["menus_manage", "areas_manage"], roles:["JefeDeBarra", "JefeDeStand"] },
  { label:"Precios", href:"/lista-precios.html", publicForSession:true },
  { label:"Inventario", href:"/inventarios.html", anyPermission:["menus_manage", "areas_manage"], roles:["JefeDeBarra", "JefeDeStand"], activePaths:["/inventarios-reportes.html"] },
  { label:"Transferencias", href:"/transferencias-saldo.html", permission:"users_manage" },
  { label:"Reportes", href:"/reports.html", permission:"reports_view", activePaths:["/reports-summary.html", "/reports-cashier.html", "/reports-products.html", "/reports-recharges.html", "/reportes-barra.html"] },
  { label:"Ventas", href:"/ventas.html", permission:"reports_view" },
  { label:"Operadores", href:"/operators.html", permission:"operators_manage" },
  { label:"Festivales", href:"/festivales.html", roles:["SuperAdmin", "Admin"] },
  { label:"Permisos", href:"/permisos.html", permission:"permissions_view" },
  { label:"Mapa", href:"/app-map.html", roles:["SuperAdmin", "Admin"] }
];

const CASHLESS_CASHIER_NAV_ITEMS = [
  { label:"Caja", href:"/dashboard-caja/" },
  { label:"Recargas", href:"/recargas.html" },
  { label:"Usuarios", href:"/usuarios.html" },
  { label:"Transferencias", href:"/transferencias-saldo.html" },
  { label:"Precios", href:"/lista-precios.html" },
  { label:"Cortes", href:"/dashboard-caja/reportes.html" }
];

function userCanSeeNavItem(item, roleName = currentRoleName()){
  if(!getSession()) return false;
  if(item.publicForSession) return true;
  if(Array.isArray(item.roles) && item.roles.includes(roleName)) return true;
  if(item.permission && roleHasPermission(item.permission, roleName)) return true;
  if(Array.isArray(item.anyPermission) && item.anyPermission.some((key) => roleHasPermission(key, roleName))) return true;
  return false;
}

function normalizeNavPath(path){
  let p = String(path || "/").split("?")[0].split("#")[0].toLowerCase();
  if(p.endsWith("/index.html")) p = p.slice(0, -"index.html".length);
  return p;
}

function isActiveNavPath(current, href){
  const c = normalizeNavPath(current);
  const h = normalizeNavPath(href);
  if(h === "/dashboard-caja/") return c === "/dashboard-caja/" || c === "/dashboard-caja";
  return c === h;
}

function isActiveNavItem(currentPath, item){
  if(isActiveNavPath(currentPath, item.href)) return true;
  return Array.isArray(item.activePaths) && item.activePaths.some((path) => isActiveNavPath(currentPath, path));
}

function buildNavHtml(items, currentPath, options = {}){
  const roleName = currentRoleName();
  const visible = items.filter((item) => options.forceVisible || userCanSeeNavItem(item, roleName));
  const links = visible.map((item) => {
    const active = isActiveNavItem(currentPath || window.location.pathname, item) ? " is-active" : "";
    return `<a class="cashless-nav__link${active}" href="${item.href}">${item.label}</a>`;
  }).join("");

  return `
    <div class="cashless-nav__brand">
      <img src="/assets/logo-horizontal.png" alt="Cashless" class="cashless-nav__logo">
    </div>
    <div class="cashless-nav__links">${links}</div>
    <div class="cashless-nav__session" title="${escapeHtml(currentSessionLabel())}">${escapeHtml(currentSessionLabel())}</div>
    <button type="button" class="cashless-nav__logout" data-cashless-logout>Cerrar sesion</button>
  `;
}

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindLogoutButtons(root = document){
  root.querySelectorAll("[data-cashless-logout], a[href='__logout__']").forEach((node) => {
    if(node.dataset.cashlessLogoutBound === "1") return;
    node.dataset.cashlessLogoutBound = "1";
    node.addEventListener("click", (ev) => {
      ev.preventDefault();
      clearSession();
      window.location.href = "/login.html";
    });
  });
}

function renderAppMenu(containerId = "appMenu", currentPath = ""){
  const host = $(containerId);
  if(!host) return;
  host.classList.add("cashless-nav");
  host.innerHTML = buildNavHtml(CASHLESS_NAV_ITEMS, currentPath);
  bindLogoutButtons(host);
}

function renderCashierMenu(containerId = "cashierMenu", currentPath = ""){
  const host = $(containerId);
  if(!host) return;
  host.classList.add("cashless-nav");
  host.innerHTML = buildNavHtml(CASHLESS_CASHIER_NAV_ITEMS, currentPath, { forceVisible:true });
  bindLogoutButtons(host);
}

let cashlessPendingRequests = 0;

function ensureGlobalStatusNodes(){
  if(!document.body) return {};
  let busy = document.getElementById("cashlessGlobalBusy");
  if(!busy){
    busy = document.createElement("div");
    busy.id = "cashlessGlobalBusy";
    busy.className = "cashless-busy";
    busy.innerHTML = `<span class="cashless-spinner"></span><span>Procesando...</span>`;
    document.body.appendChild(busy);
  }

  let toast = document.getElementById("cashlessToast");
  if(!toast){
    toast = document.createElement("div");
    toast.id = "cashlessToast";
    toast.className = "cashless-toast";
    document.body.appendChild(toast);
  }

  return { busy, toast };
}

function setGlobalBusy(isBusy){
  const { busy } = ensureGlobalStatusNodes();
  if(!busy) return;
  busy.classList.toggle("is-visible", !!isBusy);
}

function showToast(message, type = "info", timeoutMs = 3200){
  const { toast } = ensureGlobalStatusNodes();
  if(!toast) return;
  toast.textContent = message || "";
  toast.className = `cashless-toast is-visible ${type}`;
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, timeoutMs);
}

function setStatusNode(nodeOrId, message, type = "info"){
  const node = typeof nodeOrId === "string" ? $(nodeOrId) : nodeOrId;
  if(!node) return;
  node.textContent = message || "";
  node.classList.remove("ok", "bad", "error", "success", "info");
  node.classList.add(type === "error" ? "error" : type);
}

function renderEmptyState(nodeOrId, message = "Sin datos", detail = ""){
  const node = typeof nodeOrId === "string" ? $(nodeOrId) : nodeOrId;
  if(!node) return;
  node.innerHTML = `<div class="empty-state"><b>${escapeHtml(message)}</b>${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</div>`;
}

document.addEventListener("DOMContentLoaded", () => {
  const path = normalizeNavPath(window.location.pathname);
  if(document.getElementById("appMenu")) renderAppMenu("appMenu", path);
  if(document.getElementById("cashierMenu")) renderCashierMenu("cashierMenu", path);
  bindLogoutButtons(document);
  document.body.classList.add("cashless-ui");
});
