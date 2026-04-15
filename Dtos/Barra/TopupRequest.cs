namespace Cashless.Api.Dtos.Barra;

public record TopupRequest(string Uid, decimal Amount, string? TerminalId = null);
