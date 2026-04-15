namespace Cashless.Api.Endpoints;

using Cashless.Api.Data;
using Cashless.Api.Models;
using Cashless.Api.Services.Auth;
using Cashless.Api.Services.Infra;
using Microsoft.EntityFrameworkCore;

public static class UserBalanceEndpoints
{
    public static WebApplication MapUserBalanceEndpoints(this WebApplication app)
    {
        app.MapPost("/api/users/{id:int}/reset-balance", ResetUserBalanceAsync)
            .WithName("ResetUserBalance")
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound);

        app.MapPost("/api/users/reset-all-balances", ResetAllUserBalancesAsync)
            .WithName("ResetAllUserBalances")
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden);

        return app;
    }

    private static async Task<IResult> ResetUserBalanceAsync(
        int id,
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var (op, fail) = await RequireAdmin(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        await using var tx = await db.Database.BeginTransactionAsync();

        var user = await db.Users.FirstOrDefaultAsync(u => u.TenantId == tenantId && u.Id == id);
        if (user is null)
        {
            return Results.NotFound(new { message = "Usuario no existe" });
        }

        var previousBalance = user.Balance;
        var now = DateTimeProvider.NowMexico();

        user.Balance = 0m;
        db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            Action = "USER_BALANCE_RESET",
            UserId = user.Id,
            OperatorId = op.Id,
            PreviousValue = previousBalance,
            NewValue = 0m,
            Note = $"Reset individual de saldo para usuario #{user.Id} ({user.Name}).",
            CreatedAt = now
        });

        await db.SaveChangesAsync();
        await tx.CommitAsync();

        return Results.Ok(new
        {
            ok = true,
            userId = user.Id,
            previousBalance,
            newBalance = user.Balance,
            message = previousBalance == 0m
                ? "El usuario ya tenia saldo 0. Se registro la operacion."
                : "Saldo del usuario reseteado a 0."
        });
    }

    private static async Task<IResult> ResetAllUserBalancesAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var (op, fail) = await RequireAdmin(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        await using var tx = await db.Database.BeginTransactionAsync();

        var usersToReset = await db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.Balance != 0m)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.Balance
            })
            .ToListAsync();

        var totalPreviousBalance = usersToReset.Sum(u => u.Balance);
        var now = DateTimeProvider.NowMexico();

        db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            Action = "USER_BALANCE_RESET_ALL_SUMMARY",
            UserId = null,
            OperatorId = op.Id,
            PreviousValue = totalPreviousBalance,
            NewValue = 0m,
            Note = $"Reset general de saldos. Usuarios afectados: {usersToReset.Count}.",
            CreatedAt = now
        });

        foreach (var user in usersToReset)
        {
            db.AuditLogs.Add(new AuditLog
            {
                TenantId = tenantId,
                Action = "USER_BALANCE_RESET_ALL_DETAIL",
                UserId = user.Id,
                OperatorId = op.Id,
                PreviousValue = user.Balance,
                NewValue = 0m,
                Note = $"Reset general de saldo para usuario #{user.Id} ({user.Name}).",
                CreatedAt = now
            });
        }

        await db.SaveChangesAsync();

        var affectedUsers = await db.Users
            .Where(u => u.TenantId == tenantId && u.Balance != 0m)
            .ExecuteUpdateAsync(setters => setters.SetProperty(u => u.Balance, 0m));

        await tx.CommitAsync();

        return Results.Ok(new
        {
            ok = true,
            affectedUsers,
            totalPreviousBalance,
            message = affectedUsers == 0
                ? "No habia usuarios con saldo distinto de 0. Se registro la operacion."
                : $"Saldo reseteado a 0 para {affectedUsers} usuarios."
        });
    }

    private static async Task<(Operator? op, IResult? fail)> RequireAdmin(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        if (op.Role != OperatorRole.SuperAdmin && op.Role != OperatorRole.Admin)
        {
            return (op, Results.Json(new { message = "Forbidden. Requiere rol Admin o SuperAdmin." }, statusCode: 403));
        }

        return (op, null);
    }
}
