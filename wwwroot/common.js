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
    const res = await fetch(url, {
      ...options,
      headers: apiHeaders(options.headers || {}),
      cache: "no-store",
      signal
    });

    if(res.status === 401){
      clearSession();
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
    throw e;
  }finally{
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

function renderAppMenu(containerId, currentPath = ""){
  const host = $(containerId);
  if(!host) return;
  const brandHtml = `<div class="brand" style="margin-right:8px">
    <img src="/assets/logo-horizontal.png" alt="Cashless Logo" class="logo-horizontal">
  </div>`;

  const links = [
    ["Dashboard", "/dashboard.html"],
    ["Cajero", "/dashboard-caja/"],
    ["POS", "/pos.html"],
    ["Barras", "/barras.html"],
    ["Menus", "/menus.html"],
    ["Colaboradores", "/operators.html"],
    ["Usuarios", "/usuarios.html"],
    ["Transferencias", "/transferencias-saldo.html"],
    ["Lista de precios", "/lista-precios.html"],
    ["Recargas", "/recargas.html"],
    ["Ventas", "/ventas.html"],
    ["Festivales", "/festivales.html"],
    ["Permisos", "/permisos.html"],
    ["Asignacion", "/asignacion-roles.html"],
    ["Mapa", "/app-map.html"],
    ["Reportes", "/reports.html"]
  ];

  const roleName = normalizeRoleName(getSession()?.role || getSession()?.Role);
  const isAdmin = roleName === "Admin" || roleName === "SuperAdmin";
  const isCashier = roleName === "Cajero";

  const allowed = links.filter(([label]) => {
    if(label === "Dashboard") return roleHasPermission("dashboard_view", roleName);
    if(label === "Cajero") return isCashier || roleHasPermission("topup", roleName);
    if(label === "POS") return roleHasPermission("pos_use", roleName) || roleHasPermission("charge", roleName);
    if(label === "Barras") return roleHasPermission("areas_manage", roleName);
    if(label === "Menus") return roleHasPermission("menus_manage", roleName) || roleName === "JefeDeBarra" || roleName === "JefeDeStand";
    if(label === "Colaboradores") return roleHasPermission("operators_manage", roleName);
    if(label === "Usuarios") return roleHasPermission("users_manage", roleName);
    if(label === "Transferencias") return roleHasPermission("users_manage", roleName);
    if(label === "Lista de precios") return true;
    if(label === "Recargas") return roleHasPermission("topup", roleName);
    if(label === "Ventas") return roleHasPermission("reports_view", roleName);
    if(label === "Festivales") return isAdmin;
    if(label === "Permisos") return roleHasPermission("permissions_view", roleName);
    if(label === "Asignacion") return roleHasPermission("permissions_view", roleName);
    if(label === "Mapa") return isAdmin;
    if(label === "Reportes") return roleHasPermission("reports_view", roleName);
    return false;
  });

  const normalizePath = (p) => String(p || "").toLowerCase();
  const current = normalizePath(currentPath || window.location.pathname);
  const baseStyle = "display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:#2a2a3a;color:#fff;text-decoration:none;font-weight:800;border:1px solid rgba(255,255,255,.08)";

  host.innerHTML = brandHtml + allowed.map(([label, href]) => {
    const active = current.endsWith(normalizePath(href)) ? ";outline:1px solid rgba(47,124,255,.6);background:rgba(47,124,255,.18)" : "";
    return `<a class="btn alt" href="${href}" style="${baseStyle}${active}">${label}</a>`;
  }).join("");
}

function renderCashierMenu(containerId, currentPath = ""){
  const host = $(containerId);
  if(!host) return;
  const brandHtml = `<div class="brand" style="margin-right:8px">
    <img src="/assets/logo-horizontal.png" alt="Cashless Logo" class="logo-horizontal">
  </div>`;

  const links = [
    ["Recargas", "/recargas.html"],
    ["Usuarios", "/usuarios.html"],
    ["Transferencias", "/transferencias-saldo.html"],
    ["Lista de precios", "/lista-precios.html"],
    ["Reportes (Cajero)", "/dashboard-caja/reportes.html"],
    ["Cerrar sesion", "__logout__"]
  ];

  const normalizePath = (p) => String(p || "").toLowerCase();
  const current = normalizePath(currentPath || window.location.pathname);
  const baseStyle = "display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:#2a2a3a;color:#fff;text-decoration:none;font-weight:800;border:1px solid rgba(255,255,255,.08)";

  host.innerHTML = brandHtml + links.map(([label, href]) => {
    const active = current.endsWith(normalizePath(href)) ? ";outline:1px solid rgba(47,124,255,.6);background:rgba(47,124,255,.18)" : "";
    return `<a class="btn alt" href="${href}" style="${baseStyle}${active}">${label}</a>`;
  }).join("");

  host.querySelectorAll("a[href='__logout__']").forEach(a => {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      clearSession();
      window.location.href = "/login.html";
    });
  });
}
