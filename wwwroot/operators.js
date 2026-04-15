const session = requireSession();
if (typeof renderAppMenu === "function") {
  renderAppMenu("appMenu", "/operators.html");
}
const canManageOperators = typeof currentUserCan === "function" ? currentUserCan("operators_manage") : false;
if(!canManageOperators){
  window.location.href = "/ops.html";
  throw new Error("No operators permission");
}

function $(id){ return document.getElementById(id); }

const ROLE_OPTIONS = ["JefeDeBarra","JefeDeStand","JefeOperativo","CajeroDeBarra","Cajero","Admin","SuperAdmin"];

function esc(v){
  const s = String(v ?? "");
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function setMsg(id, text, isErr=false){
  const el = $(id);
  if(!el) return;
  el.textContent = text || "";
  el.style.color = isErr ? "#ff5a5a" : "";
}

let OPS = [];

function initCreateRoleSelect(){
  const select = $("role");
  if(!select) return;
  const current = String(select.value || "JefeDeBarra");
  select.innerHTML = ROLE_OPTIONS.map((role) =>
    `<option value="${role}" ${role === current ? "selected" : ""}>${role}</option>`
  ).join("");
  if(!ROLE_OPTIONS.includes(current)){
    select.value = "JefeDeBarra";
  }
}

function matches(op, q, onlyActive){
  if(onlyActive && !op.isActive) return false;
  q = (q||"").trim().toLowerCase();
  if(!q) return true;
  return String(op.name||"").toLowerCase().includes(q)
      || String(op.role||"").toLowerCase().includes(q)
      || String(op.id||"").includes(q);
}

function render(){
  const q = $("q").value;
  const onlyActive = $("onlyActive").checked;

  const tbody = $("rows");
  tbody.innerHTML = "";

  const list = OPS
    .filter(o => matches(o, q, onlyActive))
    .sort((a,b)=> String(a.name||"").localeCompare(String(b.name||"")));

  for(const o of list){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${o.id}</td>
      <td><input class="field" data-id="${o.id}" data-f="name" value="${esc(o.name)}" style="min-width:220px"/></td>
      <td>
        <select class="field" data-id="${o.id}" data-f="role" style="min-width:160px">
          ${ROLE_OPTIONS.map(r =>
            `<option value="${r}" ${String(o.role)===r?"selected":""}>${r}</option>`
          ).join("")}
        </select>
      </td>
      <td>${o.isActive ? `<span class="pill ok">Activo</span>` : `<span class="pill bad">Inactivo</span>`}</td>
      <td><input class="field" data-id="${o.id}" data-f="areaId" value="${esc(o.areaId)}" style="min-width:90px"/></td>
      <td>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="field" data-id="${o.id}" data-f="pin" placeholder="PIN nuevo (opcional)" style="min-width:170px"/>
          <label class="tiny" style="display:flex;gap:8px;align-items:center">
            <input type="checkbox" data-id="${o.id}" data-f="isActive" ${o.isActive?"checked":""}/>
            Activo
          </label>
          <button class="btn alt" data-act="save" data-id="${o.id}">Guardar</button>
          <button class="btn danger" data-act="disable" data-id="${o.id}">Eliminar</button>
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
        if(act==="save") await saveOperator(id);
        if(act==="disable") await disableOperator(id);
      }catch(e){
        setMsg("msg", "Error: " + (e.message || e), true);
      }
    });
  });
}

function collectDto(id){
  const els = document.querySelectorAll(`[data-id="${id}"]`);
  const dto = { id };
  for(const el of els){
    const f = el.dataset.f;
    if(f==="name") dto.name = el.value.trim();
    if(f==="role") dto.role = el.value;
    if(f==="pin") dto.pin = el.value.trim();
    if(f==="areaId") dto.areaId = parseInt(el.value,10) || null;
    if(f==="isActive") dto.isActive = !!el.checked;
  }
  return dto;
}

async function loadOperators(){
  setMsg("msg", "Cargando...");
  const list = await apiJson("/api/operators");
  OPS = Array.isArray(list) ? list.map(x => ({
    id: x.id,
    name: x.name,
    role: (typeof normalizeRoleName === "function" ? (normalizeRoleName(x.role ?? x.Role) || (x.role ?? x.Role)) : (x.role ?? x.Role)),
    areaId: x.areaId ?? x.AreaId,
    isActive: x.isActive
  })) : [];
  setMsg("msg", `Listo: ${OPS.length} colaborador(es).`);
  render();
}

async function createOperator(){
  const name = $("name").value.trim();
  const role = $("role").value;
  const pin = $("pin").value.trim();
  const areaIdRaw = $("areaId").value.trim();
  const isActive = $("active").checked;

  if(!name) return setMsg("msgCreate","Falta nombre.",true);
  if(!pin || pin.length < 4) return setMsg("msgCreate","PIN mínimo 4.",true);

  const payload = {
    name,
    role,
    pin,
    areaId: areaIdRaw ? parseInt(areaIdRaw,10) : null,
    isActive
  };

  setMsg("msgCreate","Creando...");
  await apiJson("/api/operators", { method:"POST", body: JSON.stringify(payload) });

  $("name").value = "";
  $("pin").value = "";
  $("areaId").value = "";
  $("active").checked = true;

  setMsg("msgCreate","Creado ✅");
  await loadOperators();
}

async function saveOperator(id){
  const dto = collectDto(id);
  if(!dto.name) return setMsg("msg","Falta nombre.",true);

  // pin opcional: si está vacío, no lo mandamos
  const payload = {
    name: dto.name,
    role: dto.role,
    isActive: dto.isActive,
    areaId: dto.areaId
  };
  if(dto.pin) payload.pin = dto.pin;

  setMsg("msg","Guardando...");
  await apiJson(`/api/operators/${id}`, { method:"PUT", body: JSON.stringify(payload) });
  setMsg("msg","Guardado ✅");
  await loadOperators();
}

async function disableOperator(id){
  if(!confirm("¿Desactivar colaborador? (soft delete)")) return;
  setMsg("msg","Desactivando...");
  await apiJson(`/api/operators/${id}`, { method:"DELETE" });
  setMsg("msg","Desactivado ✅");
  await loadOperators();
}

$("btnReload").addEventListener("click", ()=> loadOperators().catch(e=>setMsg("msg", e.message,true)));
$("btnCreate").addEventListener("click", ()=> createOperator().catch(e=>setMsg("msgCreate", e.message,true)));
$("q").addEventListener("input", render);
$("onlyActive").addEventListener("change", render);

$("btnDashboard").addEventListener("click", ()=> window.location.href = "/dashboard.html");

$("btnLogout").addEventListener("click", ()=>{
  try{ clearSession(); }catch{}
  window.location.href = "/login.html";
});

loadOperators().catch(e=>setMsg("msg","Error cargando /api/operators: "+(e.message||e),true));
initCreateRoleSelect();

