-- «Categorías para n8n» (plantillas.categorias) es solo de administradores: se le quita al Diseñador y se asegura al admin (idempotente).
DELETE FROM rol_permisos WHERE rol_id = 4 AND permiso_id = 11;
INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (1, 11) ON CONFLICT DO NOTHING;
