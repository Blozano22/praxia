// «Curso piloto»: fuentes de lectura con una interfaz común, para que el resto del módulo no dependa de cómo se lee la carpeta.
// Fuente = {
//   nombre: 'publica' | 'fixtures' | 'n8n',
//   listar(carpetaId, resourcekey?) → { nombre, entradas: [{ id, nombre, tipo: 'carpeta'|'doc'|'docx'|'hoja'|'otro', url }] },
//   leerDocHtml(entrada) → html,
//   leerCatalogoRecursos() → CSV | null,
//   leerCatalogoActividades() → CSV | null
// }
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { ErrorGoogle, exportarDocHtml, leerCsvHoja, listarCarpetaPublica, RE_ID } from './google.js'

const CATALOGO_ID = () => process.env.PILOTO_CATALOGO_ID || '1w8OsZQHtlLcJ0whtl6NeVGcilFkORbhQ_L81ihlaZFw'
const CATALOGO_GID = () => process.env.PILOTO_CATALOGO_GID || '967151393'
const ACTIVIDADES_HOJA = () => process.env.PILOTO_ACTIVIDADES_HOJA || 'ACTIVIDADES_AUTOAPRENDIZAJE'
const TTL_MS = 10 * 60 * 1000

// Caché en memoria (por proceso) de las hojas del catálogo. Una hoja que no se pudo leer no se guarda (se reintenta).
const cacheHojas = new Map()
async function hojaConCache(clave, leer) {
  const h = cacheHojas.get(clave)
  if (h && Date.now() - h.en < TTL_MS) return h.texto
  try { const texto = await leer(); cacheHojas.set(clave, { texto, en: Date.now() }); return texto } catch { return null }
}
export const vaciarCacheCatalogo = () => cacheHojas.clear()

export function crearFuentePublica() {
  return {
    nombre: 'publica',
    listar: (id, resourcekey) => listarCarpetaPublica(id, resourcekey),
    leerDocHtml: (entrada) => exportarDocHtml(entrada.id),
    leerCatalogoRecursos: () => hojaConCache('recursos', () => leerCsvHoja(CATALOGO_ID(), { gid: CATALOGO_GID() })),
    leerCatalogoActividades: () => hojaConCache('actividades', () => leerCsvHoja(CATALOGO_ID(), { hoja: ACTIVIDADES_HOJA() }))
  }
}

// ---- Fixtures: una carpeta local que imita Drive (pruebas) ---------------------------------------------------------------------
// Un directorio = una carpeta; *.html = Google Doc; *.docx = archivo subido; cualquier otro = «otro». Los directorios que empiezan por «_» no se listan.
// _catalogo/recursos.csv y _catalogo/actividades.csv (en el directorio dado o en su padre). El ID es 'fx' + sha1(ruta relativa).slice(0, 24); la raíz es el directorio dado
// y cualquier ID desconocido se lee como la raíz (así la prueba puede usar cualquier enlace de Drive).
export function crearFuenteFixtures(dir) {
  const raiz = path.resolve(dir)
  const idDe = (rel) => 'fx' + crypto.createHash('sha1').update(rel).digest('hex').slice(0, 24)
  const indice = new Map() // id → ruta absoluta
  const rutaDeId = (id) => {
    if (indice.has(id)) return indice.get(id)
    return raiz
  }
  const listar = async (id) => {
    const ruta = rutaDeId(id)
    if (!fs.existsSync(ruta) || !fs.statSync(ruta).isDirectory()) throw new ErrorGoogle('carpeta_no_publica')
    const entradas = []
    for (const n of fs.readdirSync(ruta, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (n.name.startsWith('_') || n.name.startsWith('.')) continue
      const abs = path.join(ruta, n.name)
      const eid = idDe(path.relative(raiz, abs).split(path.sep).join('/'))
      indice.set(eid, abs)
      if (n.isDirectory()) entradas.push({ id: eid, nombre: n.name, tipo: 'carpeta', url: 'https://drive.google.com/drive/folders/' + eid })
      else if (/\.html$/i.test(n.name)) entradas.push({ id: eid, nombre: n.name.replace(/\.html$/i, ''), tipo: 'doc', url: 'https://docs.google.com/document/d/' + eid + '/edit' })
      else if (/\.docx$/i.test(n.name)) entradas.push({ id: eid, nombre: n.name, tipo: 'docx', url: 'https://drive.google.com/file/d/' + eid + '/view' })
      else entradas.push({ id: eid, nombre: n.name, tipo: 'otro', url: 'https://drive.google.com/file/d/' + eid + '/view' })
    }
    return { nombre: path.basename(ruta), entradas }
  }
  const catalogo = (archivo) => {
    for (const base of [path.join(raiz, '_catalogo'), path.join(raiz, '..', '_catalogo')]) {
      const f = path.join(base, archivo)
      if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8')
    }
    return null
  }
  return {
    nombre: 'fixtures',
    listar,
    leerDocHtml: async (entrada) => {
      const abs = indice.get(entrada.id)
      if (!abs || !/\.html$/i.test(abs)) throw new ErrorGoogle('no_publico')
      return fs.readFileSync(abs, 'utf8')
    },
    leerCatalogoRecursos: async () => catalogo('recursos.csv'),
    leerCatalogoActividades: async () => catalogo('actividades.csv')
  }
}

// ---- PLAN B: un flujo de n8n NUEVO («DIEPO - Curso piloto (leer carpeta)») lee la carpeta con la credencial de Drive ---------------------------
// POST firmado (mismo esquema HMAC que los avisos: X-Praxia-Fecha y X-Praxia-Firma = HMAC-SHA256 hex de fecha + «.» + cuerpo) con { carpeta_id };
// responde { nombre, entradas, documentos: { [id]: html } }. Los flujos existentes no se tocan. Sin probar contra un flujo real (el flujo aún no existe).
export function crearFuenteN8n(url, { secreto = '' } = {}) {
  const u = new URL(url)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('La dirección del flujo debe empezar por https://')
  const cache = new Map() // carpeta_id → respuesta
  const pedir = async (carpetaId) => {
    if (cache.has(carpetaId)) return cache.get(carpetaId)
    const cuerpo = JSON.stringify({ carpeta_id: carpetaId })
    const fecha = String(Math.floor(Date.now() / 1000))
    const firma = secreto ? crypto.createHmac('sha256', secreto).update(fecha + '.' + cuerpo).digest('hex') : ''
    const r = await fetch(u, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(120000), headers: { 'content-type': 'application/json', ...(firma ? { 'x-praxia-fecha': fecha, 'x-praxia-firma': firma } : {}) }, body: cuerpo })
    if (!r.ok) throw new ErrorGoogle(r.status === 404 ? 'carpeta_no_publica' : 'error_descarga')
    const j = await r.json()
    if (!j || !Array.isArray(j.entradas)) throw new ErrorGoogle('error_descarga')
    cache.set(carpetaId, j)
    return j
  }
  const docs = new Map()
  return {
    nombre: 'n8n',
    listar: async (id) => {
      if (!RE_ID.test(String(id))) throw new ErrorGoogle('carpeta_no_publica')
      const j = await pedir(id)
      for (const [k, v] of Object.entries(j.documentos || {})) docs.set(k, String(v))
      return { nombre: String(j.nombre || ''), entradas: j.entradas.filter((e) => e && RE_ID.test(String(e.id))).map((e) => ({ id: e.id, nombre: String(e.nombre || ''), tipo: ['carpeta', 'doc', 'docx', 'hoja', 'otro'].includes(e.tipo) ? e.tipo : 'otro', url: e.url || null })) }
    },
    leerDocHtml: async (entrada) => { if (!docs.has(entrada.id)) throw new ErrorGoogle('no_publico'); return docs.get(entrada.id) },
    leerCatalogoRecursos: crearFuentePublica().leerCatalogoRecursos,
    leerCatalogoActividades: crearFuentePublica().leerCatalogoActividades
  }
}

export function fuentePorEntorno() {
  if (process.env.PILOTO_FUENTE === 'n8n' && process.env.PILOTO_N8N_URL) return crearFuenteN8n(process.env.PILOTO_N8N_URL, { secreto: config.n8nEventosSecreto || '' })
  if (process.env.PILOTO_FUENTE === 'fixtures' && process.env.NODE_ENV === 'test' && process.env.PILOTO_FIXTURES) return crearFuenteFixtures(process.env.PILOTO_FIXTURES)
  return crearFuentePublica()
}
