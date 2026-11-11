-- Bibliografía de un syllabus: de la referencia escrita al contenido completo de cada fuente, siempre citable.
--
--   bib_trabajos   -> una corrida por syllabus (progreso y estado)
--   bib_fuentes    -> cada referencia de la bibliografía, con sus metadatos y su cita APA 7
--   bib_autores    -> autores de cada fuente, en orden
--   bib_documentos -> cada archivo o página obtenida (PDF, HTML, DOCX) con su huella (sha256)
--   bib_paginas    -> TODO el texto, página por página (en HTML, bloque por bloque), para citar con número de página
--
-- Relaciones: trabajo 1—N fuentes 1—N documentos 1—N páginas · fuente 1—N autores.
-- Toda fila lleva propietario_id y la política de filas (RLS) es la misma de proyectos: cada persona ve lo suyo,
-- y quien tiene proyectos.ver_todos puede leer (nunca escribir) lo de los demás.
BEGIN;

CREATE TABLE IF NOT EXISTS bib_trabajos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proyecto_id    text CHECK (char_length(proyecto_id) <= 64),
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','procesando','listo','error')),
  total          integer NOT NULL DEFAULT 0,
  resueltas      integer NOT NULL DEFAULT 0,
  fallidas       integer NOT NULL DEFAULT 0,
  detalle        text CHECK (char_length(detalle) <= 500),
  creado         timestamptz NOT NULL DEFAULT now(),
  actualizado    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bib_trabajos_prop_ix ON bib_trabajos (propietario_id, creado DESC);
-- Documento de Google (su identificador) del que se leyó la bibliografía: así la lectura se encuentra por el enlace del syllabus
-- desde cualquier pestaña o equipo, sin depender de la memoria de una pestaña.
ALTER TABLE bib_trabajos ADD COLUMN IF NOT EXISTS syllabus_doc text CHECK (syllabus_doc IS NULL OR char_length(syllabus_doc) <= 120);
CREATE INDEX IF NOT EXISTS bib_trabajos_doc_ix ON bib_trabajos (propietario_id, syllabus_doc, creado DESC);

CREATE TABLE IF NOT EXISTS bib_fuentes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajo_id      uuid NOT NULL REFERENCES bib_trabajos(id) ON DELETE CASCADE,
  propietario_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  orden           integer NOT NULL,
  entrada_cruda   text NOT NULL CHECK (char_length(entrada_cruda) <= 2000),   -- tal como estaba en el syllabus
  unidad          integer CHECK (unidad BETWEEN 1 AND 99),                    -- unidad del syllabus a la que pertenece
  categoria       text CHECK (categoria IN ('basica','complementaria')),
  url             text CHECK (char_length(url) <= 2000),
  doi             text CHECK (char_length(doi) <= 200),
  tipo            text NOT NULL DEFAULT 'otro' CHECK (tipo IN ('articulo','libro','capitulo','web','informe','tesis','otro')),
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','resuelta','parcial','sin_acceso','error')),
  estado_detalle  text CHECK (char_length(estado_detalle) <= 500),
  titulo          text CHECK (char_length(titulo) <= 1000),
  anio            text CHECK (char_length(anio) <= 20),
  editorial       text CHECK (char_length(editorial) <= 300),
  publicacion     text CHECK (char_length(publicacion) <= 500),               -- revista, sitio web o libro que contiene la obra
  volumen         text CHECK (char_length(volumen) <= 40),
  numero          text CHECK (char_length(numero) <= 40),
  paginas         text CHECK (char_length(paginas) <= 40),
  edicion         text CHECK (char_length(edicion) <= 40),
  idioma          text CHECK (char_length(idioma) <= 20),
  url_final       text CHECK (char_length(url_final) <= 2000),
  fuente_datos    text CHECK (char_length(fuente_datos) <= 60),               -- de dónde salieron los metadatos: crossref, pdf, html, texto
  fecha_consulta  date,
  referencia_apa  text,                                                       -- entrada de la lista de referencias
  cita_apa        text,                                                       -- cita en el texto: (Autor, año)
  creado          timestamptz NOT NULL DEFAULT now(),
  actualizado     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trabajo_id, orden)
);
CREATE INDEX IF NOT EXISTS bib_fuentes_trabajo_ix ON bib_fuentes (trabajo_id, orden);
CREATE INDEX IF NOT EXISTS bib_fuentes_doi_ix ON bib_fuentes (doi) WHERE doi IS NOT NULL;

CREATE TABLE IF NOT EXISTS bib_autores (
  id             bigserial PRIMARY KEY,
  fuente_id      uuid NOT NULL REFERENCES bib_fuentes(id) ON DELETE CASCADE,
  propietario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  orden          integer NOT NULL,
  apellido       text NOT NULL CHECK (char_length(apellido) <= 200),          -- o nombre de la organización
  nombres        text CHECK (char_length(nombres) <= 200),
  institucional  boolean NOT NULL DEFAULT false,
  UNIQUE (fuente_id, orden)
);

CREATE TABLE IF NOT EXISTS bib_documentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fuente_id      uuid NOT NULL REFERENCES bib_fuentes(id) ON DELETE CASCADE,
  propietario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  url            text NOT NULL CHECK (char_length(url) <= 2000),
  formato        text NOT NULL CHECK (formato IN ('pdf','html','docx')),
  rol            text NOT NULL DEFAULT 'texto' CHECK (rol IN ('texto','pagina_de_acceso')),
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','extraido','error')),
  error          text CHECK (char_length(error) <= 500),
  bytes          integer,
  sha256         text CHECK (char_length(sha256) = 64),
  num_paginas    integer,
  num_caracteres integer,
  creado         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fuente_id, url)
);
CREATE INDEX IF NOT EXISTS bib_documentos_fuente_ix ON bib_documentos (fuente_id);

CREATE TABLE IF NOT EXISTS bib_paginas (
  documento_id   uuid NOT NULL REFERENCES bib_documentos(id) ON DELETE CASCADE,
  propietario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  numero         integer NOT NULL CHECK (numero >= 1),
  texto          text NOT NULL,
  busqueda       tsvector GENERATED ALWAYS AS (to_tsvector('spanish', texto)) STORED,
  PRIMARY KEY (documento_id, numero)
);
CREATE INDEX IF NOT EXISTS bib_paginas_busqueda_ix ON bib_paginas USING gin (busqueda);

-- ---------------------------------------------------------------- seguridad por fila (RLS)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bib_trabajos','bib_fuentes','bib_autores','bib_documentos','bib_paginas'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_leer', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_escribir', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (propietario_id = app_usuario() OR app_ve_todo())', t || '_leer', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (propietario_id = app_usuario()) WITH CHECK (propietario_id = app_usuario())', t || '_escribir', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ova_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON bib_trabajos, bib_fuentes, bib_autores, bib_documentos, bib_paginas TO ova_app;
    GRANT USAGE, SELECT ON SEQUENCE bib_autores_id_seq TO ova_app;
  END IF;
END $$;

COMMIT;
