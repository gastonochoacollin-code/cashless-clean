const session = requireSession();
const role = String(session?.role || session?.Role || "");
const isAdmin = role === "Admin" || role === "SuperAdmin";
if(!isAdmin){
  window.location.href = "/ops.html";
  throw new Error("Role not allowed");
}

function $(id){ return document.getElementById(id); }

function setSessionInfo(){
  const name = session?.name || session?.operatorName || "Operador";
  $("sessionInfo").textContent = `Sesion: ${name}${role ? " - " + role : ""}`;
}

function setMsg(id, text){
  const el = $(id);
  if(!el) return;
  el.textContent = text || "";
}

function fmtDate(d){
  if(!d) return "-";
  const dt = new Date(d);
  if(Number.isNaN(dt.getTime())) return "-";
  return dt.toISOString().slice(0,10);
}

let editId = null;

function resetForm(){
  $("name").value = "";
  $("startDate").value = "";
  $("endDate").value = "";
  $("location").value = "";
  $("active").checked = false;
  $("btnCreate").textContent = "Crear";
  $("btnCancel").style.display = "none";
  $("editHint").textContent = "Nota: la ubicacion aun no se guarda (pendiente en backend).";
  editId = null;
}

function beginEdit(f){
  editId = f.id ?? f.Id;
  $("name").value = f.name ?? f.Name ?? "";
  $("startDate").value = fmtDate(f.startDate ?? f.StartDate);
  $("endDate").value = fmtDate(f.endDate ?? f.EndDate);
  $("location").value = f.location ?? f.Location ?? "";
  $("active").checked = (f.isActive ?? f.IsActive) === true;
  $("btnCreate").textContent = "Guardar cambios";
  $("btnCancel").style.display = "inline-flex";
  $("editHint").textContent = `Editando festival #${editId}`;
}

async function loadFestivals(){
  setMsg("msg", "Cargando...");
  const list = await apiJson("/api/festivals");
  const rows = Array.isArray(list) ? list : [];

  const body = $("rows");
  body.innerHTML = "";

  let activeId = null;
  for(const f of rows){
    const id = f.id ?? f.Id;
    const name = f.name ?? f.Name ?? `Festival ${id}`;
    const isActive = (f.isActive ?? f.IsActive) === true;
    if(isActive) activeId = id;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${id}</td>
      <td>${name}</td>
      <td>${fmtDate(f.startDate ?? f.StartDate)}</td>
      <td>${fmtDate(f.endDate ?? f.EndDate)}</td>
      <td>${isActive ? "<span class=\"ok\">Activo</span>" : "-"}</td>
      <td>
        <button class="btn alt" data-act="activate" data-id="${id}">Activar</button>
        <button class="btn alt" data-act="edit" data-id="${id}">Editar</button>
      </td>
    `;
    body.appendChild(tr);
  }

  if(activeId){
    setFestivalId(activeId);
  }

  body.querySelectorAll("button[data-act='activate']").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = Number(btn.dataset.id);
      await activateFestival(id);
    });
  });

  body.querySelectorAll("button[data-act='edit']").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = Number(btn.dataset.id);
      const f = rows.find(x => (x.id ?? x.Id) === id);
      if(f) beginEdit(f);
    });
  });

  setMsg("msg", `Listo: ${rows.length} festival(es).`);
}

async function createFestival(){
  const name = ($("name").value || "").trim();
  const start = $("startDate").value;
  const end = $("endDate").value;
  const isActive = $("active").checked;

  if(!name) return setMsg("msgCreate", "Nombre requerido.");
  if(!start || !end) return setMsg("msgCreate", "Fechas requeridas.");

  const payload = {
    name,
    startDate: start,
    endDate: end,
    isActive,
    location: ($("location").value || "").trim() || null
  };

  if(editId){
    setMsg("msgCreate", "Guardando cambios...");
    await apiJson(`/api/festivals/${editId}`, { method:"PUT", body: JSON.stringify(payload) });
    setMsg("msgCreate", "Actualizado");
    resetForm();
  }else{
    setMsg("msgCreate", "Creando...");
    await apiJson("/api/festivals", { method:"POST", body: JSON.stringify(payload) });
    setMsg("msgCreate", "Creado");
  }
  await loadFestivals();
}

async function activateFestival(id){
  setMsg("msg", "Activando...");
  await apiJson(`/api/festivals/${id}/activate`, { method:"POST" });
  setFestivalId(id);
  await loadFestivals();
}

function init(){
  setSessionInfo();
  renderAppMenu("appMenu", "/festivales.html");

  $("btnBack").addEventListener("click", ()=> window.location.href = "/dashboard.html");
  $("btnLogout").addEventListener("click", ()=>{
    clearSession();
    window.location.href = "/login.html";
  });
  $("btnCreate").addEventListener("click", ()=> createFestival().catch(e=> setMsg("msgCreate", e.message || e)));
  $("btnCancel").addEventListener("click", resetForm);
  $("btnReload").addEventListener("click", ()=> loadFestivals().catch(e=> setMsg("msg", e.message || e)));

  resetForm();
  loadFestivals().catch(e=> setMsg("msg", e.message || e));
}

init();
