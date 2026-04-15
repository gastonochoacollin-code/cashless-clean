namespace Cashless.Api.Endpoints;

using System.Text.Json;
using Cashless.Api.Data;
using Cashless.Api.Dtos.Cashier;
using Cashless.Api.Models;
using Cashless.Api.Services.Auth;
using Cashless.Api.Services.Infra;
using Microsoft.EntityFrameworkCore;

/*
 * Módulo: CashierEndpoints
 * Propósito:
 *   Implementa la superficie del rol "Cajero (Caja ampliada)" en el backend Cashless offline-first.
 *
 * Contexto del sistema:
 *   Este módulo expone operaciones acotadas a caja para clientes, tarjetas, recargas, turnos y corte,
 *   sin habilitar capacidades de catálogo/admin o reportes globales.
 *
 * Modelo de seguridad:
 *   - RBAC aplicado con RequireCashier en todos los endpoints del módulo.
 *   - 401 cuando la autenticación falla (token/contexto de operador ausente o inválido).
 *   - 403 cuando el operador autenticado no tiene rol Cajero.
 *   - La identidad del cajero siempre se toma del operador autenticado; jamás se acepta CashierId del frontend.
 *   - Todo acceso de datos se limita por TenantId del operador autenticado.
 *
 * Endpoints expuestos:
 *   Clientes:
 *     POST /api/clients
 *     GET  /api/clients
 *     GET  /api/clients/{id}
 *     GET  /api/clients/search?q=
 *   Tarjetas:
 *     POST /api/cards/assign
 *     POST /api/cards/reassign
 *   Recargas:
 *     POST /api/topups
 *     GET  /api/topups/mine
 *   Turnos:
 *     POST /api/shifts/open
 *     POST /api/shifts/close
 *     GET  /api/shifts/current
 *     GET  /api/shifts/mine/summary
 *     GET  /api/shifts/mine/closeout
 *
 * Reglas de filtrado:
 *   - Los clientes se obtienen de Users filtrados por tenant (en este dominio representan clientes no-staff).
 *   - Los endpoints "mine" filtran por cajero autenticado (OperatorId/CashierId) y tenant.
 *   - Los turnos se filtran por tenant + cajero, y opcionalmente por ShiftId.
 *
 * Métricas de conversión (dinero -> saldo):
 *   - Total convertido en turno actual: SUM(TopUp.Amount WHERE ShiftId = turno actual del cajero).
 *   - Total convertido histórico: SUM(TopUp.Amount WHERE OperatorId = cajero autenticado).
 *   - Total de transacciones del turno actual: COUNT(TopUp WHERE ShiftId = turno actual).
 *   - Desglose efectivo/tarjeta del turno: calculado desde Transaction.Note.paymentMethod cuando existe.
 */

/// <summary>
/// Endpoints de caja para el rol Cajero: clientes, tarjetas, recargas, turnos y corte.
/// </summary>
public static class CashierEndpoints
{
    /// <summary>
    /// Proyección interna de métricas de conversión usadas por los endpoints de resumen de turno.
    /// </summary>
    private sealed record ShiftSummaryDto(
        decimal TotalConvertedCurrentShift,
        decimal TotalConvertedHistorical,
        int TotalTransactionsCurrentShift,
        decimal TotalCashCurrentShift,
        decimal TotalCardCurrentShift);
    private sealed record TopupShiftRow(int ShiftId, decimal Amount, DateTime CreatedAt, string? Note);
    private sealed record RechargeShiftRow(int ShiftId, decimal Amount, DateTime CreatedAt, string? PaymentMethod);

    private const int TopupDuplicateWindowSeconds = 10;

    /// <summary>
    /// Registra en la aplicación todos los endpoints de caja bajo el prefijo <c>/api</c>.
    /// </summary>
    /// <param name="app">Instancia de aplicación donde se mapean rutas.</param>
    /// <returns>La misma aplicación para encadenar configuración.</returns>
    public static WebApplication MapCashierEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api");

        api.MapPost("/clients", CreateClientAsync);
        api.MapGet("/clients", GetClientsAsync);
        api.MapGet("/clients/{id:int}", GetClientByIdAsync);
        api.MapGet("/clients/search", SearchClientsAsync);
        api.MapGet("/clients/transfers", GetBalanceTransfersAsync);
        api.MapPost("/clients/transfer-balance", TransferBalanceAsync);

        api.MapPost("/cards/assign", AssignCardAsync);
        api.MapPost("/cards/reassign", ReassignCardAsync);

        api.MapPost("/topups", CreateTopupAsync);
        api.MapGet("/topups/mine", GetMyTopupsAsync);

        api.MapPost("/shifts/open", OpenShiftAsync);
        api.MapPost("/shifts/close", CloseShiftAsync);
        api.MapGet("/shifts/current", GetCurrentShiftAsync);
        api.MapGet("/cashier/shifts", GetCashierShiftsAsync);
        api.MapGet("/shifts/mine/summary", GetMyShiftSummaryAsync);
        api.MapGet("/shifts/mine/closeout", GetMyCloseoutAsync);

        return app;
    }

    /// <summary>
    /// Crea un cliente nuevo dentro del tenant del cajero autenticado.
    /// </summary>
    /// <remarks>
    /// Validaciones: 400 si el nombre está vacío.
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// Respuesta: 201 con datos del cliente creado.
    /// </remarks>
    private static async Task<IResult> CreateClientAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        CreateClientRequest req)
    {
        var (op, fail) = await RequireClientRegistrar(db, http, auth);
        if (fail is not null) return fail;

        if (string.IsNullOrWhiteSpace(req.Name))
            return Results.BadRequest(new { message = "Name requerido" });

        var user = new User
        {
            Name = req.Name.Trim(),
            Email = string.IsNullOrWhiteSpace(req.Email) ? null : req.Email.Trim(),
            Phone = string.IsNullOrWhiteSpace(req.Phone) ? null : req.Phone.Trim(),
            Balance = 0m,
            TotalSpent = 0m,
            TenantId = op!.TenantId
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        return Results.Created($"/api/clients/{user.Id}", new
        {
            user.Id,
            user.Name,
            user.Email,
            user.Phone,
            user.Balance,
            isStaff = false,
            user.CreatedAt
        });
    }

    /// <summary>
    /// Lista clientes del tenant actual para operación de caja.
    /// </summary>
    /// <remarks>
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// Filtrado: limitado por TenantId del operador autenticado.
    /// </remarks>
    private static async Task<IResult> GetClientsAsync(CashlessContext db, HttpContext http, IAuthService auth)
    {
        var (op, fail) = await RequireClientRegistrar(db, http, auth);
        if (fail is not null) return fail;

        var list = await db.Users
            .Where(u => u.TenantId == op!.TenantId)
            .OrderByDescending(u => u.Id)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.Email,
                u.Phone,
                u.Balance,
                isStaff = false,
                u.CreatedAt
            })
            .ToListAsync();

        return Results.Ok(list);
    }

    /// <summary>
    /// Obtiene el detalle de un cliente por id dentro del tenant actual.
    /// </summary>
    /// <remarks>
    /// Validaciones: 404 si no existe en el tenant.
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// </remarks>
    private static async Task<IResult> GetClientByIdAsync(
        int id,
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var (op, fail) = await RequireClientRegistrar(db, http, auth);
        if (fail is not null) return fail;

        var user = await db.Users
            .Where(u => u.TenantId == op!.TenantId && u.Id == id)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.Email,
                u.Phone,
                u.Balance,
                isStaff = false,
                u.CreatedAt
            })
            .FirstOrDefaultAsync();

        return user is null
            ? Results.NotFound(new { message = "Cliente no encontrado" })
            : Results.Ok(user);
    }

    /// <summary>
    /// Busca clientes por texto libre (nombre, email, teléfono o id) en el tenant actual.
    /// </summary>
    /// <remarks>
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// Filtrado: TenantId obligatorio. Límite máximo de resultados: 100.
    /// </remarks>
    private static async Task<IResult> SearchClientsAsync(
        string? q,
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var (op, fail) = await RequireClientRegistrar(db, http, auth);
        if (fail is not null) return fail;

        var text = (q ?? "").Trim().ToLowerInvariant();
        var query = db.Users.Where(u => u.TenantId == op!.TenantId);
        if (!string.IsNullOrWhiteSpace(text))
        {
            query = query.Where(u =>
                u.Name.ToLower().Contains(text)
                || (u.Email ?? "").ToLower().Contains(text)
                || (u.Phone ?? "").ToLower().Contains(text)
                || u.Id.ToString().Contains(text));
        }

        var list = await query
            .OrderByDescending(u => u.Id)
            .Take(100)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.Email,
                u.Phone,
                u.Balance,
                isStaff = false,
                u.CreatedAt
            })
            .ToListAsync();

        return Results.Ok(list);
    }

    private static async Task<IResult> GetBalanceTransfersAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var (op, fail) = await RequireClientRegistrar(db, http, auth);
        if (fail is not null) return fail;

        var rows = await db.BalanceTransfers
            .Include(x => x.FromUser)
            .Include(x => x.ToUser)
            .Include(x => x.Operator)
            .Where(x => x.TenantId == op!.TenantId)
            .OrderByDescending(x => x.CreatedAt)
            .Take(100)
            .Select(x => new
            {
                x.Id,
                x.FromUserId,
                fromUserName = x.FromUser.Name,
                x.ToUserId,
                toUserName = x.ToUser.Name,
                x.Amount,
                x.OperatorId,
                operatorName = x.Operator.Name,
                x.Comment,
                x.CreatedAt
            })
            .ToListAsync();

        return Results.Ok(rows);
    }

    private static async Task<IResult> TransferBalanceAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        TransferBalanceRequest req)
    {
        var (op, fail) = await RequireClientRegistrar(db, http, auth);
        if (fail is not null) return fail;

        if (req.FromUserId <= 0) return Results.BadRequest(new { message = "FromUserId invalido" });
        if (req.ToUserId <= 0) return Results.BadRequest(new { message = "ToUserId invalido" });
        if (req.FromUserId == req.ToUserId) return Results.BadRequest(new { message = "Los usuarios deben ser distintos" });
        if (req.Amount <= 0m) return Results.BadRequest(new { message = "Amount invalido" });

        var tenantId = op!.TenantId;
        var userIds = new[] { req.FromUserId, req.ToUserId };
        var users = await db.Users
            .Where(u => u.TenantId == tenantId && userIds.Contains(u.Id))
            .ToListAsync();

        var fromUser = users.FirstOrDefault(u => u.Id == req.FromUserId);
        if (fromUser is null) return Results.NotFound(new { message = "Usuario origen no encontrado" });

        var toUser = users.FirstOrDefault(u => u.Id == req.ToUserId);
        if (toUser is null) return Results.NotFound(new { message = "Usuario destino no encontrado" });

        if (fromUser.Balance < req.Amount)
            return Results.BadRequest(new { message = "Saldo insuficiente en el usuario origen" });

        var now = DateTimeProvider.NowMexico();
        var note = string.IsNullOrWhiteSpace(req.Comment) ? null : req.Comment.Trim();

        await using var tx = await db.Database.BeginTransactionAsync();

        fromUser.Balance -= req.Amount;
        toUser.Balance += req.Amount;

        db.BalanceTransfers.Add(new BalanceTransfer
        {
            TenantId = tenantId,
            FromUserId = fromUser.Id,
            ToUserId = toUser.Id,
            Amount = req.Amount,
            OperatorId = op.Id,
            Comment = note,
            CreatedAt = now
        });

        await db.SaveChangesAsync();
        await tx.CommitAsync();

        return Results.Ok(new
        {
            ok = true,
            amount = req.Amount,
            fromUser = new
            {
                fromUser.Id,
                fromUser.Name,
                balance = fromUser.Balance
            },
            toUser = new
            {
                toUser.Id,
                toUser.Name,
                balance = toUser.Balance
            },
            operatorInfo = new
            {
                op.Id,
                op.Name
            },
            comment = note,
            createdAt = now
        });
    }

    /// <summary>
    /// Asigna una tarjeta (UID) a un cliente sin tarjeta y con UID disponible.
    /// </summary>
    /// <remarks>
    /// Validaciones: 400 por UserId inválido o UID vacío; 404 si cliente no existe; 409 si UID ya está tomado
    /// o si el cliente ya tiene tarjeta.
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// Auditoría: registra CardAudit con motivo "Asignacion inicial".
    /// </remarks>
    private static async Task<IResult> AssignCardAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        AssignCardCashierRequest req)
    {
        var (op, fail) = await RequireCashier(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        if (req.UserId <= 0) return Results.BadRequest(new { message = "UserId invalido" });
        var uid = NormalizeUid(req.Uid);
        if (string.IsNullOrWhiteSpace(uid)) return Results.BadRequest(new { message = "UID requerido" });

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == req.UserId && u.TenantId == tenantId);
        if (user is null) return Results.NotFound(new { message = "Cliente no existe" });

        var existingByUid = await db.Cards
            .Include(c => c.User)
            .FirstOrDefaultAsync(c => c.Uid == uid && c.TenantId == tenantId);
        if (existingByUid is not null)
        {
            var owner = existingByUid.User?.Name ?? $"UserId {existingByUid.UserId}";
            return Results.Json(new { message = $"UID ya asignado a {owner}" }, statusCode: 409);
        }

        var existingForUser = await db.Cards.FirstOrDefaultAsync(c => c.UserId == req.UserId && c.TenantId == tenantId);
        if (existingForUser is not null)
            return Results.Json(new { message = "El cliente ya tiene tarjeta. Usa /api/cards/reassign." }, statusCode: 409);

        db.Cards.Add(new Card { Uid = uid, UserId = user.Id, TenantId = tenantId });
        db.CardAudits.Add(new CardAudit
        {
            TenantId = tenantId,
            CashierId = op.Id,
            ClientId = user.Id,
            OldUid = null,
            NewUid = uid,
            Reason = "Asignacion inicial",
            CreatedAt = DateTimeProvider.NowMexico()
        });

        await db.SaveChangesAsync();
        return Results.Ok(new { ok = true, userId = user.Id, uid });
    }

    /// <summary>
    /// Reasigna una tarjeta a un cliente, exigiendo motivo y dejando trazabilidad de auditoría.
    /// </summary>
    /// <remarks>
    /// Validaciones: 400 por UserId inválido, UID vacío o motivo vacío; 404 si cliente no existe;
    /// 409 si el UID pertenece a otro cliente.
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// Auditoría: registra siempre CardAudit con OldUid, NewUid y Reason.
    /// </remarks>
    private static async Task<IResult> ReassignCardAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        ReassignCardCashierRequest req)
    {
        var (op, fail) = await RequireCashier(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        if (req.UserId <= 0) return Results.BadRequest(new { message = "UserId invalido" });
        var uid = NormalizeUid(req.Uid);
        if (string.IsNullOrWhiteSpace(uid)) return Results.BadRequest(new { message = "UID requerido" });
        if (string.IsNullOrWhiteSpace(req.Reason)) return Results.BadRequest(new { message = "Reason requerido" });

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == req.UserId && u.TenantId == tenantId);
        if (user is null) return Results.NotFound(new { message = "Cliente no existe" });

        var existingByUid = await db.Cards
            .Include(c => c.User)
            .FirstOrDefaultAsync(c => c.Uid == uid && c.TenantId == tenantId);
        if (existingByUid is not null && existingByUid.UserId != req.UserId)
        {
            var owner = existingByUid.User?.Name ?? $"UserId {existingByUid.UserId}";
            return Results.Json(new { message = $"UID ya asignado a {owner}" }, statusCode: 409);
        }

        var card = await db.Cards.FirstOrDefaultAsync(c => c.UserId == req.UserId && c.TenantId == tenantId);
        string? oldUid = null;
        if (card is null)
        {
            db.Cards.Add(new Card
            {
                Uid = uid,
                UserId = req.UserId,
                TenantId = tenantId,
                LinkedAt = DateTimeProvider.NowMexico()
            });
        }
        else
        {
            oldUid = card.Uid;
            card.Uid = uid;
            card.LinkedAt = DateTimeProvider.NowMexico();
        }

        db.CardAudits.Add(new CardAudit
        {
            TenantId = tenantId,
            CashierId = op.Id,
            ClientId = req.UserId,
            OldUid = oldUid,
            NewUid = uid,
            Reason = req.Reason.Trim(),
            CreatedAt = DateTimeProvider.NowMexico()
        });

        await db.SaveChangesAsync();
        return Results.Ok(new { ok = true, userId = req.UserId, oldUid, uid });
    }

    /// <summary>
    /// Registra una recarga de saldo para una tarjeta asignada dentro del turno abierto del cajero.
    /// </summary>
    /// <remarks>
    /// Validaciones: 400 por UID vacío o monto no positivo; 404 si la tarjeta no está asignada;
    /// 409 si no hay turno abierto.
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// Respuesta: incluye saldo antes/después y metadatos tipo comprobante.
    /// </remarks>
    private static async Task<IResult> CreateTopupAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        CreateTopupRequest req)
    {
        var (op, fail) = await RequireCashier(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;
        var cashierId = op.Id;

        var uid = NormalizeUid(req.Uid ?? req.CardUid);
        if (string.IsNullOrWhiteSpace(uid)) return Results.BadRequest(new { message = "UID requerido" });
        if (req.Amount <= 0m) return Results.BadRequest(new { message = "Monto invalido" });

        var shift = await db.Shifts
            .OrderByDescending(s => s.Id)
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.CashierId == cashierId && s.Status == "Open" && s.ClosedAt == null);
        if (shift is null) return Results.Conflict(new { message = "No hay turno abierto para registrar recargas." });

        var nowMx = DateTimeProvider.NowMexico();
        var dupThreshold = nowMx.AddSeconds(-TopupDuplicateWindowSeconds);
        var lastTopup = await db.Transactions
            .Where(t => t.TenantId == tenantId
                && t.Type == TransactionType.TopUp
                && t.CardUid == uid
                && t.OperatorId == cashierId
                && t.ShiftId == shift.Id
                && t.CreatedAt >= dupThreshold)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new { t.Id, t.CreatedAt })
            .FirstOrDefaultAsync();
        if (lastTopup is not null)
        {
            return Results.Json(new
            {
                message = $"Recarga duplicada detectada para UID {uid}. Espera {TopupDuplicateWindowSeconds}s antes de reintentar.",
                lastTopupId = lastTopup.Id,
                lastTopupAt = lastTopup.CreatedAt,
                windowSeconds = TopupDuplicateWindowSeconds
            }, statusCode: 409);
        }

        var card = await db.Cards
            .Include(c => c.User)
            .FirstOrDefaultAsync(c => c.Uid == uid && c.TenantId == tenantId);
        if (card?.User is null || card.User.TenantId != tenantId) return Results.NotFound(new { message = "Tarjeta no asignada" });

        var before = card.User.Balance;
        card.User.Balance += req.Amount;
        var after = card.User.Balance;
        var payment = string.IsNullOrWhiteSpace(req.PaymentMethod) ? "cash" : req.PaymentMethod.Trim().ToLowerInvariant();

        var topupMeta = JsonSerializer.Serialize(new
        {
            kind = "TOPUP",
            shiftId = shift.Id,
            cashierId,
            paymentMethod = payment
        });

        var tx = new Transaction
        {
            TenantId = tenantId,
            UserId = card.UserId,
            CardUid = uid,
            Type = TransactionType.TopUp,
            Amount = req.Amount,
            OperatorId = cashierId,
            AreaId = op.AreaId,
            ShiftId = shift.Id,
            Note = topupMeta,
            CreatedAt = nowMx
        };

        db.Transactions.Add(tx);
        await db.SaveChangesAsync();

        return Results.Ok(new
        {
            ok = true,
            topupId = tx.Id,
            cardUid = uid,
            clientId = card.UserId,
            clientName = card.User.Name,
            amount = req.Amount,
            beforeBalance = before,
            afterBalance = after,
            shiftId = shift.Id,
            cashierId,
            createdAt = tx.CreatedAt
        });
    }

    /// <summary>
    /// Lista recargas del cajero autenticado con paginación básica.
    /// </summary>
    /// <remarks>
    /// Validaciones: <c>take</c> en [1..200], <c>skip</c> mínimo 0.
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// Filtrado: TenantId + transacciones TopUp + OperatorId del cajero autenticado.
    /// </remarks>
    private static async Task<IResult> GetMyTopupsAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        int take = 100,
        int skip = 0)
    {
        var (op, fail) = await RequireCashier(db, http, auth);
        if (fail is not null) return fail;

        take = Math.Clamp(take, 1, 200);
        skip = Math.Max(skip, 0);

        var rows = await db.Transactions
            .Where(t => t.TenantId == op!.TenantId && t.Type == TransactionType.TopUp && t.OperatorId == op.Id)
            .OrderByDescending(t => t.Id)
            .Skip(skip)
            .Take(take)
            .Select(t => new
            {
                t.Id,
                t.Amount,
                t.CardUid,
                t.UserId,
                t.ShiftId,
                t.CreatedAt
            })
            .ToListAsync();

        return Results.Ok(rows);
    }

    /// <summary>
    /// Abre un turno para el cajero autenticado si no existe uno abierto.
    /// </summary>
    /// <remarks>
    /// Validaciones: 409 si ya existe turno abierto para ese cajero.
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// </remarks>
    private static async Task<IResult> OpenShiftAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        OpenShiftRequest req)
    {
        var (op, fail) = await RequireShiftOperator(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;
        var cashierId = op.Id;
        var scope = NormalizeShiftScope(http.Request.Query["scope"], op, req.BoxId);
        var boxId = scope == "barra" ? (req.BoxId ?? op.AreaId) : null;
        var isBarraScope = scope == "barra";
        if (scope == "barra" && (!boxId.HasValue || boxId.Value <= 0))
            return Results.BadRequest(new { message = "Turno de barra requiere AreaId/BoxId valido." });

        var existingQuery = db.Shifts
            .Where(s => s.TenantId == tenantId
                && s.CashierId == cashierId
                && s.Status == "Open"
                && s.ClosedAt == null);
        existingQuery = isBarraScope
            ? existingQuery.Where(s => s.BoxId.HasValue && s.BoxId.Value > 0 && s.BoxId == boxId)
            : existingQuery.Where(s => !s.BoxId.HasValue || s.BoxId.Value <= 0);
        var existing = await existingQuery.FirstOrDefaultAsync();
        if (existing is not null)
            return Results.Conflict(new { message = $"Ya tienes un turno de {scope} abierto", shiftId = existing.Id });

        var shift = new Shift
        {
            TenantId = tenantId,
            CashierId = cashierId,
            BoxId = boxId,
            OpenedAt = DateTimeProvider.NowMexico(),
            Status = "Open"
        };

        db.Shifts.Add(shift);
        await db.SaveChangesAsync();
        return Results.Ok(new { ok = true, shiftId = shift.Id, shift.OpenedAt, shift.BoxId, shift.Status, scope });
    }

    /// <summary>
    /// Cierra el turno abierto del cajero autenticado y devuelve resumen de cierre.
    /// </summary>
    /// <remarks>
    /// Validaciones: 404 si no hay turno abierto.
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// </remarks>
    private static async Task<IResult> CloseShiftAsync(CashlessContext db, HttpContext http, IAuthService auth, string? scope)
    {
        var (op, fail) = await RequireShiftOperator(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;
        var cashierId = op.Id;
        var shiftScope = NormalizeShiftScope(scope, op);
        var isBarraScope = shiftScope == "barra";

        var shiftQuery = db.Shifts
            .Where(s => s.TenantId == tenantId
                && s.CashierId == cashierId
                && s.Status == "Open"
                && s.ClosedAt == null);
        shiftQuery = isBarraScope
            ? shiftQuery.Where(s => s.BoxId.HasValue && s.BoxId.Value > 0)
            : shiftQuery.Where(s => !s.BoxId.HasValue || s.BoxId.Value <= 0);
        var shift = await shiftQuery
            .OrderByDescending(s => s.Id)
            .FirstOrDefaultAsync();
        if (shift is null) return Results.NotFound(new { message = $"No hay turno abierto de {shiftScope}" });

        shift.ClosedAt = DateTimeProvider.NowMexico();
        shift.Status = "Closed";
        await db.SaveChangesAsync();

        var summary = await BuildShiftSummaryAsync(db, tenantId, cashierId, shift.Id);
        return Results.Ok(new { ok = true, shiftId = shift.Id, shift.OpenedAt, shift.ClosedAt, shift.Status, shift.BoxId, scope = shiftScope, summary });
    }

    /// <summary>
    /// Obtiene el estado del turno actual del cajero junto con métricas de conversión.
    /// </summary>
    /// <remarks>
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// Si no hay turno abierto, devuelve métricas de turno en cero y mantiene el histórico.
    /// </remarks>
    private static async Task<IResult> GetCurrentShiftAsync(CashlessContext db, HttpContext http, IAuthService auth, string? scope)
    {
        var (op, fail) = await RequireShiftOperator(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;
        var cashierId = op.Id;
        var shiftScope = NormalizeShiftScope(scope, op);
        var isBarraScope = shiftScope == "barra";

        var currentShiftQuery = db.Shifts
            .Where(s => s.TenantId == tenantId
                && s.CashierId == cashierId
                && s.Status == "Open"
                && s.ClosedAt == null);
        currentShiftQuery = isBarraScope
            ? currentShiftQuery.Where(s => s.BoxId.HasValue && s.BoxId.Value > 0)
            : currentShiftQuery.Where(s => !s.BoxId.HasValue || s.BoxId.Value <= 0);
        var shift = await currentShiftQuery
            .OrderByDescending(s => s.Id)
            .FirstOrDefaultAsync();

        if (shift is null)
        {
            var historicalSum = await db.Transactions
                .Where(t => t.TenantId == tenantId && t.Type == TransactionType.TopUp && t.OperatorId == cashierId)
                .SumAsync(t => (double?)t.Amount) ?? 0d;
            var historical = (decimal)historicalSum;

            return Results.Ok(new
            {
                hasOpenShift = false,
                scope = shiftScope,
                totalConvertedCurrentShift = 0m,
                totalConvertedHistorical = historical,
                totalTransactionsCurrentShift = 0
            });
        }

        var summary = await BuildShiftSummaryAsync(db, tenantId, cashierId, shift.Id);
        return Results.Ok(new
        {
            hasOpenShift = true,
            scope = shiftScope,
            shiftId = shift.Id,
            shift.BoxId,
            shift.OpenedAt,
            shift.Status,
            totalConvertedCurrentShift = summary.TotalConvertedCurrentShift,
            totalConvertedHistorical = summary.TotalConvertedHistorical,
            totalTransactionsCurrentShift = summary.TotalTransactionsCurrentShift,
            totalCashCurrentShift = summary.TotalCashCurrentShift,
            totalCardCurrentShift = summary.TotalCardCurrentShift
        });
    }

    private static async Task<IResult> GetCashierShiftsAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        string? from,
        string? to,
        int? cashierId,
        string? scope)
    {
        var (op, fail) = await RequireShiftOperatorOrAdmin(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;
        var isCashier = op.Role == OperatorRole.Cajero;
        var targetCashierId = isCashier ? op.Id : (cashierId > 0 ? cashierId.Value : (int?)null);
        var shiftScope = NormalizeShiftScope(scope, op);
        var isBarraScope = shiftScope == "barra";
        var range = GetMexicoRange(from, to);
        Console.WriteLine($"[CASHIER_SHIFTS] tenantId={tenantId} opId={op.Id} role={op.Role} scope={shiftScope} from={from ?? "-"} to={to ?? "-"} rangeFrom={range.From:O} rangeToExcl={range.To:O} targetCashierId={(targetCashierId?.ToString() ?? "null")}");

        var shiftsQuery = db.Shifts
            .AsNoTracking()
            .Include(s => s.Cashier)
            .Where(s => s.TenantId == tenantId
                && (!targetCashierId.HasValue || s.CashierId == targetCashierId.Value)
                && s.OpenedAt >= range.From
                && s.OpenedAt < range.To);
        shiftsQuery = isBarraScope
            ? shiftsQuery.Where(s => s.BoxId.HasValue && s.BoxId.Value > 0)
            : shiftsQuery.Where(s => !s.BoxId.HasValue || s.BoxId.Value <= 0);

        var shifts = await shiftsQuery
            .OrderByDescending(s => s.Id)
            .Select(s => new
            {
                s.Id,
                s.CashierId,
                CashierName = s.Cashier != null ? s.Cashier.Name : null,
                s.BoxId,
                s.OpenedAt,
                s.ClosedAt,
                s.Status
            })
            .ToListAsync();
        Console.WriteLine($"[CASHIER_SHIFTS] shifts_found={shifts.Count}");

        var shiftIds = shifts.Select(s => s.Id).ToList();
        var txTopups = new List<TopupShiftRow>();
        var directShiftTopups = 0;
        var legacyWindowTopups = 0;
        if (shiftIds.Count > 0)
        {
            var minOpenedAt = shifts.Min(s => s.OpenedAt);
            var maxShiftEnd = shifts.Max(s => s.ClosedAt ?? DateTimeProvider.NowMexico());

            var txTopupsRaw = await db.Transactions
                .Where(t => t.TenantId == tenantId
                    && t.Type == TransactionType.TopUp
                    && (!targetCashierId.HasValue || t.OperatorId == targetCashierId.Value)
                    && (
                        (t.ShiftId.HasValue && shiftIds.Contains(t.ShiftId.Value))
                        || (!t.ShiftId.HasValue && t.CreatedAt >= minOpenedAt && t.CreatedAt <= maxShiftEnd)
                    ))
                .Select(t => new
                {
                    t.ShiftId,
                    t.OperatorId,
                    t.Amount,
                    t.CreatedAt,
                    t.Note
                })
                .ToListAsync();

            foreach (var tx in txTopupsRaw)
            {
                if (tx.ShiftId.HasValue && shiftIds.Contains(tx.ShiftId.Value))
                {
                    txTopups.Add(new TopupShiftRow(tx.ShiftId.Value, tx.Amount, tx.CreatedAt, tx.Note));
                    directShiftTopups++;
                    continue;
                }

                // Compatibilidad legacy: topups sin ShiftId. Asignar al turno del cajero por ventana temporal.
                var matchedShift = shifts
                    .Where(s => s.CashierId == (tx.OperatorId ?? -1))
                    .Where(s =>
                    {
                        var shiftEnd = s.ClosedAt ?? DateTimeProvider.NowMexico();
                        return tx.CreatedAt >= s.OpenedAt && tx.CreatedAt <= shiftEnd;
                    })
                    .OrderByDescending(s => s.OpenedAt)
                    .FirstOrDefault();

                if (matchedShift is not null)
                {
                    txTopups.Add(new TopupShiftRow(matchedShift.Id, tx.Amount, tx.CreatedAt, tx.Note));
                    legacyWindowTopups++;
                }
            }
        }

        var rechargeRows = await db.Recharges
            .Where(r => r.TenantId == tenantId
                && (!targetCashierId.HasValue || r.CashierId == targetCashierId.Value)
                && shiftIds.Contains(r.ShiftId))
            .Select(r => new RechargeShiftRow(r.ShiftId, r.Amount, r.CreatedAt, r.PaymentMethod))
            .ToListAsync();
        Console.WriteLine($"[CASHIER_SHIFTS] topups_direct={directShiftTopups} topups_legacy_window={legacyWindowTopups} recharges={rechargeRows.Count}");

        var groupedTopups = txTopups.GroupBy(x => x.ShiftId).ToDictionary(g => g.Key, g => g.ToList());
        var groupedRecharges = rechargeRows.GroupBy(x => x.ShiftId).ToDictionary(g => g.Key, g => g.ToList());

        var rows = shifts.Select(s =>
        {
            var topups = groupedTopups.TryGetValue(s.Id, out var tList) ? tList : new List<TopupShiftRow>();
            var rechargesAll = groupedRecharges.TryGetValue(s.Id, out var rList) ? rList : new List<RechargeShiftRow>();
            // Mismo criterio que closeout: fuente primaria = Transactions TopUp; Recharges solo fallback si no hay topups.
            var recharges = topups.Count > 0 ? new List<RechargeShiftRow>() : rechargesAll;

            decimal efectivo = 0m;
            decimal tarjeta = 0m;
            decimal cripto = 0m;
            decimal transferencia = 0m;
            decimal otro = 0m;

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
                    catch { }
                }
                AddAmount(method, tx.Amount, ref efectivo, ref tarjeta, ref cripto, ref transferencia, ref otro);
            }

            foreach (var rc in recharges)
            {
                var method = NormalizePaymentMethod(rc.PaymentMethod);
                AddAmount(method, rc.Amount, ref efectivo, ref tarjeta, ref cripto, ref transferencia, ref otro);
            }

            var totalRecargas = topups.Count + recharges.Count;
            var totalRecargado = efectivo + tarjeta + cripto + transferencia + otro;
            DateTime? lastTopupAt = topups.Count > 0 ? topups.Max(x => x.CreatedAt) : null;
            DateTime? lastRechargeAt = recharges.Count > 0 ? recharges.Max(x => x.CreatedAt) : null;
            DateTime? lastAt = lastTopupAt.HasValue && lastRechargeAt.HasValue
                ? (lastTopupAt > lastRechargeAt ? lastTopupAt : lastRechargeAt)
                : (lastTopupAt ?? lastRechargeAt);

            return new
            {
                shiftId = s.Id,
                cashierId = s.CashierId,
                cashierName = s.CashierName,
                boxId = s.BoxId,
                scope = shiftScope,
                s.OpenedAt,
                s.ClosedAt,
                s.Status,
                totalRecargas,
                totalRecargado,
                breakdown = new
                {
                    efectivo,
                    tarjeta,
                    cripto,
                    transferencia,
                    otro
                },
                totalEfectivoEsperado = efectivo,
                lastRechargeAt = lastAt
            };
        }).ToList();

        return Results.Ok(new
        {
            from = range.From,
            to = range.To,
            scope = shiftScope,
            cashierId = targetCashierId,
            count = rows.Count,
            items = rows
        });
    }

    /// <summary>
    /// Obtiene el resumen "mine" del cajero autenticado para su turno actual (si existe).
    /// </summary>
    /// <remarks>
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// Filtrado: siempre por TenantId y cajero autenticado.
    /// </remarks>
    private static async Task<IResult> GetMyShiftSummaryAsync(CashlessContext db, HttpContext http, IAuthService auth)
    {
        var (op, fail) = await RequireShiftOperator(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;
        var cashierId = op.Id;

        var current = await db.Shifts
            .OrderByDescending(s => s.Id)
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.CashierId == cashierId && s.Status == "Open" && s.ClosedAt == null);

        var summary = await BuildShiftSummaryAsync(db, tenantId, cashierId, current?.Id);
        return Results.Ok(new
        {
            cashierId,
            currentShiftId = current?.Id,
            totalConvertedCurrentShift = summary.TotalConvertedCurrentShift,
            totalConvertedHistorical = summary.TotalConvertedHistorical,
            totalTransactionsCurrentShift = summary.TotalTransactionsCurrentShift,
            totalCashCurrentShift = summary.TotalCashCurrentShift,
            totalCardCurrentShift = summary.TotalCardCurrentShift
        });
    }

    /// <summary>
    /// Obtiene el corte del último turno del cajero autenticado.
    /// </summary>
    /// <remarks>
    /// Validaciones: 404 si el cajero no tiene turnos registrados.
    /// Autorización: 401 si no autentica, 403 si no es Cajero.
    /// </remarks>
    private static async Task<IResult> GetMyCloseoutAsync(CashlessContext db, HttpContext http, IAuthService auth)
    {
        var (op, fail) = await RequireShiftOperator(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;
        var cashierId = op.Id;

        var shift = await db.Shifts
            .Where(s => s.TenantId == tenantId && s.CashierId == cashierId)
            .OrderByDescending(s => s.Id)
            .FirstOrDefaultAsync();
        if (shift is null) return Results.NotFound(new { message = "Sin turnos para este cajero" });

        var summary = await BuildShiftSummaryAsync(db, tenantId, cashierId, shift.Id);
        return Results.Ok(new
        {
            shiftId = shift.Id,
            shift.BoxId,
            shift.Status,
            shift.OpenedAt,
            shift.ClosedAt,
            summary
        });
    }

    /// <summary>
    /// Calcula métricas de conversión para un cajero:
    /// total de turno actual, total histórico, cantidad de recargas del turno y desglose efectivo/tarjeta.
    /// </summary>
    /// <remarks>
    /// El histórico suma todas las recargas del cajero.
    /// Si no hay ShiftId, las métricas de turno actual regresan en cero.
    /// El desglose efectivo/tarjeta se infiere de <c>Transaction.Note.paymentMethod</c> cuando existe.
    /// </remarks>
    private static async Task<ShiftSummaryDto> BuildShiftSummaryAsync(CashlessContext db, int tenantId, int cashierId, int? shiftId)
    {
        var historicalSum = await db.Transactions
            .Where(t => t.TenantId == tenantId && t.Type == TransactionType.TopUp && t.OperatorId == cashierId)
            .SumAsync(t => (double?)t.Amount) ?? 0d;
        var historical = (decimal)historicalSum;

        if (!shiftId.HasValue)
        {
            return new ShiftSummaryDto(0m, historical, 0, 0m, 0m);
        }

        var shiftTx = await db.Transactions
            .Where(t => t.TenantId == tenantId && t.Type == TransactionType.TopUp && t.OperatorId == cashierId && t.ShiftId == shiftId.Value)
            .Select(t => new { t.Amount, t.Note })
            .ToListAsync();

        decimal cash = 0m;
        decimal card = 0m;
        foreach (var tx in shiftTx)
        {
            var method = "cash";
            if (!string.IsNullOrWhiteSpace(tx.Note))
            {
                try
                {
                    using var doc = JsonDocument.Parse(tx.Note);
                    if (doc.RootElement.TryGetProperty("paymentMethod", out var pm))
                        method = (pm.GetString() ?? "cash").ToLowerInvariant();
                }
                catch
                {
                }
            }

            if (method == "card" || method == "tarjeta") card += tx.Amount;
            else cash += tx.Amount;
        }

        var current = shiftTx.Sum(x => x.Amount);
        return new ShiftSummaryDto(current, historical, shiftTx.Count, cash, card);
    }

    private static (DateTime From, DateTime To) GetMexicoRange(string? from, string? to)
    {
        var today = DateTimeProvider.TodayMexico();
        var defaultFrom = today.AddDays(-30);
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

    private static void AddAmount(
        string method,
        decimal amount,
        ref decimal efectivo,
        ref decimal tarjeta,
        ref decimal cripto,
        ref decimal transferencia,
        ref decimal otro)
    {
        switch (method)
        {
            case "EFECTIVO": efectivo += amount; break;
            case "TARJETA": tarjeta += amount; break;
            case "CRIPTO": cripto += amount; break;
            case "TRANSFERENCIA": transferencia += amount; break;
            default: otro += amount; break;
        }
    }

    private static string NormalizeShiftScope(string? scope, Operator op, int? requestedBoxId = null)
    {
        var raw = (scope ?? string.Empty).Trim().ToLowerInvariant();
        if (raw == "barra" || raw == "bar") return "barra";
        if (raw == "caja" || raw == "cashier" || raw == "cash") return "caja";
        if (op.Role == OperatorRole.JefeDeBarra || op.Role == OperatorRole.JefeDeStand) return "barra";
        if (requestedBoxId.HasValue && requestedBoxId.Value > 0) return "barra";
        return "caja";
    }

    /// <summary>
    /// Autentica la solicitud y valida que el operador tenga rol Cajero.
    /// </summary>
    /// <remarks>
    /// Devuelve:
    /// 401 cuando la autenticación falla.
    /// 403 cuando autentica pero el rol no es Cajero.
    /// </remarks>
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

    private static async Task<(Operator? op, IResult? fail)> RequireClientRegistrar(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        var isAdmin = op.Role == OperatorRole.Admin || op.Role == OperatorRole.SuperAdmin;
        var isJefeOperativo = op.Role == OperatorRole.JefeOperativo;
        if (op.Role != OperatorRole.Cajero && !isAdmin && !isJefeOperativo)
            return (op, Results.Json(new { message = "Forbidden. Requiere acceso a registro de usuarios." }, statusCode: 403));
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

    private static async Task<(Operator? op, IResult? fail)> RequireShiftOperator(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        var isAdmin = op.Role == OperatorRole.Admin || op.Role == OperatorRole.SuperAdmin;
        var isJefeOperativo = op.Role == OperatorRole.JefeOperativo;
        var isJefeDeBarra = op.Role == OperatorRole.JefeDeBarra;
        var isJefeDeStand = op.Role == OperatorRole.JefeDeStand;
        if (op.Role != OperatorRole.Cajero && !isAdmin && !isJefeOperativo && !isJefeDeBarra && !isJefeDeStand)
            return (op, Results.Json(new { message = "Forbidden. Requiere rol de turnos." }, statusCode: 403));
        return (op, null);
    }

    private static async Task<(Operator? op, IResult? fail)> RequireShiftOperatorOrAdmin(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        var isAdmin = op.Role == OperatorRole.Admin || op.Role == OperatorRole.SuperAdmin;
        var isJefeOperativo = op.Role == OperatorRole.JefeOperativo;
        var isJefeDeBarra = op.Role == OperatorRole.JefeDeBarra;
        var isJefeDeStand = op.Role == OperatorRole.JefeDeStand;
        if (op.Role != OperatorRole.Cajero && !isAdmin && !isJefeOperativo && !isJefeDeBarra && !isJefeDeStand)
            return (op, Results.Json(new { message = "Forbidden." }, statusCode: 403));
        return (op, null);
    }

    /// <summary>
    /// Normaliza un UID: recorta espacios, convierte a mayúsculas y elimina separadores.
    /// </summary>
    private static string NormalizeUid(string? uid)
        => string.Concat((uid ?? string.Empty)
            .Trim()
            .ToUpperInvariant()
            .Where(c => !char.IsWhiteSpace(c) && c != '-' && c != ':'));
}
