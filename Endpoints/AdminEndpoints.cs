namespace Cashless.Api.Endpoints;

using Cashless.Api.Data;
using Cashless.Api.Dtos.Admin;
using Cashless.Api.Models;
using Cashless.Api.Services.Auth;
using Microsoft.EntityFrameworkCore;

public static class AdminEndpoints
{
    private static readonly string[] PERM_CATALOG = new[]
    {
        "dashboard.view",
        "pos.charge",
        "pos.topup",
        "users.view",
        "users.create",
        "users.edit",
        "cards.assign",
        "areas.view",
        "areas.manage",
        "products.view",
        "products.manage",
        "menus.manage",
        "operators.view",
        "operators.manage",
        "permissions.view",
        "permissions.manage"
    };

    private static readonly Dictionary<OperatorRole, HashSet<string>> ROLE_PERMS = new()
    {
        [OperatorRole.SuperAdmin] = new HashSet<string>(PERM_CATALOG, StringComparer.OrdinalIgnoreCase),

        [OperatorRole.Admin] = new HashSet<string>(new[]
        {
            "dashboard.view",
            "pos.charge","pos.topup",
            "users.view","users.create","users.edit","cards.assign",
            "areas.view","areas.manage",
            "products.view","products.manage",
            "menus.manage",
            "operators.view","operators.manage",
            "permissions.view"
        }, StringComparer.OrdinalIgnoreCase),

        [OperatorRole.JefeOperativo] = new HashSet<string>(new[]
        {
            "dashboard.view",
            "pos.charge","pos.topup",
            "users.view","users.create","users.edit","cards.assign",
            "areas.view",
            "products.view",
            "permissions.view"
        }, StringComparer.OrdinalIgnoreCase),

        [OperatorRole.JefeDeBarra] = new HashSet<string>(new[]
        {
            "dashboard.view",
            "pos.charge",
            "users.view",
            "areas.view",
            "products.view"
        }, StringComparer.OrdinalIgnoreCase),

        [OperatorRole.JefeDeStand] = new HashSet<string>(new[]
        {
            "dashboard.view",
            "pos.charge",
            "users.view",
            "areas.view",
            "products.view"
        }, StringComparer.OrdinalIgnoreCase),

        [OperatorRole.Bartender] = new HashSet<string>(new[]
        {
            "pos.charge"
        }, StringComparer.OrdinalIgnoreCase),

        [OperatorRole.Cajero] = new HashSet<string>(new[]
        {
            "dashboard.view",
            "pos.topup",
            "users.view",
            "users.create",
            "cards.assign"
        }, StringComparer.OrdinalIgnoreCase),
    };

    public static WebApplication MapAdminEndpoints(this WebApplication app)
    {
        static Task<IResult> GetUsers(CashlessContext db, HttpContext http, IAuthService auth)
            => HandleGetUsers(db, http, auth);
        static Task<IResult> GetUserById(CashlessContext db, HttpContext http, IAuthService auth, int id)
            => HandleGetUserById(db, http, auth, id);
        static Task<IResult> CreateUser(CashlessContext db, HttpContext http, IAuthService auth, CreateUserRequest req)
            => HandleCreateUser(db, http, auth, req);
        static Task<IResult> UpdateUserContact(CashlessContext db, HttpContext http, IAuthService auth, int id, UpdateUserContactRequest req)
            => HandleUpdateUserContact(db, http, auth, id, req);
        static Task<IResult> GetUsersCount(CashlessContext db, HttpContext http, IAuthService auth)
            => HandleGetUsersCount(db, http, auth);
        static Task<IResult> GetUsersSummary(CashlessContext db, HttpContext http, IAuthService auth)
            => HandleGetUsersSummary(db, http, auth);

        app.MapGet("/api/operators/{id:int}/areas", async Task<IResult> (int id, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var list = await db.OperatorAreas
                .Include(x => x.Area)
                .Where(x => x.OperatorId == id && x.IsActive && x.TenantId == tenantId)
                .Select(x => new
                {
                    x.Id,
                    x.OperatorId,
                    x.AreaId,
                    areaName = x.Area != null ? x.Area.Name : null,
                    x.IsActive
                })
                .ToListAsync();

            return Results.Ok(list);
        });

        app.MapPost("/api/operators/{id:int}/areas", async Task<IResult> (int id, OperatorArea dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var operatorExists = await db.Operators.AnyAsync(o => o.Id == id && o.TenantId == tenantId);
            if (!operatorExists) return Results.NotFound(new { message = "Operador no existe" });

            var areaExists = await db.Areas.AnyAsync(a => a.Id == dto.AreaId && a.TenantId == tenantId);
            if (!areaExists) return Results.BadRequest(new { message = "AreaId inválido" });

            dto.OperatorId = id;
            dto.TenantId = tenantId;
            db.OperatorAreas.Add(dto);
            await db.SaveChangesAsync();
            return Results.Ok(dto);
        });

        // ===================== FESTIVALS - PROTEGIDO =====================
        app.MapGet("/api/festivals", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var list = await db.Festivals
                .Where(f => f.TenantId == tenantId)
                .OrderByDescending(f => f.Id)
                .Select(f => new
                {
                    f.Id,
                    f.Name,
                    f.StartDate,
                    f.EndDate,
                    f.IsActive
                })
                .ToListAsync();

            return Results.Ok(list);
        });

        // Festival list for cajero (read-only): active-only for non-admin/boss
        app.MapGet("/api/festivals/for-cashier", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;

            var isAdmin = op.Role == OperatorRole.Admin || op.Role == OperatorRole.SuperAdmin;
            var isBoss = op.Role == OperatorRole.JefeOperativo || op.Role == OperatorRole.JefeDeBarra || op.Role == OperatorRole.JefeDeStand;

            var query = db.Festivals.Where(f => f.TenantId == tenantId);
            if (!isAdmin && !isBoss)
                query = query.Where(f => f.IsActive);

            var list = await query
                .OrderByDescending(f => f.Id)
                .Select(f => new
                {
                    f.Id,
                    f.Name,
                    f.StartDate,
                    f.EndDate,
                    f.IsActive
                })
                .ToListAsync();

            return Results.Ok(list);
        });

        app.MapPost("/api/festivals", async Task<IResult> (FestivalCreateRequest dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            if (string.IsNullOrWhiteSpace(dto.Name))
                return Results.BadRequest(new { message = "Nombre requerido" });

            if (dto.StartDate == default || dto.EndDate == default)
                return Results.BadRequest(new { message = "Fechas inválidas" });

            if (dto.EndDate < dto.StartDate)
                return Results.BadRequest(new { message = "Rango de fechas inválido" });

            if (dto.IsActive)
            {
                var actives = await db.Festivals.Where(f => f.TenantId == tenantId && f.IsActive).ToListAsync();
                foreach (var f in actives) f.IsActive = false;
            }

            var festival = new Festival
            {
                Name = dto.Name.Trim(),
                StartDate = dto.StartDate,
                EndDate = dto.EndDate,
                IsActive = dto.IsActive,
                TenantId = tenantId
            };

            db.Festivals.Add(festival);
            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                festival.Id,
                festival.Name,
                festival.StartDate,
                festival.EndDate,
                festival.IsActive
            });
        });

        app.MapPost("/api/festivals/{id:int}/activate", async Task<IResult> (int id, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var target = await db.Festivals.FirstOrDefaultAsync(f => f.Id == id && f.TenantId == tenantId);
            if (target is null) return Results.NotFound(new { message = "Festival no existe" });

            var actives = await db.Festivals.Where(f => f.TenantId == tenantId && f.IsActive && f.Id != id).ToListAsync();
            foreach (var f in actives) f.IsActive = false;

            target.IsActive = true;
            await db.SaveChangesAsync();

            return Results.Ok(new { ok = true });
        });

        // ===================== RESET OPERATIVO (ADMIN) =====================
        app.MapPost("/api/admin/reset-ops", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;

            var cs = db.Database.GetDbConnection().ConnectionString ?? string.Empty;
            var dbPath = TryGetSqlitePath(cs);
            if (string.IsNullOrWhiteSpace(dbPath))
                return Results.BadRequest(new { message = "No se pudo determinar la ruta de la base de datos." });

            var fullDbPath = Path.GetFullPath(dbPath, AppContext.BaseDirectory);
            if (!System.IO.File.Exists(fullDbPath))
                return Results.BadRequest(new { message = $"No existe la base de datos en {fullDbPath}" });

            var backupDir = Path.Combine(AppContext.BaseDirectory, "backups");
            Directory.CreateDirectory(backupDir);
            var stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
            var backupPath = Path.Combine(backupDir, $"cashless_{stamp}.db");
            System.IO.File.Copy(fullDbPath, backupPath, overwrite: true);

            await using var tx = await db.Database.BeginTransactionAsync();

            var deletedSaleItems = await db.Database.ExecuteSqlRawAsync("DELETE FROM SaleItems;");
            var deletedSales = await db.Database.ExecuteSqlRawAsync("DELETE FROM Sales;");
            var deletedRecharges = await db.Database.ExecuteSqlRawAsync("DELETE FROM Recharges;");
            var deletedTransactions = await db.Database.ExecuteSqlRawAsync("DELETE FROM Transactions;");
            var deletedCardAudits = await db.Database.ExecuteSqlRawAsync("DELETE FROM CardAudits;");
            var deletedShifts = await db.Database.ExecuteSqlRawAsync("DELETE FROM Shifts;");
            var updatedUsers = await db.Database.ExecuteSqlRawAsync("UPDATE Users SET TotalSpent = 0;");

            await db.Database.ExecuteSqlRawAsync(@"
DELETE FROM sqlite_sequence WHERE name IN (
  'SaleItems','Sales','Recharges','Transactions','CardAudits','Shifts'
);");

            await tx.CommitAsync();

            return Results.Ok(new
            {
                ok = true,
                backup = backupPath,
                deleted = new
                {
                    saleItems = deletedSaleItems,
                    sales = deletedSales,
                    recharges = deletedRecharges,
                    transactions = deletedTransactions,
                    cardAudits = deletedCardAudits,
                    shifts = deletedShifts,
                    usersUpdated = updatedUsers
                }
            });
        });

        app.MapPut("/api/festivals/{id:int}", async Task<IResult> (int id, FestivalCreateRequest dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var target = await db.Festivals.FirstOrDefaultAsync(f => f.Id == id && f.TenantId == tenantId);
            if (target is null) return Results.NotFound(new { message = "Festival no existe" });

            if (string.IsNullOrWhiteSpace(dto.Name))
                return Results.BadRequest(new { message = "Nombre requerido" });

            if (dto.StartDate == default || dto.EndDate == default)
                return Results.BadRequest(new { message = "Fechas inválidas" });

            if (dto.EndDate < dto.StartDate)
                return Results.BadRequest(new { message = "Rango de fechas inválido" });

            if (dto.IsActive)
            {
                var actives = await db.Festivals.Where(f => f.TenantId == tenantId && f.IsActive && f.Id != id).ToListAsync();
                foreach (var f in actives) f.IsActive = false;
            }

            target.Name = dto.Name.Trim();
            target.StartDate = dto.StartDate;
            target.EndDate = dto.EndDate;
            if (dto.IsActive) target.IsActive = true;

            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                target.Id,
                target.Name,
                target.StartDate,
                target.EndDate,
                target.IsActive
            });
        });

        // ===================== AREAS (BARRAS) - PROTEGIDO (Type string + CustomType) =====================
        app.MapGet("/api/areas", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;

            var areas = await db.Areas
                .Where(a => a.TenantId == tenantId)
                .OrderBy(a => a.Name)
                .Select(a => new
                {
                    a.Id,
                    a.Name,
                    Type = a.Type.ToString(),
                    a.IsActive,
                    a.CustomType
                })
                .ToListAsync();

            return Results.Ok(areas);
        });

        app.MapPost("/api/areas", async Task<IResult> (AreaUpsertDto dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            if (string.IsNullOrWhiteSpace(dto.Name))
                return Results.BadRequest(new { message = "Name is required." });

            if (!Enum.TryParse<AreaType>(dto.Type ?? "Barra", true, out var parsedType))
                parsedType = AreaType.Barra;

            var area = new Area
            {
                Name = dto.Name.Trim(),
                Type = parsedType,
                IsActive = dto.IsActive,
                CustomType = string.IsNullOrWhiteSpace(dto.CustomType) ? null : dto.CustomType.Trim(),
                TenantId = tenantId
            };

            db.Areas.Add(area);
            await db.SaveChangesAsync();

            return Results.Created($"/api/areas/{area.Id}", new
            {
                area.Id,
                area.Name,
                Type = area.Type.ToString(),
                area.IsActive,
                area.CustomType
            });
        });

        app.MapPut("/api/areas/{id:int}", async Task<IResult> (int id, AreaUpsertDto dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var area = await db.Areas.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);
            if (area is null) return Results.NotFound(new { message = "Area no existe" });

            if (string.IsNullOrWhiteSpace(dto.Name))
                return Results.BadRequest(new { message = "Name is required." });

            if (!Enum.TryParse<AreaType>(dto.Type ?? "Barra", true, out var parsedType))
                parsedType = AreaType.Barra;

            area.Name = dto.Name.Trim();
            area.Type = parsedType;
            area.IsActive = dto.IsActive;
            area.CustomType = string.IsNullOrWhiteSpace(dto.CustomType) ? null : dto.CustomType.Trim();

            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                area.Id,
                area.Name,
                Type = area.Type.ToString(),
                area.IsActive,
                area.CustomType
            });
        });

        app.MapDelete("/api/areas/{id:int}", async Task<IResult> (int id, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var area = await db.Areas.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);
            if (area is null) return Results.NotFound(new { message = "Area no existe" });

            area.IsActive = false;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ===================== PRODUCTS - PROTEGIDO =====================
        app.MapGet("/api/products", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;

            var list = await db.Products
                .Where(p => p.TenantId == tenantId)
                .OrderByDescending(p => p.Id)
                .Select(p => new
                {
                    p.Id,
                    p.Name,
                    p.Price,
                    p.Category,
                    p.IsActive,
                    p.CreatedAt
                })
                .ToListAsync();

            return Results.Ok(list);
        });
        app.MapPost("/api/products", async Task<IResult> (ProductUpsertDto dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            if (string.IsNullOrWhiteSpace(dto.Name))
                return Results.BadRequest(new { message = "Nombre requerido" });

            if (dto.Price < 0)
                return Results.BadRequest(new { message = "Precio inválido" });

            var p = new Product
            {
                Name = dto.Name.Trim(),
                Price = dto.Price,
                Category = string.IsNullOrWhiteSpace(dto.Category) ? null : dto.Category.Trim(),
                IsActive = dto.IsActive,
                TenantId = tenantId
            };

            db.Products.Add(p);
            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                p.Id,
                p.Name,
                p.Price,
                p.Category,
                p.IsActive,
                p.CreatedAt
            });
        });

        app.MapPut("/api/products/{id:int}", async Task<IResult> (int id, ProductUpsertDto dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var p = await db.Products.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (p is null) return Results.NotFound(new { message = "Producto no existe" });

            if (string.IsNullOrWhiteSpace(dto.Name))
                return Results.BadRequest(new { message = "Nombre requerido" });

            if (dto.Price < 0)
                return Results.BadRequest(new { message = "Precio inválido" });

            p.Name = dto.Name.Trim();
            p.Price = dto.Price;
            p.Category = string.IsNullOrWhiteSpace(dto.Category) ? null : dto.Category.Trim();
            p.IsActive = dto.IsActive;

            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                p.Id,
                p.Name,
                p.Price,
                p.Category,
                p.IsActive,
                p.CreatedAt
            });
        });

        app.MapDelete("/api/products/{id:int}", async Task<IResult> (int id, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var p = await db.Products.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (p is null) return Results.NotFound(new { message = "Producto no existe" });

            p.IsActive = false;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ===================== MENU POR AREA (AreaProduct) - PROTEGIDO =====================
        app.MapGet("/api/areas/{areaId:int}/products", async Task<IResult> (int areaId, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;

            var area = await db.Areas.FirstOrDefaultAsync(a => a.Id == areaId && a.TenantId == tenantId);
            if (area is null) return Results.NotFound(new { message = "Area no existe" });

            var list = await db.AreaProducts
                .Include(ap => ap.Product)
                .Where(ap => ap.AreaId == areaId && ap.TenantId == tenantId)
                .OrderBy(ap => ap.Product.Name)
                .Select(ap => new
                {
                    ap.Id,
                    ap.AreaId,
                    ap.ProductId,
                    productName = ap.Product.Name,
                    basePrice = ap.Product.Price,
                    category = ap.Product.Category,
                    productIsActive = ap.Product.IsActive,
                    ap.PriceOverride,
                    effectivePrice = (ap.PriceOverride ?? ap.Product.Price),
                    ap.IsActive
                })
                .ToListAsync();

            return Results.Ok(list);
        });

        app.MapPost("/api/areas/{areaId:int}/products", async Task<IResult> (int areaId, AreaProductCreateDto dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var area = await db.Areas.FirstOrDefaultAsync(a => a.Id == areaId && a.TenantId == tenantId);
            if (area is null) return Results.NotFound(new { message = "Area no existe" });

            var product = await db.Products.FirstOrDefaultAsync(p => p.Id == dto.ProductId && p.TenantId == tenantId);
            if (product is null) return Results.NotFound(new { message = "Producto no existe" });

            var exists = await db.AreaProducts.AnyAsync(x => x.AreaId == areaId && x.ProductId == dto.ProductId && x.TenantId == tenantId);
            if (exists) return Results.BadRequest(new { message = "Ese producto ya está en el menú de esta barra." });

            if (dto.PriceOverride is not null && dto.PriceOverride < 0)
                return Results.BadRequest(new { message = "PriceOverride inválido" });

            var link = new AreaProduct
            {
                AreaId = areaId,
                ProductId = dto.ProductId,
                PriceOverride = dto.PriceOverride,
                IsActive = dto.IsActive,
                TenantId = tenantId
            };

            db.AreaProducts.Add(link);
            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                link.Id,
                link.AreaId,
                link.ProductId,
                productName = product.Name,
                basePrice = product.Price,
                category = product.Category,
                productIsActive = product.IsActive,
                link.PriceOverride,
                effectivePrice = (link.PriceOverride ?? product.Price),
                link.IsActive
            });
        });
        app.MapPut("/api/areas/{areaId:int}/products/{areaProductId:int}", async Task<IResult> (int areaId, int areaProductId, AreaProductUpdateDto dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var link = await db.AreaProducts
                .Include(x => x.Product)
                .FirstOrDefaultAsync(x => x.Id == areaProductId && x.AreaId == areaId && x.TenantId == tenantId);

            if (link is null) return Results.NotFound(new { message = "No existe ese producto en el menú de esta barra." });

            if (dto.PriceOverride is not null && dto.PriceOverride < 0)
                return Results.BadRequest(new { message = "PriceOverride inválido" });

            link.PriceOverride = dto.PriceOverride;
            link.IsActive = dto.IsActive;

            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                link.Id,
                link.AreaId,
                link.ProductId,
                productName = link.Product.Name,
                basePrice = link.Product.Price,
                category = link.Product.Category,
                productIsActive = link.Product.IsActive,
                link.PriceOverride,
                effectivePrice = (link.PriceOverride ?? link.Product.Price),
                link.IsActive
            });
        });

        app.MapDelete("/api/areas/{areaId:int}/products/{areaProductId:int}", async Task<IResult> (int areaId, int areaProductId, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var link = await db.AreaProducts.FirstOrDefaultAsync(x => x.Id == areaProductId && x.AreaId == areaId && x.TenantId == tenantId);
            if (link is null) return Results.NotFound(new { message = "No existe ese vínculo." });

            db.AreaProducts.Remove(link);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ===================== INVENTARIOS - PROTEGIDO =====================
        app.MapGet("/api/inventory/summary", async Task<IResult> (int? areaId, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            int? targetAreaId = areaId.HasValue && areaId.Value > 0 ? areaId.Value : null;
            if (targetAreaId.HasValue)
            {
                var areaExists = await db.Areas.AnyAsync(a => a.Id == targetAreaId.Value && a.TenantId == tenantId);
                if (!areaExists) return Results.NotFound(new { message = "Area no existe" });
            }

            var areaCatalog = await db.Areas
                .Where(a => a.TenantId == tenantId)
                .OrderBy(a => a.Name)
                .Select(a => new
                {
                    a.Id,
                    a.Name
                })
                .ToListAsync();
            var areaNameMap = areaCatalog.ToDictionary(x => x.Id, x => x.Name);

            var products = await db.Products
                .Where(p => p.TenantId == tenantId)
                .OrderBy(p => p.Name)
                .Select(p => new
                {
                    p.Id,
                    p.Name,
                    p.Category,
                    p.Price,
                    p.IsActive
                })
                .ToListAsync();

            var warehouseMovementSeed = await db.InventoryMovements
                .Where(m => m.TenantId == tenantId)
                .Select(m => new
                {
                    m.ProductId,
                    m.Direction,
                    m.Qty
                })
                .ToListAsync();
            var warehouseRows = warehouseMovementSeed
                .GroupBy(m => m.ProductId)
                .Select(g => new
                {
                    ProductId = g.Key,
                    Qty = g.Sum(x =>
                        x.Direction == "stock_in" ? x.Qty :
                        x.Direction == "to_warehouse" ? x.Qty :
                        x.Direction == "to_bar" ? -x.Qty : 0m)
                })
                .ToList();
            var warehouseMap = warehouseRows.ToDictionary(x => x.ProductId, x => x.Qty);

            Dictionary<int, decimal> barMap = new();
            Dictionary<int, int> soldMap = new();
            var menuSeed = new List<(int ProductId, string ProductName, decimal BasePrice, decimal? PriceOverride, bool IsActive)>();

            if (targetAreaId.HasValue)
            {
                var movedSeed = await db.InventoryMovements
                    .Where(m => m.TenantId == tenantId && m.AreaId == targetAreaId.Value)
                    .Select(m => new
                    {
                        m.ProductId,
                        m.Direction,
                        m.Qty
                    })
                    .ToListAsync();
                var movedRows = movedSeed
                    .GroupBy(m => m.ProductId)
                    .Select(g => new
                    {
                        ProductId = g.Key,
                        Qty = g.Sum(x =>
                            x.Direction == "to_bar" ? x.Qty :
                            x.Direction == "to_warehouse" ? -x.Qty : 0m)
                    })
                    .ToList();
                barMap = movedRows.ToDictionary(x => x.ProductId, x => x.Qty);

                var soldRows = await (
                    from item in db.SaleItems
                    join sale in db.Sales on item.SaleId equals sale.Id
                    where item.TenantId == tenantId
                        && sale.TenantId == tenantId
                        && sale.AreaId == targetAreaId.Value
                    group item by item.ProductId into g
                    select new
                    {
                        ProductId = g.Key,
                        Qty = g.Sum(x => x.Qty)
                    }
                ).ToListAsync();
                soldMap = soldRows.ToDictionary(x => x.ProductId, x => x.Qty);

                var rawMenuRows = await db.AreaProducts
                    .Include(ap => ap.Product)
                    .Where(ap => ap.TenantId == tenantId && ap.AreaId == targetAreaId.Value)
                    .OrderBy(ap => ap.Product.Name)
                    .Select(ap => new
                    {
                        ap.ProductId,
                        productName = ap.Product.Name,
                        basePrice = ap.Product.Price,
                        ap.PriceOverride,
                        ap.IsActive
                    })
                    .ToListAsync();
                menuSeed = rawMenuRows
                    .Select(x => (x.ProductId, x.productName, x.basePrice, x.PriceOverride, x.IsActive))
                    .ToList();
            }

            var snapshotMovementSeed = await db.InventoryMovements
                .Where(m => m.TenantId == tenantId && m.AreaId.HasValue)
                .Select(m => new
                {
                    AreaId = m.AreaId!.Value,
                    m.ProductId,
                    m.Direction,
                    m.Qty
                })
                .ToListAsync();
            var snapshotMovementRows = snapshotMovementSeed
                .GroupBy(m => new { m.AreaId, m.ProductId })
                .Select(g => new
                {
                    g.Key.AreaId,
                    g.Key.ProductId,
                    Qty = g.Sum(x =>
                        x.Direction == "to_bar" ? x.Qty :
                        x.Direction == "to_warehouse" ? -x.Qty : 0m)
                })
                .ToList();

            var snapshotSoldRows = await (
                from item in db.SaleItems
                join sale in db.Sales on item.SaleId equals sale.Id
                where item.TenantId == tenantId
                    && sale.TenantId == tenantId
                    && sale.AreaId.HasValue
                group item by new { AreaId = sale.AreaId!.Value, item.ProductId } into g
                select new
                {
                    g.Key.AreaId,
                    g.Key.ProductId,
                    Qty = g.Sum(x => x.Qty)
                }
            ).ToListAsync();

            var snapshotMovementMap = snapshotMovementRows.ToDictionary(
                x => $"{x.AreaId}:{x.ProductId}",
                x => x.Qty);
            var snapshotSoldMap = snapshotSoldRows.ToDictionary(
                x => $"{x.AreaId}:{x.ProductId}",
                x => x.Qty);

            var snapshotKeys = new HashSet<string>(snapshotMovementMap.Keys, StringComparer.Ordinal);
            snapshotKeys.UnionWith(snapshotSoldMap.Keys);

            var snapshot = snapshotKeys
                .Select(key =>
                {
                    var parts = key.Split(':', 2);
                    var snapAreaId = int.Parse(parts[0]);
                    var snapProductId = int.Parse(parts[1]);
                    var warehouseAvailable = warehouseMap.TryGetValue(snapProductId, out var warehouseQty)
                        ? warehouseQty
                        : 0m;
                    var assigned = snapshotMovementMap.TryGetValue(key, out var barQty)
                        ? barQty
                        : 0m;
                    var sold = snapshotSoldMap.TryGetValue(key, out var soldQty)
                        ? soldQty
                        : 0;
                    return new
                    {
                        areaId = snapAreaId,
                        areaName = areaNameMap.TryGetValue(snapAreaId, out var snapAreaName) ? snapAreaName : $"Area {snapAreaId}",
                        productId = snapProductId,
                        productName = products.FirstOrDefault(p => p.Id == snapProductId)?.Name ?? $"Producto {snapProductId}",
                        warehouseQty = Math.Max(0m, warehouseAvailable),
                        soldQty = Math.Max(0, sold),
                        barQty = Math.Max(0m, assigned - sold)
                    };
                })
                .OrderBy(x => x.areaId)
                .ThenBy(x => x.productId)
                .ToList();

            var warehouse = products.Select(p => new
            {
                p.Id,
                p.Name,
                p.Category,
                p.Price,
                p.IsActive,
                qty = Math.Max(0m, warehouseMap.TryGetValue(p.Id, out var qty) ? qty : 0m)
            }).ToList();

            var menu = menuSeed.Select(item =>
            {
                var productId = item.ProductId;
                var moved = barMap.TryGetValue(productId, out var movedQty) ? movedQty : 0m;
                var sold = soldMap.TryGetValue(productId, out var soldQty) ? soldQty : 0;
                return new
                {
                    productId,
                    productName = item.ProductName,
                    basePrice = item.BasePrice,
                    priceOverride = item.PriceOverride,
                    soldQty = Math.Max(0, sold),
                    qty = Math.Max(0m, moved - sold),
                    isActive = item.IsActive
                };
            }).ToList();

            return Results.Ok(new
            {
                areaId = targetAreaId,
                areas = areaCatalog,
                warehouse,
                menu,
                snapshot,
                totals = new
                {
                    products = products.Count,
                    warehouseUnits = warehouse.Sum(x => x.qty),
                    barUnits = menu.Sum(x => x.qty)
                }
            });
        });

        app.MapGet("/api/inventory/movements", async Task<IResult> (string? from, string? to, int? areaId, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var fromDt = TryParseDateStart(from);
            var toDt = TryParseDateEnd(to);

            var query = db.InventoryMovements
                .Include(m => m.Area)
                .Include(m => m.Product)
                .Include(m => m.Operator)
                .Where(m => m.TenantId == tenantId);

            if (fromDt.HasValue) query = query.Where(m => m.CreatedAt >= fromDt.Value);
            if (toDt.HasValue) query = query.Where(m => m.CreatedAt <= toDt.Value);
            if (areaId.HasValue && areaId.Value > 0)
                query = query.Where(m => m.AreaId == areaId.Value);

            var rows = await query
                .OrderByDescending(m => m.CreatedAt)
                .Select(m => new
                {
                    m.Id,
                    m.CreatedAt,
                    m.Direction,
                    m.AreaId,
                    areaName = m.Area != null ? m.Area.Name : "Almacen",
                    m.ProductId,
                    productName = m.Product.Name,
                    m.Qty,
                    m.OperatorId,
                    operatorName = m.Operator.Name,
                    m.Comment
                })
                .ToListAsync();

            return Results.Ok(rows);
        });

        app.MapPost("/api/inventory/warehouse-in", async Task<IResult> (InventoryMovementUpsertDto dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            if (dto.ProductId <= 0) return Results.BadRequest(new { message = "Producto requerido" });
            if (dto.Qty <= 0) return Results.BadRequest(new { message = "Cantidad invalida" });

            var product = await db.Products.FirstOrDefaultAsync(p => p.Id == dto.ProductId && p.TenantId == tenantId);
            if (product is null) return Results.NotFound(new { message = "Producto no existe" });

            var movement = new InventoryMovement
            {
                TenantId = tenantId,
                ProductId = dto.ProductId,
                AreaId = null,
                Qty = dto.Qty,
                Direction = "stock_in",
                OperatorId = op.Id,
                Comment = string.IsNullOrWhiteSpace(dto.Comment) ? null : dto.Comment.Trim(),
                CreatedAt = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico()
            };

            db.InventoryMovements.Add(movement);
            await db.SaveChangesAsync();
            return Results.Ok(new { movement.Id, movement.Direction, movement.Qty, movement.ProductId });
        });

        app.MapPost("/api/inventory/transfer", async Task<IResult> (InventoryMovementUpsertDto dto, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireBarManager(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var direction = string.Equals(dto.Direction, "to_warehouse", StringComparison.OrdinalIgnoreCase)
                ? "to_warehouse"
                : "to_bar";

            if (dto.ProductId <= 0) return Results.BadRequest(new { message = "Producto requerido" });
            if (dto.AreaId is null || dto.AreaId.Value <= 0) return Results.BadRequest(new { message = "Area requerida" });
            if (dto.Qty <= 0) return Results.BadRequest(new { message = "Cantidad invalida" });

            var area = await db.Areas.FirstOrDefaultAsync(a => a.Id == dto.AreaId.Value && a.TenantId == tenantId);
            if (area is null) return Results.NotFound(new { message = "Area no existe" });

            var product = await db.Products.FirstOrDefaultAsync(p => p.Id == dto.ProductId && p.TenantId == tenantId);
            if (product is null) return Results.NotFound(new { message = "Producto no existe" });

            var inMenu = await db.AreaProducts.AnyAsync(ap =>
                ap.TenantId == tenantId &&
                ap.AreaId == dto.AreaId.Value &&
                ap.ProductId == dto.ProductId);
            if (!inMenu) return Results.BadRequest(new { message = "El producto no esta activo en el menu de esa barra." });

            var warehouseSeed = await db.InventoryMovements
                .Where(m => m.TenantId == tenantId && m.ProductId == dto.ProductId)
                .Select(m => new
                {
                    m.Direction,
                    m.Qty
                })
                .ToListAsync();
            var warehouseQty = warehouseSeed
                .Select(m =>
                    m.Direction == "stock_in" ? m.Qty :
                    m.Direction == "to_warehouse" ? m.Qty :
                    m.Direction == "to_bar" ? -m.Qty : 0m)
                .DefaultIfEmpty(0m)
                .Sum();

            var movedSeedForArea = await db.InventoryMovements
                .Where(m => m.TenantId == tenantId && m.ProductId == dto.ProductId && m.AreaId == dto.AreaId.Value)
                .Select(m => new
                {
                    m.Direction,
                    m.Qty
                })
                .ToListAsync();
            var movedToArea = movedSeedForArea
                .Select(m =>
                    m.Direction == "to_bar" ? m.Qty :
                    m.Direction == "to_warehouse" ? -m.Qty : 0m)
                .DefaultIfEmpty(0m)
                .Sum();

            var soldQty = await (
                from item in db.SaleItems
                join sale in db.Sales on item.SaleId equals sale.Id
                where item.TenantId == tenantId
                    && sale.TenantId == tenantId
                    && sale.AreaId == dto.AreaId.Value
                    && item.ProductId == dto.ProductId
                select (int?)item.Qty
            ).SumAsync() ?? 0;

            var availableBarQty = Math.Max(0m, movedToArea - soldQty);

            if (direction == "to_bar" && warehouseQty < dto.Qty)
                return Results.BadRequest(new { message = "No hay suficiente inventario en almacen." });

            if (direction == "to_warehouse" && availableBarQty < dto.Qty)
                return Results.BadRequest(new { message = "No hay suficiente inventario disponible en la barra." });

            var movement = new InventoryMovement
            {
                TenantId = tenantId,
                ProductId = dto.ProductId,
                AreaId = dto.AreaId.Value,
                Qty = dto.Qty,
                Direction = direction,
                OperatorId = op.Id,
                Comment = string.IsNullOrWhiteSpace(dto.Comment) ? null : dto.Comment.Trim(),
                CreatedAt = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico()
            };

            db.InventoryMovements.Add(movement);
            await db.SaveChangesAsync();
            return Results.Ok(new { movement.Id, movement.Direction, movement.Qty, movement.ProductId, movement.AreaId });
        });

        // ===================== OPERATORS (COLABORADORES) - PROTEGIDO =====================
        app.MapGet("/api/operators", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            var tenantId = op!.TenantId;

            var list = await db.Operators
                .Include(o => o.Area)
                .Where(o => o.TenantId == tenantId)
                .OrderBy(o => o.Id)
                .Select(o => new
                {
                    o.Id,
                    o.Name,
                    Role = o.Role.ToString(),
                    o.AreaId,
                    Area = o.Area != null ? o.Area.Name : null,
                    o.IsActive
                })
                .ToListAsync();

            return Results.Ok(list);
        });

        app.MapPost("/api/operators", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth, OperatorUpsertDto dto) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            if (!CanManageOperators(op!)) return Forbidden("No tienes permisos para crear colaboradores.");
            var tenantId = op!.TenantId;

            if (string.IsNullOrWhiteSpace(dto.Name))
                return Results.BadRequest(new { message = "Nombre requerido" });

            if (string.IsNullOrWhiteSpace(dto.Pin) || dto.Pin.Trim().Length < 4)
                return Results.BadRequest(new { message = "PIN requerido (mínimo 4 dígitos)" });

            var createRole = NormalizeOperatorRoleInput(dto.Role ?? "JefeDeBarra");
            if (!Enum.TryParse<OperatorRole>(createRole, true, out var parsedRole))
                parsedRole = OperatorRole.JefeDeBarra;

            if (parsedRole == OperatorRole.SuperAdmin && op.Role != OperatorRole.SuperAdmin)
                return Forbidden("Solo SuperAdmin puede crear otro SuperAdmin.");

            int areaId = dto.AreaId ?? 0;
            if (areaId <= 0)
                areaId = await db.Areas.Where(a => a.TenantId == tenantId).OrderBy(a => a.Id).Select(a => a.Id).FirstOrDefaultAsync();

            if (areaId <= 0) return Results.BadRequest(new { message = "No hay Areas creadas para asignar." });

            var areaExists = await db.Areas.AnyAsync(a => a.Id == areaId && a.TenantId == tenantId);
            if (!areaExists) return Results.BadRequest(new { message = "AreaId inválido" });

            var entity = new Operator
            {
                Name = dto.Name.Trim(),
                Role = parsedRole,
                AreaId = areaId,
                PinHash = auth.HashPin(dto.Pin.Trim()),
                IsActive = dto.IsActive,
                TenantId = tenantId
            };

            db.Operators.Add(entity);
            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                entity.Id,
                entity.Name,
                Role = entity.Role.ToString(),
                entity.AreaId,
                entity.IsActive
            });
        });

        app.MapPut("/api/operators/{id:int}", async Task<IResult> (int id, CashlessContext db, HttpContext http, IAuthService auth, OperatorUpsertDto dto) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            if (!CanManageOperators(op!)) return Forbidden("No tienes permisos para editar colaboradores.");
            var tenantId = op!.TenantId;

            var target = await db.Operators.FirstOrDefaultAsync(o => o.Id == id && o.TenantId == tenantId);
            if (target is null) return Results.NotFound(new { message = "Operador no existe" });

            if (string.IsNullOrWhiteSpace(dto.Name))
                return Results.BadRequest(new { message = "Nombre requerido" });

            var updateRole = NormalizeOperatorRoleInput(dto.Role ?? target.Role.ToString());
            if (!Enum.TryParse<OperatorRole>(updateRole, true, out var parsedRole))
                parsedRole = target.Role;

            if (parsedRole == OperatorRole.SuperAdmin && op.Role != OperatorRole.SuperAdmin)
                return Forbidden("Solo SuperAdmin puede asignar rol SuperAdmin.");

            if ((target.Role == OperatorRole.SuperAdmin || target.Role == OperatorRole.Admin) && op.Role != OperatorRole.SuperAdmin)
                return Forbidden("Solo SuperAdmin puede editar Admin/SuperAdmin.");

            target.Name = dto.Name.Trim();
            target.Role = parsedRole;
            target.IsActive = dto.IsActive;

            if (dto.AreaId.HasValue && dto.AreaId.Value > 0)
            {
                var areaExists = await db.Areas.AnyAsync(a => a.Id == dto.AreaId.Value && a.TenantId == tenantId);
                if (!areaExists) return Results.BadRequest(new { message = "AreaId inválido" });
                target.AreaId = dto.AreaId.Value;
            }

            if (!string.IsNullOrWhiteSpace(dto.Pin))
                target.PinHash = auth.HashPin(dto.Pin.Trim());

            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                target.Id,
                target.Name,
                Role = target.Role.ToString(),
                target.AreaId,
                target.IsActive
            });
        });

        app.MapDelete("/api/operators/{id:int}", async Task<IResult> (int id, CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;
            if (!CanManageOperators(op!)) return Forbidden("No tienes permisos para desactivar colaboradores.");
            var tenantId = op!.TenantId;

            var target = await db.Operators.FirstOrDefaultAsync(o => o.Id == id && o.TenantId == tenantId);
            if (target is null) return Results.NotFound(new { message = "Operador no existe" });

            if (target.Id == op.Id)
                return Results.BadRequest(new { message = "No puedes desactivarte a ti mismo." });

            if (!CanDeleteOperator(op, target))
                return Forbidden("No tienes permisos para desactivar ese rol.");

            target.IsActive = false;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
        // ===================== PROTEGIDO: Cards lookup =====================
        async Task<IResult> CardLookup(CashlessContext db, HttpContext http, IAuthService auth, string uid)
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;

            var clean = NormalizeUid(uid);
            if (string.IsNullOrWhiteSpace(clean))
                return Results.BadRequest(new { message = "UID requerido" });

            var card = await db.Cards
                .Include(c => c.User)
                .FirstOrDefaultAsync(c => c.Uid == clean && c.TenantId == tenantId && c.User.TenantId == tenantId);

            if (card is null) return Results.NotFound(new { message = "Card no existe (no asignada)" });

            return Results.Ok(new
            {
                card.Id,
                card.Uid,
                userId = card.UserId,
                userName = card.User.Name,
                balance = card.User.Balance
            });
        }

        app.MapGet("/cards/{uid}", CardLookup);
        app.MapGet("/api/cards/{uid}", CardLookup);

        // ===================== PROTEGIDO: Users + assign card =====================
        app.MapGet("/users", GetUsers);
        app.MapGet("/users/{id:int}", GetUserById);
        app.MapPost("/users", CreateUser);
        app.MapGet("/users/count", GetUsersCount);
        app.MapGet("/users/summary", GetUsersSummary);
        app.MapGet("/api/users", GetUsers);
        app.MapGet("/api/users/{id:int}", GetUserById);
        app.MapPost("/api/users", CreateUser);
        app.MapGet("/api/users/count", GetUsersCount);
        app.MapGet("/api/users/summary", GetUsersSummary);

        async Task<IResult> AssignCard(CashlessContext db, HttpContext http, IAuthService auth, AssignCardRequest req)
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            if (op.Role != OperatorRole.Cajero)
                return Results.Json(new { message = "Forbidden. Solo Cajero puede asignar pulseras." }, statusCode: 403);
            var tenantId = op.TenantId;

            if (req.UserId <= 0) return Results.BadRequest(new { message = "UserId invalido" });
            var uid = NormalizeUid(req.Uid);
            if (string.IsNullOrWhiteSpace(uid)) return Results.BadRequest(new { message = "UID requerido" });

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == req.UserId && u.TenantId == tenantId);
            if (user is null) return Results.NotFound(new { message = "Usuario no existe" });

            var existingByUid = await db.Cards
                .Include(c => c.User)
                .FirstOrDefaultAsync(c => c.Uid == uid && c.TenantId == tenantId);
            if (existingByUid is not null)
            {
                if (existingByUid.UserId == user.Id)
                    return Results.Ok(new { ok = true, userId = user.Id, uid });

                var owner = existingByUid.User?.Name ?? $"UserId {existingByUid.UserId}";
                return Results.Json(new { message = $"UID ya asignado a {owner}" }, statusCode: 409);
            }

            var existingForUser = await db.Cards.FirstOrDefaultAsync(c => c.UserId == user.Id && c.TenantId == tenantId);
            if (existingForUser is not null)
                return Results.Json(new { message = "El usuario ya tiene tarjeta asignada. Usa /api/reassign-card para reemplazar." }, statusCode: 409);

            db.Cards.Add(new Card { Uid = uid, UserId = user.Id, TenantId = tenantId });
            await db.SaveChangesAsync();

            return Results.Ok(new { ok = true, userId = user.Id, uid });
        }

        app.MapPost("/assign-card", AssignCard);
        app.MapPost("/api/assign-card", AssignCard);

        app.MapGet("/transactions/{uid}", async Task<IResult> (CashlessContext db, HttpContext http, IAuthService auth, string uid) =>
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            var tenantId = op.TenantId;

            var clean = (uid ?? "").Trim().ToUpperInvariant();

            var card = await db.Cards.Include(c => c.User).FirstOrDefaultAsync(c => c.Uid == clean && c.TenantId == tenantId && c.User.TenantId == tenantId);
            if (card is null) return Results.NotFound(new { message = "Pulsera no asignada" });

            var tx = await db.Transactions
                .Where(t => t.UserId == card.User.Id && t.TenantId == tenantId)
                .OrderByDescending(t => t.Id)
                .Take(50)
                .Select(t => new
                {
                    t.Id,
                    type = t.Type.ToString(),
                    t.Amount,
                    t.CardUid,
                    t.CreatedAt
                })
                .ToListAsync();

            return Results.Ok(new
            {
                userName = card.User.Name,
                balance = card.User.Balance,
                transactions = tx
            });
        });

        app.MapPut("/users/{id}/contact", UpdateUserContact);
        app.MapPut("/api/users/{id}/contact", UpdateUserContact);

        async Task<IResult> ReassignCard(CashlessContext db, HttpContext http, IAuthService auth, ReassignCardRequest req)
        {
            var op = await auth.AuthenticateAsync(db, http.Request);
            if (op is null) return Results.Unauthorized();
            if (op.Role != OperatorRole.Cajero)
                return Results.Json(new { message = "Forbidden. Solo Cajero puede reasignar pulseras." }, statusCode: 403);
            var tenantId = op.TenantId;

            if (req.UserId <= 0) return Results.BadRequest(new { message = "UserId invalido" });
            var uid = NormalizeUid(req.Uid);
            if (string.IsNullOrWhiteSpace(uid)) return Results.BadRequest(new { message = "UID requerido" });

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == req.UserId && u.TenantId == tenantId);
            if (user is null) return Results.NotFound(new { message = "Usuario no existe" });

            var existingByUid = await db.Cards
                .Include(c => c.User)
                .FirstOrDefaultAsync(c => c.Uid == uid && c.TenantId == tenantId);
            if (existingByUid is not null && existingByUid.UserId != user.Id)
            {
                var owner = existingByUid.User?.Name ?? $"UserId {existingByUid.UserId}";
                return Results.Json(new { message = $"UID ya asignado a {owner}" }, statusCode: 409);
            }

            var card = await db.Cards.FirstOrDefaultAsync(c => c.UserId == user.Id && c.TenantId == tenantId);
            string? oldUid = null;

            if (card is null)
                db.Cards.Add(new Card { Uid = uid, UserId = user.Id, TenantId = tenantId });
            else
            {
                oldUid = card.Uid;
                card.Uid = uid;
            }

            await db.SaveChangesAsync();
            return Results.Ok(new { ok = true, oldUid, userId = user.Id, uid });
        }

        app.MapPost("/reassign-card", ReassignCard);
        app.MapPost("/api/reassign-card", ReassignCard);

        // ===================== PERMISSIONS (roles -> permisos) - PROTEGIDO =====================
        // Nota: por ahora es RBAC simple (por rol). Más adelante podemos meter overrides por operador en BD.
        app.MapGet("/api/permissions", async (CashlessContext db, HttpContext http, IAuthService auth) =>
        {
            var (op, fail) = await RequireAdmin(db, http, auth);
            if (fail is not null) return fail;

            // Respuesta en el formato que permisos.js espera:
            var roles = new[] { "SuperAdmin","Admin","JefeOperativo","JefeDeBarra","JefeDeStand","CajeroDeBarra","Cajero" };

            var permissions = new[]
            {
                new { key="dashboard_view", title="Ver dashboard", desc="Acceso al panel principal." },
                new { key="pos_use", title="Usar POS", desc="Cobrar con pulsera en barra/stand." },
                new { key="topup", title="Recargar saldo", desc="Hacer recargas (top-up) a pulseras." },
                new { key="charge", title="Cobrar", desc="Aplicar cargos (charge) a pulseras." },
                new { key="users_manage", title="Usuarios", desc="Crear/editar usuarios y asignar pulseras." },
                new { key="areas_manage", title="Barras / Áreas", desc="Crear/editar barras, stands, tipos y customType." },
                new { key="products_manage", title="Productos", desc="Crear/editar catálogo de productos." },
                new { key="menus_manage", title="Menús por barra", desc="Asignar productos por barra (AreaProduct)." },
                new { key="operators_manage", title="Colaboradores", desc="Crear/editar/desactivar operadores." },
                new { key="reports_view", title="Reportes", desc="Ver estadísticas de ventas/consumo." },
                new { key="permissions_view", title="Ver permisos", desc="Ver matriz de permisos por rol." },
                new { key="permissions_manage", title="Administrar permisos", desc="Cambiar permisos (solo SuperAdmin)." },
            };

            var matrix = new Dictionary<string, Dictionary<string, bool>>
            {
                ["SuperAdmin"] = new() {
                    ["dashboard_view"]=true, ["pos_use"]=true, ["topup"]=true, ["charge"]=true,
                    ["users_manage"]=true, ["areas_manage"]=true, ["products_manage"]=true, ["menus_manage"]=true,
                    ["operators_manage"]=true, ["reports_view"]=true, ["permissions_view"]=true, ["permissions_manage"]=true
                },
                ["Admin"] = new() {
                    ["dashboard_view"]=true, ["pos_use"]=true, ["topup"]=true, ["charge"]=true,
                    ["users_manage"]=true, ["areas_manage"]=true, ["products_manage"]=true, ["menus_manage"]=true,
                    ["operators_manage"]=true, ["reports_view"]=true, ["permissions_view"]=true, ["permissions_manage"]=false
                },
                ["JefeOperativo"] = new() {
                    ["dashboard_view"]=true, ["pos_use"]=false, ["topup"]=true, ["charge"]=false,
                    ["users_manage"]=true, ["areas_manage"]=true, ["products_manage"]=true, ["menus_manage"]=true,
                    ["operators_manage"]=false, ["reports_view"]=true, ["permissions_view"]=true, ["permissions_manage"]=false
                },
                ["JefeDeBarra"] = new() {
                    ["dashboard_view"]=true, ["pos_use"]=true, ["topup"]=false, ["charge"]=true,
                    ["users_manage"]=false, ["areas_manage"]=true, ["products_manage"]=false, ["menus_manage"]=true,
                    ["operators_manage"]=false, ["reports_view"]=true, ["permissions_view"]=false, ["permissions_manage"]=false
                },
                ["JefeDeStand"] = new() {
                    ["dashboard_view"]=true, ["pos_use"]=true, ["topup"]=false, ["charge"]=true,
                    ["users_manage"]=false, ["areas_manage"]=true, ["products_manage"]=false, ["menus_manage"]=true,
                    ["operators_manage"]=false, ["reports_view"]=true, ["permissions_view"]=false, ["permissions_manage"]=false
                },
                ["CajeroDeBarra"] = new() {
                    ["dashboard_view"]=false, ["pos_use"]=true, ["topup"]=false, ["charge"]=true,
                    ["users_manage"]=false, ["areas_manage"]=false, ["products_manage"]=false, ["menus_manage"]=false,
                    ["operators_manage"]=false, ["reports_view"]=false, ["permissions_view"]=false, ["permissions_manage"]=false
                },
                ["Cajero"] = new() {
                    ["dashboard_view"]=true, ["pos_use"]=false, ["topup"]=true, ["charge"]=false,
                    ["users_manage"]=true, ["areas_manage"]=false, ["products_manage"]=false, ["menus_manage"]=false,
                    ["operators_manage"]=false, ["reports_view"]=false, ["permissions_view"]=false, ["permissions_manage"]=false
                },
            };

            return Results.Ok(new { roles, permissions, matrix });
        });

        return app;
    }

    private static IResult Forbidden(string msg = "Forbidden")
        => Results.Json(new { message = msg }, statusCode: 403);

    private static string NormalizeOperatorRoleInput(string? roleRaw)
    {
        var raw = (roleRaw ?? string.Empty).Trim();
        if (string.Equals(raw, "JefeDeCaja", StringComparison.OrdinalIgnoreCase))
            return OperatorRole.JefeOperativo.ToString();
        if (string.Equals(raw, "CajeroDeBarra", StringComparison.OrdinalIgnoreCase))
            return OperatorRole.Bartender.ToString();
        return raw;
    }

    private static async Task<(Operator? op, IResult? fail)> RequireAdmin(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        if (op.Role != OperatorRole.SuperAdmin && op.Role != OperatorRole.Admin)
            return (op, Forbidden());
        return (op, null);
    }

    private static async Task<(Operator? op, IResult? fail)> RequireBarManager(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        if (op.Role != OperatorRole.SuperAdmin
            && op.Role != OperatorRole.Admin
            && op.Role != OperatorRole.JefeDeBarra
            && op.Role != OperatorRole.JefeDeStand)
            return (op, Forbidden());
        return (op, null);
    }

    private static DateTime? TryParseDateStart(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateTime.TryParse(value, out var parsed)
            ? parsed.Date
            : null;
    }

    private static DateTime? TryParseDateEnd(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateTime.TryParse(value, out var parsed)
            ? parsed.Date.AddDays(1).AddTicks(-1)
            : null;
    }

    private static async Task<(Operator? op, IResult? fail)> RequireUserManager(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        if (op.Role != OperatorRole.SuperAdmin
            && op.Role != OperatorRole.Admin
            && op.Role != OperatorRole.JefeOperativo)
            return (op, Forbidden("Forbidden. Rol sin acceso a usuarios."));
        return (op, null);
    }

    private static async Task<(Operator? op, IResult? fail)> RequireUserOperations(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return (null, Results.Unauthorized());
        if (op.Role != OperatorRole.SuperAdmin
            && op.Role != OperatorRole.Admin
            && op.Role != OperatorRole.JefeOperativo
            && op.Role != OperatorRole.Cajero)
            return (op, Forbidden("Forbidden. Rol sin acceso operativo a usuarios."));
        return (op, null);
    }

    private static async Task<IResult> HandleGetUsers(CashlessContext db, HttpContext http, IAuthService auth)
    {
        var (op, fail) = await RequireUserOperations(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        var query = db.Users.Where(u => u.TenantId == tenantId);

        var users = await query
            .OrderByDescending(u => u.Id)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.Email,
                u.Phone,
                u.Balance,
                u.TotalSpent,
                u.CreatedAt
            })
            .ToListAsync();

        return Results.Ok(users);
    }

    private static async Task<IResult> HandleGetUserById(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        int id)
    {
        var (op, fail) = await RequireUserOperations(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        var user = await db.Users
            .Where(u => u.TenantId == tenantId && u.Id == id)
            .Select(u => new
            {
                u.Id,
                u.Name,
                u.Email,
                u.Phone,
                u.Balance,
                u.TotalSpent,
                u.CreatedAt
            })
            .FirstOrDefaultAsync();

        return user is null
            ? Results.NotFound(new { message = "Usuario no existe" })
            : Results.Ok(user);
    }

    private static string? TryGetSqlitePath(string connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString)) return null;
        var parts = connectionString.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var p in parts)
        {
            var kv = p.Split('=', 2, StringSplitOptions.TrimEntries);
            if (kv.Length == 2 && kv[0].Equals("Data Source", StringComparison.OrdinalIgnoreCase))
                return kv[1];
        }
        return null;
    }

    private static async Task<IResult> HandleCreateUser(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        CreateUserRequest req)
    {
        var (op, fail) = await RequireUserOperations(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        var wantsOperator = !string.IsNullOrWhiteSpace(req.Username)
            || !string.IsNullOrWhiteSpace(req.Pin)
            || !string.IsNullOrWhiteSpace(req.Role)
            || !string.IsNullOrWhiteSpace(req.DisplayName);

        if (wantsOperator)
        {
            if (op.Role != OperatorRole.Admin && op.Role != OperatorRole.SuperAdmin)
                return Forbidden("Solo Admin/SuperAdmin pueden crear usuarios de sistema.");

            var username = (req.Username ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(username))
                return Results.BadRequest(new { message = "Username requerido" });
            if (username.Any(char.IsWhiteSpace))
                return Results.BadRequest(new { message = "Username no debe contener espacios." });

            var displayName = (req.DisplayName ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(displayName))
                displayName = username;

            if (!string.Equals(username, displayName, StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { message = "displayName debe coincidir con username (compatibilidad)." });

            var pin = (req.Pin ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(pin) || pin.Length < 4 || pin.Length > 6 || !pin.All(char.IsDigit))
                return Results.BadRequest(new { message = "PIN requerido (4-6 dígitos)." });

            var roleRaw = (req.Role ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(roleRaw))
                return Results.BadRequest(new { message = "Rol requerido." });

            // Compat: si llega "JefeDeCaja", mapear a JefeOperativo
            roleRaw = NormalizeOperatorRoleInput(roleRaw);

            if (!Enum.TryParse<OperatorRole>(roleRaw, true, out var parsedRole))
                return Results.BadRequest(new { message = "Rol inválido." });

            if (parsedRole == OperatorRole.SuperAdmin && op.Role != OperatorRole.SuperAdmin)
                return Forbidden("Solo SuperAdmin puede crear otro SuperAdmin.");

            var exists = await db.Operators.AnyAsync(o =>
                o.TenantId == tenantId && o.Name != null && o.Name.Trim().ToLower() == username.ToLower());
            if (exists)
                return Results.Json(new { message = "Username ya existe." }, statusCode: 409);

            int areaId = await db.Areas
                .Where(a => a.TenantId == tenantId)
                .OrderBy(a => a.Id)
                .Select(a => a.Id)
                .FirstOrDefaultAsync();
            if (areaId <= 0) return Results.BadRequest(new { message = "No hay Areas creadas para asignar." });

            var entity = new Operator
            {
                Name = displayName,
                Role = parsedRole,
                AreaId = areaId,
                PinHash = auth.HashPin(pin),
                IsActive = req.IsActive ?? true,
                TenantId = tenantId
            };

            db.Operators.Add(entity);
            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                id = entity.Id,
                username,
                displayName = entity.Name,
                role = entity.Role.ToString(),
                isActive = entity.IsActive
            });
        }

        if (string.IsNullOrWhiteSpace(req.Name))
            return Results.BadRequest(new { message = "Nombre requerido" });

        var user = new User
        {
            Name = req.Name.Trim(),
            Email = string.IsNullOrWhiteSpace(req.Email) ? null : req.Email.Trim(),
            Phone = string.IsNullOrWhiteSpace(req.Phone) ? null : req.Phone.Trim(),
            Balance = 0,
            TotalSpent = 0,
            TenantId = tenantId
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        return Results.Ok(new
        {
            user.Id,
            user.Name,
            user.Email,
            user.Phone,
            user.Balance,
            user.TotalSpent,
            user.CreatedAt
        });
    }

    private static async Task<IResult> HandleUpdateUserContact(
        CashlessContext db,
        HttpContext http,
        IAuthService auth,
        int id,
        UpdateUserContactRequest req)
    {
        var (op, fail) = await RequireUserManager(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id && u.TenantId == tenantId);
        if (user is null) return Results.NotFound(new { message = "Usuario no existe" });

        user.Email = string.IsNullOrWhiteSpace(req.Email) ? null : req.Email.Trim();
        user.Phone = string.IsNullOrWhiteSpace(req.Phone) ? null : req.Phone.Trim();

        await db.SaveChangesAsync();

        return Results.Ok(new
        {
            user.Id,
            user.Name,
            user.Email,
            user.Phone,
            user.Balance,
            user.TotalSpent,
            user.CreatedAt
        });
    }

    private static async Task<IResult> HandleGetUsersCount(CashlessContext db, HttpContext http, IAuthService auth)
    {
        var (op, fail) = await RequireUserManager(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        var query = db.Users.Where(u => u.TenantId == tenantId);
        var count = await query.CountAsync();

        return Results.Ok(new { count });
    }

    private static async Task<IResult> HandleGetUsersSummary(CashlessContext db, HttpContext http, IAuthService auth)
    {
        var (op, fail) = await RequireUserManager(db, http, auth);
        if (fail is not null) return fail;
        var tenantId = op!.TenantId;

        var query = db.Users.Where(u => u.TenantId == tenantId);
        var count = await query.CountAsync();
        var totalBalance = await query.SumAsync(u => (decimal?)u.Balance) ?? 0m;
        var totalSpent = await query.SumAsync(u => (decimal?)u.TotalSpent) ?? 0m;

        return Results.Ok(new
        {
            count,
            totalBalance,
            totalSpent
        });
    }

    private static string NormalizeUid(string? uid)
        => string.Concat((uid ?? string.Empty)
            .Trim()
            .ToUpperInvariant()
            .Where(c => !char.IsWhiteSpace(c)));

    private static bool CanManageOperators(Operator op)
        => op.Role == OperatorRole.SuperAdmin || op.Role == OperatorRole.Admin;

    private static bool CanDeleteOperator(Operator op, Operator target)
    {
        // Solo SuperAdmin puede desactivar Admin / SuperAdmin
        if (target.Role == OperatorRole.SuperAdmin) return op.Role == OperatorRole.SuperAdmin;
        if (target.Role == OperatorRole.Admin) return op.Role == OperatorRole.SuperAdmin;

        // Admin puede desactivar roles menores
        return op.Role == OperatorRole.SuperAdmin || op.Role == OperatorRole.Admin;
    }
}
