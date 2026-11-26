// «Auditor de guiones»: API bajo /api/auditor (montada en app.js con exigirCabecera). Permiso propio: «guiones.auditar» (rol «auditor_guiones» y administración).
//   GET  /configuracion     → { configurada }  (hay una dirección de n8n guardada en «Conexión con n8n» o en N8N_AUDITOR_URL)
//   POST /                  JSON { carpeta_url, syllabus_url?, estructura_url?, correo? }  → { ok, job_id }   (se evalúan todos los guiones de la carpeta de Drive)
//   GET  /trabajo/:job      → { estado: en_curso | listo | error, mensaje, concepto, doc_url, resumen }   (solo quien lo envió)
// El navegador nunca llama a n8n: el servidor valida los enlaces y el correo y los reenvía como multipart/form-data al webhook guardado por la administración;
// el estado se consulta en «<webhook>-estado?job=<id>» (contrato de la herramienta original).
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { exigirPermiso, exigirSesion } from '../seguridad.js'

export const PERMISO_AUDITOR = 'guiones.auditar'
export const CLAVE_AUDITOR = 'n8n.auditor'
const TIEMPO_ENVIO_MS = 90 * 1000
const TIEMPO_ESTADO_MS = 30 * 1000
const VIGENCIA_MS = 8 * 60 * 60 * 1000 // las evaluaciones pueden tardar hasta 6 h
const MAX_TRABAJOS = 2000
const ID_JOB = /^[\w.:-]{1,120}$/

const esCarpeta = (u) => /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[\w-]{10,}(?:[?#].*)?$/.test(u)
const esDocumento = (u) => /^https:\/\/docs\.google\.com\/(?:document|file)\/d\/[\w-]{20,}/.test(u) || /^https:\/\/drive\.google\.com\/(?:file\/d\/[\w-]{20,}|.*[?&]id=[\w-]{20,})/.test(u)
const esCorreo = (c) => c.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(c)

export async function urlAuditor() {
  const f = (await sinUsuario(Q.configLeer, [[CLAVE_AUDITOR]])).rows[0]
  return (f && f.valor) || process.env.N8N_AUDITOR_URL || ''
}

export const urlEstado = (url, job) => { const u = new URL(url); u.pathname += '-estado'; u.search = ''; u.searchParams.set('job', job); return u.toString() }

export function crearRutasAuditor({ antes = [exigirSesion, exigirPermiso(PERMISO_AUDITOR)], direccion = urlAuditor, llamar = fetch, auditar = (usuarioId, id, ip) => sinUsuario(Q.auditoriaRegistrar, [usuarioId, 'auditor_guion', 'auditor', id, ip]).catch(() => {}) } = {}) {
  const r = Router()
  r.use(...antes)
  const trabajos = new Map() // job_id → { usuarioId, inicio } (en orden de llegada)
  const porPersona = (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip))
  const limite = (n) => rateLimit({ windowMs: 60 * 1000, limit: n, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })
  const limpiar = () => {
    const t = Date.now()
    for (const [k, v] of trabajos) if (t - v.inicio > VIGENCIA_MS) trabajos.delete(k)
    while (trabajos.size >= MAX_TRABAJOS) trabajos.delete(trabajos.keys().next().value) // tope: se descarta el más antiguo
  }

  r.get('/configuracion', limite(120), async (req, res, next) => {
    try { res.set('Cache-Control', 'no-store').json({ configurada: !!(await direccion()) }) } catch (e) { next(e) }
  })

  r.post('/', limite(10), async (req, res, next) => {
    try {
      const url = await direccion()
      if (!url) return res.status(503).json({ ok: false, errores: ['El auditor no está configurado: falta la dirección del flujo en «Conexión con n8n».'] })
      const b = req.body && typeof req.body === 'object' ? req.body : {}
      const campo = (k, max) => (typeof b[k] === 'string' ? b[k].trim().slice(0, max + 1) : '')
      const carpeta = campo('carpeta_url', 600), syllabus = campo('syllabus_url', 600), estructura = campo('estructura_url', 600), correo = campo('correo', 254)
      const errores = []
      if (!carpeta) errores.push('Falta el enlace de la carpeta de guiones.')
      else if (carpeta.length > 600 || !esCarpeta(carpeta)) errores.push('El enlace de la carpeta debe ser de una carpeta de Google Drive (drive.google.com/drive/folders/…).')
      if (syllabus && (syllabus.length > 600 || !esDocumento(syllabus))) errores.push('El enlace del syllabus debe ser de Google Docs o Drive.')
      if (estructura && (estructura.length > 600 || !esDocumento(estructura))) errores.push('El enlace de la estructura metodológica debe ser de Google Docs o Drive.')
      if (correo && !esCorreo(correo)) errores.push('El correo para compartir no es válido.')
      if (errores.length) return res.status(400).json({ ok: false, errores })
      const salida = new FormData()
      salida.append('carpeta_url', carpeta)
      salida.append('syllabus_url', syllabus)
      salida.append('estructura_url', estructura)
      salida.append('correo', correo)
      let resp, datos = {}
      try {
        resp = await llamar(url, { method: 'POST', body: salida, signal: AbortSignal.timeout(TIEMPO_ENVIO_MS), redirect: 'error' })
        try { datos = JSON.parse(await resp.text()) || {} } catch { datos = {} }
      } catch { return res.status(502).json({ ok: false, errores: ['No hubo conexión con el flujo de n8n. Verifique que esté activo.'] }) }
      const job = typeof datos.job_id === 'string' || typeof datos.job_id === 'number' ? String(datos.job_id) : ''
      if (!resp.ok || datos.ok === false || !ID_JOB.test(job)) {
        const e = Array.isArray(datos.errores) ? datos.errores.map((x) => String(x).slice(0, 300)).slice(0, 10) : []
        return res.status(502).json({ ok: false, errores: e.length ? e : ['El flujo no aceptó la evaluación (código ' + (resp.status || '?') + ').'] })
      }
      limpiar()
      trabajos.set(job, { usuarioId: req.usuario.id, inicio: Date.now() })
      auditar(req.usuario.id, job.slice(0, 60), String(req.ip || '').slice(0, 64))
      res.status(202).json({ ok: true, job_id: job })
    } catch (e) { next(e) }
  })

  r.get('/trabajo/:job', limite(240), async (req, res, next) => {
    try {
      const job = String(req.params.job || '')
      const t = ID_JOB.test(job) ? trabajos.get(job) : null
      if (!t || t.usuarioId !== req.usuario.id) return res.status(404).json({ error: 'No existe esa evaluación (puede haber vencido o el servidor se reinició). Revise la carpeta del curso en Drive.' })
      const url = await direccion()
      if (!url) return res.status(503).json({ error: 'El auditor no está configurado.' })
      res.set('Cache-Control', 'no-store')
      let d
      try {
        const resp = await llamar(urlEstado(url, job), { method: 'GET', signal: AbortSignal.timeout(TIEMPO_ESTADO_MS), redirect: 'error' })
        d = JSON.parse(await resp.text())
      } catch { return res.json({ estado: 'en_curso', mensaje: '' }) } // un fallo momentáneo no cancela la evaluación: la pantalla sigue preguntando
      const cad = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
      if (d && d.estado === 'error') return res.json({ estado: 'error', mensaje: cad(d.mensaje, 500) || 'El flujo terminó con un error.' })
      if (d && d.estado === 'listo') {
        const enlace = typeof d.doc_url === 'string' && /^https:\/\//.test(d.doc_url) ? d.doc_url.slice(0, 600) : ''
        const resumen = typeof d.resumen === 'string' ? d.resumen.slice(0, 30000) : (d.resumen && typeof d.resumen === 'object' ? JSON.stringify(d.resumen).slice(0, 30000) : '')
        return res.json({ estado: 'listo', concepto: cad(d.concepto, 500), doc_url: enlace, resumen })
      }
      res.json({ estado: 'en_curso', mensaje: cad(d && d.mensaje, 300) })
    } catch (e) { next(e) }
  })
  return r
}

export const rutasAuditor = crearRutasAuditor()
