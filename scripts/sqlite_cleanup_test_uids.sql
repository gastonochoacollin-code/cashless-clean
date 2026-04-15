-- Manual script (SQLite): limpia UIDs de prueba y tarjetas asociadas.
-- NO se ejecuta automaticamente.
-- Uso sugerido: revisar primero con SELECT y luego ejecutar en mantenimiento.

BEGIN TRANSACTION;

-- 1) CardAudit relacionado a UIDs de prueba
DELETE FROM CardAudits
WHERE UPPER(COALESCE(OldUid, '')) LIKE 'PROBE%'
   OR UPPER(COALESCE(OldUid, '')) LIKE 'TEST%'
   OR UPPER(COALESCE(NewUid, '')) LIKE 'PROBE%'
   OR UPPER(COALESCE(NewUid, '')) LIKE 'TEST%';

-- 2) Transacciones relacionadas por CardUid (solo patrones de prueba)
DELETE FROM Transactions
WHERE UPPER(COALESCE(CardUid, '')) LIKE 'PROBE%'
   OR UPPER(COALESCE(CardUid, '')) LIKE 'TEST%';

-- 3) Tarjetas de prueba
DELETE FROM Cards
WHERE UPPER(REPLACE(TRIM(COALESCE(Uid, '')), ' ', '')) LIKE 'PROBE%'
   OR UPPER(REPLACE(TRIM(COALESCE(Uid, '')), ' ', '')) LIKE 'TEST%';

COMMIT;

