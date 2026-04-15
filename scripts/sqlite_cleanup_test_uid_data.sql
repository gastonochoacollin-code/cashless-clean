-- Cleanup seguro de datos de prueba UID/usuarios en SQLite
-- Objetivo: eliminar solo registros de validación tipo "UID Probe*" y "TEST*"
-- Uso recomendado:
--   1) Respaldar DB
--   2) Ejecutar sección PREVIEW
--   3) Revisar resultados
--   4) Ejecutar sección DELETE

PRAGMA foreign_keys = ON;

-- =========================
-- PREVIEW (solo lectura)
-- =========================

-- Usuarios candidatos por nombre/email/teléfono de prueba
SELECT u.Id, u.TenantId, u.Name, u.Email, u.Phone
FROM Users u
WHERE u.Name LIKE 'UID Probe%'
   OR u.Name LIKE 'TEST%'
   OR COALESCE(u.Email, '') LIKE 'test%'
   OR COALESCE(u.Phone, '') LIKE 'test%';

-- Tarjetas candidatas por UID de prueba o usuario candidato
SELECT c.Id, c.TenantId, c.Uid, c.UserId
FROM Cards c
LEFT JOIN Users u ON u.Id = c.UserId
WHERE c.Uid LIKE 'UID Probe%'
   OR c.Uid LIKE 'TEST%'
   OR c.Uid LIKE 'test%'
   OR u.Name LIKE 'UID Probe%'
   OR u.Name LIKE 'TEST%';

-- Transacciones candidatas (por CardUid o User candidato)
SELECT t.Id, t.TenantId, t.UserId, t.CardUid, t.Amount, t.Type, t.CreatedAt
FROM Transactions t
LEFT JOIN Users u ON u.Id = t.UserId
WHERE COALESCE(t.CardUid, '') LIKE 'UID Probe%'
   OR COALESCE(t.CardUid, '') LIKE 'TEST%'
   OR COALESCE(t.CardUid, '') LIKE 'test%'
   OR u.Name LIKE 'UID Probe%'
   OR u.Name LIKE 'TEST%';

-- =========================
-- DELETE (ejecutar solo cuando valides PREVIEW)
-- =========================

BEGIN TRANSACTION;

DROP TABLE IF EXISTS _tmp_test_users;
CREATE TEMP TABLE _tmp_test_users (
  Id INTEGER PRIMARY KEY
);

INSERT INTO _tmp_test_users(Id)
SELECT DISTINCT u.Id
FROM Users u
WHERE u.Name LIKE 'UID Probe%'
   OR u.Name LIKE 'TEST%'
   OR COALESCE(u.Email, '') LIKE 'test%'
   OR COALESCE(u.Phone, '') LIKE 'test%';

INSERT OR IGNORE INTO _tmp_test_users(Id)
SELECT DISTINCT c.UserId
FROM Cards c
WHERE c.Uid LIKE 'UID Probe%'
   OR c.Uid LIKE 'TEST%'
   OR c.Uid LIKE 'test%';

-- SaleItems (si existen ventas de usuarios de prueba)
DELETE FROM SaleItems
WHERE SaleId IN (
  SELECT s.Id
  FROM Sales s
  WHERE s.UserId IN (SELECT Id FROM _tmp_test_users)
);

-- Sales (si existen)
DELETE FROM Sales
WHERE UserId IN (SELECT Id FROM _tmp_test_users);

-- Transactions por usuario o por CardUid de prueba
DELETE FROM Transactions
WHERE UserId IN (SELECT Id FROM _tmp_test_users)
   OR COALESCE(CardUid, '') LIKE 'UID Probe%'
   OR COALESCE(CardUid, '') LIKE 'TEST%'
   OR COALESCE(CardUid, '') LIKE 'test%';

-- Cards por usuario de prueba o UID de prueba
DELETE FROM Cards
WHERE UserId IN (SELECT Id FROM _tmp_test_users)
   OR Uid LIKE 'UID Probe%'
   OR Uid LIKE 'TEST%'
   OR Uid LIKE 'test%';

-- Usuarios de prueba
DELETE FROM Users
WHERE Id IN (SELECT Id FROM _tmp_test_users);

DROP TABLE IF EXISTS _tmp_test_users;

COMMIT;

-- Conteos de control post-limpieza
SELECT 'Users remaining test-like' AS Metric, COUNT(*) AS Qty
FROM Users
WHERE Name LIKE 'UID Probe%' OR Name LIKE 'TEST%';

SELECT 'Cards remaining test-like' AS Metric, COUNT(*) AS Qty
FROM Cards
WHERE Uid LIKE 'UID Probe%' OR Uid LIKE 'TEST%' OR Uid LIKE 'test%';
