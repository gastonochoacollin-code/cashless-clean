namespace Cashless.Api.Dtos.Admin;

public record InventoryMovementUpsertDto(int ProductId, int? AreaId, decimal Qty, string? Direction, string? Comment);
