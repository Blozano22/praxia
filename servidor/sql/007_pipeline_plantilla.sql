-- La plantilla HTML con la que n8n generó (o generará) cada recurso, por ejemplo «g-11-doc-v01» (la avisa n8n en h5p_recurso / matrices_fin).
-- Idempotente; se ejecuta con el usuario DUEÑO. ova_app ya tiene permisos sobre la tabla completa.
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS plantilla text;
