namespace Cashless.Api.Dtos.Cashier;

public record CreateTopupRequest(string? Uid, string? CardUid, decimal Amount, string? PaymentMethod);
