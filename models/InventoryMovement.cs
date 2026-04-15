namespace Cashless.Api.Models;

public class InventoryMovement
{
    public int Id { get; set; }

    public int TenantId { get; set; }

    public int ProductId { get; set; }
    public Product Product { get; set; } = null!;

    public int? AreaId { get; set; }
    public Area? Area { get; set; }

    public decimal Qty { get; set; }

    public string Direction { get; set; } = "stock_in";

    public int OperatorId { get; set; }
    public Operator Operator { get; set; } = null!;

    public string? Comment { get; set; }

    public DateTime CreatedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();
}
