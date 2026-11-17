-- Borrar una lectura de bibliografía. La persona que la montó ya puede borrar la suya (política «_escribir» de 002).
-- Esta política deja borrar también las ajenas a quien tiene proyectos.ver_todos (administración y coordinación), que son
-- quienes ven todas las lecturas en el panel. Al borrar el trabajo se van con él sus fuentes, autores, documentos y páginas (ON DELETE CASCADE).
-- Idempotente; se ejecuta con el usuario DUEÑO.
DO $$
BEGIN
  DROP POLICY IF EXISTS bib_trabajos_borrar_todo ON bib_trabajos;
  CREATE POLICY bib_trabajos_borrar_todo ON bib_trabajos FOR DELETE USING (app_ve_todo());
END $$;
