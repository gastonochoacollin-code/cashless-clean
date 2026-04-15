-- Manual script (SQLite): reset seguro de saldo/gastado SOLO para usuarios de prueba por patron.
-- NO hace DELETE total. NO se ejecuta automaticamente.
-- Ajusta patrones antes de correr en produccion.

BEGIN TRANSACTION;

UPDATE Users
SET Balance = 0,
    TotalSpent = 0
WHERE UPPER(COALESCE(Name, '')) LIKE 'TEST%'
   OR UPPER(COALESCE(Name, '')) LIKE 'PROBE%'
   OR UPPER(COALESCE(Email, '')) LIKE '%@TEST.%'
   OR UPPER(COALESCE(Email, '')) LIKE 'TEST@%'
   OR UPPER(COALESCE(Phone, '')) LIKE '555%';

COMMIT;

