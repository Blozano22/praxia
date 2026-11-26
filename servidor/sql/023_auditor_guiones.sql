-- «Auditor de guiones»: rol nuevo «auditor_guiones» con su permiso propio «guiones.auditar» (pantalla que envía el guion, el syllabus y la estructura metodológica
-- al flujo de n8n que los evalúa contra el Instrumento de validación). La administración también recibe el permiso. Se ejecuta con el usuario DUEÑO. Es idempotente y no borra datos.
-- El rol solo recibe este permiso: no ve plantillas, syllabus ni usuarios. La dirección del flujo se guarda en «configuracion» (clave n8n.auditor).

INSERT INTO roles (id, nombre) VALUES (8, 'auditor_guiones') ON CONFLICT (id) DO NOTHING;
INSERT INTO permisos (id, codigo, detalle) VALUES
  (15, 'guiones.auditar', 'Auditar un guion (pantalla «Auditor de guiones»: guion + syllabus + estructura → flujo de n8n que lo evalúa con el Instrumento de validación)')
  ON CONFLICT (id) DO UPDATE SET detalle = EXCLUDED.detalle;
INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (8, 15), (1, 15) ON CONFLICT DO NOTHING;
DELETE FROM rol_permisos WHERE rol_id = 8 AND permiso_id <> 15;
