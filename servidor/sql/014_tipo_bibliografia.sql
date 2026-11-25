-- Tercer tipo de categoría de plantillas: «bibliografia» (una plantilla HTML por formación para mostrar las referencias). Idempotente.
DO $$
DECLARE n text;
BEGIN
  FOR n IN SELECT c.conname FROM pg_constraint c
            WHERE c.conrelid = 'plantilla_categorias'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%tipo%'
  LOOP
    EXECUTE format('ALTER TABLE plantilla_categorias DROP CONSTRAINT %I', n);
  END LOOP;
  ALTER TABLE plantilla_categorias ADD CONSTRAINT plantilla_categorias_tipo_check CHECK (tipo IN ('recurso', 'actividad', 'bibliografia'));
END $$;
