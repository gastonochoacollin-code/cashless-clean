namespace Cashless.Api.Models;

public class User
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    public string Name { get; set; } = string.Empty;

    public string? Email { get; set; }      // ðŸ‘ˆ nuevo
    public string? Phone { get; set; }      // ðŸ‘ˆ nuevo
    public decimal TotalSpent { get; set; } = 0m; // ðŸ‘ˆ nuevo

    public decimal Balance { get; set; } = 0m;

    public DateTime CreatedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();

    public ICollection<Card> Cards { get; set; } = new List<Card>();

    public ICollection<Transaction> Transactions { get; set; } = new List<Transaction>();
}

