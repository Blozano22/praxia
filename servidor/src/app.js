import express from 'express'
import { Q } from './consultas.js'
import { sinUsuario } from './db.js'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { exigirCabecera } from './seguridad.js'
import { rutas } from './rutas.js'
import { rutasBibliografia } from './bibliografia/rutas.js'
import { rutasGuiones } from './guiones/rutas.js'
import { rutasUnidades } from './unidades/rutas.js'
import { analizarCuerpoEventos, rutasEventosN8n } from './pipeline/eventos.js'

export function crearApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(helmet({
    // La plataforma es un archivo único con scripts y estilos incrustados y vistas previas en iframes propios.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        // Vista previa de los documentos y carpetas de Google (solo esos dos sitios).
        frameSrc: ["'self'", 'blob:', 'data:', 'https://docs.google.com', 'https://drive.google.com'],
        connectSrc: ["'self'", 'https://n8n.americana.edu.co'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  }))
  // Avisos de n8n: sin sesión ni cabecera x-ova, con firma HMAC sobre el cuerpo tal como llegó (por eso se guarda crudo) y un tope de
  // tamaño propio, más pequeño; va ANTES del analizador general para que nadie sin firma haga trabajar al de 25 MB.
  app.use('/api/n8n', analizarCuerpoEventos, rutasEventosN8n)
  app.use(express.json({ limit: '25mb' }))
  app.use(cookieParser())
  app.use('/api/bibliografia', exigirCabecera, rutasBibliografia)
  app.use('/api/guiones', exigirCabecera, rutasGuiones)
  app.use('/api/unidades', exigirCabecera, rutasUnidades)
  app.use('/api', exigirCabecera, rutas)
  app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }))

  if (config.carpetaWeb && fs.existsSync(config.carpetaWeb)) {
    // Plantillas HTML de los recursos, ya armadas en el build (dist/plantillas-html): públicas y de solo lectura.
    // Las descarga un flujo de n8n sin sesión ni cabecera x-ova; no contienen datos de nadie. CORS abierto solo para leer (GET).
    app.use('/plantillas-html', (req, res, next) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return res.status(405).set('Allow', 'GET, HEAD, OPTIONS').end()
      res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-cache' })
      if (req.method === 'OPTIONS') return res.status(204).end()
      next()
    })
    // Índice de plantillas: el archivo del build + la categoría de cada una (si la base de datos no responde, se entrega el archivo tal cual).
    // Lo de siempre (marcas, total, plantillas[].nombre/archivo) no cambia; se AÑADE id_catalogo por plantilla, «categorias» y «sin_categoria».
    app.get('/plantillas-html/plantillas.json', async (req, res, next) => {
      let base
      try { base = JSON.parse(fs.readFileSync(path.join(config.carpetaWeb, 'plantillas-html', 'plantillas.json'), 'utf8')) } catch { return next() }
      try {
        const [c, a] = await Promise.all([sinUsuario(Q.categoriasListar), sinUsuario(Q.categoriasAsignaciones)])
        const de = Object.fromEntries(a.rows.map((x) => [x.plantilla, x.categoria]))
        const plantillas = (base.plantillas || []).map((p) => ({ ...p, id_catalogo: de[p.nombre] || null }))
        const categorias = c.rows.map((k) => ({ id: k.id, nombre: k.nombre, variantes: plantillas.filter((p) => p.id_catalogo === k.id).map(({ nombre, archivo }) => ({ nombre, archivo })) }))
        res.json({ ...base, plantillas, categorias, sin_categoria: plantillas.filter((p) => !p.id_catalogo).map(({ nombre, archivo }) => ({ nombre, archivo })) })
      } catch { res.json(base) }
    })
    app.use(express.static(config.carpetaWeb, { index: 'index.html' }))
  }

  // Nunca se devuelve el detalle de un error interno al navegador.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err && err.message)
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Demasiado grande' })
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Petición no válida' })
    res.status(500).json({ error: 'Error interno' })
  })
  return app
}
