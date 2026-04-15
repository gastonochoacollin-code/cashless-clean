namespace Cashless.Api.Models;

public class CardAudit
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    public int CashierId { get; set; }
    public Operator Cashier { get; set; } = null!;

    public int ClientId { get; set; }
    public User Client { get; set; } = null!;

    public string? OldUid { get; set; }
    public string NewUid { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();
}


