namespace Cashless.Api.Services.Reportes;

using Cashless.Api.Data;

public interface IReportService
{
    Task<Report1SummaryResult> GetReports1SummaryAsync(CashlessContext db, int tenantId, DateTimeOffset fromDt, DateTimeOffset toDt, int? areaId);
    Task<ReportSummaryResult> GetReportsSummaryAsync(CashlessContext db, int tenantId, DateTimeOffset from, DateTimeOffset to, int? areaId);
    Task<Report2SummaryResult> GetReports2SummaryAsync(CashlessContext db, int tenantId, DateTimeOffset fromDt, DateTimeOffset toDt);
    Task<List<SalesByAreaRow>> GetSalesByAreaAsync(CashlessContext db, int tenantId, DateTimeOffset from, DateTimeOffset to);
    Task<List<ReportsByOperatorRow>> GetReportsByOperatorAsync(CashlessContext db, int tenantId, DateTimeOffset from, DateTimeOffset to, int? areaId);
    Task<List<ReportsRecentRow>> GetReportsRecentAsync(CashlessContext db, int tenantId, DateTimeOffset from, DateTimeOffset to, int? areaId, int take);
}

public sealed record Report1SummaryResult(
    string From,
    string To,
    decimal TotalVendido,
    decimal TotalPropina,
    decimal TotalDonacion,
    int Transacciones,
    int Usuarios,
    decimal TicketPromedio
);

public sealed record ReportSummaryResult(
    DateTime From,
    DateTime To,
    int UserCount,
    int TxCount,
    decimal TotalSold,
    decimal TotalTips,
    decimal TotalDonations,
    decimal TotalCharged
);

public sealed record Report2SummaryResult(
    string From,
    string To,
    decimal TotalVendido,
    decimal TotalPropina,
    decimal TotalDonacion,
    int Transacciones,
    int Usuarios,
    decimal TicketPromedio
);

public sealed record SalesByAreaRow(
    int? AreaId,
    string? AreaName,
    int TxCount,
    decimal TotalSold,
    decimal TotalTips,
    decimal AvgTicket
);

public sealed record ReportsByOperatorRow(
    int? OperatorId,
    string? OperatorName,
    int TxCount,
    decimal TotalSold,
    decimal TotalTips
);

public sealed record ReportsRecentRow(
    int Id,
    DateTime CreatedAt,
    int? AreaId,
    string? AreaName,
    int? OperatorId,
    string? OperatorName,
    string? UidMasked,
    decimal Total,
    decimal Tip
);
