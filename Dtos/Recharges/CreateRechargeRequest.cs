namespace Cashless.Api.Dtos.Recharges;

public class CreateRechargeRequest
{
    public string? CardUid { get; set; }
    public string? ReaderId { get; set; }
    public string? ClientId { get; set; }
    public decimal Amount { get; set; }
    public string? PaymentMethod { get; set; }
    public string? PaymentDetail { get; set; }
    public string? Comment { get; set; }
}
