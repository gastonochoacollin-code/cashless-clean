// wwwroot/menus.js
requireSession();
const roleName = currentRoleName();
if(roleName !== "JefeDeBarra" && roleName !== "JefeDeStand"){
  requireUiPermission("menus_manage");
}
const role = String(getSession()?.role || getSession()?.Role || "").trim().toLowerCase();
if(role === "cajero" || role === "cashier"){
  window.location.href = "/dashboard-caja/";
  throw new Error("Forbidden role");
}
document.addEventListener("DOMContentLoaded", () => {
  const host = document.getElementById("appMenu");
  if(host){
    host.innerHTML = `<a class="btn alt" href="/ops.html">Ops</a>`;
  }
  const backLink = document.querySelector('a[href="/dashboard.html"]');
  if(backLink){
    backLink.setAttribute("href", "/ops.html");
    backLink.textContent = "← Ops";
  }
});

function esc(v){
  const s = String(v ?? "");
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function num(v){
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function setMsg(t, err=false){
  const el = $("msg");
  el.textContent = t || "";
  el.style.color = err ? "#ff5a5a" : "";
}

let AREAS = [];
let PRODUCTS = [];
let MENU = []; // areaProducts (vinculos)

function selectedAreaId(){
  const v = $("areaSelect").value;
  const id = parseInt(v,10);
  return Number.isFinite(id) ? id : null;
}

function filterText(){
  return ($("q").value || "").trim().toLowerCase();
}

function applyFilterProducts(list){
  const q = filterText();
  if(!q) return list;
  return list.filter(p =>
    String(p.name||"").toLowerCase().includes(q) ||
    String(p.category||"").toLowerCase().includes(q)
  );
}

function applyFilterMenu(list){
  const q = filterText();
  if(!q) return list;
  return list.filter(x =>
    String(x.productName||"").toLowerCase().includes(q) ||
    String(x.category||"").toLowerCase().includes(q)
  );
}

function renderAreas(){
  const sel = $("areaSelect");
  sel.innerHTML = "";
  for(const a of AREAS){
    const opt = document.createElement("option");
    opt.value = a.id;
    const t = a.customType ? ` (${a.type}:${a.customType})` : ` (${a.type})`;
    opt.textContent = `${a.name}${t}`;
    sel.appendChild(opt);
  }
}

function renderProducts(){
  const tbody = $("productsRows");
  tbody.innerHTML = "";

  const list = applyFilterProducts(PRODUCTS)
    .sort((a,b)=> (b.id||0)-(a.id||0));

  $("countProducts").textContent = String(list.length);

  for(const p of list){
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <input class="field mini" data-pid="${p.id}" data-f="name" value="${esc(p.name)}">
      </td>
      <td style="width:140px">
        <input class="field mini" data-pid="${p.id}" data-f="price" value="${esc(p.price)}" inputmode="decimal">
      </td>
      <td style="width:160px">
        <input class="field mini" data-pid="${p.id}" data-f="category" value="${esc(p.category||"")}">
      </td>
      <td style="width:110px">
        <select class="field mini" data-pid="${p.id}" data-f="isActive">
          <option value="true" ${p.isActive ? "selected":""}>Sí</option>
          <option value="false" ${!p.isActive ? "selected":""}>No</option>
        </select>
      </td>
      <td style="width:240px">
        <div class="row">
          <button class="btn alt" data-act="saveProduct" data-id="${p.id}">Guardar</button>
          <button class="btn" data-act="addToArea" data-id="${p.id}">Agregar a barra</button>
          <button class="btn danger" data-act="disableProduct" data-id="${p.id}">Apagar</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const act = btn.dataset.act;
      const id = parseInt(btn.dataset.id,10);
      try{
        if(act==="saveProduct") await saveProduct(id);
        if(act==="disableProduct") await disableProduct(id);
        if(act==="addToArea") await addToArea(id);
      }catch(e){
        setMsg(e.message || String(e), true);
      }
    });
  });
}

function renderMenu(){
  const tbody = $("menuRows");
  tbody.innerHTML = "";

  const list = applyFilterMenu(MENU)
    .sort((a,b)=> String(a.productName||"").localeCompare(String(b.productName||"")));

  $("countMenu").textContent = String(list.length);

  for(const x of list){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="font-weight:800">${esc(x.productName)}</div>
        <div class="muted">${esc(x.category||"")}</div>
      </td>
      <td style="width:90px">${esc(x.basePrice)}</td>
      <td style="width:140px">
        <input class="field mini" data-apid="${x.id}" data-f="priceOverride" value="${esc(x.priceOverride ?? "")}" inputmode="decimal" placeholder="(opcional)">
      </td>
      <td style="width:90px">${esc(x.effectivePrice)}</td>
      <td style="width:110px">
        <select class="field mini" data-apid="${x.id}" data-f="isActive">
          <option value="true" ${x.isActive ? "selected":""}>Sí</option>
          <option value="false" ${!x.isActive ? "selected":""}>No</option>
        </select>
      </td>
      <td style="width:210px">
        <div class="row">
          <button class="btn alt" data-act="saveLink" data-id="${x.id}">Guardar</button>
          <button class="btn danger" data-act="removeLink" data-id="${x.id}">Quitar</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const act = btn.dataset.act;
      const id = parseInt(btn.dataset.id,10);
      try{
        if(act==="saveLink") await saveLink(id);
        if(act==="removeLink") await removeLink(id);
      }catch(e){
        setMsg(e.message || String(e), true);
      }
    });
  });
}


// ---------------- API calls ----------------

async function loadAreas(){
  // /api/areas (protegido) devuelve Type string + CustomType
  AREAS = await apiJson("/api/areas");
  if(!Array.isArray(AREAS) || AREAS.length===0){
    setMsg("No hay barras activas. Ve a Barras y crea una.", true);
  }
  renderAreas();
}

async function loadProducts(){
  PRODUCTS = await apiJson("/api/products");
  renderProducts();
}

async function loadMenu(){
  const areaId = selectedAreaId();
  if(!areaId){
    MENU = [];
    renderMenu();
    return;
  }
  MENU = await apiJson(`/api/areas/${areaId}/products`);
  renderMenu();
}

function collectProductDto(productId){
  const fields = document.querySelectorAll(`[data-pid="${productId}"]`);
  const dto = { name:"", price:0, category:null, isActive:true };
  for(const el of fields){
    const f = el.dataset.f;
    if(f==="name") dto.name = (el.value||"").trim();
    if(f==="price"){
      const n = num(el.value);
      dto.price = (n===null) ? NaN : n;
    }
    if(f==="category") dto.category = (el.value||"").trim() || null;
    if(f==="isActive") dto.isActive = (el.value === "true");
  }
  return dto;
}

async function createProduct(){
  const name = ($("pName").value||"").trim();
  const price = num($("pPrice").value);
  const category = ($("pCategory").value||"").trim() || null;
  const isActive = ($("pActive").value === "true");

  if(!name) return setMsg("Falta nombre del producto.", true);
  if(price===null || price<0) return setMsg("Precio inválido.", true);

  setMsg("Creando producto...");
  await apiJson("/api/products", {
    method:"POST",
    body: JSON.stringify({ name, price, category, isActive })
  });

  $("pName").value = "";
  $("pPrice").value = "";
  $("pCategory").value = "";
  $("pActive").value = "true";

  await loadProducts();
  setMsg("Producto creado ✅");
}

async function saveProduct(productId){
  const dto = collectProductDto(productId);
  if(!dto.name) return setMsg("Nombre requerido.", true);
  if(!Number.isFinite(dto.price) || dto.price<0) return setMsg("Precio inválido.", true);

  setMsg("Guardando producto...");
  await apiJson(`/api/products/${productId}`, {
    method:"PUT",
    body: JSON.stringify(dto)
  });

  await loadProducts();
  await loadMenu(); // por si se ve en menú
  setMsg("Producto guardado ✅");
}

async function disableProduct(productId){
  if(!confirm("¿Apagar este producto? (no se borra)")) return;
  setMsg("Apagando producto...");
  await apiJson(`/api/products/${productId}`, { method:"DELETE" });
  await loadProducts();
  await loadMenu();
  setMsg("Producto apagado ✅");
}

async function addToArea(productId){
  const areaId = selectedAreaId();
  if(!areaId) return setMsg("Selecciona una barra primero.", true);

  setMsg("Agregando a barra...");
  await apiJson(`/api/areas/${areaId}/products`, {
    method:"POST",
    body: JSON.stringify({ productId, priceOverride: null, isActive: true })
  });

  await loadMenu();
  setMsg("Agregado ✅");
}

function collectLinkDto(areaProductId){
  const fields = document.querySelectorAll(`[data-apid="${areaProductId}"]`);
  const dto = { priceOverride:null, isActive:true };
  for(const el of fields){
    const f = el.dataset.f;
    if(f==="priceOverride"){
      const v = (el.value||"").trim();
      if(!v) dto.priceOverride = null;
      else{
        const n = num(v);
        dto.priceOverride = (n===null) ? NaN : n;
      }
    }
    if(f==="isActive") dto.isActive = (el.value==="true");
  }
  return dto;
}

async function saveLink(areaProductId){
  const areaId = selectedAreaId();
  if(!areaId) return setMsg("Selecciona una barra.", true);

  const dto = collectLinkDto(areaProductId);
  if(dto.priceOverride!==null && (!Number.isFinite(dto.priceOverride) || dto.priceOverride<0))
    return setMsg("Override inválido.", true);

  setMsg("Guardando menú...");
  await apiJson(`/api/areas/${areaId}/products/${areaProductId}`, {
    method:"PUT",
    body: JSON.stringify(dto)
  });

  await loadMenu();
  setMsg("Menú guardado ✅");
}

async function removeLink(areaProductId){
  const areaId = selectedAreaId();
  if(!areaId) return setMsg("Selecciona una barra.", true);
  if(!confirm("¿Quitar este producto del menú de la barra?")) return;

  setMsg("Quitando...");
  await apiJson(`/api/areas/${areaId}/products/${areaProductId}`, { method:"DELETE" });

  await loadMenu();
  setMsg("Quitado ✅");
}


// ---------------- events ----------------

$("btnCreateProduct").addEventListener("click", ()=> createProduct().catch(e=>setMsg(e.message,true)));
$("btnReload").addEventListener("click", ()=> Promise.all([loadProducts(), loadMenu()]).catch(e=>setMsg(e.message,true)));
$("areaSelect").addEventListener("change", ()=> loadMenu().catch(e=>setMsg(e.message,true)));
$("q").addEventListener("input", ()=> { renderProducts(); renderMenu(); });

$("btnLogout").addEventListener("click", ()=>{
  try{ clearSession(); }catch{}
  window.location.href = "/login.html";
});

(async function init(){
  try{
    setMsg("Cargando...");
    await loadAreas();
    await loadProducts();
    await loadMenu();
    setMsg("Listo ✅");
  }catch(e){
    setMsg(e.message || String(e), true);
  }
})();

