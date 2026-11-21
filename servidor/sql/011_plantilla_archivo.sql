-- Plantillas subidas «archivadas»: siguen guardadas (y se siguen entregando por su dirección, para editar los recursos ya generados con ellas) pero salen de las categorías,
-- del índice para n8n, de la comparación de campos y del reparto de variantes. Se pueden restaurar.
ALTER TABLE plantilla_subidas ADD COLUMN IF NOT EXISTS archivada_en timestamptz;
ALTER TABLE plantilla_subidas ADD COLUMN IF NOT EXISTS archivada_por text;
