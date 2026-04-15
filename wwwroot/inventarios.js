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
  const ownAreaId = Number(session?.areaId || session?.area || 0) || null;
  let areas = [];
  let summary = { areaId: null, areas: [], warehouse: [], menu: [], snapshot: [], totals: {} };

  function esc(value){
    return String(value ?? "").replace(/[&<>\"']/g, (m) => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      "\"":"&quot;",
      "'":"&#039;"
    }[m]));
  }

  function setStatus(message, isError = false){
    const el = $("status");
    if(!el) return;
    el.textContent = message || "";
    el.style.color = isError ? "#ffd1d1" : "";
    el.style.borderColor = isError ? "rgba(255,90,90,.45)" : "";
  }

  function selectedAreaId(){
    const raw = String($("areaSelect")?.value || "").trim();
    return raw ? Number(raw) : null;
  }

  function selectedTransferAreaId(){
    const raw = String($("transferArea")?.value || "").trim();
    return raw ? Number(raw) : null;
  }

  function activeAreaId(){
    return selectedTransferAreaId() || selectedAreaId();
  }

  function fillAreaSelect(selectId, currentValue){
    const select = $(selectId);
    if(!select) return;

    select.innerHTML = "";
    for(const area of areas){
      const areaId = Number(area?.id ?? area?.Id ?? 0) || 0;
      if(areaId <= 0) continue;
      const opt = document.createElement("option");
      opt.value = String(areaId);
      opt.textContent = area?.name ?? area?.Name ?? `Area ${areaId}`;
      select.appendChild(opt);
    }

    const candidates = [currentValue, ownAreaId, Number(areas[0]?.id ?? areas[0]?.Id ?? 0) || ""];
    for(const candidate of candidates){
      if(candidate && Array.from(select.options).some((opt) => opt.value === String(candidate))){
        select.value = String(candidate);
        break;
      }
    }
  }

  async function loadAreas(){
    const data = await apiJson("/api/areas", { method: "GET" });
    areas = Array.isArray(data) ? data : [];
    fillAreaSelect("areaSelect", selectedAreaId());
    fillAreaSelect("transferArea", selectedTransferAreaId() || selectedAreaId());
  }

  function renderWarehouseOptions(){
    const select = $("warehouseProduct");
    if(!select) return;
    const current = String(select.value || "");
    const rows = Array.isArray(summary?.warehouse) ? summary.warehouse : [];

    select.innerHTML = "";
    for(const item of rows){
      const productId = Number(item?.id ?? item?.productId ?? 0) || 0;
      if(productId <= 0) continue;
      const opt = document.createElement("option");
      opt.value = String(productId);
      opt.textContent = item?.name ?? item?.productName ?? `Producto ${productId}`;
      select.appendChild(opt);
    }

    if(current && Array.from(select.options).some((opt) => opt.value === current)){
      select.value = current;
    }
  }

  function renderTransferOptions(){
    const select = $("transferProduct");
    if(!select) return;
    const current = String(select.value || "");
    const rows = Array.isArray(summary?.menu) ? summary.menu : [];

    select.innerHTML = "";
    for(const item of rows){
      const productId = Number(item?.productId || item?.id || 0) || 0;
      if(productId <= 0) continue;
      const opt = document.createElement("option");
      opt.value = String(productId);
      opt.textContent = item?.productName ?? item?.name ?? `Producto ${productId}`;
      select.appendChild(opt);
    }

    if(current && Array.from(select.options).some((opt) => opt.value === current)){
      select.value = current;
    }
    if(!select.value && select.options.length){
      select.selectedIndex = 0;
    }
  }

  function renderProducts(){
    const body = $("productsRows");
    if(!body) return;

    const rows = Array.isArray(summary?.warehouse) ? summary.warehouse : [];
    if(!rows.length){
      body.innerHTML = `<tr><td colspan="5" class="muted">Sin productos</td></tr>`;
      return;
    }

    body.innerHTML = rows.map((item) => `
      <tr>
        <td>${esc(item?.name || item?.productName || "-")}</td>
        <td>${esc(item?.category || "-")}</td>
        <td>${esc(item?.price ?? item?.basePrice ?? "0")}</td>
        <td>${Number(item?.qty || 0) || 0}</td>
        <td>${item?.isActive ? "Activo" : "Inactivo"}</td>
      </tr>
    `).join("");
  }

  function renderMenu(){
    const body = $("menuRows");
    if(!body) return;

    const rows = Array.isArray(summary?.menu) ? summary.menu : [];
    if(!rows.length){
      body.innerHTML = `<tr><td colspan="5" class="muted">Sin productos asignados a esta barra</td></tr>`;
      return;
    }

    body.innerHTML = rows.map((item) => `
      <tr>
        <td>${esc(item?.productName || "-")}</td>
        <td>${esc(item?.basePrice ?? "0")}</td>
        <td>${esc(item?.priceOverride ?? "-")}</td>
        <td>${Number(item?.soldQty || 0) || 0}</td>
        <td>${Number(item?.qty || 0) || 0}</td>
      </tr>
    `).join("");
  }

  function renderKpis(){
    $("kProducts").textContent = String(Number(summary?.totals?.products || 0) || 0);
    $("kWarehouseUnits").textContent = String(Number(summary?.totals?.warehouseUnits || 0) || 0);
    $("kBarUnits").textContent = String(Number(summary?.totals?.barUnits || 0) || 0);
  }

  async function loadSummary(){
    const areaId = activeAreaId();
    if(!areaId){
      summary = { areaId: null, areas, warehouse: [], menu: [], snapshot: [], totals: { products: 0, warehouseUnits: 0, barUnits: 0 } };
      renderProducts();
      renderMenu();
      renderKpis();
      renderWarehouseOptions();
      renderTransferOptions();
      setStatus("Selecciona una barra.", true);
      return;
    }

    setStatus("Cargando inventario real...");
    try{
      summary = await apiJson(`/api/inventory/summary?areaId=${encodeURIComponent(String(areaId))}`, { method: "GET" });
      renderProducts();
      renderMenu();
      renderKpis();
      renderWarehouseOptions();
      renderTransferOptions();
      setStatus("Inventario sincronizado con backend.");
    }catch(e){
      summary = { areaId, areas, warehouse: [], menu: [], snapshot: [], totals: { products: 0, warehouseUnits: 0, barUnits: 0 } };
      renderProducts();
      renderMenu();
      renderKpis();
      renderWarehouseOptions();
      renderTransferOptions();
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo cargar inventario"} (URL: ${e?.url || `${API_BASE}/api/inventory/summary`})`, true);
    }
  }

  async function addWarehouseStock(){
    const productId = Number($("warehouseProduct")?.value || 0) || 0;
    const qty = Math.max(0, Number($("warehouseQty")?.value || 0) || 0);
    if(productId <= 0){
      setStatus("Selecciona un producto para agregar al almacen.", true);
      return;
    }
    if(qty <= 0){
      setStatus("Captura una cantidad valida para almacen.", true);
      return;
    }

    setStatus("Registrando entrada a almacen...");
    try{
      await apiJson("/api/inventory/warehouse-in", {
        method: "POST",
        body: JSON.stringify({ productId, qty })
      });
      $("warehouseQty").value = "1";
      await loadSummary();
      setStatus(`Entrada registrada: ${qty} unidad(es) agregadas al almacen.`);
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo registrar la entrada"} (URL: ${e?.url || `${API_BASE}/api/inventory/warehouse-in`})`, true);
    }
  }

  async function transferStock(direction){
    const areaId = selectedTransferAreaId();
    const productId = Number($("transferProduct")?.value || 0) || 0;
    const qty = Math.max(0, Number($("transferQty")?.value || 0) || 0);

    if(!areaId){
      setStatus("Selecciona una barra para transferir.", true);
      return;
    }
    if(productId <= 0){
      setStatus("Selecciona un producto del menu de la barra.", true);
      return;
    }
    if(qty <= 0){
      setStatus("Captura una cantidad valida.", true);
      return;
    }

    const payload = {
      productId,
      areaId,
      qty,
      direction: direction === "toWarehouse" ? "to_warehouse" : "to_bar"
    };

    setStatus("Registrando movimiento...");
    try{
      await apiJson("/api/inventory/transfer", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      $("transferQty").value = "1";
      await loadSummary();
      setStatus(direction === "toWarehouse"
        ? `Transferencia realizada: ${qty} unidad(es) regresaron a almacen.`
        : `Transferencia realizada: ${qty} unidad(es) enviadas a la barra.`);
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudo registrar la transferencia"} (URL: ${e?.url || `${API_BASE}/api/inventory/transfer`})`, true);
    }
  }

  async function handleAreaChange(){
    const transfer = $("transferArea");
    const areaId = selectedAreaId();
    if(transfer && areaId && Array.from(transfer.options).some((opt) => opt.value === String(areaId))){
      transfer.value = String(areaId);
    }
    await loadSummary();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    renderAppMenu("appMenu", "/inventarios.html");
    const festivalId = session?.festivalId || getFestivalId() || "-";
    $("sessionInfo").textContent = `${session?.name || "Operador"} - ${session?.role || session?.Role || "-"} - tenant ${session?.tenantId ?? "-"} - festival ${festivalId}`;

    try{
      await loadAreas();
      await loadSummary();
    }catch(e){
      setStatus(`ERROR ${Number(e?.status || 0)}: ${e?.message || "No se pudieron cargar barras"} (URL: ${e?.url || `${API_BASE}/api/areas`})`, true);
    }

    $("areaSelect")?.addEventListener("change", handleAreaChange);
    $("transferArea")?.addEventListener("change", loadSummary);
    $("btnReload")?.addEventListener("click", loadSummary);
    $("btnAddWarehouse")?.addEventListener("click", addWarehouseStock);
    $("btnSendToBar")?.addEventListener("click", () => transferStock("toBar"));
    $("btnReturnToWarehouse")?.addEventListener("click", () => transferStock("toWarehouse"));
  });
})();
