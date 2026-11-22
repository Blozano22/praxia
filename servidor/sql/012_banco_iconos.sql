-- Banco de íconos: SVG reemplazables que el flujo de H5P coloca en los campos «icono» de las plantillas. Se suben aparte (paquete .json o uno a uno), no se extraen del HTML.
-- Se ejecuta con el usuario DUEÑO. Es idempotente y no borra datos.
-- Cada ícono se guarda ya NORMALIZADO (sin colores fijos: currentColor y var(--ico-2, currentColor)); «tipo» separa los de recursos de los de actividades.
-- Sin seguridad por fila: solo la toca el servidor (la pantalla de plantillas y el servicio de H5P con su clave).

CREATE TABLE IF NOT EXISTS banco_iconos (
  id             text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(id) <= 80),
  tipo           text NOT NULL CHECK (tipo IN ('recurso', 'actividad')),
  svg            text NOT NULL CHECK (char_length(svg) <= 70000),
  viewbox        text NOT NULL,
  hash           text NOT NULL,                       -- del dibujo normalizado (sin depender del id): detecta el mismo ícono subido dos veces
  categoria      text CHECK (categoria IS NULL OR char_length(categoria) <= 80),
  subcategoria   text CHECK (subcategoria IS NULL OR char_length(subcategoria) <= 80),
  nombre_es      text NOT NULL CHECK (char_length(nombre_es) BETWEEN 1 AND 80),
  nombre_en      text NOT NULL CHECK (char_length(nombre_en) BETWEEN 1 AND 80),
  etiquetas_es   text[] NOT NULL DEFAULT '{}',
  etiquetas_en   text[] NOT NULL DEFAULT '{}',
  descripcion    text NOT NULL CHECK (char_length(descripcion) <= 400),
  prompt         text NOT NULL CHECK (char_length(prompt) <= 2000),
  estilo         text NOT NULL CHECK (estilo ~ '^[a-z0-9-]{1,40}$'),
  tonos          smallint NOT NULL CHECK (tonos IN (1, 2)),
  conjunto       text CHECK (conjunto IS NULL OR char_length(conjunto) <= 60),
  subido_nombre  text NOT NULL DEFAULT '' CHECK (char_length(subido_nombre) <= 120),
  archivado_en   timestamptz,
  archivado_por  text CHECK (archivado_por IS NULL OR char_length(archivado_por) <= 120),
  creado         timestamptz NOT NULL DEFAULT now(),
  actualizado    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS banco_iconos_hash_ix ON banco_iconos (tipo, hash);
CREATE INDEX IF NOT EXISTS banco_iconos_tipo_ix ON banco_iconos (tipo, estilo) WHERE archivado_en IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ova_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON banco_iconos TO ova_app;
  END IF;
END $$;
