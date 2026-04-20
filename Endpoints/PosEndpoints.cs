namespace Cashless.Api.Endpoints;

using Cashless.Api.Data;
using Cashless.Api.Dtos.Barra;
using Cashless.Api.Models;
using Cashless.Api.Services.Auth;
using Cashless.Api.Services.Infra;
using Microsoft.EntityFrameworkCore;

public static class PosEndpoints
{
    public static WebApplication MapPosEndpoints(this WebApplication app)
    {
        IResult SetUid(UidRequest req, IUidState uidState, HttpContext http, string? terminalId)
        {
            var uid = NormalizeUid(req.uid);
            if (string.IsNullOrWhiteSpace(uid))
                return Results.BadRequest(new { message = "UID requerido" });
            var terminal = ResolveRequiredTerminalId(http, terminalId, req.TerminalId);
            if (terminal.Error is not null) return terminal.Error;
            var resolvedTerminalId = terminal.Value!;
            uidState.SetLastUid(uid, resolvedTerminalId);
            Console.WriteLine($"UID leído: {uid} (terminal {resolvedTerminalId})");
            return Results.Ok(new { ok = true, terminalId = resolvedTerminalId });
        }
        app.MapPost("/api/uid", SetUid).AllowAnonymous();
        // LEGACY ALIAS (mantener mientras haya clientes cacheados)
        app.MapPost("/uid", SetUid).AllowAnonymous();

        IResult GetLastUid(IUidState uidState, HttpContext http, string? terminalId)
        {
            var terminal = ResolveRequiredTerminalId(http, terminalId);
            if (terminal.Error is not null) return terminal.Error;
            var resolvedTerminalId = terminal.Value!;
            // Nunca 404 para no spamear consola del dashboard.
            // Si no hay UID, devolvemos uid vacío.
            var ok = uidState.TryTakeLastUid(out var uid, resolvedTerminalId);
            var resultUid = ok ? uid : "";
            Console.WriteLine($"LAST_UID (terminal {resolvedTerminalId}) => {(string.IsNullOrWhiteSpace(resultUid) ? "-" : resultUid)}");
            return Results.Ok(new { uid = resultUid, terminalId = resolvedTerminalId });
        }
        app.MapGet("/api/last-uid", GetLastUid).AllowAnonymous();
        // LEGACY ALIAS (mantener mientras haya clientes cacheados)
        app.MapGet("/last-uid", GetLastUid).AllowAnonymous();

        app.MapGet("/balance/{uid}", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth, string uid) =>
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;

            var clean = (uid ?? "").Trim().ToUpperInvariant();

            var card = await db.Cards
                .Include(c => c.User)
                .FirstOrDefaultAsync(c => c.Uid == clean && c.TenantId == tenantId && c.User.TenantId == tenantId);

            if (card is null) return Results.NotFound(new { message = "Pulsera no asignada" });

            return Results.Ok(new
            {
                userName = card.User.Name,
                balance = card.User.Balance
            });
        });

        async Task<IResult> TopupAsync(CashlessContext db, HttpContext http, IAuthService auth, IUidState uidState, TopupRequest req)
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var terminal = ResolveRequiredTerminalId(http, req.TerminalId);
            if (terminal.Error is not null) return terminal.Error;
            var resolvedTerminalId = terminal.Value!;

            var uid = (req.Uid ?? "").Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(uid)) return Results.BadRequest(new { message = "UID requerido" });
            if (req.Amount <= 0) return Results.BadRequest(new { message = "Monto invÃ¡lido" });

            var card = await db.Cards.Include(c => c.User).FirstOrDefaultAsync(c => c.Uid == uid && c.TenantId == tenantId && c.User.TenantId == tenantId);
            if (card is null) return Results.NotFound(new { message = "Pulsera no asignada" });
            if (!uidState.ConsumePendingIfMatches(uid, resolvedTerminalId))
                return Results.BadRequest(new { message = "Lee la pulsera antes de confirmar la recarga" });

            card.User.Balance += req.Amount;
            var openShift = await db.Shifts
                .OrderByDescending(s => s.Id)
                .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.CashierId == op.Id && s.Status == "Open" && s.ClosedAt == null);
            var topupMeta = System.Text.Json.JsonSerializer.Serialize(new
            {
                kind = "TOPUP",
                cashierId = op.Id,
                terminalId = resolvedTerminalId,
                shiftId = openShift?.Id,
                paymentMethod = "cash"
            });

            db.Transactions.Add(new Transaction
            {
                UserId = card.User.Id,
                CardUid = card.Uid,
                Amount = req.Amount,
                Type = TransactionType.TopUp,
                CreatedAt = DateTimeProvider.NowMexico(),
                TenantId = tenantId,
                OperatorId = op.Id,
                AreaId = op.AreaId,
                ShiftId = openShift?.Id,
                Note = topupMeta
            });

            await db.SaveChangesAsync();
            return Results.Ok(new { newBalance = card.User.Balance, terminalId = resolvedTerminalId });
        }
        app.MapPost("/api/topup", TopupAsync);
        // LEGACY ALIAS (mantener mientras haya clientes cacheados)
        app.MapPost("/topup", TopupAsync);

        async Task<IResult> ChargeAsync(CashlessContext db, HttpContext http, IAuthService auth, IUidState uidState, ChargeRequest req)
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var terminal = ResolveRequiredTerminalId(http, req.TerminalId);
            if (terminal.Error is not null) return terminal.Error;
            var resolvedTerminalId = terminal.Value!;

            var uid = (req.Uid ?? "").Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(uid)) return Results.BadRequest(new { message = "UID requerido" });
            if (req.Amount <= 0) return Results.BadRequest(new { message = "Monto invÃ¡lido" });

            // ?? solo 1 cobro por lectura
            if (!uidState.ConsumePendingIfMatches(uid, resolvedTerminalId))
                return Results.BadRequest(new { message = "Esta pulsera ya fue usada o no fue leÃ­da recientemente" });

            var card = await db.Cards.Include(c => c.User).FirstOrDefaultAsync(c => c.Uid == uid && c.TenantId == tenantId && c.User.TenantId == tenantId);
            if (card is null) return Results.NotFound(new { message = "Pulsera no asignada" });

            if (card.User.Balance < req.Amount)
                return Results.BadRequest(new { message = "Saldo insuficiente" });

            card.User.Balance -= req.Amount;
            card.User.TotalSpent += req.Amount;

            db.Transactions.Add(new Transaction
            {
                UserId = card.User.Id,
                CardUid = uid,
                Amount = req.Amount,
                Type = TransactionType.Charge,
                Note = System.Text.Json.JsonSerializer.Serialize(new
                {
                    kind = "CHARGE",
                    terminalId = resolvedTerminalId,
                    operatorId = op.Id,
                    areaId = op.AreaId
                }),
                CreatedAt = DateTimeProvider.NowMexico(),
                TenantId = tenantId,
                OperatorId = op.Id,
                AreaId = op.AreaId
            });

            await db.SaveChangesAsync();
            return Results.Ok(new { newBalance = card.User.Balance, terminalId = resolvedTerminalId });
        }
        app.MapPost("/api/charge", ChargeAsync);
        // LEGACY ALIAS (mantener mientras haya clientes cacheados)
        app.MapPost("/charge", ChargeAsync);

        // =======================
        // PROTEGIDO: Charge V2 (propina + donaciÃ³n + items) + datos para reportes
        // - No rompe esquema: guarda "items/tip/donation" dentro de Transaction.Note (JSON)
        // - Crea 1 tx de SUBTOTAL + 1 tx de TIP (si aplica) + 1 tx de DONATION (si aplica)
        // =======================

        async Task<IResult> ChargeV2Async(CashlessContext db, HttpContext http, IAuthService auth, IUidState uidState, ChargeRequestV2 req)
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;
            var terminal = ResolveRequiredTerminalId(http, req.TerminalId);
            if (terminal.Error is not null) return terminal.Error;
            var resolvedTerminalId = terminal.Value!;

            var uid = (req.Uid ?? "").Trim().ToUpperInvariant();
            var uidShort = uid.Length >= 6 ? $"{uid[..4]}...{uid[^2..]}" : uid;
            Console.WriteLine("[POS_CHARGE_V2] " + System.Text.Json.JsonSerializer.Serialize(new
            {
                phase = "recv",
                tenantId,
                opId = op.Id,
                role = op.Role,
                terminalId = resolvedTerminalId,
                uidShort,
                areaId = req.AreaId,
                reqOperatorId = req.OperatorId,
                itemsCount = req.Items?.Count ?? 0,
                hasTenant = http.Request.Headers.ContainsKey("X-Tenant-Id"),
                hasAuth = http.Request.Headers.ContainsKey("Authorization"),
                hasOpToken = http.Request.Headers.ContainsKey("X-Operator-Token"),
                hasFestival = http.Request.Headers.ContainsKey("X-Festival-Id")
            }));

            if (string.IsNullOrWhiteSpace(uid)) return Results.BadRequest(new { message = "UID requerido", details = "uid" });
            if (req.AreaId <= 0) return Results.BadRequest(new { message = "AreaId invÃ¡lido", details = "areaId" });
            if (req.OperatorId <= 0) return Results.BadRequest(new { message = "OperatorId invÃ¡lido", details = "operatorId" });
            if (req.Items is null || req.Items.Count == 0) return Results.BadRequest(new { message = "Items requerido", details = "items" });

            if (req.TipAmount < 0) return Results.BadRequest(new { message = "TipAmount invÃ¡lido", details = "tipAmount" });
            if (req.DonationPercent < 0 || req.DonationPercent > 100) return Results.BadRequest(new { message = "DonationPercent invÃ¡lido (0-100)", details = "donationPercent" });

            // ?? solo 1 cobro por lectura
            if (!uidState.ConsumePendingIfMatches(uid, resolvedTerminalId))
            {
                Console.WriteLine("[POS_CHARGE_V2] " + System.Text.Json.JsonSerializer.Serialize(new
                {
                    phase = "reject",
                    reason = "pending_uid_mismatch",
                    tenantId,
                    opId = op.Id,
                    terminalId = resolvedTerminalId,
                    uidShort
                }));
                return Results.BadRequest(new
                {
                    message = "Esta pulsera ya fue usada o no fue leída recientemente",
                    details = "pending_uid_mismatch",
                    terminalId = resolvedTerminalId
                });
            }

            var card = await db.Cards.Include(c => c.User).FirstOrDefaultAsync(c => c.Uid == uid && c.TenantId == tenantId && c.User.TenantId == tenantId);
            if (card is null) return Results.NotFound(new { message = "Pulsera no asignada" });

            // Trae menÃº del Ã¡rea para precio efectivo (override o base)
            var menu = await db.AreaProducts
                .Include(ap => ap.Product)
                .Where(ap => ap.AreaId == req.AreaId && ap.IsActive && ap.Product.IsActive && ap.TenantId == tenantId && ap.Product.TenantId == tenantId)
                .ToListAsync();

            var priceByProductId = menu.ToDictionary(
                ap => ap.ProductId,
                ap => (ap.PriceOverride ?? ap.Product.Price)
            );

            // Calcula subtotal y arma items para auditorÃ­a + reportes
            decimal subtotal = 0m;
            var noteItems = new List<object>();

            foreach (var it in req.Items)
            {
                if (it.Qty <= 0) return Results.BadRequest(new { message = "Qty invÃ¡lido" });

                if (!priceByProductId.TryGetValue(it.ProductId, out var unit))
                    return Results.BadRequest(new { message = $"Producto {it.ProductId} no estÃ¡ activo en el menÃº del Ã¡rea {req.AreaId}" });

                var line = unit * it.Qty;
                subtotal += line;

                var name = menu.First(ap => ap.ProductId == it.ProductId).Product.Name;

                noteItems.Add(new
                {
                    productId = it.ProductId,
                    name,
                    qty = it.Qty,
                    unitPrice = unit,
                    lineTotal = line
                });
            }

            var donationAmount = req.DonationPercent > 0 ? Math.Round(subtotal * (req.DonationPercent / 100m), 2) : 0m;
            var tipAmount = Math.Round(req.TipAmount, 2);

            var grandTotal = subtotal + tipAmount + donationAmount;
            if (grandTotal <= 0) return Results.BadRequest(new { message = "Monto invÃ¡lido" });

            if (card.User.Balance < grandTotal)
                return Results.BadRequest(new { message = "Saldo insuficiente" });

            // Aplica cargo al usuario
            card.User.Balance -= grandTotal;
            card.User.TotalSpent += grandTotal;

            // 1) SUBTOTAL
            var saleMeta = new
            {
                kind = "SALE_SUBTOTAL",
                terminalId = resolvedTerminalId,
                areaId = req.AreaId,
                operatorId = req.OperatorId,
                subtotal,
                items = noteItems
            };
            db.Transactions.Add(new Transaction
            {
                UserId = card.User.Id,
                CardUid = uid,
                Amount = subtotal,
                TipAmount = 0m,
                Type = TransactionType.Charge,
                Note = System.Text.Json.JsonSerializer.Serialize(saleMeta),
                CreatedAt = DateTimeProvider.NowMexico(),
                TenantId = tenantId,
                AreaId = req.AreaId,
                OperatorId = req.OperatorId
            });

            // 2) TIP
            if (tipAmount > 0)
            {
                var tipMeta = new { kind = "TIP", terminalId = resolvedTerminalId, areaId = req.AreaId, operatorId = req.OperatorId, tipAmount };
                db.Transactions.Add(new Transaction
                {
                    UserId = card.User.Id,
                    CardUid = uid,
                    Amount = tipAmount,
                    TipAmount = tipAmount,
                    Type = TransactionType.Charge,
                    Note = System.Text.Json.JsonSerializer.Serialize(tipMeta),
                    CreatedAt = DateTimeProvider.NowMexico(),
                    TenantId = tenantId,
                    AreaId = req.AreaId,
                    OperatorId = req.OperatorId
                });
            }

            // 3) DONATION
            if (donationAmount > 0)
            {
                var donMeta = new
                {
                    kind = "DONATION",
                    terminalId = resolvedTerminalId,
                    areaId = req.AreaId,
                    operatorId = req.OperatorId,
                    donationPercent = req.DonationPercent,
                    donationAmount,
                    donationProjectId = req.DonationProjectId
                };
                db.Transactions.Add(new Transaction
                {
                    UserId = card.User.Id,
                    CardUid = uid,
                    Amount = donationAmount,
                    TipAmount = 0m,
                    Type = TransactionType.Charge,
                    Note = System.Text.Json.JsonSerializer.Serialize(donMeta),
                    CreatedAt = DateTimeProvider.NowMexico(),
                    TenantId = tenantId,
                    AreaId = req.AreaId,
                    OperatorId = req.OperatorId,
                    DonationProjectId = req.DonationProjectId
                });
            }

            await db.SaveChangesAsync();

            Console.WriteLine("[POS_CHARGE_V2] " + System.Text.Json.JsonSerializer.Serialize(new
            {
                phase = "ok",
                tenantId,
                opId = op.Id,
                terminalId = resolvedTerminalId,
                uidShort,
                itemsCount = req.Items?.Count ?? 0,
                total = grandTotal,
                newBalance = card.User.Balance
            }));

            return Results.Ok(new
            {
                ok = true,
                terminalId = resolvedTerminalId,
                uid,
                subtotal,
                tipAmount,
                donationAmount,
                grandTotal,
                newBalance = card.User.Balance
            });
        }
        app.MapPost("/api/charge-v2", ChargeV2Async);
        // LEGACY ALIAS (mantener mientras haya clientes cacheados)
        app.MapPost("/charge-v2", ChargeV2Async);

        return app;
    }

    private static string NormalizeUid(string? uid)
        => string.Concat((uid ?? string.Empty)
            .Trim()
            .ToUpperInvariant()
            .Where(c => !char.IsWhiteSpace(c) && c != '-' && c != ':'));

    private static (string? Value, IResult? Error) ResolveRequiredTerminalId(HttpContext http, params string?[] candidates)
    {
        var fromQuery = http.Request.Query.TryGetValue("terminalId", out var q) ? q.ToString() : null;
        var fromHeader = http.Request.Headers.TryGetValue("X-Terminal-Id", out var h) ? h.ToString() : null;
        var allCandidates = new List<string?>();
        allCandidates.Add(fromQuery);
        allCandidates.Add(fromHeader);
        allCandidates.AddRange(candidates);

        foreach (var candidate in allCandidates)
        {
            var clean = TerminalIdPolicy.Normalize(candidate);
            if (string.IsNullOrWhiteSpace(clean))
                continue;

            if (!TerminalIdPolicy.IsValid(clean))
            {
                return (null, Results.BadRequest(new
                {
                    message = TerminalIdPolicy.ValidationMessage,
                    details = "terminalId_invalid",
                    terminalId = clean
                }));
            }

            return (clean, null);
        }

        return (null, Results.BadRequest(new
        {
            message = TerminalIdPolicy.ValidationMessage,
            details = "terminalId_required"
        }));
    }
}

