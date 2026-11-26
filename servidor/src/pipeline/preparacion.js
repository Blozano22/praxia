// Preparación del curso ANTES de generar sus guiones. Al pedir los guiones de una unidad, el trabajo del servidor (src/guiones/rutas.js) hace primero esto:
//   1. exige que TODAS las unidades del curso estén aprobadas (igual que la pantalla);
//   2. si el curso aún no tiene sus variantes asignadas, llama al flujo de n8n de preparación, que lee las estructuras del curso, saca los recursos y pide a Praxia
//      las variantes (POST /api/n8n/asignaciones/pedir, src/pipeline/asignaciones.js), y ESPERA su respuesta;
//   3. lee de la base las variantes asignadas a la unidad: si a algún recurso no le tocó (o quedó inválida), el trabajo falla con un mensaje claro;
//   4. entrega al flujo de guiones, en el mismo pedido de siempre, las variantes de esa unidad (campo «asignaciones»).
// Sin dirección del flujo de preparación («Conexión n8n» o N8N_PREPARACION_URL) el paso 2 a 4 se omite y los guiones se generan como antes.
// Aquí no se importa guiones/rutas.js (importa este archivo): la función que hace el POST a n8n se recibe como parámetro.
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { conUsuario, sinUsuario } from '../db.js'
import { Q } from '../consultas.js'

// «Modo de pruebas de plantillas» (interruptor de la administración en «Conexión n8n», clave n8n.pruebas_plantillas): mientras no estén aprobadas las plantillas, la preparación
// asigna CUALQUIER plantilla subida (aprobada o no, de cualquier formación; las de la formación del curso van primero) y no se detiene si el curso no dice su formación.
// Debe apagarse antes de producción: con él encendido un curso real puede recibir plantillas sin aprobar.
export const CLAVE_PRUEBAS = 'n8n.pruebas_plantillas'
// «1» = encendido, «0» = apagado por la administración; sin valor guardado manda el valor por defecto (config.pruebasPlantillasPorDefecto).
export const pruebasEncendidas = (valor) => (valor === '1' ? true : valor === '0' ? false : config.pruebasPlantillasPorDefecto)
export async function modoPruebasPlantillas() {
  try { const f = (await sinUsuario(Q.configLeer, [[CLAVE_PRUEBAS]])).rows[0]; return pruebasEncendidas(f ? f.valor : undefined) } catch { return config.pruebasPlantillasPorDefecto }
}

// Un error con un mensaje listo para mostrarle a la persona tal cual.
export class ErrorPropio extends Error {}

const RE_CARPETA = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+/
const RE_DOC = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+/
const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function urlPreparacion() {
  const f = (await sinUsuario(Q.configLeer, [['n8n.preparacion']])).rows[0]
  return (f && f.valor) || config.n8nPreparacionUrl || ''
}

// Formación del curso (la que usa el catálogo de plantillas) a partir del nivel que trae el curso («Tecnológico», «Profesional», «Especialización»…). null si no se reconoce.
export function formacionDeCurso(datos) {
  const info = (datos && datos.info) || {}
  const t = texto(info.nivel, 120) || texto(info.nivel_de_formacion, 120)
  const s = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/tecnolog/.test(s)) return 'tecnologico'
  if (/profesional|licenciatura|pregrado/.test(s)) return 'profesional'
  if (/especializ/.test(s)) return 'especializacion'
  if (/doctor/.test(s)) return 'doctorado'
  return null
}

// Formación a partir de un texto («Doctorado», «Profesional universitario»…). Misma regla que formacionDeCurso.
const formacionDeTexto = (t) => formacionDeCurso({ info: { nivel: t } })

// Los cursos creados desde el syllabus no guardan su nivel en la ficha: se lee de la tabla «Nivel de formación» del propio syllabus
// (Google Docs, solo por el ID del documento). null si no se puede leer o no lo trae.
export async function formacionDeSyllabus(url) {
  const id = (/\/document\/d\/([A-Za-z0-9_-]+)/.exec(String(url || '')) || [])[1]
  if (!id) return null
  try {
    const r = await fetch('https://docs.google.com/document/d/' + id + '/export?format=txt', { redirect: 'follow', signal: AbortSignal.timeout(15000) })
    if (!r.ok || !/text\/plain/i.test(r.headers.get('content-type') || '')) return null
    const t = (await r.text()).slice(0, 400000)
    const m = /nivel\s+de\s+formaci[oó]n[\s|:*]*([^\r\n|]{3,60})/i.exec(t)
    return m ? formacionDeTexto(m[1]) : null
  } catch { return null }
}

// El curso se lee con la sesión de la persona (la política de filas garantiza que sea suyo). null si no existe o no se pudo leer.
async function leerDatos(usuario, proyectoId) {
  try { return (((await conUsuario(usuario, (cx) => cx.query(Q.pipeProyectoDatos, [usuario.id, proyectoId]))).rows[0]) || {}).datos || null } catch { return null }
}

// Las unidades del curso y cuáles faltan por aprobar. Sin la lista de unidades (curso que no existe o sin documentos) no hay nada que comprobar.
export function estadoAprobacion(datos) {
  const docs = ((datos && datos.syllabus && datos.syllabus.documentos) || []).filter((d) => d && Number.isFinite(Number(d.unidad)))
  return { hay: docs.length > 0, pendientes: docs.filter((d) => !d.aprobado).map((d) => Number(d.unidad)).sort((a, b) => a - b), unidades: docs }
}
const MENSAJE_APROBACION = (p) => 'Los guiones se generan cuando todas las unidades están aprobadas. Faltan por aprobar: ' + p.join(', ') + '.'
// Lanza ErrorPropio si el curso tiene unidades sin aprobar.
export async function exigirAprobadas(usuario, proyectoId) {
  const a = estadoAprobacion(await leerDatos(usuario, proyectoId))
  if (a.hay && a.pendientes.length) throw new ErrorPropio(MENSAJE_APROBACION(a.pendientes))
}

const MOTIVOS = {
  variantes_agotadas: 'ya no quedan variantes libres en su categoría para esta unidad', sin_variantes_aprobadas: 'no hay variantes aprobadas', sin_variantes_de_la_formacion: 'no hay variantes de la formación del curso',
  categoria_sin_variantes: 'la categoría no tiene variantes', categoria_no_es_de_la_formacion: 'la categoría no es de la formación del curso', categoria_inexistente: 'la categoría no existe',
  tipo_actividad_sin_categoria: 'el tipo de actividad del guion no coincide con ninguno de la tabla de tipos: corrija el guion o la tabla y regenere el recurso', plantilla_eliminada: 'su plantilla se eliminó', categoria_eliminada: 'su categoría se eliminó'
}
const motivoTexto = (m) => MOTIVOS[m] || (/^plantilla_movida_a_/.test(m || '') ? 'su plantilla se movió de categoría' : m || 'sin variante')

// Preparaciones en marcha, por persona y curso: dos unidades que se piden a la vez comparten la misma llamada a n8n (un solo servidor).
const enMarcha = new Map()

async function llamarPreparacion({ usuario, proyectoId, url, datos, formacion, forzar, pruebas = false, publicarFn }) {
  const carpeta = String(datos.carpetaUrl || '')
  if (!RE_CARPETA.test(carpeta)) throw new ErrorPropio('El curso no tiene una carpeta de Drive válida.')
  const a = estadoAprobacion(datos)
  const unidades = a.unidades.map((d) => ({ numero: Number(d.unidad), nombre: texto(d.nombre, 300), url: texto(d.url, 600) })).filter((u) => RE_DOC.test(u.url)).sort((x, y) => x.numero - y.numero)
  if (!unidades.length) throw new ErrorPropio('El curso no tiene unidades con documento para preparar.')
  const trabajoId = randomUUID()
  await sinUsuario(Q.pipeOrigenGuardar, [trabajoId, usuario.id, proyectoId, carpeta, 'preparacion', null]) // así n8n identifica persona y curso al pedir las variantes
  const syllabus = texto(datos.syllabusUrl, 600)
  const cuerpo = { trabajo_id: trabajoId, proyecto_id: proyectoId, carpeta_raiz: carpeta, curso: texto(datos.curso, 200), formacion, ...(RE_DOC.test(syllabus) ? { syllabus_url: syllabus } : {}), ...(config.praxiaUrlPublica ? { praxia_url: config.praxiaUrlPublica } : {}), unidades_detalle: unidades, forzar, ...(pruebas ? { modo_pruebas: true } : {}) }
  let r
  try { r = await publicarFn(url, cuerpo, Math.min(20, config.n8nMinutosMaximo)) } catch (e) {
    throw new ErrorPropio(('No se pudo completar la preparación del curso con n8n: ' + ((e && (e.code || e.message)) || 'error')).slice(0, 580))
  }
  if (r.estado < 200 || r.estado >= 300) {
    let motivo = ''
    try { const j = JSON.parse(r.texto); motivo = texto(j.error || j.motivo || j.message || j.mensaje, 300) } catch { motivo = texto(String(r.texto || '').replace(/\s+/g, ' '), 300) }
    throw new ErrorPropio(('La preparación del curso falló (HTTP ' + r.estado + ')' + (motivo ? ': ' + motivo : '.')).slice(0, 580))
  }
}

// Devuelve null si la preparación no está configurada; si no, { asignaciones } con las variantes de la unidad. Lanza ErrorPropio si el curso no está listo.
export async function asegurarAsignacion({ usuario, proyectoId, unidad, reasignar = false, publicarFn }) {
  const url = await urlPreparacion()
  if (!url) return null
  const datos = await leerDatos(usuario, proyectoId)
  if (!datos) throw new ErrorPropio('No se encontró el curso para preparar sus variantes.')
  const aprobacion = estadoAprobacion(datos)
  if (aprobacion.hay && aprobacion.pendientes.length) throw new ErrorPropio(MENSAJE_APROBACION(aprobacion.pendientes))
  const pruebas = await modoPruebasPlantillas()
  // En el modo de pruebas, un curso sin formación se prepara igual (Tecnológico solo como referencia para ordenar: se usan todas las plantillas subidas).
  const formacion = formacionDeCurso(datos) || (await formacionDeSyllabus(datos.syllabusUrl)) || (pruebas ? 'tecnologico' : null)
  if (!formacion) throw new ErrorPropio('El curso no dice su formación (Tecnológico, Profesional, Especialización o Doctorado): elíjala en «Formación del curso», arriba del botón «Crear los guiones»; se necesita para elegir las variantes de las plantillas.')
  const filas = async () => (await sinUsuario(Q.asignConsultar, [usuario.id, proyectoId, unidad, null])).rows
  let rows = await filas()
  // Se prepara si se pidió volver a asignar, si la unidad aún no tiene nada, o si algo de la unidad quedó pendiente o inválido (el flujo lo vuelve a pedir y se resuelve).
  if (reasignar || !rows.length || rows.some((f) => f.estado !== 'asignada')) {
    const clave = usuario.id + ':' + proyectoId
    let p = enMarcha.get(clave)
    if (!p) {
      p = llamarPreparacion({ usuario, proyectoId, url, datos, formacion, forzar: !!reasignar, pruebas, publicarFn }).finally(() => enMarcha.delete(clave))
      enMarcha.set(clave, p)
    }
    await p
    rows = await filas()
  }
  if (!rows.length) throw new ErrorPropio('La preparación del curso terminó, pero no asignó variantes a la unidad ' + unidad + '.')
  const malas = rows.filter((f) => f.estado !== 'asignada')
  if (malas.length) {
    // Agrupado por motivo y, dentro de cada uno, por categoría (con cuántos recursos): dice qué categorías hay que atender y cabe en el límite de 600 caracteres.
    const porMotivo = new Map()
    for (const f of malas) { const m = motivoTexto(f.motivo); const g = porMotivo.get(m) || new Map(); g.set(f.categoria, (g.get(f.categoria) || 0) + 1); porMotivo.set(m, g) }
    const lineas = [...porMotivo].map(([m, g]) => '• ' + m.charAt(0).toUpperCase() + m.slice(1) + ': ' + [...g].map(([c, n]) => c + (n > 1 ? ' ×' + n : '')).join(', '))
    throw new ErrorPropio(('Sin variante de plantilla en la unidad ' + unidad + ' (' + malas.length + (malas.length === 1 ? ' recurso' : ' recursos') + '):\n' + lineas.join('\n') + '\nApruebe o suba más variantes de esas categorías y vuelva a generar.').slice(0, 590))
  }
  return { asignaciones: rows.map((f) => ({ codigo: f.codigo, id_catalogo: f.id_catalogo, id_base: f.id_base, categoria: f.categoria, formacion: f.formacion, plantilla: f.plantilla })) }
}
