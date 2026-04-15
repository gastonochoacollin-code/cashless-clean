namespace Cashless.Api.Models;

public class AuditLog
{
    public int Id { get; set; }

    public int TenantId { get; set; }

    public string Action { get; set; } = string.Empty;

    public int? UserId { get; set; }

    public int OperatorId { get; set; }

    public decimal? PreviousValue { get; set; }

    public decimal? NewValue { get; set; }

    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();
}
