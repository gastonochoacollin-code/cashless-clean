(() => {
  const session = requireSession();
  const role = String(session?.role || session?.Role || "").trim().toLowerCase();
  const isCashier = role === "cajero" || role === "cashier";

  function $(id){
    return document.getElementById(id);
  }

  function setStatus(message, isError = false){
    const node = $("status");
    if(!node) return;
    node.textContent = message || "";
    node.style.color = isError ? "#ffd1d1" : "";
    node.style.borderColor = isError ? "rgba(255,90,90,.45)" : "";
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderCashierMenu("cashierMenu", "/dashboard-caja/");

    if(!isCashier){
      $("unauth").style.display = "block";
      return;
    }

    $("main").style.display = "block";
    const festivalId = session?.festivalId ?? (getFestivalId() || "-");
    $("sessionInfo").textContent = `${session?.name || "Cajero"} | ${session?.role || session?.Role || "Cajero"} | tenant ${session?.tenantId ?? "-"} | festival ${festivalId}`;
    setStatus("Listo.");
  });
})();
