-- Cuándo la persona aprobó (y pidió publicar en Drive) el contenido de un recurso H5P. Mientras sea posterior al último aviso de n8n, el recurso se está publicando.
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS aprobado_en timestamptz;
-- Estado nuevo «POR_REVISAR»: el flujo de H5P terminó de generar el contenido y espera la aprobación de la persona antes de armar y publicar el .h5p.
ALTER TABLE pipeline_recursos DROP CONSTRAINT IF EXISTS pipeline_recursos_estado_check;
ALTER TABLE pipeline_recursos ADD CONSTRAINT pipeline_recursos_estado_check CHECK (estado IN ('PENDIENTE','EN_PROCESO','POR_REVISAR','GENERADO','ERROR'));
