const statusEl = document.getElementById("status");
const userSelect = document.getElementById("userSelect");

function setStatus(msg, ok=true){
  statusEl.textContent = msg;
  statusEl.className = "status " + (ok ? "ok" : "bad");
}

async function api(path, opts){
  const res = await fetch(path, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) ? (json.message || json.error) : text;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return json ?? text;
}

async function loadUsers(){
  const users = await api("/api/users");
  userSelect.innerHTML = "";
  users.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = `#${u.id} — ${u.name} (saldo: ${u.balance})`;
    userSelect.appendChild(opt);
  });
  if (users.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No hay usuarios";
    userSelect.appendChild(opt);
  }
}

document.getElementById("btnCreateUser").onclick = async () => {
  try{
    const name = document.getElementById("userName").value.trim();
    const u = await api("/api/users", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ name })
    });
    setStatus(`Usuario creado: #${u.id} ${u.name}`, true);
    document.getElementById("userName").value = "";
    await loadUsers();
  }catch(e){
    setStatus(`Error creando usuario: ${e.message}`, false);
  }
};

document.getElementById("btnReloadUsers").onclick = async () => {
  try{
    await loadUsers();
    setStatus("Usuarios actualizados.", true);
  }catch(e){
    setStatus(`Error cargando usuarios: ${e.message}`, false);
  }
};

document.getElementById("btnGetLastUid").onclick = async () => {
  try{
    const data = await api("/api/last-uid");
    const uid = data.uid;
    document.getElementById("lastUid").textContent = uid;
    document.getElementById("uidInput").value = uid;
    document.getElementById("balanceUid").value = uid;
    document.getElementById("topupUid").value = uid;
    setStatus(`Último UID: ${uid}`, true);
  }catch(e){
    setStatus(`No hay UID aún. Escaneá una pulsera y probá de nuevo. (${e.message})`, false);
  }
};

document.getElementById("btnAssign").onclick = async () => {
  try{
    const userId = parseInt(userSelect.value, 10);
    const uid = document.getElementById("uidInput").value.trim().toUpperCase();
    const data = await api("/api/assign-card", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ userId, uid })
    });
    setStatus(`Tarjeta asignada: UID ${data.uid} → UserId ${data.userId}`, true);
  }catch(e){
    setStatus(`Error asignando tarjeta: ${e.message}`, false);
  }
};

document.getElementById("btnBalance").onclick = async () => {
  const out = document.getElementById("balanceOut");
  try{
    const uid = document.getElementById("balanceUid").value.trim().toUpperCase();
    const data = await api(`/balance/${encodeURIComponent(uid)}`);
    out.textContent = JSON.stringify(data, null, 2);
    out.className = "status mono ok";
    setStatus("Saldo consultado.", true);
  }catch(e){
    out.textContent = `Error: ${e.message}`;
    out.className = "status mono bad";
    setStatus(`Error consultando saldo: ${e.message}`, false);
  }
};

document.getElementById("btnTopup").onclick = async () => {
  const out = document.getElementById("topupOut");
  try{
    const uid = document.getElementById("topupUid").value.trim().toUpperCase();
    const amount = parseFloat(document.getElementById("topupAmount").value);
    const data = await api(`/api/topup`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ uid, amount })
    });
    out.textContent = JSON.stringify(data, null, 2);
    out.className = "status mono ok";
    setStatus(`Recarga OK. Nuevo saldo: ${data.newBalance}`, true);
    document.getElementById("topupAmount").value = "";
    await loadUsers(); // refresca saldos en dropdown
  }catch(e){
    out.textContent = `Error: ${e.message}`;
    out.className = "status mono bad";
    setStatus(`Error recargando: ${e.message}`, false);
  }
};

(async function init(){
  try{
    await loadUsers();
    setStatus("Web lista. Escaneá una pulsera y usá “Tomar último UID”.", true);
  }catch(e){
    setStatus(`Error inicializando: ${e.message}`, false);
  }
})();
