namespace Cashless.Api.Services.Infra;

public interface IUidState
{
    void SetLastUid(string uid, string? terminalId = null);
    bool TryPeekLastUid(out string uid);
    bool TryTakeLastUid(out string uid, string? terminalId = null);
    bool ConsumePendingIfMatches(string uid, string? terminalId = null);
}
