const session = requireSession();

function $(id){ return document.getElementById(id); }
const AUTO_PRINT_TICKET_KEY = "cashless.pos.autoPrintTicket";
let terminalBinding = null;

function loadTerminalId(){
  return loadStoredTerminalId() || "BARRA-01";
}

function getTerminalId(){
  return (state && state.terminalId ? state.terminalId : (loadTerminalId() || "BARRA-01")).trim();
}
function setTerminalId(newId){
  const clean = terminalBinding
    ? terminalBinding.save(newId || "BARRA-01")
    : saveTerminalId(newId || "BARRA-01");
  state.terminalId = clean;
}

const state = {
  areas: [],
  areaId: null,
  menuId: null,
  products: [],
  cart: new Map(),
  lastUid: "",
  lastUidTimer: null,
  terminalId: "",
  card: null,
  beforeBalance: null,
  afterBalance: null,
  lastTicket: null
};

function setSessionInfo(){
  const name = session?.name || session?.operatorName || "Operador";
  const role = session?.role || session?.Role || "";
  $("sessionInfo").textContent = `Sesion: ${name}${role ? " · " + role : ""}`;
}

function initTerminalSelect(){
  terminalBinding = bindTerminalUi("terminalSelect", "terminalLabel", { fallback: "BARRA-01" });
  const select = $("terminalSelect");
  const current = terminalBinding?.value || loadTerminalId();
  setTerminalId(current);
  select?.addEventListener("change", () => {
    setTerminalId(select.value);
  });
}
function money(n){
  const v = Number(n || 0);
  return "$" + v.toFixed(2);
}

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseAmount(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatDateTime(value){
  const date = value instanceof Date ? value : new Date(value);
  if(Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(date);
}

function getAreaLabel(areaId = state.areaId){
  const area = state.areas.find(x => Number(x.id) === Number(areaId));
  return area?.name || (areaId ? `Area ${areaId}` : "-");
}

function getOperatorLabel(){
  return session?.name || session?.operatorName || (session?.operatorId ? `#${session.operatorId}` : "Operador");
}

function getSystemLabel(){
  return session?.festivalName || session?.festival?.name || "Cashless";
}

function isAutoPrintEnabled(){
  return localStorage.getItem(AUTO_PRINT_TICKET_KEY) === "1";
}

function setAutoPrintEnabled(enabled){
  if(enabled) localStorage.setItem(AUTO_PRINT_TICKET_KEY, "1");
  else localStorage.removeItem(AUTO_PRINT_TICKET_KEY);
}

function normalizeProduct(item){
  return {
    id: item.productId ?? item.id ?? item.product?.id,
    name: item.productName ?? item.name ?? item.product?.name ?? "Producto",
    price: Number(item.price ?? item.priceOverride ?? item.product?.price ?? item.unitPrice ?? 0),
    category: item.category ?? item.product?.category ?? ""
  };
}

function renderAreas(){
  const sel = $("areaSelect");
  sel.innerHTML = "";
  for(const a of state.areas){
    const opt = document.createElement("option");
    opt.value = String(a.id);
    opt.textContent = `${a.name} (#${a.id})`;
    sel.appendChild(opt);
  }
  if(state.areaId){
    sel.value = String(state.areaId);
  }else if(state.areas.length){
    state.areaId = state.areas[0].id;
    sel.value = String(state.areaId);
  }
}

function renderProducts(){
  const q = ($("q").value || "").trim().toLowerCase();
  const grid = $("productsGrid");
  grid.innerHTML = "";

  const list = state.products.filter(p => {
    if(!q) return true;
    return String(p.name || "").toLowerCase().includes(q)
      || String(p.category || "").toLowerCase().includes(q);
  });

  $("catalogMeta").textContent = `${list.length} productos`;

  for(const p of list){
    const card = document.createElement("div");
    card.className = "product";
    card.innerHTML = `
      <div>
        <b>${p.name}</b><br/>
        <small>${p.category || "-"}</small>
      </div>
      <div style="text-align:right">
        <div class="mono">${money(p.price)}</div>
        <button class="btn alt" data-id="${p.id}" style="margin-top:6px">Agregar</button>
      </div>
    `;
    grid.appendChild(card);
  }

  grid.querySelectorAll("button[data-id]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = Number(btn.dataset.id);
      addToCart(id);
    });
  });
}

function addToCart(productId){
  const p = state.products.find(x => Number(x.id) === Number(productId));
  if(!p) return;
  const existing = state.cart.get(p.id);
  if(existing){
    existing.qty += 1;
  }else{
    state.cart.set(p.id, { id: p.id, name: p.name, price: p.price, qty: 1 });
  }
  renderCart();
}

function renderCart(){
  const rows = $("cartRows");
  rows.innerHTML = "";

  const items = Array.from(state.cart.values());
  if(items.length === 0){
    $("cartMsg").textContent = "Sin productos";
  }else{
    $("cartMsg").textContent = `${items.length} producto(s)`;
  }

  for(const it of items){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.name}</td>
      <td class="mono">${money(it.price)}</td>
      <td>
        <div class="qty">
          <button class="btn alt" data-act="dec" data-id="${it.id}">-</button>
          <span class="mono">${it.qty}</span>
          <button class="btn alt" data-act="inc" data-id="${it.id}">+</button>
        </div>
      </td>
      <td class="mono">${money(it.price * it.qty)}</td>
      <td><button class="btn danger" data-act="del" data-id="${it.id}">X</button></td>
    `;
    rows.appendChild(tr);
  }

  rows.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = Number(btn.dataset.id);
      const act = btn.dataset.act;
      const it = state.cart.get(id);
      if(!it) return;
      if(act === "inc") it.qty += 1;
      if(act === "dec") it.qty = Math.max(1, it.qty - 1);
      if(act === "del") state.cart.delete(id);
      renderCart();
    });
  });

  renderTotals();
}

function getTotals(){
  const items = Array.from(state.cart.values());
  const subtotal = items.reduce((acc, it)=> acc + (it.price * it.qty), 0);

  const manual = Number($("tipManual").value || 0);
  const percent = Number($("tipPercent").value || 0);
  const tip = manual > 0 ? manual : (subtotal * (percent / 100));

  return {
    subtotal,
    tip,
    total: subtotal + tip
  };
}

function renderTotals(){
  const t = getTotals();
  $("subtotal").textContent = money(t.subtotal);
  $("tip").textContent = money(t.tip);
  $("total").textContent = money(t.total);
}

function renderTicketSummary(ticket){
  const box = $("ticketSummary");
  const btn = $("btnPrintTicket");
  if(!box || !btn) return;

  if(!ticket){
    box.hidden = true;
    btn.hidden = true;
    return;
  }

  $("ticketSummaryWhen").textContent = formatDateTime(ticket.createdAt);
  $("ticketSummaryArea").textContent = ticket.areaName || ticket.areaId || "-";
  $("ticketSummaryOperator").textContent = ticket.operatorName || ticket.operatorId || "-";
  $("ticketSummaryUid").textContent = ticket.uid || "-";
  $("ticketSummarySubtotal").textContent = money(ticket.subtotal);
  $("ticketSummaryTip").textContent = money(ticket.tip);
  $("ticketSummaryDonation").textContent = money(ticket.donation);
  $("ticketSummaryTotal").textContent = money(ticket.total);
  $("ticketSummaryBalance").textContent = ticket.afterBalance === null || ticket.afterBalance === undefined
    ? "-"
    : money(ticket.afterBalance);

  const itemsEl = $("ticketSummaryItems");
  itemsEl.innerHTML = "";
  for(const item of ticket.items || []){
    const li = document.createElement("li");
    li.textContent = `${item.qty} x ${item.name}`;
    itemsEl.appendChild(li);
  }

  box.hidden = false;
  btn.hidden = false;
}

function setPayMsg(text, kind){
  const el = $("payMsg");
  el.className = kind ? (kind === "ok" ? "success" : "error") : "muted";
  el.textContent = text || "";
}
function uidShort(uid){
  const clean = normalizeUid(uid);
  if(clean.length <= 6) return clean || "-";
  return `${clean.slice(0, 4)}...${clean.slice(-2)}`;
}

function errLabel(e){
  const status = Number(e?.status || 0) || 0;
  const msg = String(e?.message || "Error inesperado");
  const url = String(e?.url || `${API_BASE}${window.location.pathname}`);
  return `ERROR ${status}: ${msg} (URL: ${url})`;
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

function setPayEnabled(ok){
  const btn = $("btnPay");
  if(btn) btn.disabled = !ok;
}

function createTicketData({ response, payload, totals, uid, items, beforeBalance, afterBalance, balanceKnown }){
  const createdAtRaw = response?.createdAt || new Date().toISOString();
  return {
    systemName: getSystemLabel(),
    ticketId: response?.ticketId ?? response?.saleId ?? response?.transactionId ?? response?.id ?? null,
    areaId: response?.areaId ?? payload?.areaId ?? state.areaId,
    areaName: response?.areaName || getAreaLabel(response?.areaId ?? payload?.areaId ?? state.areaId),
    operatorId: response?.operatorId ?? payload?.operatorId ?? session?.operatorId ?? null,
    operatorName: response?.operatorName || getOperatorLabel(),
    terminalId: response?.terminalId || payload?.terminalId || getTerminalId() || "",
    createdAt: createdAtRaw,
    uid: response?.uid || uid || "",
    items: (items || []).map(item => ({
      id: item.id,
      name: item.name || "Producto",
      qty: Number(item.qty || 0),
      unitPrice: Number(item.price || 0),
      lineTotal: Number(item.price || 0) * Number(item.qty || 0)
    })),
    subtotal: parseAmount(response?.subtotal) ?? totals.subtotal,
    tip: parseAmount(response?.tipAmount) ?? totals.tip,
    donation: parseAmount(response?.donationAmount) ?? 0,
    total: parseAmount(response?.grandTotal) ?? totals.total,
    beforeBalance: parseAmount(beforeBalance),
    afterBalance: balanceKnown ? parseAmount(afterBalance) : null
  };
}

function createPrintableTicketHtml(ticket){
  const itemsHtml = (ticket.items || [])
    .map(item => `
      <div class="line item-row">
        <span>${escapeHtml(`${item.qty} x ${item.name}`)}</span>
        <span>${escapeHtml(money(item.lineTotal))}</span>
      </div>
    `)
    .join("");

  const donationLine = Number(ticket.donation || 0) > 0
    ? `<div class="line"><span>Donación</span><span>${escapeHtml(money(ticket.donation))}</span></div>`
    : "";

  const balanceText = ticket.afterBalance === null || ticket.afterBalance === undefined
    ? "No disponible"
    : money(ticket.afterBalance);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Ticket POS</title>
  <style>
    :root{color-scheme:light}
    *{box-sizing:border-box}
    body{
      margin:0;
      padding:0;
      background:#fff;
      color:#111;
      font-family:"Courier New",Courier,monospace;
    }
    .ticket{
      width:80mm;
      padding:10mm 7mm;
      margin:0 auto;
    }
    .center{text-align:center}
    .title{
      font-size:16px;
      font-weight:700;
      margin-bottom:6px;
    }
    .muted{
      font-size:11px;
      color:#555;
    }
    .section{
      margin-top:10px;
      padding-top:10px;
      border-top:1px dashed #999;
    }
    .line{
      display:flex;
      justify-content:space-between;
      gap:8px;
      margin:4px 0;
      font-size:12px;
    }
    .line span:last-child{
      text-align:right;
      white-space:nowrap;
    }
    .item-row{
      align-items:flex-start;
    }
    .balance{
      font-size:15px;
      font-weight:700;
    }
    @media print{
      @page{size:80mm auto;margin:0}
      body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center">
      <div class="title">${escapeHtml(ticket.systemName || "Cashless")}</div>
      <div>${escapeHtml(ticket.areaName || ticket.areaId || "-")}</div>
      <div class="muted">${escapeHtml(formatDateTime(ticket.createdAt))}</div>
    </div>

    <div class="section">
      <div class="line"><span>Cajero</span><span>${escapeHtml(ticket.operatorName || ticket.operatorId || "-")}</span></div>
      <div class="line"><span>UID / Ref</span><span>${escapeHtml(ticket.uid || "-")}</span></div>
    </div>

    <div class="section">
      ${itemsHtml}
    </div>

    <div class="section">
      <div class="line"><span>Subtotal</span><span>${escapeHtml(money(ticket.subtotal))}</span></div>
      <div class="line"><span>Propina</span><span>${escapeHtml(money(ticket.tip))}</span></div>
      ${donationLine}
      <div class="line"><span>Total</span><span>${escapeHtml(money(ticket.total))}</span></div>
    </div>

    <div class="section center">
      <div class="muted">Saldo restante</div>
      <div class="balance">${escapeHtml(balanceText)}</div>
    </div>

    <div class="section center">
      <div>Gracias</div>
      <div class="muted">Conserva este ticket</div>
    </div>
  </div>
  <script>
    window.addEventListener("load", function(){
      window.print();
    });
  </script>
</body>
</html>`;
}

function createPrintableTicketHtml58mm(ticket){
  const ticketId = ticket?.ticketId ? String(ticket.ticketId) : "";
  const terminalText = ticket?.terminalId || "-";
  const itemsHtml = (ticket?.items || [])
    .map(item => `
      <div class="item-row">
        <div class="item-main">${escapeHtml(item?.name || "Producto")}</div>
        <div class="item-meta">
          <span>${escapeHtml(`${Number(item?.qty || 0)} x ${money(item?.unitPrice || 0)}`)}</span>
          <span>${escapeHtml(money(item?.lineTotal || 0))}</span>
        </div>
      </div>
    `)
    .join("");

  const donationLine = Number(ticket?.donation || 0) > 0
    ? `<div class="line"><span>Donación</span><span>${escapeHtml(money(ticket.donation))}</span></div>`
    : "";

  const balanceText = ticket?.afterBalance === null || ticket?.afterBalance === undefined
    ? "No disponible"
    : money(ticket.afterBalance);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Ticket POS</title>
  <style>
    :root{color-scheme:light}
    *{box-sizing:border-box}
    html,body{
      width:58mm;
      min-width:58mm;
      max-width:58mm;
      overflow:hidden;
    }
    body{
      margin:0;
      padding:0;
      background:#fff;
      color:#000;
      font-family:"Segoe UI","Arial Narrow",Arial,sans-serif;
      font-size:8px;
      line-height:1.05;
    }
    .ticket{
      width:55.4mm;
      max-width:55.4mm;
      padding:.7mm .35mm 1.1mm;
      margin:0 auto;
      overflow:hidden;
    }
    .center{text-align:center}
    .eyebrow{
      font-size:7px;
      font-weight:900;
      letter-spacing:.08em;
      text-transform:uppercase;
      margin-bottom:.6mm;
    }
    .title{
      font-size:11px;
      font-weight:900;
      line-height:1;
      letter-spacing:.02em;
      text-transform:uppercase;
      margin-bottom:.3mm;
      color:#000;
      text-shadow:0 0 0 #000;
    }
    .subtitle{
      font-size:8px;
      font-weight:900;
      margin-bottom:.2mm;
      color:#000;
      text-shadow:0 0 0 #000;
    }
    .muted{
      font-size:7px;
      color:#111;
    }
    .section{
      margin-top:.9mm;
      padding-top:.9mm;
      border-top:1px dashed #666;
    }
    .line{
      display:grid;
      grid-template-columns:minmax(0, 1fr) 15mm;
      gap:.6mm;
      align-items:end;
      margin:.35mm 0;
      font-size:8px;
    }
    .line span:first-child{
      min-width:0;
      word-break:break-word;
    }
    .line span:last-child{
      text-align:right;
      white-space:nowrap;
      font-weight:900;
      color:#000;
      text-shadow:0 0 0 #000;
    }
    .meta-grid{
      display:grid;
      gap:.35mm;
    }
    .meta-grid .line span:first-child{
      font-weight:800;
    }
    .ref-value{
      font-weight:900;
      word-break:break-all;
      letter-spacing:.02em;
    }
    .items{
      display:grid;
      gap:.7mm;
    }
    .item-row{
      padding-bottom:.55mm;
      border-bottom:1px dotted #8c8c8c;
    }
    .item-row:last-child{
      border-bottom:none;
      padding-bottom:0;
    }
    .item-main{
      font-size:9.5px;
      font-weight:900;
      line-height:1.05;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      color:#000;
      text-shadow:0 0 0 #000;
    }
    .item-meta{
      display:grid;
      grid-template-columns:minmax(0, 1fr) 15mm;
      gap:.6mm;
      align-items:end;
      margin-top:.2mm;
      font-size:8.5px;
    }
    .item-meta span:first-child{
      color:#000;
      font-weight:900;
      font-size:15px;
      line-height:1;
      text-transform:uppercase;
      text-shadow:0 0 0 #000;
    }
    .item-meta span:last-child{
      white-space:nowrap;
      text-align:right;
      font-size:8.5px;
      font-weight:900;
    }
    .totals{
      display:grid;
      gap:.2mm;
    }
    .highlight{
      margin-top:.55mm;
      padding:.6mm 0;
      border-top:2px solid #000;
      border-bottom:2px solid #000;
    }
    .highlight .line{
      margin:0;
      font-size:9px;
      font-weight:900;
      color:#000;
      text-shadow:0 0 0 #000;
    }
    .balance-box{
      margin-top:.55mm;
      border:2px solid #000;
      padding:.7mm .5mm;
      text-align:center;
    }
    .balance-label{
      font-size:7px;
      font-weight:900;
      letter-spacing:.05em;
      text-transform:uppercase;
      margin-bottom:.2mm;
      color:#000;
      text-shadow:0 0 0 #000;
    }
    .balance{
      font-size:13px;
      font-weight:900;
      line-height:1;
      letter-spacing:.02em;
      color:#000;
      text-shadow:0 0 0 #000;
    }
    .footer{
      text-align:center;
      font-size:7px;
    }
    .spaced{
      letter-spacing:.02em;
      text-transform:uppercase;
    }
    @media print{
      @page{size:58mm auto;margin:0}
      body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center">
      <div class="eyebrow">Ticket de venta</div>
      <div class="title">${escapeHtml(ticket?.systemName || "Cashless")}</div>
      <div class="subtitle">${escapeHtml(ticket?.areaName || ticket?.areaId || "-")}</div>
      ${ticketId ? `<div class="spaced" style="font-weight:900">Folio ${escapeHtml(ticketId)}</div>` : ""}
    </div>

    <div class="section meta-grid">
      <div class="line"><span>Fecha / hora</span><span>${escapeHtml(formatDateTime(ticket?.createdAt))}</span></div>
      <div class="line"><span>Terminal</span><span>${escapeHtml(terminalText)}</span></div>
      <div class="line"><span>Cajero</span><span>${escapeHtml(ticket?.operatorName || ticket?.operatorId || "-")}</span></div>
      <div class="line"><span>UID / Ref</span><span class="ref-value">${escapeHtml(ticket?.uid || "-")}</span></div>
    </div>

    <div class="section">
      <div class="eyebrow center" style="margin-bottom:1.5mm">Productos</div>
      <div class="items">${itemsHtml || '<div class="muted center">Sin productos</div>'}</div>
    </div>

    <div class="section totals">
      <div class="line"><span>Subtotal</span><span>${escapeHtml(money(ticket?.subtotal || 0))}</span></div>
      <div class="line"><span>Propina</span><span>${escapeHtml(money(ticket?.tip || 0))}</span></div>
      ${donationLine}
      <div class="highlight">
        <div class="line"><span>Total</span><span>${escapeHtml(money(ticket?.total || 0))}</span></div>
      </div>
    </div>

    <div class="section">
      <div class="balance-box">
        <div class="balance-label">Saldo restante</div>
        <div class="balance">${escapeHtml(balanceText)}</div>
      </div>
    </div>

    <div class="section footer">
      <div style="font-weight:800">Gracias por tu compra</div>
      <div class="muted">Conserva este ticket</div>
    </div>
  </div>
  <script>
    window.addEventListener("load", function(){
      window.print();
    });
  </script>
</body>
</html>`;
}

function printTicket(ticket = state.lastTicket){
  if(!ticket) return false;
  const popup = window.open("", "_blank", "width=420,height=700");
  if(!popup) return false;
  popup.document.open();
  popup.document.write(createPrintableTicketHtml58mm(ticket));
  popup.document.close();
  return true;
}

async function resolveAfterBalance(uid, response){
  const afterFromResponse = parseAmount(response?.newBalance ?? response?.afterBalance ?? response?.balanceAfter);
  if(afterFromResponse !== null){
    return { balance: afterFromResponse, known: true };
  }

  const res = await getCardByUidWithFallback(uid);
  if(res.ok){
    const balance = parseAmount(res.card?.balance ?? res.card?.user?.balance);
    if(balance !== null) return { balance, known: true };
  }

  return { balance: null, known: false };
}

function setCardInfo({ statusText = "-", holder = "-", before = null, after = null } = {}){
  const statusEl = $("cardStatusPill");
  const holderEl = $("cardHolderName");
  const beforeEl = $("cardBalanceBefore");
  const afterEl = $("cardBalanceAfter");
  if(statusEl) statusEl.textContent = statusText || "-";
  if(holderEl) holderEl.textContent = holder || "-";
  if(beforeEl) beforeEl.textContent = (before === null || before === undefined) ? "-" : money(before);
  if(afterEl) afterEl.textContent = (after === null || after === undefined) ? "-" : money(after);
}

async function getCardByUidWithFallback(uid){
  const clean = normalizeUid(uid);
  if(!clean) return { ok: false, status: 400, message: "UID requerido", url: "" };

  const routes = [`/api/cards/${encodeURIComponent(clean)}`, `/cards/${encodeURIComponent(clean)}`];
  for(const path of routes){
    try{
      const data = await apiJson(path, { method: "GET" });
      return { ok: true, card: data, url: `${API_BASE}${path}` };
    }catch(e){
      if(Number(e?.status || 0) === 404) continue;
      return { ok: false, status: Number(e?.status || 0), message: e?.message, url: e?.url || `${API_BASE}${path}` };
    }
  }
  return { ok: false, status: 404, message: "Tarjeta no asignada", url: `${API_BASE}/api/cards/${encodeURIComponent(clean)}` };
}

async function lookupAndRenderCard(uid){
  const clean = normalizeUid(uid);
  if(!clean){
    state.card = null;
    state.beforeBalance = null;
    state.afterBalance = null;
    setCardInfo({ statusText: "-", holder: "-", before: null, after: null });
    setPayEnabled(false);
    return;
  }

  const hdr = apiHeaders();
  console.log("POS_UID_LOOKUP", {
    url: `${API_BASE}/api/cards/${encodeURIComponent(clean)}`,
    hasTenant: !!hdr["X-Tenant-Id"],
    hasFestival: !!hdr["X-Festival-Id"],
    hasAuth: !!hdr["Authorization"],
    hasOpToken: !!hdr["X-Operator-Token"],
    terminalId: getTerminalId(),
    uidShort: uidShort(clean)
  });

  const res = await getCardByUidWithFallback(clean);
  if(!res.ok){
    state.card = null;
    state.beforeBalance = null;
    state.afterBalance = null;
    setCardInfo({ statusText: res.status === 404 ? "Tarjeta no asignada" : "Error", holder: "-", before: null, after: null });
    setPayEnabled(false);
    setPayMsg(errLabel(res), "err");
    return;
  }

  const card = res.card || {};
  const holder = card.userName || card.name || card.user?.name || "-";
  const balance = Number(card.balance ?? card.user?.balance ?? 0);
  state.card = card;
  state.beforeBalance = balance;
  state.afterBalance = null;
  setCardInfo({ statusText: "Tarjeta asignada", holder, before: balance, after: null });
  setPayEnabled(true);
}

async function loadAreas(){
  const list = await apiJson("/api/areas");
  state.areas = Array.isArray(list) ? list.map(a => ({
    id: a.id ?? a.Id,
    name: a.name ?? a.Name ?? `Area ${a.id ?? a.Id}`
  })) : [];
  renderAreas();
}

async function loadProductsForArea(areaId){
  state.menuId = null;
  state.products = [];

  // Intento 1: /api/menus?areaId= (si no existe, ajustar aqui)
  let menu = null;
  try{
    const res = await apiFetch(`/api/menus?areaId=${encodeURIComponent(areaId)}`, { method:"GET" });
    if(res.ok){
      const data = await res.json();
      if(Array.isArray(data)) menu = data[0];
      else menu = data;
    }
  }catch{
    // Ignorar y hacer fallback
  }

  if(menu && (menu.id ?? menu.Id)){
    const menuId = menu.id ?? menu.Id;
    try{
      const res = await apiFetch(`/api/menus/${menuId}/items`, { method:"GET" });
      if(res.ok){
        const items = await res.json();
        state.menuId = menuId;
        state.products = Array.isArray(items) ? items.map(normalizeProduct) : [];
        renderProducts();
        return;
      }
    }catch{
      // Ignorar y hacer fallback
    }
  }

  // Fallback: /api/areas/{areaId}/products
  const list = await apiJson(`/api/areas/${areaId}/products`);
  state.products = Array.isArray(list) ? list.map(item => ({
    id: item.productId ?? item.ProductId ?? item.id,
    name: item.productName ?? item.ProductName ?? item.name ?? "Producto",
    price: Number(item.effectivePrice ?? item.Price ?? item.price ?? 0),
    category: item.category ?? item.Category ?? ""
  })) : [];
  renderProducts();
}

async function useLastUid(){
  try{
    const tid = state.terminalId || getTerminalId();
    const uid = await apiGetLastUid(tid);
    $("uidInput").value = normalizeUid(uid || "");
    await lookupAndRenderCard(uid);
  }catch(e){
    setPayMsg("No se pudo obtener ultimo UID.", "err");
  }
}

async function pay(){
  const uid = normalizeUid(String($("uidInput").value || "").trim());
  if(!uid) return setPayMsg("UID requerido.", "err");
  if(state.beforeBalance === null){
    setPayMsg("Tarjeta no asignada o sin saldo disponible.", "err");
    setPayEnabled(false);
    return;
  }

  const items = Array.from(state.cart.values()).map(it => ({
    productId: it.id,
    qty: it.qty
  }));
  if(items.length === 0) return setPayMsg("Agrega productos al carrito.", "err");

  const totals = getTotals();
  const operatorId = Number(session?.operatorId || 0);
  if(!Number.isFinite(operatorId) || operatorId <= 0){
    setPayMsg("ERROR 400: operatorId invalido en sesion.", "err");
    return;
  }
  const terminalId = getTerminalId();
  const payload = {
    uid,
    areaId: Number(state.areaId),
    operatorId,
    tipAmount: totals.tip,
    donationPercent: 0,
    donationProjectId: null,
    items,
    terminalId
  };
  const chargePath = `/api/charge-v2?terminalId=${encodeURIComponent(terminalId)}`;
  const chargeUrl = `${API_BASE}${chargePath}`;
  const beforeBalanceSnapshot = state.beforeBalance;
  const cartSnapshot = Array.from(state.cart.values()).map(it => ({ ...it }));

  setPayMsg("Procesando cobro...", "");

  const reqHdr = apiHeaders();
  console.log("POS_CHARGE_REQUEST", {
    url: chargeUrl,
    hasTenant: !!reqHdr["X-Tenant-Id"],
    hasFestival: !!reqHdr["X-Festival-Id"],
    hasAuth: !!reqHdr["Authorization"],
    hasOpToken: !!reqHdr["X-Operator-Token"],
    terminalId,
    uidShort: uidShort(uid),
    areaId: payload.areaId,
    operatorId: payload.operatorId,
    itemsCount: payload.items.length,
    total: totals.total,
    payload
  });

  const res = await apiFetch(chargePath, {
    method:"POST",
    body: JSON.stringify(payload)
  });
  const rawText = await res.text().catch(() => "");
  let data = null;
  if(rawText){
    try{ data = JSON.parse(rawText); }catch{ data = null; }
  }

  if(res.status === 401){
    clearSession();
    window.location.href = "/login.html";
    return;
  }

  if(res.status !== 200){
    const msg = (data && (data.message || data.error)) || rawText || res.statusText || "Bad Request";
    console.error("POS_CHARGE_ERROR", {
      url: chargeUrl,
      status: res.status,
      terminalId,
      uidShort: uidShort(uid),
      payload,
      response: data || rawText || null
    });
    setPayMsg(`ERROR ${res.status}: ${msg} (URL: ${chargeUrl})`, "err");
    return;
  }

  const hdr = apiHeaders();
  console.log("POS_CHARGE", {
    url: chargeUrl,
    hasTenant: !!hdr["X-Tenant-Id"],
    hasFestival: !!hdr["X-Festival-Id"],
    hasAuth: !!hdr["Authorization"],
    hasOpToken: !!hdr["X-Operator-Token"],
    terminalId,
    uidShort: uidShort(uid),
    total: totals.total,
    response: data
  });

  const balanceResult = await resolveAfterBalance(uid, data);
  state.afterBalance = balanceResult.balance;
  setCardInfo({
    statusText: "Cobro realizado",
    holder: $("cardHolderName")?.textContent || "-",
    before: beforeBalanceSnapshot,
    after: balanceResult.known ? state.afterBalance : null
  });

  state.lastTicket = createTicketData({
    response: data,
    payload,
    totals,
    uid,
    items: cartSnapshot,
    beforeBalance: beforeBalanceSnapshot,
    afterBalance: state.afterBalance,
    balanceKnown: balanceResult.known
  });
  renderTicketSummary(state.lastTicket);

  if(balanceResult.known){
    setPayMsg("Cobro exitoso. Ticket listo para imprimir", "ok");
  }else{
    setPayMsg("Venta OK, pero no se pudo obtener saldo final para el ticket", "err");
  }

  if(isAutoPrintEnabled()){
    printTicket(state.lastTicket);
  }

  if(typeof syncInventoryFromSale === "function"){
    syncInventoryFromSale(payload.areaId, payload.items);
  }
  state.cart.clear();
  renderCart();
  $("uidInput").value = "";
}
function clearAll(){
  state.cart.clear();
  renderCart();
  $("uidInput").value = "";
  $("tipManual").value = "";
  $("tipPercent").value = "0";
  renderTotals();
  setPayMsg("", "");
}

function startUidAutoRefresh(){
  if(state.lastUidTimer) return;
  state.lastUidTimer = setInterval(()=>{
    if(document.hidden) return;
    useLastUid().catch(()=>{});
  }, 2000);
}
function stopUidAutoRefresh(){
  if(state.lastUidTimer){
    clearInterval(state.lastUidTimer);
    state.lastUidTimer = null;
  }
}

async function init(){
  setSessionInfo();
  initTerminalSelect();
  setPayEnabled(false);
  setCardInfo({ statusText: "-", holder: "-", before: null, after: null });

  $("btnLogout").addEventListener("click", ()=>{
    clearSession();
    window.location.href = "/login.html";
  });

  $("terminalSave")?.addEventListener("click", ()=>{
    setTerminalId($("terminalSelect")?.value || "");
  });

  $("q").addEventListener("input", renderProducts);
  $("tipPercent").addEventListener("change", renderTotals);
  $("tipManual").addEventListener("input", renderTotals);
  $("autoPrintTicket").checked = isAutoPrintEnabled();
  $("autoPrintTicket").addEventListener("change", (e) => {
    setAutoPrintEnabled(!!e.target.checked);
  });

  $("btnLastUid").addEventListener("click", ()=> useLastUid());
  $("btnPay").addEventListener("click", ()=> pay());
  $("btnClear").addEventListener("click", clearAll);
  $("btnPrintTicket").addEventListener("click", ()=> {
    if(printTicket()){
      setPayMsg("Ticket listo para imprimir", "ok");
    }
  });

  $("uidInput").addEventListener("input", ()=> {
    const uid = String($("uidInput").value || "").trim();
    if(!uid){
      state.beforeBalance = null;
      state.afterBalance = null;
      setCardInfo({ statusText: "-", holder: "-", before: null, after: null });
      setPayEnabled(false);
      return;
    }
    lookupAndRenderCard(uid);
  });

  await loadAreas();
  if(state.areaId){
    await loadProductsForArea(state.areaId);
  }

  $("areaSelect").addEventListener("change", async (e)=>{
    const id = Number(e.target.value);
    state.areaId = id;
    state.cart.clear();
    renderCart();
    await loadProductsForArea(id);
  });

  startUidAutoRefresh();
  renderTicketSummary(null);
  document.addEventListener("visibilitychange", ()=>{
    if(document.hidden) stopUidAutoRefresh();
    else startUidAutoRefresh();
  });
}

init().catch(e=>{
  console.error("pos init error:", e);
  setPayMsg("Error inicializando POS.", "err");
});
