// Rellena el DEMO local con avisos SIMULADOS de n8n (firmados igual que lo hará el subflujo real) para ver el paso «Matrices y H5P» del curso
// sin que n8n esté listo. Solo para el demo temporal: usa el secreto de demo y escribe directo en su base. NO es para producción.
//
//   1) npm run demo          (con PG_PORT si el puerto por defecto está ocupado)
//   2) PG_PORT=<el mismo> node test/demo-pipeline-simulado.js [correo] [--terminar]
//      Crea (si no existe) el curso «demo-pipeline» de esa persona y le manda los avisos. Con --terminar, la corrida de H5P acaba.
//   Entrar como esa persona (por defecto ana@demo.co, clave ClaveDemo2026) y abrir el curso → paso «4 · Matrices y H5P».
import crypto from 'node:crypto'
import pg from 'pg'

const args = process.argv.slice(2)
const terminar = args.includes('--terminar')
const atascado = args.includes('--atascado')
const correo = args.find((a) => !a.startsWith('--')) || 'ana@demo.co'
const BASE = process.env.DEMO_URL || 'http://127.0.0.1:' + (process.env.PORT || '3002')
const SECRETO = process.env.N8N_EVENTOS_SECRETO || 'secreto-solo-para-el-demo-local-0123456789'
const PG_PORT = Number(process.env.PG_PORT) || 54330
const CURSO = 'demo-pipeline'
const TRABAJO = 'a1b2c3d4-0000-4000-8000-0000000000a1' // el «trabajo de guiones» del que cuelga todo lo demás
const CARPETA = 'https://drive.google.com/drive/folders/1CarpetaDemoPipeline'
const doc = (n) => 'https://docs.google.com/document/d/guionDemo' + n + 'abcdef'
const HOJA = (n) => 'https://docs.google.com/spreadsheets/d/matrizDemo' + n + 'abcdef/edit'

// 1) sesión y curso
const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: 'ClaveDemo2026' }) })
if (!login.ok) { console.error('No se pudo entrar como ' + correo + ' (¿está el demo en ' + BASE + '?)'); process.exit(1) }
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
const h = { cookie, 'x-ova': '1', 'content-type': 'application/json' }
const lista = await (await fetch(BASE + '/api/proyectos', { headers: h })).json()
const existente = lista.find((p) => p.id === CURSO)
const proyecto = {
  id: CURSO, programa: 'Programa demo', curso: 'Curso de demostración del pipeline', creado: Date.now(), syllabusUrl: 'https://docs.google.com/document/d/syllabusDemo1234', carpetaUrl: CARPETA,
  syllabus: { estado: 'listo', mensaje: '', documentos: [1, 2, 3, 4].map((n) => ({ unidad: n, nombre: 'Unidad ' + n + ' · Tema de ejemplo', url: doc(n), aprobado: true, visto: true, temas: [] })) },
  recursos: [], guiones: [], info: {}, ...(existente ? { _v: existente._v } : {})
}
const g = await fetch(BASE + '/api/proyectos/' + CURSO, { method: 'PUT', headers: h, body: JSON.stringify(proyecto) })
if (!g.ok) { console.error('No se pudo crear el curso de demo: ' + g.status); process.exit(1) }

// 2) origen del trabajo (en producción lo anota Praxia al lanzar los guiones)
const usuarioId = (await (await fetch(BASE + '/api/auth/yo', { headers: h })).json()).id
const bd = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PG_PORT}/ova` })
await bd.connect()
await bd.query("INSERT INTO pipeline_origen (trabajo_id, propietario_id, proyecto_id, carpeta_raiz, etapa, unidad) VALUES ($1, $2, $3, $4, 'guiones', 1) ON CONFLICT (trabajo_id) DO NOTHING", [TRABAJO, usuarioId, CURSO, CARPETA])
await bd.end()

// 3) avisos firmados
let k = 0
const t0 = Date.now() - 90 * 1000
const cuando = () => new Date(t0 + (++k) * 2000).toISOString()
const aviso = (evento, etapa, extra) => ({ evento_id: 'demo-' + crypto.randomUUID(), evento, etapa, trabajo_id: null, origen_trabajo_id: TRABAJO, proyecto_id: CURSO, carpeta_raiz: CARPETA, secuencia: k + 1, fecha_evento: cuando(), ...extra })
const fila = (id, n, formato, generador, estado, extra = {}) => ({ id, id_base: 'base-' + id, variante: 'A', alcance: 'Tema ' + n, tema: n, codigo: 'U1-T' + n + '-OVA' + id.slice(-1), formato, titulo: extra.titulo || formato + ' del tema ' + n, con_actividad: false, generador, estado, enlace_guion: doc(1), ...extra })
const enviar = async (cuerpoObj) => {
  const cuerpo = JSON.stringify(cuerpoObj)
  const fecha = String(Math.floor(Date.now() / 1000))
  const firma = crypto.createHmac('sha256', SECRETO).update(fecha + '.' + cuerpo).digest('hex')
  const r = await fetch(BASE + '/api/n8n/eventos', { method: 'POST', headers: { 'content-type': 'application/json', 'x-praxia-fecha': fecha, 'x-praxia-firma': firma }, body: cuerpo })
  const texto = await r.text()
  if (!r.ok) { console.error('El receptor respondió ' + r.status + ': ' + texto); process.exit(1) }
  return JSON.parse(texto)
}

if (atascado) {
  // Una corrida y una matriz que empezaron hace 40 minutos y nunca volvieron a avisar: la pantalla debe marcarlas «sin respuesta».
  const hace40 = (extra) => ({ ...aviso(extra.evento, extra.etapa, extra), fecha_evento: new Date(Date.now() - 40 * 60 * 1000).toISOString() })
  const r2 = await enviar({ eventos: [
    hace40({ evento: 'matrices_inicio', etapa: 'matrices', ejecucion_id: 'demo-matriz-atascada', unidades: [4], forzar: false }),
    hace40({ evento: 'h5p_inicio', etapa: 'h5p', ejecucion_id: 'demo-h5p-atascada', maximo: 3, plan: { a_generar: [{ id: 'r-9', codigo: 'U4-T1-OVA1' }], omitidas: [] } })
  ] })
  console.log('Avisos «atascados» enviados:', JSON.stringify(r2))
  process.exit(0)
}
const ejM = 'demo-matrices-' + Date.now()
const ejH = 'demo-h5p-' + Date.now()
const eventos = [
  aviso('matrices_inicio', 'matrices', { ejecucion_id: ejM, unidades: [1, 2, 3], forzar: false }),
  aviso('matrices_fin', 'matrices', {
    ejecucion_id: ejM,
    resultados: [
      { unidad: 1, formacion: 'Tecnológico', resultado: 'creada', matriz: { id: 'M1', url: HOJA(1), nombre: 'Matriz de recursos - Tecnológico - Unidad 1' },
        filas: [
          fila('r-1', 1, 'Línea de tiempo', 'H5P', 'PENDIENTE'), fila('r-2', 2, 'Línea de tiempo', 'H5P', 'PENDIENTE'), fila('r-3', 3, 'Infografía', 'H5P', 'PENDIENTE'),
          fila('r-4', 4, 'Línea de tiempo', 'H5P', 'PENDIENTE'), fila('r-5', 5, 'Línea de tiempo', 'H5P', 'PENDIENTE'), fila('r-6', 6, 'Video explicativo', 'Videos', 'PENDIENTE'),
          fila('r-7', 7, 'Línea de tiempo', 'H5P', 'PENDIENTE')
        ] },
      { unidad: 2, formacion: 'Tecnológico', resultado: 'omitida_ya_existe', matriz: { id: 'M2', url: HOJA(2), nombre: 'Matriz de recursos - Tecnológico - Unidad 2' }, detalle: 'La matriz ya existía: no se tocó.',
        filas: [fila('s-1', 1, 'Línea de tiempo', 'H5P', 'PENDIENTE'), fila('s-2', 2, 'Mapa conceptual', 'H5P', 'PENDIENTE'), fila('s-3', 3, 'Video explicativo', 'Videos', 'PENDIENTE')] },
      { unidad: 3, formacion: 'Tecnológico', resultado: 'error', detalle: 'No se pudo copiar la plantilla de la matriz: Drive no respondió.' }
    ]
  }),
  aviso('h5p_inicio', 'h5p', {
    ejecucion_id: ejH, maximo: 10,
    plan: { a_generar: [{ id: 'r-1', codigo: 'U1-T1-OVA1' }, { id: 'r-2', codigo: 'U1-T2-OVA2' }, { id: 'r-4', codigo: 'U1-T4-OVA4' }, { id: 'r-5', codigo: 'U1-T5-OVA5' }, { id: 'r-7', codigo: 'U1-T7-OVA7' }],
      omitidas: [{ id: 'r-3', codigo: 'U1-T3-OVA3', motivo: 'sin_plantilla' }, { id: 'r-6', codigo: 'U1-T6-OVA6', motivo: 'generador_no_h5p' }, { id: 's-2', codigo: 'U1-T2-OVA2', motivo: 'sin_plantilla' }, { id: 's-3', codigo: 'U1-T3-OVA3', motivo: 'generador_no_h5p' }] }
  }),
  ...[['r-1', 'GENERADO'], ['r-2', 'GENERADO']].flatMap(([id, estado]) => [
    aviso('h5p_recurso', 'h5p', { ejecucion_id: ejH, unidad: 1, id, estado: 'EN_PROCESO' }),
    aviso('h5p_recurso', 'h5p', { ejecucion_id: ejH, unidad: 1, id, estado, enlace_recurso: 'https://drive.google.com/file/d/h5pDemo' + id + '/view' })
  ]),
  aviso('h5p_recurso', 'h5p', { ejecucion_id: ejH, unidad: 1, id: 'r-4', estado: 'EN_PROCESO' }),
  aviso('h5p_recurso', 'h5p', { ejecucion_id: ejH, unidad: 1, id: 'r-4', estado: 'ERROR', observaciones: 'El guion no incluye fechas para ordenar la línea de tiempo.' }),
  aviso('h5p_recurso', 'h5p', { ejecucion_id: ejH, unidad: 1, id: 'r-5', estado: 'EN_PROCESO' })
]
if (terminar) {
  eventos.push(
    aviso('h5p_recurso', 'h5p', { ejecucion_id: ejH, unidad: 1, id: 'r-5', estado: 'GENERADO', enlace_recurso: 'https://drive.google.com/file/d/h5pDemor-5/view' }),
    aviso('h5p_recurso', 'h5p', { ejecucion_id: ejH, unidad: 1, id: 'r-7', estado: 'EN_PROCESO' }),
    aviso('h5p_recurso', 'h5p', { ejecucion_id: ejH, unidad: 1, id: 'r-7', estado: 'GENERADO', enlace_recurso: 'https://drive.google.com/file/d/h5pDemor-7/view' }),
    aviso('h5p_fin', 'h5p', { ejecucion_id: ejH, resumen: { generados: 4, errores: 1, omitidos: 4, pendientes_restantes: 0 } })
  )
}
const r = await enviar({ eventos })
console.log('Avisos enviados al demo (' + eventos.length + '):', JSON.stringify(r))
console.log('Entre como ' + correo + ' (clave ClaveDemo2026), abra el curso «Curso de demostración del pipeline» y pase al paso 4 · Matrices y H5P.' + (terminar ? '' : ' Para ver la corrida terminada: repita con --terminar.'))
