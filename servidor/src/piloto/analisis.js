// «Curso piloto»: orquestador del análisis de una carpeta de curso en Drive y almacén de trabajos EN MEMORIA.
// Nada se escribe en la base de datos (solo SELECT del catálogo de plantillas); el resultado no guarda el contenido de los documentos, solo nombres, IDs, enlaces y lo extraído.
import { randomUUID } from 'node:crypto'
import { bloquesDeHtml } from './documento.js'
import { asociar, clasificarRaiz, crearLectura, cruzarGuiones, estadoFinal, recursosDeGuiones, resolverSyllabus, carpetaDe } from './asociar.js'
import { baseIdPorPalabras, filasConEncabezado, indiceActividades, indiceRecursos, leerCsv } from './catalogo.js'
import { extraerRecursos } from './unidad.js'
import { cargarPlantillas, simularUnidad } from './simular.js'
import { formacionDeCurso, modoPruebasPlantillas } from '../pipeline/preparacion.js'

export class ErrorAnalisis extends Error {
  constructor(codigo) { super(codigo); this.codigo = codigo }
}
export class ErrorLimite extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo }
}

const MENSAJES = {
  carpeta_no_publica: 'No se pudo leer la carpeta: compártala (y sus documentos) como «Cualquier persona con el enlace» con permiso de lector, o pida activar la lectura por n8n.',
  tiempo_agotado: 'El análisis tardó más de 6 minutos y se detuvo. Vuelva a intentarlo o use una carpeta más pequeña.',
  carpeta_demasiado_grande: 'La carpeta tiene demasiados elementos (más de 500).',
  error_descarga: 'No se pudo descargar la carpeta desde Google Drive. Vuelva a intentarlo en unos minutos.',
  plantillas_no_disponibles: 'No se pudo leer el catálogo de plantillas de Praxia.'
}
export const mensajeDeError = (e) => MENSAJES[e && e.codigo] || 'No se pudo analizar la carpeta.'

// Variantes que ya trae cada guion: la fila «Enlace de visualización» (…/plantillas/ver/<nombre>) del recurso y de su actividad. Si la unidad tiene alguno,
// la variante de cada recurso y actividad es la del documento (se comprueba que exista y que sea de la categoría del recurso); lo que no la trae queda sin
// asignar y NO se completa con la simulación. Solo las unidades sin ningún enlace en sus guiones usan la simulación.
function variantesDelDocumento(u, guiones, catalogo) {
  const porCodigo = new Map()
  const porActividad = new Map()
  for (const g of guiones || []) {
    const e = (g.doc && g.doc.estructurado) || (g.guion && g.guion.estructurado) || (g.lectura && g.lectura.guion && g.lectura.guion.estructurado) || {}
    for (const r of [e.presentacion, ...(e.recursos || [])].filter(Boolean)) {
      if (r.plantilla) porCodigo.set(r.id, r.plantilla)
      if (r.actividad_plantilla) porActividad.set(r.id, r.actividad_plantilla)
    }
  }
  u.variantes_fuente = porCodigo.size + porActividad.size > 0 ? 'documento' : 'simulacion'
  if (u.variantes_fuente !== 'documento') return
  const usadas = new Map() // categoría → plantillas ya usadas en la unidad
  const aplicar = (item, nombre) => {
    // La presentación sin categoría (el documento de la unidad no la indica) toma la plantilla que dice su guion; no hay categoría con la que comprobarla.
    if (item && nombre && item.estado === 'sin_asignar' && item.motivo === 'presentacion_no_indicada') {
      item.estado = 'asignada'; item.motivo = null
      item.aviso = 'La plantilla de la presentación es la que indica el guion (el documento de la unidad no dice su formato).'
      item.variante = { plantilla: nombre, formacion: null, revision: null, url_ver: null, regla: 'documento', candidatas: 1, en_catalogo: null }
      return
    }
    if (!item || item.estado || !esHtml(item.tipo_produccion)) return
    if (!nombre) { item.estado = 'sin_asignar'; item.motivo = 'documento_sin_plantilla'; return }
    const cat = item.categoria
    if (!cat) { item.estado = 'sin_asignar'; item.motivo = item.clase === 'actividad' ? 'actividad_fuera_de_catalogo' : 'formato_fuera_de_catalogo'; return }
    const delaCat = (catalogo && catalogo.variantesDe && catalogo.variantesDe[cat]) || []
    const v = delaCat.find((x) => x.nombre === nombre)
    // La plantilla es la que dice el guion. Si esta base de Praxia no la tiene subida (p. ej. una base local sin las plantillas de actividades) NO se descarta: queda asignada, marcada fuera de catálogo.
    if (!v) {
      if (!usadas.has(cat)) usadas.set(cat, new Set())
      usadas.get(cat).add(nombre)
      item.estado = 'asignada'; item.motivo = null
      item.aviso = 'La plantilla «' + nombre + '» la indica el guion, pero no está subida en esta base de Praxia' + (delaCat.length ? ' (no es una de las variantes que ya tiene de ' + cat + ').' : '.')
      item.variante = { plantilla: nombre, formacion: null, revision: null, url_ver: null, regla: 'documento', candidatas: 1, en_catalogo: false }
      return
    }
    if (!usadas.has(cat)) usadas.set(cat, new Set())
    const repetida = usadas.get(cat).has(nombre)
    usadas.get(cat).add(nombre)
    item.estado = repetida && item.calificable !== true ? 'repetida' : 'asignada'
    item.motivo = repetida ? (item.calificable === true ? 'calificable_repetida' : 'variante_repetida') : null
    if (repetida && item.calificable !== true) item.aviso = 'La misma plantilla está en más de un recurso de ' + cat + ' dentro de esta unidad.'
    item.variante = { plantilla: nombre, formacion: v.formacion || null, revision: v.ultimo || null, url_ver: '/plantillas-html/ver/' + nombre, regla: 'documento', candidatas: 1 }
  }
  if (u.presentacion) aplicar(u.presentacion, porCodigo.get(u.presentacion.codigo))
  for (const r of u.recursos) aplicar(r, porCodigo.get(r.codigo))
  for (const a of u.actividades) aplicar(a, porActividad.get(a.recurso_codigo))
}

const DIFERENCIAS = [
  'Variantes: se toman de los enlaces de plantilla («Enlace de visualización») que trae cada guion; se comprueba que existan y que sean de la categoría del recurso. Si una unidad no trae ningún enlace, se simula la asignación con las reglas del sistema.',
  'Actividades: se elige la primera variante libre en el orden de subida (el sistema real elige al azar), para que el resultado sea reproducible.',
  'Actividades sin variante libre: se repite la primera de las menos usadas (el sistema real elige al azar entre ellas).',
  'Presentación: si el documento de la unidad no la indica, queda sin asignar (el sistema real pide G-13 por defecto).',
  'Se simula un curso nuevo: no se tiene en cuenta lo ya asignado a ningún curso de Praxia y no se guarda nada.',
  'Los recursos cuya «Tipo de producción propuesto» no es HTML (videos, podcast) no piden variante HTML.',
  'La presentación usa G-13, G-14 o G-15 (flujo «Preparar el curso»), no G-00 como el flujo de guiones.'
]

const esHtml = (t) => !t || /^html\b/i.test(String(t).trim())

async function enParalelo(lista, n, fn) {
  const salida = new Array(lista.length)
  let i = 0
  const obreros = Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) { const k = i++; salida[k] = await fn(lista[k], k) }
  })
  await Promise.all(obreros)
  return salida
}

const PROBLEMA = (tipo, unidad, mensaje, candidatos = []) => ({ tipo, unidad, codigo: null, mensaje, candidatos })

export async function analizarCarpeta({ carpetaId, resourcekey, fuente, alAvanzar = () => {}, plantillas = cargarPlantillas, pruebas = modoPruebasPlantillas, maxDocs = 150, tiempoMs = 6 * 60 * 1000, concurrencia = 4 }) {
  const limite = Date.now() + tiempoMs
  const prog = { hechos: 0, total: 0, leidos: 0 }
  const avanzar = (paso, fase = 'leyendo') => alAvanzar({ paso, hechos: prog.hechos, total: prog.total, fase })
  const leer = async (entrada) => {
    if (entrada.tipo !== 'doc') return crearLectura(entrada, null)
    if (Date.now() > limite) throw new ErrorAnalisis('tiempo_agotado')
    if (prog.leidos >= maxDocs) { prog.hechos++; return crearLectura(entrada, null, 'tope_documentos') }
    prog.leidos++
    try {
      return crearLectura(entrada, bloquesDeHtml(await fuente.leerDocHtml(entrada)))
    } catch (e) {
      const c = e && e.codigo
      return crearLectura(entrada, null, ['no_publico', 'demasiado_grande', 'tiempo'].includes(c) ? c : 'error')
    } finally { prog.hechos++ }
  }

  avanzar('Leyendo la carpeta raíz')
  const listadoRaiz = await fuente.listar(carpetaId, resourcekey) // si falla, se detiene todo
  const raiz = clasificarRaiz(listadoRaiz.entradas)
  const catalogosP = Promise.all([Promise.resolve().then(() => fuente.leerCatalogoRecursos()).catch(() => null), Promise.resolve().then(() => fuente.leerCatalogoActividades()).catch(() => null)])

  // carpetas «Guiones U#» con un solo candidato: se abren (un nivel); las repetidas no se abren
  const unicas = [...raiz.carpetasUnidad].filter(([, l]) => l.length === 1).map(([n, l]) => [n, l[0]])
  const erroresCarpeta = new Map()
  const listados = new Map()
  await enParalelo(unicas, concurrencia, async ([n, c]) => {
    try { listados.set(n, (await fuente.listar(c.id)).entradas.filter((e) => e.tipo !== 'carpeta')) } catch (e) { erroresCarpeta.set(n, (e && e.codigo) || 'error'); listados.set(n, []) }
  })
  const docsRaiz = [...raiz.syllabus, ...raiz.docs]
  prog.total = docsRaiz.length + [...listados.values()].reduce((a, l) => a + l.filter((e) => e.tipo === 'doc').length, 0)
  prog.total = Math.min(prog.total, maxDocs)
  avanzar('Leyendo los documentos de la raíz')
  const lecturasRaiz = new Map()
  await enParalelo(docsRaiz, concurrencia, async (e) => { lecturasRaiz.set(e.id, await leer(e)); avanzar('Leyendo los documentos de la raíz') })
  const docsPorCarpeta = new Map()
  for (const [n, entradas] of [...listados].sort((a, b) => a[0] - b[0])) {
    avanzar('Leyendo «Guiones U' + n + '»')
    docsPorCarpeta.set(n, await enParalelo(entradas, concurrencia, async (e) => { const l = await leer(e); avanzar('Leyendo «Guiones U' + n + '»'); return l }))
  }
  const [csvRecursos, csvActividades] = await catalogosP

  avanzar('Asociando unidades y guiones', 'analizando')
  const syllabus = resolverSyllabus(raiz, lecturasRaiz)
  const docsRaizLeidos = raiz.docs.map((e) => lecturasRaiz.get(e.id)).filter(Boolean)
  const aso = asociar({ raiz, syllabus, docsPorCarpeta, docsRaizLeidos })
  const problemas = [...aso.problemas]
  for (const u of aso.unidades) if (erroresCarpeta.has(u.numero)) u.problemas.push(PROBLEMA('ilegible', u.numero, 'No se pudo abrir la carpeta «Guiones U' + u.numero + '» (' + erroresCarpeta.get(u.numero) + ').', [u.carpeta].filter(Boolean)))

  // Formación: la del Syllabus; si no la trae, la de los documentos de unidad solo si todas las que la traen coinciden.
  let formacion = null; let formacionTexto = null; let formacionFuente = null
  const sy = syllabus.estado === 'encontrado' ? syllabus.lectura.syllabus : null
  if (sy && sy.formacion) { formacion = sy.formacion; formacionTexto = sy.formacionTexto; formacionFuente = 'syllabus' } else {
    const textos = aso.unidades.map((u) => aso.internos.get(u.numero).lecturaUnidad).filter(Boolean).map((l) => l.unidad.formacionTexto).filter(Boolean)
    const valores = new Set(textos.map((t) => formacionDeCurso({ info: { nivel: t } })))
    if (valores.size === 1 && !valores.has(null)) { formacion = [...valores][0]; formacionTexto = textos[0]; formacionFuente = 'unidad' } else if (valores.size > 1) problemas.push(PROBLEMA('formacion', null, 'Los documentos de las unidades dicen niveles de formación distintos: no se pudo saber la formación del curso.'))
  }
  if (!formacion && !problemas.some((p) => p.tipo === 'formacion')) problemas.push(PROBLEMA('formacion', null, 'No se pudo saber la formación del curso (Tecnológico, Profesional, Especialización o Doctorado): no se asigna ninguna variante.'))

  // Catálogos de IDs
  const filasR = csvRecursos ? filasConEncabezado(leerCsv(csvRecursos), 'id base') : []
  let indiceRec = indiceRecursos(filasR)
  let catRecursos = { fuente: 'hoja', filas: filasR.length }
  if (!indiceRec.tamano) {
    indiceRec = { tamano: 0, fuente: 'respaldo_palabras', baseId: baseIdPorPalabras, tipoProduccion: () => null }
    catRecursos = { fuente: 'respaldo_palabras', filas: 0 }
    problemas.push(PROBLEMA('catalogo', null, 'Catálogo de IDs no disponible: se usó el respaldo por palabras clave del flujo de guiones.'))
  }
  const filasA = csvActividades ? filasConEncabezado(leerCsv(csvActividades), 'id de la actividad') : []
  let catActividades = { fuente: 'hoja', filas: filasA.length }
  let indiceAct = null
  if (!filasA.length) { catActividades = { fuente: 'no_disponible', filas: 0 }; problemas.push(PROBLEMA('catalogo', null, 'La hoja de actividades no está disponible: ninguna actividad se asigna.')) } else if (formacion) indiceAct = indiceActividades(filasA, formacion)

  // Recursos, actividades y presentación de cada unidad con documento; cruce con los guiones
  for (const u of aso.unidades) {
    const interno = aso.internos.get(u.numero)
    u.avisos = []
    if (interno.lecturaUnidad) {
      const ex = extraerRecursos(interno.lecturaUnidad.unidad, u.numero, { indiceRec, indiceAct, formacion })
      u.recursos = ex.recursos; u.actividades = ex.actividades; u.presentacion = ex.presentacion; u.avisos = ex.avisos
      u.problemas.push(...ex.problemas)
      cruzarGuiones(u, interno.guiones)
    } else if (u.estado === 'sin_documento_unidad') u.recursos = recursosDeGuiones(u.numero, interno.guiones)
  }

  // Simulación de variantes (solo con formación conocida)
  const modoPruebas = !!(await pruebas())
  const itemsDe = (u) => [u.presentacion, ...u.recursos, ...u.actividades].filter(Boolean)
  let catalogoPlantillas = null
  if (aso.unidades.some((u) => aso.internos.get(u.numero).lecturaUnidad)) {
    avanzar('Leyendo las variantes de los guiones', 'analizando')
    const categorias = new Set(aso.unidades.flatMap((u) => itemsDe(u).filter((i) => i.categoria && !i.estado && esHtml(i.tipo_produccion)).map((i) => i.categoria)))
    try { catalogoPlantillas = await plantillas([...categorias]) } catch { throw new ErrorAnalisis('plantillas_no_disponibles') }
  }
  for (const u of aso.unidades) {
    if (!aso.internos.get(u.numero).lecturaUnidad) continue
    variantesDelDocumento(u, aso.internos.get(u.numero).guiones, catalogoPlantillas)
    if (formacion) {
      const salida = simularUnidad(itemsDe(u), { formacion, pruebas: modoPruebas, ...catalogoPlantillas })
      let k = 0
      if (u.presentacion) u.presentacion = salida[k++]
      u.recursos = u.recursos.map(() => salida[k++])
      u.actividades = u.actividades.map(() => salida[k++])
    } else {
      const marcar = (i) => (i.estado ? i : { ...i, ...(esHtml(i.tipo_produccion) ? { estado: 'sin_asignar', motivo: 'formacion_desconocida' } : { estado: 'no_html' }) })
      if (u.presentacion) u.presentacion = marcar(u.presentacion)
      u.recursos = u.recursos.map(marcar); u.actividades = u.actividades.map(marcar)
    }
  }
  for (const u of aso.unidades) {
    u.estado = estadoFinal(u)
    const items = itemsDe(u)
    const n = (e) => items.filter((i) => i.estado === e).length
    u.conteo = { recursos: u.recursos.length, actividades: u.actividades.length, asignadas: n('asignada'), repetidas: n('repetida'), sin_asignar: n('sin_asignar'), no_html: n('no_html') }
  }

  const todas = aso.unidades
  const suma = (k) => todas.reduce((a, u) => a + (u.conteo ? u.conteo[k] : 0), 0)
  return {
    version: 1,
    carpeta: { id: carpetaId, nombre: listadoRaiz.nombre || '', url: 'https://drive.google.com/drive/folders/' + carpetaId },
    fuente: fuente.nombre,
    modo_pruebas: modoPruebas,
    formacion: { valor: formacion, texto: formacionTexto, fuente: formacionFuente },
    catalogo: { recursos: catRecursos, actividades: catActividades },
    syllabus: { estado: syllabus.estado, documento: syllabus.documento, candidatos: syllabus.candidatos, unidades: syllabus.unidades },
    unidades: todas,
    carpetas_sobrantes: aso.carpetas_sobrantes,
    otras_carpetas: raiz.otrasCarpetas.map(carpetaDe),
    raiz_no_reconocidos: aso.raiz_no_reconocidos,
    problemas,
    diferencias_con_sistema_real: DIFERENCIAS,
    resumen: {
      unidades_syllabus: syllabus.unidades.length, unidades_encontradas: todas.filter((u) => u.documento_unidad).length, guiones: todas.reduce((a, u) => a + u.guiones.length, 0),
      recursos: suma('recursos'), actividades: suma('actividades'), asignadas: suma('asignadas'), repetidas: suma('repetidas'), sin_asignar: suma('sin_asignar'), no_html: suma('no_html'),
      problemas: problemas.length + todas.reduce((a, u) => a + u.problemas.length, 0)
    }
  }
}

// ---- Trabajos en memoria -----------------------------------------------------------------------------------------------------
// Dueño = id de la persona; 1 en curso por persona, 3 en total; resultado guardado 60 minutos; máximo 50 guardados. Los registros de consola solo llevan el id y conteos.
const trabajos = new Map()
const GUARDA_MS = 60 * 60 * 1000
const MAX_GUARDADOS = 50
const MAX_EN_CURSO_TOTAL = 3
const enCurso = (t) => t.estado === 'en_cola' || t.estado === 'leyendo' || t.estado === 'analizando'

function limpiar(ahora) {
  for (const [id, t] of trabajos) if (!enCurso(t) && ahora() - t.terminadoMs > GUARDA_MS) trabajos.delete(id)
  if (trabajos.size >= MAX_GUARDADOS) {
    const viejos = [...trabajos].filter(([, t]) => !enCurso(t)).sort((a, b) => a[1].terminadoMs - b[1].terminadoMs)
    for (const [id] of viejos) { if (trabajos.size < MAX_GUARDADOS) break; trabajos.delete(id) }
  }
}

const vista = (t) => ({ id: t.id, estado: t.estado, avance: t.avance, creado: t.creado, terminado: t.terminado, error: t.error, resultado: t.resultado })

export function iniciarTrabajo({ usuarioId, carpetaId, resourcekey, fuente, plantillas, pruebas, ahora = Date.now, analizar = analizarCarpeta, tiempoMs = 6 * 60 * 1000 }) {
  limpiar(ahora)
  const vivos = [...trabajos.values()].filter(enCurso)
  if (vivos.some((t) => t.usuarioId === usuarioId)) throw new ErrorLimite('ya_en_curso', 'Ya tiene un análisis en curso')
  if (vivos.length >= MAX_EN_CURSO_TOTAL || trabajos.size >= MAX_GUARDADOS) throw new ErrorLimite('ocupado', 'El servidor está ocupado con otros análisis')
  const t = { id: randomUUID(), usuarioId, estado: 'en_cola', avance: { paso: 'En cola', hechos: 0, total: 0 }, creado: new Date(ahora()).toISOString(), terminado: null, terminadoMs: 0, error: null, resultado: null }
  trabajos.set(t.id, t)
  const cerrar = () => { t.terminado = new Date(ahora()).toISOString(); t.terminadoMs = ahora() }
  ;(async () => {
    try {
      t.estado = 'leyendo'
      const alAvanzar = ({ paso, hechos, total, fase }) => { if (!enCurso(t)) return; t.avance = { paso, hechos, total }; if (fase === 'analizando') t.estado = 'analizando' }
      let temporizador
      const tope = new Promise((_, rechaza) => { temporizador = setTimeout(() => rechaza(new ErrorAnalisis('tiempo_agotado')), tiempoMs + 20000) })
      try {
        const r = await Promise.race([analizar({ carpetaId, resourcekey, fuente: fuente(), alAvanzar, plantillas, pruebas, tiempoMs }), tope])
        if (!enCurso(t)) return
        t.resultado = r; t.estado = 'listo'; t.avance = { paso: 'Listo', hechos: t.avance.total, total: t.avance.total }
        console.log('[piloto] análisis ' + t.id + ' listo: ' + r.resumen.unidades_encontradas + ' unidades, ' + r.resumen.recursos + ' recursos, ' + r.resumen.actividades + ' actividades')
      } finally { clearTimeout(temporizador) }
    } catch (e) {
      if (!enCurso(t)) return
      t.estado = 'error'; t.error = mensajeDeError(e)
      console.warn('[piloto] análisis ' + t.id + ' con error: ' + ((e && e.codigo) || 'interno'))
    } finally { cerrar() }
  })()
  return { id: t.id }
}

export function obtenerTrabajo(id, usuarioId, ahora = Date.now) {
  limpiar(ahora)
  const t = trabajos.get(id)
  return t && t.usuarioId === usuarioId ? vista(t) : null
}
export function olvidarTrabajo(id, usuarioId) {
  const t = trabajos.get(id)
  if (!t || t.usuarioId !== usuarioId) return false
  if (enCurso(t)) { t.estado = 'error'; t.error = 'Análisis cancelado.'; t.terminado = new Date().toISOString(); t.terminadoMs = Date.now() }
  trabajos.delete(id)
  return true
}
export const _vaciarTrabajos = () => trabajos.clear()
