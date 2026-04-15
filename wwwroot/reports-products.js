// wwwroot/reports-products.js
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

  function setErrorBox(text){
    const box = el("errorBox");
    if(!box) return;
    if(!text){
      box.style.display = "none";
      box.textContent = "";
      return;
    }
    box.style.display = "block";
    box.textContent = text;
  }

  function errLabel(err, url = ""){
    const status = Number(err?.status || 0);
    const msg = String(err?.message || "Error inesperado");
    return status > 0 ? `ERROR ${status}: ${msg} (URL: ${url || err?.url || "-"})` : `ERROR: ${msg}`;
  }

  function defaultDates(){
    const t = new Date();
    const f = new Date(t);
    f.setDate(t.getDate() - 6);
    return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10) };
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

  function normalizeRows(payload){
    const rows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload) ? payload : [];
    return rows.map(r => ({
      productId: r.productId ?? r.id ?? null,
      productName: r.productName ?? r.name ?? r.product ?? "-",
      qtyTotal: Number(r.qtyTotal ?? r.qty ?? r.quantity ?? 0),
      totalSold: Number(r.totalSold ?? r.total ?? r.amount ?? 0),
      avgTicket: Number(r.avgTicket ?? 0)
    }));
  }

  function renderRows(rows){
    const body = el("productsBody");
    if(!rows || rows.length === 0){
      body.innerHTML = `<tr><td colspan="4">Sin datos</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <tr>
        <td>${r.productName || `Producto ${r.productId ?? ""}`}</td>
        <td>${intFmt(r.qtyTotal ?? 0)}</td>
        <td>${money(r.totalSold ?? 0)}</td>
        <td>${money(r.avgTicket ?? 0)}</td>
      </tr>
    `).join("");
  }

  function computeStats(rows){
    let totalSold = 0;
    let totalUnits = 0;
    for(const r of rows){
      totalSold += Number(r.totalSold || 0);
      totalUnits += Number(r.qtyTotal || 0);
    }
    const productsCount = rows.length;
    const avgTicket = totalUnits > 0 ? (totalSold / totalUnits) : 0;

    const topQty = rows.slice().sort((a,b)=> (b.qtyTotal||0)-(a.qtyTotal||0))[0];
    const topTotal = rows.slice().sort((a,b)=> (b.totalSold||0)-(a.totalSold||0))[0];

    return {
      totalSold,
      totalUnits,
      productsCount,
      avgTicket,
      topQty: topQty ? `${topQty.productName} (${intFmt(topQty.qtyTotal)})` : "-",
      topTotal: topTotal ? `${topTotal.productName} (${money(topTotal.totalSold)})` : "-"
    };
  }

  function renderStats(stats){
    const set = (id, val) => { const n = el(id); if(n) n.textContent = val; };
    set("statTotalSold", money(stats.totalSold));
    set("statTotalUnits", intFmt(stats.totalUnits));
    set("statProducts", intFmt(stats.productsCount));
    set("statAvgTicket", money(stats.avgTicket));
    set("statTopQty", stats.topQty);
    set("statTopTotal", stats.topTotal);
  }

  function exportCsv(rows){
    const head = ["producto","cantidad","total_vendido","ticket_promedio"];
    const lines = [head.join(",")];
    for(const r of rows){
      lines.push([
        JSON.stringify(r.productName || `Producto ${r.productId ?? ""}`),
        r.qtyTotal ?? 0,
        r.totalSold ?? 0,
        r.avgTicket ?? 0
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reportes_productos.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function preparePrint(){
    const festivalText = el("festivalInfo")?.textContent || "Festival: -";
    const rangeText = el("rangePill")?.textContent || "-";
    const pf = el("printFestival");
    const pr = el("printRange");
    const pg = el("printGenerated");
    if(pf) pf.textContent = festivalText;
    if(pr) pr.textContent = `Rango: ${rangeText}`;
    if(pg) pg.textContent = `Generado: ${new Date().toLocaleString()}`;
  }

  async function load(){
    setMsg("");
    setErrorBox("");
    const f = loadFilters() || {};
    const from = f.from || defaultDates().from;
    const to = f.to || defaultDates().to;

    el("rangePill").textContent = `${from} -> ${to}`;
    el("filtersInfo").textContent = `Rango aplicado: ${from} -> ${to}`;

    const qs = new URLSearchParams({ from, to, ts: Date.now().toString() });
    const url = `/api/reports/by-product?${qs.toString()}`;

    const hdr = apiHeaders();
    console.log("[by-product] request", {
      url,
      from,
      to,
      festivalId: hdr["X-Festival-Id"] || "",
      headersPresent: {
        hasTenant: !!hdr["X-Tenant-Id"],
        hasFestival: !!hdr["X-Festival-Id"],
        hasAuth: !!hdr["Authorization"],
        hasOpToken: !!hdr["X-Operator-Token"]
      }
    });

    try{
      const res = await apiFetch(url, { method: "GET", cache: "no-store" });
      const text = await res.text().catch(() => "");
      let payload = null;
      try{ payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }

      console.log("[by-product] response", {
        url,
        status: res.status,
        ok: res.ok
      });

      if(!res.ok){
        throw Object.assign(new Error(payload?.message || res.statusText || `HTTP ${res.status}`), {
          status: res.status,
          url: `${API_BASE}${url}`
        });
      }

      const rows = normalizeRows(payload);
      console.log("[by-product] rows", {
        count: rows.length,
        sample: rows[0] || null
      });
      renderRows(rows);
      const stats = computeStats(rows);
      renderStats(stats);
      el("btnExport").onclick = () => exportCsv(rows);
      if(rows.length === 0){
        setMsg("Sin datos para el rango actual.");
      }else{
        setMsg(`OK - ${rows.length} producto(s)`);
      }
    }catch(err){
      renderRows([]);
      renderStats({ totalSold: 0, totalUnits: 0, productsCount: 0, avgTicket: 0, topQty: "-", topTotal: "-" });
      setMsg(errLabel(err, url));
      setErrorBox(errLabel(err, url));
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    requireSession();
    if (typeof renderAppMenu === "function") {
      renderAppMenu("appMenu", "/reports-products.html");
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
