// Genera archivos HTML de ejemplo (con texto de prueba) de las plantillas de la plataforma,
// para verlos fuera de la plataforma, abriéndolos directamente en el navegador.
// Uso: node build-ejemplos.js   → crea la carpeta ejemplos/
const fs = require('fs')
const path = require('path')
const R = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')

const css = R('src/base.css') + '\n' + R('src/plataforma/tec.css')
const lib = R('src/lib.js') + '\n' + R('src/plataforma/lib-extra.js')

const PRESETS = { diepo: { nav: '#142749', brand: '#00665F', accent: '#CBFF01', bg: '#FFFFFF' } }
const rgb = (c) => { c = c.replace('#', ''); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) }
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, '0')).join('') }
const FONT = "'Montserrat','Segoe UI',system-ui,-apple-system,Arial,sans-serif"

// Paleta DIEPO fija: los recursos no cambian según la formación (igual que cssTema de la plataforma).
function cssTema() {
  const v = {
    '--nav': '#142749', '--ink': '#142749', '--brand': '#00665F', '--brand2': '#22335D', '--mid': '#1C45B4',
    '--cyan': '#08A6CB', '--cyan-ink': '#151B3B', '--cyan2': '#14A4C9', '--black': '#161616',
    '--tint': mix('#00665F', '#ffffff', 0.9), '--tint2': mix('#08A6CB', '#ffffff', 0.9),
    '--line': '#C8C8C8', '--line2': '#C8C8C8', '--bg': '#FFFFFF', '--muted': 'rgba(20,39,73,.72)',
    '--tit': '#142749', '--prop-bg': mix('#00665F', '#ffffff', 0.9), '--prop-ink': '#00665F', '--prop-tx': '#142749',
    '--lime': '#CBFF01', '--ins': '#CBFF01', '--accent': '#CBFF01', '--accent-light': '#CBFF01', '--accent-dark': '#CBFF01', '--accent-soft': mix('#00665F', '#ffffff', 0.92),
    '--radius': '14px', '--fs': '17px', '--font': FONT, '--ease': 'cubic-bezier(.22,.9,.3,1)'
  }
  return ':root{' + Object.keys(v).map((k) => k + ':' + v[k]).join(';') + '}'
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const safe = (s) => s.replace(/<\//g, '<\\/')
const FUENTE = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">'

function construir(plantilla, contenido, grado, libre) {
  const tpl = R('src/plataforma/plantillas/' + plantilla + '.html').replace('/*CSS*/', () => css).replace('/*LIB*/', () => lib)
  const tema = { layout: { imgLado: 'izq', orientacion: 'horizontal' }, bloqueo: !libre }
  return tpl
    .replace('{{TITULO}}', () => esc(contenido.titulo))
    .replace('/*CONTENIDO*/', () => safe(JSON.stringify(contenido)))
    .replace('/*TEMAJS*/', () => 'window.__LIBRE=' + (libre ? 'true' : 'false') + ';window.__TEMA=' + safe(JSON.stringify(tema)) + ';')
    .replace('/*TEMA*/', () => cssTema(grado))
    .replace('</head>', () => FUENTE + '</head>')
}

const acordeon = {
  id: 'ejemplo-acordeon', tipo: 'acordeon', codigo: 'U1-T1-OVA1', clase: 'OVA',
  tag: 'Exploración por secciones / Unidad 1', titulo: 'Fundamentos de la didáctica',
  chips: ['Didáctica'], pie: 'Programa · Didáctica · U1-T1-OVA1',
  info: { resultado: 'Diseña estrategias didácticas para la formación comunitaria.' },
  introduccion: 'La didáctica estudia los procesos de enseñanza y aprendizaje en contextos reales de formación. Su objeto es orientar cómo se enseña y cómo se aprende.',
  apartados: [
    { titulo: 'Fundamentación conceptual', texto: 'La didáctica es la disciplina que orienta el proceso de enseñar y aprender, con base en teorías y evidencia.', idea: 'Enseñar y aprender son procesos que se diseñan.', img: '' },
    { titulo: 'Enfoques teóricos', texto: 'Se contrastan el enfoque tradicional, el activo y el sociocultural.', idea: '', img: '' },
    { titulo: 'Desarrollo analítico', texto: 'Se comparan los enfoques según sus supuestos y sus efectos en el aula.', idea: '', img: '' },
    { titulo: 'Evidencia investigativa', texto: 'Se revisan estudios sobre la práctica docente en aulas comunitarias.', idea: '', img: '' },
    { titulo: 'Análisis crítico', texto: 'Se identifican las limitaciones de cada enfoque.', idea: '', img: '' },
    { titulo: 'Aplicación', texto: 'Se aplica lo aprendido a un caso de aula comunitaria.', idea: '', img: '' }
  ],
  sintesis: 'Los seis apartados se relacionan entre sí.', referencias: '[Autor, año, título y fuente].', img: '', actividad: null
}

const lectura = {
  id: 'ejemplo-lectura', tipo: 'lectura', codigo: 'U1-T1-OVA3', clase: 'OVA', tag: 'Lectura diagramada · U1-T1-OVA3',
  titulo: 'Del problema a una oportunidad', kicker: 'Observar antes de emprender', subtitulo: 'Observar, proponer y aprender antes de emprender.',
  resumen: 'Transformar una dificultad cotidiana en una oportunidad exige observar, escuchar y poner a prueba las ideas. Esta lectura presenta un recorrido para reconocer necesidades, plantear soluciones iniciales y aprender de la experiencia.',
  chips: [], pie: 'Programa · Didáctica · U1-T1-OVA3', info: {}, centro: 'La espera en la biblioteca',
  secciones: [
    { titulo: 'Introducción', texto: 'Una buena idea no demuestra que exista una oportunidad. Conviene distinguir lo que nos entusiasma crear de lo que otras personas necesitan.\nExploraremos una situación ficticia: las filas en una biblioteca. Antes de diseñar una aplicación, investigaremos la causa de la espera.', estilo: 'normal', img: '' },
    { titulo: 'Reconocer un problema', texto: 'Investigar necesidades permite evaluar si una idea merece desarrollarse. Registre quiénes encuentran la dificultad, cuándo aparece y qué consecuencias tiene.', estilo: 'normal', img: '' },
    { titulo: 'Convertir la idea en una prueba', texto: 'Un prototipo permite representar una propuesta para explorarla y probarla. Sirve para recibir reacciones y ajustar antes de invertir.', estilo: 'normal', img: '' },
    { titulo: 'Aprender con evidencia', texto: 'La validación consiste en contrastar lo que se supone con lo que realmente ocurre. Registre qué observó y qué decidió.', estilo: 'normal', img: '' },
    { titulo: 'Una biblioteca sin filas', texto: 'Un equipo observa cuánto tiempo tarda una persona en conseguir un libro y prueba una solución sencilla con un grupo pequeño.', estilo: 'caso', img: '' },
    { titulo: 'Conclusión', texto: 'Emprender no consiste solamente en imaginar algo nuevo: consiste en comprender un problema real, probar una solución y aprender de los resultados.', estilo: 'sintesis', img: '' },
    { titulo: 'Referencias', texto: 'Laverty, M. y Littel, C. (2020). Entrepreneurship. OpenStax.  Brown, T. (2008). Design thinking. Harvard Business Review.', estilo: 'referencias', img: '' }
  ],
  glosario: [
    { termino: 'Necesidad', definicion: 'Carencia o dificultad que una persona reconoce en su entorno.' },
    { termino: 'Empatía', definicion: 'Capacidad de escuchar y comprender a las personas afectadas.' },
    { termino: 'Prototipo', definicion: 'Versión simple de una idea para probarla pronto.' },
    { termino: 'Evidencia', definicion: 'Información observada que respalda una decisión.' }
  ],
  pasos: [
    { titulo: 'Prototipo', texto: 'Aterrice la idea' }, { titulo: 'Validación', texto: 'Contraste con evidencia' }, { titulo: 'Reacción', texto: 'Ajuste y vuelva a probar' }
  ],
  registro: [
    { observa: 'Tiempo de espera', registra: 'Minutos por persona' }, { observa: 'Reacción del usuario', registra: 'Comentarios textuales' }, { observa: 'Resultado', registra: 'Decisión tomada' }
  ],
  actividad: null
}

const salida = path.join(__dirname, 'ejemplos')
fs.mkdirSync(salida, { recursive: true })
const archivos = []
for (const g of ['diepo']) {
  const f = 'acordeon-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('acordeon', acordeon, g, false))
  archivos.push(path.join(salida, f))
}
for (const g of ['diepo']) {
  const f = 'lectura-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('lectura', lectura, g, false))
  archivos.push(path.join(salida, f))
}
// Acordeón + actividad de emparejamiento como paso final aparte
const empar = {
  ...acordeon, id: 'ejemplo-acordeon-emparejamiento', unidadNum: 1,
  actividad: {
    tipo: 'emparejamiento', nombre: 'Relacione conceptos y aplicaciones', enunciado: 'Relacione cada concepto de la didáctica con la aplicación que le corresponde.',
    materiales: '', pasos: [], evidencia: '', criterios: [],
    pares: [
      { a: 'Didáctica', b: 'Orienta cómo se enseña y cómo se aprende.' },
      { a: 'Currículo', b: 'Organiza contenidos, propósitos y secuencias.' },
      { a: 'Evaluación formativa', b: 'Ofrece retroalimentación mientras se aprende.' },
      { a: 'Metodología', b: 'Define el camino y los métodos de la enseñanza.' },
      { a: 'Aprendizaje significativo', b: 'Conecta lo nuevo con lo que ya se sabe.' },
      { a: 'Estrategia didáctica', b: 'Combina actividades para alcanzar un propósito.' }
    ]
  }
}
for (const g of ['diepo']) {
  const f = 'acordeon-emparejamiento-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('acordeon', empar, g, false))
  archivos.push(path.join(salida, f))
}
// Acordeón + cuestionario con retroalimentación
const cuest = {
  ...acordeon, id: 'ejemplo-acordeon-cuestionario', unidadNum: 1,
  actividad: { tipo: 'cuestionario', nombre: 'Compruebe lo aprendido', enunciado: 'Responda las preguntas y consulte la retroalimentación de cada una.', materiales: '', pasos: [], evidencia: '', criterios: [], pares: [], categorias: [], criterio: '',
    preguntas: [
      { tipo: 'unica', enunciado: '¿Qué estudia la didáctica?', opciones: 'Los procesos de enseñanza y aprendizaje*\nSolo la administración escolar\nÚnicamente la historia de la educación\nLas normas de convivencia', retro: 'La didáctica orienta cómo se enseña y cómo se aprende.' },
      { tipo: 'multiple', enunciado: '¿Cuáles son componentes del proceso didáctico?', opciones: 'Propósitos*\nEstrategias*\nSanciones\nEvaluación*', retro: 'Propósitos, estrategias y evaluación forman parte del proceso didáctico.' },
      { tipo: 'vf', enunciado: 'La evaluación formativa ofrece retroalimentación mientras se aprende.', opciones: 'Verdadero*\nFalso', retro: 'Es verdadero: su propósito es mejorar el aprendizaje.' }
    ] }
}
for (const g of ['diepo']) {
  const f = 'acordeon-cuestionario-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('acordeon', cuest, g, false))
  archivos.push(path.join(salida, f))
}
// Acordeón + actividad de clasificación
const clasif = {
  ...acordeon, id: 'ejemplo-acordeon-clasificacion', unidadNum: 1,
  actividad: {
    tipo: 'clasificacion', nombre: 'Clasifique los conceptos de la didáctica', enunciado: '', materiales: '', pasos: [], evidencia: '', criterios: [], pares: [],
    criterio: 'Agrupe cada elemento según la función que cumple en el proceso educativo.',
    categorias: [
      { nombre: 'Enseñanza', descripcion: 'Acciones que realiza quien enseña.', elementos: 'Explicar el concepto\nModelar un procedimiento\nDemostrar con un ejemplo' },
      { nombre: 'Aprendizaje', descripcion: 'Acciones que realiza quien aprende.', elementos: 'Practicar con ejercicios\nComprender la idea central\nAplicar en un caso' },
      { nombre: 'Evaluación', descripcion: 'Acciones que valoran el avance.', elementos: 'Valorar el desempeño\nRetroalimentar el resultado' }
    ]
  }
}
for (const g of ['diepo']) {
  const f = 'acordeon-clasificacion-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('acordeon', clasif, g, false))
  archivos.push(path.join(salida, f))
}
// Crucigrama
const cruci = {
  id: 'ejemplo-crucigrama', tipo: 'crucigrama', codigo: 'U1-T1-OVA2', clase: 'OVA', unidadNum: 1, tag: 'Exploración de conceptos / Unidad 1',
  titulo: 'Crucigrama técnico de didáctica', tituloCrucigrama: 'Conceptos de la didáctica', chips: [], pie: 'Programa · Didáctica', info: {}, actividad: null,
  nota: 'Términos técnicos del subtema y definiciones validadas.',
  palabras: [
    { palabra: 'DIDACTICA', pista: 'Disciplina que estudia los procesos de enseñanza.' }, { palabra: 'CURRICULO', pista: 'Plan que organiza contenidos y propósitos.' },
    { palabra: 'EVALUACION', pista: 'Proceso para valorar el aprendizaje.' }, { palabra: 'METODOLOGIA', pista: 'Conjunto de métodos de enseñanza.' },
    { palabra: 'APRENDIZAJE', pista: 'Resultado de aprender.' }, { palabra: 'ENSENANZA', pista: 'Acción de enseñar.' }
  ]
}
for (const g of ['diepo']) {
  const f = 'crucigrama-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('crucigrama', cruci, g, false))
  archivos.push(path.join(salida, f))
}
// Acordeón + laboratorio virtual
const labEj = {
  ...acordeon, id: 'ejemplo-acordeon-laboratorio', unidadNum: 1,
  actividad: { tipo: 'laboratorio', nombre: 'Laboratorio: ajustar una clase', enunciado: '', materiales: '', pasos: [], evidencia: '', criterios: [],
    situacion: 'Una clase de 45 minutos tiene poca participación. Observe los datos y decida cómo mejorarla.',
    diagPregunta: '¿Cuál es el diagnóstico más probable?', diagOpciones: 'La actividad no cambia de ritmo y el grupo pierde atención*\nLos estudiantes no tienen interés en aprender\nEl salón es demasiado pequeño', diagRetro: 'La falta de cambios de ritmo explica la pérdida de atención.',
    configs: [
      { nombre: 'Configuración A · Exposición', indicadores: 'Participación | 25\nAtención sostenida | 30\nProducto final | 40' },
      { nombre: 'Configuración B · Trabajo en grupos', indicadores: 'Participación | 80\nAtención sostenida | 75\nProducto final | 70' }
    ],
    criterioComp: 'Compare qué configuración logra mayor participación y atención sostenida.',
    intervPregunta: '¿Qué intervención aplicaría primero?', intervOpciones: 'Combinar breves exposiciones con trabajo en grupos*\nAumentar el tiempo de exposición\nAplicar un examen sorpresa', intervRetro: 'Alternar momentos de exposición y trabajo colaborativo mantiene la atención.',
    reporte: 'Explique qué observó en cada configuración, qué intervención eligió y por qué.' }
}
for (const g of ['diepo']) {
  const f = 'acordeon-laboratorio-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('acordeon', labEj, g, false))
  archivos.push(path.join(salida, f))
}
// Acordeón + tarea evaluativa
const tareaEj = {
  ...acordeon, id: 'ejemplo-acordeon-tarea', unidadNum: 1,
  actividad: { tipo: 'tarea', nombre: 'Reto: planear una clase', objetivo: 'Diseñar la planeación de una clase aplicando los conceptos de la didáctica.',
    enunciado: 'Elija un tema de su interés y diseñe una clase de 45 minutos, justificando cada decisión.', materiales: 'Plantilla de planeación y lista de chequeo.',
    pasos: ['Analice el problema | Identifique el grupo, el tema y el propósito.', 'Contraste la evidencia | Revise qué estrategias funcionan para ese grupo.', 'Construya su respuesta | Redacte la planeación con sus decisiones.', 'Revise el producto | Compare su texto con los criterios antes de entregar.'],
    guias: '¿Cuál es el propósito de la clase?\n¿Qué estrategia usará y por qué?\n¿Cómo comprobará que hubo aprendizaje?',
    estructura: 'Documento de una a dos páginas con propósito, estrategia, evidencia de aprendizaje y conclusión.', antes: 'Revise que cada decisión tenga una justificación y que el texto sea claro.',
    evidencia: 'Un documento de planeación de la clase.',
    criterios: ['Coherencia | El propósito, la estrategia y la evidencia se relacionan.', 'Justificación | Cada decisión se explica con argumentos.', 'Claridad | El texto es organizado y fácil de seguir.'] }
}
for (const g of ['diepo']) {
  const f = 'acordeon-tarea-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('acordeon', tareaEj, g, false))
  archivos.push(path.join(salida, f))
}
// Presentación multimedia (8 diapositivas)
const presEj = {
  id: 'ejemplo-presentacion', tipo: 'presentacion', codigo: 'U1-T1-OVA4', clase: 'OVA', unidadNum: 1, tag: 'Presentación multimedia / Unidad 1',
  titulo: 'Presentación: la didáctica en acción', chips: [], pie: 'Programa · Didáctica', info: {}, actividad: null,
  diapositivas: [
    { titulo: 'Objetivo y activación', layout: 'texto', subtitulo: '', texto: '', items: 'Objetivo del recorrido | Comprender cómo se relacionan la enseñanza, el aprendizaje y la evaluación.\nPregunta inicial | ¿Qué hace que una clase logre que los estudiantes aprendan?\nExplicación progresiva | Avanzará por conceptos, ejemplos y una comprobación final.', extra: '', img: '' },
    { titulo: 'Concepto principal', layout: 'radial', subtitulo: 'La didáctica', texto: '', items: 'Propósito | Define qué se espera lograr con el grupo. | Una meta redactada en términos de desempeño.\nEstrategia | Organiza la actividad de aula. | Trabajo en grupos con una guía.\nEvidencia | Muestra lo aprendido. | Un producto breve al final de la clase.\nRetroalimentación | Orienta la mejora. | Comentarios sobre el borrador.\nContexto | Ajusta la enseñanza a las personas. | Ejemplos del entorno comunitario.\nSecuencia | Ordena los momentos de la clase. | Inicio, desarrollo y cierre.', extra: '', img: '' },
    { titulo: 'Ejemplo contextualizado', layout: 'puntos', subtitulo: 'Observación del aula', texto: '', items: 'Punto 1 | El docente explica mientras el grupo escucha. | La atención baja a los 15 minutos.\nPunto 2 | Un trabajo en parejas activa las preguntas. | Cambiar de actividad recupera el interés.', extra: '', img: '' },
    { titulo: 'Relaciones del concepto', layout: 'tarjetas', subtitulo: '', texto: '', items: 'Concepto 1 | Se relaciona con el propósito de la clase.\nConcepto 2 | Se apoya en estrategias que ordenan la actividad.\nConcepto 3 | Se verifica con evidencias del aprendizaje.', extra: '', img: '' },
    { titulo: 'Profundización del concepto', layout: 'acordeon', subtitulo: '', texto: '', items: 'Enfoque tradicional | Centrado en la exposición del docente.\nEnfoque activo | Centrado en la participación del estudiante.\nEnfoque sociocultural | Centrado en la interacción y el contexto.', extra: 'La didáctica se decide según el propósito y el grupo.', img: '' },
    { titulo: 'Ejemplos y aplicaciones', layout: 'galeria', subtitulo: 'Aplicaciones en el aula', texto: '', items: 'Ejemplo 1 | Planeación de una clase por propósitos.\nEjemplo 2 | Rúbrica para evaluar un producto.\nEjemplo 3 | Trabajo colaborativo con roles.\nEjemplo 4 | Retroalimentación entre pares.', extra: '', img: '' },
    { titulo: 'Comprueba lo aprendido', layout: 'pregunta', subtitulo: 'Pregunta 1 · Única respuesta', texto: '¿Qué orienta la elección de una estrategia didáctica?', items: 'El propósito y las características del grupo*\nÚnicamente la costumbre del docente\nLa disponibilidad de salones', extra: 'La estrategia se elige según el propósito y el grupo.', img: '' },
    { titulo: 'Síntesis del aprendizaje', layout: 'sintesis', subtitulo: 'Idea para llevar', texto: 'La didáctica integra propósito, estrategia, evidencia y retroalimentación para que el aprendizaje sea posible.', items: '', extra: '¿Cómo aplicaría estas ideas en su próxima clase?', img: '' }
  ]
}
for (const g of ['diepo']) {
  const f = 'presentacion-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('presentacion', presEj, g, false))
  archivos.push(path.join(salida, f))
}
// Estudio de casos
const casoEj = {
  id: 'ejemplo-caso', tipo: 'casos', codigo: 'U1-T1-OVA3', clase: 'OVA', unidadNum: 1, tag: 'Observación y análisis / Unidad 1',
  titulo: 'Estudio de caso: la clase que no engancha', tituloReto: 'Una clase sin participación', chips: [], pie: 'Programa · Didáctica', info: {}, actividad: null,
  contexto: 'En una institución comunitaria, un docente prepara con cuidado sus clases, pero los estudiantes casi no participan. Cada sesión termina con pocas preguntas y trabajos poco elaborados.\nEl docente decide observar su práctica durante dos semanas y registrar qué actividades generan más interés.',
  objetivo: 'Analizar el caso y proponer una mejora didáctica sustentada en evidencia.',
  tituloExploracion: 'Observación del aula', subExploracion: 'Seleccione cada evidencia para ver su explicación.',
  evidencias: [
    { titulo: 'Evidencia 1', texto: 'Los estudiantes escuchan en silencio durante la exposición del docente.', dato: 'La mayor parte del tiempo habla el docente.', x: '28', y: '40' },
    { titulo: 'Evidencia 2', texto: 'Cuando se propone un trabajo en grupos, las preguntas aumentan.', dato: 'La participación sube con actividades colaborativas.', x: '66', y: '62' }
  ],
  preguntas: '¿Qué estrategia usa el docente?\n¿Qué evidencia muestra poca participación?\n¿Qué cambiaría usted?',
  pasos: 'Lea el contexto con atención\nRevise las evidencias\nRedacte su propuesta de mejora',
  apartados: [
    { titulo: 'Identifique el problema', guia: 'Describa con sus palabras qué sucede en el aula.', clave: 'Distinga hechos de interpretaciones.' },
    { titulo: 'Analice las causas', guia: 'Relacione las evidencias con posibles causas.', clave: '' },
    { titulo: 'Proponga una mejora', guia: 'Plantee una acción concreta y justifíquela.', clave: '' }
  ],
  defienda: '¿Cómo aplicaría su propuesta en una clase real y cómo sabría si funcionó?',
  estructura: 'Problema, evidencias, análisis de causas, propuesta de mejora y forma de verificar el resultado.',
  criterios: 'Claridad del problema\nUso de evidencias\nCoherencia de la propuesta'
}
for (const g of ['diepo']) {
  const f = 'estudio-casos-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('casos', casoEj, g, false))
  archivos.push(path.join(salida, f))
}
// Mapa conceptual
const mapaEj = {
  id: 'ejemplo-mapa', tipo: 'mapa', codigo: 'U1-T1-OVI3', clase: 'OVI', unidadNum: 1, tag: 'Exploración entre conceptos / Unidad 1',
  titulo: 'Mapa conceptual de la didáctica', tituloMapa: 'La didáctica y sus componentes', intro: 'Explore los conceptos y observe cómo se relacionan entre sí.', chips: [], pie: 'Programa · Didáctica', info: {}, actividad: null,
  central: 'Didáctica', centralTexto: 'Disciplina que estudia los procesos de enseñanza y aprendizaje.',
  ramas: [
    { titulo: 'Enseñanza', relacion: 'orienta', texto: 'Acción intencionada de quien guía el aprendizaje.', hijosTxt: 'Estrategias | se concretan en | Formas de organizar la actividad de aula.' },
    { titulo: 'Aprendizaje', relacion: 'se propone', texto: 'Proceso mediante el cual se construye conocimiento.', hijosTxt: 'Evidencias | se muestra en | Productos que dan cuenta de lo aprendido.' },
    { titulo: 'Currículo', relacion: 'se organiza en', texto: 'Plan que ordena propósitos, contenidos y secuencias.', hijosTxt: 'Contenidos | se seleccionan | Saberes que se enseñan en cada momento.' },
    { titulo: 'Evaluación', relacion: 'se valora con', texto: 'Proceso para valorar el avance y retroalimentar.', hijosTxt: 'Retroalimentación | mejora | Información que ayuda a ajustar lo aprendido.' }
  ],
  relacionTema: 'Estos conceptos explican cómo se diseña una clase coherente.', reflexion: 'Elija un concepto del mapa y explique cómo lo aplicaría en una clase.', ejemplo: 'Un docente planea una clase partiendo del propósito, define estrategias y evidencia el aprendizaje con un producto.'
}
for (const g of ['diepo']) {
  const f = 'mapa-conceptual-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('mapa', mapaEj, g, false))
  archivos.push(path.join(salida, f))
}
// Diagrama de flujo
const flujoEj = {
  id: 'ejemplo-flujo', tipo: 'flujo', codigo: 'U1-T1-OVI2', clase: 'OVI', unidadNum: 1, tag: 'Ruta de decisión / Unidad 1',
  titulo: 'Procedimiento para planear una clase', proposito: 'Aplicar un procedimiento claro para planear una clase y tomar decisiones sobre sus ajustes.', chips: [], pie: 'Programa · Didáctica', info: {}, actividad: null,
  explicacion: 'El procedimiento se repite hasta que la evidencia muestre que se alcanzó el propósito.',
  nodos: [
    { nombre: 'Inicio', descripcion: 'Se define el tema y el grupo de estudiantes.', conexion: 'Definir el propósito', forma: '', img: '' },
    { nombre: 'Definir el propósito', descripcion: 'Se redacta qué debe lograr el estudiante.', conexion: 'Diseñar la actividad', forma: '', img: '' },
    { nombre: 'Diseñar la actividad', descripcion: 'Se eligen estrategias y materiales.', conexion: 'Aplicar en el aula', forma: '', img: '' },
    { nombre: 'Aplicar en el aula', descripcion: 'Se desarrolla la actividad con el grupo.', conexion: 'Evaluar el resultado', forma: '', img: '' },
    { nombre: '¿Se logró el propósito?', descripcion: 'Se revisan las evidencias frente al propósito.', conexion: 'Si sí, finalizar; si no, ajustar la actividad', forma: '', img: '' },
    { nombre: 'Ajustar la actividad', descripcion: 'Se modifica la estrategia según lo observado.', conexion: 'Aplicar de nuevo', forma: '', img: '' },
    { nombre: 'Fin', descripcion: 'La planeación queda lista para compartirse.', conexion: '', forma: '', img: '' }
  ]
}
for (const g of ['diepo']) {
  const f = 'diagrama-flujo-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('flujo', flujoEj, g, false))
  archivos.push(path.join(salida, f))
}
// Línea de tiempo
const tiempo = {
  id: 'ejemplo-linea', tipo: 'lineatiempo', codigo: 'U1-T1-OVI1', clase: 'OVI', unidadNum: 1,
  tag: 'Secuencia progresiva / Unidad 1', titulo: 'Evolución de la didáctica', chips: [], pie: 'Programa · Didáctica', info: {},
  tituloSecuencia: 'Evolución de la didáctica en el tiempo', intro: 'Recorra la línea de tiempo y observe cómo cambió la forma de enseñar.',
  eventos: [
    { fecha: 'Siglo XVII', titulo: 'Nace la didáctica como disciplina', texto: 'Se propone un método universal para enseñar todo a todos, con orden y gradualidad.', cambio: 'La enseñanza empieza a pensarse como un método y no solo como un oficio.', img: '' },
    { fecha: 'Siglo XIX', titulo: 'Educación sistemática', texto: 'Se organizan los pasos formales de la lección y se profesionaliza la docencia.', cambio: 'Se estructura la clase en etapas.', img: '' },
    { fecha: 'Siglo XX', titulo: 'Escuela activa', texto: 'El estudiante pasa a ser protagonista y aprende haciendo.', cambio: 'Del docente que transmite al estudiante que construye.', img: '' },
    { fecha: 'Década de 1970', titulo: 'Enfoque sociocultural', texto: 'Se reconoce el contexto y la interacción como parte del aprendizaje.', cambio: 'El aula se entiende como comunidad.', img: '' },
    { fecha: 'Siglo XXI', titulo: 'Didáctica y tecnología', texto: 'Las herramientas digitales amplían las formas de enseñar y evaluar.', cambio: 'Aparecen entornos virtuales y recursos interactivos.', img: '' }
  ],
  comparar: 'Compare dos momentos de la línea de tiempo y explique qué cambió en la manera de enseñar.', actividad: null
}
for (const g of ['diepo']) {
  const f = 'linea-tiempo-' + g + '.html'
  fs.writeFileSync(path.join(salida, f), construir('lineatiempo', tiempo, g, false))
  archivos.push(path.join(salida, f))
}
const items = (nombres, extra) => nombres.map((n, i) => ({
  titulo: n, subtitulo: '', texto: 'Texto de ejemplo del punto «' + n + '». Aquí va el contenido tomado del guion, explicado con claridad para el estudiante.',
  idea: 'Idea central de «' + n + '».', fuente: 'Autor (2020). Título de la fuente.', x: '', y: '', img: '', ...(extra ? extra[i] : {})
}))
const baseInfo = { id: 'ejemplo-infografia', tipo: 'infografia', codigo: 'U1-T1-OVI2', clase: 'OVI', tag: 'Infografía · U1-T1-OVI2', chips: [], pie: 'Programa · Didáctica', info: { resultado: 'Aplica metodologías ágiles al servicio.' }, actividad: null, fuentes: 'Autor (2020).', kicker: 'Innovación en el servicio policial', descripcion: 'Explora cinco formas de colaborar, simplificar procesos y diseñar mejores servicios.', dato: 'Dato importante de ejemplo.', img: '' }
const infografias = {
  'infografia-hex': { plantilla: 'infografia-hex', datos: { ...baseInfo, titulo: 'Innovar para servir mejor', centro: 'Título', bloques: items(['Subtítulo 1', 'Subtítulo 2', 'Subtítulo 3', 'Subtítulo 4', 'Subtítulo 5', 'Subtítulo 6']) } },
  'infografia-radial': { plantilla: 'infografia-radial', datos: { ...baseInfo, titulo: 'Innovar para servir mejor', centro: 'Innovar para servir mejor', kicker: 'Estrategia policial', bloques: items(['Fundamentación conceptual', 'Desarrollo analítico', 'Enfoques teóricos', 'Evidencia investigativa', 'Aplicación', 'Evaluación', 'Síntesis y conclusión']) } },
  'infografia-pines': { plantilla: 'infografia-pines', datos: { ...baseInfo, titulo: 'Metodologías ágiles', bloques: items(['Agile', 'Scrum', 'Lean', 'Six Sigma', 'Design Thinking'], [{ x: '28', y: '24' }, { x: '62', y: '30' }, { x: '24', y: '56' }, { x: '70', y: '60' }, { x: '48', y: '82' }]) } }
}
for (const g of ['diepo']) {
  for (const [nombre, v] of Object.entries(infografias)) {
    const f = nombre + '-' + g + '.html'
    fs.writeFileSync(path.join(salida, f), construir(v.plantilla, v.datos, g, false))
    archivos.push(path.join(salida, f))
  }
}
// Diseños 2 y 3 de línea de tiempo, crucigrama y acordeón (mismos datos de ejemplo, otra plantilla)
for (const [pl, nom, datos] of [['lineatiempo', 'linea-tiempo', tiempo], ['crucigrama', 'crucigrama', cruci], ['acordeon', 'acordeon', acordeon]]) {
  for (const v of ['2', '3']) {
    for (const g of ['diepo']) {
      const f = nom + '-v' + v + '-' + g + '.html'
      fs.writeFileSync(path.join(salida, f), construir(pl + '-' + v, { ...datos, variante: v }, g, false))
      archivos.push(path.join(salida, f))
    }
  }
}
// Infografía vertical con fotos (RED), video explicativo, podcast y portada: faltaban en la galería (solo existían las demás infografías).
const comun = (tipo, id, codigo, clase, tag) => ({ id, tipo, codigo, clase, tag, chips: [], pie: 'Programa · Didáctica · ' + codigo, info: { resultado: 'Diseña estrategias didácticas para la formación comunitaria.' }, actividad: null })
const nuevos = {
  'infografia': {
    plantilla: 'infografia',
    datos: {
      ...comun('infografia', 'ejemplo-infografia-vertical', 'U1-T1-OVI1', 'OVI', 'Infografía · U1-T1-OVI1'),
      titulo: 'Innovar para servir mejor', variante: 'red', centro: '', kicker: 'Innovación en el servicio',
      descripcion: 'Cinco prácticas sencillas para mejorar un servicio a partir de lo que la comunidad necesita.', dato: '5 prácticas', fuentes: 'Autor (2020). Título de la fuente.', img: '',
      bloques: items(['Colaborar con la comunidad', 'Simplificar los procesos', 'Escuchar antes de decidir', 'Probar y ajustar', 'Medir el resultado'])
    }
  },
  'portada': {
    plantilla: 'portada',
    datos: {
      ...comun('portada', 'ejemplo-portada', 'U1-PRES', 'OVP', 'Portada · Unidad 1'),
      titulo: 'Fundamentos de la didáctica', descripcion: 'En esta unidad conocerás cómo se relacionan la enseñanza, el aprendizaje y la evaluación, y cómo planear una clase que logre que las personas aprendan.',
      etiquetas: [{ texto: 'Didáctica' }, { texto: 'Enseñanza' }, { texto: 'Aprendizaje' }, { texto: 'Evaluación' }], boton: 'Regresar al inicio', img: ''
    }
  },
  'video': {
    plantilla: 'video',
    datos: {
      ...comun('video', 'ejemplo-video', 'U1-T1-OVV1', 'OVV', 'Video explicativo · U1-T1-OVV1'),
      titulo: 'Qué es la didáctica', duracion: '4 minutos', tecnica: 'Explicación con ejemplos',
      escenas: [
        { titulo: 'Escena 1 · Apertura', visual: 'Plano general de un aula comunitaria con personas conversando en grupo.', narracion: '¿Alguna vez te has preguntado por qué una clase funciona y otra no? La respuesta empieza en la didáctica.', img: '' },
        { titulo: 'Escena 2 · Concepto', visual: 'Esquema animado con tres círculos: enseñar, aprender y evaluar.', narracion: 'La didáctica estudia cómo se enseña y cómo se aprende, y orienta las decisiones que toma quien enseña.', img: '' },
        { titulo: 'Escena 3 · Ejemplo', visual: 'Una docente planea su clase con una lista de pasos sobre una mesa.', narracion: 'Imagina que debes enseñar un tema nuevo: eliges un objetivo, preparas una actividad y decides cómo comprobarás lo aprendido.', img: '' },
        { titulo: 'Escena 4 · Cierre', visual: 'Pantalla final con la idea central en texto grande.', narracion: 'Enseñar y aprender son procesos que se diseñan. En el siguiente recurso lo pondrás en práctica.', img: '' }
      ]
    }
  },
  'podcast': {
    plantilla: 'podcast',
    datos: {
      ...comun('podcast', 'ejemplo-podcast', 'U1-T1-OVP1', 'OVP', 'Podcast · U1-T1-OVP1'),
      titulo: 'Conversando sobre didáctica', duracion: '8 minutos',
      bloques: [
        { etiqueta: 'Presentación', texto: 'Bienvenidas y bienvenidos. Hoy conversamos sobre cómo se relacionan enseñar, aprender y evaluar en una clase real.' },
        { etiqueta: 'Pregunta 1', texto: '¿Qué significa planear una clase? Planear es decidir con anticipación qué se quiere lograr, con qué actividades y cómo se sabrá si se logró.' },
        { etiqueta: 'Pregunta 2', texto: '¿Cómo se enseña mejor un tema difícil? Conviene partir de un ejemplo cercano, avanzar por pasos cortos y comprobar la comprensión en cada uno.' },
        { etiqueta: 'Idea clave', texto: 'Enseñar y aprender son procesos que se diseñan: no ocurren solos y mejoran cuando se revisan.' },
        { etiqueta: 'Cierre', texto: 'Gracias por escuchar. Antes de seguir, piensa en una clase que recuerdes bien: ¿qué la hizo funcionar?' }
      ]
    }
  }
}
for (const [nombre, v] of Object.entries(nuevos)) {
  const f = nombre + '-diepo.html'
  fs.writeFileSync(path.join(salida, f), construir(v.plantilla, v.datos, 'diepo', false))
  archivos.push(path.join(salida, f))
}
console.log(archivos.join('\n'))
