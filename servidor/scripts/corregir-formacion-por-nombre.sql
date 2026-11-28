-- PROPUESTA, NO APLICADA. Corrige plantilla_subidas.formacion según el código del nombre
-- (-tec- / -pro- / -esp- / -doc-, también en act-…-tec-…) para las variantes que hoy no coinciden.
-- 1) Ejecute primero la vista previa y revise. 2) Haga copia de seguridad. 3) Descomente el UPDATE.

-- Vista previa
SELECT nombre, formacion AS formacion_actual,
       CASE substring(nombre from '-(tec|pro|esp|doc)-')
         WHEN 'tec' THEN 'tecnologico' WHEN 'pro' THEN 'profesional'
         WHEN 'esp' THEN 'especializacion' WHEN 'doc' THEN 'doctorado' END AS formacion_segun_nombre
FROM plantilla_subidas
WHERE substring(nombre from '-(tec|pro|esp|doc)-') IS NOT NULL
  AND formacion IS DISTINCT FROM CASE substring(nombre from '-(tec|pro|esp|doc)-')
         WHEN 'tec' THEN 'tecnologico' WHEN 'pro' THEN 'profesional'
         WHEN 'esp' THEN 'especializacion' WHEN 'doc' THEN 'doctorado' END
ORDER BY nombre;

-- Corrección (comentada)
-- BEGIN;
-- UPDATE plantilla_subidas SET formacion = CASE substring(nombre from '-(tec|pro|esp|doc)-')
--          WHEN 'tec' THEN 'tecnologico' WHEN 'pro' THEN 'profesional'
--          WHEN 'esp' THEN 'especializacion' WHEN 'doc' THEN 'doctorado' END,
--        actualizado = now()
-- WHERE substring(nombre from '-(tec|pro|esp|doc)-') IS NOT NULL
--   AND formacion IS DISTINCT FROM CASE substring(nombre from '-(tec|pro|esp|doc)-')
--          WHEN 'tec' THEN 'tecnologico' WHEN 'pro' THEN 'profesional'
--          WHEN 'esp' THEN 'especializacion' WHEN 'doc' THEN 'doctorado' END;
-- COMMIT;
