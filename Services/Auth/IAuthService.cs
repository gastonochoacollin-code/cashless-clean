namespace Cashless.Api.Services.Auth;

using Microsoft.AspNetCore.Http;
using Cashless.Api.Data;
using Cashless.Api.Models;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;

public interface IAuthService
{
    string HashPin(string pin);
    bool ValidatePin(string pin, string pinHash);
    string MakeToken(int operatorId, string pinHash);
    int? ReadTenantId(HttpRequest req);
    string? ReadToken(HttpRequest req);
    int? ReadOperatorId(HttpRequest req);
    Task<Operator?> AuthenticateAsync(CashlessContext db, HttpRequest req);
}

