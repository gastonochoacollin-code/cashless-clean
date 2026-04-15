(() => {
  const el = (id) => document.getElementById(id);
  const state = { skip: 0, take: 50, rows: [], allRows: [] };
  const totalsEls = {
    total: () => el("totalSoldLabel"),
    subtotal: () => el("subtotalLabel"),
    tips: () => el("tipsLabel"),
    donation: () => el("donationLabel"),
    count: () => el("countLabel")
  };

  function money(n){
    return Number(n || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  }
  function errLabel(e){
    const status = Number(e?.status || 0);
    const msg = String(e?.message || "Error inesperado");
    return status > 0 ? `ERROR ${status}: ${msg}` : `ERROR: ${msg}`;
  }
  function setMsg(msg){
    el("msg").textContent = msg;
  }

  function sumTotals(rows){
    const acc = { subtotal: 0, tips: 0, donation: 0, total: 0, count: 0 };
    (rows || []).forEach(r => {
      acc.subtotal += Number(r.subtotal || 0);
      acc.tips += Number(r.tip || 0);
      acc.donation += Number(r.donation || 0);
      acc.total += Number(r.total || 0);
      acc.count += 1;
    });
    return acc;
  }

  function renderTotals(totals, totalCount, pageOnly){
    const t = totals || { subtotal: 0, tips: 0, donation: 0, total: 0, count: 0 };
    const totalLabel = totalsEls.total();
    const subtotalLabel = totalsEls.subtotal();
    const tipsLabel = totalsEls.tips();
    const donationLabel = totalsEls.donation();
    const countLabel = totalsEls.count();

    if(totalLabel) totalLabel.textContent = `${money(t.total)}${pageOnly ? " (pagina)" : ""}`;
    if(subtotalLabel) subtotalLabel.textContent = money(t.subtotal);
    if(tipsLabel) tipsLabel.textContent = money(t.tips);
    if(donationLabel) donationLabel.textContent = money(t.donation);
    if(countLabel){
      if(totalCount <= 0){
        countLabel.textContent = "0 · Sin datos para el rango/festival actual";
      }else{
        countLabel.textContent = `${totalCount}`;
      }
    }
  }

  async function loadFestivalInfo(){
    const target = el("festivalInfo");
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
        target.textContent = `Festival: ${name} (#${id})`;
        return;
      }
      target.textContent = "Festival: (sin activo)";
    }catch{
      target.textContent = "Festival: -";
    }
  }

  async function loadSelects(){
    el("areaSelect").innerHTML = `<option value="">Todas las areas</option>`;
    el("operatorSelect").innerHTML = `<option value="">Todos los operadores</option>`;

    const [areas, operators] = await Promise.all([
      apiJson("/api/areas", { method: "GET" }),
      apiJson("/api/operators", { method: "GET" })
    ]);

    (Array.isArray(areas) ? areas : []).forEach(a => {
      const opt = document.createElement("option");
      opt.value = String(a.id ?? a.Id);
      opt.textContent = a.name ?? a.Name ?? `Area ${opt.value}`;
      el("areaSelect").appendChild(opt);
    });
    (Array.isArray(operators) ? operators : []).forEach(o => {
      const opt = document.createElement("option");
      opt.value = String(o.id ?? o.Id);
      opt.textContent = `${o.name ?? o.Name ?? "Operador"} (#${opt.value})`;
      el("operatorSelect").appendChild(opt);
    });
  }

  function defaultDates(){
    const t = new Date();
    const f = new Date(t);
    f.setDate(t.getDate() - 6);
    el("fromDate").value = f.toISOString().slice(0, 10);
    el("toDate").value = t.toISOString().slice(0, 10);
  }

  function render(rows){
    const body = el("tbody");
    if(!rows.length){
      body.innerHTML = `<tr><td colspan="11" class="muted">Sin datos para el rango/festival actual.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <tr>
        <td class="mono">${r.id}</td>
        <td class="mono">${String(r.createdAt || "").replace("T", " ").slice(0, 19)}</td>
        <td>${r.areaName || (r.areaId ? `#${r.areaId}` : "-")}</td>
        <td>${r.operatorName || (r.operatorId ? `#${r.operatorId}` : "-")}</td>
        <td>${r.products || "-"}</td>
        <td class="mono">${money(r.subtotal)}</td>
        <td class="mono">${money(r.tip)}</td>
        <td class="mono">${money(r.donation)}</td>
        <td class="mono">${money(r.total)}</td>
        <td class="mono">${r.uid || "-"}</td>
        <td class="mono">${r.kind || "-"}</td>
      </tr>
    `).join("");
  }

  function buildQuery(){
    const qs = new URLSearchParams({
      from: el("fromDate").value,
      to: el("toDate").value,
      take: String(state.take),
      skip: String(state.skip)
    });
    const areaId = el("areaSelect").value;
    const operatorId = el("operatorSelect").value;
    const q = (el("q").value || "").trim();
    if(areaId) qs.set("areaId", areaId);
    if(operatorId) qs.set("operatorId", operatorId);
    if(q) qs.set("q", q);
    return qs;
  }

  async function load(){
    setMsg("Cargando ventas...");
    try{
      const qs = buildQuery();
      const url = `/api/sales?${qs.toString()}`;

      const hdr = apiHeaders();
      console.log("SALES_FETCH", {
        url,
        method: "GET",
        hasTenant: !!hdr["X-Tenant-Id"],
        hasFestival: !!hdr["X-Festival-Id"],
        hasAuth: !!hdr["Authorization"],
        hasOpToken: !!hdr["X-Operator-Token"]
      });

      const data = await apiJson(url, { method: "GET" });
      let items = [];
      let totals = null;
      let totalCount = 0;
      let pageOnly = false;

      if(Array.isArray(data)){
        items = data;
        totals = sumTotals(items);
        totalCount = items.length;
        pageOnly = true;
      }else{
        items = Array.isArray(data?.items) ? data.items : [];
        totalCount = Number(data?.totalCount ?? data?.count ?? items.length);
        if(data?.totals){
          totals = {
            subtotal: Number(data.totals.subtotal || 0),
            tips: Number(data.totals.tips || 0),
            donation: Number(data.totals.donation || 0),
            total: Number(data.totals.total || 0),
            count: totalCount
          };
        }else{
          totals = sumTotals(items);
          pageOnly = true;
        }
      }

      state.rows = items;
      render(state.rows);
      renderTotals(totals, totalCount, pageOnly);
      const fromLabel = (data?.from || el("fromDate").value || "").toString().slice(0, 19);
      const toLabel = (data?.to || el("toDate").value || "").toString().slice(0, 19);
      el("rangeInfo").textContent = `Rango aplicado: ${fromLabel} -> ${toLabel} · skip=${state.skip} take=${state.take}`;
      setMsg(state.rows.length ? `OK - ${state.rows.length} venta(s)` : "Sin datos para el rango/festival actual.");
    }catch(e){
      state.rows = [];
      render([]);
      renderTotals({ subtotal: 0, tips: 0, donation: 0, total: 0, count: 0 }, 0, false);
      setMsg(errLabel(e));
    }
  }

  function exportCsv(){
    const rows = state.rows || [];
    const head = ["id","fecha","area","operador","productos","subtotal","propina","donacion","total","uid","tipo"];
    const lines = [head.join(",")];
    rows.forEach(r => {
      lines.push([
        r.id ?? "",
        JSON.stringify(String(r.createdAt || "")),
        JSON.stringify(r.areaName || (r.areaId ? `#${r.areaId}` : "")),
        JSON.stringify(r.operatorName || (r.operatorId ? `#${r.operatorId}` : "")),
        JSON.stringify(r.products || ""),
        r.subtotal ?? 0,
        r.tip ?? 0,
        r.donation ?? 0,
        r.total ?? 0,
        JSON.stringify(r.uid || ""),
        JSON.stringify(r.kind || "")
      ].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ventas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildFiltersSummary(){
    const areaId = el("areaSelect").value || "Todas";
    const operatorId = el("operatorSelect").value || "Todos";
    const q = (el("q").value || "").trim() || "-";
    return `Area=${areaId}, Operador=${operatorId}, q=${q}`;
  }

  function fillPrintHeader(){
    const fest = el("festivalInfo")?.textContent || "Festival: -";
    const from = el("fromDate").value || "-";
    const to = el("toDate").value || "-";
    const pf = el("printFestival");
    const pr = el("printRange");
    const pfi = el("printFilters");
    const pg = el("printGenerated");
    if(pf) pf.textContent = fest;
    if(pr) pr.textContent = `${from} - ${to}`;
    if(pfi) pfi.textContent = buildFiltersSummary();
    if(pg) pg.textContent = new Date().toLocaleString();
  }

  async function fetchAllSales(){
    const qs = buildQuery();
    qs.set("skip", "0");
    qs.set("take", "5000");
    qs.set("export", "true");
    const url = `/api/sales?${qs.toString()}`;

    const hdr = apiHeaders();
    console.log("SALES_FETCH_ALL", {
      url,
      method: "GET",
      hasTenant: !!hdr["X-Tenant-Id"],
      hasFestival: !!hdr["X-Festival-Id"],
      hasAuth: !!hdr["Authorization"],
      hasOpToken: !!hdr["X-Operator-Token"]
    });

    const data = await apiJson(url, { method: "GET" });
    if(Array.isArray(data)) return data;
    return Array.isArray(data?.items) ? data.items : [];
  }

  async function printPdf(){
    try{
      const allRows = await fetchAllSales();
      console.log("[print] sales rows:", allRows.length);
      if(!allRows.length){
        setMsg("No hay ventas para imprimir.");
        return;
      }
      state.allRows = allRows;
      render(allRows);
      const totalsAll = sumTotals(allRows);
      renderTotals(totalsAll, allRows.length, false);
      fillPrintHeader();
      document.body.classList.add("printing");
      const after = () => {
        document.body.classList.remove("printing");
        window.removeEventListener("afterprint", after);
      };
      window.addEventListener("afterprint", after);
      window.print();
      load();
    }catch(e){
      setMsg(errLabel(e));
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    requireSession();
    renderAppMenu("appMenu", "/ventas.html");
    defaultDates();
    await Promise.all([loadFestivalInfo(), loadSelects()]);

    el("btnApply").addEventListener("click", () => { state.skip = 0; load(); });
    el("btnPrev").addEventListener("click", () => { state.skip = Math.max(0, state.skip - state.take); load(); });
    el("btnNext").addEventListener("click", () => { state.skip += state.take; load(); });
    el("btnCsv").addEventListener("click", exportCsv);
    el("btnPrint").addEventListener("click", printPdf);

    load();
  });
})();

