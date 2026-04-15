(() => {
  const session = requireSession();
  const roleName = currentRoleName();
  const isBarBoss = roleName === "JefeDeBarra" || roleName === "JefeDeStand";
  const canView = isBarBoss || currentUserCan("reports_view");
  if(!canView){
    window.location.href = "/dashboard.html";
    throw new Error("No autorizado");
  }

  const $ = (id) => document.getElementById(id);
  const ownAreaId = Number(session?.areaId || session?.area || 0) || null;
  const state = {
    salesRows: [],
    shiftRows: []
  };

  function defaultRange(){
    const t = new Date();
    const f = new Date(t);
    f.setDate(t.getDate() - 6);
    return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) };
  }

  function setStatus(message, isError = false){
    const el = $("status");
    if(!el) return;
    el.textContent = message || "";
    el.classList.toggle("error", !!isError);
  }

  function money(value){
    return Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  }

  function toInt(value){
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function asItems(data){
    if(Array.isArray(data)) return data;
    if(Array.isArray(data?.items)) return data.items;
    return [];
  }

  function summaryTotal(data){
    return Number(
      data?.totalSold
      ?? data?.totalVendido
      ?? data?.total
      ?? data?.totalAmount
      ?? 0
    ) || 0;
  }

  function summaryTx(data){
    return toInt(
      data?.txCount
      ?? data?.transacciones
      ?? data?.transactions
      ?? data?.count
      ?? 0
    );
  }

  function summaryTips(data){
    return Number(
      data?.totalTips
      ?? data?.tips
      ?? data?.totalPropina
      ?? 0
    ) || 0;
  }

  function findAreaRow(rows, areaId){
    if(!Array.isArray(rows) || !areaId) return null;
    return rows.find((row) => Number(row?.areaId ?? row?.AreaId ?? 0) === Number(areaId)) || null;
  }

  function fmtDate(value){
    if(!value) return "-";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("es-MX");
  }

  function areaLabel(areaId){
    const select = $("areaSelect");
    if(!select || !areaId) return areaId ? `#${areaId}` : "-";
    const match = Array.from(select.options).find((opt) => Number(opt.value) === Number(areaId));
    return match?.textContent || `#${areaId}`;
  }

  function saleGross(row){
    const kind = String(row?.kind || row?.Kind || "").toUpperCase();
    if(kind === "TIP" || kind === "DONATION") return 0;
    const total = Number(row?.total || row?.Total || row?.amount || row?.Amount || 0) || 0;
    return total;
  }

  function inShiftWindow(row, shift){
    const createdAt = new Date(row?.createdAt || row?.CreatedAt || 0);
    const openedAt = new Date(shift?.openedAt || shift?.OpenedAt || 0);
    const closedRaw = shift?.closedAt || shift?.ClosedAt;
    const closedAt = closedRaw ? new Date(closedRaw) : null;
    if(Number.isNaN(createdAt.getTime()) || Number.isNaN(openedAt.getTime())) return false;
    if(createdAt < openedAt) return false;
    if(closedAt && !Number.isNaN(closedAt.getTime()) && createdAt > closedAt) return false;
    return true;
  }

  function enrichShiftRows(rows, salesRows, areaId){
    return asItems(rows).map((row) => {
      const areaSales = asItems(salesRows).filter((sale) => Number(sale?.areaId ?? sale?.AreaId ?? 0) === Number(areaId));
      const shiftTotal = areaSales
        .filter((sale) => inShiftWindow(sale, row))
        .reduce((sum, sale) => sum + saleGross(sale), 0);
      return {
        ...row,
        cutTotal: shiftTotal
      };
    });
  }

  async function loadAreas(){
    const select = $("areaSelect");
    if(!select) return;
    select.innerHTML = "";

    let list = [];
    try{
      try{
        list = await apiJson("/api/reports/areas", { method: "GET" });
      }catch(e){
        if(Number(e?.status || 0) !== 404) throw e;
        list = await apiJson("/api/areas", { method: "GET" });
      }
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudieron cargar barras"} (URL: ${e?.url || `${API_BASE}/api/reports/areas`})`, true);
      return;
    }

    if(!Array.isArray(list)) list = [];
    const rows = list.length ? list : (ownAreaId ? [{ id: ownAreaId, name: `Area ${ownAreaId}` }] : []);

    for(const area of rows){
      const opt = document.createElement("option");
      opt.value = String(area?.id ?? area?.Id ?? "");
      opt.textContent = area?.name ?? area?.Name ?? `Area ${opt.value}`;
      select.appendChild(opt);
    }

    if(ownAreaId && Array.from(select.options).some((opt) => opt.value === String(ownAreaId))){
      select.value = String(ownAreaId);
    }

    const selected = select.options[select.selectedIndex];
    $("areaInfo").textContent = selected ? selected.textContent : "-";
  }

  function selectedAreaId(){
    const raw = String($("areaSelect")?.value || "").trim();
    return raw ? Number(raw) : null;
  }

  async function loadCurrentShift(){
    try{
      const data = await apiJson("/api/shifts/current?scope=barra", { method: "GET" });
      if(data?.hasOpenShift){
        $("shiftInfo").textContent = `#${data.shiftId} (${fmtDate(data.openedAt || data.OpenedAt)})`;
      }else{
        $("shiftInfo").textContent = "Sin turno abierto";
      }
    }catch(e){
      $("shiftInfo").textContent = "No disponible";
    }
  }

  async function openShift(){
    const areaId = selectedAreaId() || ownAreaId;
    if(!areaId){
      setStatus("Selecciona una barra para abrir turno.", true);
      return;
    }
    try{
      setStatus("Abriendo turno de barra...");
      await apiJson("/api/shifts/open?scope=barra", {
        method: "POST",
        body: JSON.stringify({ boxId: areaId })
      });
      await loadCurrentShift();
      setStatus("Turno de barra abierto.");
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo abrir turno"} (URL: ${e?.url || `${API_BASE}/api/shifts/open?scope=barra`})`, true);
    }
  }

  async function closeShift(){
    try{
      setStatus("Cerrando turno de barra...");
      await apiJson("/api/shifts/close?scope=barra", { method: "POST" });
      await loadCurrentShift();
      setStatus("Turno de barra cerrado.");
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo cerrar turno"} (URL: ${e?.url || `${API_BASE}/api/shifts/close?scope=barra`})`, true);
    }
  }

  function renderSummary(summary, areaRows, recentRows, shiftRows){
    const areaId = selectedAreaId() || ownAreaId;
    const areaRow = findAreaRow(areaRows, areaId);
    const total = Number(areaRow?.totalSold ?? summaryTotal(summary) ?? 0) || 0;
    const tx = toInt(areaRow?.txCount ?? summaryTx(summary));
    const tips = Number(areaRow?.totalTips ?? summaryTips(summary) ?? 0) || 0;
    const avg = Number(areaRow?.avgTicket ?? (tx > 0 ? total / tx : 0)) || 0;
    const recentCount = Array.isArray(recentRows) ? recentRows.length : 0;
    const openShifts = Array.isArray(shiftRows) ? shiftRows.filter((row) => String(row?.status || "").toLowerCase() === "open").length : 0;
    const closedShifts = Array.isArray(shiftRows) ? shiftRows.filter((row) => String(row?.status || "").toLowerCase() === "closed").length : 0;

    $("kTotal").textContent = money(total);
    $("kTx").textContent = String(tx);
    $("kAvg").textContent = money(avg);
    $("kTips").textContent = money(tips);
    $("summaryBox").textContent = `Rango: ${$("fromDate").value} a ${$("toDate").value} | Barra: ${$("areaInfo").textContent} | Total: ${money(total)} | Tx: ${tx} | Ventas recientes: ${recentCount} | Turnos abiertos: ${openShifts} | Turnos cerrados: ${closedShifts}`;
  }

  function renderRecent(rows){
    const body = $("recentRows");
    if(!body) return;
    if(!Array.isArray(rows) || rows.length === 0){
      body.innerHTML = `<tr><td colspan="5" class="muted">Sin ventas en el rango actual</td></tr>`;
      return;
    }

    body.innerHTML = rows.map((row) => `
      <tr>
        <td>${fmtDate(row?.createdAt || row?.CreatedAt)}</td>
        <td>${row?.areaName || row?.AreaName || areaLabel(row?.areaId || row?.AreaId) || "-"}</td>
        <td>${row?.operatorName || row?.OperatorName || "-"}</td>
        <td class="mono">${row?.uidMasked || row?.UidMasked || row?.uid || row?.Uid || "-"}</td>
        <td class="mono">${money(row?.total || row?.Total || row?.amount || row?.Amount || 0)}</td>
      </tr>
    `).join("");
  }

  function renderShifts(rows){
    const body = $("shiftRows");
    if(!body) return;
    if(!Array.isArray(rows) || rows.length === 0){
      body.innerHTML = `<tr><td colspan="7" class="muted">Sin turnos para la barra y rango actual</td></tr>`;
      return;
    }

    body.innerHTML = rows.map((row) => `
      <tr>
        <td class="mono">${row?.shiftId || row?.id || "-"}</td>
        <td>${row?.cashierName || row?.operatorName || "-"}</td>
        <td>${areaLabel(row?.boxId || row?.BoxId)}</td>
        <td>${fmtDate(row?.openedAt || row?.OpenedAt)}</td>
        <td>${fmtDate(row?.closedAt || row?.ClosedAt)}</td>
        <td>${row?.status || row?.Status || "-"}</td>
        <td class="mono">${money(row?.cutTotal ?? row?.CutTotal ?? row?.totalRecargado ?? row?.TotalRecargado ?? 0)}</td>
      </tr>
    `).join("");
  }

  function printReport(){
    if(!state.shiftRows.length && !state.salesRows.length){
      setStatus("No hay datos para imprimir en el rango actual.", true);
      return;
    }
    setStatus("Preparando impresion...");
    window.print();
    setStatus("Vista lista para guardar en PDF.");
  }

  async function loadAll(){
    const from = $("fromDate").value;
    const to = $("toDate").value;
    const areaId = selectedAreaId() || ownAreaId;
    if(!areaId){
      setStatus("Selecciona una barra para consultar.", true);
      state.salesRows = [];
      state.shiftRows = [];
      renderSummary({}, [], [], []);
      renderRecent([]);
      renderShifts([]);
      return;
    }
    const qs = new URLSearchParams({ from, to, t: Date.now().toString() });
    if(areaId) qs.set("areaId", String(areaId));
    const qsText = qs.toString();

    try{
      setStatus("Cargando reportes de barra...");
      const [summaryResult, byAreaResult, salesResult, shiftsResult] = await Promise.allSettled([
        apiJson(`/api/reports/summary?${qsText}`, { method: "GET" }),
        apiJson(`/api/reports/sales-by-area?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&areaId=${encodeURIComponent(String(areaId))}&t=${Date.now()}`, { method: "GET" }),
        apiJson(`/api/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&areaId=${encodeURIComponent(String(areaId))}&take=5000&skip=0&export=true&t=${Date.now()}`, { method: "GET" }),
        apiJson(`/api/cashier/shifts?scope=barra&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&t=${Date.now()}`, { method: "GET" })
      ]);

      const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
      const byArea = byAreaResult.status === "fulfilled" && Array.isArray(byAreaResult.value) ? byAreaResult.value : [];
      const sales = salesResult.status === "fulfilled" ? salesResult.value : [];
      const shifts = shiftsResult.status === "fulfilled" ? shiftsResult.value : [];

      if(summaryResult.status === "rejected"){
        const e = summaryResult.reason;
        setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo cargar resumen"} (URL: ${e?.url || `${API_BASE}/api/reports/summary`})`, true);
      }else if(byAreaResult.status === "rejected"){
        const e = byAreaResult.reason;
        setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo cargar ventas por barra"} (URL: ${e?.url || `${API_BASE}/api/reports/sales-by-area`})`, true);
      }else if(salesResult.status === "rejected"){
        const e = salesResult.reason;
        setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo cargar ventas recientes"} (URL: ${e?.url || `${API_BASE}/api/sales`})`, true);
      }else if(shiftsResult.status === "rejected"){
        const e = shiftsResult.reason;
        setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudieron cargar turnos"} (URL: ${e?.url || `${API_BASE}/api/cashier/shifts`})`, true);
      }else{
        setStatus("Reportes de barra listos.");
      }

      const salesRows = asItems(sales).filter((row) => Number(row?.areaId ?? row?.AreaId ?? areaId) === Number(areaId));
      const recentRows = salesRows.slice(0, 12);
      const shiftRows = enrichShiftRows(
        asItems(shifts).filter((row) => Number(row?.boxId ?? row?.BoxId ?? 0) === Number(areaId)),
        salesRows,
        areaId
      );
      state.salesRows = salesRows;
      state.shiftRows = shiftRows;
      renderSummary(summary || {}, byArea, recentRows, shiftRows);
      renderRecent(recentRows);
      renderShifts(shiftRows);
      await loadCurrentShift();
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "Fallo al cargar"} (URL: ${e?.url || `${API_BASE}/api/reports/summary`})`, true);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    renderAppMenu("appMenu", "/reportes-barra.html");
    const festivalId = session?.festivalId || getFestivalId() || "-";
    $("sessionInfo").textContent = `${session?.name || "Operador"} - ${session?.role || session?.Role || "-"} - tenant ${session?.tenantId ?? "-"} - festival ${festivalId}`;

    const range = defaultRange();
    $("fromDate").value = range.from;
    $("toDate").value = range.to;

    await loadAreas();
    $("areaSelect")?.addEventListener("change", () => {
      const selected = $("areaSelect").options[$("areaSelect").selectedIndex];
      $("areaInfo").textContent = selected ? selected.textContent : "-";
      loadAll();
    });
    $("btnReload")?.addEventListener("click", loadAll);
    $("btnPrint")?.addEventListener("click", printReport);
    $("btnOpenShift")?.addEventListener("click", openShift);
    $("btnCloseShift")?.addEventListener("click", closeShift);

    await loadAll();
  });
})();
