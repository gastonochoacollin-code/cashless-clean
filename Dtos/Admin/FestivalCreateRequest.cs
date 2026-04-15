namespace Cashless.Api.Dtos.Admin;

public sealed record FestivalCreateRequest(
    string Name,
    DateTime StartDate,
    DateTime EndDate,
    bool IsActive,
    string? Location = null
);
