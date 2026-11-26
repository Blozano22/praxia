-- Fase 2 del diseño: la coordinación recibe los cursos enviados a diseño y los asigna a diseñadores.
-- Permiso nuevo «diseno.asignar» (coordinador y administración) y la columna con el resultado de compartir la carpeta de Drive con el diseñador.
-- Se ejecuta con el usuario DUEÑO. Idempotente.
INSERT INTO permisos (id, codigo, detalle) VALUES
  (16, 'diseno.asignar', 'Ver los cursos enviados a diseño y asignarlos (o reasignarlos) a diseñadores')
  ON CONFLICT (id) DO UPDATE SET detalle = EXCLUDED.detalle;
INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (1, 16), (2, 16) ON CONFLICT DO NOTHING;
-- 'ok' | 'error: …' | 'sin_configurar' (null = aún sin asignar)
ALTER TABLE curso_diseno ADD COLUMN IF NOT EXISTS drive_compartido text;
