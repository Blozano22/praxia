// API de la bibliografía. Se monta en /api/bibliografia. Todo exige sesión y el permiso de crear/editar syllabus;
// la lectura de lo ajeno la decide la política de filas de la base (proyectos.ver_todos).
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { conUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { exigirPermiso, exigirSesion } from '../seguridad.js'
import { extraerEntradas, parseEntrada } from './entrada.js'
import express from 'express'
import { correrTrabajo, leerArchivoSubido } from './orquestador.js'
import { aHtml, asignarLetras, citaEnTexto, listaDeReferencias, referencia } from './apa.js'

export const rutasBibliografia = Router()
rutasBibliografia.use(exigirSesion)

const Id = z.string().uuid()
// Marca (en estado_detalle) de una referencia que la persona decidió omitir porque no se puede descargar. Sin cambios de esquema.
export const MARCA_OMITIDA = 'Omitida a mano: no se pudo descargar'
const MAX_ENTRADAS = 300
// Cupo por persona (tras iniciar sesión); sin sesión, por dirección IP. Así varios gestores en la misma red no se gastan el cupo entre sí.
const porPersona = (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip))
const limiteCrear = rateLimit({ windowMs: 60 * 1000, limit: 6, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })
const limiteLeer = rateLimit({ windowMs: 60 * 1000, limit: 240, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })

const validar = (esquema, origen) => (req, res, next) => {
  const r = esquema.safeParse(req[origen])
  if (!r.success) return res.status(400).json({ error: 'Datos no válidos' })
  req[origen + 'Ok'] = r.data
  next()
}
const conAutores = (fuentes, autores) => fuentes.map((f) => ({ ...f, autores: autores.filter((a) => a.fuente_id === f.id).map(({ apellido, nombres, institucional }) => ({ apellido, nombres, institucional })) }))

// El texto del syllabus llega de tres formas: texto pegado, lista de referencias o un Google Doc (se baja como texto plano
// desde docs.google.com por el ID; la dirección del usuario nunca se usa tal cual).
async function textoDeGoogleDoc(url) {
  const id = url.match(/\/document\/d\/([A-Za-z0-9_-]+)/)[1]
  const r = await fetch('https://docs.google.com/document/d/' + id + '/export?format=txt', { redirect: 'follow', signal: AbortSignal.timeout(20000) })
  if (!r.ok || !/text\/plain/i.test(r.headers.get('content-type') || '')) throw Object.assign(new Error('No se pudo leer el documento. Revisa que permita la lectura a cualquier persona con el enlace.'), { estado: 422 })
  const t = await r.text()
  if (t.length > 2 * 1024 * 1024) throw Object.assign(new Error('El documento es demasiado grande'), { estado: 413 })
  return t
}

// Nombre del documento de Google (el título de la pestaña): sirve de nombre del syllabus. Solo se consulta docs.google.com por el ID.
const entidades = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }
async function nombreDeGoogleDoc(url) {
  const id = url.match(/\/document\/d\/([A-Za-z0-9_-]+)/)[1]
  const r = await fetch('https://docs.google.com/document/d/' + id + '/edit', { redirect: 'follow', signal: AbortSignal.timeout(15000) })
  if (!r.ok) return ''
  const html = (await r.text()).slice(0, 200000)
  const m = /<title>([^<]{1,400})<\/title>/i.exec(html)
  if (!m) return ''
  return m[1].replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (x) => entidades[x]).replace(/\s*[-–]\s*Documentos de Google\s*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 250)
}
rutasBibliografia.get('/documento', limiteLeer, validar(z.object({ url: z.string().max(500).regex(/^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]{10,100}(?:[/?#].*)?$/) }).strict(), 'query'), async (req, res, next) => {
  try { res.json({ nombre: await nombreDeGoogleDoc(req.queryOk.url) }) } catch (e) { if (e.name === 'TimeoutError') return res.json({ nombre: '' }); next(e) }
})

const Crear = z.object({
  proyectoId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  texto: z.string().max(500000).optional(),
  entradas: z.array(z.string().min(3).max(2000)).max(MAX_ENTRADAS).optional(),
  syllabusUrl: z.string().max(500).regex(/^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]{10,100}(?:[/?#].*)?$/).optional()
}).strict().refine((d) => [d.texto, d.entradas, d.syllabusUrl].filter((x) => x !== undefined).length === 1, 'Envía solo una fuente: texto, entradas o syllabusUrl')

rutasBibliografia.post('/trabajos', exigirPermiso('proyectos.crear'), limiteCrear, validar(Crear, 'body'), async (req, res, next) => {
  try {
    const d = req.bodyOk
    let entradas
    if (d.entradas) entradas = d.entradas.map(parseEntrada)
    else entradas = extraerEntradas(d.texto !== undefined ? d.texto : await textoDeGoogleDoc(d.syllabusUrl))
    entradas = entradas.slice(0, MAX_ENTRADAS)
    if (!entradas.length) return res.status(422).json({ error: 'No encontré referencias en el texto. Revisa que el syllabus tenga una sección de bibliografía.' })
    const uid = req.usuario.id
    const id = await conUsuario(req.usuario, async (cx) => {
      const t = (await cx.query(Q.bibTrabajoCrear, [uid, d.proyectoId || null, entradas.length])).rows[0].id
      for (const [i, e] of entradas.entries()) await cx.query(Q.bibFuenteInsertar, [t, uid, i + 1, e.entrada_cruda, e.url || null, e.doi || null, e.unidad || null, e.categoria || null])
      return t
    })
    // El trabajo corre en segundo plano: la persona consulta el avance con GET /trabajos/:id.
    correrTrabajo(req.usuario, id).catch((e) => console.error('[bibliografia]', e && e.message))
    res.status(202).json({ id, total: entradas.length })
  } catch (e) {
    if (e.estado) return res.status(e.estado).json({ error: e.message })
    if (e.name === 'TimeoutError') return res.status(504).json({ error: 'Google Docs tardó demasiado en responder' })
    next(e)
  }
})

// Todas las lecturas con su responsable y el syllabus al que quedaron vinculadas (solo quien puede ver el trabajo de todos).
rutasBibliografia.get('/resumen', exigirPermiso('proyectos.ver_todos'), limiteLeer, async (req, res, next) => {
  try {
    const r = await conUsuario(req.usuario, (cx) => cx.query(Q.bibResumenTodos))
    res.json(r.rows)
  } catch (e) { next(e) }
})

rutasBibliografia.get('/trabajos', limiteLeer, validar(z.object({ proyectoId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional() }).strict(), 'query'), async (req, res, next) => {
  try {
    const r = await conUsuario(req.usuario, (cx) => cx.query(Q.bibTrabajosListar, [req.usuario.id, req.queryOk.proyectoId || null]))
    res.json(r.rows)
  } catch (e) { next(e) }
})

// Estado y fuentes del trabajo, con autores y documentos de cada una.
rutasBibliografia.get('/trabajos/:id', limiteLeer, validar(z.object({ id: Id }), 'params'), async (req, res, next) => {
  try {
    const { id } = req.paramsOk
    const salida = await conUsuario(req.usuario, async (cx) => {
      const t = (await cx.query(Q.bibTrabajoObtener, [id])).rows[0]
      if (!t) return null
      const fuentes = (await cx.query(Q.bibFuentesDelTrabajo, [id])).rows
      const autores = (await cx.query(Q.bibAutoresDelTrabajo, [id])).rows
      const lista = conAutores(fuentes, autores)
      for (const f of lista) f.documentos = (await cx.query(Q.bibDocumentosDeFuente, [f.id])).rows
      return { ...t, fuentes: lista }
    })
    if (!salida) return res.status(404).json({ error: 'No encontrado' })
    res.json(salida)
  } catch (e) { next(e) }
})

// La bibliografía lista para pegar: ordenada alfabéticamente, con la cita en el texto de cada fuente.
rutasBibliografia.get('/trabajos/:id/referencias', limiteLeer, validar(z.object({ id: Id }), 'params'), async (req, res, next) => {
  try {
    const { id } = req.paramsOk
    const fuentes = await conUsuario(req.usuario, async (cx) => conAutores((await cx.query(Q.bibFuentesDelTrabajo, [id])).rows, (await cx.query(Q.bibAutoresDelTrabajo, [id])).rows))
    if (!fuentes.length) return res.status(404).json({ error: 'No encontrado' })
    const lista = listaDeReferencias(fuentes)
    res.json({ norma: 'APA 7.ª edición', total: lista.length, referencias: lista.map((x) => ({ ...x, html: aHtml(x.referencia) })), texto: lista.map((x) => x.referencia.replace(/\*/g, '')).join('\n\n') })
  } catch (e) { next(e) }
})

// Búsqueda de texto completo en todo lo leído; cada resultado trae la cita con el número de página.
rutasBibliografia.get('/trabajos/:id/buscar', limiteLeer, validar(z.object({ id: Id }), 'params'), validar(z.object({ q: z.string().min(2).max(200) }).strict(), 'query'), async (req, res, next) => {
  try {
    const r = await conUsuario(req.usuario, (cx) => cx.query(Q.bibBuscar, [req.paramsOk.id, req.queryOk.q]))
    res.json(r.rows.map((x) => ({ fuenteId: x.fuente_id, documentoId: x.documento_id, formato: x.formato, pagina: x.numero, fragmento: x.fragmento, relevancia: x.relevancia, cita: x.cita_apa ? x.cita_apa.replace(/\)$/, ', ' + (x.formato === 'pdf' ? 'p. ' : 'bloque ') + x.numero + ')') : null, referencia: x.referencia_apa })))
  } catch (e) { next(e) }
})

// Texto completo de un documento, por rango de páginas.
rutasBibliografia.get('/documentos/:id/paginas', limiteLeer, validar(z.object({ id: Id }), 'params'),
  validar(z.object({ desde: z.coerce.number().int().min(1).default(1), hasta: z.coerce.number().int().min(1).default(20) }).strict(), 'query'), async (req, res, next) => {
    try {
      const { desde, hasta } = req.queryOk
      const r = await conUsuario(req.usuario, (cx) => cx.query(Q.bibPaginasDeDocumento, [req.paramsOk.id, desde, Math.min(hasta, desde + 99)]))
      res.json(r.rows)
    } catch (e) { next(e) }
  })

// Paquete para el flujo de n8n: toda la bibliografía ya leída (metadatos, cita APA 7 y texto por página). Solo con la
// bibliografía completa (todas las fuentes leídas). Cada fuente lleva un ID estable: U1-B1 = unidad 1, básica, la primera.
rutasBibliografia.get('/trabajos/:id/paquete', limiteLeer, validar(z.object({ id: Id }), 'params'),
  validar(z.object({ maxPaginas: z.coerce.number().int().min(1).max(400).default(150), maxCaracteres: z.coerce.number().int().min(200).max(6000).default(2500), unidad: z.coerce.number().int().min(0).max(99).optional() }).strict(), 'query'), async (req, res, next) => {
    try {
      const r = await armarPaquete(req.usuario, req.paramsOk.id, req.queryOk)
      res.status(r.codigo).json(r.cuerpo)
    } catch (e) { next(e) }
  })

// Arma el paquete de una lectura de bibliografía para el flujo de n8n. Devuelve { codigo, cuerpo } (200, 404 o 409).
// Lo usan la ruta de arriba y el servidor al lanzar la generación de guiones.
export async function armarPaquete(usuario, id, { maxPaginas = 150, maxCaracteres = 2500, unidad } = {}) {
  {
    {
      const r = await conUsuario(usuario, async (cx) => {
        const t = (await cx.query(Q.bibTrabajoObtener, [id])).rows[0]
        if (!t) return null
        const fuentes = conAutores((await cx.query(Q.bibFuentesDelTrabajo, [id])).rows, (await cx.query(Q.bibAutoresDelTrabajo, [id])).rows)
        const salida = []
        const contador = {}
        for (const f of fuentes) {
          const cat = f.categoria === 'complementaria' ? 'C' : 'B'
          const clave = (f.unidad || 0) + '-' + cat
          contador[clave] = (contador[clave] || 0) + 1
          const paginas = f.estado === 'resuelta' ? (await cx.query(Q.bibPaginasDeFuente, [f.id, maxPaginas, maxCaracteres])).rows : []
          salida.push({ id: 'U' + (f.unidad || 0) + '-' + cat + contador[clave], fuenteId: f.id, unidad: f.unidad, categoria: f.categoria || 'basica', orden: f.orden,
            entrada_syllabus: f.entrada_cruda, referencia_apa: f.referencia_apa, cita_apa: f.cita_apa, titulo: f.titulo, autores: f.autores, anio: f.anio, tipo: f.tipo,
            doi: f.doi, url: f.url_final || f.url, estado: f.estado, manual: f.estado_detalle === MARCA_OMITIDA, paginas })
        }
        return { trabajo: t, fuentes: salida }
      })
      if (!r) return { codigo: 404, cuerpo: { error: 'No encontrado' } }
      // Se omite (no bloquea ni viaja a n8n) toda referencia sin leer que la persona marcó como imposible de descargar
      // (sitios de pago o con inicio de sesión) o que no trae enlace ni DOI y por tanto no se puede conseguir.
      const omitida = (f) => f.estado !== 'resuelta' && (f.manual || (!f.url && !f.doi))
      const omitidas = r.fuentes.filter(omitida).map((f) => ({ id: f.id, unidad: f.unidad, categoria: f.categoria, referencia: f.referencia_apa || f.entrada_syllabus }))
      // Con ?unidad=N solo viajan las fuentes de esa unidad (y las que no declaran unidad): los guiones se escriben por unidad.
      const fuentes = r.fuentes.filter((f) => !omitida(f) && (unidad === undefined || !f.unidad || f.unidad === unidad))
      const faltan = fuentes.filter((f) => f.estado !== 'resuelta').length
      if (r.trabajo.estado !== 'listo' || faltan) return { codigo: 409, cuerpo: { error: 'La bibliografía aún no está completa: faltan ' + faltan + ' fuente(s) por leer.' } }
      return { codigo: 200, cuerpo: { norma: 'APA 7.ª edición', total: fuentes.length, omitidas, fuentes } }
    }
  }
}

// Omite (o vuelve a incluir) a mano una referencia que no se puede descargar. Solo las que siguen sin leer.
rutasBibliografia.put('/fuentes/:id/omitir', exigirPermiso('proyectos.crear'), limiteLeer, validar(z.object({ id: Id }), 'params'),
  validar(z.object({ omitir: z.boolean() }).strict(), 'body'), async (req, res, next) => {
    try {
      const { id } = req.paramsOk
      const { omitir } = req.bodyOk
      const mia = await conUsuario(req.usuario, (cx) => cx.query(Q.bibFuenteMia, [id, req.usuario.id]))
      const f = mia.rows[0]
      if (!f) return res.status(404).json({ error: 'No encontrado' })
      if (f.estado === 'resuelta') return res.status(409).json({ error: 'Esa referencia ya está leída: no hace falta omitirla.' })
      await conUsuario(req.usuario, (cx) => cx.query(Q.bibFuenteEstado, [id, req.usuario.id, 'sin_acceso', omitir ? MARCA_OMITIDA : 'Pendiente de cargar a mano']))
      res.json({ ok: true, omitida: omitir })
    } catch (e) { next(e) }
  })

// Sube el documento de una fuente (PDF, Word o página guardada). El cuerpo es el archivo; el nombre va en el encabezado x-nombre.
const limiteSubir = rateLimit({ windowMs: 60 * 1000, limit: 20, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })
const cuerpoArchivo = express.raw({ type: () => true, limit: '40mb' })
rutasBibliografia.post('/fuentes/:id/archivo', exigirPermiso('proyectos.crear'), limiteSubir, validar(z.object({ id: Id }), 'params'), cuerpoArchivo, async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Sube un archivo' })
    const mia = await conUsuario(req.usuario, (cx) => cx.query(Q.bibFuenteMia, [req.paramsOk.id, req.usuario.id]))
    if (!mia.rows[0]) return res.status(404).json({ error: 'No encontrado' })
    let nombre = 'documento'
    try { nombre = decodeURIComponent(String(req.headers['x-nombre'] || 'documento')).slice(0, 200) } catch { /* nombre sin codificar */ }
    res.json(await leerArchivoSubido(req.usuario, req.paramsOk.id, req.body, nombre))
  } catch (e) {
    if (e.estado) return res.status(e.estado).json({ error: e.message })
    next(e)
  }
})

// Cita en el texto (y referencia) de una fuente, opcionalmente con página: /fuentes/:id/cita?pagina=12
rutasBibliografia.get('/fuentes/:id/cita', limiteLeer, validar(z.object({ id: Id }), 'params'), validar(z.object({ pagina: z.string().regex(/^\d{1,5}(?:[-–]\d{1,5})?$/).optional() }).strict(), 'query'), async (req, res, next) => {
  try {
    const f = await conUsuario(req.usuario, async (cx) => {
      const fuente = (await cx.query(Q.bibFuenteObtener, [req.paramsOk.id])).rows[0]
      if (!fuente) return null
      const todas = conAutores((await cx.query(Q.bibFuentesDelTrabajo, [fuente.trabajo_id])).rows, (await cx.query(Q.bibAutoresDelTrabajo, [fuente.trabajo_id])).rows)
      asignarLetras(todas)
      return todas.find((x) => x.id === fuente.id)
    })
    if (!f) return res.status(404).json({ error: 'No encontrado' })
    res.json({ cita: citaEnTexto(f, req.queryOk.pagina), referencia: referencia(f) })
  } catch (e) { next(e) }
})
