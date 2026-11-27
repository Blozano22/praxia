-- Generar H5P desde Praxia es del diseñador (y la administración): el docente no lo usa. Permiso nuevo «recursos.generar». Idempotente.
INSERT INTO permisos (id, codigo, detalle) VALUES
  (17, 'recursos.generar', 'Generar, regenerar y reintentar los recursos H5P de un curso (el docente no lo usa)')
  ON CONFLICT (id) DO UPDATE SET detalle = EXCLUDED.detalle;
INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (1, 17), (4, 17) ON CONFLICT DO NOTHING;
