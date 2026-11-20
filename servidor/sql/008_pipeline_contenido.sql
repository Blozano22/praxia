-- Contenido final (JSON) con el que el flujo de H5P generó cada recurso: es lo que se edita en Praxia y de lo que se vuelve a armar el .h5p.
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS contenido jsonb;
-- Cuántos campos quedaron para revisión humana al generar el recurso (0 = ninguno; null = el flujo no lo informó).
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS revision_pendiente integer;
