namespace Cashless.Api.Dtos.Admin;

public record ProductUpsertDto(string Name, decimal Price, string? Category, bool IsActive);
