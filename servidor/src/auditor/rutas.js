// «Auditor de guiones»: API bajo /api/auditor (montada en app.js con exigirCabecera). Permiso propio: «guiones.auditar» (rol «auditor_guiones» y administración).
//   GET  /configuracion     → { configurada }  (hay una dirección de n8n guardada en «Conexión con n8n» o en N8N_AUDITOR_URL)
//   POST /                  multipart: guion_file|guion_url (obligatorio), syllabus_file|syllabus_url, estructura_file|estructura_url, nombre, correo  → { ok, job_id }
//   GET  /trabajo/:job      → { estado: en_curso | listo | error, mensaje, concepto, doc_url, resumen }   (solo quien lo envió)
// El navegador nunca llama a n8n: el servidor valida tamaños, tipos y enlaces y reenvía el multipart al webhook guardado por la administración;
// el estado se consulta en «<webhook>-estado?job=<id>» (contrato de la herramienta original).
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { Readable } from 'node:stream'
import { sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { exigirPermiso, exigirSesion } from '../seguridad.js'

export const PERMISO_AUDITOR = 'guiones.auditar'
export const CLAVE_AUDITOR = 'n8n.auditor'
export const MAX_ARCHIVO = 15 * 1024 * 1024
const MAX_TOTAL = 40 * 1024 * 1024
const TIEMPO_ENVIO_MS = 90 * 1000
const TIEMPO_ESTADO_MS = 30 * 1000
const VIGENCIA_MS = 2 * 60 * 60 * 1000
const BLOQUES = [['guion', 'el guion a evaluar'], ['syllabus', 'el syllabus'], ['estructura', 'la estructura metodológica']]
const EXT = ['docx', 'doc', 'pdf', 'odt', 'txt']
const ID_JOB = /^[\w.:-]{1,120}$/

const esEnlace = (u) => /^https:\/\/docs\.google\.com\/(?:document|file)\/d\/[\w-]{20,}/.test(u) || /^https:\/\/drive\.google\.com\/(?:file\/d\/[\w-]{20,}|.*[?&]id=[\w-]{20,})/.test(u)
const esCorreo = (c) => c.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(c)

// El contenido debe parecerse a su extensión (no basta el nombre).
function contenidoValido(ext, b) {
  const ini = (...x) => x.every((v, i) => b[i] === v)
  if (ext === 'pdf') return ini(0x25, 0x50, 0x44, 0x46)
  if (ext === 'docx' || ext === 'odt') return ini(0x50, 0x4b)
  if (ext === 'doc') return ini(0xd0, 0xcf, 0x11, 0xe0) || ini(0x50, 0x4b)
  return !b.subarray(0, 4096).includes(0) // txt
}

export async function urlAuditor() {
  const f = (await sinUsuario(Q.configLeer, [[CLAVE_AUDITOR]])).rows[0]
  return (f && f.valor) || process.env.N8N_AUDITOR_URL || ''
}

export const urlEstado = (url, job) => { const u = new URL(url); u.pathname += '-estado'; u.search = ''; u.searchParams.set('job', job); return u.toString() }

// Lee el multipart del navegador con un tope de bytes (sin dependencias: el analizador de undici incluido en Node).
async function leerFormulario(req) {
  const largo = Number(req.headers['content-length'])
  if (!/^multipart\/form-data/i.test(req.headers['content-type'] || '')) return { error: 'Envíe el formulario con los documentos.' }
  if (!Number.isFinite(largo) || largo > MAX_TOTAL) return { error: 'Los documentos pesan demasiado (máximo ' + MAX_TOTAL / 1048576 + ' MB en total).', estado: 413 }
  let visto = 0
  const flujo = Readable.toWeb(req).pipeThrough(new TransformStream({ transform(c, ctl) { visto += c.length; if (visto > MAX_TOTAL) ctl.error(new Error('tope')); else ctl.enqueue(c) } }))
  try {
    return { form: await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: flujo, duplex: 'half' }).formData() }
  } catch { return { error: 'No se pudo leer el formulario o los documentos pesan demasiado.', estado: 400 } }
}

export function crearRutasAuditor({ antes = [exigirSesion, exigirPermiso(PERMISO_AUDITOR)], direccion = urlAuditor, llamar = fetch, auditar = (usuarioId, id, ip) => sinUsuario(Q.auditoriaRegistrar, [usuarioId, 'auditor_guion', 'auditor', id, ip]).catch(() => {}) } = {}) {
  const r = Router()
  r.use(...antes)
  const trabajos = new Map() // job_id → { usuarioId, inicio }
  const porPersona = (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip))
  const limite = (n) => rateLimit({ windowMs: 60 * 1000, limit: n, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })
  const limpiar = () => { const t = Date.now(); for (const [k, v] of trabajos) if (t - v.inicio > VIGENCIA_MS) trabajos.delete(k) }

  r.get('/configuracion', limite(120), async (req, res, next) => {
    try { res.set('Cache-Control', 'no-store').json({ configurada: !!(await direccion()) }) } catch (e) { next(e) }
  })

  r.post('/', limite(10), async (req, res, next) => {
    try {
      const url = await direccion()
      if (!url) return res.status(503).json({ ok: false, errores: ['El auditor no está configurado: falta la dirección del flujo en «Conexión con n8n».'] })
      const { form, error, estado } = await leerFormulario(req)
      if (error) return res.status(estado || 400).json({ ok: false, errores: [error] })
      const errores = []
      const salida = new FormData()
      const texto = (k, max) => { const v = form.get(k); return typeof v === 'string' ? v.trim().slice(0, max) : '' }
      for (const [k, que] of BLOQUES) {
        const archivo = form.get(k + '_file')
        const enlace = texto(k + '_url', 600)
        const hayArchivo = archivo && typeof archivo !== 'string' && archivo.size > 0
        if (hayArchivo && enlace) { errores.push('Para ' + que + ' envíe un archivo o un enlace, no los dos.'); continue }
        if (hayArchivo) {
          const nombre = String(archivo.name || '').replace(/[\\/\0-\x1f]/g, '_').slice(0, 150)
          const ext = (nombre.split('.').pop() || '').toLowerCase()
          if (!EXT.includes(ext)) { errores.push('El archivo de ' + que + ' debe ser .docx, .doc, .pdf, .odt o .txt.'); continue }
          if (archivo.size > MAX_ARCHIVO) { errores.push('El archivo de ' + que + ' pesa más de ' + MAX_ARCHIVO / 1048576 + ' MB.'); continue }
          const bytes = Buffer.from(await archivo.arrayBuffer())
          if (!contenidoValido(ext, bytes)) { errores.push('El archivo de ' + que + ' no parece un .' + ext + ' válido.'); continue }
          salida.append(k + '_file', new Blob([bytes], { type: archivo.type || 'application/octet-stream' }), nombre)
        } else if (enlace) {
          if (!esEnlace(enlace)) { errores.push('El enlace de ' + que + ' debe ser de Google Docs o Drive.'); continue }
          salida.append(k + '_url', enlace)
        } else if (k === 'guion') errores.push('Falta el guion a evaluar: suba un archivo o pegue un enlace.')
      }
      const nombre = texto('nombre', 150)
      const correo = texto('correo', 254)
      if (correo && !esCorreo(correo)) errores.push('El correo para compartir no es válido.')
      if (errores.length) return res.status(400).json({ ok: false, errores })
      if (nombre) salida.append('nombre', nombre)
      if (correo) salida.append('correo', correo)
      limpiar()
      let resp, datos = {}
      try {
        resp = await llamar(url, { method: 'POST', body: salida, signal: AbortSignal.timeout(TIEMPO_ENVIO_MS), redirect: 'error' })
        try { datos = JSON.parse(await resp.text()) || {} } catch { datos = {} }
      } catch { return res.status(502).json({ ok: false, errores: ['No hubo conexión con el flujo de n8n. Verifique que esté activo.'] }) }
      const job = typeof datos.job_id === 'string' || typeof datos.job_id === 'number' ? String(datos.job_id) : ''
      if (!resp.ok || datos.ok === false || !ID_JOB.test(job)) {
        const e = Array.isArray(datos.errores) ? datos.errores.map((x) => String(x).slice(0, 300)).slice(0, 10) : []
        return res.status(502).json({ ok: false, errores: e.length ? e : ['El flujo no aceptó la revisión (código ' + (resp.status || '?') + ').'] })
      }
      trabajos.set(job, { usuarioId: req.usuario.id, inicio: Date.now() })
      auditar(req.usuario.id, job.slice(0, 60), String(req.ip || '').slice(0, 64))
      res.status(202).json({ ok: true, job_id: job })
    } catch (e) { next(e) }
  })

  r.get('/trabajo/:job', limite(240), async (req, res, next) => {
    try {
      const job = String(req.params.job || '')
      const t = ID_JOB.test(job) ? trabajos.get(job) : null
      if (!t || t.usuarioId !== req.usuario.id) return res.status(404).json({ error: 'No existe esa revisión (puede haber vencido o el servidor se reinició).' })
      const url = await direccion()
      if (!url) return res.status(503).json({ error: 'El auditor no está configurado.' })
      res.set('Cache-Control', 'no-store')
      let d
      try {
        const resp = await llamar(urlEstado(url, job), { method: 'GET', signal: AbortSignal.timeout(TIEMPO_ESTADO_MS), redirect: 'error' })
        d = JSON.parse(await resp.text())
      } catch { return res.json({ estado: 'en_curso', mensaje: '' }) } // un fallo momentáneo no cancela la revisión: la pantalla sigue preguntando
      const cad = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
      if (d && d.estado === 'error') return res.json({ estado: 'error', mensaje: cad(d.mensaje, 500) || 'El flujo terminó con un error.' })
      if (d && d.estado === 'listo') {
        const enlace = typeof d.doc_url === 'string' && /^https:\/\//.test(d.doc_url) ? d.doc_url.slice(0, 600) : ''
        let resumen = d.resumen
        if (resumen !== null && typeof resumen === 'object') { const j = JSON.stringify(resumen); resumen = j.length > 20000 ? '' : resumen } else resumen = cad(resumen, 20000)
        return res.json({ estado: 'listo', concepto: cad(d.concepto, 500), doc_url: enlace, resumen: resumen ?? '' })
      }
      res.json({ estado: 'en_curso', mensaje: cad(d && d.mensaje, 300) })
    } catch (e) { next(e) }
  })
  return r
}

export const rutasAuditor = crearRutasAuditor()
