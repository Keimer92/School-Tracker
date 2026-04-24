-- Migration to add contact fields to estudiante table
ALTER TABLE estudiante ADD COLUMN telefono TEXT;
ALTER TABLE estudiante ADD COLUMN direccion TEXT;
ALTER TABLE estudiante ADD COLUMN email TEXT;
