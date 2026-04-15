-- Anti-duplicado de recargas por UID
-- Ejecutar manualmente segun motor (SQL Server o SQLite).

/* =========================
   SQL SERVER
   ========================= */
IF COL_LENGTH('dbo.Recharges', 'CardUid') IS NULL
BEGIN
    ALTER TABLE dbo.Recharges ADD CardUid VARCHAR(100) NULL;
    UPDATE dbo.Recharges SET CardUid = '' WHERE CardUid IS NULL;
    ALTER TABLE dbo.Recharges ALTER COLUMN CardUid VARCHAR(100) NOT NULL;
END;

IF COL_LENGTH('dbo.Recharges', 'ReaderId') IS NULL
BEGIN
    ALTER TABLE dbo.Recharges ADD ReaderId VARCHAR(100) NULL;
END;

IF COL_LENGTH('dbo.Recharges', 'ClientId') IS NULL
BEGIN
    ALTER TABLE dbo.Recharges ADD ClientId VARCHAR(100) NULL;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_Recharges_Tenant_CardUid_CreatedAt'
      AND object_id = OBJECT_ID('dbo.Recharges')
)
BEGIN
    CREATE INDEX IX_Recharges_Tenant_CardUid_CreatedAt
    ON dbo.Recharges (TenantId, CardUid, CreatedAt DESC);
END;
GO

/* =========================
   SQLITE
   ========================= */
ALTER TABLE Recharges ADD COLUMN CardUid TEXT NOT NULL DEFAULT '';
ALTER TABLE Recharges ADD COLUMN ReaderId TEXT NULL;
ALTER TABLE Recharges ADD COLUMN ClientId TEXT NULL;
CREATE INDEX IF NOT EXISTS IX_Recharges_Tenant_CardUid_CreatedAt
ON Recharges (TenantId, CardUid, CreatedAt DESC);
