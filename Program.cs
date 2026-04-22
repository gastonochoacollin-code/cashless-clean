using Cashless.Api.Data;
using Cashless.Api.Models;
using Cashless.Api.Services.Auth;
using Cashless.Api.Services.Infra;
using Cashless.Api.Services.Reportes;
using Cashless.Api.Endpoints;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;

Console.WriteLine("Cashless.Api starting");

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel((context, options) =>
{
    options.Configure(context.Configuration.GetSection("Kestrel"));
});

var serverUrls =
    builder.Configuration["Urls"]
    ?? builder.Configuration["urls"]
    ?? builder.Configuration["ASPNETCORE_URLS"]
    ?? "http://0.0.0.0:5001";
builder.WebHost.UseUrls(serverUrls);

var (connectionString, sqliteDbPath) = BuildSqliteConnection(builder.Configuration);
Directory.CreateDirectory(Path.GetDirectoryName(sqliteDbPath)!);
Console.WriteLine($"[STARTUP] SQLite DB: {sqliteDbPath}");
Console.WriteLine($"[STARTUP] Requested URLs: {serverUrls}");

builder.Services.AddDbContext<CashlessContext>(opt =>
    opt.UseSqlite(connectionString));
builder.Services.AddSingleton(new SqliteDatabaseInfo(sqliteDbPath, connectionString));
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddSingleton<IUidState, InMemoryUidState>();
builder.Services.AddScoped<IReportService, ReportService>();
builder.Services.AddCors(opt =>
    opt.AddPolicy("cashless-lan", p =>
        p.SetIsOriginAllowed(origin => IsAllowedLanOrigin(origin, builder.Configuration))
            .AllowAnyHeader()
            .AllowAnyMethod()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.UseDefaultFiles();
app.Use(async (context, next) =>
{
    if (context.Request.Path.Value?.EndsWith(".html", StringComparison.OrdinalIgnoreCase) == true)
    {
        context.Response.Headers["Content-Type"] = "text/html; charset=utf-8";
    }
    await next();
});
app.UseStaticFiles();
app.UseCors("cashless-lan");
app.Use(async (context, next) =>
{
    var requestPath = context.Request.Path.Value ?? string.Empty;
    if (!requestPath.StartsWith("/api", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }

    var path = requestPath;
    var isReportsPath = path.StartsWith("/api/reports", StringComparison.OrdinalIgnoreCase);
    var cashierAllowedReportPath =
        path.StartsWith("/api/reports/cashier/summary", StringComparison.OrdinalIgnoreCase);

    var blockedForCashier =
        path.StartsWith("/api/permissions", StringComparison.OrdinalIgnoreCase)
        || (isReportsPath && !cashierAllowedReportPath);

    if (!blockedForCashier)
    {
        await next();
        return;
    }

    var db = context.RequestServices.GetRequiredService<CashlessContext>();
    var auth = context.RequestServices.GetRequiredService<IAuthService>();
    var op = await auth.AuthenticateAsync(db, context.Request);
    if (op is not null && op.Role == OperatorRole.Cajero)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { message = "Forbidden. El rol Cajero no puede acceder a este recurso." });
        return;
    }

    await next();
});

if (app.Environment.IsDevelopment())
{
    app.MapGet("/api/dev/diag/operators", async (CashlessContext db) =>
    {
        var total = await db.Operators.CountAsync();
        var active = await db.Operators.Where(o => o.IsActive).CountAsync();
        var byTenant = await db.Operators
            .GroupBy(o => o.TenantId)
            .Select(g => new { tenantId = g.Key, count = g.Count(), active = g.Count(x => x.IsActive) })
            .OrderBy(x => x.tenantId)
            .ToListAsync();

        var tenants = await db.Tenants
            .OrderBy(t => t.Id)
            .Select(t => new { t.Id, t.Name })
            .Take(20)
            .ToListAsync();

        return Results.Ok(new
        {
            totalOperators = total,
            activeOperators = active,
            activeOperatorsByTenant = byTenant,
            firstTenants = tenants
        });
    });
}





// =======================
// DB migrate + seed mínimo
// =======================
// Operación LAN recomendada:
// dotnet run --urls "http://0.0.0.0:5001"
// Verificar bind: netstat -an | findstr 5001
// Abrir firewall (admin):
// netsh advfirewall firewall add rule name="Cashless5001" dir=in action=allow protocol=TCP localport=5001
using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    var db = scope.ServiceProvider.GetRequiredService<CashlessContext>();
    var auth = scope.ServiceProvider.GetRequiredService<IAuthService>();
    var dbInfo = scope.ServiceProvider.GetRequiredService<SqliteDatabaseInfo>();
    var startupLogger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("StartupHardening");

    startupLogger.LogInformation("SQLite DB path: {DbPath}", dbInfo.Path);
    db.Database.Migrate();

    // Compatibilidad local sin depender de nuevas migraciones.
    if (db.Database.GetDbConnection() is SqliteConnection)
    {
        db.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS Shifts (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                TenantId INTEGER NOT NULL,
                CashierId INTEGER NOT NULL,
                BoxId INTEGER NULL,
                OpenedAt TEXT NOT NULL,
                ClosedAt TEXT NULL,
                Status TEXT NOT NULL
            );
            """);

        db.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS CardAudits (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                TenantId INTEGER NOT NULL,
                CashierId INTEGER NOT NULL,
                ClientId INTEGER NOT NULL,
                OldUid TEXT NULL,
                NewUid TEXT NOT NULL,
                Reason TEXT NOT NULL,
                CreatedAt TEXT NOT NULL
            );
            """);

        db.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS Recharges (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                TenantId INTEGER NOT NULL,
                CashierId INTEGER NOT NULL,
                ShiftId INTEGER NOT NULL,
                Amount REAL NOT NULL,
                CardUid TEXT NOT NULL DEFAULT '',
                ReaderId TEXT NULL,
                ClientId TEXT NULL,
                PaymentMethod TEXT NOT NULL,
                PaymentDetail TEXT NULL,
                Comment TEXT NULL,
                CreatedAt TEXT NOT NULL
            );
            """);

        db.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS InventoryMovements (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                TenantId INTEGER NOT NULL,
                ProductId INTEGER NOT NULL,
                AreaId INTEGER NULL,
                Qty REAL NOT NULL,
                Direction TEXT NOT NULL,
                OperatorId INTEGER NOT NULL,
                Comment TEXT NULL,
                CreatedAt TEXT NOT NULL
            );
            """);

        db.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS BalanceTransfers (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                TenantId INTEGER NOT NULL,
                FromUserId INTEGER NOT NULL,
                ToUserId INTEGER NOT NULL,
                Amount REAL NOT NULL,
                OperatorId INTEGER NOT NULL,
                Comment TEXT NULL,
                CreatedAt TEXT NOT NULL
            );
            """);

        db.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS AuditLogs (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                TenantId INTEGER NOT NULL,
                Action TEXT NOT NULL,
                UserId INTEGER NULL,
                OperatorId INTEGER NOT NULL,
                PreviousValue TEXT NULL,
                NewValue TEXT NULL,
                Note TEXT NULL,
                CreatedAt TEXT NOT NULL
            );
            """);

        bool? HasSqliteColumn(string tableName, string columnName)
        {
            try
            {
                var conn = (SqliteConnection)db.Database.GetDbConnection();
                if (conn.State != System.Data.ConnectionState.Open)
                    conn.Open();

                using var cmd = conn.CreateCommand();
                cmd.CommandText = $"PRAGMA table_info(\"{tableName}\");";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var col = reader["name"]?.ToString();
                    if (string.Equals(col, columnName, StringComparison.OrdinalIgnoreCase))
                        return true;
                }

                return false;
            }
            catch (Exception ex)
            {
                startupLogger.LogWarning(ex, "No fue posible consultar esquema SQLite para {Table}.{Column}. Se omite ALTER.", tableName, columnName);
                return null;
            }
        }

        var shiftIdExists = HasSqliteColumn("Transactions", "ShiftId");
        if (shiftIdExists == false)
        {
            try
            {
                db.Database.ExecuteSqlRaw("""
                    ALTER TABLE Transactions ADD COLUMN ShiftId INTEGER NULL;
                    """);
            }
            catch (Exception ex)
            {
                startupLogger.LogWarning(ex, "No se pudo agregar columna ShiftId a Transactions. Se continúa sin detener la app.");
            }
        }
        else if (shiftIdExists == true)
        {
            startupLogger.LogInformation("Transactions.ShiftId ya existe, skip.");
        }

        var rechargeCardUidExists = HasSqliteColumn("Recharges", "CardUid");
        if (rechargeCardUidExists == false)
        {
            try
            {
                db.Database.ExecuteSqlRaw("""
                    ALTER TABLE Recharges ADD COLUMN CardUid TEXT NOT NULL DEFAULT '';
                    """);
            }
            catch (Exception ex)
            {
                startupLogger.LogWarning(ex, "No se pudo agregar columna CardUid a Recharges.");
            }
        }

        var rechargeReaderIdExists = HasSqliteColumn("Recharges", "ReaderId");
        if (rechargeReaderIdExists == false)
        {
            try
            {
                db.Database.ExecuteSqlRaw("""
                    ALTER TABLE Recharges ADD COLUMN ReaderId TEXT NULL;
                    """);
            }
            catch (Exception ex)
            {
                startupLogger.LogWarning(ex, "No se pudo agregar columna ReaderId a Recharges.");
            }
        }

        var rechargeClientIdExists = HasSqliteColumn("Recharges", "ClientId");
        if (rechargeClientIdExists == false)
        {
            try
            {
                db.Database.ExecuteSqlRaw("""
                    ALTER TABLE Recharges ADD COLUMN ClientId TEXT NULL;
                    """);
            }
            catch (Exception ex)
            {
                startupLogger.LogWarning(ex, "No se pudo agregar columna ClientId a Recharges.");
            }
        }

        try
        {
            db.Database.ExecuteSqlRaw("""
                CREATE INDEX IF NOT EXISTS IX_Recharges_Tenant_CardUid_CreatedAt
                ON Recharges (TenantId, CardUid, CreatedAt DESC);
                """);
        }
        catch (Exception ex)
        {
            startupLogger.LogWarning(ex, "No se pudo crear indice IX_Recharges_Tenant_CardUid_CreatedAt.");
        }

        try
        {
            db.Database.ExecuteSqlRaw("""
                CREATE INDEX IF NOT EXISTS IX_InventoryMovements_Tenant_Area_Product_CreatedAt
                ON InventoryMovements (TenantId, AreaId, ProductId, CreatedAt DESC);
                """);
        }
        catch (Exception ex)
        {
            startupLogger.LogWarning(ex, "No se pudo crear indice IX_InventoryMovements_Tenant_Area_Product_CreatedAt.");
        }

        try
        {
            db.Database.ExecuteSqlRaw("""
                CREATE INDEX IF NOT EXISTS IX_BalanceTransfers_Tenant_From_To_CreatedAt
                ON BalanceTransfers (TenantId, FromUserId, ToUserId, CreatedAt DESC);
                """);
        }
        catch (Exception ex)
        {
            startupLogger.LogWarning(ex, "No se pudo crear indice IX_BalanceTransfers_Tenant_From_To_CreatedAt.");
        }

        try
        {
            db.Database.ExecuteSqlRaw("""
                CREATE INDEX IF NOT EXISTS IX_AuditLogs_Tenant_Action_CreatedAt
                ON AuditLogs (TenantId, Action, CreatedAt DESC);
                """);
        }
        catch (Exception ex)
        {
            startupLogger.LogWarning(ex, "No se pudo crear indice IX_AuditLogs_Tenant_Action_CreatedAt.");
        }

        try
        {
            db.Database.ExecuteSqlRaw("""
                CREATE INDEX IF NOT EXISTS IX_AuditLogs_Tenant_User_CreatedAt
                ON AuditLogs (TenantId, UserId, CreatedAt DESC);
                """);
        }
        catch (Exception ex)
        {
            startupLogger.LogWarning(ex, "No se pudo crear indice IX_AuditLogs_Tenant_User_CreatedAt.");
        }
    }

    var defaultTenantId = SeedData(db, auth);
    SeedSuperAdmin(services);

    // Fix legacy TenantId=0 when single-tenant
    if (db.Tenants.Count() == 1 && defaultTenantId > 0)
    {
        int Fix<TEntity>(IQueryable<TEntity> query, string label) where TEntity : class
        {
            var updated = query.ExecuteUpdate(s => s.SetProperty(e => EF.Property<int>(e, "TenantId"), defaultTenantId));
            if (updated > 0)
                Console.WriteLine($"[TENANT-FIX] {label}: {updated} rows updated to TenantId={defaultTenantId}");
            return updated;
        }

        Fix(db.Operators.Where(o => o.TenantId == 0), "Operators");
        Fix(db.Areas.Where(a => a.TenantId == 0), "Areas");
        Fix(db.Users.Where(u => u.TenantId == 0), "Users");
        Fix(db.Products.Where(p => p.TenantId == 0), "Products");
        Fix(db.Cards.Where(c => c.TenantId == 0), "Cards");
        Fix(db.Transactions.Where(t => t.TenantId == 0), "Transactions");
        Fix(db.Sales.Where(s => s.TenantId == 0), "Sales");
        Fix(db.SaleItems.Where(si => si.TenantId == 0), "SaleItems");
        Fix(db.OperatorAreas.Where(oa => oa.TenantId == 0), "OperatorAreas");
        Fix(db.AreaProducts.Where(ap => ap.TenantId == 0), "AreaProducts");
        Fix(db.Festivals.Where(f => f.TenantId == 0), "Festivals");
    }
}

int SeedData(CashlessContext db, IAuthService auth)
{
    var tenant = db.Tenants.OrderBy(t => t.Id).FirstOrDefault();
    if (tenant is null)
    {
        tenant = new Tenant { Name = "Default" };
        db.Tenants.Add(tenant);
        db.SaveChanges();
    }

    var today = DateTimeProvider.TodayMexico();
    var festival = db.Festivals.FirstOrDefault(f => f.TenantId == tenant.Id && f.Name == "Festival Default");
    if (festival is null)
    {
        festival = new Festival
        {
            Name = "Festival Default",
            StartDate = today,
            EndDate = today.AddDays(30),
            IsActive = true,
            TenantId = tenant.Id
        };
        db.Festivals.Add(festival);
    }

    var area = db.Areas.FirstOrDefault(a => a.TenantId == tenant.Id && a.Name == "General");
    if (area is null)
    {
        area = new Area
        {
            Name = "General",
            IsActive = true,
            Type = AreaType.General,
            TenantId = tenant.Id
        };
        db.Areas.Add(area);
        db.SaveChanges();
    }

    var adminPinHash = auth.HashPin("1234");
    var admin = db.Operators.FirstOrDefault(o => o.TenantId == tenant.Id && o.Name == "Admin");
    if (admin is null)
    {
        admin = new Operator
        {
            Name = "Admin",
            Role = OperatorRole.Admin,
            AreaId = area.Id,
            PinHash = adminPinHash,
            IsActive = true,
            TenantId = tenant.Id
        };
        db.Operators.Add(admin);
        Console.WriteLine("ADMIN USER CREATED");
    }

    db.SaveChanges();
    return tenant.Id;
}

void SeedSuperAdmin(IServiceProvider services)
{
    var db = services.GetRequiredService<CashlessContext>();
    var auth = services.GetRequiredService<IAuthService>();

    var superAdminRole = OperatorRole.SuperAdmin;
    var tenant = db.Tenants.OrderBy(t => t.Id).FirstOrDefault();
    if (tenant is null)
    {
        tenant = new Tenant { Name = "Default" };
        db.Tenants.Add(tenant);
        db.SaveChanges();
    }

    var area = db.Areas.FirstOrDefault(a => a.TenantId == tenant.Id && a.Name == "General");
    if (area is null)
    {
        area = new Area
        {
            Name = "General",
            IsActive = true,
            Type = AreaType.General,
            TenantId = tenant.Id
        };
        db.Areas.Add(area);
        db.SaveChanges();
    }

    var pinHash = auth.HashPin("1707");
    var superAdmin = db.Operators.FirstOrDefault(o =>
        o.TenantId == tenant.Id &&
        o.Name.Trim().ToLower() == "gaston");

    if (superAdmin is null)
    {
        superAdmin = new Operator
        {
            Name = "gaston",
            Role = superAdminRole,
            AreaId = area.Id,
            PinHash = pinHash,
            IsActive = true,
            TenantId = tenant.Id
        };
        db.Operators.Add(superAdmin);
        db.SaveChanges();
        Console.WriteLine("SuperAdmin creado: gaston");
        return;
    }

    var changed = false;
    if (superAdmin.Role != superAdminRole)
    {
        superAdmin.Role = superAdminRole;
        changed = true;
    }

    if (!superAdmin.IsActive)
    {
        superAdmin.IsActive = true;
        changed = true;
    }

    if (superAdmin.AreaId is null)
    {
        superAdmin.AreaId = area.Id;
        changed = true;
    }

    if (!string.Equals(superAdmin.PinHash, pinHash, StringComparison.OrdinalIgnoreCase))
    {
        superAdmin.PinHash = pinHash;
        changed = true;
    }

    if (changed)
        db.SaveChanges();

    Console.WriteLine("SuperAdmin ya existe");
}

static (string ConnectionString, string DbPath) BuildSqliteConnection(IConfiguration configuration)
{
    const string defaultDbPath = @"C:\CashlessData\cashless.db";
    var rawConnectionString = configuration.GetConnectionString("DefaultConnection");
    if (string.IsNullOrWhiteSpace(rawConnectionString))
    {
        rawConnectionString = $"Data Source={defaultDbPath}";
    }

    var builder = new SqliteConnectionStringBuilder(rawConnectionString);
    var dbPath = string.IsNullOrWhiteSpace(builder.DataSource)
        ? defaultDbPath
        : builder.DataSource;

    dbPath = Path.GetFullPath(Environment.ExpandEnvironmentVariables(dbPath));
    builder.DataSource = dbPath;

    return (builder.ConnectionString, dbPath);
}

static bool IsAllowedLanOrigin(string origin, IConfiguration configuration)
{
    var configuredOrigins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
    if (configuredOrigins.Length > 0)
    {
        return configuredOrigins.Any(x => string.Equals(x.TrimEnd('/'), origin.TrimEnd('/'), StringComparison.OrdinalIgnoreCase));
    }

    return Uri.TryCreate(origin, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
}


app.MapReportsEndpoints();
app.MapPosEndpoints();
app.MapAdminEndpoints();
app.MapCashierEndpoints();
app.MapRechargesEndpoints();
app.MapExportEndpoints();
app.MapUserBalanceEndpoints();
app.MapAuthEndpoints();

app.Lifetime.ApplicationStarted.Register(() =>
{
    var activeUrls = app.Urls.Count > 0 ? string.Join(", ", app.Urls) : serverUrls;
    app.Logger.LogInformation("Active URLs: {Urls}", activeUrls);
    app.Logger.LogInformation("SQLite DB path: {DbPath}", sqliteDbPath);
});

app.Run();

public sealed record SqliteDatabaseInfo(string Path, string ConnectionString);

















