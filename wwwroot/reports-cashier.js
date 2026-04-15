// wwwroot/reports-cashier.js
(() => {
  const el = (id) => document.getElementById(id);
  const FILTER_KEY = "cashless.reports.filters";

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
    return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10), operatorId: "", areaId: "" };
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

  function renderRows(rows){
    const body = el("rowsBody");
    if(!rows || rows.length === 0){
      body.innerHTML = `<tr><td colspan="4">Sin datos</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r=>`
      <tr>
        <td>${r.operatorName || (r.operatorId ? `#${r.operatorId}` : "-")}</td>
        <td>${intFmt(r.txCount || 0)}</td>
        <td>${money(r.totalSold || 0)}</td>
        <td>${money(r.totalTips || 0)}</td>
      </tr>
    `).join("");
  }

  function renderStats(rows){
    const totalSold = rows.reduce((a,b)=> a + Number(b.totalSold||0), 0);
    const totalTips = rows.reduce((a,b)=> a + Number(b.totalTips||0), 0);
    const tx = rows.reduce((a,b)=> a + Number(b.txCount||0), 0);
    el("statTotalSold").textContent = money(totalSold);
    el("statTips").textContent = money(totalTips);
    el("statOperators").textContent = intFmt(rows.length);
    el("statTx").textContent = intFmt(tx);
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
    const operatorId = f.operatorId || "";
    const areaId = f.areaId || "";

    el("rangePill").textContent = `${from} -> ${to}`;

    const qs = new URLSearchParams({ from, to, ts: Date.now().toString() });
    if(areaId) qs.set("areaId", areaId);
    if(operatorId) qs.set("operatorId", operatorId);

    try{
      const rows = await apiJson(`/api/reports/by-cashier?${qs.toString()}`, { method: "GET" });
      renderRows(rows || []);
      renderStats(rows || []);
      setMsg((rows || []).length ? "OK" : "Sin datos para el rango actual.");
    }catch(err){
      renderRows([]);
      renderStats([]);
      setMsg(errLabel(err));
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    requireSession();
    if (typeof renderAppMenu === "function") {
      renderAppMenu("appMenu", "/reports-cashier.html");
    }
    await loadFestivalInfo();
    const d = loadFilters();
    el("fromDate").value = d.from;
    el("toDate").value = d.to;
    el("operatorId").value = d.operatorId || "";
    el("btnApply").addEventListener("click", () => {
      saveFilters({ ...loadFilters(), from: el("fromDate").value, to: el("toDate").value, operatorId: el("operatorId").value });
      load();
    });
    el("btnReload").addEventListener("click", () => load());
    el("btnPrint").addEventListener("click", () => { preparePrint(); window.print(); });
    load();
  });
})();
