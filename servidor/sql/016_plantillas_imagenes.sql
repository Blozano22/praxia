-- «Plantillas con imágenes»: rol nuevo «editor_imagenes» con su permiso propio «plantillas.imagenes» (ver, validar y editar las URL de las imágenes
-- de las plantillas HTML subidas). Se ejecuta con el usuario DUEÑO. Es idempotente y no borra datos.
-- El rol solo recibe este permiso: no ve «Plantillas HTML» (plantillas.ver) ni puede subir, revisar, aprobar, archivar o eliminar plantillas.

INSERT INTO roles (id, nombre) VALUES (6, 'editor_imagenes') ON CONFLICT (id) DO NOTHING;
INSERT INTO permisos (id, codigo, detalle) VALUES
  (13, 'plantillas.imagenes', 'Ver, validar y editar las URL de las imágenes de las plantillas HTML (pantalla «Plantillas con imágenes»; no sube, revisa ni elimina plantillas)')
  ON CONFLICT (id) DO UPDATE SET detalle = EXCLUDED.detalle;
INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (6, 13) ON CONFLICT DO NOTHING;
-- Por si el rol se había creado a mano con otro permiso: solo puede tener este.
DELETE FROM rol_permisos WHERE rol_id = 6 AND permiso_id <> 13;

-- Último resultado de validar cada URL de imagen de una plantilla (se vuelve a validar cuando cambia la URL).
CREATE TABLE IF NOT EXISTS plantilla_imagenes_validacion (
  plantilla    text NOT NULL CHECK (plantilla ~ '^[a-z0-9-]{1,80}$'),
  url          text NOT NULL CHECK (char_length(url) <= 2000),
  estado       text NOT NULL CHECK (estado IN ('valida', 'no_responde', 'no_es_imagen', 'bloqueada')),
  detalle      text NOT NULL DEFAULT '' CHECK (char_length(detalle) <= 300),
  validado_en  timestamptz NOT NULL DEFAULT now(),
  validado_por text NOT NULL DEFAULT '' CHECK (char_length(validado_por) <= 120),
  PRIMARY KEY (plantilla, url)
);

-- Historial de cada edición de URL de imágenes: quién, cuándo y qué cambió (antes → después). Aparte de plantilla_historial, que es del ciclo de revisión.
CREATE TABLE IF NOT EXISTS plantilla_imagenes_historial (
  id             bigserial PRIMARY KEY,
  plantilla      text NOT NULL CHECK (plantilla ~ '^[a-z0-9-]{1,80}$'),
  usuario_id     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre text NOT NULL CHECK (char_length(usuario_nombre) <= 120),
  cambios        jsonb NOT NULL,
  creado         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plantilla_imagenes_historial_ix ON plantilla_imagenes_historial (plantilla, creado DESC, id DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ova_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON plantilla_imagenes_validacion TO ova_app;
    GRANT SELECT, INSERT ON plantilla_imagenes_historial TO ova_app;
    GRANT USAGE, SELECT ON SEQUENCE plantilla_imagenes_historial_id_seq TO ova_app;
  END IF;
END $$;
