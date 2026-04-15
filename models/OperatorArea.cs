namespace Cashless.Api.Models;

public class OperatorArea
{
    public int Id { get; set; }

    public int TenantId { get; set; }
    public Tenant Tenant { get; set; } = default!;

    public int OperatorId { get; set; }
    public Operator Operator { get; set; } = default!;

    public int AreaId { get; set; }
    public Area Area { get; set; } = default!;

    public OperatorRole Role { get; set; }
    public bool IsActive { get; set; } = true;
}
