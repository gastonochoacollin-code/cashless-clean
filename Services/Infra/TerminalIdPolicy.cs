namespace Cashless.Api.Services.Infra;

using System.Text.RegularExpressions;

public static partial class TerminalIdPolicy
{
    private static readonly string[] KnownTerminalIds =
    [
        "BARRA-01",
        "BARRA-02",
        "BARRA-03",
        "COMIDA-01",
        "CAJA-01",
        "CAJA-02"
    ];

    public static IReadOnlyList<string> Known => KnownTerminalIds;

    public static string Normalize(string? terminalId)
        => (terminalId ?? string.Empty).Trim().ToUpperInvariant();

    public static bool IsValid(string? terminalId)
    {
        var clean = Normalize(terminalId);
        return !string.IsNullOrWhiteSpace(clean)
            && clean != "DEFAULT"
            && TerminalPattern().IsMatch(clean);
    }

    public static string ValidationMessage =>
        "terminalId requerido. Usa una terminal explicita como BARRA-01, BARRA-02 o COMIDA-01.";

    [GeneratedRegex("^[A-Z0-9][A-Z0-9-]{1,31}$", RegexOptions.CultureInvariant)]
    private static partial Regex TerminalPattern();
}
