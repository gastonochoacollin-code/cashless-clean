namespace Cashless.Api.Dtos.Admin;

public record AreaProductCreateDto(int ProductId, decimal? PriceOverride, bool IsActive);
