using System.Collections.Generic;

namespace Cashless.Api.Dtos.Barra;

public record ChargeRequestV2(
    string? Uid,
    int AreaId,
    int OperatorId,
    decimal TipAmount,
    decimal DonationPercent,
    int? DonationProjectId,
    List<ChargeItemDto> Items,
    string? TerminalId = null
);
