namespace Cashless.Api.Models;

public class BalanceTransfer
{
    public int Id { get; set; }

    public int TenantId { get; set; }

    public int FromUserId { get; set; }
    public User FromUser { get; set; } = null!;

    public int ToUserId { get; set; }
    public User ToUser { get; set; } = null!;

    public decimal Amount { get; set; }

    public int OperatorId { get; set; }
    public Operator Operator { get; set; } = null!;

    public string? Comment { get; set; }

    public DateTime CreatedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();
}
