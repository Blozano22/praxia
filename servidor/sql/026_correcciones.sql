-- Fase 4 del diseño: el diseñador pide correcciones al docente por recurso y ambos conversan en un hilo. Sin RLS (se filtra en las consultas). Idempotente.
CREATE TABLE IF NOT EXISTS correcciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id uuid NOT NULL,
  proyecto_id    text NOT NULL,
  recurso_id     text NOT NULL,
  codigo         text,
  estado         text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','corregida','cerrada')),
  creado_por     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  corregido_en   timestamptz,
  cerrado_en     timestamptz,
  FOREIGN KEY (propietario_id, proyecto_id) REFERENCES proyectos(propietario_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS correcciones_curso_idx ON correcciones (propietario_id, proyecto_id, estado);

CREATE TABLE IF NOT EXISTS correccion_mensajes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correccion_id uuid NOT NULL REFERENCES correcciones(id) ON DELETE CASCADE,
  autor_id      uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  rol           text NOT NULL CHECK (rol IN ('disenador','docente')),
  texto         text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 4000),
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS correccion_mensajes_idx ON correccion_mensajes (correccion_id, creado_en);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ova_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON correcciones, correccion_mensajes TO ova_app;
  END IF;
END $$;
