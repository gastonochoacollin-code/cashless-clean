namespace Cashless.Api.Models;

public class AreaProduct
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = default!;

    public int AreaId { get; set; }
    public Area Area { get; set; } = default!;

    public int ProductId { get; set; }
    public Product Product { get; set; } = default!;

    public decimal? PriceOverride { get; set; }
    public bool IsActive { get; set; } = true;
}
