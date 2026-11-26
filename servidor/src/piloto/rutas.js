// «Curso piloto»: API. Rutas bajo /api/piloto (montadas en app.js con exigirCabecera). Permiso existente «proyectos.crear».
//   POST   /api/piloto/analisis        { carpeta_url }  → 202 { id }  (analiza en segundo plano; 1 en curso por persona, 3 en total)
//   GET    /api/piloto/analisis/:id                     → estado, avance y, al terminar, el resultado
//   DELETE /api/piloto/analisis/:id                     → 204 (olvida el resultado)
// Nada se escribe en la base de datos.
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { exigirPermiso, exigirSesion } from '../seguridad.js'
import { modoPruebasPlantillas } from '../pipeline/preparacion.js'
import { ErrorLimite, iniciarTrabajo, obtenerTrabajo, olvidarTrabajo } from './analisis.js'
import { fuentePorEntorno } from './fuentes.js'
import { cargarPlantillas } from './simular.js'

const RE_CARPETA_URL = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,100})(?:[/?#].*)?$/
const Nuevo = z.object({ carpeta_url: z.string().max(500).regex(RE_CARPETA_URL) }).strict()
const Id = z.object({ id: z.string().uuid() })

// Cupo por persona (tras iniciar sesión); sin sesión, por dirección IP.
const porPersona = (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip))

export function crearRutasPiloto({ antes = [exigirSesion, exigirPermiso('proyectos.crear')], fuente = fuentePorEntorno, plantillas = cargarPlantillas, pruebas = modoPruebasPlantillas } = {}) {
  const r = Router()
  r.use(...antes)
  const limiteCrear = rateLimit({ windowMs: 60 * 1000, limit: 6, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })
  const limiteLeer = rateLimit({ windowMs: 60 * 1000, limit: 240, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })

  r.post('/analisis', limiteCrear, (req, res) => {
    const b = Nuevo.safeParse(req.body)
    if (!b.success) return res.status(400).json({ error: 'Pegue el enlace de una carpeta de Google Drive' })
    const url = b.data.carpeta_url
    const carpetaId = RE_CARPETA_URL.exec(url)[1]
    let resourcekey
    try { const rk = new URL(url).searchParams.get('resourcekey'); if (rk && /^[A-Za-z0-9_-]{1,64}$/.test(rk)) resourcekey = rk } catch { /* sin clave de recurso */ }
    try {
      const { id } = iniciarTrabajo({ usuarioId: req.usuario.id, carpetaId, resourcekey, fuente, plantillas, pruebas })
      res.status(202).json({ id })
    } catch (e) {
      if (e instanceof ErrorLimite) return res.status(429).json({ error: e.message })
      console.warn('[piloto] no se pudo iniciar el análisis')
      res.status(500).json({ error: 'Error interno' })
    }
  })

  r.get('/analisis/:id', limiteLeer, (req, res) => {
    const p = Id.safeParse(req.params)
    const t = p.success ? obtenerTrabajo(p.data.id, req.usuario.id) : null
    if (!t) return res.status(404).json({ error: 'No existe ese análisis (puede haber vencido).' })
    res.set('Cache-Control', 'no-store').json(t)
  })

  r.delete('/analisis/:id', limiteLeer, (req, res) => {
    const p = Id.safeParse(req.params)
    if (!p.success || !olvidarTrabajo(p.data.id, req.usuario.id)) return res.status(404).json({ error: 'No existe ese análisis (puede haber vencido).' })
    res.status(204).end()
  })
  return r
}

export const rutasPiloto = crearRutasPiloto()
