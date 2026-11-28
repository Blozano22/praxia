-- Quita el permiso «bibliografia.ver_todas» y su asignación a los roles. No borra datos.
DELETE FROM rol_permisos WHERE permiso_id = 17;
DELETE FROM permisos WHERE id = 17 AND codigo = 'bibliografia.ver_todas';
