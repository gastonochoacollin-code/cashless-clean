namespace Cashless.Api.Dtos.Cashier;

public sealed class TransferBalanceRequest
{
    public int FromUserId { get; set; }
    public int ToUserId { get; set; }
    public decimal Amount { get; set; }
    public string? Comment { get; set; }
}
