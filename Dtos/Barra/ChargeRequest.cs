namespace Cashless.Api.Dtos.Barra;

public record ChargeRequest(string Uid, decimal Amount, string? TerminalId = null);
