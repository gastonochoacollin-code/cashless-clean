(() => {
  const $ = (id) => document.getElementById(id);
  const session = requireSession();
  const roleName = currentRoleName();
  const isCashier = roleName === "Cajero";
  const isJefeDeBarra = roleName === "JefeDeBarra";
  const isJefeOperativo = roleName === "JefeOperativo";
  const isAdmin = roleName === "Admin" || roleName === "SuperAdmin";
  const canSeeGeneralCuts = !isCashier && currentUserCan("reports_view");
  const isOps = isCashier || canSeeGeneralCuts;
  const fixedShiftScope = isCashier ? "caja" : (isJefeDeBarra ? "barra" : "");
  const DEBUG = (() => {
    try{
      const q = new URLSearchParams(window.location.search);
      if(q.get("debug") === "1") return true;
      return sessionStorage.getItem("cashless.debug") === "1";
    }catch{
      return false;
    }
  })();
  let adminSelectedCashierId = null;
  let selectedShiftId = null;
  let lastCloseoutData = null;
  let lastCloseoutRows = [];
  let lastCloseoutSummary = null;
  const debugLines = [];

  function money(n){
    return Number(n || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  }

  function fmtDate(v){
    if(!v) return "-";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("es-MX");
  }

  function setStatus(msg, isError = false){
    const el = $("status");
    if(!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#ffd1d1" : "";
    el.style.borderColor = isError ? "rgba(255,90,90,.45)" : "";
  }

  function tzLabel(){
    try{
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
    }catch{
      return "local";
    }
  }

  function getEffectiveCashierId(){
    if(canSeeGeneralCuts){
      const raw = String(adminSelectedCashierId ?? $("cashierSelect")?.value ?? "").trim();
      if(raw) return Number(raw);
      if(isJefeDeBarra && getCurrentShiftScope() === "barra"){
        return Number(session?.operatorId || 0) || null;
      }
      return null;
    }
    return Number(session?.operatorId || 0) || null;
  }

  function getCurrentShiftScope(){
    return fixedShiftScope || String($("shiftScope")?.value || "caja").trim().toLowerCase();
  }

  function scopeLabel(scope = getCurrentShiftScope()){
    return scope === "barra" ? "barra" : "caja";
  }

  function syncShiftScopeUi(){
    const wrap = $("shiftScopeWrap");
    const select = $("shiftScope");
    if(!wrap || !select) return;

    if(fixedShiftScope){
      select.value = fixedShiftScope;
      wrap.style.display = "none";
      select.disabled = true;
      return;
    }

    wrap.style.display = "inline-flex";
    select.disabled = false;
    if(!select.value) select.value = "caja";
  }

  function syncShiftActionLabels(){
    const label = scopeLabel();
    const openBtn = $("btnOpenShift");
    const closeBtn = $("btnCloseShift");
    const tableTitle = $("shiftTableTitle");
    const reportTitle = $("reportTitle");
    if(openBtn) openBtn.textContent = `Abrir turno de ${label}`;
    if(closeBtn) closeBtn.textContent = `Cerrar turno de ${label}`;
    if(tableTitle) tableTitle.textContent = `Turnos de ${label}`;
    if(reportTitle) reportTitle.textContent = `Reportes (${label === "barra" ? "Barra" : "Caja"})`;
  }

  function pushDebug(entry){
    if(!DEBUG) return;
    const text = typeof entry === "string" ? entry : JSON.stringify(entry);
    debugLines.unshift(text);
    if(debugLines.length > 6) debugLines.length = 6;
    const el = $("debugBanner");
    if(el) el.textContent = debugLines.join("\n");
  }

  function dlog(...args){
    if(DEBUG) console.log(...args);
  }

  function payloadShape(data){
    if(Array.isArray(data)){
      return { shape: "array", length: data.length, sampleKeys: data[0] && typeof data[0] === "object" ? Object.keys(data[0]) : [] };
    }
    if(data && typeof data === "object"){
      const keys = Object.keys(data);
      return {
        shape: "object",
        keys,
        hasItems: Array.isArray(data.items),
        itemsCount: Array.isArray(data.items) ? data.items.length : undefined,
        hasRows: Array.isArray(data.rows) || Array.isArray(data.Rows),
        rowsCount: Array.isArray(data.rows) ? data.rows.length : Array.isArray(data.Rows) ? data.Rows.length : undefined,
        summaryKeys: data.summary && typeof data.summary === "object" ? Object.keys(data.summary) : undefined
      };
    }
    return { shape: data === null ? "null" : typeof data };
  }

  function errLabel(e){
    const status = Number(e?.status || 0);
    const msg = String(e?.message || "Error inesperado");
    const url = String(e?.url || `${API_BASE}${window.location.pathname}`);
    return `ERROR ${status || 0}: ${msg} (URL: ${url})`;
  }

  async function openMyShift(){
    const scope = getCurrentShiftScope();
    const boxId = scope === "barra"
      ? (Number(session?.areaId || session?.area || 0) || null)
      : null;
    if(scope === "barra" && !boxId){
      setStatus("Turno de barra requiere un area asignada al operador.", true);
      return;
    }
    try{
      setStatus(`Abriendo turno de ${scopeLabel(scope)}...`);
      await apiJson(`/api/shifts/open?scope=${encodeURIComponent(scope)}`, {
        method: "POST",
        body: JSON.stringify({ boxId })
      });
      await loadAll();
      setStatus(`Turno de ${scopeLabel(scope)} abierto`);
    }catch(e){
      setStatus(errLabel(e), true);
    }
  }

  async function closeMyShift(){
    const scope = getCurrentShiftScope();
    try{
      setStatus(`Cerrando turno de ${scopeLabel(scope)}...`);
      await apiJson(`/api/shifts/close?scope=${encodeURIComponent(scope)}`, { method: "POST" });
      await loadAll();
      setStatus(`Turno de ${scopeLabel(scope)} cerrado`);
    }catch(e){
      setStatus(errLabel(e), true);
    }
  }

  function defaultRange(){
    const t = new Date();
    const f = new Date(t);
    f.setDate(t.getDate() - 30);
    return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) };
  }

  function renderSummary(data){
    const b = data?.breakdown || {};
    $("kCount").textContent = String(data?.totalRecargas || 0);
    $("kTotal").textContent = money(data?.totalRecargado || 0);
    $("kCash").textContent = money(b.efectivo || 0);
    $("kCard").textContent = money(b.tarjeta || 0);
    $("kCrypto").textContent = money(b.cripto || 0);
    $("kTransfer").textContent = money(b.transferencia || 0);
    $("kOther").textContent = money(b.otro || 0);
    $("kShift").textContent = data?.currentShift?.shiftId ? `#${data.currentShift.shiftId}` : "Sin turno";
  }

  function renderShifts(items){
    const body = $("rows");
    if(!Array.isArray(items) || items.length === 0){
      body.innerHTML = `<tr><td colspan="9" class="muted">Sin turnos en el rango</td></tr>`;
      return;
    }

    body.innerHTML = items.map(x => `
      <tr>
        <td>#${x.shiftId}</td>
        <td>${x.cashierName || "-"} <span class="muted">(${x.cashierId ?? "-"})</span></td>
        <td>${fmtDate(x.openedAt)}</td>
        <td>${fmtDate(x.closedAt)}</td>
        <td>${x.status || "-"}</td>
        <td>${x.totalRecargas || 0}</td>
        <td>${money(x.totalRecargado || 0)}</td>
        <td>${fmtDate(x.lastRechargeAt)}</td>
        <td>
          <div class="row" style="gap:6px">
            <button class="btn alt" data-view="${x.shiftId}">Ver corte</button>
            <button class="btn alt" data-print="${x.shiftId}">Imprimir PDF</button>
          </div>
        </td>
      </tr>
    `).join("");

    body.querySelectorAll("button[data-view]").forEach(btn => {
      btn.addEventListener("click", () => {
        loadCloseout(Number(btn.getAttribute("data-view")));
      });
    });
    body.querySelectorAll("button[data-print]").forEach(btn => {
      btn.addEventListener("click", () => {
        printCloseout(Number(btn.getAttribute("data-print")));
      });
    });
  }

  function renderCloseout(data, fallbackLast = null){
    const d = data || {};
    const b = d?.desglosePorMetodo || {};
    const total = d?.totalRecargado || 0;
    const totalRec = d?.totalRecargas || 0;
    const expected = d?.totalEfectivoEsperado || b?.totalEfectivo || 0;
    const diff = d?.diferenciaContraEfectivoFisico || 0;
    const cashierName = d?.cashier || "-";
    const cashierId = d?.cashierId ?? "-";
    $("cutCashier").textContent = `${cashierName} (Id: ${cashierId})`;
    $("cutShift").textContent = d?.shiftId ? `#${d.shiftId}` : (selectedShiftId ? `#${selectedShiftId}` : "-");
    $("cutCount").textContent = String(totalRec || 0);
    $("cutTotal").textContent = money(total);
    $("cutExpected").textContent = money(expected);
    $("cutDiff").textContent = money(diff);
    $("cutLast").textContent = fmtDate(fallbackLast);

    // cache for print
    lastCloseoutData = data || null;
    lastCloseoutSummary = data || null;
    lastCloseoutRows = Array.isArray(d?.rows) ? d.rows : Array.isArray(d?.Rows) ? d.Rows : [];
    renderPrintRows(lastCloseoutRows);
  }

  function renderPrintRows(rows){
    const body = $("printRows");
    if(!body) return;
    if(!Array.isArray(rows) || rows.length === 0){
      body.innerHTML = `<tr><td colspan="6" class="muted">Sin datos</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <tr>
        <td>${r.CreatedAt || r.createdAt || ""}</td>
        <td>${r.CardUid || r.cardUid || ""}</td>
        <td>${money(r.Amount || r.amount || 0)}</td>
        <td>${r.PaymentMethod || r.paymentMethod || ""}</td>
        <td>${r.PaymentDetail || r.paymentDetail || ""}</td>
        <td>${r.Comment || r.comment || ""}</td>
      </tr>
    `).join("");
  }

  function setCloseoutMessage(msg){
    const el = $("closeout");
    if(!el) return;
    el.textContent = msg || "";
  }

  function apiHeadersCashierReports(){
    const hdr = { ...apiHeaders() };
    delete hdr["X-Festival-Id"];
    return hdr;
  }

  async function fetchJsonLogged(url, label){
    // Response shapes (observed/contract):
    // - /api/reports/cashier/summary -> object { from, to, cashierId, scope, totalRecargas, totalRecargado, breakdown, currentShift }
    // - /api/cashier/shifts -> object { from, to, cashierId, count, items: [...] }
    // - /api/auth/ops -> array [{ id, name, role, areaId, areaName }]
    const hdr = apiHeadersCashierReports();
    const from = $("fromDate")?.value || "";
    const to = $("toDate")?.value || "";
    const effectiveCashierId = getEffectiveCashierId();
    dlog(`[cashier-reportes] ${label} request`, {
      url,
      hasTenant: !!hdr["X-Tenant-Id"],
      hasFestival: !!hdr["X-Festival-Id"],
      hasAuth: !!hdr["Authorization"],
      hasOpToken: !!hdr["X-Operator-Token"],
      festivalSuppressed: true,
      from,
      to,
      tz: tzLabel(),
      effectiveCashierId
    });
    pushDebug({
      phase: "request",
      label,
      method: "GET",
      url,
      from,
      to,
      tz: tzLabel(),
      effectiveCashierId,
      hasTenant: !!hdr["X-Tenant-Id"],
      hasAuth: !!hdr["Authorization"],
      hasOpToken: !!hdr["X-Operator-Token"],
      hasFestival: !!hdr["X-Festival-Id"]
    });

    const res = await fetch(url, { headers: hdr, cache: "no-store" });
    const text = await res.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }

    const shape = payloadShape(data);
    dlog(`[cashier-reportes] ${label} response`, {
      url,
      status: res.status,
      ok: res.ok,
      shape
    });
    pushDebug({
      phase: "response",
      label,
      method: "GET",
      url,
      status: res.status,
      shape,
      rangeEffective: (data && typeof data === "object" && !Array.isArray(data)) ? { from: data.from, to: data.to } : undefined
    });

    if(!res.ok){
      throw Object.assign(new Error(data?.message || `HTTP ${res.status}`), {
        status: res.status,
        url: `${API_BASE}${url}`
      });
    }
    return data;
  }

  async function fetchCloseoutSummary(shiftId){
    // Response shape (observed/contract):
    // - /api/recharges/reports/shift/{id} -> object { shiftId, cashierId, cashier, totalRecargas, totalRecargado, desglosePorMetodo, ... }
    const phys = Number($("physicalCash")?.value || "");
    const qsp = new URLSearchParams();
    qsp.set("physicalCash", String(Number.isFinite(phys) && phys >= 0 ? phys : 0));
    qsp.set("t", Date.now().toString());
    const qs = `?${qsp.toString()}`;

    const url = `/api/recharges/reports/shift/${shiftId}${qs}`;
    dlog("[cashier-reportes] closeout-summary request", { url });
    pushDebug({ phase:"request", label:"closeout-summary", method:"GET", url, shiftId });
    const res = await fetch(url, { headers: apiHeadersCashierReports(), cache: "no-store" });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }

    if(!res.ok){
      throw Object.assign(new Error(data?.message || `HTTP ${res.status}`), {
        status: res.status,
        url: `${API_BASE}${url}`
      });
    }
    const shape = payloadShape(data);
    dlog("[cashier-reportes] closeout-summary response", {
      url,
      status: res.status,
      ok: res.ok,
      shape,
      totalRecargas: data?.totalRecargas ?? null
    });
    pushDebug({ phase:"response", label:"closeout-summary", method:"GET", url, status: res.status, shape, totalRecargas: data?.totalRecargas ?? null });
    return data;
  }

  async function fetchCloseoutRows(shiftId){
    // Response shape (observed/contract):
    // - /api/recharges/reports/shift/{id}/pdf-model -> object { Title|title, Summary|summary, Rows|rows, Metadata|metadata }
    const phys = Number($("physicalCash")?.value || "");
    const qsp = new URLSearchParams();
    qsp.set("physicalCash", String(Number.isFinite(phys) && phys >= 0 ? phys : 0));
    qsp.set("t", Date.now().toString());
    const qs = `?${qsp.toString()}`;
    const url = `/api/recharges/reports/shift/${shiftId}/pdf-model${qs}`;
    dlog("[cashier-reportes] closeout-rows request", { url });
    pushDebug({ phase:"request", label:"closeout-rows", method:"GET", url, shiftId });
    const res = await fetch(url, { headers: apiHeadersCashierReports(), cache: "no-store" });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    if(!res.ok){
      throw Object.assign(new Error(data?.message || `HTTP ${res.status}`), {
        status: res.status,
        url: `${API_BASE}${url}`
      });
    }
    const shape = payloadShape(data);
    dlog("[cashier-reportes] closeout-rows response", {
      url,
      status: res.status,
      ok: res.ok,
      shape,
      rows: Array.isArray(data?.Rows) ? data.Rows.length : Array.isArray(data?.rows) ? data.rows.length : null
    });
    pushDebug({ phase:"response", label:"closeout-rows", method:"GET", url, status: res.status, shape, rows: Array.isArray(data?.Rows) ? data.Rows.length : Array.isArray(data?.rows) ? data.rows.length : null });
    return data;
  }

  async function loadCloseout(shiftId){
    if(!shiftId) return;
    selectedShiftId = Number(shiftId);
    setCloseoutMessage("Cargando corte...");
    try{
      const [data, pdfModel] = await Promise.all([
        fetchCloseoutSummary(selectedShiftId),
        fetchCloseoutRows(selectedShiftId)
      ]);

      // normalize rows for print (if any)
      if(data && !data.rows && data.Rows) data.rows = data.Rows;
      const detailRows = Array.isArray(pdfModel?.Rows) ? pdfModel.Rows : (Array.isArray(pdfModel?.rows) ? pdfModel.rows : []);
      renderCloseout(data);
      lastCloseoutRows = detailRows;
      renderPrintRows(detailRows);
      dlog("[cashier-reportes] closeout render", {
        shiftId: selectedShiftId,
        renderedRows: detailRows.length,
        totalRecargas: data?.totalRecargas ?? 0
      });
      setCloseoutMessage(`Corte cargado: turno #${data?.shiftId ?? selectedShiftId} - Cajero: ${data?.cashier || "-"} (Id: ${data?.cashierId ?? "-"})`);
      setStatus(`Corte cargado del turno #${selectedShiftId}`);
    }
    catch(e){
      setCloseoutMessage(`${e?.message || "Error al cargar corte"} (HTTP ${e?.status || "?"})`);
      setStatus(errLabel(e), true);
      console.error("Closeout error:", e);
    }
  }

  async function printCloseout(shiftId){
    if(!shiftId) return;
    try{
      const summary = await fetchCloseoutSummary(shiftId);
      // asegurar panel coherente
      renderCloseout(summary);
      const pdfModel = await fetchCloseoutRows(shiftId);
      const rows = Array.isArray(pdfModel?.Rows) ? pdfModel.Rows : [];

      dlog("[print] summary:", summary);
      dlog("[print] detailRows:", rows.length);
      dlog("[print] data source keys:", Object.keys(summary || {}));

      const total = Number(summary?.totalRecargado || 0);
      const count = Number(summary?.totalRecargas || 0);
      if(total <= 0 && count <= 0){
        setStatus("No hay datos para imprimir.", true);
        return;
      }

      const fest = getFestivalId() || "-";
      $("printMeta").textContent = `Cajero: ${summary?.cashier || "-"} (Id: ${summary?.cashierId || "-"}) · Turno: ${summary?.shiftId || shiftId} · Festival: ${fest} · ${new Date().toLocaleString()}`;
      renderPrintRows(rows);

      document.body.classList.add("printing");
      const after = () => {
        document.body.classList.remove("printing");
        window.removeEventListener("afterprint", after);
      };
      window.addEventListener("afterprint", after);
      window.print();
    }catch(e){
      setStatus(errLabel(e), true);
    }
  }

  async function loadCashierOptionsIfAdmin(){
    const wrap = $("cashierPickerWrap");
    const select = $("cashierSelect");
    if(!wrap || !select || !canSeeGeneralCuts) return;

    wrap.style.display = "inline-flex";
    try{
      const payload = await fetchJsonLogged(`/api/auth/ops?t=${Date.now()}`, "ops-list");
      const list = Array.isArray(payload) ? payload : [];
      const targetRole = getCurrentShiftScope() === "barra" ? "jefedebarra" : "cajero";
      const cashiers = list.filter(x => String(x?.role || "").toLowerCase().replace(/[\s_-]/g, "") === targetRole);
      select.innerHTML = "";
      if(cashiers.length === 0){
        adminSelectedCashierId = getCurrentShiftScope() === "barra" && isJefeDeBarra
          ? (Number(session?.operatorId || 0) || null)
          : null;
        wrap.style.display = "none";
        return;
      }
      for(const c of cashiers){
        const opt = document.createElement("option");
        opt.value = String(c.id);
        opt.textContent = `${c.name} (#${c.id})`;
        select.appendChild(opt);
      }
      const q = new URLSearchParams(window.location.search);
      const fromQuery = Number(q.get("cashierId") || "");
      const storageKey = `cashless.dashboard_caja.reportes.operatorId.${getCurrentShiftScope()}`;
      const preferred = Number.isFinite(fromQuery) && fromQuery > 0
        ? fromQuery
        : Number(sessionStorage.getItem(storageKey) || "");
      const fallback = cashiers[0]?.id || null;
      adminSelectedCashierId = (preferred && cashiers.some(c => Number(c.id) === preferred)) ? preferred : fallback;
      if(adminSelectedCashierId) select.value = String(adminSelectedCashierId);
      select.onchange = () => {
        adminSelectedCashierId = Number(select.value || 0) || null;
        sessionStorage.setItem(storageKey, String(adminSelectedCashierId || ""));
        loadAll();
      };
      pushDebug({ phase:"ui", label:"cashier-select", cashiers: cashiers.length, selected: adminSelectedCashierId });
    }catch(e){
      setStatus(errLabel(e), true);
    }
  }

  async function loadAll(){
    const from = $("fromDate").value;
    const to = $("toDate").value;
    const shiftScope = getCurrentShiftScope();
    const qsObj = new URLSearchParams({ from, to, scope: shiftScope, t: Date.now().toString() });
    const effectiveCashierId = getEffectiveCashierId();
    if(effectiveCashierId) qsObj.set("cashierId", String(effectiveCashierId));
    const qs = qsObj.toString();
    pushDebug({ phase:"ui", label:"loadAll", from, to, tz: tzLabel(), effectiveCashierId, shiftScope });

    try{
      const summary = await fetchJsonLogged(`/api/reports/cashier/summary?${qs}`, "summary");
      renderSummary(summary || {});
    }catch(e){
      setStatus(errLabel(e), true);
      return;
    }

    try{
      const shifts = await fetchJsonLogged(`/api/cashier/shifts?${qs}`, "shifts");
      const items = shifts?.items || [];
      renderShifts(items);
      dlog("[cashier-reportes] shifts render", { count: items.length });
      pushDebug({ phase:"render", label:"shifts", count: items.length, effectiveCashierId });
      if(items.length > 0){
        selectedShiftId = Number(items[0].shiftId);
        renderCloseout(null, items[0].lastRechargeAt);
        await loadCloseout(selectedShiftId);
      }
      setStatus("Reportes cargados");
    }catch(e){
      setStatus(errLabel(e), true);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try{
      renderCashierMenu("cashierMenu", "/dashboard-caja/reportes.html");
      if(!isOps){
        $("unauth").style.display = "block";
        setStatus("No autorizado", true);
        return;
      }

      $("main").style.display = "block";
      $("sessionInfo").textContent = `${session?.name || "Operador"} - ${session?.role || "-"} - tenant ${session?.tenantId ?? "-"}`;
      if(!DEBUG && $("debugBanner")) $("debugBanner").style.display = "none";
      const r = defaultRange();
      $("fromDate").value = r.from;
      $("toDate").value = r.to;
      syncShiftScopeUi();
      syncShiftActionLabels();
      pushDebug({ phase:"ui", label:"init", role: session?.role, operatorId: session?.operatorId, tenantId: session?.tenantId, tz: tzLabel() });

      $("btnReload").addEventListener("click", loadAll);
      $("btnOpenShift")?.addEventListener("click", openMyShift);
      $("btnCloseShift")?.addEventListener("click", closeMyShift);
      $("btnRecalc").addEventListener("click", () => loadCloseout(selectedShiftId));
      $("shiftScope")?.addEventListener("change", async () => {
        adminSelectedCashierId = null;
        syncShiftActionLabels();
        await loadCashierOptionsIfAdmin();
        await loadAll();
      });
      await loadCashierOptionsIfAdmin();

      await loadAll();
    }catch(e){
      setStatus(errLabel(e), true);
    }
  });
})();
