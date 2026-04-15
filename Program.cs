using Cashless.Api.Data;
using Cashless.Api.Models;
using Cashless.Api.Services.Auth;
using Cashless.Api.Services.Infra;
using Cashless.Api.Services.Reportes;
using Cashless.Api.Endpoints;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;

Console.WriteLine("🔥 PROGRAM.CS (Cashless.Api) 🔥");

var builder = WebApplication.CreateBuilder(args);
var serverUrls =
    builder.Configuration["urls"]
    ?? builder.Configuration["ASPNETCORE_URLS"]
    ?? "http://0.0.0.0:5001";
builder.WebHost.UseUrls(serverUrls);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? "Data Source=cashless.db";

builder.Services.AddDbContext<CashlessContext>(opt =>
    opt.UseSqlite(connectionString));
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddSingleton<IUidState, InMemoryUidState>();
builder.Services.AddScoped<IReportService, ReportService>();
builder.Services.AddCors(opt =>
    opt.AddPolicy("local-dev", p =>
        p.WithOrigins("http://localhost:5237")
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
app.UseCors("local-dev");
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
    var db = scope.ServiceProvider.GetRequiredService<CashlessContext>();
    var auth = scope.ServiceProvider.GetRequiredService<IAuthService>();
    var startupLogger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("StartupHardening");
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

    if (!db.Tenants.Any())
    {
        db.Tenants.Add(new Tenant { Name = "Default" });
        db.SaveChanges();
    }

    var defaultTenantId = db.Tenants.OrderBy(t => t.Id).Select(t => t.Id).FirstOrDefault();

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

    if (!db.Festivals.Any(f => f.TenantId == defaultTenantId))
    {
        var today = DateTimeProvider.TodayMexico();
        db.Festivals.Add(new Festival
        {
            Name = "Festival Default",
            StartDate = today,
            EndDate = today.AddDays(30),
            IsActive = true,
            TenantId = defaultTenantId
        });
        db.SaveChanges();
    }

    if (!db.Operators.Any(o => o.TenantId == defaultTenantId))
    {
        var aGeneral = new Area { Name = "General", IsActive = true, Type = AreaType.General, TenantId = defaultTenantId };
        var aBarra1 = new Area { Name = "Barra 1", IsActive = true, Type = AreaType.Barra, TenantId = defaultTenantId };
        var aStand1 = new Area { Name = "Stand 1", IsActive = true, Type = AreaType.Stand, TenantId = defaultTenantId };

        db.Areas.AddRange(aGeneral, aBarra1, aStand1);
        db.SaveChanges();

        db.Operators.AddRange(
            new Operator { Name = "Super Admin", Role = OperatorRole.SuperAdmin, AreaId = aGeneral.Id, PinHash = auth.HashPin("9999"), IsActive = true, TenantId = defaultTenantId },
            new Operator { Name = "Admin", Role = OperatorRole.Admin, AreaId = aGeneral.Id, PinHash = auth.HashPin("1111"), IsActive = true, TenantId = defaultTenantId },
            new Operator { Name = "Jefe Operativo", Role = OperatorRole.JefeOperativo, AreaId = aGeneral.Id, PinHash = auth.HashPin("2222"), IsActive = true, TenantId = defaultTenantId },
            new Operator { Name = "Cajero", Role = OperatorRole.Cajero, AreaId = aGeneral.Id, PinHash = auth.HashPin("5555"), IsActive = true, TenantId = defaultTenantId },
            new Operator { Name = "Jefe Barra 1", Role = OperatorRole.JefeDeBarra, AreaId = aBarra1.Id, PinHash = auth.HashPin("3333"), IsActive = true, TenantId = defaultTenantId },
            new Operator { Name = "Jefe Stand 1", Role = OperatorRole.JefeDeStand, AreaId = aStand1.Id, PinHash = auth.HashPin("4444"), IsActive = true, TenantId = defaultTenantId }
        );

        db.SaveChanges();
    }
}


app.MapReportsEndpoints();
app.MapPosEndpoints();
app.MapAdminEndpoints();
app.MapCashierEndpoints();
app.MapRechargesEndpoints();
app.MapExportEndpoints();
app.MapUserBalanceEndpoints();
app.MapAuthEndpoints();
app.Run();

















