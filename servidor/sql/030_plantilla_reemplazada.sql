-- Reemplazar el archivo de una variante ya no cambia su autor (subida_por): se anota quién la reemplazó y cuándo.
ALTER TABLE plantilla_subidas ADD COLUMN IF NOT EXISTS reemplazada_por uuid REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE plantilla_subidas ADD COLUMN IF NOT EXISTS reemplazada_nombre text;
ALTER TABLE plantilla_subidas ADD COLUMN IF NOT EXISTS reemplazada_en timestamptz;
