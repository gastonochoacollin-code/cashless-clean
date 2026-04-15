using System.Collections.Generic;

namespace Cashless.Api.Dtos;

public class ChargeRequestV2
{
  public string? Uid { get; set; }
  public int AreaId { get; set; }
  public int OperatorId { get; set; }

  public decimal TipAmount { get; set; }          // propina
  public decimal DonationPercent { get; set; }    // % opcional
  public int? DonationProjectId { get; set; }

  public List<ChargeItemDto> Items { get; set; } = new();
}
