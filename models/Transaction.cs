namespace Cashless.Api.Models;

public enum TransactionType
{
    TopUp = 1,
    Charge = 2
}

public class Transaction
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    // Para auditorÃ­a: quÃ© tarjeta se usÃ³
    public string? CardUid { get; set; }

    public TransactionType Type { get; set; }

    // Siempre positivo; el tipo define si suma o resta
    public decimal Amount { get; set; }

    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();
    public decimal TipAmount { get; set; }
public decimal DonationAmount { get; set; }
public int? DonationProjectId { get; set; }
public int? SaleId { get; set; }
public Sale? Sale { get; set; }
public int? AreaId { get; set; }
public int? OperatorId { get; set; }
public int? ShiftId { get; set; }

}

