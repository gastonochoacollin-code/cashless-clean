namespace Cashless.Api.Services.Auth;

using Microsoft.AspNetCore.Http;
using Cashless.Api.Data;
using Cashless.Api.Models;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;

public class AuthService : IAuthService
{
    public string HashPin(string pin)
    {
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(Encoding.UTF8.GetBytes(pin)));
    }

    public bool ValidatePin(string pin, string pinHash)
        => string.Equals(HashPin(pin), pinHash, StringComparison.OrdinalIgnoreCase);

    public string MakeToken(int operatorId, string pinHash)
    {
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(Encoding.UTF8.GetBytes($"{operatorId}:{pinHash}")));
    }

    public int? ReadTenantId(HttpRequest req)
    {
        string? tenantRaw =
            req.Headers["X-Tenant-Id"].FirstOrDefault()
            ?? req.Headers["X-TenantId"].FirstOrDefault()
            ?? req.Headers["tenantid"].FirstOrDefault()
            ?? req.Headers["TenantId"].FirstOrDefault();

        if (!int.TryParse(tenantRaw, out var id)) return null;
        return id;
    }

    public int? ReadOperatorId(HttpRequest req)
    {
        string? opIdRaw =
            req.Headers["X-Operator-Id"].FirstOrDefault()
            ?? req.Headers["X-OperatorId"].FirstOrDefault()
            ?? req.Headers["operatorid"].FirstOrDefault()
            ?? req.Headers["OperatorId"].FirstOrDefault();

        if (!int.TryParse(opIdRaw, out var id)) return null;
        return id;
    }

    public string? ReadToken(HttpRequest req)
    {
        string? tokenRaw = req.Headers["X-Operator-Token"].FirstOrDefault()
            ?? req.Headers["x-operator-token"].FirstOrDefault()
            ?? req.Headers["token"].FirstOrDefault()
            ?? req.Headers["x-auth-token"].FirstOrDefault()
            ?? req.Headers["x-access-token"].FirstOrDefault()
            ?? req.Headers["x-token"].FirstOrDefault();

        var auth = req.Headers["authorization"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(auth) && auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            tokenRaw ??= auth.Substring("Bearer ".Length).Trim();

        return string.IsNullOrWhiteSpace(tokenRaw) ? null : tokenRaw;
    }

    public async Task<Operator?> AuthenticateAsync(CashlessContext db, HttpRequest req)
    {
        var id = ReadOperatorId(req);
        if (!id.HasValue) return null;

        var tokenRaw = ReadToken(req);
        if (string.IsNullOrWhiteSpace(tokenRaw)) return null;

        var tenantId = ReadTenantId(req);
        var query = db.Operators
            .Include(o => o.Area)
            .Where(o => o.IsActive);

        if (tenantId.HasValue)
            query = query.Where(o => o.TenantId == tenantId.Value);

        var op = await query.FirstOrDefaultAsync(o => o.Id == id.Value);

        if (op is null) return null;

        if (tenantId.HasValue && op.TenantId != tenantId.Value)
            return null;

        var expected = MakeToken(op.Id, op.PinHash);
        if (!string.Equals(expected, tokenRaw, StringComparison.OrdinalIgnoreCase))
            return null;

        return op;
    }
}

