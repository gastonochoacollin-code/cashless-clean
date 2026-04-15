(() => {
  const session = requireSession();
  const roleName = currentRoleName();
  const isBarBoss = roleName === "JefeDeBarra" || roleName === "JefeDeStand";
  const canView = isBarBoss || currentUserCan("menus_manage") || currentUserCan("areas_manage");
  if(!canView){
    window.location.href = "/dashboard.html";
    throw new Error("No autorizado");
  }

  const $ = (id) => document.getElementById(id);
  let areas = [];
  let movements = [];
  let snapshot = [];

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
    el.style.color = isError ? "#ffd1d1" : "";
    el.style.borderColor = isError ? "rgba(255,90,90,.45)" : "";
  }

  function fmtDate(value){
    if(!value) return "-";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("es-MX");
  }

  async function loadCatalogs(){
    const [areasData, summaryData] = await Promise.all([
      apiJson("/api/areas", { method: "GET" }),
      apiJson("/api/inventory/summary", { method: "GET" })
    ]);

    areas = Array.isArray(areasData) ? areasData : [];
    snapshot = Array.isArray(summaryData?.snapshot) ? summaryData.snapshot : [];

    const select = $("areaFilter");
    if(select){
      const current = String(select.value || "");
      select.innerHTML = `<option value="">Todas</option>` + areas.map((area) => {
        const areaId = area?.id ?? area?.Id ?? "";
        const name = area?.name ?? area?.Name ?? `Area ${areaId}`;
        return `<option value="${areaId}">${name}</option>`;
      }).join("");
      if(current && Array.from(select.options).some((opt) => opt.value === current)){
        select.value = current;
      }
    }
  }

  async function loadMovements(){
    const from = $("fromDate")?.value || "";
    const to = $("toDate")?.value || "";
    const areaId = String($("areaFilter")?.value || "").trim();
    const type = String($("typeFilter")?.value || "").trim();
    const query = new URLSearchParams();
    if(from) query.set("from", from);
    if(to) query.set("to", to);
    if(areaId) query.set("areaId", areaId);

    const path = query.toString()
      ? `/api/inventory/movements?${query.toString()}`
      : "/api/inventory/movements";

    movements = await apiJson(path, { method: "GET" });
    if(!Array.isArray(movements)) movements = [];
    if(type){
      movements = movements.filter((row) => String(row?.direction || "") === type);
    }
  }

  function filteredSnapshot(){
    const areaId = Number($("areaFilter")?.value || 0) || null;
    return snapshot.filter((row) => !areaId || Number(row?.areaId || 0) === areaId);
  }

  function renderSnapshot(){
    const tbody = $("snapshotRows");
    if(!tbody) return;

    const rows = filteredSnapshot();
    if(!rows.length){
      tbody.innerHTML = `<tr><td colspan="4" class="muted">Sin existencias para el filtro actual</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .slice()
      .sort((a, b) =>
        String(a?.areaName || "").localeCompare(String(b?.areaName || ""))
        || String(a?.productName || "").localeCompare(String(b?.productName || ""))
      )
      .map((row) => `
        <tr>
          <td>${row?.areaName || `Area ${row?.areaId || "-"}`}</td>
          <td>${row?.productName || `Producto ${row?.productId || "-"}`}</td>
          <td class="mono">${Number(row?.barQty || 0) || 0}</td>
          <td class="mono">${Number(row?.warehouseQty || 0) || 0}</td>
        </tr>
      `).join("");
  }

  function render(){
    const tbody = $("rows");
    if(!tbody) return;

    $("kMoves").textContent = String(movements.length);
    $("kToBar").textContent = String(
      movements
        .filter((row) => row?.direction === "to_bar")
        .reduce((sum, row) => sum + (Number(row?.qty || row?.Qty || 0) || 0), 0)
    );
    $("kToWarehouse").textContent = String(
      movements
        .filter((row) => row?.direction === "to_warehouse" || row?.direction === "stock_in")
        .reduce((sum, row) => sum + (Number(row?.qty || row?.Qty || 0) || 0), 0)
    );
    $("rangeInfo").textContent = `Rango: ${$("fromDate")?.value || "-"} a ${$("toDate")?.value || "-"} - ${movements.length} movimiento(s)`;

    if(!movements.length){
      tbody.innerHTML = `<tr><td colspan="6" class="muted">Sin movimientos para el filtro actual</td></tr>`;
      renderSnapshot();
      setStatus(filteredSnapshot().length ? "Sin movimientos en el rango; mostrando existencias actuales." : "Sin movimientos para el rango actual.");
      return;
    }

    tbody.innerHTML = movements.map((row) => `
      <tr>
        <td>${fmtDate(row?.createdAt || row?.CreatedAt)}</td>
        <td>${row?.direction === "stock_in" ? "Entrada a almacen" : (row?.direction === "to_bar" ? "Envio a barra" : "Regreso a almacen")}</td>
        <td>${row?.areaName || "Almacen"}</td>
        <td>${row?.productName || `Producto ${row?.productId || "-"}`}</td>
        <td class="mono">${Number(row?.qty || row?.Qty || 0) || 0}</td>
        <td>${row?.operatorName || "-"}</td>
      </tr>
    `).join("");

    renderSnapshot();
    setStatus("Reporte listo para imprimir.");
  }

  async function reload(){
    setStatus("Cargando reporte real...");
    try{
      await loadCatalogs();
      await loadMovements();
      render();
    }catch(e){
      movements = [];
      snapshot = [];
      render();
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo cargar el reporte"} (URL: ${e?.url || `${API_BASE}/api/inventory/movements`})`, true);
    }
  }

  function printReport(){
    window.print();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    renderAppMenu("appMenu", "/inventarios-reportes.html");
    const festivalId = session?.festivalId || getFestivalId() || "-";
    $("sessionInfo").textContent = `${session?.name || "Operador"} - ${session?.role || session?.Role || "-"} - tenant ${session?.tenantId ?? "-"} - festival ${festivalId}`;

    const range = defaultRange();
    $("fromDate").value = range.from;
    $("toDate").value = range.to;

    $("fromDate")?.addEventListener("change", reload);
    $("toDate")?.addEventListener("change", reload);
    $("areaFilter")?.addEventListener("change", reload);
    $("typeFilter")?.addEventListener("change", reload);
    $("btnReload")?.addEventListener("click", reload);
    $("btnPrint")?.addEventListener("click", printReport);

    await reload();
  });
})();
