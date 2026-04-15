// wwwroot/barras.js
requireSession();
const roleName = currentRoleName();
if(roleName !== "JefeDeBarra" && roleName !== "JefeDeStand"){
  requireUiPermission("areas_manage");
}
const role = String(getSession()?.role || getSession()?.Role || "").trim().toLowerCase();
if(role === "cajero" || role === "cashier"){
  window.location.href = "/dashboard-caja/";
  throw new Error("Forbidden role");
}

// Escape HTML
function esc(input){
  const s = String(input ?? "");
  return s
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function setMsg(text, isErr=false){
  const el = $("msg");
  el.textContent = text || "";
  el.style.color = isErr ? "#ff5a5a" : "";
}

function normArea(a){
  // Soporta PascalCase o camelCase
  return {
    id: a.id ?? a.Id,
    name: a.name ?? a.Name,
    type: a.type ?? a.Type,                  // server lo manda como string
    isActive: a.isActive ?? a.IsActive,
    customType: a.customType ?? a.CustomType
  };
}

function finalType(a){
  const ct = (a.customType || "").trim();
  return ct ? ct : (a.type || "");
}

let AREAS = [];

function matches(area, q, showInactive){
  if(!showInactive && !area.isActive) return false;
  q = (q || "").trim().toLowerCase();
  if(!q) return true;

  const hay = [
    area.name || "",
    area.type || "",
    area.customType || "",
    finalType(area) || ""
  ].join(" ").toLowerCase();

  return hay.includes(q);
}

function render(){
  const q = $("q").value;
  const showInactive = $("showInactive").checked;

  const tbody = $("rows");
  tbody.innerHTML = "";

  const list = AREAS
    .filter(a => matches(a, q, showInactive))
    .sort((a,b)=> String(a.name||"").localeCompare(String(b.name||"")));

  $("count").textContent = String(list.length);

  for(const a of list){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${a.id}</td>
      <td>
        <input class="field" data-id="${a.id}" data-field="name" style="width:100%" value="${esc(a.name)}">
        <div class="muted" style="margin-top:6px">Tipo final: <b>${esc(finalType(a))}</b></div>
      </td>

      <td>
        <select class="field" data-id="${a.id}" data-field="type" style="width:120px">
          <option value="Barra" ${String(a.type)==="Barra" ? "selected":""}>Barra</option>
          <option value="Stand" ${String(a.type)==="Stand" ? "selected":""}>Stand</option>
          <option value="General" ${String(a.type)==="General" ? "selected":""}>General</option>
        </select>
      </td>

      <td>
        <input class="field" data-id="${a.id}" data-field="customType" style="width:100%"
               value="${esc(a.customType)}" placeholder="VIP / Staff / Backstage...">
      </td>

      <td>
        ${a.isActive ? `<span class="pill ok">Activa</span>` : `<span class="pill bad">Inactiva</span>`}
        <div class="muted" style="margin-top:6px">
          <label style="display:flex;gap:8px;align-items:center">
            <input type="checkbox" data-id="${a.id}" data-field="isActive" ${a.isActive ? "checked":""}>
            Activa
          </label>
        </div>
      </td>

      <td>
        <div class="actions">
          <button class="btn alt small" data-act="save" data-id="${a.id}">Guardar</button>
          <button class="btn danger small" data-act="disable" data-id="${a.id}">Desactivar</button>
          <a class="btn alt small" href="pos.html?areaId=${a.id}">Abrir POS</a>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = parseInt(btn.dataset.id,10);
      const act = btn.dataset.act;
      try{
        if(act==="save") await saveArea(id);
        if(act==="disable") await disableArea(id);
      }catch(e){
        setMsg("Error: " + (e.message || e), true);
      }
    });
  });
}

async function loadAreas(){
  setMsg("Cargando...");
  try{
    const raw = await apiJson("/api/areas"); // PROTEGIDO
    AREAS = (raw || []).map(normArea);
    setMsg(`Listo: ${AREAS.length} barra(s).`);
    render();
  }catch(e){
    AREAS = [];
    render();
    setMsg("No pude cargar /api/areas: " + (e.message || e), true);
  }
}

function collectDto(id){
  const els = document.querySelectorAll(`[data-id="${id}"]`);
  const dto = { id, name:"", type:"Barra", isActive:true, customType:null };

  els.forEach(el=>{
    const f = el.dataset.field;
    if(f==="name") dto.name = (el.value || "").trim();
    if(f==="type") dto.type = (el.value || "Barra").trim();
    if(f==="customType"){
      const v = (el.value || "").trim();
      dto.customType = v ? v : null;
    }
    if(f==="isActive") dto.isActive = !!el.checked;
  });

  return dto;
}

async function saveArea(id){
  const dto = collectDto(id);
  if(!dto.name) return setMsg("Falta nombre.", true);

  setMsg("Guardando...");
  await apiJson(`/api/areas/${id}`, {
    method:"PUT",
    body: JSON.stringify({
      name: dto.name,
      type: dto.type,
      isActive: dto.isActive,
      customType: dto.customType
    })
  });

  await loadAreas();
  setMsg("Guardado ✅");
}

async function disableArea(id){
  if(!confirm("¿Desactivar esta barra? (no se borra, solo se apaga)")) return;
  setMsg("Desactivando...");
  await apiJson(`/api/areas/${id}`, { method:"DELETE" });
  await loadAreas();
  setMsg("Desactivada ✅");
}

async function createArea(){
  const name = ($("name").value || "").trim();
  const type = ($("type").value || "Barra").trim();
  const isActive = !!$("active").checked;

  const ctRaw = ($("customType").value || "").trim();
  const customType = ctRaw ? ctRaw : null;

  if(!name) return setMsg("Falta nombre.", true);

  setMsg("Creando...");
  await apiJson("/api/areas", {
    method:"POST",
    body: JSON.stringify({ name, type, isActive, customType })
  });

  $("name").value = "";
  $("customType").value = "";
  $("active").checked = true;

  await loadAreas();
  setMsg("Creada ✅");
}

// UI binds
$("btnCreate").addEventListener("click", ()=> createArea().catch(e=>setMsg(e.message,true)));
$("btnReload").addEventListener("click", ()=> loadAreas());
$("q").addEventListener("input", render);
$("showInactive").addEventListener("change", render);

$("btnLogout").addEventListener("click", ()=>{
  try{ clearSession(); }catch{}
  window.location.href = "/login.html";
});

// init
renderAppMenu("appMenu", "/barras.html");
loadAreas();
