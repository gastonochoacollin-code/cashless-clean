namespace Cashless.Api.Endpoints;

using Cashless.Api.Data;
using Cashless.Api.Dtos.Recharges;
using Cashless.Api.Models;
using Cashless.Api.Services.Auth;
using Cashless.Api.Services.Infra;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

public static class RechargesEndpoints
{
    private const int DuplicateWindowSecondsDefault = 10;

    private sealed record ShiftChargeRow(
        int Id,
        decimal Amount,
        string PaymentMethod,
        string? PaymentDetail,
        string? Comment,
        DateTime CreatedAt,
        string? CardUid);

    public static WebApplication MapRechargesEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/recharges");

        api.MapPost("", CreateRechargeAsync);
        api.MapGet("/reports/shift/{shiftId:int}", GetShiftCloseoutAsync);
        api.MapPost("/reports/shift/{shiftId:int}/reconcile", ReconcileShiftCloseoutAsync);
        api.MapGet("/reports/shift/{shiftId:int}/pdf-model", GetShiftCloseoutPdfModelAsync);

        return app;
    }

    private static async Task<IResult> CreateRechargeAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        CreateRechargeRequest req,
        int? duplicateWindowSeconds)
    {
        var (op, fail) = await RequireCashier(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;
        var cardUid = NormalizeUid(req.CardUid);

        if (string.IsNullOrWhiteSpace(cardUid))
            return Results.BadRequest(new { message = "CardUid es obligatorio." });
        if (req.Amount <= 0m)
            return Results.BadRequest(new { message = "Amount debe ser mayor a 0." });

        var method = NormalizePaymentMethod(req.PaymentMethod);
        if (string.IsNullOrWhiteSpace(method))
            return Results.BadRequest(new { message = "PaymentMethod es obligatorio." });
        if (!RechargePaymentMethods.Allowed.Contains(method))
            return Results.BadRequest(new { message = "PaymentMethod no valido." });
        if (method == RechargePaymentMethods.Tarjeta && string.IsNullOrWhiteSpace(req.PaymentDetail))
            return Results.BadRequest(new { message = "PaymentDetail es obligatorio para TARJETA." });

        var openShift = await db.Shifts
            .OrderByDescending(s => s.Id)
            .FirstOrDefaultAsync(s => s.TenantId == tenantId
                && s.CashierId == op.Id
                && s.Status == "Open"
                && s.ClosedAt == null);
        if (openShift is null)
            return Results.Conflict(new { message = "No hay turno abierto para registrar recargas." });

        var nowMx = DateTimeProvider.NowMexico();
        var windowSeconds = Math.Clamp(duplicateWindowSeconds ?? DuplicateWindowSecondsDefault, 1, 300);
        var dupThreshold = nowMx.AddSeconds(-windowSeconds);

        var lastRecharge = await db.Recharges
            .Where(r => r.TenantId == tenantId
                && r.CardUid == cardUid
                && r.CashierId == op.Id
                && r.ShiftId == openShift.Id
                && r.CreatedAt >= dupThreshold)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new { r.Id, r.CreatedAt })
            .FirstOrDefaultAsync();
        if (lastRecharge is not null)
        {
            return Results.Json(new
            {
                message = $"Recarga duplicada detectada para UID {cardUid}. Espera {windowSeconds}s antes de reintentar.",
                lastRechargeId = lastRecharge.Id,
                lastRechargeAt = lastRecharge.CreatedAt,
                windowSeconds
            }, statusCode: 409);
        }

        var row = new Recharge
        {
            TenantId = tenantId,
            CashierId = op.Id,
            ShiftId = openShift.Id,
            Amount = Math.Round(req.Amount, 2),
            CardUid = cardUid,
            ReaderId = string.IsNullOrWhiteSpace(req.ReaderId) ? null : req.ReaderId.Trim(),
            ClientId = string.IsNullOrWhiteSpace(req.ClientId) ? null : req.ClientId.Trim(),
            PaymentMethod = method,
            PaymentDetail = string.IsNullOrWhiteSpace(req.PaymentDetail) ? null : req.PaymentDetail.Trim(),
            Comment = string.IsNullOrWhiteSpace(req.Comment) ? null : req.Comment.Trim(),
            CreatedAt = nowMx
        };

        db.Recharges.Add(row);
        await db.SaveChangesAsync();

        return Results.Ok(new
        {
            row.Id,
            row.CashierId,
            row.ShiftId,
            row.Amount,
            row.CardUid,
            row.ReaderId,
            row.ClientId,
            row.PaymentMethod,
            row.PaymentDetail,
            row.Comment,
            row.CreatedAt
        });
    }


    private static async Task<IResult> GetShiftCloseoutAsync(
        int shiftId,
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        decimal? physicalCash)
    {
        var (op, fail) = await RequireCashierOrAdmin(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        var shift = await db.Shifts
            .Include(s => s.Cashier)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.TenantId == tenantId);
        if (shift is null) return Results.NotFound(new { message = "Shift no existe." });

        if (op.Role == OperatorRole.Cajero && shift.CashierId != op.Id)
            return Results.Json(new { message = "Forbidden. Solo puedes ver tu propio corte." }, statusCode: 403);
        Console.WriteLine($"[SHIFT_CLOSEOUT] endpoint=summary tenantId={tenantId} opId={op.Id} role={op.Role} shiftId={shiftId} targetCashierId={shift.CashierId} physicalCash={(physicalCash?.ToString() ?? "null")}");

        var rows = await LoadShiftRowsAsync(db, shift, tenantId);
        var summary = BuildShiftSummary(shift, rows, physicalCash);
        Console.WriteLine($"[SHIFT_CLOSEOUT] endpoint=summary shiftId={shiftId} rows={rows.Count} totalRecargado={summary.TotalRecargado}");
        return Results.Ok(summary);
    }

    private static async Task<IResult> ReconcileShiftCloseoutAsync(
        int shiftId,
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        ShiftCloseoutRequestDto req)
    {
        var (op, fail) = await RequireCashierOrAdmin(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        var shift = await db.Shifts
            .Include(s => s.Cashier)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.TenantId == tenantId);
        if (shift is null) return Results.NotFound(new { message = "Shift no existe." });
        if (op.Role == OperatorRole.Cajero && shift.CashierId != op.Id)
            return Results.Json(new { message = "Forbidden. Solo puedes ver tu propio corte." }, statusCode: 403);
        Console.WriteLine($"[SHIFT_CLOSEOUT] endpoint=reconcile tenantId={tenantId} opId={op.Id} role={op.Role} shiftId={shiftId} targetCashierId={shift.CashierId} physicalCash={req.PhysicalCash}");

        var rows = await LoadShiftRowsAsync(db, shift, tenantId);
        var summary = BuildShiftSummary(shift, rows, req.PhysicalCash);
        Console.WriteLine($"[SHIFT_CLOSEOUT] endpoint=reconcile shiftId={shiftId} rows={rows.Count} totalRecargado={summary.TotalRecargado}");
        return Results.Ok(summary);
    }

    private static async Task<IResult> GetShiftCloseoutPdfModelAsync(
        int shiftId,
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        decimal? physicalCash)
    {
        var (op, fail) = await RequireCashierOrAdmin(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        var shift = await db.Shifts
            .Include(s => s.Cashier)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.TenantId == tenantId);
        if (shift is null) return Results.NotFound(new { message = "Shift no existe." });
        if (op.Role == OperatorRole.Cajero && shift.CashierId != op.Id)
            return Results.Json(new { message = "Forbidden. Solo puedes ver tu propio corte." }, statusCode: 403);
        Console.WriteLine($"[SHIFT_CLOSEOUT] endpoint=pdf-model tenantId={tenantId} opId={op.Id} role={op.Role} shiftId={shiftId} targetCashierId={shift.CashierId} physicalCash={(physicalCash?.ToString() ?? "null")}");

        var rows = await LoadShiftRowsAsync(db, shift, tenantId);
        var summary = BuildShiftSummary(shift, rows, physicalCash);
        var pdfModel = new ShiftCloseoutPdfModelDto
        {
            Title = $"Corte de Turno - Cajero: {summary.Cashier} (Id: {summary.CashierId})",
            Summary = summary,
            Rows = rows.Select(r => new
            {
                r.Id,
                r.CreatedAt,
                r.Amount,
                r.PaymentMethod,
                r.PaymentDetail,
                r.Comment,
                r.CardUid
            }).Cast<object>().ToList(),
            Metadata = new Dictionary<string, object>
            {
                ["GeneratedAtMexico"] = DateTimeProvider.NowMexico(),
                ["TenantId"] = tenantId,
                ["ShiftId"] = shiftId,
                ["CashierId"] = summary.CashierId,
                ["CashierName"] = summary.Cashier,
                ["Header"] = $"Cajero: {summary.Cashier} (Id: {summary.CashierId})"
            }
        };
        Console.WriteLine($"[SHIFT_CLOSEOUT] endpoint=pdf-model shiftId={shiftId} rows={rows.Count} totalRecargado={summary.TotalRecargado}");

        return Results.Ok(pdfModel);
    }

    private static async Task<List<ShiftChargeRow>> LoadShiftRowsAsync(CashlessContext db, Shift shift, int tenantId)
    {
        var shiftEnd = shift.ClosedAt ?? DateTimeProvider.NowMexico();

        var topups = await db.Transactions
            .Where(t => t.TenantId == tenantId
                && t.Type == TransactionType.TopUp
                && (
                    t.ShiftId == shift.Id
                    || (!t.ShiftId.HasValue
                        && t.OperatorId == shift.CashierId
                        && t.CreatedAt >= shift.OpenedAt
                        && t.CreatedAt <= shiftEnd)
                ))
            .OrderBy(t => t.CreatedAt)
            .Select(t => new
            {
                t.Id,
                t.Amount,
                t.Note,
                t.CreatedAt,
                t.CardUid,
                t.ShiftId
            })
            .ToListAsync();
        var directTopups = topups.Count(t => t.ShiftId == shift.Id);
        var legacyTopups = topups.Count - directTopups;

        if (topups.Count > 0)
        {
            Console.WriteLine($"[SHIFT_CLOSEOUT_ROWS] tenantId={tenantId} shiftId={shift.Id} cashierId={shift.CashierId} source=transactions topups={topups.Count} direct={directTopups} legacyWindow={legacyTopups}");
            return topups.Select(t => new ShiftChargeRow(
                t.Id,
                t.Amount,
                ExtractPaymentMethodFromNote(t.Note),
                null,
                t.Note,
                t.CreatedAt,
                t.CardUid
            )).ToList();
        }

        var recharges = await db.Recharges
            .Where(r => r.TenantId == tenantId
                && (
                    r.ShiftId == shift.Id
                    || (r.CashierId == shift.CashierId
                        && r.CreatedAt >= shift.OpenedAt
                        && r.CreatedAt <= shiftEnd)
                ))
            .OrderBy(r => r.CreatedAt)
            .Select(r => new ShiftChargeRow(r.Id, r.Amount, r.PaymentMethod, r.PaymentDetail, r.Comment, r.CreatedAt, r.CardUid))
            .ToListAsync();
        Console.WriteLine($"[SHIFT_CLOSEOUT_ROWS] tenantId={tenantId} shiftId={shift.Id} cashierId={shift.CashierId} source=recharges rows={recharges.Count}");

        return recharges;
    }

    private static string ExtractPaymentMethodFromNote(string? note)
    {
        if (string.IsNullOrWhiteSpace(note)) return RechargePaymentMethods.Efectivo;
        try
        {
            using var doc = JsonDocument.Parse(note);
            if (doc.RootElement.TryGetProperty("paymentMethod", out var pm))
                return NormalizePaymentMethod(pm.GetString());
        }
        catch
        {
        }

        return RechargePaymentMethods.Efectivo;
    }

    private static ShiftCloseoutDto BuildShiftSummary(
        Shift shift,
        List<ShiftChargeRow> rows,
        decimal? physicalCash)
    {
        decimal SumBy(string method) => rows
            .Where(r => string.Equals(r.PaymentMethod, method, StringComparison.OrdinalIgnoreCase))
            .Sum(r => r.Amount);

        var totalRecargado = rows.Sum(r => r.Amount);
        var totalEfectivo = SumBy(RechargePaymentMethods.Efectivo);
        var totalTarjeta = SumBy(RechargePaymentMethods.Tarjeta);
        var totalCripto = SumBy(RechargePaymentMethods.Cripto);
        var totalTransferencia = SumBy(RechargePaymentMethods.Transferencia);
        var totalOtros = SumBy(RechargePaymentMethods.Otro);

        return new ShiftCloseoutDto
        {
            ShiftId = shift.Id,
            CashierId = shift.CashierId,
            Cashier = shift.Cashier.Name,
            TurnoInicio = shift.OpenedAt,
            TurnoFin = shift.ClosedAt,
            TotalRecargas = rows.Count,
            TotalRecargado = totalRecargado,
            DesglosePorMetodo = new ShiftCloseoutBreakdownDto
            {
                TotalEfectivo = totalEfectivo,
                TotalTarjeta = totalTarjeta,
                TotalCripto = totalCripto,
                TotalTransferencia = totalTransferencia,
                TotalOtros = totalOtros
            },
            TotalEfectivoEsperado = totalEfectivo,
            EfectivoFisico = physicalCash,
            DiferenciaContraEfectivoFisico = physicalCash.HasValue ? physicalCash.Value - totalEfectivo : null
        };
    }

    private static string NormalizePaymentMethod(string? method)
    {
        var m = (method ?? string.Empty).Trim().ToUpperInvariant();
        return m switch
        {
            "EFECTIVO" or "CASH" => RechargePaymentMethods.Efectivo,
            "TARJETA" or "CARD" => RechargePaymentMethods.Tarjeta,
            "CRIPTO" or "CRYPTO" => RechargePaymentMethods.Cripto,
            "TRANSFERENCIA" or "TRANSFER" => RechargePaymentMethods.Transferencia,
            "OTRO" or "OTHER" => RechargePaymentMethods.Otro,
            "" => RechargePaymentMethods.Efectivo,
            _ => RechargePaymentMethods.Otro
        };
    }

    private static string NormalizeUid(string? uid)
        => string.Concat((uid ?? string.Empty)
            .Trim()
            .ToUpperInvariant()
            .Where(c => !char.IsWhiteSpace(c) && c != '-' && c != ':'));

    private static (DateTime fromMx, DateTime toMx) ParseRange(string? from, string? to)
    {
        var today = DateTimeProvider.TodayMexico();
        var fromMx = DateTime.TryParse(from, out var f) ? f.Date : today;
        var toMx = DateTime.TryParse(to, out var t) ? t.Date.AddDays(1) : today.AddDays(1);
        if (toMx <= fromMx) toMx = fromMx.AddDays(1);
        return (fromMx, toMx);
    }

    private static (DateTime fromMx, DateTime toMx) ParseRangeExclusive(string? from, string? to)
    {
        var today = DateTimeProvider.TodayMexico();
        var fromMx = DateTime.TryParse(from, out var f) ? f.Date : today;
        var toMx = DateTime.TryParse(to, out var t) ? t.Date : today.AddDays(1);
        if (toMx <= fromMx) toMx = fromMx.AddDays(1);
        return (fromMx, toMx);
    }

    private static async Task<(Operator? op, IResult? fail)> RequireCashier(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        if (op.Role != OperatorRole.Cajero)
            return (op, Results.Json(new { message = "Forbidden. Requiere rol Cajero." }, statusCode: 403));
        return (op, null);
    }

    private static async Task<(Operator? op, IResult? fail)> RequireCashierOrAdmin(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        var isAdmin = op.Role == OperatorRole.Admin || op.Role == OperatorRole.SuperAdmin;
        var isJefeOperativo = op.Role == OperatorRole.JefeOperativo;
        if (op.Role != OperatorRole.Cajero && !isAdmin && !isJefeOperativo)
            return (op, Results.Json(new { message = "Forbidden." }, statusCode: 403));
        return (op, null);
    }

    private static string Last4(string? uid)
    {
        if (string.IsNullOrWhiteSpace(uid)) return string.Empty;
        var clean = uid.Trim();
        return clean.Length <= 4 ? clean : clean[^4..];
    }
}
