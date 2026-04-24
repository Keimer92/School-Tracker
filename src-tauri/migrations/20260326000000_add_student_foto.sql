-- Add foto field to estudiante table
ALTER TABLE estudiante ADD COLUMN IF NOT EXISTS foto TEXT;

-- Add foto field to estudiante table in Rust struct
-- Note: This is handled in the Rust code, not in SQL
