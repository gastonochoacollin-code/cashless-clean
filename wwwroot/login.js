// wwwroot/login.js
// Compatible con common.js (NO redeclara $ ni API_BASE)

const el = (id) => document.getElementById(id);

const SESSION_KEY = "cashless.session";
const TENANT_KEY = "cashless.tenantId";
const LOGIN_API_BASE = window.location.origin;

function setMsgHtml(html){
  const m = el("msg");
  if(!m) return;
  m.className = "status muted";
  m.innerHTML = html || "";
}
function setMsg(t, cls="muted"){
  const m = el("msg");
  if(!m) return;
  m.className = "status " + cls;
  m.textContent = t || "";
}
function setErr(t){
  const e = el("err");
  if(!e) return;
  e.textContent = t || "";
}

function getSession(){
  try{
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch{ return null; }
}
function saveSession(s){
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function getTenantId(){
  const selected = (el("tenantSelect")?.value || "").trim();
  if(selected) return selected;

  const stored = (localStorage.getItem(TENANT_KEY) || "").trim();
  if(stored) return stored;

  const s = getSession();
  return s?.tenantId ? String(s.tenantId) : "";
}

function renderSession(){
  const s = getSession();
  const sess = el("sess");
  const go = el("btnGoDash");
  if(!sess || !go) return;

  if(s?.operatorId && s?.token){
    sess.textContent = `Sesión: ${s.name || "Operador"} · ${s.role || ""}`;
    go.disabled = false;
  }else{
    sess.textContent = "Sesión: (ninguna)";
    go.disabled = true;
  }
}

async function fetchJsonWithTimeout(url, opts={}, ms=8000){
  const ctrl = new AbortController();
  const t = setTimeout(()=> ctrl.abort(), ms);
  try{
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache:"no-store" });
    const text = await res.text();
    let data = null;
    try{ data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data, raw: text };
  } finally {
    clearTimeout(t);
  }
}

function redact(v){
  if(!v) return "";
  const s = String(v);
  if(s.length <= 12) return s;
  return s.slice(0,8) + "…";
}

function renderDebug(endpoint, status, raw, headers){
  const body = (raw || "").toString().slice(0,500);
  const hdrs = Object.entries(headers || {})
    .map(([k,v]) => `${k}: ${redact(v)}`)
    .join("; ");

  const errPart = status >= 400 || status === 0 ? ` · body: ${body}` : "";
  setMsgHtml(
    `Debug: ${endpoint} · ${status}${errPart}` +
    `<br><span class="muted">Headers: ${hdrs || "(none)"}</span>`
  );
}

function normalizeTenants(payload){
  if(payload && typeof payload === "object" && Array.isArray(payload.tenants)){
    return payload.tenants;
  }
  if(Array.isArray(payload)) return payload;
  return [];
}

function renderTenantSelector(tenants){
  const box = el("tenantBox");
  const select = el("tenantSelect");
  if(!box || !select) return;

  select.innerHTML = "";
  for(const t of tenants){
    const id = t.id ?? t.Id;
    const name = t.name ?? t.Name ?? `Tenant ${id}`;
    if(id == null) continue;
    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = `${id} - ${name}`;
    select.appendChild(opt);
  }

  const stored = (localStorage.getItem(TENANT_KEY) || "").trim();
  if(stored){
    select.value = stored;
  } else if(select.options.length > 0){
    select.selectedIndex = 0;
  }

  box.style.display = "block";
}

async function preloadTenantsIfNeeded(){
  const r = await fetchJsonWithTimeout(`${LOGIN_API_BASE}/api/auth/operators`, {
    method:"GET"
  }, 8000);

  if(r.ok) return;

  const tenants = normalizeTenants(r.data);
  if(r.status === 400 && tenants.length > 0){
    renderTenantSelector(tenants);
    setMsg("Selecciona tenant para iniciar sesión.");
  }
}

async function doLogin(){
  setErr("");

  const operatorRaw = (el("operatorName").value || "").trim();
  const pin = (el("pin").value || "").trim();

  if(!operatorRaw) return setErr("Operador requerido.");
  if(!pin) return setErr("NIP requerido.");

  el("btnLogin").disabled = true;
  setMsg("Validando NIP…");

  const tenantId = getTenantId();
  const headers = {
    "Content-Type":"application/json",
    ...(tenantId ? { "X-Tenant-Id": tenantId } : {})
  };

  try{
    const isNumeric = /^[0-9]+$/.test(operatorRaw);
    const body = {
      ...(isNumeric ? { operatorId: Number(operatorRaw) } : { operatorName: operatorRaw }),
      pin
    };

    const r = await fetchJsonWithTimeout(`${LOGIN_API_BASE}/api/auth/login`, {
      method:"POST",
      headers,
      body: JSON.stringify(body)
    }, 8000);

    if(!r.ok){
      let msg = (r.data && typeof r.data === "object" && r.data.message)
        ? r.data.message
        : `Login falló (${r.status})`;
      if(r.status === 401) msg = "NIP incorrecto";
      if(r.status === 404) msg = "Operador no encontrado";
      if(r.status === 400 && /tenant/i.test(String(msg))){
        await preloadTenantsIfNeeded().catch(()=>{});
      }
      setErr(msg);
      renderDebug("/api/auth/login", r.status, r.raw, headers);
      return;
    }

    const payload = (r.data && typeof r.data === "object" && r.data.data && typeof r.data.data === "object")
      ? r.data.data
      : r.data;

    const role = payload?.role
      || payload?.Role
      || payload?.operator?.role
      || payload?.operator?.Role
      || payload?.user?.role
      || payload?.user?.Role
      || "";

    if(role && typeof payload === "object"){
      payload.role = role;
    }

    if(payload?.token){
      localStorage.setItem("token", payload.token);
      localStorage.setItem("jwt", payload.token);
      localStorage.setItem("authToken", payload.token);
    }
    if(payload?.jwt){
      localStorage.setItem("token", payload.jwt);
      localStorage.setItem("jwt", payload.jwt);
      localStorage.setItem("authToken", payload.jwt);
    }
    if(payload?.tenantId){
      localStorage.setItem(TENANT_KEY, String(payload.tenantId));
    }

    saveSession(payload);
    el("pin").value = "";
    renderSession();
    setMsgHtml("Login correcto. Redirigiendo…");
    const roleNorm = String(role || "").trim().toLowerCase();
    const isAdmin = roleNorm === "admin" || roleNorm === "superadmin";
    const isCashier = roleNorm === "cajero" || roleNorm === "cashier";
    window.location.href = isAdmin ? "/dashboard.html" : (isCashier ? "/dashboard-caja/" : "/ops.html");
  } catch(e){
    const msg = e?.name === "AbortError"
      ? "Timeout en /api/auth/login. Revisa el servidor."
      : (e.message || String(e));
    setErr(msg);
    renderDebug("/api/auth/login", 0, msg, headers);
  } finally {
    el("btnLogin").disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderSession();
  preloadTenantsIfNeeded().catch(()=>{});

  el("btnLogin").addEventListener("click", doLogin);
  el("pin").addEventListener("keydown", (e)=>{ if(e.key === "Enter") doLogin(); });
  el("operatorName").addEventListener("keydown", (e)=>{ if(e.key === "Enter") doLogin(); });

  el("btnGoDash").addEventListener("click", ()=>{
    window.location.href = "/dashboard.html";
  });

  el("tenantSelect")?.addEventListener("change", (e)=>{
    const v = String(e.target?.value || "").trim();
    if(v) localStorage.setItem(TENANT_KEY, v);
  });
});
