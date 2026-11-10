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
  (8, 'plantillas.ver',        'Ver la galería de plantillas HTML de los recursos (solo lectura)')
  ON CONFLICT (id) DO UPDATE SET detalle = EXCLUDED.detalle;

-- admin: administra usuarios y auditoría (no ve el contenido de otros por defecto)
-- diseñador: solo ve las plantillas HTML de los recursos (sin acceso a syllabus ni a usuarios)
-- coordinador y docente: trabajan solo con lo propio; el coordinador además VE el avance de todos (solo lectura)
INSERT INTO rol_permisos (rol_id, permiso_id) VALUES
  (1,6), (1,7),
  (2,1), (2,2), (2,3), (2,4), (2,5),
  (3,1), (3,2), (3,3), (3,4),
  (1,8), (2,8), (3,8), (4,8)
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON configuracion TO ova_app;
    GRANT USAGE, SELECT ON SEQUENCE enlaces_id_seq, auditoria_id_seq TO ova_app;
  END IF;
END $$;

COMMIT;
