namespace Cashless.Api.Services.Infra;

public static class DateTimeProvider
{
    // Hora local fija Mexico (UTC-06:00), sin depender de la zona del servidor.
    private static readonly TimeSpan MexicoFixedOffset = TimeSpan.FromHours(-6);

    public static DateTime NowMexico()
    {
        var mxNow = DateTime.UtcNow + MexicoFixedOffset;

        // Override opcional para fijar hora exacta (ej: 20:20) en todas las operaciones.
        // Variable de entorno: CASHLESS_FIXED_LOCAL_TIME=20:20
        var fixedTime = Environment.GetEnvironmentVariable("CASHLESS_FIXED_LOCAL_TIME");
        if (!string.IsNullOrWhiteSpace(fixedTime) && TimeOnly.TryParse(fixedTime, out var tod))
        {
            var d = DateOnly.FromDateTime(mxNow);
            return d.ToDateTime(tod);
        }

        return DateTime.SpecifyKind(mxNow, DateTimeKind.Unspecified);
    }

    public static DateTime TodayMexico()
        => NowMexico().Date;

    public static DateTime ConvertToMexico(DateTime value)
    {
        if (value.Kind == DateTimeKind.Utc)
            return DateTime.SpecifyKind(value + MexicoFixedOffset, DateTimeKind.Unspecified);
        if (value.Kind == DateTimeKind.Local && TimeZoneInfo.Local.BaseUtcOffset != MexicoFixedOffset)
            return DateTime.SpecifyKind(value.ToUniversalTime() + MexicoFixedOffset, DateTimeKind.Unspecified);
        return DateTime.SpecifyKind(value, DateTimeKind.Unspecified);
    }
}
