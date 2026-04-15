namespace Cashless.Api.Models;

public class Card
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    // UID NFC (Ãºnico)
    public string Uid { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    public DateTime LinkedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();

    // FK
    public int UserId { get; set; }
    public User User { get; set; } = null!;
}


