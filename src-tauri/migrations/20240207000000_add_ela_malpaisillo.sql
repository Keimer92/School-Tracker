-- Migration to add active column to colegio and set default
-- Using a safer approach: ignore error if column exists by wrapping in a way that doesn't fail the batch if possible,
-- but since lib.rs ignores the error of the whole batch, we can keep it simple.

-- Try to add the column (will fail if already exists, which is fine as it's caught in lib.rs)
ALTER TABLE colegio ADD COLUMN activo INTEGER DEFAULT 0;

-- Insert ELA Malpaisillo if it doesn't exist
INSERT OR IGNORE INTO colegio (nombre, activo) VALUES ('ELA Malpaisillo', 0);

-- Set Candelario Sotelo as the active (default) school
UPDATE colegio SET activo = 0;
UPDATE colegio SET activo = 1 WHERE nombre = 'Candelario Sotelo';
