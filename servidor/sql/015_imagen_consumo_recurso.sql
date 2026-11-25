-- Imagen del recurso (miniatura en Drive) y consumo de IA que n8n avisa al generar cada recurso H5P. Idempotente.
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS imagen_url text;
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS consumo jsonb;
