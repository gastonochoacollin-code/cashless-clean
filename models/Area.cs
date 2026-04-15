namespace Cashless.Api.Models;

public class Area
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;
    public string Name { get; set; } = string.Empty;
    public string? CustomType { get; set; }
    public AreaType Type { get; set; } = AreaType.General;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();

    public ICollection<Operator> Operators { get; set; } = new List<Operator>();
}

