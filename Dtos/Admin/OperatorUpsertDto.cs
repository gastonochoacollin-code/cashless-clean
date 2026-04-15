namespace Cashless.Api.Dtos.Admin;

public record OperatorUpsertDto(string Name, string? Role, string? Pin, int? AreaId, bool IsActive);
