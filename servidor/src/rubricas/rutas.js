// «Generar rúbrica»: API bajo /api/rubricas (montada en app.js con exigirCabecera). Permiso propio: «rubricas.generar» (rol «generador_rubricas»).
//   GET  /estado     → { configurada }  (hay una dirección de n8n guardada en «Conexión con n8n» o en N8N_RUBRICAS_URL)
//   POST /           { unidades: [url de Google Doc…], carpeta_url }  → 202 { id }  (el servidor llama al flujo de n8n en segundo plano: tarda de 30 s a 2 min)
//   GET  /:id        → { estado: en_curso | listo | error, segundos, url, log, avisos, error }   (solo quien lo pidió)
// El navegador nunca llama a n8n: lo hace el servidor con la dirección que guardó la administración, con tope de tiempo y sin dejar pasar nada más que esos dos datos.
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import crypto from 'node:crypto'
import { z } from 'zod'
import { sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { exigirPermiso, exigirSesion } from '../seguridad.js'

export const PERMISO_RUBRICAS = 'rubricas.generar'
export const CLAVE_RUBRICAS = 'n8n.rubricas'
const MAX_UNIDADES = 12
const TIEMPO_MS = 6 * 60 * 1000
const VIGENCIA_MS = 60 * 60 * 1000
const MAX_EN_CURSO = 4

const esDoc = (u) => /^https:\/\/docs\.google\.com\/document\/d\/[\w-]{20,}/.test(u) || /^https:\/\/drive\.google\.com\/.*[?&]id=[\w-]{20,}/.test(u)
const esCarpeta = (u) => /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[\w-]{10,}/.test(u)
const Nuevo = z.object({
  unidades: z.array(z.string().trim().max(500).refine(esDoc)).min(1).max(MAX_UNIDADES),
  carpeta_url: z.string().trim().max(500).refine(esCarpeta)
}).strict()
const Id = z.object({ id: z.string().uuid() })

export async function urlRubricas() {
  const f = (await sinUsuario(Q.configLeer, [[CLAVE_RUBRICAS]])).rows[0]
  return (f && f.valor) || process.env.N8N_RUBRICAS_URL || ''
}

export function crearRutasRubricas({ antes = [exigirSesion, exigirPermiso(PERMISO_RUBRICAS)], direccion = urlRubricas, llamar = fetch, auditar = (usuarioId, id, ip) => sinUsuario(Q.auditoriaRegistrar, [usuarioId, 'rubrica_generar', 'rubrica', id, ip]).catch(() => {}) } = {}) {
  const r = Router()
  r.use(...antes)
  const trabajos = new Map() // id → { usuarioId, estado, inicio, fin, url, log, avisos, error }
  const porPersona = (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip))
  const limite = (n) => rateLimit({ windowMs: 60 * 1000, limit: n, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })
  const limpiar = () => { const t = Date.now(); for (const [k, v] of trabajos) if (v.estado !== 'en_curso' && t - v.fin > VIGENCIA_MS) trabajos.delete(k) }

  async function ejecutar(t, url, cuerpo) {
    try {
      const resp = await llamar(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(TIEMPO_MS), redirect: 'error' })
      const texto = await resp.text()
      let datos = {}
      try { datos = JSON.parse(texto) } catch { datos = { message: texto.slice(0, 300) } }
      const enlace = typeof datos.url === 'string' && /^https:\/\//.test(datos.url) ? datos.url : ''
      if (!resp.ok || !enlace) {
        t.estado = 'error'
        t.error = String(datos.message || datos.error || 'El flujo respondió con el código ' + resp.status + '.').slice(0, 400)
      } else {
        t.estado = 'listo'
        t.url = enlace
        t.log = (Array.isArray(datos.log) ? datos.log : []).map((l) => String(l).slice(0, 300)).slice(0, 100)
        t.avisos = t.log.filter((l) => /revisar|no tiene|sin las|no es json/i.test(l)).length
      }
    } catch (e) {
      t.estado = 'error'
      t.error = e && e.name === 'TimeoutError' ? 'El flujo tardó demasiado en responder (más de 6 minutos). Revise la ejecución en n8n.' : 'No hubo conexión con el flujo de n8n. Verifique que esté activo.'
    }
    t.fin = Date.now()
  }

  r.get('/estado', limite(120), async (req, res, next) => {
    try { res.set('Cache-Control', 'no-store').json({ configurada: !!(await direccion()) }) } catch (e) { next(e) }
  })

  r.post('/', limite(10), async (req, res, next) => {
    try {
      const b = Nuevo.safeParse(req.body)
      if (!b.success) return res.status(400).json({ error: 'Cada línea debe ser el enlace de un Google Doc de una unidad, y la carpeta, el enlace de una carpeta de Drive.' })
      const url = await direccion()
      if (!url) return res.status(503).json({ error: 'La generación de rúbricas no está configurada: falta la dirección del flujo en «Conexión con n8n».' })
      limpiar()
      const mias = [...trabajos.values()].filter((t) => t.usuarioId === req.usuario.id && t.estado === 'en_curso').length
      if (mias >= 1) return res.status(429).json({ error: 'Ya tiene una rúbrica generándose. Espere a que termine.' })
      if ([...trabajos.values()].filter((t) => t.estado === 'en_curso').length >= MAX_EN_CURSO) return res.status(429).json({ error: 'Hay varias rúbricas generándose. Inténtelo de nuevo en un momento.' })
      const id = crypto.randomUUID()
      const t = { usuarioId: req.usuario.id, estado: 'en_curso', inicio: Date.now(), fin: 0, url: '', log: [], avisos: 0, error: '' }
      trabajos.set(id, t)
      ejecutar(t, url, { unidad_url: [...new Set(b.data.unidades)].join('\n'), carpeta_url: b.data.carpeta_url })
      auditar(req.usuario.id, id, String(req.ip || '').slice(0, 64))
      res.status(202).json({ id })
    } catch (e) { next(e) }
  })

  r.get('/:id', limite(240), (req, res) => {
    const p = Id.safeParse(req.params)
    const t = p.success ? trabajos.get(p.data.id) : null
    if (!t || t.usuarioId !== req.usuario.id) return res.status(404).json({ error: 'No existe esa generación (puede haber vencido).' })
    res.set('Cache-Control', 'no-store').json({ estado: t.estado, segundos: Math.round(((t.fin || Date.now()) - t.inicio) / 1000), url: t.url, log: t.log, avisos: t.avisos, error: t.error })
  })
  return r
}

export const rutasRubricas = crearRutasRubricas()
