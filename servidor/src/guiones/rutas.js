// Generación de guiones con n8n, hecha por el SERVIDOR y no por el navegador.
// Antes la página llamaba a n8n y esperaba varios minutos: si se cerraba la pestaña o vencía la sesión, la respuesta se perdía
// y al volver se podía lanzar otra vez la misma unidad. Ahora cada generación es un «trabajo» con identificador (tabla guiones_trabajos):
//   POST   /api/guiones/trabajos            lanza el trabajo (uno solo en curso por unidad) y responde enseguida con su id
//   GET    /api/guiones/trabajos            los trabajos de la persona: en curso, listos o con error
//   GET    /api/guiones/trabajos/:id/respuesta   la respuesta de n8n de un trabajo terminado
//   DELETE /api/guiones/trabajos/:id        lo quita (la página lo hace al guardar los guiones en el syllabus)
// El identificador viaja también a n8n como «trabajo_id», por si el flujo quiere registrarlo.
import http from 'node:http'
import https from 'node:https'
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../config.js'
import { conUsuario, sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { exigirPermiso, exigirSesion } from '../seguridad.js'
import { armarPaquete } from '../bibliografia/rutas.js'
import { registrarOrigen } from '../pipeline/eventos.js'

export const rutasGuiones = Router()
rutasGuiones.use(exigirSesion)

const RE_DOC = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+/
const ANTERIOR = 'https://n8n.americana.edu.co/webhook/unidad-a-guiones' // flujo antiguo: ya no está activo
const MAX_RESPUESTA = 40 * 1024 * 1024

// Tope de lo que se ENVÍA a n8n. n8n rechaza paquetes de más de 16 MiB (por defecto) con un error poco claro; mejor avisar antes y con claridad.
const MB = 1024 * 1024
export const tamanoMb = (cuerpo) => Buffer.byteLength(JSON.stringify(cuerpo)) / MB
export const paqueteGrande = (cuerpo) => {
  const mb = tamanoMb(cuerpo)
  return mb > config.n8nPaqueteMaxMb ? 'El paquete que habría que enviar a n8n pesa ' + mb.toFixed(1) + ' MB y el límite es ' + config.n8nPaqueteMaxMb + ' MB. Reduzca las fuentes de la bibliografía o el contenido y vuelva a intentarlo.' : ''
}
// Cupo por persona (tras iniciar sesión); sin sesión, por dirección IP. Así varios gestores en la misma red no se gastan el cupo entre sí.
const porPersona = (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip))
const limiteCrear = rateLimit({ windowMs: 60 * 1000, limit: 12, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })
const limiteLeer = rateLimit({ windowMs: 60 * 1000, limit: 240, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })

const validar = (esquema, origen) => (req, res, next) => {
  const r = esquema.safeParse(req[origen])
  if (!r.success) return res.status(400).json({ error: 'Datos no válidos' })
  req[origen + 'Ok'] = r.data
  next()
}

// Dirección del flujo: la que guardó el administrador en «Conexión n8n» o, si no hay, la de siempre.
export async function urlGuiones() {
  const f = (await sinUsuario(Q.configLeer, [['n8n.guiones']])).rows[0]
  const v = f && f.valor
  return !v || v === ANTERIOR ? config.n8nGuionesDefecto : v
}

// POST al flujo y espera su respuesta completa. Sin el tope de 5 minutos del fetch del navegador.
export function publicar(urlTexto, cuerpo, minutos = config.n8nMinutosMaximo) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(urlTexto) } catch { return reject(new Error('La dirección de n8n no es válida.')) }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return reject(new Error('La dirección de n8n debe empezar por https://.'))
    const datos = Buffer.from(JSON.stringify(cuerpo))
    if (datos.length > config.n8nPaqueteMaxMb * MB) return reject(new Error('El paquete para n8n pesa ' + (datos.length / MB).toFixed(1) + ' MB y el límite es ' + config.n8nPaqueteMaxMb + ' MB.'))
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(u, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'content-length': datos.length } }, (res) => {
      const partes = []
      let total = 0
      res.on('data', (c) => {
        total += c.length
        if (total > MAX_RESPUESTA) return req.destroy(new Error('La respuesta de n8n es demasiado grande.'))
        partes.push(c)
      })
      res.on('end', () => { clearTimeout(tope); resolve({ estado: res.statusCode, texto: Buffer.concat(partes).toString('utf8') }) })
      res.on('error', (e) => { clearTimeout(tope); reject(e) })
    })
    const tope = setTimeout(() => req.destroy(new Error('n8n tardó más de ' + minutos + ' minutos en responder.')), minutos * 60 * 1000)
    req.on('error', (e) => { clearTimeout(tope); reject(e) })
    req.end(datos)
  })
}

const resumenError = (estado, texto) => {
  let detalle = ''
  try { const j = JSON.parse(texto); detalle = j.message || j.error || j.mensaje || '' } catch { detalle = String(texto || '').replace(/\s+/g, ' ').slice(0, 200) }
  return ('n8n respondió con HTTP ' + estado + (detalle ? ': ' + detalle : '')).slice(0, 580)
}

// Corre en segundo plano: no depende de la sesión ni de la página. Siempre deja el trabajo en «listo» o «error».
async function correr(id, url, cuerpo) {
  try {
    const r = await publicar(url, cuerpo)
    if (r.estado >= 200 && r.estado < 300) await sinUsuario(Q.guionTrabajoListo, [id, r.texto])
    else await sinUsuario(Q.guionTrabajoFallo, [id, resumenError(r.estado, r.texto)])
  } catch (e) {
    const causa = (e && (e.code || e.message)) || 'error'
    await sinUsuario(Q.guionTrabajoFallo, [id, ('No se pudo completar con n8n: ' + causa).slice(0, 580)]).catch((x) => console.error('[guiones]', x && x.message))
  }
}

// Lanza un trabajo ya validado (lo usan la ruta y las pruebas). Devuelve { id, creado } o { ya: true, id, creado } si había uno en curso.
export async function lanzarTrabajo({ usuarioId, proyecto, unidad, cuerpo, url }) {
  const nuevo = (await sinUsuario(Q.guionTrabajoCrear, [usuarioId, proyecto, unidad])).rows[0]
  if (!nuevo) {
    const previo = (await sinUsuario(Q.guionTrabajoEnCurso, [usuarioId, proyecto, unidad])).rows[0]
    return { ya: true, id: previo && previo.id, creado: previo && previo.creado }
  }
  setImmediate(() => { correr(nuevo.id, url, { trabajo_id: nuevo.id, ...cuerpo }) })
  return { id: nuevo.id, creado: nuevo.creado }
}

// Al arrancar: lo que seguía «en curso» ya no tiene quien espere su respuesta.
export const recuperarTrabajos = () => sinUsuario(Q.guionTrabajosCaducar, ['El servidor se reinició mientras se generaban los guiones. Vuelva a intentarlo.', 0])

const Nuevo = z.object({
  proyecto: z.string().min(1).max(80),
  unidad: z.number().int().min(0).max(99),
  unidadUrl: z.string().max(500).regex(RE_DOC),
  syllabusUrl: z.string().max(500).regex(RE_DOC).optional(),
  bibliografiaId: z.string().uuid()
}).strict()

rutasGuiones.post('/trabajos', exigirPermiso('proyectos.crear'), limiteCrear, validar(Nuevo, 'body'), async (req, res, next) => {
  try {
    const { proyecto, unidad, unidadUrl, syllabusUrl, bibliografiaId } = req.bodyOk
    // Los guiones se escriben con la bibliografía ya leída de ESA unidad; sin ella no se envía nada.
    const p = await armarPaquete(req.usuario, bibliografiaId, { unidad })
    if (p.codigo === 404) return res.status(404).json({ error: 'No se encontró la bibliografía leída de este syllabus.' })
    if (p.codigo !== 200) return res.status(p.codigo).json(p.cuerpo)
    if (!p.cuerpo.fuentes || !p.cuerpo.fuentes.length) return res.status(409).json({ error: 'La bibliografía de la unidad ' + unidad + ' no tiene fuentes leídas: los guiones no se pueden respaldar.' })
    const url = await urlGuiones()
    // Carpeta del curso: viaja a n8n junto con proyecto_id para que la matriz y los avisos posteriores sepan a qué curso pertenecen (7.1a del plan).
    let carpeta = null
    try { carpeta = ((await conUsuario(req.usuario, (cx) => cx.query(Q.pipeCarpetaDeProyecto, [req.usuario.id, proyecto]))).rows[0] || {}).carpeta || null } catch (e) { console.error('[pipeline] no se pudo leer la carpeta del curso', e && e.message) }
    const cuerpoN8n = { unidad_url: unidadUrl, ...(syllabusUrl ? { syllabus_url: syllabusUrl } : {}), unidad, bibliografia: p.cuerpo, proyecto_id: proyecto, ...(carpeta ? { carpeta_raiz: carpeta } : {}) }
    const grande = paqueteGrande(cuerpoN8n)
    if (grande) return res.status(413).json({ error: grande })
    const t = await lanzarTrabajo({ usuarioId: req.usuario.id, proyecto, unidad, url, cuerpo: cuerpoN8n })
    if (t.ya) return res.status(409).json({ ya: true, id: t.id, creado: t.creado, error: 'Ya hay una generación de guiones en curso para esta unidad.' })
    // Se anota a qué persona y curso pertenece este trabajo: los avisos que n8n mande después (matrices, H5P) se atribuyen con esto.
    try {
      await registrarOrigen({ trabajoId: t.id, propietarioId: req.usuario.id, proyectoId: proyecto, carpeta, etapa: 'guiones', unidad })
    } catch (e) { console.error('[pipeline] no se pudo anotar el origen del trabajo', e && e.message) } // no debe impedir la generación
    res.status(202).json({ id: t.id, estado: 'en_curso', creado: t.creado })
  } catch (e) { next(e) }
})

rutasGuiones.get('/trabajos', exigirPermiso('proyectos.ver_propios'), limiteLeer, async (req, res, next) => {
  try {
    await sinUsuario(Q.guionTrabajosCaducar, ['n8n no respondió a tiempo. Vuelva a intentarlo.', config.n8nMinutosMaximo + 5])
    await sinUsuario(Q.guionTrabajosLimpiar, [])
    res.json((await sinUsuario(Q.guionTrabajosListar, [req.usuario.id])).rows)
  } catch (e) { next(e) }
})

rutasGuiones.get('/trabajos/:id/respuesta', exigirPermiso('proyectos.ver_propios'), limiteLeer, validar(z.object({ id: z.string().uuid() }), 'params'), async (req, res, next) => {
  try {
    const f = (await sinUsuario(Q.guionTrabajoRespuesta, [req.paramsOk.id, req.usuario.id])).rows[0]
    if (!f) return res.status(404).json({ error: 'No encontrado' })
    res.json({ respuesta: f.respuesta })
  } catch (e) { next(e) }
})

rutasGuiones.delete('/trabajos/:id', exigirPermiso('proyectos.ver_propios'), limiteLeer, validar(z.object({ id: z.string().uuid() }), 'params'), async (req, res, next) => {
  try {
    const f = (await sinUsuario(Q.guionTrabajoBorrar, [req.paramsOk.id, req.usuario.id])).rows[0]
    if (!f) return res.status(404).json({ error: 'No encontrado' })
    res.json({ ok: true })
  } catch (e) { next(e) }
})
