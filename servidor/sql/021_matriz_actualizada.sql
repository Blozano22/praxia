-- Estado nuevo de una matriz: «actualizada» (n8n conservó la matriz y solo añadió la columna «Actividad usada»). Idempotente.
DO $$
DECLARE n text;
BEGIN
  FOR n IN SELECT c.conname FROM pg_constraint c
            WHERE c.conrelid = 'pipeline_matrices'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE pipeline_matrices DROP CONSTRAINT %I', n);
  END LOOP;
  ALTER TABLE pipeline_matrices ADD CONSTRAINT pipeline_matrices_estado_check CHECK (estado IN ('generando','creada','omitida','reemplazada','actualizada','error'));
END $$;
