-- Aviso de n8n cuando el guion trae actividad y no se pudo asignar/generar (texto libre, se ve en la lista y en el editor del recurso).
ALTER TABLE pipeline_recursos ADD COLUMN IF NOT EXISTS alerta_actividad text;
