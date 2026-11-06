-- Up Migration

-- POOLSE-191: a message to one student, and a WhatsApp record. The enum values
-- alone: a value added by ALTER TYPE cannot be used in the transaction that added
-- it, so the column, the CHECKs and the functions are the next migration.

ALTER TYPE message_audience ADD VALUE IF NOT EXISTS 'student';
ALTER TYPE message_channel ADD VALUE IF NOT EXISTS 'whatsapp';

-- Down Migration

-- Postgres cannot drop an enum value; nothing names them once the next migration
-- is reverted.
SELECT 1;
