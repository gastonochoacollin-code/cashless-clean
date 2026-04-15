namespace Cashless.Api.Endpoints;

using Cashless.Api.Data;
using Cashless.Api.Dtos.Auth;
using Cashless.Api.Models;
using Cashless.Api.Services.Auth;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

public static class AuthEndpoints
{
    internal sealed class AuthEndpointsMarker {}

    public static WebApplication MapAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/ops", (CashlessContext db, HttpContext http, IAuthService auth, ILogger<AuthEndpointsMarker> logger) =>
            GetOperatorsAsync(db, http, auth, logger));

        app.MapGet("/api/auth/ops", (CashlessContext db, HttpContext http, IAuthService auth, ILogger<AuthEndpointsMarker> logger) =>
            GetOperatorsAsync(db, http, auth, logger));

        // Public endpoint for login operators list
        app.MapGet("/api/auth/operators", (CashlessContext db, HttpContext http, IAuthService auth, ILogger<AuthEndpointsMarker> logger) =>
            GetLoginOperatorsAsync(db, http, auth, logger));

        app.MapGet("/areas", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var tenantId = await ResolveTenantId(db, auth, http.Request);
            if (!tenantId.HasValue)
                return Results.BadRequest(new { message = "TenantId requerido" });

            var list = await db.Areas
                .Where(a => a.IsActive && a.TenantId == tenantId.Value)
                .OrderBy(a => a.Name)
                .Select(a => new { a.Id, a.Name, type = a.Type.ToString() })
                .ToListAsync();

            return Results.Ok(list);
        });

        app.MapPost("/auth/login", (CashlessContext db, HttpContext http, LoginRequest req, IAuthService auth, ILogger<AuthEndpointsMarker> logger, IWebHostEnvironment env) =>
            LoginAsync(db, http, req, auth, logger, env));

        app.MapPost("/api/auth/login", (CashlessContext db, HttpContext http, LoginRequest req, IAuthService auth, ILogger<AuthEndpointsMarker> logger, IWebHostEnvironment env) =>
            LoginAsync(db, http, req, auth, logger, env));

        return app;
    }

    private static async Task<(int? tenantId, bool isSingleTenant, bool usedHeader)> ResolveTenantContextAsync(
        CashlessContext db,
        IAuthService auth,
        HttpRequest req)
    {
        var tenantId = auth.ReadTenantId(req);
        if (tenantId.HasValue) return (tenantId, false, true);

        var ids = await db.Tenants
            .OrderBy(t => t.Id)
            .Select(t => t.Id)
            .Take(2)
            .ToListAsync();
        if (ids.Count == 1) return (ids[0], true, false);

        return (null, false, false);
    }

    private static async Task<int?> ResolveTenantId(CashlessContext db, IAuthService auth, HttpRequest req)
    {
        var (tenantId, _, _) = await ResolveTenantContextAsync(db, auth, req);
        return tenantId;
    }

    private static async Task<(int? tenantId, bool isSingleTenant, bool usedHeader, bool usedQuery)> ResolveTenantForPublicListAsync(
        CashlessContext db,
        IAuthService auth,
        HttpRequest req)
    {
        var headerTenantId = auth.ReadTenantId(req);
        if (headerTenantId.HasValue) return (headerTenantId, false, true, false);

        var queryTenantRaw = req.Query["tenantId"].FirstOrDefault();
        if (int.TryParse(queryTenantRaw, out var queryTenantId))
            return (queryTenantId, false, false, true);

        var ids = await db.Tenants
            .OrderBy(t => t.Id)
            .Select(t => t.Id)
            .Take(2)
            .ToListAsync();
        if (ids.Count == 1) return (ids[0], true, false, false);

        return (null, false, false, false);
    }

    private static async Task<IResult> GetOperatorsAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        ILogger<AuthEndpointsMarker> logger)
    {
        var (tenantId, isSingleTenant, usedHeader) = await ResolveTenantContextAsync(db, auth, http.Request);
        if (!tenantId.HasValue)
            return Results.BadRequest(new { message = "X-Tenant-Id requerido" });

        var query = db.Operators
            .Include(o => o.Area)
            .Where(o => o.IsActive);

        var allowLegacy = isSingleTenant && !usedHeader;
        if (allowLegacy)
            query = query.Where(o => o.TenantId == tenantId.Value || o.TenantId == 0);
        else
            query = query.Where(o => o.TenantId == tenantId.Value);

        var list = await query
            .OrderBy(o => o.Name)
            .Select(o => new
            {
                id = o.Id,
                name = o.Name,
                role = o.Role.ToString(),
                areaId = o.AreaId,
                areaName = o.Area != null ? o.Area.Name : null
            })
            .ToListAsync();

        if (allowLegacy && list.Any(o => true))
        {
            logger.LogWarning("Legacy operators (TenantId=0) included in ops list for single-tenant login.");
        }

        return Results.Ok(list);
    }

    private static async Task<IResult> GetLoginOperatorsAsync(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        ILogger<AuthEndpointsMarker> logger)
    {
        var (tenantId, isSingleTenant, usedHeader, usedQuery) = await ResolveTenantForPublicListAsync(db, auth, http.Request);
        if (!tenantId.HasValue)
        {
            var tenants = await db.Tenants
                .OrderBy(t => t.Id)
                .Select(t => new { t.Id, t.Name })
                .ToListAsync();
            return Results.BadRequest(new { message = "Tenant requerido", tenants });
        }

        var query = db.Operators
            .Include(o => o.Area)
            .Where(o => o.IsActive);

        var allowLegacy = isSingleTenant && !usedHeader && !usedQuery;
        if (allowLegacy)
            query = query.Where(o => o.TenantId == tenantId.Value || o.TenantId == 0);
        else
            query = query.Where(o => o.TenantId == tenantId.Value);

        var list = await query
            .OrderBy(o => o.Name)
            .Select(o => new
            {
                id = o.Id,
                name = o.Name,
                role = o.Role.ToString(),
                areaId = o.AreaId,
                areaName = o.Area != null ? o.Area.Name : null,
                isActive = o.IsActive,
                tenantId = o.TenantId
            })
            .ToListAsync();

        logger.LogInformation("Login operators list: tenantId={TenantId}, count={Count}, legacy={Legacy}",
            tenantId.Value, list.Count, allowLegacy);

        return Results.Ok(list);
    }

    private static async Task<IResult> LoginAsync(
        CashlessContext db,
        HttpContext http,
        LoginRequest req,
        IAuthService auth,
        ILogger<AuthEndpointsMarker> logger,
        IWebHostEnvironment env)
    {
        var pin = req.Pin?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(pin))
        {
            if (env.IsDevelopment())
                logger.LogInformation("Login rejected: missing PIN.");

            return Results.BadRequest(new { message = "PIN requerido" });
        }

        var operatorInput = req.Operator?.Trim();
        var operatorName = req.OperatorName?.Trim();
        var operatorId = req.OperatorId;

        if (string.IsNullOrWhiteSpace(operatorInput) && string.IsNullOrWhiteSpace(operatorName) && !operatorId.HasValue)
        {
            if (env.IsDevelopment())
                logger.LogInformation("Login rejected: missing operator input.");

            return Results.BadRequest(new { message = "Operador requerido" });
        }

        var (tenantId, isSingleTenant, usedHeader) = await ResolveTenantContextAsync(db, auth, http.Request);
        if (!tenantId.HasValue)
        {
            if (env.IsDevelopment())
                logger.LogInformation("Login rejected: missing tenant. operator={Operator}", operatorInput);

            return Results.BadRequest(new { message = "TenantId requerido" });
        }

        if (env.IsDevelopment())
            logger.LogInformation("Login attempt: tenantId={TenantId}, operator={Operator}, singleTenant={SingleTenant}, usedHeader={UsedHeader}",
                tenantId.Value, operatorInput ?? operatorName ?? (operatorId?.ToString() ?? ""), isSingleTenant, usedHeader);

        var query = db.Operators
            .Include(o => o.Area)
            .Where(o => o.IsActive);

        var allowLegacy = isSingleTenant && !usedHeader;
        if (allowLegacy)
            query = query.Where(o => o.TenantId == tenantId.Value || o.TenantId == 0);
        else
            query = query.Where(o => o.TenantId == tenantId.Value);

        Operator? op;
        if (operatorId.HasValue)
        {
            op = await query.FirstOrDefaultAsync(o => o.Id == operatorId.Value);
        }
        else if (!string.IsNullOrWhiteSpace(operatorName))
        {
            var nameNormalized = operatorName.ToLowerInvariant();
            op = await query.FirstOrDefaultAsync(o => o.Name != null && o.Name.Trim().ToLower() == nameNormalized);
        }
        else if (int.TryParse(operatorInput, out var parsedId))
        {
            op = await query.FirstOrDefaultAsync(o => o.Id == parsedId);
        }
        else
        {
            var nameNormalized = operatorInput!.ToLowerInvariant();
            op = await query.FirstOrDefaultAsync(o => o.Name != null && o.Name.Trim().ToLower() == nameNormalized);
        }

        if (op is null)
        {
            if (env.IsDevelopment())
                logger.LogInformation("Login rejected: operator not found or inactive. tenantId={TenantId}, operator={Operator}",
                    tenantId.Value, operatorInput);

            return Results.NotFound(new { message = "Operador no encontrado" });
        }

        if (env.IsDevelopment())
            logger.LogInformation("Login operator match: tenantId={TenantId}, operatorId={OperatorId}, name={OperatorName}",
                tenantId.Value, op.Id, op.Name);

        if (!auth.ValidatePin(pin, op.PinHash))
        {
            if (env.IsDevelopment())
                logger.LogInformation("Login rejected: invalid PIN. tenantId={TenantId}, operatorId={OperatorId}",
                    tenantId.Value, op.Id);

            return Results.Json(new { message = "NIP incorrecto" }, statusCode: StatusCodes.Status401Unauthorized);
        }

        var token = auth.MakeToken(op.Id, op.PinHash);

        if (env.IsDevelopment())
            logger.LogInformation("Login success: tenantId={TenantId}, operatorId={OperatorId}",
                tenantId.Value, op.Id);

        return Results.Ok(new
        {
            operatorId = op.Id,
            name = op.Name,
            role = op.Role.ToString(),
            areaId = op.AreaId,
            area = op.Area != null ? op.Area.Name : null,
            tenantId = op.TenantId,
            token,
            operatorToken = token
        });
    }
}
