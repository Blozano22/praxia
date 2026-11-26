-- Tipos de actividad del guion → categoría de actividad (prefijo sin formación, p.ej. ACT-E-01). Coincidencia EXACTA del texto normalizado
-- (sin mayúsculas, sin tildes, espacios colapsados); sin sinónimos. Configuración global: la lee cualquier sesión y solo la administración la escribe.
CREATE TABLE IF NOT EXISTS actividad_tipos (
  tipo_normalizado text PRIMARY KEY CHECK (char_length(tipo_normalizado) <= 150),
  categoria        text NOT NULL CHECK (categoria ~ '^ACT-[A-Z]-[0-9]{2}$'),
  nombre           text NOT NULL CHECK (char_length(nombre) <= 300),
  actualizado_en   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO actividad_tipos (tipo_normalizado, categoria, nombre) VALUES
  ('analisis de incidentes', 'ACT-E-01', 'Análisis de incidentes'),
  ('lectura del mapa del delito', 'ACT-E-02', 'Lectura del mapa del delito'),
  ('emparejar normas con situaciones', 'ACT-E-03', 'Emparejar normas con situaciones'),
  ('elaboracion de mapas de intervencion', 'ACT-E-04', 'Elaboración de mapas de intervención'),
  ('actuacion ante escenarios criticos', 'ACT-E-05', 'Actuación ante escenarios críticos'),
  ('clasificacion de conducta', 'ACT-E-06', 'Clasificación de conducta'),
  ('construccion de propuestas preventivas', 'ACT-E-07', 'Construcción de propuestas preventivas'),
  ('completar espacios', 'ACT-E-08', 'Completar espacios'),
  ('portafolio de evidencias', 'ACT-E-09', 'Portafolio de evidencias'),
  ('elaboracion de informes', 'ACT-E-10', 'Elaboración de informes'),
  ('verdadero o falso', 'ACT-E-11', 'Verdadero o falso'),
  ('analisis de una noticia', 'ACT-E-12', 'Análisis de una noticia'),
  ('identificacion de conceptos', 'ACT-E-13', 'Identificación de conceptos'),
  ('emparejamiento', 'ACT-G-01', 'Emparejamiento'),
  ('toma de decisiones', 'ACT-G-02', 'Toma de decisiones'),
  ('arrastre y suelte', 'ACT-G-03', 'Arrastre y suelte'),
  ('simulaciones de caso', 'ACT-G-04', 'Simulaciones de caso'),
  ('clasificaciones', 'ACT-G-05', 'Clasificaciones'),
  ('cuestionarios con retroalimentacion', 'ACT-G-06', 'Cuestionarios con retroalimentación'),
  ('estudio de caso', 'ACT-G-07', 'Estudio de caso'),
  ('tarea', 'ACT-G-08', 'Tarea'),
  ('taller aplicado', 'ACT-G-09', 'Taller aplicado'),
  ('laboratorio virtual', 'ACT-G-10', 'Laboratorio virtual'),
  ('foros estructurados', 'ACT-G-11', 'Foros estructurados'),
  ('crucigramas tecnicos', 'ACT-G-12', 'Crucigramas técnicos')
ON CONFLICT (tipo_normalizado) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ova_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON actividad_tipos TO ova_app;
  END IF;
END $$;
