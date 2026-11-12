import { api } from "./api.js"
// Llamada al flujo de n8n del portal «syllabus-portal.html». Misma dirección, mismos datos enviados
// y misma lectura de la respuesta que el portal original (que no se modifica).
// Flujo que trabaja con la bibliografía leída por la plataforma (copia «con bibliografía, sin IA»). El flujo original es /syllabus-a-plantilla.
export const WEBHOOK_POR_DEFECTO = 'https://n8n.americana.edu.co/webhook/syllabus-a-plantilla-bibliografia-v2'
// Direcciones de versiones anteriores del flujo (ya no están activas en n8n): si quedaron guardadas, se reemplazan.
const WEBHOOKS_ANTERIORES = ['https://n8n.americana.edu.co/webhook/syllabus-a-plantilla', 'https://n8n.americana.edu.co/webhook/syllabus-a-plantilla-bibliografia']

// Las direcciones de n8n son UNA para toda la plataforma: las guarda el administrador en el servidor y todas las personas las leen de allí.
// '' = la dirección original (la del código).
let config = { syllabus: '', guiones: '', matrices: '', h5p: '' }
let cargaEnCurso = null
export const cargarConfigN8n = (forzar = false) => {
  if (!cargaEnCurso || forzar) {
    cargaEnCurso = api('GET', '/config/n8n').then((c) => { config = { syllabus: (c && c.syllabus) || '', guiones: (c && c.guiones) || '', matrices: (c && c.matrices) || '', h5p: (c && c.h5p) || '' } }).catch(() => { cargaEnCurso = null })
  }
  return cargaEnCurso
}
export const olvidarConfigN8n = () => { config = { syllabus: '', guiones: '', matrices: '', h5p: '' }; cargaEnCurso = null }
const guardarConfig = (campo, u) => api('PUT', '/config/n8n', { [campo]: u }).then(() => { config = { ...config, [campo]: u } })

export const leerWebhook = () => (!config.syllabus || WEBHOOKS_ANTERIORES.includes(config.syllabus) ? WEBHOOK_POR_DEFECTO : config.syllabus)
export const guardarWebhook = (u) => guardarConfig('syllabus', u) // devuelve una promesa; falla si no es administrador
// Matrices y H5P no tienen dirección por defecto: vacío = esa función queda desactivada (o usa la del .env del servidor).
export const leerWebhookMatrices = () => config.matrices
export const guardarWebhookMatrices = (u) => guardarConfig('matrices', u)
export const leerWebhookH5p = () => config.h5p
export const guardarWebhookH5p = (u) => guardarConfig('h5p', u)

export const RE_DOC = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+/
export const RE_CARPETA = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+/

function responseErrorText(text) {
  try {
    const parsed = JSON.parse(text)
    return parsed.message || (parsed.error && parsed.error.message) || parsed.error || (parsed.message && parsed.message.text) || text
  } catch (e) { return text }
}

function parseJsonLayers(value) {
  let parsed = value
  for (let depth = 0; depth < 3 && typeof parsed === 'string'; depth++) {
    try { parsed = JSON.parse(parsed) } catch (e) { break }
  }
  return parsed
}

function extractDocuments(payload) {
  const pending = [payload]
  const seen = new Set()
  const nestedKeys = ['documentos_generados', 'documentos', 'data', 'body', 'result', 'results', 'output', 'response', 'responseBody', 'json', 'items', 'item']
  while (pending.length) {
    const current = parseJsonLayers(pending.shift())
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    if (Array.isArray(current)) {
      if (current.some((item) => item && typeof item === 'object' && (item.url || item.webViewLink || item.documento_generado || item.documentUrl || item.link))) return current
      pending.push(...current)
      continue
    }
    for (const key of nestedKeys) if (current[key] !== undefined && current[key] !== null) pending.push(current[key])
  }
  return []
}

function normalizeDocument(doc, index) {
  const rawUnit = (doc.unidad && doc.unidad.numero) ?? doc.unidad ?? doc.numero_unidad ?? doc.unit ?? index + 1
  const unit = Number.parseInt(rawUnit, 10) || index + 1
  const url = doc.url || (doc.documento_generado && doc.documento_generado.url) || doc.webViewLink || doc.documentUrl || doc.link || ''
  const name = doc.nombre_unidad || doc.nombre || (doc.documento_generado && doc.documento_generado.nombre) || 'Unidad ' + unit
  let href = ''
  try { const u = new URL(String(url).trim()); if (u.protocol === 'https:') href = u.href } catch (e) { /* se muestra la unidad sin enlace */ }
  const crudos = doc.temas || doc.subtemas || doc.topics || []
  const temas = Array.isArray(crudos) ? crudos.map((t, k) => ({ n: Number((t && (t.numero || t.n)) || k + 1) || k + 1, nombre: typeof t === 'string' ? t : (t && (t.nombre || t.titulo || t.tema)) || '' })) : []
  return { unidad: unit, nombre: name, url: href, temas }
}

// Solo si el flujo los devuelve (nunca se inventan).
function buscarTexto(payload, claves) {
  const pend = [payload]
  const vistos = new Set()
  while (pend.length) {
    const a = parseJsonLayers(pend.shift())
    if (!a || typeof a !== 'object' || vistos.has(a)) continue
    vistos.add(a)
    if (Array.isArray(a)) { pend.push(...a); continue }
    for (const k of claves) if (typeof a[k] === 'string' && a[k].trim()) return a[k].trim()
    pend.push(...Object.values(a))
  }
  return ''
}

// La llamada a n8n la hace el servidor (ver trabajosUnidades.js): aquí solo se interpreta su respuesta ya terminada.
// Devuelve {documentos, programa, curso}. Si n8n terminó sin lista de enlaces, lanza un error con code 'NO_DOCUMENT_LIST'
// (el portal original lo muestra como «El flujo terminó. Revisa tu carpeta»).
export function interpretarRespuestaDocumentos(raw) {
  const payload = parseJsonLayers(raw)
  const documentos = extractDocuments(payload).map(normalizeDocument).sort((a, b) => a.unidad - b.unidad)
  const programa = buscarTexto(payload, ['programa', 'nombre_programa', 'program'])
  const curso = buscarTexto(payload, ['asignatura', 'nombre_asignatura', 'curso', 'nombre_curso'])
  if (!documentos.length) {
    const error = new Error('El flujo terminó sin devolver enlaces de documentos.')
    error.code = 'NO_DOCUMENT_LIST'
    error.programa = programa
    error.curso = curso
    throw error
  }
  return { documentos, programa, curso }
}

// Identificador del documento de Google dentro de su enlace ('' si no es un enlace de documento).
export const idDocumento = (url) => (/\/document\/d\/([A-Za-z0-9_-]+)/.exec(String(url || '')) || [])[1] || ''

// La lectura de bibliografía más reciente (y completa) de ese syllabus, guardada en el servidor: se encuentra desde cualquier
// pestaña o equipo. Devuelve su identificador o '' si no hay una lista.
export async function bibliografiaDeSyllabus(syllabusUrl) {
  try {
    const r = await api('GET', '/bibliografia/trabajos/por-syllabus?url=' + encodeURIComponent(syllabusUrl))
    return r && r.estado === 'listo' ? r.id : ''
  } catch { return '' }
}

// ---- Segundo flujo: «unidad-a-guiones». Recibe el documento de la unidad y devuelve un guion por tema. ----
// Copia «con bibliografía»: escribe los guiones con las fuentes leídas de la unidad. El flujo original es /unidad-a-guiones.
export const WEBHOOK_GUIONES_POR_DEFECTO = 'https://n8n.americana.edu.co/webhook/unidad-a-guiones-bibliografia'
const WEBHOOK_GUIONES_ANTERIOR = 'https://n8n.americana.edu.co/webhook/unidad-a-guiones'
// Se usa la dirección guardada en «Conexión n8n»; si no hay (o es la del flujo anterior) se usa la de la copia con bibliografía.
export const leerWebhookGuiones = () => (!config.guiones || config.guiones === WEBHOOK_GUIONES_ANTERIOR ? WEBHOOK_GUIONES_POR_DEFECTO : config.guiones)
export const guardarWebhookGuiones = (u) => guardarConfig('guiones', u)

function buscarArchivos(payload) {
  const pend = [payload]
  const vistos = new Set()
  while (pend.length) {
    const a = parseJsonLayers(pend.shift())
    if (!a || typeof a !== 'object' || vistos.has(a)) continue
    vistos.add(a)
    if (Array.isArray(a)) { pend.push(...a); continue }
    if (Array.isArray(a.archivos)) return a.archivos
    pend.push(...Object.values(a))
  }
  return []
}

// La llamada a n8n la hace el servidor (ver trabajosGuiones.js): aquí solo se interpreta su respuesta ya terminada.
// Devuelve un guion por tema. Falla con code SIN_GUIONES si el flujo terminó sin devolverlos.
export function interpretarRespuestaGuiones(raw) {
  const crudos = buscarArchivos(parseJsonLayers(raw))
  if (!crudos.length) {
    const e = new Error('El flujo terminó sin devolver guiones.')
    e.code = 'SIN_GUIONES'
    throw e
  }
  return crudos.map((a, k) => {
    let href = ''
    try { const u = new URL(String(a.url || '').trim()); if (u.protocol === 'https:') href = u.href } catch (e) { /* sin enlace */ }
    const tema = Number.parseInt(a.tema, 10)
    return {
      id: a.id || null, nombre: a.nombre || 'Guion ' + (k + 1), url: href,
      tema: Number.isFinite(tema) ? tema : null, nombre_tema: a.nombre_tema || '',
      info: a.info || {}, guion: a.guion || null, advertencias: Array.isArray(a.advertencias) ? a.advertencias : []
    }
  }).sort((x, y) => (x.tema ?? 99) - (y.tema ?? 99))
}

export function mensajeDeError(e) {
  return e instanceof TypeError
    ? 'No se pudo conectar desde esta página. Revisa que el webhook esté activo y los permisos CORS de n8n permitan el origen desde el que estás abriendo este HTML.'
    : (e.message || 'Ocurrió un error al procesar el syllabus.')
}
