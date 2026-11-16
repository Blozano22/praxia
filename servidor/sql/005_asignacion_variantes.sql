-- Asignación de variantes de plantilla HTML por curso. ANTES de generar los guiones, un flujo de n8n pide a Praxia una variante para cada recurso del curso
-- y Praxia las reparte entre las variantes APROBADAS de la formación del curso, sin repetir ninguna dentro de la misma categoría en todo el curso
-- (ni en la misma unidad ni en otras). Esta tabla guarda lo asignado: una fila por recurso (código de posición «U1-T2-R3», «U1-PRES»).
-- Se ejecuta con el usuario DUEÑO. Es idempotente y no borra datos; solo crea una tabla y amplía una restricción de pipeline_origen.
--
-- Reglas que hace cumplir la base (no el flujo de n8n):
--  · Un recurso (código) tiene UNA fila por curso y persona.
--  · Una variante concreta solo la puede tener UN recurso por curso y categoría (índice único parcial).
--  · «asignada» ⇔ tiene plantilla. Si la plantilla se elimina, se mueve de categoría o su categoría se elimina, la fila pasa a «invalida»
--    (la plantilla queda en plantilla_anterior y el motivo dice qué pasó); NO se reasigna sola.
--  · «pendiente» = no se pudo asignar (sin variantes aprobadas, o ya se usaron todas): lleva siempre su motivo.

BEGIN;

-- n8n identifica la tanda con un trabajo_id que Praxia registró en pipeline_origen; la preparación del curso es una etapa más.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_origen_etapa_check' AND pg_get_constraintdef(oid) NOT LIKE '%preparacion%') THEN
    ALTER TABLE pipeline_origen DROP CONSTRAINT pipeline_origen_etapa_check;
    ALTER TABLE pipeline_origen ADD CONSTRAINT pipeline_origen_etapa_check CHECK (etapa IN ('guiones','matrices','h5p','preparacion'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS asignacion_variantes (
  id                 bigserial PRIMARY KEY,
  propietario_id     uuid NOT NULL,
  proyecto_id        text NOT NULL,
  codigo             text NOT NULL CHECK (codigo ~ '^U[0-9]{1,3}-(PRES|T[0-9]{1,2}-R[0-9]{1,3})$'),
  unidad             integer CHECK (unidad IS NULL OR unidad BETWEEN 0 AND 999),
  id_catalogo        text CHECK (id_catalogo IS NULL OR char_length(id_catalogo) <= 100), -- «G-12-A»: se repite entre temas, no es clave
  id_base            text CHECK (id_base IS NULL OR char_length(id_base) <= 100),
  categoria          text NOT NULL CHECK (char_length(categoria) BETWEEN 1 AND 20),      -- «G-12», «PRE-05», «POS-11»
  formacion          text NOT NULL CHECK (formacion IN ('tecnologico', 'profesional', 'especializacion', 'doctorado')),
  plantilla          text CHECK (plantilla IS NULL OR plantilla ~ '^[a-z0-9-]{1,80}$'),   -- nombre de la variante (g-12-tec-v02); NULL si no está asignada
  plantilla_anterior text CHECK (plantilla_anterior IS NULL OR plantilla_anterior ~ '^[a-z0-9-]{1,80}$'),
  estado             text NOT NULL CHECK (estado IN ('asignada', 'pendiente', 'invalida')),
  motivo             text CHECK (motivo IS NULL OR char_length(motivo) <= 300),
  trabajo_id         uuid,                                                                  -- la tanda de n8n que la pidió
  asignada_en        timestamptz,
  creado             timestamptz NOT NULL DEFAULT now(),
  actualizado        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (propietario_id, proyecto_id) REFERENCES proyectos (propietario_id, id) ON DELETE CASCADE,
  CONSTRAINT asignacion_variantes_codigo_uq UNIQUE (propietario_id, proyecto_id, codigo),
  CONSTRAINT asignacion_variantes_estado_ck CHECK ((estado = 'asignada') = (plantilla IS NOT NULL)),
  CONSTRAINT asignacion_variantes_motivo_ck CHECK (estado = 'asignada' OR motivo IS NOT NULL)
);
-- La regla de Roger: en un curso, una variante no se repite dentro de su categoría.
-- En las categorías de actividad, cuando ya se usaron todas las variantes del tipo pedido, se REPITE una y se avisa (repetida = true): esas filas quedan fuera de la regla de unicidad.
ALTER TABLE asignacion_variantes ADD COLUMN IF NOT EXISTS repetida boolean NOT NULL DEFAULT false;
DROP INDEX IF EXISTS asignacion_variantes_variante_uq;
CREATE UNIQUE INDEX IF NOT EXISTS asignacion_variantes_variante_uq2 ON asignacion_variantes (propietario_id, proyecto_id, categoria, plantilla) WHERE plantilla IS NOT NULL AND NOT repetida;
CREATE INDEX IF NOT EXISTS asignacion_variantes_plantilla_ix ON asignacion_variantes (plantilla) WHERE plantilla IS NOT NULL;
CREATE INDEX IF NOT EXISTS asignacion_variantes_categoria_ix ON asignacion_variantes (categoria);

-- Sin seguridad por fila: solo la toca el servidor (el receptor firmado de n8n y las pantallas de plantillas), como las tablas pipeline_*.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ova_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON asignacion_variantes TO ova_app;
    GRANT USAGE, SELECT ON SEQUENCE asignacion_variantes_id_seq TO ova_app;
  END IF;
END $$;

COMMIT;
