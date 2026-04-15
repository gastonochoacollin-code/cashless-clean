namespace Cashless.Api.Models;

public class Operator
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;

    public string Name { get; set; } = string.Empty;

    public OperatorRole Role { get; set; }

    public int? AreaId { get; set; }
    public Area? Area { get; set; }

    public string PinHash { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = Cashless.Api.Services.Infra.DateTimeProvider.NowMexico();
}

