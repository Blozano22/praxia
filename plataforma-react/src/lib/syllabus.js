import { api } from "./api.js"
// Llamada al flujo de n8n del portal «syllabus-portal.html». Misma dirección, mismos datos enviados
// y misma lectura de la respuesta que el portal original (que no se modifica).
// Flujo que trabaja con la bibliografía leída por la plataforma (copia «con bibliografía, sin IA»). El flujo original es /syllabus-a-plantilla.
export const WEBHOOK_POR_DEFECTO = 'https://n8n.americana.edu.co/webhook/syllabus-a-plantilla-bibliografia'
const WEBHOOK_ANTERIOR = 'https://n8n.americana.edu.co/webhook/syllabus-a-plantilla'
const CLAVE_WEBHOOK = 'ova-webhook'

export const leerWebhook = () => {
  try { const g = localStorage.getItem(CLAVE_WEBHOOK); return !g || g === WEBHOOK_ANTERIOR ? WEBHOOK_POR_DEFECTO : g } catch (e) { return WEBHOOK_POR_DEFECTO }
}
export const guardarWebhook = (u) => {
  try { u ? localStorage.setItem(CLAVE_WEBHOOK, u) : localStorage.removeItem(CLAVE_WEBHOOK) } catch (e) { /* sin almacenamiento */ }
}

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

// Envía el syllabus a n8n. Devuelve {documentos, programa, curso}. Si n8n termina sin lista de enlaces,
// lanza un error con code 'NO_DOCUMENT_LIST' (el portal original lo muestra como «El flujo terminó. Revisa tu carpeta»).
export async function generarDocumentos({ syllabusUrl, carpetaUrl, bibliografia }) {
  const response = await fetch(leerWebhook(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ syllabus_url: syllabusUrl, carpeta_destino_url: carpetaUrl, ...(bibliografia ? { bibliografia } : {}) })
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(responseErrorText(raw) || 'n8n respondió con HTTP ' + response.status)
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

// ---- Segundo flujo: «unidad-a-guiones». Recibe el documento de la unidad y devuelve un guion por tema. ----
// Copia «con bibliografía»: escribe los guiones con las fuentes leídas de la unidad. El flujo original es /unidad-a-guiones.
export const WEBHOOK_GUIONES_POR_DEFECTO = 'https://n8n.americana.edu.co/webhook/unidad-a-guiones-bibliografia'
const WEBHOOK_GUIONES_ANTERIOR = 'https://n8n.americana.edu.co/webhook/unidad-a-guiones'
const CLAVE_GUIONES = 'ova-webhook-guiones'
// Se usa la dirección guardada en «Conexión n8n»; si no hay (o es la del flujo anterior) se usa la de la copia con bibliografía.
export const leerWebhookGuiones = () => {
  try { const g = localStorage.getItem(CLAVE_GUIONES); return !g || g === WEBHOOK_GUIONES_ANTERIOR ? WEBHOOK_GUIONES_POR_DEFECTO : g } catch (e) { return WEBHOOK_GUIONES_POR_DEFECTO }
}
export const guardarWebhookGuiones = (u) => {
  try { u ? localStorage.setItem(CLAVE_GUIONES, u) : localStorage.removeItem(CLAVE_GUIONES) } catch (e) { /* sin almacenamiento */ }
}

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

// Los guiones se escriben con la bibliografía ya leída de ESA unidad (texto por página y cita APA 7), no con lo que el modelo conozca.
// Sin esa bibliografía no se envía nada: antes que inventar, se pide completarla.
export async function generarGuiones({ unidadUrl, syllabusUrl, bibliografiaId, unidad }) {
  if (!bibliografiaId) {
    const e = new Error('Este syllabus no tiene la bibliografía leída guardada. Vuelva a generar los documentos desde el paso «Syllabus» (se lee la bibliografía y luego se crean las unidades) y después cree los guiones.')
    e.code = 'SIN_BIBLIOGRAFIA'
    throw e
  }
  let bibliografia
  try { bibliografia = await api('GET', '/bibliografia/trabajos/' + bibliografiaId + '/paquete' + (unidad ? '?unidad=' + encodeURIComponent(unidad) : '')) } catch (err) {
    const e = new Error('No se pudo leer la bibliografía guardada de este syllabus: ' + (err.message || 'error'))
    e.code = 'SIN_BIBLIOGRAFIA'
    throw e
  }
  if (!bibliografia.fuentes || !bibliografia.fuentes.length) {
    const e = new Error('La bibliografía de la unidad ' + (unidad || '') + ' no tiene fuentes leídas: los guiones no se pueden respaldar. Revise la bibliografía de esa unidad.')
    e.code = 'SIN_BIBLIOGRAFIA'
    throw e
  }
  const response = await fetch(leerWebhookGuiones(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ unidad_url: unidadUrl, ...(syllabusUrl ? { syllabus_url: syllabusUrl } : {}), unidad, bibliografia })
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(responseErrorText(raw) || 'n8n respondió con HTTP ' + response.status)
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
