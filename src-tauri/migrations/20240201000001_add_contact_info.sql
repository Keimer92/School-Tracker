-- Migration to add contact fields to estudiante table
ALTER TABLE estudiante ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE estudiante ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE estudiante ADD COLUMN IF NOT EXISTS email TEXT;
