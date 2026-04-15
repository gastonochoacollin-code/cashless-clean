namespace Cashless.Api.Models;

public class Shift
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    public int CashierId { get; set; }
    public Operator Cashier { get; set; } = null!;

    public int? BoxId { get; set; }

    public DateTime OpenedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();
    public DateTime? ClosedAt { get; set; }

    public string Status { get; set; } = "Open";
}


