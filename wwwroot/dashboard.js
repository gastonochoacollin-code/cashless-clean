const session = requireSession();
requireUiPermission("dashboard_view");
const FILTERS_KEY = "cashless.dashboard.filters";
const roleRaw = String(session?.role || session?.Role || "").trim();
const roleNorm = roleRaw.toLowerCase().replace(/[\s_-]/g, "");
const roleName = typeof currentRoleName === "function" ? currentRoleName() : normalizeRoleName(roleRaw);

function isAdminOrSuper(){
  return roleNorm === "admin" || roleNorm === "superadmin";
}

function isBoss(){
  return roleNorm.includes("jefe");
}

function isCashier(){
  return roleNorm === "cajero" || roleNorm === "cashier";
}

function isSeller(){
  return roleNorm === "vendedor";
}

function isJefeDeBarra(){
  return roleNorm === "jefedebarra";
}

function canPos(){
  return currentUserCan("pos_use") || currentUserCan("charge") || isSeller();
}

function canCaja(){
  return currentUserCan("topup") || isCashier();
}

function canReports(){
  return currentUserCan("reports_view");
}

function canAdmin(){
  return roleName === "Admin" || roleName === "SuperAdmin";
}

function canBarsCatalog(){
  return currentUserCan("areas_manage");
}

function $(id){
  return document.getElementById(id);
}

function setVisible(id, visible){
  const node = $(id);
  if(node) node.style.display = visible ? "" : "none";
}

function setText(id, value){
  const node = $(id);
  if(node) node.textContent = value;
}

function setStatus(message){
  setText("statusMessage", message || "");
}

function formatMoney(value){
  const amount = Number(value);
  if(!Number.isFinite(amount)) return "-";
  return amount.toLocaleString("es-MX", { style:"currency", currency:"MXN" });
}

function formatInt(value){
  const amount = Number(value);
  if(!Number.isFinite(amount)) return "-";
  return amount.toLocaleString("es-MX", { maximumFractionDigits:0 });
}

function toIsoDate(date){
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days){
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function defaultFilters(){
  const today = new Date();
  const from = toIsoDate(addDays(today, -6));
  const to = toIsoDate(today);
  return { from, to, areaId: null };
}

function readFilters(){
  try{
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if(!raw) return defaultFilters();
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== "object") return defaultFilters();
    const fallback = defaultFilters();
    return {
      from: String(parsed.from || fallback.from),
      to: String(parsed.to || fallback.to),
      areaId: parsed.areaId ?? null
    };
  }catch{
    return defaultFilters();
  }
}

function saveFilters(filters){
  const current = readFilters();
  const next = {
    from: String(filters?.from || current.from),
    to: String(filters?.to || current.to),
    areaId: filters?.areaId ?? current.areaId ?? null
  };
  sessionStorage.setItem(FILTERS_KEY, JSON.stringify(next));
  return next;
}

function syncFilterInputs(filters){
  if($("filterFrom")) $("filterFrom").value = filters.from;
  if($("filterTo")) $("filterTo").value = filters.to;
}

function formatDateLabel(value){
  if(!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if(Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-MX", { year:"numeric", month:"short", day:"2-digit" });
}

function buildRangeQuery(filters, extra = {}){
  const params = new URLSearchParams();
  if(filters?.from) params.set("from", filters.from);
  if(filters?.to) params.set("to", filters.to);
  if(filters?.areaId) params.set("areaId", String(filters.areaId));
  Object.entries(extra || {}).forEach(([key, value]) => {
    if(value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

async function parseResponseBody(response){
  const text = await response.text();
  if(!text) return null;
  try{
    return JSON.parse(text);
  }catch{
    return { message: text };
  }
}

async function requestJson(path, options = {}){
  const url = `${API_BASE}${path}`;
  try{
    const response = await apiFetch(path, options);
    const data = await parseResponseBody(response);
    if(!response.ok){
      const message = data?.message || response.statusText || "Error";
      return { ok:false, status:response.status, message, url, data };
    }
    return { ok:true, status:response.status, message:"", url, data };
  }catch(error){
    return {
      ok:false,
      status:Number(error?.status || 0),
      message:String(error?.message || "Error de red"),
      url:String(error?.url || url),
      data:error?.data ?? null
    };
  }
}

function extractCount(data){
  if(typeof data === "number") return data;
  if(Array.isArray(data)) return data.length;
  if(data && typeof data === "object"){
    const candidates = ["count", "total", "totalCount", "users", "operators"];
    for(const key of candidates){
      if(typeof data[key] === "number") return data[key];
      const altKey = key.charAt(0).toUpperCase() + key.slice(1);
      if(typeof data[altKey] === "number") return data[altKey];
    }
  }
  return null;
}

function extractList(data){
  if(Array.isArray(data)) return data;
  if(data && typeof data === "object"){
    if(Array.isArray(data.items)) return data.items;
    if(Array.isArray(data.data)) return data.data;
    if(Array.isArray(data.results)) return data.results;
    if(Array.isArray(data.rows)) return data.rows;
  }
  return [];
}

async function requestUserCount(){
  const countResult = await requestJson("/api/users/count", { method:"GET" });
  const count = countResult.ok ? extractCount(countResult.data) : null;
  if(countResult.ok && count !== null){
    return { ok:true, status:countResult.status, url:countResult.url, data:{ count } };
  }

  const summaryResult = await requestJson("/api/users/summary", { method:"GET" });
  const summaryCount = summaryResult.ok ? extractCount(summaryResult.data) : null;
  if(summaryResult.ok && summaryCount !== null){
    return { ok:true, status:summaryResult.status, url:summaryResult.url, data:{ count: summaryCount } };
  }
  if(summaryResult.ok){
    return { ok:true, status:summaryResult.status, url:summaryResult.url, data:null };
  }
  if(countResult.ok){
    return { ok:true, status:countResult.status, url:countResult.url, data:null };
  }

  if(!countResult.ok && Number(countResult.status) !== 404) return countResult;
  return summaryResult;
}

function addErrorLine(errors, result){
  if(!result || result.ok) return;
  errors.push(`ERROR ${Number(result.status || 0)}: ${result.message || "Error"} (endpoint: ${result.url || "-"})`);
}

function showErrors(errors){
  const banner = $("errorBanner");
  if(!banner) return;
  if(!errors.length){
    banner.style.display = "none";
    banner.textContent = "";
    return;
  }
  banner.style.display = "block";
  banner.textContent = errors.join("\n");
}

function setKpiState(baseId, kind, value, note){
  setText(baseId, value);
  setText(`${baseId}Note`, note);
  const state = $(`${baseId}State`);
  if(!state) return;
  state.className = "state";
  if(kind === "ok"){
    state.classList.add("ok");
    state.textContent = "OK";
    return;
  }
  if(kind === "empty"){
    state.classList.add("empty");
    state.textContent = "SIN DATOS";
    return;
  }
  state.classList.add("error");
  state.textContent = "ERROR";
}

function setLoadingState(){
  setKpiState("kpiSold", "empty", "...", "Cargando resumen...");
  setKpiState("kpiTransactions", "empty", "...", "Cargando resumen...");
  setKpiState("kpiUsers", "empty", "...", "Cargando usuarios...");
  setKpiState("kpiAreas", "empty", "...", "Cargando areas...");
  setKpiState("kpiOperators", "empty", "...", "Cargando operadores...");
}

function readSummaryValue(data, keys){
  if(!data || typeof data !== "object") return null;
  for(const key of keys){
    if(typeof data[key] === "number") return data[key];
    const altKey = key.charAt(0).toUpperCase() + key.slice(1);
    if(typeof data[altKey] === "number") return data[altKey];
  }
  return null;
}

function renderSummaryCard(result){
  if(!result.ok){
    setKpiState("kpiSold", "error", "-", "No se pudo cargar el total vendido");
    setKpiState("kpiTransactions", "error", "-", "No se pudieron cargar las transacciones");
    return;
  }

  const totalVendido = readSummaryValue(result.data, ["totalSold", "totalVendido", "totalCharged", "total", "salesTotal"]);
  const transacciones = readSummaryValue(result.data, ["txCount", "transacciones", "transactions", "totalTransactions"]);
  const hasPayload = !!(result.data && typeof result.data === "object" && Object.keys(result.data).length);

  if(!hasPayload && totalVendido === null && transacciones === null){
    setKpiState("kpiSold", "empty", "-", "Sin datos para el rango actual");
    setKpiState("kpiTransactions", "empty", "-", "Sin datos para el rango actual");
    return;
  }

  setKpiState(
    "kpiSold",
    totalVendido === null ? "empty" : "ok",
    totalVendido === null ? "-" : formatMoney(totalVendido),
    totalVendido === null ? "Sin datos para el rango actual" : "Total vendido en el rango actual"
  );
  setKpiState(
    "kpiTransactions",
    transacciones === null ? "empty" : "ok",
    transacciones === null ? "-" : formatInt(transacciones),
    transacciones === null ? "Sin datos para el rango actual" : "Transacciones registradas"
  );
}

function renderUsersCard(result){
  if(!result.ok){
    setKpiState("kpiUsers", "error", "-", "No se pudo cargar el total de usuarios");
    return;
  }

  const count = extractCount(result.data);
  if(count === null){
    setKpiState("kpiUsers", "empty", "-", "Sin datos para el rango actual");
    return;
  }

  setKpiState("kpiUsers", "ok", formatInt(count), "Usuarios disponibles");
}

function renderAreasCard(result){
  if(!result.ok){
    setKpiState("kpiAreas", "error", "-", "No se pudieron cargar las areas");
    return;
  }

  const areas = extractList(result.data);
  if(!areas.length){
    setKpiState("kpiAreas", "empty", "-", "Sin datos para el rango actual");
    return;
  }

  const activeCount = areas.filter((item) => (item?.isActive ?? item?.IsActive) === true).length;
  const label = activeCount > 0 ? `${formatInt(activeCount)} / ${formatInt(areas.length)}` : formatInt(areas.length);
  const note = activeCount > 0 ? "Activas / total" : "Areas registradas";
  setKpiState("kpiAreas", "ok", label, note);
}

function renderOperatorsCard(result){
  if(!result.ok){
    setKpiState("kpiOperators", "error", "-", "No se pudieron cargar los operadores");
    return;
  }

  const count = extractCount(result.data);
  if(count === null){
    setKpiState("kpiOperators", "empty", "-", "Sin datos para el rango actual");
    return;
  }

  setKpiState("kpiOperators", "ok", formatInt(count), "Operadores registrados");
}

function pickActiveFestival(result){
  if(!result.ok) return null;
  const festivals = extractList(result.data);
  if(!festivals.length) return null;
  const festivalId = String(getFestivalId() || session?.festivalId || "");
  return festivals.find((item) => (item?.isActive ?? item?.IsActive) === true)
    || festivals.find((item) => String(item?.id ?? item?.Id ?? "") === festivalId)
    || null;
}

function festivalWindow(festival){
  const start = festival?.startDate ?? festival?.StartDate ?? festival?.startsAt ?? festival?.StartsAt;
  const end = festival?.endDate ?? festival?.EndDate ?? festival?.endsAt ?? festival?.EndsAt;
  if(!start && !end) return "sin fechas";

  const startLabel = start ? new Date(start).toLocaleDateString("es-MX", { year:"numeric", month:"short", day:"2-digit" }) : "-";
  const endLabel = end ? new Date(end).toLocaleDateString("es-MX", { year:"numeric", month:"short", day:"2-digit" }) : "-";
  return `${startLabel} - ${endLabel}`;
}

function renderFestival(result){
  if(!result.ok){
    setText("festivalSummary", "Festival activo: no disponible");
    setText("festivalStatus", "No disponible");
    return;
  }

  const active = pickActiveFestival(result);
  if(!active){
    setText("festivalSummary", "Festival activo: Sin datos para el rango actual");
    setText("festivalStatus", "Sin festival activo");
    return;
  }

  const id = active?.id ?? active?.Id ?? "-";
  const name = active?.name ?? active?.Name ?? `Festival ${id}`;
  const windowLabel = festivalWindow(active);
  setText("festivalSummary", `Festival activo: ${name} (${windowLabel})`);
  setText("festivalStatus", `${name} | ID ${id}`);
}

function renderSessionContext(filters){
  const name = session?.name || session?.Name || "Sin nombre";
  const role = roleRaw || "-";
  const tenantId = session?.tenantId ?? "-";
  const festivalId = session?.festivalId ?? (getFestivalId() || "-");
  setText("sessionSummary", `Sesion: ${name} | ${role} | tenant ${tenantId} | festival ${festivalId}`);
  const rangeLabel = `${formatDateLabel(filters.from)} - ${formatDateLabel(filters.to)}`;
  setText("rangeSummary", `Rango actual: ${rangeLabel}`);
  setText("filterStatus", `${filters.from} a ${filters.to}`);
}

function normalizeRecentRows(data){
  return extractList(data);
}

function findValue(row, keys){
  if(!row || typeof row !== "object") return null;
  for(const key of keys){
    if(row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
    const altKey = key.charAt(0).toUpperCase() + key.slice(1);
    if(row[altKey] !== undefined && row[altKey] !== null && row[altKey] !== "") return row[altKey];
  }
  return null;
}

function renderRecent(result){
  const section = $("recentSection");
  const tbody = $("recentRows");
  if(!section || !tbody) return;

  if(!result || !result.ok){
    section.style.display = "none";
    return;
  }

  const rows = normalizeRecentRows(result.data);
  section.style.display = "";

  if(!rows.length){
    setText("recentSummary", "Sin datos para el rango actual");
    tbody.innerHTML = `<tr><td colspan="4" class="muted">Sin datos para el rango actual</td></tr>`;
    return;
  }

  setText("recentSummary", `${rows.length} registros recientes`);
  tbody.innerHTML = rows.map((row) => {
    const when = findValue(row, ["createdAt", "date", "timestamp", "soldAt"]);
    const whenLabel = when ? new Date(when).toLocaleString("es-MX") : "-";
    const areaName = findValue(row, ["areaName"]) || "-";
    const operatorName = findValue(row, ["operatorName"]) || "-";
    const uidMasked = findValue(row, ["uidMasked", "uid"]) || "-";
    const description = `Area: ${areaName} | Operador: ${operatorName} | UID: ${uidMasked}`;
    const amount = findValue(row, ["total", "amount", "totalVendido", "value"]);
    const tip = findValue(row, ["tip", "tipAmount"]);
    const status = tip !== null && Number(tip) > 0 ? `Con propina ${formatMoney(tip)}` : "OK";
    return `
      <tr>
        <td>${whenLabel}</td>
        <td>${String(description)}</td>
        <td>${amount === null ? "-" : formatMoney(amount)}</td>
        <td>${String(status)}</td>
      </tr>
    `;
  }).join("");
}

function applyDashboardAccess(){
  const canPosView = canPos();
  const canReportesView = canReports();
  const canAdminView = canAdmin();
  const canRecargasView = canCaja() || canPos() || canBarsCatalog() || canAdmin();

  setVisible("navPos", canPosView);
  setVisible("navRecargas", canRecargasView);
  setVisible("navUsers", canAdminView);
  setVisible("navVentas", canReportesView);
  setVisible("navReportes", canReportesView);
  setVisible("navAdmin", canAdminView);

  setVisible("quickPos", canPosView);
  setVisible("quickRecargas", canRecargasView);
  setVisible("quickUsuarios", canAdminView);
  setVisible("quickVentas", canReportesView);
  setVisible("quickReportes", canReportesView);
  setVisible("quickAdmin", canAdminView);
  setVisible("resetOpsCard", canAdminView);
}

async function loadDashboard(){
  const stored = saveFilters(readFilters());
  syncFilterInputs(stored);
  renderSessionContext(stored);
  applyDashboardAccess();
  showErrors([]);
  setLoadingState();
  setStatus("Cargando dashboard...");

  const rangeQuery = buildRangeQuery(stored);
  const tasks = {
    festivals: requestJson("/api/festivals", { method:"GET" }),
    summary: requestJson(`/api/reports/summary?${rangeQuery}`, { method:"GET" }),
    users: requestUserCount(),
    areas: requestJson("/api/reports/areas", { method:"GET" }),
    operators: requestJson("/api/operators", { method:"GET" }),
    recent: requestJson(`/api/reports/recent?${buildRangeQuery(stored, { take:10 })}`, { method:"GET" })
  };

  const keys = Object.keys(tasks);
  const settled = await Promise.allSettled(Object.values(tasks));
  const results = {};

  keys.forEach((key, index) => {
    const item = settled[index];
    if(item.status === "fulfilled"){
      results[key] = item.value;
      return;
    }
    results[key] = {
      ok:false,
      status:0,
      message:String(item.reason?.message || "Error inesperado"),
      url:key
    };
  });

  const errors = [];
  addErrorLine(errors, results.festivals);
  addErrorLine(errors, results.summary);
  addErrorLine(errors, results.users);
  addErrorLine(errors, results.areas);
  addErrorLine(errors, results.operators);

  if(!results.recent.ok && ![404, 405].includes(Number(results.recent.status || 0))){
    addErrorLine(errors, results.recent);
  }

  showErrors(errors);
  renderFestival(results.festivals);
  renderSummaryCard(results.summary);
  const summaryUserCount = readSummaryValue(results.summary.data, ["userCount"]);
  renderUsersCard(summaryUserCount === null
    ? results.users
    : { ok:true, data:{ count: summaryUserCount } });
  renderAreasCard(results.areas);
  if(results.operators.ok){
    const rows = extractList(results.operators.data);
    if(rows.length){
      const active = rows.filter((item) => (item?.isActive ?? item?.IsActive) !== false).length;
      renderOperatorsCard({ ok:true, data:{ count: active } });
      setText("kpiOperatorsNote", active === rows.length ? "Operadores activos" : `Activos: ${formatInt(active)} de ${formatInt(rows.length)}`);
    }else{
      renderOperatorsCard({ ok:true, data:null });
    }
  }else{
    renderOperatorsCard(results.operators);
  }
  renderRecent(results.recent.ok ? results.recent : null);

  setStatus(errors.length ? "Carga parcial con errores visibles" : "Listo");
}

function readFilterInputs(){
  const current = readFilters();
  const nextFrom = String($("filterFrom")?.value || "").trim() || current.from;
  const nextTo = String($("filterTo")?.value || "").trim() || current.to;
  if(nextFrom > nextTo){
    const error = [`ERROR 0: El rango es invalido: "desde" no puede ser mayor que "hasta" (endpoint: filtros del dashboard)`];
    showErrors(error);
    setStatus("Corrige el rango para continuar");
    return null;
  }
  return saveFilters({ from: nextFrom, to: nextTo, areaId: current.areaId ?? null });
}

async function applyFilters(){
  const next = readFilterInputs();
  if(!next) return;
  await loadDashboard();
}

async function clearFilters(){
  const reset = saveFilters(defaultFilters());
  syncFilterInputs(reset);
  await loadDashboard();
}

async function resetOps(){
  const msg = $("resetOpsMsg");
  if(msg) msg.textContent = "";

  if(!isAdminOrSuper()){
    if(msg) msg.textContent = "No autorizado.";
    return;
  }

  const first = confirm("Esto borrara ventas, recargas, turnos y auditorias. Continuar?");
  if(!first) return;
  const second = prompt("Escribe RESET para confirmar:");
  if(String(second || "").trim().toUpperCase() !== "RESET"){
    if(msg) msg.textContent = "Cancelado.";
    return;
  }

  const result = await requestJson("/api/admin/reset-ops", { method:"POST" });
  if(!result.ok){
    if(msg) msg.textContent = `ERROR ${Number(result.status || 0)}: ${result.message}`;
    return;
  }

  const backup = result.data?.backup || "-";
  if(msg) msg.textContent = `OK. Backup: ${backup}`;
  await loadDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
  renderAppMenu("appMenu", "/dashboard.html");

  $("btnReload")?.addEventListener("click", () => loadDashboard());
  $("btnApplyFilters")?.addEventListener("click", () => applyFilters());
  $("btnClearFilters")?.addEventListener("click", () => clearFilters());
  $("btnResetOps")?.addEventListener("click", () => resetOps());
  $("btnLogout")?.addEventListener("click", () => {
    try{ clearSession(); }catch{}
    location.href = "/login.html";
  });

  syncFilterInputs(saveFilters(readFilters()));
  loadDashboard();
});
