namespace Cashless.Api.Services.Infra;

public sealed class InMemoryUidState : IUidState
{
    private readonly object _lock = new();
    private readonly Dictionary<string, string> _lastByTerminal = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _pendingByTerminal = new(StringComparer.OrdinalIgnoreCase);

    public void SetLastUid(string uid, string? terminalId = null)
    {
        lock (_lock)
        {
            var key = NormalizeTerminal(terminalId);
            _lastByTerminal[key] = uid;
            _pendingByTerminal[key] = uid;
        }
    }

    public bool TryPeekLastUid(out string uid)
    {
        lock (_lock)
        {
            if (_lastByTerminal.Values.FirstOrDefault() is { } last)
            {
                uid = last;
                return true;
            }

            uid = string.Empty;
            return false;
        }
    }

    public bool TryTakeLastUid(out string uid, string? terminalId = null)
    {
        lock (_lock)
        {
            var key = NormalizeTerminal(terminalId);
            if (_lastByTerminal.TryGetValue(key, out var termUid))
            {
                uid = termUid;
                _lastByTerminal.Remove(key);
                return true;
            }

            uid = string.Empty;
            return false;
        }
    }

    public bool ConsumePendingIfMatches(string uid, string? terminalId = null)
    {
        lock (_lock)
        {
            var key = NormalizeTerminal(terminalId);
            if (_pendingByTerminal.TryGetValue(key, out var pending))
            {
                if (!string.Equals(pending, uid, StringComparison.Ordinal))
                    return false;

                if (_lastByTerminal.TryGetValue(key, out var last) && string.Equals(last, uid, StringComparison.Ordinal))
                    _lastByTerminal.Remove(key);

                _pendingByTerminal.Remove(key);
                return true;
            }

            return false;
        }
    }

    private static string NormalizeTerminal(string? terminalId)
    {
        var clean = TerminalIdPolicy.Normalize(terminalId);
        if (!TerminalIdPolicy.IsValid(clean))
            throw new InvalidOperationException(TerminalIdPolicy.ValidationMessage);

        return clean;
    }
}
