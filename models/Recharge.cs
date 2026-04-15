namespace Cashless.Api.Models;

public static class RechargePaymentMethods
{
    public const string Efectivo = "EFECTIVO";
    public const string Tarjeta = "TARJETA";
    public const string Cripto = "CRIPTO";
    public const string Transferencia = "TRANSFERENCIA";
    public const string Otro = "OTRO";

    public static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase)
    {
        Efectivo,
        Tarjeta,
        Cripto,
        Transferencia,
        Otro
    };
}

public class Recharge
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    public int CashierId { get; set; }
    public Operator Cashier { get; set; } = null!;

    public int ShiftId { get; set; }
    public Shift Shift { get; set; } = null!;

    public decimal Amount { get; set; }

    public string CardUid { get; set; } = string.Empty;
    public string? ReaderId { get; set; }
    public string? ClientId { get; set; }

    public string PaymentMethod { get; set; } = string.Empty;
    public string? PaymentDetail { get; set; }
    public string? Comment { get; set; }

    public DateTime CreatedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();
}


