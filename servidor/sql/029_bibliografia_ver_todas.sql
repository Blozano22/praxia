-- Permiso «bibliografia.ver_todas»: ver la pantalla «Bibliografía» con las lecturas de TODAS las personas (solo lectura: el resumen, las referencias, la búsqueda de citas
-- en los guiones). Lo reciben administración, coordinación y docentes. Escribir (leer una bibliografía, omitir fuentes, borrar) sigue siendo solo de quien la montó.
-- Se ejecuta con el usuario DUEÑO. Es idempotente y no borra datos.
INSERT INTO permisos (id, codigo, detalle) VALUES
  (17, 'bibliografia.ver_todas', 'Ver, solo lectura, la bibliografía de todos los syllabus (pantalla «Bibliografía»: lecturas, referencias y citas de los guiones de todas las personas)')
  ON CONFLICT (id) DO UPDATE SET detalle = EXCLUDED.detalle;
INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (1, 17), (2, 17), (3, 17) ON CONFLICT DO NOTHING;
