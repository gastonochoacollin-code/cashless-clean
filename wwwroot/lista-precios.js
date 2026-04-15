(() => {
  const session = requireSession();
  const roleName = currentRoleName();
  const isCashierPanel = roleName === "Cajero";

  const $ = (id) => document.getElementById(id);
  const state = {
    rows: []
  };

  function setStatus(message, isError = false){
    const el = $("status");
    if(!el) return;
    el.textContent = message || "";
    el.classList.toggle("error", !!isError);
  }

  function money(value){
    return Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  }

  function normalizedList(data){
    return Array.isArray(data) ? data : [];
  }

  function normalizeProduct(item){
    return {
      id: Number(item?.id ?? item?.Id ?? 0),
      name: String(item?.name ?? item?.Name ?? "-"),
      basePrice: Number(item?.price ?? item?.Price ?? 0) || 0,
      category: String(item?.category ?? item?.Category ?? "")
    };
  }

  function normalizeArea(item){
    return {
      id: Number(item?.id ?? item?.Id ?? 0),
      name: String(item?.name ?? item?.Name ?? `Area ${item?.id ?? item?.Id ?? ""}`),
      isActive: (item?.isActive ?? item?.IsActive) !== false
    };
  }

  function normalizeLink(item){
    return {
      areaId: Number(item?.areaId ?? item?.AreaId ?? 0),
      productId: Number(item?.productId ?? item?.ProductId ?? 0),
      isActive: (item?.isActive ?? item?.IsActive) !== false && (item?.productIsActive ?? item?.ProductIsActive) !== false,
      effectivePrice: Number(item?.effectivePrice ?? item?.EffectivePrice ?? item?.priceOverride ?? item?.PriceOverride ?? item?.basePrice ?? item?.BasePrice ?? 0) || 0
    };
  }

  function buildRows(products, areas, linksByArea){
    return products.map((product) => {
      const activeAreas = [];
      const priceLines = [];

      for(const area of areas){
        const links = Array.isArray(linksByArea.get(area.id)) ? linksByArea.get(area.id) : [];
        const match = links.find((item) => item.productId === product.id && item.isActive);
        if(!match) continue;
        activeAreas.push(area.name);
        priceLines.push(`${area.name}: ${money(match.effectivePrice || product.basePrice)}`);
      }

      return {
        ...product,
        activeAreas,
        priceLines
      };
    });
  }

  function render(){
    const tbody = $("priceRows");
    if(!tbody) return;
    const q = String($("q")?.value || "").trim().toLowerCase();
    const rows = state.rows.filter((row) => {
      if(!q) return true;
      return row.name.toLowerCase().includes(q)
        || row.category.toLowerCase().includes(q)
        || row.activeAreas.some((name) => name.toLowerCase().includes(q));
    });

    $("productCount").textContent = String(rows.length);

    if(!rows.length){
      tbody.innerHTML = `<tr><td colspan="4" class="muted">Sin productos para el filtro actual</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>
          <div>${row.name}</div>
          <div class="muted">${row.category || "Sin categoria"}</div>
        </td>
        <td class="mono">${money(row.basePrice)}</td>
        <td>${row.activeAreas.length ? row.activeAreas.join(", ") : '<span class="muted">No activo en barras</span>'}</td>
        <td>${row.priceLines.length ? row.priceLines.join("<br>") : '<span class="muted">Sin asignacion</span>'}</td>
      </tr>
    `).join("");
  }

  async function load(){
    try{
      setStatus("Cargando lista de precios...");
      const [productsRaw, areasRaw] = await Promise.all([
        apiJson("/api/products", { method: "GET" }),
        apiJson("/api/areas", { method: "GET" })
      ]);

      const products = normalizedList(productsRaw).map(normalizeProduct).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const areas = normalizedList(areasRaw).map(normalizeArea).filter((area) => area.isActive);
      $("areaCount").textContent = String(areas.length);

      const menuResults = await Promise.allSettled(
        areas.map((area) => apiJson(`/api/areas/${area.id}/products`, { method: "GET" }))
      );

      const linksByArea = new Map();
      let failedArea = null;
      areas.forEach((area, index) => {
        const result = menuResults[index];
        if(result?.status === "fulfilled"){
          linksByArea.set(area.id, normalizedList(result.value).map(normalizeLink));
          return;
        }
        linksByArea.set(area.id, []);
        failedArea = failedArea || { area, error: result?.reason };
      });

      state.rows = buildRows(products, areas, linksByArea);
      render();

      if(failedArea){
        const err = failedArea.error;
        setStatus(`ERROR ${Number(err?.status || 0)}: ${err?.message || "No se pudo cargar el menu de una barra"} (URL: ${err?.url || `${API_BASE}/api/areas/${failedArea.area.id}/products`})`, true);
      }else{
        setStatus(state.rows.length ? "Lista de precios lista." : "Sin productos disponibles.");
      }
    }catch(error){
      state.rows = [];
      render();
      setStatus(`ERROR ${Number(error?.status || 0)}: ${error?.message || "No se pudo cargar la lista de precios"} (URL: ${error?.url || `${API_BASE}/api/products`})`, true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if(isCashierPanel) renderCashierMenu("appMenu", "/lista-precios.html");
    else renderAppMenu("appMenu", "/lista-precios.html");

    const festivalId = session?.festivalId ?? (getFestivalId() || "-");
    $("sessionInfo").textContent = `${session?.name || "Operador"} | ${session?.role || session?.Role || "-"} | tenant ${session?.tenantId ?? "-"} | festival ${festivalId}`;
    $("q")?.addEventListener("input", render);
    $("btnReload")?.addEventListener("click", load);
    load();
  });
})();
