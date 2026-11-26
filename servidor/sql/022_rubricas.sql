-- «Generar rúbrica»: rol nuevo «generador_rubricas» con su permiso propio «rubricas.generar» (pantalla que envía las unidades de una asignatura y una carpeta de Drive al
-- flujo de n8n que crea la rúbrica en Google Sheets). Se ejecuta con el usuario DUEÑO. Es idempotente y no borra datos.
-- El rol solo recibe este permiso: no ve plantillas, syllabus ni usuarios. La dirección del flujo se guarda en «configuracion» (clave n8n.rubricas), como las demás.

INSERT INTO roles (id, nombre) VALUES (7, 'generador_rubricas') ON CONFLICT (id) DO NOTHING;
INSERT INTO permisos (id, codigo, detalle) VALUES
  (14, 'rubricas.generar', 'Generar la rúbrica de evaluación de una asignatura (pantalla «Generar rúbrica»: unidades + carpeta de Drive → flujo de n8n)')
  ON CONFLICT (id) DO UPDATE SET detalle = EXCLUDED.detalle;
INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (7, 14) ON CONFLICT DO NOTHING;
DELETE FROM rol_permisos WHERE rol_id = 7 AND permiso_id <> 14;
