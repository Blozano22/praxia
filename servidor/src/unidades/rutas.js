// Creación de las unidades con n8n (un documento de Google por unidad), hecha por el SERVIDOR y no por el navegador.
// Igual que los guiones (src/guiones/rutas.js): cada creación es un «trabajo» con identificador (tabla unidades_trabajos) que sigue
// aunque se cierre la página o venza la sesión, no se puede lanzar dos veces para el mismo syllabus y cuyo resultado espera a la persona.
//   POST   /api/unidades/trabajos            lanza el trabajo y responde enseguida con su id
//   GET    /api/unidades/trabajos            los trabajos de la persona: en curso, listos o con error
//   GET    /api/unidades/trabajos/:id/respuesta   la respuesta de n8n de un trabajo terminado
//   DELETE /api/unidades/trabajos/:id        lo quita (la página lo hace al guardar el resultado en el syllabus)
// El identificador viaja también a n8n como «trabajo_id».
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../config.js'
import { sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { exigirPermiso, exigirSesion } from '../seguridad.js'
import { armarPaquete, idDoc } from '../bibliografia/rutas.js'
import { publicar } from '../guiones/rutas.js'

export const rutasUnidades = Router()
rutasUnidades.use(exigirSesion)

const RE_DOC = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]{10,100}/
const RE_CARPETA = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+/
// Direcciones de versiones anteriores del flujo (ya no están activas en n8n): si quedaron guardadas, se reemplazan.
const ANTERIORES = ['https://n8n.americana.edu.co/webhook/syllabus-a-plantilla', 'https://n8n.americana.edu.co/webhook/syllabus-a-plantilla-bibliografia']
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
export async function urlUnidades() {
  const f = (await sinUsuario(Q.configLeer, [['n8n.syllabus']])).rows[0]
  const v = f && f.valor
  return !v || ANTERIORES.includes(v) ? config.n8nUnidadesDefecto : v
}

// Corre en segundo plano: no depende de la sesión ni de la página. Siempre deja el trabajo en «listo» o «error».
async function correr(id, url, cuerpo) {
  try {
    const r = await publicar(url, cuerpo)
    if (r.estado >= 200 && r.estado < 300) await sinUsuario(Q.unidadTrabajoListo, [id, r.texto])
    else {
      let detalle = ''
      try { const j = JSON.parse(r.texto); detalle = j.message || j.error || j.mensaje || '' } catch { detalle = String(r.texto || '').replace(/\s+/g, ' ').slice(0, 200) }
      await sinUsuario(Q.unidadTrabajoFallo, [id, ('n8n respondió con HTTP ' + r.estado + (detalle ? ': ' + detalle : '')).slice(0, 580)])
    }
  } catch (e) {
    const causa = (e && (e.code || e.message)) || 'error'
    await sinUsuario(Q.unidadTrabajoFallo, [id, ('No se pudo completar con n8n: ' + causa).slice(0, 580)]).catch((x) => console.error('[unidades]', x && x.message))
  }
}

// Lanza un trabajo ya validado (lo usan la ruta y las pruebas). Devuelve { id, creado } o { ya: true, id, creado } si había uno en curso.
export async function lanzarUnidades({ usuarioId, syllabusUrl, carpetaUrl, curso = '', proyecto = null, bibliografiaId = null, cuerpo, url }) {
  const doc = idDoc(syllabusUrl)
  const nuevo = (await sinUsuario(Q.unidadTrabajoCrear, [usuarioId, doc, syllabusUrl, carpetaUrl, curso, proyecto, bibliografiaId])).rows[0]
  if (!nuevo) {
    const previo = (await sinUsuario(Q.unidadTrabajoEnCurso, [usuarioId, doc])).rows[0]
    return { ya: true, id: previo && previo.id, creado: previo && previo.creado }
  }
  setImmediate(() => { correr(nuevo.id, url, { trabajo_id: nuevo.id, ...cuerpo }) })
  return { id: nuevo.id, creado: nuevo.creado }
}

// Al arrancar: lo que seguía «en curso» ya no tiene quien espere su respuesta.
export const recuperarUnidades = () => sinUsuario(Q.unidadTrabajosCaducar, ['El servidor se reinició mientras se creaban las unidades. Vuelva a intentarlo.', 0])

const Nuevo = z.object({
  syllabusUrl: z.string().max(500).regex(RE_DOC),
  carpetaUrl: z.string().max(500).regex(RE_CARPETA),
  bibliografiaId: z.string().uuid(),
  curso: z.string().max(300).optional(),
  proyecto: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional() // si se vuelven a generar los documentos de un syllabus que ya existe
}).strict()

rutasUnidades.post('/trabajos', exigirPermiso('proyectos.crear'), limiteCrear, validar(Nuevo, 'body'), async (req, res, next) => {
  try {
    const { syllabusUrl, carpetaUrl, bibliografiaId, curso, proyecto } = req.bodyOk
    // n8n trabaja con la bibliografía ya leída y completa, no con lo que el modelo conozca.
    const p = await armarPaquete(req.usuario, bibliografiaId)
    if (p.codigo === 404) return res.status(404).json({ error: 'No se encontró la bibliografía leída de este syllabus. Vuelva a leerla.' })
    if (p.codigo !== 200) return res.status(p.codigo).json(p.cuerpo)
    const url = await urlUnidades()
    const t = await lanzarUnidades({
      usuarioId: req.usuario.id, syllabusUrl, carpetaUrl, curso: curso || '', proyecto: proyecto || null, bibliografiaId, url,
      cuerpo: { syllabus_url: syllabusUrl, carpeta_destino_url: carpetaUrl, bibliografia: p.cuerpo }
    })
    if (t.ya) return res.status(409).json({ ya: true, id: t.id, creado: t.creado, error: 'Ya se están creando las unidades de este syllabus.' })
    res.status(202).json({ id: t.id, estado: 'en_curso', creado: t.creado })
  } catch (e) { next(e) }
})

rutasUnidades.get('/trabajos', exigirPermiso('proyectos.ver_propios'), limiteLeer, async (req, res, next) => {
  try {
    await sinUsuario(Q.unidadTrabajosCaducar, ['n8n no respondió a tiempo. Vuelva a intentarlo.', config.n8nMinutosMaximo + 5])
    await sinUsuario(Q.unidadTrabajosLimpiar, [])
    res.json((await sinUsuario(Q.unidadTrabajosListar, [req.usuario.id])).rows)
  } catch (e) { next(e) }
})

rutasUnidades.get('/trabajos/:id/respuesta', exigirPermiso('proyectos.ver_propios'), limiteLeer, validar(z.object({ id: z.string().uuid() }), 'params'), async (req, res, next) => {
  try {
    const f = (await sinUsuario(Q.unidadTrabajoRespuesta, [req.paramsOk.id, req.usuario.id])).rows[0]
    if (!f) return res.status(404).json({ error: 'No encontrado' })
    res.json({ respuesta: f.respuesta })
  } catch (e) { next(e) }
})

rutasUnidades.delete('/trabajos/:id', exigirPermiso('proyectos.ver_propios'), limiteLeer, validar(z.object({ id: z.string().uuid() }), 'params'), async (req, res, next) => {
  try {
    const f = (await sinUsuario(Q.unidadTrabajoBorrar, [req.paramsOk.id, req.usuario.id])).rows[0]
    if (!f) return res.status(404).json({ error: 'No encontrado' })
    res.json({ ok: true })
  } catch (e) { next(e) }
})
