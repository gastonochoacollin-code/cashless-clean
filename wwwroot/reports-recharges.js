// wwwroot/reports-recharges.js
(() => {
  const el = (id) => document.getElementById(id);
  const FILTER_KEY = "cashless.reports.filters";
  requireUiPermission("reports_view");

  const money = (n) => Number(n || 0).toLocaleString("es-MX", { style:"currency", currency:"MXN" });
  const intFmt = (n) => Number(n || 0).toLocaleString("es-MX");

  function setMsg(text){
    const box = el("msgBox");
    if(!box) return;
    box.textContent = text || "";
  }

  function setErrorBox(text){
    const box = el("errorBox");
    if(!box) return;
    if(!text){
      box.style.display = "none";
      box.textContent = "";
      return;
    }
    box.style.display = "block";
    box.textContent = text;
  }

  function errLabel(err){
    const status = Number(err?.status || 0);
    const msg = String(err?.message || "Error inesperado");
    return status > 0 ? `ERROR ${status}: ${msg}` : `ERROR: ${msg}`;
  }

  function loadFilters(){
    const raw = sessionStorage.getItem(FILTER_KEY);
    if(!raw){
      const t = new Date();
      const f = new Date(t);
      f.setDate(t.getDate() - 6);
      return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10), areaId:"", operatorId:"" };
    }
    try{ return JSON.parse(raw); }catch{ return null; }
  }

  async function loadFestivalInfo(){
    const target = el("festivalInfo");
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
      target.textContent = "Festival: (sin activo)";
    }catch(err){
      target.textContent = "Festival: -";
      setMsg(errLabel(err));
    }
  }

  function setStat(id, value){
    const node = el(id);
    if(node) node.textContent = value;
  }

  function renderStats(summary){
    setStat("statTotal", money(summary?.totalRecharged || 0));
    setStat("statCount", intFmt(summary?.rechargesCount || 0));
    setStat("statAvg", money(summary?.avgTicket || 0));
    setStat("statUniqueCards", intFmt(summary?.uniqueCards || 0));
    setStat("statUniqueCashiers", intFmt(summary?.uniqueCashiers || 0));
  }

  function uidLast4(uid){
    const clean = String(uid || "").trim();
    if(clean.length <= 4) return clean || "-";
    return clean.slice(-4);
  }

  function renderRows(rows){
    const body = el("rowsBody");
    const wrap = el("detailTableWrap");
    const note = el("detailNote");
    if(!rows || rows.length === 0){
      if(wrap) wrap.style.display = "none";
      if(note) note.style.display = "block";
      body.innerHTML = `<tr><td colspan="8">Sin datos</td></tr>`;
      return;
    }
    if(wrap) wrap.style.display = "block";
    if(note) note.style.display = "none";
    body.innerHTML = rows.map(r => `
      <tr>
        <td>${r.createdAt ? new Date(r.createdAt).toLocaleString() : "-"}</td>
        <td>${r.operatorName || (r.operatorId ? `#${r.operatorId}` : "-")}</td>
        <td>${uidLast4(r.uid || r.cardUid)}</td>
        <td>${money(r.amount)}</td>
        <td>${r.paymentMethod || "-"}</td>
        <td>${r.shiftId ?? "-"}</td>
        <td>${r.txId ?? r.id ?? "-"}</td>
      </tr>
    `).join("");
  }

  function exportCsv(rows){
    const head = ["fecha","cajero","terminal","uid_last4","monto","metodo","turno","id"];
    const lines = [head.join(",")];
    for(const r of rows){
      lines.push([
        JSON.stringify(r.createdAt || ""),
        JSON.stringify(r.operatorName || ""),
        JSON.stringify(r.terminalId || ""),
        JSON.stringify(uidLast4(r.uid || r.cardUid)),
        Number(r.amount || 0).toFixed(2),
        JSON.stringify(r.paymentMethod || ""),
        JSON.stringify(r.shiftId ?? ""),
        r.txId ?? r.id ?? ""
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reportes_recargas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function preparePrint(){
    const festivalText = el("festivalInfo")?.textContent || "Festival: -";
    const rangeText = el("rangePill")?.textContent || "-";
    const pf = el("printFestival");
    const pr = el("printRange");
    const pg = el("printGenerated");
    if(pf) pf.textContent = festivalText;
    if(pr) pr.textContent = `Rango: ${rangeText}`;
    if(pg) pg.textContent = `Generado: ${new Date().toLocaleString()}`;
  }

  function attachPrint(rows){
    const btn = el("btnPrint");
    if(!btn) return;
    btn.onclick = () => {
      preparePrint();
      const header = el("printHeader");
      if(header) header.style.display = "block";
      window.print();
      setTimeout(() => {
        if(header) header.style.display = "none";
      }, 300);
    };
  }

  function computeSummaryFromRows(rows){
    const totalRecharged = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
    const rechargesCount = rows.length;
    const avgTicket = rechargesCount > 0 ? (totalRecharged / rechargesCount) : 0;
    const cards = new Set(rows.map(r => String(r.uid || r.cardUid || "").trim()).filter(Boolean));
    const cashiers = new Set(rows.map(r => String(r.operatorId || "").trim()).filter(Boolean));
    return {
      totalRecharged,
      rechargesCount,
      avgTicket,
      uniqueCards: cards.size,
      uniqueCashiers: cashiers.size
    };
  }

  async function fetchSummary(from, to){
    const url = `/api/reports/cashier/summary?${new URLSearchParams({ from, to }).toString()}`;
    return await apiJson(url, { method: "GET" });
  }

  async function fetchRows(from, to, areaId = "", operatorId = ""){
    const qs = new URLSearchParams({ from, to, take: "500" });
    if(areaId) qs.set("areaId", areaId);
    if(operatorId) qs.set("operatorId", operatorId);
    const url = `/api/reports/recharges-rows?${qs.toString()}`;
    return await apiJson(url, { method: "GET" });
  }

  async function fetchShifts(from, to){
    const qs = new URLSearchParams({ from, to });
    const url = `/api/cashier/shifts?${qs.toString()}`;
    return await apiJson(url, { method: "GET" });
  }

  async function fetchShiftRows(shiftId){
    const url = `/api/recharges/reports/shift/${encodeURIComponent(shiftId)}/pdf-model?physicalCash=0`;
    return await apiJson(url, { method: "GET" });
  }

  function normalizeShiftRows(shiftId, payload, shiftMeta){
    const fallbackName = shiftMeta?.cashierName ?? shiftMeta?.CashierName ?? shiftMeta?.operatorName ?? shiftMeta?.OperatorName ?? "";
    const fallbackId = shiftMeta?.cashierId ?? shiftMeta?.CashierId ?? shiftMeta?.operatorId ?? shiftMeta?.OperatorId ?? null;
    const fallbackTerminal = shiftMeta?.terminalId ?? shiftMeta?.TerminalId ?? shiftMeta?.terminal ?? shiftMeta?.box ?? "";
    const list = Array.isArray(payload?.Rows)
      ? payload.Rows
      : Array.isArray(payload?.rows)
        ? payload.rows
        : Array.isArray(payload?.recharges)
          ? payload.recharges
          : Array.isArray(payload?.items)
            ? payload.items
            : [];

    const extractTerminal = (val) => {
      const text = String(val || "");
      const m = text.match(/terminal(?:id)?\s*[:=]\s*([A-Za-z0-9_-]+)/i);
      return m ? m[1] : "";
    };

    return list.map(r => ({
      createdAt: r.CreatedAt ?? r.createdAt ?? r.ts ?? r.date ?? r.fecha ?? null,
      operatorId: r.cashierId ?? r.CashierId ?? r.operatorId ?? r.userId ?? r.operator?.id ?? fallbackId ?? null,
      operatorName: r.cashierName ?? r.CashierName ?? r.operatorName ?? r.userName ?? r.operator?.name ?? fallbackName ?? "",
      terminalId: r.terminalId ?? r.TerminalId ?? r.terminal ?? r.box ?? extractTerminal(r.PaymentDetail ?? r.paymentDetail ?? r.Comment ?? r.comment) ?? fallbackTerminal ?? "",
      uid: r.uid ?? r.cardUid ?? r.CardUid ?? r.cardUidLast4 ?? "",
      amount: r.amount ?? r.Amount ?? r.total ?? r.monto ?? 0,
      paymentMethod: r.paymentMethod ?? r.PaymentMethod ?? r.method ?? r.metodo ?? "",
      shiftId: r.shiftId ?? r.ShiftId ?? shiftId ?? null,
      txId: r.txId ?? r.Id ?? r.id ?? r.rechargeId ?? null
    }));
  }

  async function load(){
    setMsg("");
    setErrorBox("");
    const f = loadFilters() || {};
    const from = f.from || new Date(Date.now() - (6 * 24 * 60 * 60 * 1000)).toISOString().slice(0,10);
    const to = f.to || new Date().toISOString().slice(0,10);

    el("rangePill").textContent = `${from} -> ${to}`;

    let summaryOk = false;
    try{
      const hdr = apiHeaders();
      console.log("[recharges] headers", {
        hasTenant: !!hdr["X-Tenant-Id"],
        hasFestival: !!hdr["X-Festival-Id"],
        hasAuth: !!hdr["Authorization"],
        hasOpToken: !!hdr["X-Operator-Token"]
      });

      console.log("[recharges] summaryUrl", `/api/reports/cashier/summary?from=${from}&to=${to}`);
      const summaryPayload = await fetchSummary(from, to);

      const summary = summaryPayload || computeSummaryFromRows([]);
      const totalRecharged = summary.totalRecargado ?? summary.totalRecharged ?? 0;
      const rechargesCount = summary.totalRecargas ?? summary.rechargesCount ?? 0;
      const avgTicket = summary.avgTicket ?? (rechargesCount ? (totalRecharged / rechargesCount) : 0);

      renderStats({
        totalRecharged,
        rechargesCount,
        avgTicket,
        uniqueCards: summary.uniqueCards ?? 0,
        uniqueCashiers: summary.uniqueCashiers ?? 0
      });
      summaryOk = true;

    }catch(err){
      renderStats({ totalRecharged: 0, rechargesCount: 0, avgTicket: 0, uniqueCards: 0, uniqueCashiers: 0 });
      setMsg(errLabel(err));
      setErrorBox(errLabel(err));
    }

    let rows = [];
    try{
      console.log("[recharges] rowsUrl", `/api/reports/recharges-rows?from=${from}&to=${to}`);
      const rowsPayload = await fetchRows(from, to, f.areaId || "", f.operatorId || "");
      rows = Array.isArray(rowsPayload?.rows) ? rowsPayload.rows : [];
    }catch(err){
      const status = Number(err?.status || 0);
      if(status === 404){
        console.log("[recharges] rows 404, fallback to shifts");
        try{
          console.log("[recharges] shiftsUrl", `/api/cashier/shifts?from=${from}&to=${to}`);
          const shiftsPayload = await fetchShifts(from, to);
          const shifts = Array.isArray(shiftsPayload?.items)
            ? shiftsPayload.items
            : Array.isArray(shiftsPayload?.Items)
              ? shiftsPayload.Items
              : Array.isArray(shiftsPayload)
                ? shiftsPayload
                : [];
          const collected = [];
          for(const s of shifts){
            const shiftId = s.shiftId ?? s.ShiftId ?? s.id ?? s.Id;
            if(!shiftId) continue;
            try{
              const model = await fetchShiftRows(shiftId);
              collected.push(...normalizeShiftRows(shiftId, model, s));
            }catch(innerErr){
              console.warn("[recharges] shift rows error", { shiftId, status: innerErr?.status });
            }
          }
          rows = collected;
        }catch(inner){
          setMsg(errLabel(inner));
          setErrorBox(errLabel(inner));
        }
      }else{
        setMsg(errLabel(err));
        setErrorBox(errLabel(err));
      }
    }

    renderRows(rows);
    el("btnExport").onclick = () => exportCsv(rows);
    attachPrint(rows);

    if(!summaryOk){
      renderStats(computeSummaryFromRows(rows));
    }

    if(rows.length === 0){
      setMsg("Sin datos para el rango actual.");
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    requireSession();
    if (typeof renderAppMenu === "function") {
      renderAppMenu("appMenu", "/reports-recharges.html");
    }

    await loadFestivalInfo();
    el("btnReload").addEventListener("click", () => load());
    load().catch(err => {
      console.error("Reports recharges error:", err);
      renderRows([]);
      setMsg(errLabel(err));
      setErrorBox(errLabel(err));
    });
  });
})();
