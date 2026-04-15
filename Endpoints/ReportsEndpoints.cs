namespace Cashless.Api.Endpoints;

using Cashless.Api.Data;
using Cashless.Api.Services.Auth;
using Cashless.Api.Services.Infra;
using Cashless.Api.Services.Reportes;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

public static class ReportsEndpoints
{
    public static WebApplication MapReportsEndpoints(this WebApplication app)
    {
        static bool IsAdmin(Cashless.Api.Models.Operator op)
            => op.Role == Cashless.Api.Models.OperatorRole.Admin || op.Role == Cashless.Api.Models.OperatorRole.SuperAdmin;

        static bool IsBoss(Cashless.Api.Models.Operator op)
        {
            if (op.Role == Cashless.Api.Models.OperatorRole.JefeOperativo
                || op.Role == Cashless.Api.Models.OperatorRole.JefeDeBarra)
                return true;

            var roleName = op.Role.ToString();
            return roleName.StartsWith("Jefe", StringComparison.OrdinalIgnoreCase);
        }

        static bool CanViewReports(Cashless.Api.Models.Operator op)
            => IsAdmin(op) || IsBoss(op);

        static int? ResolveAreaFilter(Cashless.Api.Models.Operator op, int? requestedAreaId)
            => (IsAdmin(op) || IsBoss(op))
                ? requestedAreaId
                : (op.AreaId > 0 ? op.AreaId : requestedAreaId);

        static IQueryable<Cashless.Api.Models.Transaction> TxForTenant(CashlessContext db, int tenantId)
            => db.Transactions.Where(t => t.TenantId == tenantId || t.TenantId == 0);

        static IQueryable<Cashless.Api.Models.Area> AreasForTenant(CashlessContext db, int tenantId)
            => db.Areas.Where(a => a.TenantId == tenantId || a.TenantId == 0);

        static IQueryable<Cashless.Api.Models.Operator> OperatorsForTenant(CashlessContext db, int tenantId)
            => db.Operators.Where(o => o.TenantId == tenantId || o.TenantId == 0);

        static async Task<(Cashless.Api.Models.Operator? op, IResult? fail)> RequireReportsAccess(CashlessContext db, HttpContext http, IAuthService auth)
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return (null, Results.Unauthorized());
            if (!CanViewReports(op))
                return (op, Results.Json(new { message = "Forbidden. Rol sin acceso a reportes." }, statusCode: 403));
            return (op, null);
        }

        static async Task<(Cashless.Api.Models.Operator? op, IResult? fail)> RequireCashierOrAdmin(CashlessContext db, HttpContext http, IAuthService auth)
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return (null, Results.Unauthorized());
            var isAdmin = IsAdmin(op);
            var isBoss = IsBoss(op);
            var isCashier = op.Role == Cashless.Api.Models.OperatorRole.Cajero;
            if (!isAdmin && !isCashier && !isBoss)
                return (op, Results.Json(new { message = "Forbidden." }, statusCode: 403));
            return (op, null);
        }

        app.MapGet("/api/reports/areas", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var canSeeAllAreas = IsAdmin(op) || IsBoss(op);

            var q = AreasForTenant(db, tenantId);
            if (!canSeeAllAreas)
            {
                if (op.AreaId > 0) q = q.Where(a => a.Id == op.AreaId);
                else q = q.Where(a => false);
            }

            var areas = await q
                .OrderBy(a => a.Name)
                .Select(a => new { a.Id, a.Name, Type = a.Type.ToString(), a.IsActive, a.CustomType })
                .ToListAsync();

            return Results.Ok(areas);
        });

        // =======================
        // PROTEGIDO: REPORTES (server-side)
        // - summary: total vendido, propina, donacion, usuarios, transacciones
        // =======================

        app.MapGet("/api/reports/summary", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth, IReportService reports, string? from, string? to, int? areaId) =>
        {
            var (op, fail) = await RequireReportsAccess(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var effectiveAreaId = ResolveAreaFilter(op, areaId);

            var range = GetMexicoRange(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);
            var result = await reports.GetReportsSummaryAsync(db, tenantId, range.From, range.To, effectiveAreaId);
            return Results.Ok(result);
        });


        app.MapGet("/api/reports/sales-by-area", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth, IReportService reports, string? from, string? to) =>
        {
            var (op, fail) = await RequireReportsAccess(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;

            var range = GetMexicoRange(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);
            var rows = await reports.GetSalesByAreaAsync(db, tenantId, range.From, range.To);
            return Results.Ok(rows);
        });

        app.MapGet("/api/reports/by-operator", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth, IReportService reports, string? from, string? to, int? areaId) =>
        {
            var (op, fail) = await RequireReportsAccess(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var effectiveAreaId = ResolveAreaFilter(op, areaId);

            var range = GetMexicoRange(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);
            var rows = await reports.GetReportsByOperatorAsync(db, tenantId, range.From, range.To, effectiveAreaId);
            return Results.Ok(rows);
        });

        app.MapGet("/api/reports/by-cashier", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth, IReportService reports, string? from, string? to, int? areaId, int? operatorId) =>
        {
            var (op, fail) = await RequireReportsAccess(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var effectiveAreaId = ResolveAreaFilter(op, areaId);

            var range = GetMexicoRange(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);

            var rows = await reports.GetReportsByOperatorAsync(db, tenantId, range.From, range.To, effectiveAreaId);
            if (operatorId.HasValue)
            {
                rows = rows.Where(r => r.OperatorId == operatorId.Value).ToList();
            }

            return Results.Ok(rows);
        });

        

                app.MapGet("/api/reports/by-product", async Task<IResult> (
            CashlessContext db,
            HttpContext http,
            IAuthService auth,
            string? from,
            string? to) =>
        {
            var (op, fail) = await RequireReportsAccess(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;

            var range = GetMexicoRange(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);

            static int ReadInt(JsonElement el, params string[] names)
            {
                foreach (var n in names)
                {
                    if (el.TryGetProperty(n, out var v))
                    {
                        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i)) return i;
                        if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var s)) return s;
                    }
                }
                return 0;
            }

            static decimal ReadDecimal(JsonElement el, params string[] names)
            {
                foreach (var n in names)
                {
                    if (el.TryGetProperty(n, out var v))
                    {
                        if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d)) return d;
                        if (v.ValueKind == JsonValueKind.String && decimal.TryParse(v.GetString(), out var s)) return s;
                    }
                }
                return 0m;
            }

            static string ReadName(JsonElement el, params string[] names)
            {
                foreach (var n in names)
                {
                    if (el.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String)
                    {
                        var s = (v.GetString() ?? "").Trim();
                        if (!string.IsNullOrWhiteSpace(s)) return s;
                    }
                }
                return string.Empty;
            }

            var saleItemsRaw = await db.SaleItems
                .Where(si => (si.TenantId == tenantId || si.TenantId == 0)
                    && (si.Sale.TenantId == tenantId || si.Sale.TenantId == 0)
                    && si.Sale.CreatedAt >= range.From
                    && si.Sale.CreatedAt < range.To)
                .Select(si => new
                {
                    si.ProductId,
                    si.NameSnapshot,
                    productName = si.Product != null ? si.Product.Name : null,
                    si.Qty,
                    si.LineTotal
                })
                .ToListAsync();

            var acc = new Dictionary<string, (int productId, string productName, int qty, decimal total)>(StringComparer.OrdinalIgnoreCase);

            void AddProductRow(int productIdVal, string name, int qty, decimal amount)
            {
                if (qty <= 0 || amount < 0m) return;
                var cleanName = (name ?? string.Empty).Trim();
                if (string.IsNullOrWhiteSpace(cleanName))
                    cleanName = productIdVal > 0 ? $"Producto {productIdVal}" : "Producto";

                var key = $"{productIdVal}|{cleanName}";
                if (acc.TryGetValue(key, out var cur))
                {
                    cur.qty += qty;
                    cur.total += amount;
                    acc[key] = cur;
                }
                else
                {
                    acc[key] = (productIdVal, cleanName, qty, amount);
                }
            }

            if (saleItemsRaw.Count > 0)
            {
                foreach (var si in saleItemsRaw)
                {
                    var name = !string.IsNullOrWhiteSpace(si.NameSnapshot)
                        ? si.NameSnapshot
                        : (si.productName ?? string.Empty);
                    AddProductRow(si.ProductId, name, si.Qty, si.LineTotal);
                }
            }
            else
            {
                var txRows = await TxForTenant(db, tenantId)
                    .Where(t => t.Type == Cashless.Api.Models.TransactionType.Charge
                        && t.CreatedAt >= range.From
                        && t.CreatedAt < range.To
                        && t.Note != null)
                    .Select(t => new { t.Id, t.Note })
                    .ToListAsync();

                foreach (var tx in txRows)
                {
                    if (string.IsNullOrWhiteSpace(tx.Note)) continue;
                    try
                    {
                        using var doc = JsonDocument.Parse(tx.Note);
                        string kind = "";
                        if (doc.RootElement.TryGetProperty("kind", out var kindEl))
                            kind = (kindEl.GetString() ?? "").Trim();

                        if (!kind.Equals("SALE_SUBTOTAL", StringComparison.OrdinalIgnoreCase))
                            continue;

                        if (!doc.RootElement.TryGetProperty("items", out var itemsEl) || itemsEl.ValueKind != JsonValueKind.Array)
                        {
                            if (doc.RootElement.TryGetProperty("Items", out var itemsEl2) && itemsEl2.ValueKind == JsonValueKind.Array)
                                itemsEl = itemsEl2;
                            else
                                continue;
                        }

                        foreach (var it in itemsEl.EnumerateArray())
                        {
                            var name = ReadName(it, "name", "productName", "producto", "nombre", "title", "label");
                            if (string.IsNullOrWhiteSpace(name)) continue;
                            var productIdVal = ReadInt(it, "productId", "id", "productID");
                            var qty = ReadInt(it, "qty", "quantity", "cantidad", "units");
                            if (qty <= 0) continue;
                            var amount = ReadDecimal(it, "lineTotal", "total", "amount", "importe", "line_total");
                            if (amount <= 0m)
                            {
                                var unit = ReadDecimal(it, "unitPrice", "price", "precio");
                                if (unit > 0m) amount = unit * qty;
                            }
                            AddProductRow(productIdVal, name, qty, amount);
                        }
                    }
                    catch
                    {
                    }
                }
            }

            var rows = acc.Values
                .Select(x => new
                {
                    productId = x.productId,
                    productName = x.productName,
                    qtyTotal = x.qty,
                    totalSold = x.total,
                    avgTicket = x.qty > 0 ? (x.total / x.qty) : 0m
                })
                .OrderByDescending(x => x.totalSold)
                .ThenByDescending(x => x.qtyTotal)
                .ToList();

            return Results.Ok(rows);
        });
app.MapGet("/api/reports/recharges-summary", async Task<IResult> (
            CashlessContext db,
            HttpContext http,
            IAuthService auth,
            string? from,
            string? to,
            int? areaId,
            int? operatorId,
            int take = 200) =>
        {
            var (op, fail) = await RequireReportsAccess(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var effectiveAreaId = ResolveAreaFilter(op, areaId);

            var range = GetMexicoRangeExclusive(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);

            var baseQuery = TxForTenant(db, tenantId)
                .Where(t => t.Type == Cashless.Api.Models.TransactionType.TopUp
                    && t.CreatedAt >= range.From
                    && t.CreatedAt < range.To);

            if (effectiveAreaId.HasValue)
                baseQuery = baseQuery.Where(t => t.AreaId == effectiveAreaId.Value);
            if (operatorId.HasValue)
                baseQuery = baseQuery.Where(t => t.OperatorId == operatorId.Value);

            var totalRecharged = await baseQuery.SumAsync(t => (decimal?)t.Amount) ?? 0m;
            var rechargesCount = await baseQuery.CountAsync();
            var avgTicket = rechargesCount > 0 ? (totalRecharged / rechargesCount) : 0m;
            var uniqueCards = await baseQuery
                .Select(t => t.CardUid)
                .Where(u => u != null && u != "")
                .Distinct()
                .CountAsync();
            var uniqueCashiers = await baseQuery
                .Select(t => t.OperatorId)
                .Where(x => x.HasValue)
                .Distinct()
                .CountAsync();

            var topCashiersRaw = await baseQuery
                .Where(t => t.OperatorId.HasValue)
                .GroupBy(t => t.OperatorId)
                .Select(g => new
                {
                    operatorId = g.Key!.Value,
                    count = g.Count(),
                    total = g.Sum(x => (decimal?)x.Amount) ?? 0m
                })
                .OrderByDescending(x => x.total)
                .Take(5)
                .ToListAsync();

            var operatorIds = topCashiersRaw.Select(x => x.operatorId).Distinct().ToList();
            var opMap = await db.Operators
                .Where(o => o.TenantId == tenantId && operatorIds.Contains(o.Id))
                .ToDictionaryAsync(o => o.Id, o => o.Name);

            var topCashiers = topCashiersRaw.Select(x => new
            {
                x.operatorId,
                name = opMap.TryGetValue(x.operatorId, out var n) ? n : null,
                x.count,
                x.total
            }).ToList();

            take = Math.Clamp(take, 1, 500);
            var rowsRaw = await baseQuery
                .OrderByDescending(t => t.CreatedAt)
                .Take(take)
                .Select(t => new
                {
                    t.Id,
                    t.CreatedAt,
                    t.OperatorId,
                    t.CardUid,
                    t.Amount,
                    t.Note,
                    t.ShiftId
                })
                .ToListAsync();

            var rowOperatorIds = rowsRaw.Where(x => x.OperatorId.HasValue).Select(x => x.OperatorId!.Value).Distinct().ToList();
            var rowOpMap = await db.Operators
                .Where(o => o.TenantId == tenantId && rowOperatorIds.Contains(o.Id))
                .ToDictionaryAsync(o => o.Id, o => o.Name);

            var rows = rowsRaw.Select(r =>
            {
                string? paymentMethod = null;
                string? terminalId = null;
                int? shiftId = r.ShiftId;

                if (!string.IsNullOrWhiteSpace(r.Note))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(r.Note);
                        if (doc.RootElement.TryGetProperty("paymentMethod", out var pm))
                            paymentMethod = NormalizePaymentMethod(pm.GetString());
                        if (doc.RootElement.TryGetProperty("terminalId", out var tid))
                            terminalId = tid.GetString();
                        if (doc.RootElement.TryGetProperty("shiftId", out var sid) && sid.TryGetInt32(out var sidVal))
                            shiftId = sidVal;
                    }
                    catch
                    {
                    }
                }

                return new
                {
                    createdAt = r.CreatedAt,
                    operatorId = r.OperatorId,
                    operatorName = r.OperatorId.HasValue && rowOpMap.TryGetValue(r.OperatorId.Value, out var on) ? on : null,
                    terminalId,
                    uid = r.CardUid,
                    amount = r.Amount,
                    paymentMethod,
                    shiftId,
                    txId = r.Id
                };
            }).ToList();

            return Results.Ok(new
            {
                summary = new
                {
                    totalRecharged,
                    rechargesCount,
                    avgTicket,
                    uniqueCards,
                    uniqueCashiers
                },
                topCashiers,
                rows
            });
        });

        app.MapGet("/api/reports/recharges-rows", async Task<IResult> (
            CashlessContext db,
            HttpContext http,
            IAuthService auth,
            string? from,
            string? to,
            int? areaId,
            int? operatorId,
            int take = 500) =>
        {
            var (op, fail) = await RequireReportsAccess(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();
            if (!IsAdmin(op))
                return Results.Json(new { message = "Forbidden. Requiere rol Admin/SuperAdmin." }, statusCode: 403);

            var tenantId = op.TenantId;
            var effectiveAreaId = ResolveAreaFilter(op, areaId);
            var range = GetMexicoRangeExclusive(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);

            var baseQuery = TxForTenant(db, tenantId)
                .Where(t => t.Type == Cashless.Api.Models.TransactionType.TopUp
                    && t.CreatedAt >= range.From
                    && t.CreatedAt < range.To);

            if (effectiveAreaId.HasValue)
                baseQuery = baseQuery.Where(t => t.AreaId == effectiveAreaId.Value);
            if (operatorId.HasValue)
                baseQuery = baseQuery.Where(t => t.OperatorId == operatorId.Value);

            take = Math.Clamp(take, 1, 1000);
            var rowsRaw = await baseQuery
                .OrderByDescending(t => t.CreatedAt)
                .Take(take)
                .Select(t => new
                {
                    t.Id,
                    t.CreatedAt,
                    t.OperatorId,
                    t.CardUid,
                    t.Amount,
                    t.Note,
                    t.ShiftId
                })
                .ToListAsync();

            var opIds = rowsRaw.Where(x => x.OperatorId.HasValue).Select(x => x.OperatorId!.Value).Distinct().ToList();
            var opMap = await OperatorsForTenant(db, tenantId)
                .Where(o => opIds.Contains(o.Id))
                .ToDictionaryAsync(o => o.Id, o => o.Name);

            var rows = rowsRaw.Select(r =>
            {
                string? paymentMethod = null;
                string? terminalId = null;
                int? shiftId = r.ShiftId;

                if (!string.IsNullOrWhiteSpace(r.Note))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(r.Note);
                        if (doc.RootElement.TryGetProperty("paymentMethod", out var pm))
                            paymentMethod = NormalizePaymentMethod(pm.GetString());
                        if (doc.RootElement.TryGetProperty("terminalId", out var tid))
                            terminalId = tid.GetString();
                        if (doc.RootElement.TryGetProperty("shiftId", out var sid) && sid.TryGetInt32(out var sidVal))
                            shiftId = sidVal;
                    }
                    catch
                    {
                    }
                }

                return new
                {
                    createdAt = r.CreatedAt,
                    operatorId = r.OperatorId,
                    operatorName = r.OperatorId.HasValue && opMap.TryGetValue(r.OperatorId.Value, out var on) ? on : null,
                    terminalId,
                    uid = r.CardUid,
                    amount = r.Amount,
                    paymentMethod,
                    shiftId,
                    txId = r.Id
                };
            }).ToList();

            return Results.Ok(new { rows });
        });


        async Task<IResult> GetCashierSummaryAsync(
            CashlessContext db,
            HttpContext http,
            IAuthService auth,
            string? from,
            string? to,
            int? cashierId,
            string? scope)
        {
            var (op, fail) = await RequireCashierOrAdmin(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();

            var tenantId = op.TenantId;
            var isAdmin = IsAdmin(op);
            var isBoss = IsBoss(op);
            var isCashier = op.Role == Cashless.Api.Models.OperatorRole.Cajero;
            int? targetCashierId = isCashier ? op.Id : (cashierId > 0 ? cashierId : null);
            var shiftScope = NormalizeShiftScope(scope, op);

            var range = GetMexicoRange(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);
            var hasFestivalHeader = http.Request.Headers.ContainsKey("X-Festival-Id");
            Console.WriteLine($"[CASHIER_SUMMARY] tenantId={tenantId} opId={op.Id} role={op.Role} scope={shiftScope} from={from ?? "-"} to={to ?? "-"} rangeFrom={range.From:O} rangeToExcl={range.To:O} targetCashierId={(targetCashierId?.ToString() ?? "null")} hasFestivalHeader={hasFestivalHeader}");

            if ((isAdmin || isBoss) && targetCashierId.HasValue)
            {
                var existsCashier = await db.Operators.AnyAsync(x => x.TenantId == tenantId && x.Id == targetCashierId.Value);
                if (!existsCashier) return Results.NotFound(new { message = "Cajero no encontrado." });
            }

            var isBarraScope = shiftScope == "barra";
            var shiftIdsQuery = db.Shifts
                .Where(s => s.TenantId == tenantId
                    && (!targetCashierId.HasValue || s.CashierId == targetCashierId.Value));
            shiftIdsQuery = isBarraScope
                ? shiftIdsQuery.Where(s => s.BoxId.HasValue && s.BoxId.Value > 0)
                : shiftIdsQuery.Where(s => !s.BoxId.HasValue || s.BoxId.Value <= 0);
            var scopedShiftIds = await shiftIdsQuery
                .Select(s => s.Id)
                .ToListAsync();

            var topups = await TxForTenant(db, tenantId)
                .Where(t =>
                    t.Type == Cashless.Api.Models.TransactionType.TopUp
                    && (!targetCashierId.HasValue || t.OperatorId == targetCashierId.Value)
                    && (
                        (shiftScope == "caja" && !t.ShiftId.HasValue)
                        || (t.ShiftId.HasValue && scopedShiftIds.Contains(t.ShiftId.Value))
                    )
                    && t.CreatedAt >= range.From
                    && t.CreatedAt < range.To)
                .Select(t => new { t.Id, t.Amount, t.Note, t.ShiftId, t.OperatorId, t.CreatedAt })
                .ToListAsync();
            var topupsLegacyNoShift = topups.Count(x => !x.ShiftId.HasValue);

            var breakdown = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
            {
                ["EFECTIVO"] = 0m,
                ["TARJETA"] = 0m,
                ["CRIPTO"] = 0m,
                ["TRANSFERENCIA"] = 0m,
                ["OTRO"] = 0m
            };

            foreach (var tx in topups)
            {
                var method = "EFECTIVO";
                if (!string.IsNullOrWhiteSpace(tx.Note))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(tx.Note);
                        if (doc.RootElement.TryGetProperty("paymentMethod", out var pm))
                            method = NormalizePaymentMethod(pm.GetString());
                    }
                    catch
                    {
                    }
                }

                if (!breakdown.ContainsKey(method)) method = "OTRO";
                breakdown[method] += tx.Amount;
            }

            // Fuente de verdad para recargas de caja: Transactions(Type=TopUp).
            // Recharges puede coexistir por flujos legacy; sumarlo aquÃ­ duplica conteos/montos.
            Console.WriteLine($"[CASHIER_SUMMARY] topups={topups.Count} topupsLegacyNoShift={topupsLegacyNoShift} rechargesIgnoredForTotals=true");
            var totalRecargas = topups.Count;
            var totalRecargado = topups.Sum(x => x.Amount);

            object? currentShiftSummary = null;
            if (targetCashierId.HasValue)
            {
                var currentShiftQuery = db.Shifts
                    .Where(s => (s.TenantId == tenantId || s.TenantId == 0)
                        && s.CashierId == targetCashierId.Value
                        && s.Status == "Open"
                        && s.ClosedAt == null);
                currentShiftQuery = isBarraScope
                    ? currentShiftQuery.Where(s => s.BoxId.HasValue && s.BoxId.Value > 0)
                    : currentShiftQuery.Where(s => !s.BoxId.HasValue || s.BoxId.Value <= 0);
                var currentShift = await currentShiftQuery
                    .OrderByDescending(s => s.Id)
                    .Select(s => new { s.Id, s.OpenedAt, s.BoxId })
                    .FirstOrDefaultAsync();

                if (currentShift is not null)
                {
                    var shiftTopups = topups.Where(x =>
                        x.ShiftId == currentShift.Id
                        || (!x.ShiftId.HasValue
                            && x.OperatorId == targetCashierId.Value
                            && x.CreatedAt >= currentShift.OpenedAt
                            && x.CreatedAt <= DateTimeProvider.NowMexico()))
                        .ToList();
                    currentShiftSummary = new
                    {
                        shiftId = currentShift.Id,
                        currentShift.OpenedAt,
                        currentShift.BoxId,
                        totalRecargas = shiftTopups.Count,
                        totalRecargado = shiftTopups.Sum(x => x.Amount)
                    };
                }
            }

            return Results.Ok(new
            {
                from = range.From,
                to = range.To,
                shiftScope,
                cashierId = targetCashierId,
                scope = targetCashierId.HasValue ? "cashier" : "tenant_topups",
                totalRecargas,
                totalRecargado,
                breakdown = new
                {
                    efectivo = breakdown["EFECTIVO"],
                    tarjeta = breakdown["TARJETA"],
                    cripto = breakdown["CRIPTO"],
                    transferencia = breakdown["TRANSFERENCIA"],
                    otro = breakdown["OTRO"]
                },
                currentShift = currentShiftSummary
            });
        }

        app.MapGet("/api/reports/cashier/summary", GetCashierSummaryAsync);

        app.MapGet("/api/reports/recent", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth, IReportService reports, string? from, string? to, int? areaId, int take = 50) =>
        {
            var (op, fail) = await RequireReportsAccess(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var effectiveAreaId = ResolveAreaFilter(op, areaId);

            var range = GetMexicoRange(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);
            var limit = Math.Clamp(take, 1, 200);
            var rows = await reports.GetReportsRecentAsync(db, tenantId, range.From, range.To, effectiveAreaId, limit);
            return Results.Ok(rows);
        });

        app.MapGet("/api/sales", async Task<IResult> (
            CashlessContext db,
            HttpContext http,
            IAuthService auth,
            string? from,
            string? to,
            int? areaId,
            int? operatorId,
            string? q,
            int take = 100,
            int skip = 0,
            string? export = null) =>
        {
            var (op, fail) = await RequireReportsAccess(db, http, auth);
            if (fail is not null) return fail;
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var effectiveAreaId = ResolveAreaFilter(op, areaId);

            var range = GetMexicoRange(from, to);
            var fest = await TryGetFestivalRangeAsync(db, tenantId, http.Request);
            if (fest is not null) range = ClampRange(range, fest.Value);

            var exportAll = string.Equals(export, "1", StringComparison.OrdinalIgnoreCase)
                || string.Equals(export, "true", StringComparison.OrdinalIgnoreCase)
                || string.Equals(export, "yes", StringComparison.OrdinalIgnoreCase);

            take = Math.Clamp(take, 1, 200);
            skip = Math.Max(skip, 0);
            var queryText = (q ?? string.Empty).Trim().ToLowerInvariant();

            var txQuery = TxForTenant(db, tenantId)
                .Where(t => t.Type == Cashless.Api.Models.TransactionType.Charge
                    && t.CreatedAt >= range.From
                    && t.CreatedAt < range.To);

            if (effectiveAreaId.HasValue) txQuery = txQuery.Where(t => t.AreaId == effectiveAreaId.Value);
            if (operatorId.HasValue) txQuery = txQuery.Where(t => t.OperatorId == operatorId.Value);

            var allRowsRaw = await txQuery
                .Select(t => new
                {
                    t.Id,
                    t.CreatedAt,
                    t.Amount,
                    t.TipAmount,
                    t.DonationAmount,
                    t.CardUid,
                    t.Note,
                    t.AreaId,
                    t.OperatorId
                })
                .ToListAsync();

            var areaIds = allRowsRaw.Where(x => x.AreaId.HasValue).Select(x => x.AreaId!.Value).Distinct().ToList();
            var opIds = allRowsRaw.Where(x => x.OperatorId.HasValue).Select(x => x.OperatorId!.Value).Distinct().ToList();

            var areaMap = await AreasForTenant(db, tenantId)
                .Where(a => areaIds.Contains(a.Id))
                .ToDictionaryAsync(a => a.Id, a => a.Name);
            var opMap = await OperatorsForTenant(db, tenantId)
                .Where(o => opIds.Contains(o.Id))
                .ToDictionaryAsync(o => o.Id, o => o.Name);

            var rowsAll = allRowsRaw.Select(x =>
            {
                var kind = "";
                var products = "";
                decimal subtotal = 0m;
                decimal tip = x.TipAmount;
                decimal donation = x.DonationAmount;

                if (!string.IsNullOrWhiteSpace(x.Note))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(x.Note);
                        if (doc.RootElement.TryGetProperty("kind", out var kindProp))
                            kind = kindProp.GetString() ?? "";

                        if (kind.Equals("SALE_SUBTOTAL", StringComparison.OrdinalIgnoreCase))
                        {
                            subtotal = x.Amount;
                            if (doc.RootElement.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
                            {
                                var parts = new List<string>();
                                foreach (var it in itemsEl.EnumerateArray())
                                {
                                    var name = it.TryGetProperty("name", out var n) ? n.GetString() : null;
                                    var qty = it.TryGetProperty("qty", out var qProp) ? qProp.GetInt32() : 0;
                                    if (!string.IsNullOrWhiteSpace(name) && qty > 0) parts.Add($"{qty}x {name}");
                                }
                                products = string.Join(", ", parts);
                            }
                        }
                        else if (kind.Equals("TIP", StringComparison.OrdinalIgnoreCase))
                        {
                            tip = x.Amount;
                        }
                        else if (kind.Equals("DONATION", StringComparison.OrdinalIgnoreCase))
                        {
                            donation = x.Amount;
                        }
                    }
                    catch
                    {
                    }
                }

                var total = subtotal + tip + donation;
                if (total <= 0m) total = x.Amount;

                return new
                {
                    id = x.Id,
                    createdAt = x.CreatedAt,
                    areaId = x.AreaId,
                    areaName = x.AreaId.HasValue && areaMap.TryGetValue(x.AreaId.Value, out var an) ? an : null,
                    operatorId = x.OperatorId,
                    operatorName = x.OperatorId.HasValue && opMap.TryGetValue(x.OperatorId.Value, out var on) ? on : null,
                    uid = x.CardUid,
                    kind,
                    products,
                    subtotal,
                    tip,
                    donation,
                    total
                };
            })
            .Where(r =>
                string.IsNullOrWhiteSpace(queryText)
                || r.id.ToString().Contains(queryText)
                || (r.uid ?? string.Empty).ToLowerInvariant().Contains(queryText)
                || (r.operatorName ?? string.Empty).ToLowerInvariant().Contains(queryText))
            .ToList();

            var totalCount = rowsAll.Count;
            var totals = new
            {
                subtotal = rowsAll.Sum(r => (decimal)(r.subtotal)),
                tips = rowsAll.Sum(r => (decimal)(r.tip)),
                donation = rowsAll.Sum(r => (decimal)(r.donation)),
                total = rowsAll.Sum(r => (decimal)(r.total))
            };

            List<object> items;
            if (exportAll)
            {
                items = rowsAll
                    .OrderByDescending(r => r.id)
                    .Cast<object>()
                    .ToList();
            }
            else
            {
                items = rowsAll
                    .OrderByDescending(r => r.id)
                    .Skip(skip)
                    .Take(take)
                    .Cast<object>()
                    .ToList();
            }

            return Results.Ok(new
            {
                from = range.From,
                to = range.To,
                take,
                skip,
                count = items.Count,
                totalCount,
                totals,
                items
            });
        });

        return app;
    }

    private static (DateTime From, DateTime To) GetMexicoRange(string? from, string? to)
    {
        var today = DateTimeProvider.TodayMexico();
        var defaultFrom = today.AddDays(-6);
        var defaultTo = today.AddDays(1);

        var fromDt = TryParseMexicoDate(from) ?? defaultFrom;
        var toBase = TryParseMexicoDate(to);
        var toDt = toBase.HasValue ? toBase.Value.AddDays(1) : defaultTo;
        if (toDt <= fromDt) toDt = fromDt.AddDays(1);

        return (fromDt, toDt);
    }

    private static DateTime? TryParseMexicoDate(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (!DateTime.TryParse(s, out var dt)) return null;
        return dt.Date;
    }

    private static (DateTime From, DateTime To) GetMexicoRangeExclusive(string? from, string? to)
    {
        var today = DateTimeProvider.TodayMexico();
        var defaultFrom = today.AddDays(-6);
        var defaultTo = today.AddDays(1);

        var fromDt = TryParseMexicoDate(from) ?? defaultFrom;
        var toDt = TryParseMexicoDate(to) ?? defaultTo;
        if (toDt <= fromDt) toDt = fromDt.AddDays(1);

        return (fromDt, toDt);
    }

    private static async Task<(DateTime From, DateTime To)?> TryGetFestivalRangeAsync(
        CashlessContext db,
        int tenantId,
        HttpRequest req)
    {
        if (!req.Headers.TryGetValue("X-Festival-Id", out var raw)) return null;
        if (!int.TryParse(raw.FirstOrDefault(), out var festivalId)) return null;

        var fest = await db.Festivals
            .Where(f => f.TenantId == tenantId && f.Id == festivalId)
            .Select(f => new { f.StartDate, f.EndDate })
            .FirstOrDefaultAsync();

        if (fest is null) return null;

        var from = fest.StartDate.Date;
        var to = fest.EndDate.Date.AddDays(1);
        return (from, to);
    }

    private static (DateTime From, DateTime To) ClampRange(
        (DateTime From, DateTime To) baseRange,
        (DateTime From, DateTime To) festivalRange)
    {
        var from = baseRange.From > festivalRange.From ? baseRange.From : festivalRange.From;
        var to = baseRange.To < festivalRange.To ? baseRange.To : festivalRange.To;
        if (to <= from)
        {
            // Si no hay interseccion, no aplicar clamp para no dejar reportes vacios por festivalId viejo.
            return baseRange;
        }
        return (from, to);
    }

    private static string NormalizePaymentMethod(string? method)
    {
        var m = (method ?? string.Empty).Trim().ToUpperInvariant();
        return m switch
        {
            "CASH" => "EFECTIVO",
            "CARD" => "TARJETA",
            _ => string.IsNullOrWhiteSpace(m) ? "EFECTIVO" : m
        };
    }

    private static string NormalizeShiftScope(string? scope, Cashless.Api.Models.Operator op)
    {
        var raw = (scope ?? string.Empty).Trim().ToLowerInvariant();
        if (raw == "barra" || raw == "bar") return "barra";
        if (raw == "caja" || raw == "cashier" || raw == "cash") return "caja";
        return op.Role == Cashless.Api.Models.OperatorRole.JefeDeBarra ? "barra" : "caja";
    }

}


