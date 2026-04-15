function $(id){ return document.getElementById(id); }

function money(n){
  const v = Number(n || 0);
  return v.toLocaleString("es-MX", { style:"currency", currency:"MXN" });
}

function fmtInt(n){
  return Number(n || 0).toLocaleString("es-MX");
}

function renderTable(bodyId, rows, renderRow){
  const body = $(bodyId);
  if(!rows || rows.length === 0){
    body.innerHTML = `<tr><td colspan="6">Sin datos</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(renderRow).join("");
}

function init(){
  const raw = sessionStorage.getItem("cashless.printPayload");
  if(!raw){
    document.body.innerHTML = "<p>Sin datos para imprimir.</p>";
    return;
  }
  let payload = null;
  try{ payload = JSON.parse(raw); }catch{ payload = null; }
  if(!payload){
    document.body.innerHTML = "<p>Payload inválido.</p>";
    return;
  }

  const meta = payload.meta || {};
  const resumen = payload.resumen || {};

  $("subtitle").textContent = meta.tipo === "final" ? "Corte final del día" : "Corte de turno";
  $("metaDate").textContent = new Date(meta.fecha || Date.now()).toLocaleString();
  $("metaArea").textContent = `Área: ${meta.areaName || meta.areaId || "—"}`;
  $("metaRange").textContent = `Rango: ${meta.rango?.from || "—"} → ${meta.rango?.to || "—"}`;
  $("metaBy").textContent = `Generado por: ${meta.generadoPor || "—"}`;

  $("kpiTotal").textContent = money(resumen.totalSales ?? 0);
  $("kpiTips").textContent = money(resumen.totalTips ?? 0);
  $("kpiTx").textContent = fmtInt(resumen.txCount ?? 0);
  $("kpiAvg").textContent = money(resumen.avg ?? 0);

  renderTable("operatorsBody", payload.topOperadores || [], (r)=>`
    <tr>
      <td>${r.operatorName || (r.operatorId ? `#${r.operatorId}` : "—")}</td>
      <td>${fmtInt(r.txCount ?? 0)}</td>
      <td>${money(r.totalSold ?? r.total ?? 0)}</td>
    </tr>
  `);

  renderTable("recentBody", payload.transaccionesRecientes || [], (r)=>`
    <tr>
      <td>${r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
      <td>${r.uidMasked ?? "—"}</td>
      <td>${r.areaName || (r.areaId ? `Área ${r.areaId}` : "—")}</td>
      <td>${r.operatorName || (r.operatorId ? `#${r.operatorId}` : "—")}</td>
      <td>${money(r.total ?? 0)}</td>
      <td>${money(r.tip ?? 0)}</td>
    </tr>
  `);

  $("btnPrint").addEventListener("click", ()=> window.print());
}

document.addEventListener("DOMContentLoaded", init);
