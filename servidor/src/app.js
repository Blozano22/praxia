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
import { CABECERAS_AISLADAS } from './plantillas/subidas.js'
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

  // Plantillas HTML de los recursos: públicas y de solo lectura. Las descarga un flujo de n8n sin sesión ni cabecera x-ova; no contienen datos de nadie.
  // Salen de dos sitios: las armadas en el build (dist/plantillas-html) y las subidas desde la pantalla (base de datos). CORS abierto solo para leer (GET).
  app.use('/plantillas-html', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return res.status(405).set('Allow', 'GET, HEAD, OPTIONS').end()
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-cache' })
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  })
  // Índice: lo del build + las subidas + la categoría de cada una (si la base de datos no responde, se entrega solo el archivo del build).
  // Lo de siempre (marcas, total, plantillas[].nombre/archivo) no cambia; se AÑADE id_catalogo por plantilla, «categorias» y «sin_categoria».
  app.get('/plantillas-html/plantillas.json', async (req, res) => {
    let base = { marcas: { titulo: '{{TITULO}}', contenido: '/*CONTENIDO*/' }, total: 0, plantillas: [] }
    if (config.carpetaWeb) { try { base = JSON.parse(fs.readFileSync(path.join(config.carpetaWeb, 'plantillas-html', 'plantillas.json'), 'utf8')) } catch { /* sin build: solo las subidas */ } }
    try {
      const [c, a, u] = await Promise.all([sinUsuario(Q.categoriasListar), sinUsuario(Q.categoriasAsignaciones), sinUsuario(Q.subidasListar)])
      const de = Object.fromEntries(a.rows.map((x) => [x.plantilla, x.categoria]))
      const delBuild = (base.plantillas || []).filter((p) => !u.rows.some((x) => x.nombre === p.nombre))
      const todas = [...delBuild, ...u.rows.map((x) => ({ nombre: x.nombre, archivo: x.nombre + '.html', subida: true }))].sort((x, y) => x.nombre.localeCompare(y.nombre))
      const tipoDe = Object.fromEntries(c.rows.map((k) => [k.id, k.tipo]))
      const plantillas = todas.map((p) => ({ ...p, id_catalogo: de[p.nombre] || null, tipo: tipoDe[de[p.nombre]] || null }))
      const categorias = c.rows.map((k) => ({ id: k.id, nombre: k.nombre, tipo: k.tipo, variantes: plantillas.filter((p) => p.id_catalogo === k.id).map(({ nombre, archivo }) => ({ nombre, archivo })) }))
      res.json({ ...base, total: plantillas.length, plantillas, categorias, sin_categoria: plantillas.filter((p) => !p.id_catalogo).map(({ nombre, archivo }) => ({ nombre, archivo })) })
    } catch { res.json(base) }
  })
  // Una plantilla subida desde la pantalla se entrega AISLADA (sandbox sin allow-same-origin): sus scripts corren, pero no pueden usar la sesión de Praxia.
  app.get(/^\/plantillas-html\/([a-z0-9-]{1,80})\.html$/, async (req, res, next) => {
    try {
      const f = (await sinUsuario(Q.subidaHtml, [req.params[0]])).rows[0]
      if (!f) return next()
      res.set(CABECERAS_AISLADAS).send(f.html)
    } catch { next() }
  })
  if (config.carpetaWeb && fs.existsSync(config.carpetaWeb)) {
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
