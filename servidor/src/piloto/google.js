// «Curso piloto»: lectura de carpetas y documentos PÚBLICOS de Google (sin credenciales). Toda descarga pasa por descargarGoogle():
// la URL la arma el servidor (nunca la de la persona tal cual), redirecciones manuales (máx. 5), en CADA salto lista blanca de hosts y validarDestino() (anti-SSRF),
// tope de tamaño y de tiempo. No se usa descargar() de bibliografia/red.js porque sigue redirecciones a cualquier host público.
import * as cheerio from 'cheerio'
import { validarDestino } from '../bibliografia/red.js'

export const RE_ID = /^[A-Za-z0-9_-]{10,100}$/
export const hostPermitido = (h) => ['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'].includes(h) || h.endsWith('.googleusercontent.com')
const UA = 'Mozilla/5.0 (compatible; PraxiaPiloto/1.0)'
const MAX_ENTRADAS = 500

export class ErrorGoogle extends Error {
  constructor(codigo) { super(codigo); this.codigo = codigo }
}

// deps solo se sustituye en las pruebas: { fetch, validar }.
export async function descargarGoogle(url, { maxBytes = 15 * 1024 * 1024, tiempoMs = 30000 } = {}, deps = {}) {
  const pedir = deps.fetch || ((...a) => globalThis.fetch(...a))
  const validar = deps.validar || validarDestino
  let actual = url
  for (let salto = 0; salto < 6; salto++) {
    let u
    try { u = new URL(actual) } catch { throw new ErrorGoogle('host_no_permitido') }
    if (u.protocol !== 'https:' || u.username || u.password) throw new ErrorGoogle('host_no_permitido')
    if (u.hostname === 'accounts.google.com') throw new ErrorGoogle('no_publico') // el documento pide iniciar sesión: no es público
    if (!hostPermitido(u.hostname)) throw new ErrorGoogle('host_no_permitido')
    try { u = await validar(u.href) } catch { throw new ErrorGoogle('host_no_permitido') } // anti-SSRF en cada salto
    if (!hostPermitido(u.hostname)) throw new ErrorGoogle(u.hostname === 'accounts.google.com' ? 'no_publico' : 'host_no_permitido')
    let r
    try { r = await pedir(u, { redirect: 'manual', signal: AbortSignal.timeout(tiempoMs), headers: { 'user-agent': UA } }) } catch (e) {
      throw new ErrorGoogle(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'tiempo' : 'error_descarga')
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      if (salto === 5) throw new ErrorGoogle('demasiadas_redirecciones')
      actual = new URL(r.headers.get('location'), u).href
      try { r.body && (await r.body.cancel()) } catch { /* sin cuerpo */ }
      continue
    }
    if (Number(r.headers.get('content-length') || 0) > maxBytes) throw new ErrorGoogle('demasiado_grande')
    const partes = []
    let total = 0
    try {
      for await (const trozo of r.body) {
        total += trozo.length
        if (total > maxBytes) throw new ErrorGoogle('demasiado_grande')
        partes.push(trozo)
      }
    } catch (e) {
      if (e instanceof ErrorGoogle) throw e
      throw new ErrorGoogle(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'tiempo' : 'error_descarga')
    }
    return { estado: r.status, tipo: (r.headers.get('content-type') || '').toLowerCase(), datos: Buffer.concat(partes) }
  }
  throw new ErrorGoogle('demasiadas_redirecciones')
}

const tipoDeEntrada = (href, nombre) => {
  if (/drive\/folders\//.test(href)) return 'carpeta'
  if (/docs\.google\.com\/document\//.test(href)) return 'doc'
  if (/docs\.google\.com\/spreadsheets\//.test(href)) return 'hoja'
  if (/\/file\/d\//.test(href) && /\.docx$/i.test(nombre)) return 'docx'
  return 'otro'
}

// Parseo de https://drive.google.com/embeddedfolderview (página no documentada por Google): cada elemento es un .flip-entry con su enlace y su título.
export function parsearCarpetaPublica(html) {
  const $ = cheerio.load(String(html || ''))
  const entradas = []
  $('.flip-entry').each((_, el) => {
    const id = String($(el).attr('id') || '').replace(/^entry-/, '')
    const href = $(el).find('a').first().attr('href') || ''
    const nombre = $(el).find('.flip-entry-title').first().text().trim()
    if (!RE_ID.test(id)) return
    entradas.push({ id, nombre, tipo: tipoDeEntrada(href, nombre), url: href.startsWith('https://') ? href : null })
  })
  if (entradas.length > MAX_ENTRADAS) throw new ErrorGoogle('carpeta_demasiado_grande')
  return { nombre: $('title').first().text().trim(), entradas }
}

export async function listarCarpetaPublica(id, resourcekey, deps = {}) {
  if (!RE_ID.test(String(id))) throw new ErrorGoogle('carpeta_no_publica')
  const rk = resourcekey && /^[A-Za-z0-9_-]{1,64}$/.test(resourcekey) ? '&resourcekey=' + encodeURIComponent(resourcekey) : ''
  const r = await descargarGoogle('https://drive.google.com/embeddedfolderview?id=' + encodeURIComponent(id) + rk, { maxBytes: 5 * 1024 * 1024 }, deps)
  if (r.estado === 404 || r.estado === 401 || r.estado === 403) throw new ErrorGoogle('carpeta_no_publica')
  if (r.estado !== 200 || !r.tipo.includes('text/html')) throw new ErrorGoogle('error_descarga')
  return parsearCarpetaPublica(r.datos.toString('utf8'))
}

export async function exportarDocHtml(id, deps = {}) {
  if (!RE_ID.test(String(id))) throw new ErrorGoogle('no_publico')
  const r = await descargarGoogle('https://docs.google.com/document/d/' + encodeURIComponent(id) + '/export?format=html', {}, deps)
  if (r.estado === 401 || r.estado === 403 || r.estado === 404) throw new ErrorGoogle('no_publico')
  if (r.estado !== 200 || !r.tipo.includes('text/html')) throw new ErrorGoogle('no_publico')
  return r.datos.toString('utf8')
}

export async function leerCsvHoja(id, { gid, hoja } = {}, deps = {}) {
  if (!RE_ID.test(String(id))) throw new ErrorGoogle('no_publico')
  const url = gid != null && /^\d{1,20}$/.test(String(gid))
    ? 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/export?format=csv&gid=' + gid
    : 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(String(hoja || ''))
  const r = await descargarGoogle(url, { maxBytes: 5 * 1024 * 1024 }, deps)
  if (r.estado !== 200 || !r.tipo.includes('text/csv')) throw new ErrorGoogle('no_publico')
  return r.datos.toString('utf8')
}
