namespace Cashless.Api.Dtos.Recharges;

public sealed class ShiftCloseoutRequestDto
{
    public decimal? PhysicalCash { get; set; }
}

public sealed class ShiftCloseoutBreakdownDto
{
    public decimal TotalEfectivo { get; set; }
    public decimal TotalTarjeta { get; set; }
    public decimal TotalCripto { get; set; }
    public decimal TotalTransferencia { get; set; }
    public decimal TotalOtros { get; set; }
}

public sealed class ShiftCloseoutDto
{
    public int ShiftId { get; set; }
    public int CashierId { get; set; }
    public string Cashier { get; set; } = string.Empty;
    public DateTime TurnoInicio { get; set; }
    public DateTime? TurnoFin { get; set; }
    public int TotalRecargas { get; set; }
    public decimal TotalRecargado { get; set; }
    public ShiftCloseoutBreakdownDto DesglosePorMetodo { get; set; } = new();
    public decimal TotalEfectivoEsperado { get; set; }
    public decimal? EfectivoFisico { get; set; }
    public decimal? DiferenciaContraEfectivoFisico { get; set; }
}

public sealed class ShiftCloseoutPdfModelDto
{
    public string Title { get; set; } = "Corte de Turno";
    public ShiftCloseoutDto Summary { get; set; } = new();
    public List<object> Rows { get; set; } = new();
    public Dictionary<string, object> Metadata { get; set; } = new();
}
