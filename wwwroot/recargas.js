// wwwroot/recargas.js
(() => {
  const el = (id) => document.getElementById(id);

  const session = requireSession();
  requireUiPermission("topup", "/dashboard.html");
  if (typeof renderAppMenu === "function") {
    renderAppMenu("appMenu", "/recargas.html");
  }

  let terminalBinding = null;

  function loadTerminalId(){
    return getTerminalId({ fallback: "BARRA-01" });
  }

  function setTerminalId(newId){
    return terminalBinding
      ? terminalBinding.save(newId || "BARRA-01")
      : saveTerminalId(newId || "BARRA-01");
  }

  function initTerminalSelect(){
    const select = el("terminalSelect");
    terminalBinding = bindTerminalUi(select, el("terminalLabel"), { fallback: "BARRA-01" });
    setTerminalId(loadTerminalId());
    select?.addEventListener("change", () => {
      setTerminalId(select.value);
    });
  }

  function setStatus(msg, ok){
    const box = el("statusBox");
    if(!box) return;
    if(!msg){
      box.style.display = "none";
      box.textContent = "";
      box.className = "status";
      return;
    }
    box.style.display = "block";
    box.textContent = msg;
    box.className = ok ? "status ok" : "status bad";
  }

  function setUserInfo(name, balance){
    el("userName").textContent = name || "-";
    el("userBalance").textContent = (balance ?? "-").toString();
  }

  function getUid(){
    return normalizeUid(el("uidInput").value || "");
  }

  async function readErrorMessage(res){
    const text = await res.text().catch(() => "");
    if(!text) return res.statusText || "Error";
    try{
      const data = JSON.parse(text);
      return data?.message || text;
    }catch{
      return text;
    }
  }

  async function readUid(){
    setStatus("", false);
    try{
      const tid = loadTerminalId();
      const uid = await apiGetLastUid(tid);
      el("uidInput").value = uid || "";
      if(!uid){
        setUserInfo("-", "-");
        setStatus("Sin UID leido", false);
        return;
      }
      await lookupUid();
    }catch(e){
      setUserInfo("-", "-");
      setStatus("No se pudo leer UID", false);
    }
  }

  async function lookupUid(){
    setStatus("", false);
    const uid = getUid();
    if(!uid){
      setStatus("UID requerido", false);
      return;
    }

    try{
      const res = await apiFetch(`/api/cards/${encodeURIComponent(uid)}`, { method:"GET" });
      if(res.status === 401){
        clearSession();
        location.href = "/login.html";
        return;
      }
      if(res.status !== 200){
        const msg = await readErrorMessage(res);
        setUserInfo("-", "-");
        setStatus(`ERROR ${res.status}: ${msg}`, false);
        return;
      }
      const card = await res.json();
      setUserInfo(card.userName || "Usuario", card.balance ?? 0);
      setStatus(`Tarjeta OK (UID ${uid})`, true);
    }catch(e){
      setUserInfo("-", "-");
      setStatus(`ERROR: ${String(e?.message || "Error buscando tarjeta")}`, false);
    }
  }

  async function topup(){
    setStatus("", false);
    const uid = getUid();
    if(!uid) return setStatus("UID requerido", false);

    const amount = Number(el("amountInput").value);
    const paymentMethod = String(el("paymentMethod")?.value || "efectivo").trim().toLowerCase();
    if(!Number.isFinite(amount) || amount <= 0){
      return setStatus("Monto invalido", false);
    }

    try{
      const tid = loadTerminalId();
      const payload = { uid, amount, paymentMethod, terminalId: tid };
      let res = await apiFetch(`/api/topups?terminalId=${encodeURIComponent(tid)}`, {
        method:"POST",
        body: JSON.stringify(payload)
      });
      if(res.status === 403 || res.status === 404){
        res = await apiFetch(`/api/topup?terminalId=${encodeURIComponent(tid)}`, {
          method:"POST",
          body: JSON.stringify(payload)
        });
      }
      if(res.status === 401){
        clearSession();
        location.href = "/login.html";
        return;
      }
      if(res.status !== 200){
        const msg = await readErrorMessage(res);
        setStatus(`ERROR ${res.status}: ${msg}`, false);
        return;
      }
      const data = await res.json();

      const balance = data?.newBalance ?? data?.balance ?? null;
      if(balance !== null){
        setUserInfo(el("userName").textContent, balance);
      }
      setStatus(data?.message || `Recarga OK (${paymentMethod})`, true);
    }catch(e){
      setStatus(`ERROR: ${String(e?.message || "Error al recargar")}`, false);
    }
  }

  function init(){
    el("sessionInfo").textContent = `${session.name || "Sesion"} - ${session.role || ""}`.trim();
    const roleName = normalizeRoleName(session.role || session.Role);
    const dashboardHref = roleName === "Cajero" ? "/dashboard-caja/" : "/dashboard.html";
    if(roleName === "Cajero"){
      const appMenu = el("appMenu");
      if(appMenu){
        appMenu.innerHTML = `
          <a class="btn alt" href="/dashboard-caja/">Dashboard Caja</a>
          <a class="btn alt" href="/usuarios.html">Usuarios</a>
          <a class="btn alt" href="/lista-precios.html">Lista de precios</a>
        `;
      }
      if(el("btnDashboard")) el("btnDashboard").style.display = "none";
    }
    if(el("btnDashboard")) el("btnDashboard").href = dashboardHref;
    initTerminalSelect();
    el("terminalSave").addEventListener("click", () => {
      setTerminalId(el("terminalSelect").value);
    });

    el("btnReadUid").addEventListener("click", readUid);
    el("btnLookup").addEventListener("click", lookupUid);
    el("btnTopup").addEventListener("click", topup);
    el("btnQuick500").addEventListener("click", () => {
      el("amountInput").value = 500;
      el("amountInput").focus();
    });
    el("btnLogout").addEventListener("click", () => {
      clearSession();
      location.href = "/login.html";
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();


