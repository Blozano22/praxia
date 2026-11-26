-- Estado de «diseño» de un curso: sin fila = el curso está con el docente. Al «Enviar a diseño» se crea la fila (en_diseno);
-- un diseñador lo toma (asignado) y puede devolverlo al docente para corregir guiones (en_revision_docente). Idempotente.
CREATE TABLE IF NOT EXISTS curso_diseno (
  propietario_id uuid NOT NULL,
  proyecto_id    text NOT NULL,
  estado         text NOT NULL CHECK (estado IN ('en_diseno','asignado','en_revision_docente')),
  disenador_id   uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  enviado_en     timestamptz NOT NULL DEFAULT now(),
  enviado_por    uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  asignado_en    timestamptz,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (propietario_id, proyecto_id),
  FOREIGN KEY (propietario_id, proyecto_id) REFERENCES proyectos(propietario_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS curso_diseno_disenador_idx ON curso_diseno (disenador_id) WHERE disenador_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ova_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON curso_diseno TO ova_app;
  END IF;
END $$;
