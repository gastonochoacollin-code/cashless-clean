using Microsoft.Data.Sqlite;

SQLitePCL.Batteries_V2.Init();

var dbPath = args.Length > 0 ? args[0] : @"C:\CashlessData\cashless.db";
using var conn = new SqliteConnection($"Data Source={dbPath}");
conn.Open();

static void PrintQuery(SqliteConnection conn, string title, string sql)
{
    Console.WriteLine($"## {title}");
    using var cmd = conn.CreateCommand();
    cmd.CommandText = sql;
    using var reader = cmd.ExecuteReader();
    var headers = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToArray();
    Console.WriteLine(string.Join("\t", headers));
    while (reader.Read())
    {
        var values = new object?[reader.FieldCount];
        reader.GetValues(values);
        Console.WriteLine(string.Join("\t", values.Select(v => v?.ToString() ?? "NULL")));
    }
    Console.WriteLine();
}

PrintQuery(conn, "Tables", "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
PrintQuery(conn, "UsersSchema", "PRAGMA table_info(Users);");
PrintQuery(conn, "CardsSchema", "PRAGMA table_info(Cards);");
PrintQuery(conn, "OperatorsSchema", "PRAGMA table_info(Operators);");
PrintQuery(conn, "ActiveOperatorsBalance", @"
SELECT o.TenantId, t.Name AS TenantName, COUNT(*) AS ActiveOperators, COALESCE(SUM(u.Balance), 0) AS SumLinkedUserBalance
FROM Operators o
LEFT JOIN Tenants t ON t.Id = o.TenantId
LEFT JOIN Users u ON u.TenantId = o.TenantId
WHERE o.IsActive = 1
GROUP BY o.TenantId, t.Name
ORDER BY o.TenantId;");
PrintQuery(conn, "ActiveCardsUsersBalance", @"
SELECT c.TenantId, t.Name AS TenantName, COUNT(DISTINCT c.UserId) AS ActiveUsers, ROUND(COALESCE(SUM(u.Balance), 0), 2) AS TotalBalance
FROM Cards c
JOIN Users u ON u.Id = c.UserId AND u.TenantId = c.TenantId
LEFT JOIN Tenants t ON t.Id = c.TenantId
WHERE c.IsActive = 1
GROUP BY c.TenantId, t.Name
ORDER BY c.TenantId;");
PrintQuery(conn, "ActiveCardsUsersStats", @"
SELECT
    COUNT(DISTINCT c.UserId) AS ActiveUsers,
    ROUND(COALESCE(SUM(u.Balance), 0), 2) AS TotalBalance,
    ROUND(COALESCE(AVG(u.Balance), 0), 2) AS AvgBalance,
    COUNT(DISTINCT CASE WHEN u.Balance > 0 THEN c.UserId END) AS ActiveUsersWithPositiveBalance,
    ROUND(COALESCE(SUM(CASE WHEN u.Balance > 0 THEN u.Balance ELSE 0 END), 0), 2) AS PositiveBalanceTotal
FROM Cards c
JOIN Users u ON u.Id = c.UserId AND u.TenantId = c.TenantId
WHERE c.IsActive = 1;");
PrintQuery(conn, "Top10ActiveCardsBalances", @"
SELECT u.Id AS UserId, u.Name, ROUND(u.Balance, 2) AS Balance, c.Uid, c.LinkedAt
FROM Cards c
JOIN Users u ON u.Id = c.UserId AND u.TenantId = c.TenantId
WHERE c.IsActive = 1
ORDER BY u.Balance DESC, u.Id ASC
LIMIT 10;");
PrintQuery(conn, "AllUsersVsActiveCards", @"
SELECT
    (SELECT COUNT(*) FROM Users) AS TotalUsers,
    (SELECT COUNT(*) FROM Cards WHERE IsActive = 1) AS ActiveCards,
    (SELECT COUNT(DISTINCT UserId) FROM Cards WHERE IsActive = 1) AS ActiveUsersByCard,
    (SELECT ROUND(COALESCE(SUM(Balance), 0), 2) FROM Users) AS TotalUsersBalance;");
PrintQuery(conn, "ActiveCardsUserDetail", @"
SELECT c.TenantId, t.Name AS TenantName, u.Id AS UserId, u.Name, ROUND(u.Balance, 2) AS Balance, c.Uid, c.LinkedAt
FROM Cards c
JOIN Users u ON u.Id = c.UserId AND u.TenantId = c.TenantId
LEFT JOIN Tenants t ON t.Id = c.TenantId
WHERE c.IsActive = 1
ORDER BY c.TenantId, u.Id;");
