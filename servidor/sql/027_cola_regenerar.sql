-- Cola de «regenerar»: si se pide regenerar mientras hay una corrida H5P en curso, los códigos esperan aquí y Praxia lanza otra corrida al llegar el aviso h5p_fin. Idempotente.
CREATE TABLE IF NOT EXISTS regenerar_cola (
  propietario_id uuid NOT NULL,
  proyecto_id    text NOT NULL,
  codigo         text NOT NULL,
  pedido_por     uuid,
  pedido_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (propietario_id, proyecto_id, codigo),
  FOREIGN KEY (propietario_id, proyecto_id) REFERENCES proyectos(propietario_id, id) ON DELETE CASCADE
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ova_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON regenerar_cola TO ova_app;
  END IF;
END $$;
