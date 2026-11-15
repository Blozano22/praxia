-- VUELVE ATRÁS la migración 005 (asignación de variantes). Se ejecuta con el usuario DUEÑO. Borra la tabla asignacion_variantes y SUS DATOS.
-- No toca nada más: la restricción de pipeline_origen (que ahora admite la etapa «preparacion») se deja como está, porque quitarla fallaría si ya hay trabajos de esa etapa
-- y no estorba (solo permite un valor más).
-- Esta carpeta NO la lee «npm run db:migrar» (solo ejecuta los .sql de servidor/sql).
BEGIN;
DROP TABLE IF EXISTS asignacion_variantes;
COMMIT;
