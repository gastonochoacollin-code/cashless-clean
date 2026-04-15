namespace Cashless.Api.Endpoints;

using Cashless.Api.Data;
using Cashless.Api.Models;
using Cashless.Api.Services.Auth;
using Cashless.Api.Services.Infra;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;

public static class ExportEndpoints
{
    private const string ExcelContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static WebApplication MapExportEndpoints(this WebApplication app)
    {
        app.MapGet("/api/export/users-excel", ExportUsersExcel)
            .WithName("ExportUsersExcel")
            .Produces(StatusCodes.Status200OK, contentType: ExcelContentType)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden);

        return app;
    }

    private static async Task<IResult> ExportUsersExcel(
        CashlessContext db,
        HttpContext http,
        IAuthService auth)
    {
        var op = await auth.AuthenticateAsync(db, http.Request);
        if (op is null) return Results.Unauthorized();

        if (op.Role != OperatorRole.SuperAdmin
            && op.Role != OperatorRole.Admin
            && op.Role != OperatorRole.JefeOperativo)
        {
            return Results.Json(new { message = "Forbidden. Rol sin acceso a exportacion de usuarios." }, statusCode: 403);
        }

        var users = await db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == op.TenantId)
            .OrderByDescending(u => u.CreatedAt)
            .ToListAsync();

        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("Users");

        var headers = new[]
        {
            "Id",
            "Name",
            "Email",
            "Phone",
            "Balance",
            "TotalSpent",
            "CreatedAt"
        };

        for (var col = 0; col < headers.Length; col++)
        {
            worksheet.Cell(1, col + 1).Value = headers[col];
        }

        var headerRange = worksheet.Range(1, 1, 1, headers.Length);
        headerRange.Style.Font.Bold = true;

        for (var i = 0; i < users.Count; i++)
        {
            var user = users[i];
            var row = i + 2;

            worksheet.Cell(row, 1).Value = user.Id;
            worksheet.Cell(row, 2).Value = user.Name ?? string.Empty;
            worksheet.Cell(row, 3).Value = user.Email ?? string.Empty;
            worksheet.Cell(row, 4).Value = user.Phone ?? string.Empty;
            worksheet.Cell(row, 5).Value = user.Balance;
            worksheet.Cell(row, 6).Value = user.TotalSpent;
            worksheet.Cell(row, 7).Value = user.CreatedAt;
        }

        worksheet.Column(5).Style.NumberFormat.Format = "$#,##0.00";
        worksheet.Column(6).Style.NumberFormat.Format = "$#,##0.00";
        worksheet.Column(7).Style.DateFormat.Format = "yyyy-mm-dd hh:mm:ss";
        worksheet.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);

        var stamp = DateTimeProvider.NowMexico().ToString("yyyyMMdd_HHmmss");
        var fileName = $"users_export_{stamp}.xlsx";

        return Results.File(stream.ToArray(), ExcelContentType, fileName);
    }
}
