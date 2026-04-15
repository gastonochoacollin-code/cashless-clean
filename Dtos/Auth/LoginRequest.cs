namespace Cashless.Api.Dtos.Auth;

public class LoginRequest
{
    public string? Operator { get; init; }
    public int? OperatorId { get; init; }
    public string? OperatorName { get; init; }
    public string? Pin { get; init; }
}
