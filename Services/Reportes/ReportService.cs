namespace Cashless.Api.Services.Reportes;

using Cashless.Api.Data;
using Cashless.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

public sealed class ReportService : IReportService
{
    private readonly ILogger<ReportService> _logger;

    public ReportService(ILogger<ReportService> logger)
    {
        _logger = logger;
    }

    private static IQueryable<Transaction> TxForTenant(CashlessContext db, int tenantId)
        => db.Transactions.Where(t => t.TenantId == tenantId || t.TenantId == 0);

    private static IQueryable<Sale> SalesForTenant(CashlessContext db, int tenantId)
        => db.Sales.Where(s => s.TenantId == tenantId || s.TenantId == 0);

    private static IQueryable<User> UsersForTenant(CashlessContext db, int tenantId)
        => db.Users.Where(u => u.TenantId == tenantId || u.TenantId == 0);

    private static string GetKind(string? note)
    {
        if (string.IsNullOrWhiteSpace(note)) return "LEGACY";
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(note);
            if (doc.RootElement.TryGetProperty("kind", out var k))
                return (k.GetString() ?? string.Empty).Trim().ToUpperInvariant();
        }
        catch
        {
        }
        return "LEGACY";
    }

    public async Task<Report1SummaryResult> GetReports1SummaryAsync(CashlessContext db, int tenantId, DateTimeOffset fromDt, DateTimeOffset toDt, int? areaId)
    {
        var from = fromDt.DateTime;
        var to = toDt.DateTime;

        // ?? OJO: ajusta nombres si tus entidades difieren:
        // Ventas: idealmente desde Sales (si existe)
        var salesQ = SalesForTenant(db, tenantId)
            .Where(s => s.CreatedAt >= from && s.CreatedAt < to);

        if (areaId.HasValue) salesQ = salesQ.Where(s => s.AreaId == areaId.Value);

        var totalVendido = ToDecimal(await salesQ.SumAsync(s => (double?)s.Total));
        var totalPropina = ToDecimal(await salesQ.SumAsync(s => (double?)s.TipAmount));
        var totalDonacion = ToDecimal(await salesQ.SumAsync(s => (double?)s.DonationAmount));
        var txCount = await salesQ.CountAsync();

        var userCount = await UsersForTenant(db, tenantId).CountAsync(); // total usuarios

        _logger.LogDebug("[reports1.summary] from={From} to={To} areaId={AreaId} txCount={TxCount} totalVendido={TotalVendido} totalPropina={TotalPropina} totalDonacion={TotalDonacion}",
            from, to, areaId, txCount, totalVendido, totalPropina, totalDonacion);

        return new Report1SummaryResult(
            from.ToString("yyyy-MM-dd"),
            to.AddDays(-1).ToString("yyyy-MM-dd"),
            totalVendido,
            totalPropina,
            totalDonacion,
            txCount,
            userCount,
            txCount > 0 ? totalVendido / txCount : 0m
        );
    }


    public async Task<ReportSummaryResult> GetReportsSummaryAsync(CashlessContext db, int tenantId, DateTimeOffset from, DateTimeOffset to, int? areaId)
    {
        var fromUtc = from.DateTime;
        var toUtc = to.DateTime;

        var userCount = await UsersForTenant(db, tenantId).CountAsync();

        var chargesQ = TxForTenant(db, tenantId)
            .Where(x => x.Type == TransactionType.Charge && x.CreatedAt >= fromUtc && x.CreatedAt < toUtc);

        if (areaId.HasValue)
            chargesQ = chargesQ.Where(x => x.AreaId == areaId.Value);

        var txRows = await chargesQ
            .Select(x => new { x.Amount, x.Note })
            .ToListAsync();

        int txCount = 0;
        decimal totalSold = 0m;
        decimal totalTips = 0m;
        decimal totalDonations = 0m;

        foreach (var tx in txRows)
        {
            var kind = GetKind(tx.Note);
            if (kind == "TIP")
            {
                totalTips += tx.Amount;
            }
            else if (kind == "DONATION")
            {
                totalDonations += tx.Amount;
            }
            else
            {
                totalSold += tx.Amount;
                txCount += 1;
            }
        }

        var totalCharged = totalSold;

        _logger.LogDebug("[reports.summary] from={From} to={To} txCount={TxCount} totalSold={TotalSold} totalTips={TotalTips} totalDonations={TotalDonations} totalCharged={TotalCharged}",
            fromUtc, toUtc, txCount, totalSold, totalTips, totalDonations, totalCharged);

        return new ReportSummaryResult(
            fromUtc,
            toUtc,
            userCount,
            txCount,
            totalSold,
            totalTips,
            totalDonations,
            totalCharged
        );
    }


    public async Task<Report2SummaryResult> GetReports2SummaryAsync(CashlessContext db, int tenantId, DateTimeOffset fromDt, DateTimeOffset toDt)
    {
        var from = fromDt.DateTime;
        var to = toDt.DateTime;

        var chargesQ = TxForTenant(db, tenantId)
            .Where(x => x.Type == TransactionType.Charge && x.CreatedAt >= from && x.CreatedAt < to);

        var rows = await chargesQ.Select(x => new { x.Amount, x.Note }).ToListAsync();
        int txCount = 0;
        decimal totalVendido = 0m;
        foreach (var tx in rows)
        {
            var kind = GetKind(tx.Note);
            if (kind == "TIP" || kind == "DONATION") continue;
            totalVendido += tx.Amount;
            txCount += 1;
        }

        var userCount = await UsersForTenant(db, tenantId).CountAsync();

        // OJO: propina/donación hoy NO se guardan en DB (tu /charge no las maneja),
        // así que por ahora regresan 0 hasta que implementemos ChargeRequestV2 y persistencia.
        var totalPropina = 0m;
        var totalDonacion = 0m;

        _logger.LogDebug("[reports2.summary] from={From} to={To} txCount={TxCount} totalVendido={TotalVendido}",
            from, to, txCount, totalVendido);

        return new Report2SummaryResult(
            from.ToString("yyyy-MM-dd"),
            to.AddDays(-1).ToString("yyyy-MM-dd"),
            totalVendido,
            totalPropina,
            totalDonacion,
            txCount,
            userCount,
            txCount > 0 ? totalVendido / txCount : 0m
        );
    }

    public async Task<List<SalesByAreaRow>> GetSalesByAreaAsync(CashlessContext db, int tenantId, DateTimeOffset from, DateTimeOffset to)
    {
        var fromUtc = from.DateTime;
        var toUtc = to.DateTime;
        var list = await TxForTenant(db, tenantId)
            .Where(t => t.Type == TransactionType.Charge && t.CreatedAt >= fromUtc && t.CreatedAt < toUtc)
            .Select(t => new { t.AreaId, t.Amount, t.Note })
            .ToListAsync();

        var rows = list
            .GroupBy(t => t.AreaId)
            .Select(g =>
            {
                int txCount = 0;
                decimal totalSold = 0m;
                decimal totalTips = 0m;
                foreach (var t in g)
                {
                    var kind = GetKind(t.Note);
                    if (kind == "TIP") totalTips += t.Amount;
                    else if (kind == "DONATION") { }
                    else { totalSold += t.Amount; txCount += 1; }
                }
                return new
                {
                    areaId = g.Key,
                    txCount,
                    totalSold = (double)totalSold,
                    totalTips = (double)totalTips
                };
            })
            .OrderByDescending(x => x.totalSold)
            .ToList();

        var areaIds = rows.Where(r => r.areaId.HasValue).Select(r => r.areaId!.Value).ToList();
        var areaNames = await db.Areas
            .Where(a => (a.TenantId == tenantId || a.TenantId == 0) && areaIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id, a => a.Name);

        var result = rows
            .Select(r => new SalesByAreaRow(
                r.areaId,
                r.areaId.HasValue && areaNames.TryGetValue(r.areaId.Value, out var name) ? name : null,
                r.txCount,
                ToDecimal(r.totalSold),
                ToDecimal(r.totalTips),
                r.txCount > 0 ? ToDecimal(r.totalSold) / r.txCount : 0m
            ))
            .ToList();


        _logger.LogDebug("[reports.sales-by-area] from={From} to={To} rows={Rows}", fromUtc, toUtc, result.Count);

        return result;
    }

    public async Task<List<ReportsByOperatorRow>> GetReportsByOperatorAsync(CashlessContext db, int tenantId, DateTimeOffset from, DateTimeOffset to, int? areaId)
    {
        var fromUtc = from.DateTime;
        var toUtc = to.DateTime;

        var q = TxForTenant(db, tenantId)
            .Where(t => t.Type == TransactionType.Charge && t.CreatedAt >= fromUtc && t.CreatedAt < toUtc);

        if (areaId.HasValue)
            q = q.Where(t => t.AreaId == areaId.Value);

        var list = await q
            .Select(t => new { t.OperatorId, t.Amount, t.Note })
            .ToListAsync();

        var rows = list
            .GroupBy(t => t.OperatorId)
            .Select(g =>
            {
                int txCount = 0;
                decimal totalSold = 0m;
                decimal totalTips = 0m;
                foreach (var t in g)
                {
                    var kind = GetKind(t.Note);
                    if (kind == "TIP") totalTips += t.Amount;
                    else if (kind == "DONATION") { }
                    else { totalSold += t.Amount; txCount += 1; }
                }
                return new
                {
                    operatorId = g.Key,
                    txCount,
                    totalSold = (double)totalSold,
                    totalTips = (double)totalTips
                };
            })
            .OrderByDescending(x => x.totalSold)
            .ToList();

        var opIds = rows.Where(r => r.operatorId.HasValue).Select(r => r.operatorId!.Value).ToList();
        var opNames = await db.Operators
            .Where(o => (o.TenantId == tenantId || o.TenantId == 0) && opIds.Contains(o.Id))
            .ToDictionaryAsync(o => o.Id, o => o.Name);

        return rows
            .Select(r => new ReportsByOperatorRow(
                r.operatorId,
                r.operatorId.HasValue && opNames.TryGetValue(r.operatorId.Value, out var name) ? name : null,
                r.txCount,
                ToDecimal(r.totalSold),
                ToDecimal(r.totalTips)
            ))
            .ToList();
    }

    public async Task<List<ReportsRecentRow>> GetReportsRecentAsync(CashlessContext db, int tenantId, DateTimeOffset from, DateTimeOffset to, int? areaId, int take)
    {
        var fromUtc = from.DateTime;
        var toUtc = to.DateTime;

        var q = TxForTenant(db, tenantId)
            .Where(t => t.Type == TransactionType.Charge && t.CreatedAt >= fromUtc && t.CreatedAt < toUtc);

        if (areaId.HasValue)
            q = q.Where(t => t.AreaId == areaId.Value);

        var list = await q
            .OrderByDescending(t => t.CreatedAt)
            .Take(take)
            .Select(t => new
            {
                t.Id,
                t.CreatedAt,
                t.AreaId,
                t.OperatorId,
                t.CardUid,
                t.Amount,
                t.TipAmount
            })
            .ToListAsync();

        var areaIds = list.Where(r => r.AreaId.HasValue).Select(r => r.AreaId!.Value).ToList();
        var areaNames = await db.Areas
            .Where(a => (a.TenantId == tenantId || a.TenantId == 0) && areaIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id, a => a.Name);

        var opIds = list.Where(r => r.OperatorId.HasValue).Select(r => r.OperatorId!.Value).ToList();
        var opNames = await db.Operators
            .Where(o => (o.TenantId == tenantId || o.TenantId == 0) && opIds.Contains(o.Id))
            .ToDictionaryAsync(o => o.Id, o => o.Name);

        return list.Select(r => new ReportsRecentRow(
            r.Id,
            r.CreatedAt,
            r.AreaId,
            r.AreaId.HasValue && areaNames.TryGetValue(r.AreaId.Value, out var areaName) ? areaName : null,
            r.OperatorId,
            r.OperatorId.HasValue && opNames.TryGetValue(r.OperatorId.Value, out var opName) ? opName : null,
            MaskUid(r.CardUid),
            r.Amount,
            r.TipAmount
        )).ToList();
    }

    private static decimal ToDecimal(double? value)
        => value.HasValue ? (decimal)value.Value : 0m;

    private static string? MaskUid(string? uid)
    {
        if (string.IsNullOrWhiteSpace(uid)) return null;
        var s = uid.Trim();
        if (s.Length <= 4) return new string('*', s.Length);
        var start = s.Substring(0, 4);
        var end = s.Length > 2 ? s.Substring(s.Length - 2) : "";
        return $"{start}…{end}";
    }
}








