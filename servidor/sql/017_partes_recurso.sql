-- Partes extra del recurso H5P: actividad y bibliografía dentro del mismo H5P.
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS tipo_actividad text;
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS actividad_guion jsonb;
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS actividad jsonb;
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS bibliografia jsonb;
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS actividad_editado_en timestamptz;
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS bibliografia_editado_en timestamptz;
