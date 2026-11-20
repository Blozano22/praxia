-- Cuándo se editó a mano el contenido de un recurso H5P desde la pantalla del curso (null = tal como lo generó el flujo).
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS contenido_editado_en timestamptz;
