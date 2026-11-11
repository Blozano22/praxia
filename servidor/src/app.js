import express from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import fs from 'node:fs'
import { config } from './config.js'
import { exigirCabecera } from './seguridad.js'
import { rutas } from './rutas.js'
import { rutasBibliografia } from './bibliografia/rutas.js'
import { rutasGuiones } from './guiones/rutas.js'
import { rutasUnidades } from './unidades/rutas.js'

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
