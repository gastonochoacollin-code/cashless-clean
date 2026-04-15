// wwwroot/reports-summary.js
(() => {
  const el = (id) => document.getElementById(id);
  const FILTER_KEY = "cashless.reports.filters";
  requireUiPermission("reports_view");

  const money = (n) => Number(n || 0).toLocaleString("es-MX", { style:"currency", currency:"MXN" });
  const intFmt = (n) => Number(n || 0).toLocaleString("es-MX");

  function setMsg(text){
    const box = el("msgBox");
    if(!box) return;
    box.textContent = text || "";
  }

  function errLabel(err){
    const status = Number(err?.status || 0);
    const msg = String(err?.message || "Error inesperado");
    return status > 0 ? `ERROR ${status}: ${msg}` : `ERROR: ${msg}`;
  }

  function defaultDates(){
    const t = new Date();
    const f = new Date(t);
    f.setDate(t.getDate() - 6);
    return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10), areaId: "", operatorId: "" };
  }


  function loadFilters(){
    const raw = sessionStorage.getItem(FILTER_KEY);
    if(!raw) return defaultDates();
    try{ return { ...defaultDates(), ...JSON.parse(raw) }; }catch{ return defaultDates(); }
  }

  function saveFilters(f){
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(f));
  }

  async function loadFestivalInfo(){
    const target = el("festivalInfo");
    if(!target) return;
    try{
      let list = null;
      try{
        list = await apiJson("/api/festivals/for-cashier", { method: "GET" });
      }catch(e){
        if(Number(e?.status || 0) !== 404) throw e;
        list = await apiJson("/api/festivals", { method: "GET" });
      }
      const active = Array.isArray(list) ? list.find(x => (x.isActive ?? x.IsActive) === true) : null;
      if(active){
        const id = active.id ?? active.Id;
        const name = active.name ?? active.Name ?? `Festival ${id}`;
        const start = (active.startDate ?? active.StartDate ?? "").toString().slice(0,10);
        const end = (active.endDate ?? active.EndDate ?? "").toString().slice(0,10);
        target.textContent = `Festival: ${name} (#${id}) ${start} - ${end}`;
        return;
      }
      target.textContent = "Festival: (sin activo)";
    }catch(err){
      target.textContent = "Festival: -";
      setMsg(errLabel(err));
    }
  }

  function renderSummary(s){
    el("kpiTotalSold").textContent = money(s.totalSold || 0);
    el("kpiTips").textContent = money(s.totalTips || 0);
    el("kpiUsers").textContent = intFmt(s.userCount || 0);
    el("kpiTx").textContent = intFmt(s.txCount || 0);
  }

  function renderSalesByArea(rows){
    const body = el("salesByAreaBody");
    if(!rows || rows.length === 0){
      body.innerHTML = `<tr><td colspan="5">Sin datos</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r=>`
      <tr>
        <td>${r.areaName || `Area ${r.areaId ?? ""}`}</td>
        <td>${money(r.totalSold)}</td>
        <td>${money(r.totalTips)}</td>
        <td>${intFmt(r.txCount)}</td>
        <td>${money(r.avgTicket)}</td>
      </tr>
    `).join("");
  }

  function preparePrint(){
    const festivalText = el("festivalInfo")?.textContent || "Festival: -";
    const rangeText = el("rangePill")?.textContent || "-";
    if(el("printFestival")) el("printFestival").textContent = festivalText;
    if(el("printRange")) el("printRange").textContent = rangeText;
    if(el("printGenerated")) el("printGenerated").textContent = new Date().toLocaleString();
  }

  async function load(){
    setMsg("");
    const f = loadFilters();
    const from = f.from;
    const to = f.to;
    const areaId = f.areaId || "";
    el("rangePill").textContent = `${from} -> ${to}`;

    const qs = new URLSearchParams({ from, to, ts: Date.now().toString() });
    if(areaId) qs.set("areaId", areaId);
    try{
      const summary = await apiJson(`/api/reports/summary?${qs.toString()}`, { method: "GET" });
      const byAreaRaw = await apiJson(`/api/reports/sales-by-area?${qs.toString()}`, { method: "GET" });
      const byArea = areaId
        ? (byAreaRaw || []).filter(r => String(r.areaId ?? "") === String(areaId))
        : byAreaRaw;
      renderSummary(summary || {});
      renderSalesByArea(byArea || []);
      setMsg((byArea || []).length ? "OK" : "Sin datos para el rango actual.");
    }catch(err){
      renderSummary({ totalSold: 0, totalTips: 0, userCount: 0, txCount: 0 });
      renderSalesByArea([]);
      setMsg(errLabel(err));
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    requireSession();
    if (typeof renderAppMenu === "function") {
      renderAppMenu("appMenu", "/reports-summary.html");
    }
    await loadFestivalInfo();
    const d = loadFilters();
    el("fromDate").value = d.from;
    el("toDate").value = d.to;
    el("btnApply").addEventListener("click", () => {
      saveFilters({ ...loadFilters(), from: el("fromDate").value, to: el("toDate").value });
      load();
    });
    el("btnReload").addEventListener("click", () => load());
    el("btnPrint").addEventListener("click", () => { preparePrint(); window.print(); });
    load();
  });
})();
