namespace Cashless.Api.Models;

public class SaleItem
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    public int SaleId { get; set; }
    public Sale Sale { get; set; } = null!;

    public int ProductId { get; set; }
    public Product Product { get; set; } = null!;

    // Snapshot para auditoría
    public string NameSnapshot { get; set; } = string.Empty;

    public decimal UnitPrice { get; set; }

    public int Qty { get; set; }

    public decimal LineTotal { get; set; }
}
