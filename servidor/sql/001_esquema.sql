-- Esquema de la plataforma de recursos (PostgreSQL 14+).
-- Se ejecuta con el usuario DUEÑO de la base (no con el usuario de la aplicación).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- roles y permisos
CREATE TABLE IF NOT EXISTS roles (
  id        smallint PRIMARY KEY,
  nombre    text NOT NULL UNIQUE CHECK (nombre ~ '^[a-z_]{3,30}$')
);

CREATE TABLE IF NOT EXISTS permisos (
  id        smallint PRIMARY KEY,
  codigo    text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z_]+\.[a-z_]+$'),
  detalle   text NOT NULL
);

CREATE TABLE IF NOT EXISTS rol_permisos (
  rol_id     smallint NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
  permiso_id smallint NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
  PRIMARY KEY (rol_id, permiso_id)
);

INSERT INTO roles (id, nombre) VALUES (1,'admin'), (2,'coordinador'), (3,'docente'), (4,'disenador')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO permisos (id, codigo, detalle) VALUES
  (1, 'proyectos.crear',       'Crear syllabus y sus enlaces'),
  (2, 'proyectos.ver_propios', 'Ver los syllabus que el usuario creó'),
  (3, 'proyectos.editar',      'Modificar los syllabus que el usuario creó'),
  (4, 'proyectos.eliminar',    'Eliminar los syllabus que el usuario creó'),
  (5, 'proyectos.ver_todos',   'Ver el avance de los cursos de todos los usuarios (solo lectura: nadie edita lo ajeno)'),
  (6, 'usuarios.gestionar',    'Crear usuarios, cambiar su rol, activarlos o desactivarlos'),
  (7, 'auditoria.ver',         'Consultar el registro de actividad'),
  (8, 'plantillas.ver',        'Ver la galería de plantillas HTML de los recursos (solo lectura)'),
  (9, 'plantillas.revisar',    'Aprobar, rechazar o mandar a revisión una plantilla HTML, con su observación y el documento de cambios'),
  (10, 'plantillas.corregir',  'Marcar como corregida una solicitud de revisión de una plantilla HTML, para que el diseñador la verifique')
  ON CONFLICT (id) DO UPDATE SET detalle = EXCLUDED.detalle;

-- admin: administra usuarios y auditoría (no ve el contenido de otros por defecto)
-- diseñador: solo ve las plantillas HTML de los recursos (sin acceso a syllabus ni a usuarios)
-- coordinador y docente: trabajan solo con lo propio; el coordinador además VE el avance de todos (solo lectura)
INSERT INTO rol_permisos (rol_id, permiso_id) VALUES
  (1,6), (1,7),
  (2,1), (2,2), (2,3), (2,4), (2,5),
  (3,1), (3,2), (3,3), (3,4),
  (1,8), (2,8), (3,8), (4,8),
  (1,9), (4,9),
  (1,10)
  ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre             text NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 120),
  correo             text NOT NULL CHECK (char_length(correo) BETWEEN 5 AND 200 AND correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  clave_hash         text NOT NULL,
  activo             boolean NOT NULL DEFAULT true,
  intentos_fallidos  smallint NOT NULL DEFAULT 0,
  bloqueado_hasta    timestamptz,
  version_token      integer NOT NULL DEFAULT 1,   -- subirla cierra todas las sesiones del usuario
  ultimo_acceso      timestamptz,
  creado             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_uq ON usuarios (lower(correo));

-- Una persona puede tener varios roles; sus permisos son la suma de los de cada rol.
CREATE TABLE IF NOT EXISTS usuario_roles (
  usuario_id uuid     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol_id     smallint NOT NULL REFERENCES roles(id),
  PRIMARY KEY (usuario_id, rol_id)
);

-- ---------------------------------------------------------------- syllabus (proyectos) y enlaces
-- La clave es (propietario, id): dos usuarios nunca comparten ni pueden pisar un identificador.
CREATE TABLE IF NOT EXISTS proyectos (
  propietario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id             text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  programa       text NOT NULL CHECK (char_length(programa) <= 300),
  curso          text NOT NULL CHECK (char_length(curso) <= 300),
  datos          jsonb NOT NULL,
  creado         timestamptz NOT NULL DEFAULT now(),
  actualizado    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (propietario_id, id)
);

-- Número de versión del syllabus: sube con cada guardado. Quien guarda envía la versión que tenía; si ya cambió en otra pestaña o equipo,
-- el servidor lo rechaza (409) en vez de pisar lo guardado por el otro.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS enlaces (
  id             bigserial PRIMARY KEY,
  propietario_id uuid NOT NULL,
  proyecto_id    text NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('syllabus','carpeta','documento_unidad','guion')),
  unidad         smallint,
  nombre         text CHECK (char_length(nombre) <= 300),
  url            text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 2000),
  creado         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (propietario_id, proyecto_id) REFERENCES proyectos (propietario_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS enlaces_proyecto_ix ON enlaces (propietario_id, proyecto_id);

-- ---------------------------------------------------------------- auditoría
CREATE TABLE IF NOT EXISTS auditoria (
  id          bigserial PRIMARY KEY,
  usuario_id  uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  accion      text NOT NULL CHECK (char_length(accion) <= 60),
  entidad     text CHECK (char_length(entidad) <= 60),
  entidad_id  text CHECK (char_length(entidad_id) <= 120),
  ip          text CHECK (char_length(ip) <= 64),
  creado      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditoria_usuario_ix ON auditoria (usuario_id, creado DESC);

-- ---------------------------------------------------------------- configuración compartida (direcciones de n8n)
-- Una sola configuración para toda la plataforma: la cambia el administrador y la usan todas las personas.
CREATE TABLE IF NOT EXISTS configuracion (
  clave       text PRIMARY KEY CHECK (char_length(clave) <= 60),
  valor       text NOT NULL CHECK (char_length(valor) <= 600),
  actualizado timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- revisión de plantillas HTML (ciclo diseñador ↔ administrador)
-- Cada paso sobre una plantilla queda registrado; el último es el vigente. Ciclo: el diseñador pide cambios («revision») → el administrador
-- los marca como «corregida» → el diseñador verifica y aprueba, rechaza o vuelve a pedir cambios, hasta que queda aprobada.
-- «rol» dice en calidad de qué actuó la persona (un administrador que aprueba o rechaza lo hace como «administrador», no como diseñador).
-- Si una solicitud o corrección se edita, se marca quién la editó y cuándo fue la última edición (editado_por, editado_en).
CREATE TABLE IF NOT EXISTS plantilla_historial (
  id             bigserial PRIMARY KEY,
  plantilla      text NOT NULL CHECK (plantilla ~ '^[a-z0-9-]{1,80}$'),
  estado         text NOT NULL CHECK (estado IN ('aprobada','rechazada','revision','corregida')),
  observacion    text NOT NULL DEFAULT '' CHECK (char_length(observacion) <= 2000),
  doc_url        text CHECK (doc_url IS NULL OR char_length(doc_url) <= 500),
  usuario_id     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre text NOT NULL CHECK (char_length(usuario_nombre) <= 120),
  rol            text NOT NULL DEFAULT 'disenador' CHECK (rol IN ('disenador','administrador')),
  referencia     bigint REFERENCES plantilla_historial(id) ON DELETE SET NULL, -- en «corregida»: la solicitud de revisión que atiende
  creado         timestamptz NOT NULL DEFAULT now(),
  editado_en     timestamptz,
  editado_por    text CHECK (editado_por IS NULL OR char_length(editado_por) <= 120)
);
CREATE INDEX IF NOT EXISTS plantilla_historial_ix ON plantilla_historial (plantilla, creado DESC, id DESC);

-- Decisiones de la primera versión (tabla plantilla_revisiones): se copian una sola vez. Si esa tabla la creó otro usuario con psql y quien
-- migra no puede leerla, se avisa y se sigue (se pueden copiar a mano con un usuario que sí pueda).
DO $$
BEGIN
  IF to_regclass('public.plantilla_revisiones') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plantilla_historial) THEN
    INSERT INTO plantilla_historial (plantilla, estado, observacion, doc_url, usuario_id, usuario_nombre, rol, creado)
    SELECT plantilla, estado, observacion, doc_url, usuario_id, usuario_nombre, 'disenador', creado FROM plantilla_revisiones ORDER BY id;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'No se copiaron las decisiones antiguas: plantilla_revisiones es de otro usuario y no se puede leer desde aquí.';
END $$;

-- ---------------------------------------------------------------- generación de guiones (trabajos de n8n)
-- La llamada a n8n la hace el servidor y se anota aquí con un identificador: así, aunque la persona cierre la página o se le
-- venza la sesión, la generación sigue, se sabe si terminó y el resultado espera hasta que vuelva. Una sola en curso por unidad.
CREATE TABLE IF NOT EXISTS guiones_trabajos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proyecto_id    text NOT NULL CHECK (char_length(proyecto_id) <= 80),
  unidad         integer NOT NULL CHECK (unidad BETWEEN 0 AND 99),
  estado         text NOT NULL CHECK (estado IN ('en_curso','listo','error')),
  respuesta      text,
  error          text CHECK (error IS NULL OR char_length(error) <= 600),
  creado         timestamptz NOT NULL DEFAULT now(),
  terminado      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS guiones_trabajos_uno_en_curso ON guiones_trabajos (propietario_id, proyecto_id, unidad) WHERE estado = 'en_curso';
CREATE INDEX IF NOT EXISTS guiones_trabajos_propietario_ix ON guiones_trabajos (propietario_id, creado DESC);

-- ---------------------------------------------------------------- creación de las unidades (trabajos de n8n)
-- Igual que los guiones: la llamada a n8n que crea un documento por unidad la hace el servidor y queda anotada con un identificador.
-- Sigue aunque se cierre la página; una sola en curso por syllabus; el resultado espera a la persona.
CREATE TABLE IF NOT EXISTS unidades_trabajos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  syllabus_doc    text NOT NULL CHECK (char_length(syllabus_doc) <= 120),
  syllabus_url    text NOT NULL CHECK (char_length(syllabus_url) <= 500),
  carpeta_url     text NOT NULL CHECK (char_length(carpeta_url) <= 500),
  curso           text NOT NULL DEFAULT '' CHECK (char_length(curso) <= 300),
  proyecto_id     text CHECK (proyecto_id IS NULL OR char_length(proyecto_id) <= 64),
  bibliografia_id uuid,
  estado          text NOT NULL CHECK (estado IN ('en_curso','listo','error')),
  respuesta       text,
  error           text CHECK (error IS NULL OR char_length(error) <= 600),
  creado          timestamptz NOT NULL DEFAULT now(),
  terminado       timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS unidades_trabajos_uno_en_curso ON unidades_trabajos (propietario_id, syllabus_doc) WHERE estado = 'en_curso';
CREATE INDEX IF NOT EXISTS unidades_trabajos_propietario_ix ON unidades_trabajos (propietario_id, creado DESC);

-- ---------------------------------------------------------------- pipeline guiones → matrices → H5P (avisos de n8n)
-- n8n AVISA a Praxia (POST /api/n8n/eventos, firmado) y Praxia guarda lo recibido ligado al curso; la pantalla del curso lee de aquí y no
-- consulta a n8n. Cada aviso trae identificadores de correlación; Praxia resuelve persona y curso con pipeline_origen, nunca con lo que
-- el aviso diga del curso.

-- trabajo_id → persona y curso. Se escribe al lanzar un trabajo (guiones, matriz, H5P) y se conserva semanas: los avisos de la cadena
-- llegan después de que el trabajo de guiones ya se recogió y se borró.
CREATE TABLE IF NOT EXISTS pipeline_origen (
  trabajo_id     uuid PRIMARY KEY,
  propietario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proyecto_id    text NOT NULL CHECK (char_length(proyecto_id) <= 64),
  carpeta_raiz   text CHECK (carpeta_raiz IS NULL OR char_length(carpeta_raiz) <= 600),
  etapa          text NOT NULL CHECK (etapa IN ('guiones','matrices','h5p')),
  unidad         integer,
  creado         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_origen_curso_ix ON pipeline_origen (propietario_id, proyecto_id);

-- Una corrida de n8n (matrices o H5P): su plan, su resumen y cuándo avisó por última vez.
CREATE TABLE IF NOT EXISTS pipeline_ejecuciones (
  propietario_id    uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proyecto_id       text NOT NULL,
  etapa             text NOT NULL CHECK (etapa IN ('matrices','h5p')),
  ejecucion_id      text NOT NULL CHECK (char_length(ejecucion_id) <= 100),
  trabajo_id        uuid,
  origen_trabajo_id uuid,
  carpeta_raiz      text,
  estado            text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','terminada')),
  maximo            integer,
  plan              jsonb,
  resumen           jsonb,
  iniciado_en       timestamptz,
  ultimo_evento_en  timestamptz NOT NULL,
  terminado_en      timestamptz,
  PRIMARY KEY (propietario_id, proyecto_id, etapa, ejecucion_id)
);

-- La matriz de cada unidad del curso.
CREATE TABLE IF NOT EXISTS pipeline_matrices (
  propietario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proyecto_id    text NOT NULL,
  unidad         integer NOT NULL,
  formacion      text,
  estado         text NOT NULL CHECK (estado IN ('generando','creada','omitida','reemplazada','error')),
  matriz_id      text,
  matriz_url     text,
  matriz_nombre  text,
  detalle        text,
  filas_total    integer NOT NULL DEFAULT 0,
  actualizado_en timestamptz NOT NULL,
  secuencia      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (propietario_id, proyecto_id, unidad)
);

-- Una fila por recurso de la matriz (lo que n8n anota en la hoja).
CREATE TABLE IF NOT EXISTS pipeline_recursos (
  propietario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proyecto_id    text NOT NULL,
  id             text NOT NULL CHECK (char_length(id) <= 100),
  unidad         integer,
  id_base        text,
  variante       text,
  alcance        text,
  tema           integer,
  codigo         text,
  formato        text,
  titulo         text,
  con_actividad  boolean,
  generador      text,
  estado         text NOT NULL CHECK (estado IN ('PENDIENTE','EN_PROCESO','GENERADO','ERROR')),
  observaciones  text,
  enlace_guion   text,
  enlace_recurso text,
  omision        text, -- motivo por el que la última corrida de H5P la dejó fuera (sin_plantilla, generador_no_h5p…)
  actualizado_en timestamptz NOT NULL,
  secuencia      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (propietario_id, proyecto_id, id)
);
CREATE INDEX IF NOT EXISTS pipeline_recursos_unidad_ix ON pipeline_recursos (propietario_id, proyecto_id, unidad);

-- Todo aviso recibido: es la idempotencia (evento_id único: un reintento de n8n no se aplica dos veces) y la auditoría.
CREATE TABLE IF NOT EXISTS pipeline_eventos (
  evento_id         text PRIMARY KEY CHECK (char_length(evento_id) <= 100),
  recibido          timestamptz NOT NULL DEFAULT now(),
  tipo              text NOT NULL,
  etapa             text NOT NULL,
  trabajo_id        uuid,
  origen_trabajo_id uuid,
  ejecucion_id      text,
  propietario_id    uuid,
  proyecto_id       text,
  secuencia         integer,
  fecha_evento      timestamptz NOT NULL,
  resultado         text NOT NULL CHECK (resultado IN ('aplicado','ignorado_antiguo','huerfano','rechazado')),
  motivo            text,
  carga             jsonb
);
CREATE INDEX IF NOT EXISTS pipeline_eventos_recibido_ix ON pipeline_eventos (recibido);

-- ---------------------------------------------------------------- categorías de las plantillas HTML (para n8n)
-- Una categoría es un tipo de recurso del catálogo (G-09 «Acordeón»…) y reúne las variantes (plantillas publicadas) de ese tipo.
-- n8n lee el índice agrupado (/plantillas-html/plantillas.json) y elige entre las variantes de la categoría que necesita.
CREATE TABLE IF NOT EXISTS plantilla_categorias (
  id     text PRIMARY KEY CHECK (id ~ '^[A-Z]{1,4}-[0-9]{2,3}$'),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 120),
  creado timestamptz NOT NULL DEFAULT now()
);
-- Qué categoría tiene cada plantilla publicada (por su nombre de archivo). Sin fila = sin categoría.
CREATE TABLE IF NOT EXISTS plantilla_categoria (
  plantilla text PRIMARY KEY CHECK (plantilla ~ '^[a-z0-9-]{1,80}$'),
  categoria text NOT NULL REFERENCES plantilla_categorias(id) ON DELETE CASCADE ON UPDATE CASCADE,
  actualizado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plantilla_categoria_ix ON plantilla_categoria (categoria);

-- Punto de partida (solo la primera vez, mientras no haya ninguna categoría): el catálogo de IDs que ya usa el flujo de matrices y las
-- plantillas cuyo nombre indica sin duda su tipo. Lo demás queda sin categoría para asignarlo desde la pantalla «Plantillas HTML».
INSERT INTO plantilla_categorias (id, nombre)
SELECT v.id, v.nombre FROM (VALUES
  ('G-00', 'Presentación de la asignatura'), ('G-01', 'Infografía estática'), ('G-02', 'Infografía interactiva'), ('G-03', 'Diagrama de flujo'),
  ('G-04', 'Mapa conceptual interactivo'), ('G-05', 'Video académico'), ('G-06', 'Micro-learning'), ('G-07', 'Podcast'),
  ('G-08', 'Presentación multimedia interactiva'), ('G-09', 'Acordeón'), ('G-10', 'Galería'), ('G-11', 'Lectura fundamental diagramada'), ('G-12', 'Línea de tiempo')
) AS v(id, nombre)
WHERE NOT EXISTS (SELECT 1 FROM plantilla_categorias);
INSERT INTO plantilla_categoria (plantilla, categoria)
SELECT v.p, v.c FROM (VALUES
  ('acordeon', 'G-09'), ('acordeon-2', 'G-09'), ('acordeon-3', 'G-09'), ('lectura', 'G-11'), ('lineatiempo', 'G-12'), ('lineatiempo-2', 'G-12'),
  ('lineatiempo-3', 'G-12'), ('mapa', 'G-04'), ('flujo', 'G-03'), ('presentacion', 'G-08'), ('video', 'G-05'), ('podcast', 'G-07')
) AS v(p, c)
WHERE NOT EXISTS (SELECT 1 FROM plantilla_categoria) AND EXISTS (SELECT 1 FROM plantilla_categorias WHERE id = v.c);

-- ---------------------------------------------------------------- seguridad por fila (RLS)
-- Aunque una consulta de la aplicación olvidara el filtro por propietario, la base de datos
-- solo entrega y solo deja escribir las filas del usuario de la sesión (app.usuario_id).
ALTER TABLE proyectos ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos FORCE  ROW LEVEL SECURITY;
ALTER TABLE enlaces   ENABLE ROW LEVEL SECURITY;
ALTER TABLE enlaces   FORCE  ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_usuario() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.usuario_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_ve_todo() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.ver_todos', true), '') = 'on' $$;

DROP POLICY IF EXISTS proyectos_leer    ON proyectos;
DROP POLICY IF EXISTS proyectos_escribir ON proyectos;
DROP POLICY IF EXISTS enlaces_leer      ON enlaces;
DROP POLICY IF EXISTS enlaces_escribir  ON enlaces;

CREATE POLICY proyectos_leer ON proyectos FOR SELECT
  USING (propietario_id = app_usuario() OR app_ve_todo());
CREATE POLICY proyectos_escribir ON proyectos FOR ALL
  USING (propietario_id = app_usuario())
  WITH CHECK (propietario_id = app_usuario());

CREATE POLICY enlaces_leer ON enlaces FOR SELECT
  USING (propietario_id = app_usuario() OR app_ve_todo());
CREATE POLICY enlaces_escribir ON enlaces FOR ALL
  USING (propietario_id = app_usuario())
  WITH CHECK (propietario_id = app_usuario());

-- ---------------------------------------------------------------- permisos del usuario de la aplicación
-- El rol "ova_app" lo crea el administrador de la base (ver servidor/LEEME.md); no es dueño de las tablas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ova_app') THEN
    GRANT USAGE ON SCHEMA public TO ova_app;
    GRANT SELECT ON roles, permisos, rol_permisos TO ova_app;
    GRANT SELECT, INSERT, DELETE ON usuario_roles TO ova_app;
    GRANT SELECT, INSERT, DELETE ON usuarios TO ova_app;
    GRANT UPDATE (nombre, correo, clave_hash, activo, intentos_fallidos, bloqueado_hasta, version_token, ultimo_acceso) ON usuarios TO ova_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON proyectos, enlaces TO ova_app;
    GRANT SELECT, INSERT ON auditoria TO ova_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON guiones_trabajos TO ova_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON unidades_trabajos TO ova_app;
    -- Esta tabla pudo crearla otro usuario con psql: si quien migra no es su dueño no puede dar permisos,
    -- pero entonces ya los tienen de cuando se crearon. Se avisa y se sigue en vez de detener toda la migración.
    BEGIN
      GRANT SELECT, INSERT, UPDATE, DELETE ON configuracion TO ova_app;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Sin permiso para dar permisos sobre configuracion (es de otro usuario); se dejan como están.';
    END;
    GRANT SELECT, INSERT, UPDATE ON plantilla_historial TO ova_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON plantilla_categorias, plantilla_categoria TO ova_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_origen, pipeline_ejecuciones, pipeline_matrices, pipeline_recursos, pipeline_eventos TO ova_app;
    GRANT USAGE, SELECT ON SEQUENCE plantilla_historial_id_seq TO ova_app;
    GRANT USAGE, SELECT ON SEQUENCE enlaces_id_seq, auditoria_id_seq TO ova_app;
  END IF;
END $$;

COMMIT;
