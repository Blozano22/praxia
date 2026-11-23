-- La distribución de variantes únicas pasa de ser POR CURSO a ser POR UNIDAD: una variante no se repite dentro de una misma unidad (en su categoría), pero la misma variante
-- sí puede usarse en otra unidad del mismo curso. La regla la sigue haciendo cumplir la base. Es más permisiva que la anterior, así que lo ya asignado sigue siendo válido.
-- Se ejecuta con el usuario DUEÑO. Idempotente.
DROP INDEX IF EXISTS asignacion_variantes_variante_uq2;
CREATE UNIQUE INDEX IF NOT EXISTS asignacion_variantes_variante_uq3 ON asignacion_variantes (propietario_id, proyecto_id, coalesce(unidad, -1), categoria, plantilla) WHERE plantilla IS NOT NULL AND NOT repetida;
