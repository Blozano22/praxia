// Plan de asignaturas (Excel «Plan de estudio»): 85 asignaturas de programas y 3 cursos autogestionables.
// Cada fila: [tipo, programa, asignatura, créditos, temas, subtemas, HTML, actividades, videos].
// Regla del plan: 1 estructura (unidad) por crédito y 1 guion por tema (4 temas por crédito); las páginas se estiman con las páginas por recurso.
export const TIPOS = { TEC: 'Tecnología', PRE: 'Licenciatura', ESP: 'Especialización', DOC: 'Doctorado', CAG: 'Autogestión' }

// Páginas por recurso medidas en Praxia: Unidad 1 de Tecnología en Gestión del Servicio de Policía (Google Doc exportado a PDF).
export const MEDIDO = { unidad: 'Unidad 1 · Tecnología en Gestión del Servicio de Policía', guiones: [{ tema: 1, recursos: 7, paginas: 50 }, { tema: 2, recursos: 6, paginas: 43 }, { tema: 3, recursos: 6, paginas: 49 }, { tema: 4, recursos: 6, paginas: 37 }] }
export const PAGINAS_POR_RECURSO = 7.2 // 179 páginas / 25 recursos

export const PLAN = [
  ["ESP","Especialización en Gestión Aeronáutica","Seguridad Pública en la Aviación Policial",2,8,24,43,24,5],
  ["ESP","Especialización en Gestión Aeronáutica","Normatividad Aeronáutica",2,8,32,56,32,8],
  ["ESP","Especialización en Gestión Aeronáutica","Administración de Recursos Aeronáuticos",2,8,24,32,24,16],
  ["ESP","Especialización en Gestión Aeronáutica","Seguridad Operacional",2,8,25,42,25,8],
  ["ESP","Especialización en Gestión Aeronáutica","Calidad y Confiabilidad Aeronáutica",2,8,24,38,24,10],
  ["ESP","Especialización en Investigación Criminal","Introducción y Metodología a la Investigación Criminal",2,8,24,48,24,0],
  ["ESP","Especialización en Investigación Criminal","Técnicas de Análisis Criminal",1,4,14,28,14,0],
  ["ESP","Especialización en Investigación Criminal","Ciencias del Comportamiento Forense",1,4,12,17,12,7],
  ["ESP","Especialización en Investigación Criminal","Criminalística y Análisis Forense",3,12,36,70,36,2],
  ["TEC","Tecnología en Derechos Humanos y Gestión Comunitaria","Laboratorio de Derechos Humanos",3,12,36,65,36,7],
  ["TEC","Tecnología en Derechos Humanos y Gestión Comunitaria","Laboratorio de Gestión de Conflictos",2,8,24,48,24,0],
  ["TEC","Tecnología en Derechos Humanos y Gestión Comunitaria","Práctica en Liderazgo Comunitario con Enfoque en Derechos Humanos",3,12,36,57,36,15],
  ["TEC","Tecnología en Derechos Humanos y Gestión Comunitaria","Laboratorio Diálogo Estado–Comunidad (F)",2,8,24,40,24,8],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Preparación Física y Bienestar Emocional",2,8,24,45,24,3],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Fundamentos de Administración",2,8,24,46,24,2],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Habilidades Comunicativas",2,8,24,38,24,10],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Servicio de Policía",2,8,27,51,27,3],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Fundamentos Financieros",2,8,24,47,24,1],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Régimen Institucional",2,8,27,53,27,1],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Matemática Aplicada a la Profesión",3,12,36,56,36,16],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Comprensión Social y del Territorio",2,8,24,43,24,5],
  ["DOC","Doctorado en Seguridad y Convivencia","Gestión y Desarrollo Interdisciplinario del Territorio",3,12,36,56,36,16],
  ["ESP","Especialización en Investigación Criminal","Técnicas Avanzadas de Entrevista e Interrogatorio",1,4,12,19,12,5],
  ["ESP","Especialización en Investigación Criminal","Jurisprudencia en la Investigación de Delitos Transnacionales, DIDH y DIH",2,8,24,46,24,2],
  ["ESP","Especialización en Investigación Criminal","Normatividad en Organismos de Inspección y Laboratorios Forenses",2,8,24,46,24,2],
  ["ESP","Especialización en Investigación Criminal","Investigación de Organizaciones Multicrimen",1,4,12,24,12,0],
  ["ESP","Especialización en Investigación Criminal","Derecho Penal y Procedimiento Penal",3,12,36,68,36,4],
  ["ESP","Especialización en Investigación Criminal","Metodología de la Investigación Científica II",1,4,12,19,12,5],
  ["ESP","Especialización en Investigación Criminal","Metodología de la Investigación Científica I",1,4,12,18,12,6],
  ["ESP","Especialización en Investigación Criminal","Investigación del Cibercrimen",2,8,24,48,24,0],
  ["ESP","Especialización en Investigación Criminal","Gerenciamiento de la Investigación Criminal",2,8,24,46,24,2],
  ["ESP","Especialización en Investigación Criminal","Teorías Criminológicas",1,4,12,22,12,2],
  ["ESP","Especialización en Investigación Criminal","Inteligencia Artificial y Análisis de Datos",1,4,14,28,14,0],
  ["ESP","Especialización en Investigación Criminal","Redacción de Informes y Oralidad",1,4,12,16,12,8],
  ["ESP","Especialización en Investigación Criminal","Investigación en Delitos de Género",1,4,12,22,12,2],
  ["ESP","Especialización en Investigación Criminal","Victimología",1,4,12,22,12,2],
  ["ESP","Especialización Tecnológica en Gestión Pública Territorial","Formulación y Evaluación de Proyectos para la Seguridad Ciudadana",3,12,36,68,36,4],
  ["ESP","Especialización Tecnológica en Gestión Pública Territorial","Política Pública de Convivencia y Seguridad Ciudadana",2,8,24,43,24,5],
  ["ESP","Especialización Tecnológica en Gestión Pública Territorial","DD. HH. y Cultura de Paz",2,8,25,45,25,5],
  ["DOC","Doctorado en Seguridad y Convivencia","Teorías Transversales de Violencia y Criminalidad",3,12,36,68,36,4],
  ["DOC","Doctorado en Seguridad y Convivencia","Cibercrimen y Ciberdelito",3,12,36,64,36,8],
  ["DOC","Doctorado en Seguridad y Convivencia","Fundamentos en Investigación Criminal y Criminología",4,16,48,92,48,4],
  ["DOC","Doctorado en Seguridad y Convivencia","Herramientas de Gestión Digital a partir de Inteligencia Artificial",3,12,36,72,36,0],
  ["DOC","Doctorado en Seguridad y Convivencia","Cambio Climático y Transiciones de Sostenibilidad",3,12,36,56,36,16],
  ["DOC","Doctorado en Seguridad y Convivencia","Gestión Pública de la Seguridad y la Convivencia",3,12,36,56,36,16],
  ["DOC","Doctorado en Seguridad y Convivencia","Seminario de Investigación III",3,12,36,67,36,5],
  ["DOC","Doctorado en Seguridad y Convivencia","Seminario de Investigación II",3,12,36,72,36,0],
  ["DOC","Doctorado en Seguridad y Convivencia","Seminario de Investigación I",3,12,36,66,36,6],
  ["DOC","Doctorado en Seguridad y Convivencia","Convivencia, Prevención y Gestión de la Paz",4,16,48,83,48,13],
  ["DOC","Doctorado en Seguridad y Convivencia","Derechos Humanos y Gestión Positiva de la Diversidad",4,16,48,86,48,10],
  ["PRE","Licenciatura en Educación Comunitaria","Didáctica",3,12,36,63,36,9],
  ["PRE","Licenciatura en Educación Comunitaria","Metodología de la Investigación",2,8,24,40,24,8],
  ["PRE","Licenciatura en Educación Comunitaria","Comprensión y Producción de Textos I",2,8,24,48,24,0],
  ["DOC","Doctorado en Seguridad y Convivencia","Electiva III: Gestión Estratégica de Proyectos Públicos",3,12,36,72,36,0],
  ["DOC","Doctorado en Seguridad y Convivencia","Electiva IV: Estrategias de Negociación, Mediación y Diálogo Social",4,16,48,78,48,18],
  ["ESP","Especialización en Investigación de Accidentes de Tránsito","Investigación y Proceso Judicial",2,8,24,46,24,2],
  ["ESP","Especialización en Investigación de Accidentes de Tránsito","Trabajo de Grado",2,8,24,48,24,0],
  ["ESP","Especialización en Investigación de Accidentes de Tránsito","Física Aplicada a la Reconstrucción",2,8,26,44,26,8],
  ["ESP","Especialización en Investigación de Accidentes de Tránsito","Física Básica",2,8,24,48,24,0],
  ["ESP","Especialización en Investigación de Accidentes de Tránsito","Normatividad de Tránsito y Transporte",2,8,24,47,24,1],
  ["ESP","Especialización en Investigación de Accidentes de Tránsito","Metodología de la Investigación",2,8,24,43,24,5],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Derecho Penal y Actuaciones de Policía Judicial",2,8,24,46,24,2],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Sistemas de Información Policial",2,8,24,46,24,2],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Ética y Deontología",2,8,24,43,24,5],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Habilidades de Poder",2,8,24,48,24,0],
  ["TEC","Tecnología en Gestión del Servicio de Policía","Gestión del Conflicto",2,8,24,43,24,5],
  ["PRE","Licenciatura en Educación Comunitaria","Educación Mediada por las TIC",3,12,36,56,36,16],
  ["PRE","Licenciatura en Educación Comunitaria","Desarrollo de la Creatividad",2,8,24,48,24,0],
  ["PRE","Licenciatura en Educación Comunitaria","Evaluación y Gestión de la Calidad en la Institución",3,12,36,64,36,8],
  ["PRE","Licenciatura en Educación Comunitaria","Estadística Básica",2,8,24,40,24,8],
  ["PRE","Licenciatura en Educación Comunitaria","Ética Profesional",2,8,24,32,24,16],
  ["PRE","Licenciatura en Educación Comunitaria","Pensamiento Numérico y Probabilístico",2,8,31,62,31,0],
  ["PRE","Licenciatura en Educación Comunitaria","Educación Policial",2,8,24,47,24,1],
  ["PRE","Licenciatura en Educación Comunitaria","Comprensión y Producción de Textos II",2,8,24,46,24,2],
  ["PRE","Licenciatura en Educación Comunitaria","Pedagogía Social Comunitaria",2,8,24,48,24,0],
  ["PRE","Licenciatura en Educación Comunitaria","Psicología del Aprendizaje",2,8,24,41,24,7],
  ["PRE","Licenciatura en Educación Comunitaria","Pedagogía para la Convivencia",3,12,36,61,36,11],
  ["PRE","Licenciatura en Educación Comunitaria","Investigación en Educación Social",2,8,24,48,24,0],
  ["ESP","Especialización Técnica en Niveles de Riesgo","Opción de Grado",2,8,24,44,24,4],
  ["ESP","Especialización Técnica en Niveles de Riesgo","Fenomenología de la Violencia en Colombia",2,8,24,46,24,2],
  ["ESP","Especialización Técnica en Niveles de Riesgo","Marco Legal en Seguridad y Protección",3,12,36,72,36,0],
  ["ESP","Especialización Técnica en Niveles de Riesgo","Derechos Humanos y Mecanismos de Protección",2,8,24,43,24,5],
  ["ESP","Especialización Técnica en Niveles de Riesgo","Métodos y Gestión de la Investigación",2,8,24,47,24,1],
  ["ESP","Especialización Técnica en Niveles de Riesgo","Ética y Responsabilidad en la Protección",2,8,24,48,24,0],
  ["PRE","Licenciatura en Educación Comunitaria","Instituciones y Sistemas Educativos",2,8,30,58,30,2],
  ["CAG","Cursos autogestionables","Curso autogestionable 1",4,16,48,78,48,18],
  ["CAG","Cursos autogestionables","Curso autogestionable 2",4,16,48,78,48,18],
  ["CAG","Cursos autogestionables","Curso autogestionable 3",4,16,48,78,48,18]
].map(([tipo, programa, curso, creditos, temas, subtemas, html, actividades, videos]) => ({ tipo, programa, curso, creditos, temas, subtemas, html, actividades, videos }))

// Cifras de un curso del plan: estructuras, guiones, recursos por guion y páginas aproximadas.
export function cifras(f, ppr = PAGINAS_POR_RECURSO) {
  const recursosPorGuion = Math.max(1, Math.round(f.html / f.temas)) // un guion lleva recursos enteros
  const paginasPorGuion = Math.max(1, Math.round(recursosPorGuion * ppr))
  return { estructuras: f.creditos, guionesPorEstructura: f.temas / f.creditos, guiones: f.temas, recursosPorGuion, paginasPorGuion, paginas: f.temas * paginasPorGuion }
}

const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'y', 'a', 'para', 'con', 'al', 'syllabus', 'copia', 'ok', 'sin', 'nombre'])
const palabras = (t) => sinTildes(t).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((p) => p && !VACIAS.has(p) && !/^\d+$/.test(p))

// Asignaturas del plan que corresponden al nombre de un curso de Praxia (ej. «Syllabus Fundamentos Administración.» → «Fundamentos de Administración»).
// Coinciden cuando todas las palabras de una de las dos están en la otra; puede haber varias (el mismo nombre en distintos programas).
export function buscarEnPlan(nombreCurso) {
  const a = palabras(nombreCurso)
  if (!a.length) return []
  return PLAN.filter((f) => {
    const b = palabras(f.curso)
    if (!b.length) return false
    const cont = (x, y) => x.every((p) => y.includes(p))
    return cont(a, b) || cont(b, a)
  })
}

// Cifras de un curso de Praxia frente al plan: guiones del plan y páginas aproximadas (guiones generados × páginas por guion). Sin fila en el plan → null.
export function resumenCurso(fila, ppr = PAGINAS_POR_RECURSO) {
  const plan = buscarEnPlan(fila.curso)[0]
  if (!plan) return null
  const c = cifras(plan, ppr)
  const generados = fila.guiones_generados || 0
  return { guionesPlan: c.guiones, paginasPorGuion: c.paginasPorGuion, paginas: generados ? generados * c.paginasPorGuion : null }
}
