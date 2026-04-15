// wwwroot/reports.js
(() => {
  const el = (id) => document.getElementById(id);
  const FILTER_KEY = "cashless.reports.filters";
  const roleName = currentRoleName();
  const isAdmin = roleName === "Admin" || roleName === "SuperAdmin";
  const canViewGlobalReports = currentUserCan("reports_view");

  function showErr(msg){
    const box = el("errBox");
    if(!box) return;
    box.style.display = msg ? "inline-block" : "none";
    box.textContent = msg || "";
  }

  function errLabel(e){
    const status = Number(e?.status || 0);
    const msg = String(e?.message || "Error inesperado");
    return status > 0 ? `ERROR ${status}: ${msg}` : `ERROR: ${msg}`;
  }

  function defaultFilters(){
    const t = new Date();
    const f = new Date(t);
    f.setDate(t.getDate() - 6);
    return {
      from: f.toISOString().slice(0, 10),
      to: t.toISOString().slice(0, 10),
      areaId: "",
      operatorId: ""
    };
  }

  function loadFilters(){
    const raw = sessionStorage.getItem(FILTER_KEY);
    if(!raw) return defaultFilters();
    try{
      const f = JSON.parse(raw);
      return { ...defaultFilters(), ...f };
    }catch{
      return defaultFilters();
    }
  }

  function saveFilters(f){
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(f));
  }

  async function loadFestivalActive(){
    const target = el("festivalActive");
    if(!target) return;

    try{
      const list = await apiJson("/api/festivals", { method: "GET" });
      const active = Array.isArray(list)
        ? list.find(x => (x.isActive ?? x.IsActive) === true)
        : null;

      if(active){
        const id = active.id ?? active.Id;
        const name = active.name ?? active.Name ?? `Festival ${id}`;
        const start = (active.startDate ?? active.StartDate ?? "").toString().slice(0,10);
        const end = (active.endDate ?? active.EndDate ?? "").toString().slice(0,10);
        target.textContent = `Festival: ${name} (#${id}) ${start} - ${end}`;
        return;
      }

      if(Array.isArray(list) && list.length > 0){
        target.textContent = "Festival: (sin activo)";
        return;
      }
    }catch(e){
      target.textContent = "Festival: -";
      showErr(errLabel(e));
      return;
    }
  }

  async function loadAreas(){
    const sel = el("areaSelect");
    if(!sel) return;

    sel.innerHTML = "<option value=\"\">Todas</option>";
    try{
      let list = null;
      try{
        list = await apiJson("/api/reports/areas", { method: "GET" });
      }catch(e){
        if(Number(e?.status || 0) !== 404) throw e;
        list = await apiJson("/api/areas", { method: "GET" });
      }
      if(Array.isArray(list)){
        for(const a of list){
          const opt = document.createElement("option");
          opt.value = a.id ?? a.Id;
          opt.textContent = a.name ?? a.Name ?? `Area ${opt.value}`;
          sel.appendChild(opt);
        }
      }
    }catch(e){
      showErr(errLabel(e));
    }
  }

  function applyFilters(){
    showErr("");
    const from = el("fromDate").value;
    const to = el("toDate").value;
    if(!from || !to){
      showErr("Rango incompleto");
      return;
    }

    const data = {
      from,
      to,
      areaId: el("areaSelect").value || "",
      operatorId: el("operatorId").value || ""
    };
    saveFilters(data);
  }

  function clearFilters(){
    const d = defaultFilters();
    el("fromDate").value = d.from;
    el("toDate").value = d.to;
    el("areaSelect").value = "";
    el("operatorId").value = "";
    saveFilters(d);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    requireSession();
    if (typeof renderAppMenu === "function") {
      renderAppMenu("appMenu", "/reports.html");
    }

    const rechargesLink = el("linkRechargesReport");
    if(rechargesLink && !isAdmin){
      rechargesLink.style.display = "none";
    }

    if(!canViewGlobalReports){
      showErr("No autorizado para reportes generales");
      const filtersCard = document.querySelector(".card");
      if(filtersCard) filtersCard.style.display = "none";
      const grid = document.querySelector(".grid3");
      if(grid) grid.style.display = "none";
      return;
    }

    const f = loadFilters();

    el("fromDate").value = f.from;
    el("toDate").value = f.to;
    el("operatorId").value = f.operatorId || "";

    await loadAreas();
    el("areaSelect").value = f.areaId || "";

    loadFestivalActive();

    el("btnApply").addEventListener("click", applyFilters);
    el("btnClear").addEventListener("click", clearFilters);
    el("btnBack").addEventListener("click", () => location.href = "/dashboard.html");
  });
})();
