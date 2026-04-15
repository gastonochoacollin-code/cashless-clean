-- SQL Server script: Recharges module
IF OBJECT_ID('dbo.Recharges', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Recharges
    (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        CashierId INT NOT NULL,
        ShiftId INT NOT NULL,
        Amount DECIMAL(18,2) NOT NULL,
        PaymentMethod VARCHAR(50) NOT NULL,
        PaymentDetail VARCHAR(200) NULL,
        Comment VARCHAR(500) NULL,
        CreatedAt DATETIME NOT NULL CONSTRAINT DF_Recharges_CreatedAt DEFAULT (GETDATE()),
        TenantId INT NOT NULL,

        CONSTRAINT FK_Recharges_Operators_CashierId FOREIGN KEY (CashierId) REFERENCES dbo.Operators(Id),
        CONSTRAINT FK_Recharges_Shifts_ShiftId FOREIGN KEY (ShiftId) REFERENCES dbo.Shifts(Id),
        CONSTRAINT FK_Recharges_Tenants_TenantId FOREIGN KEY (TenantId) REFERENCES dbo.Tenants(Id),

        CONSTRAINT CK_Recharges_PaymentMethod CHECK (PaymentMethod IN ('EFECTIVO','TARJETA','CRIPTO','TRANSFERENCIA','OTRO')),
        CONSTRAINT CK_Recharges_PaymentDetail_Tarjeta CHECK (
            PaymentMethod <> 'TARJETA' OR (PaymentDetail IS NOT NULL AND LTRIM(RTRIM(PaymentDetail)) <> '')
        )
    );

    CREATE INDEX IX_Recharges_Tenant_Cashier_Shift_CreatedAt
        ON dbo.Recharges (TenantId, CashierId, ShiftId, CreatedAt);
END
GO

