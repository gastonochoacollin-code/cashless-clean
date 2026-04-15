namespace Cashless.Api.Dtos.Admin;

public record AreaUpsertDto(string Name, string? Type, bool IsActive, string? CustomType);
