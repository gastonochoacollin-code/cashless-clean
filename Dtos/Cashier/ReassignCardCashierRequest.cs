namespace Cashless.Api.Dtos.Cashier;

public record ReassignCardCashierRequest(int UserId, string Uid, string Reason);

