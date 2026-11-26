import fs from 'node:fs'
import { trabajosEnCurso } from './trabajos-en-curso.js'
import path from 'node:path'
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { conUsuario, conTransaccion, sinUsuario } from './db.js'
import { Q } from './consultas.js'
import { config } from './config.js'
import { extraerEnlaces } from './enlaces.js'
import { armarSubida, compararEsquemas, esquemaDe, MAX_HTML, NOMBRES_RESERVADOS } from './plantillas/subidas.js'
import { crearZip, sanear } from './plantillas/zip.js'
import { cuerpoServicioH5p, EsquemaLanzarH5p, EsquemaLanzarMatrices, lanzarH5p, lanzarMatrices, lanzarPublicar, urlH5p, urlMatrices, urlPublicar } from './pipeline/lanzar.js'
import { CLAVE_PRUEBAS, pruebasEncendidas, urlPreparacion } from './pipeline/preparacion.js'
import { esUrlImagen } from './pipeline/eventos.js'
import { invalidarAsignaciones, normalizarTipo } from './pipeline/asignaciones.js'
import * as asignarDiseno from './asignar-diseno.js'
import * as correcciones from './correcciones.js'
import { bloqueoDiseno, enviarADiseno, estadoDiseno, pipelineCurso, revisarEnvio } from './diseno.js'
import { publicarAviso, tomarAvisos } from './avisos.js'
import { COOKIE, claveValida, compararClave, emitirSesion, exigirAlguno, exigirPermiso, exigirSesion, hashClave } from './seguridad.js'

export const rutas = Router()

const ip = (req) => String(req.ip || '').slice(0, 64)
const auditar = (usuarioId, accion, entidad, entidadId, req) =>
  sinUsuario(Q.auditoriaRegistrar, [usuarioId, accion, entidad || null, entidadId || null, ip(req)]).catch(() => {})

// Cualquier dato que no cumpla el formato se rechaza con 400, sin llegar a la base de datos.
const validar = (esquema, origen) => (req, res, next) => {
  const r = esquema.safeParse(req[origen])
  if (!r.success) return res.status(400).json({ error: 'Datos no válidos' })
  req[origen + 'Ok'] = r.data
  next()
}

const IdProyecto = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const IdUsuario = z.string().uuid()
const MENSAJE_CLAVE = 'La clave debe tener 10 o más caracteres, con mayúscula, minúscula y número'

// ------------------------------------------------------------------ acceso
const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.LIMITE_LOGIN || 300), skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos. Espera unos minutos.' } })

rutas.post('/auth/login', limiteLogin,
  validar(z.object({ correo: z.string().email().max(200), clave: z.string().min(1).max(100) }).strict(), 'body'),
  async (req, res, next) => {
    try {
      const { correo, clave } = req.bodyOk
      const u = (await sinUsuario(Q.usuarioParaLogin, [correo])).rows[0]
      const bloqueado = Boolean(u && u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date())
      const coincide = await compararClave(clave, u && u.clave_hash)
      if (!u || !coincide || !u.activo || bloqueado) {
        if (u && !bloqueado) await sinUsuario(Q.registrarFallo, [u.id])
        await auditar(u ? u.id : null, 'login_fallido', 'usuario', u ? u.id : null, req)
        return res.status(401).json({ error: 'Correo o clave incorrectos. Tras 10 intentos fallidos la cuenta se bloquea 5 minutos.' }) // mismo mensaje en todos los casos
      }
      await sinUsuario(Q.registrarAcceso, [u.id])
      const v = (await sinUsuario(Q.usuarioParaSesion, [u.id])).rows[0].version_token
      emitirSesion(res, u, v)
      await auditar(u.id, 'login', 'usuario', u.id, req)
      res.json({ ok: true })
    } catch (e) { next(e) }
  })

rutas.post('/auth/logout', exigirSesion, async (req, res, next) => {
  try {
    await sinUsuario(Q.cerrarSesiones, [req.usuario.id])
    res.clearCookie(COOKIE, { path: config.rutaBase })
    await auditar(req.usuario.id, 'logout', 'usuario', req.usuario.id, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

rutas.get('/auth/yo', exigirSesion, (req, res) => {
  const { id, nombre, correo, roles, permisos } = req.usuario
  res.json({ id, nombre, correo, roles, permisos: [...permisos] })
})

// ------------------------------------------------------------------ syllabus (solo los propios)
const Proyecto = z.object({
  id: IdProyecto,
  programa: z.string().max(300),
  curso: z.string().max(300),
  creado: z.number().optional(),
  _v: z.number().int().min(1).optional() // versión que la página tenía al abrir el syllabus (no se guarda dentro del syllabus)
}).passthrough()

rutas.get('/proyectos', exigirSesion, exigirPermiso('proyectos.ver_propios'), async (req, res, next) => {
  try {
    const filas = await conUsuario(req.usuario, async (c) => (await c.query(Q.proyectosListar, [req.usuario.id])).rows)
    res.json(filas.map((f) => ({ ...f.datos, _v: f.version })))
  } catch (e) { next(e) }
})

// Coordinación: avance de todos los cursos (solo cifras y de lectura; para abrir un curso hay que ser su dueño).
rutas.get('/seguimiento', exigirSesion, exigirPermiso('proyectos.ver_todos'), async (req, res, next) => {
  try {
    const filas = await conUsuario(req.usuario, async (c) => (await c.query(Q.seguimientoListar)).rows)
    res.json(filas)
  } catch (e) { next(e) }
})

// Vista global del pipeline para administración/coordinación: cifras por curso de todas las personas y avisos de n8n sin atribuir.
rutas.get('/pipeline/resumen', exigirSesion, exigirPermiso('proyectos.ver_todos'), async (req, res, next) => {
  try {
    const [cursos, problemas, conteo] = await conUsuario(req.usuario, async (c) => [(await c.query(Q.pipeResumenGlobal)).rows, (await c.query(Q.pipeAvisosProblema)).rows, (await c.query(Q.pipeAvisosConteo)).rows[0]])
    res.json({ cursos, avisosProblema: problemas, avisos24h: conteo, secretoConfigurado: Boolean(config.n8nEventosSecreto), generado: new Date().toISOString() })
  } catch (e) { next(e) }
})

rutas.get('/proyectos/:id/enlaces', exigirSesion, exigirPermiso('proyectos.ver_propios'),
  validar(z.object({ id: IdProyecto }), 'params'), async (req, res, next) => {
    try {
      const filas = await conUsuario(req.usuario, async (c) => (await c.query(Q.enlacesDelProyecto, [req.usuario.id, req.paramsOk.id])).rows)
      res.json(filas)
    } catch (e) { next(e) }
  })

// Lo que n8n avisó de la cadena guiones → matrices → H5P para ESTE curso (matrices, recursos y corridas). Solo lectura: la pantalla del curso
// lee de aquí y no de n8n; los datos llegan por POST /api/n8n/eventos.
rutas.get('/proyectos/:id/pipeline', exigirSesion, pipelineCurso('proyectos.ver_propios', false), validar(z.object({ id: IdProyecto }), 'params'), async (req, res, next) => {
  try {
    const p = [req.pipe.propietarioId, req.paramsOk.id]
    const [m, r, e, d] = await Promise.all([sinUsuario(Q.pipeLeerMatrices, p), sinUsuario(Q.pipeLeerRecursos, p), sinUsuario(Q.pipeLeerEjecuciones, p), sinUsuario(Q.pipeDesactualizados, p)])
    // Costo estimado de regenerarlos: lo guardado en cada uno; a los que no lo traen se les pone el promedio de los que sí.
    const conCosto = d.rows.filter((x) => x.costo != null).map((x) => Number(x.costo))
    const prom = conCosto.length ? conCosto.reduce((a, b) => a + b, 0) / conCosto.length : 0
    const desactualizados = { total: d.rows.length, codigos: d.rows.map((x) => x.codigo), motivos: Object.fromEntries(d.rows.map((x) => [x.codigo, x.motivo])),
      costoEstimadoUsd: Math.round((conCosto.reduce((a, b) => a + b, 0) + prom * (d.rows.length - conCosto.length)) * 10000) / 10000, sinCosto: d.rows.length - conCosto.length }
    // El plan de una corrida puede ser largo: se entrega el conteo y la lista de lo omitido con su motivo, no todos los recursos a generar.
    const ejecuciones = e.rows.map((x) => ({ ...x, plan: x.plan ? { aGenerar: (x.plan.a_generar || []).length, aGenerarClaves: (x.plan.a_generar || []).slice(0, 500).map((i) => ({ id: i.id, codigo: i.codigo || null })), omitidas: (x.plan.omitidas || []).slice(0, 500) } : null }))
    let cola = []
    try { cola = (await sinUsuario(Q.colaListar, p)).rows.map((x) => x.codigo) } catch { /* sin la tabla de la cola (migración pendiente) */ }
    const enCola = new Set(cola)
    let recursos = (await correcciones.conCorrecciones(req.pipe.propietarioId, req.paramsOk.id, r.rows)).map((x) => (x.codigo && enCola.has(x.codigo) ? { ...x, enColaRegenerar: true } : x))
    // Tokens y costos solo los ve un administrador.
    if (!req.usuario.roles.includes('admin')) {
      recursos = recursos.map(({ consumo, ...x }) => x)
      delete desactualizados.costoEstimadoUsd; delete desactualizados.sinCosto
    }
    res.json({ matrices: m.rows, recursos, colaRegenerar: cola.length, ejecuciones, desactualizados, generado: new Date().toISOString(), puedeGenerarMatrices: Boolean(await urlMatrices()), puedeGenerarH5p: Boolean(await urlH5p()), puedePublicar: Boolean(await urlPublicar()), puedePreparar: Boolean(await urlPreparacion()) })
  } catch (err) { next(err) }
})

// Cambia la imagen (URL https) de un recurso del curso; solo la persona dueña del curso. Una cadena vacía la quita.
rutas.put('/proyectos/:id/pipeline/recursos/imagen', exigirSesion, pipelineCurso('proyectos.crear'), validar(z.object({ id: IdProyecto }), 'params'),
  validar(z.object({ recursoId: z.string().min(1).max(100), imagenUrl: z.string().max(500).refine((v) => v === '' || esUrlImagen(v), 'La imagen debe ser un enlace https sin espacios ni comillas.'), parte: z.enum(['recurso', 'actividad']).optional() }), 'body'),
  async (req, res, next) => {
    try {
      const { recursoId, imagenUrl, parte } = req.bodyOk
      const actividad = parte === 'actividad'
      const r = await sinUsuario(actividad ? Q.pipeActividadImagen : Q.pipeRecursoImagen, [req.pipe.propietarioId, req.paramsOk.id, recursoId, imagenUrl || null])
      if (!r.rows.length) return res.status(404).json({ error: actividad ? 'Ese recurso no tiene actividad en el curso.' : 'No se encontró ese recurso en el curso.' })
      res.json(r.rows[0])
    } catch (err) { next(err) }
  })

// El contenido (JSON) con el que el flujo de H5P generó un recurso, para editarlo en pantalla. Solo el de esa persona y ese curso.
rutas.get('/proyectos/:id/pipeline/recursos/:recurso/contenido', exigirSesion, pipelineCurso('proyectos.ver_propios', false), validar(z.object({ id: IdProyecto, recurso: z.string().min(1).max(100) }), 'params'), async (req, res, next) => {
  try {
    const f = (await sinUsuario(Q.pipeLeerContenido, [req.pipe.propietarioId, req.paramsOk.id, req.paramsOk.recurso])).rows[0]
    if (!f) return res.status(404).json({ error: 'No hay un recurso con ese identificador en este curso.' })
    if (!f.contenido) return res.status(404).json({ error: 'Este recurso no tiene contenido guardado todavía.' })
    if (!req.usuario.roles.includes('admin')) { delete f.consumo; delete f.costoEstimadoUsd }
    res.json(f)
  } catch (err) { next(err) }
})

const limiteLanzar = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.LIMITE_LANZAR_PIPELINE || 12), keyGenerator: (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip)), standardHeaders: true, legacyHeaders: false })
// Revisar y aprobar recursos se hace en tandas (decenas seguidas): su tope por minuto es mayor que el de lanzar generaciones.
const limiteEditarRecurso = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.LIMITE_EDITAR_RECURSO || 90), keyGenerator: (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip)), standardHeaders: true, legacyHeaders: false })
// Edición del contenido de un recurso desde la pantalla del curso. Solo se cambian TEXTOS: la estructura (campos y tipos) debe ser la misma que ya tenía.
const MAX_CONTENIDO_EDITADO = 400 * 1024
const EsquemaContenidoEditado = z.object({ contenido: z.record(z.string(), z.any()), parte: z.enum(['recurso', 'actividad', 'bibliografia']).default('recurso') })
rutas.put('/proyectos/:id/pipeline/recursos/:recurso/contenido', exigirSesion, pipelineCurso('proyectos.crear'), limiteEditarRecurso,
  validar(z.object({ id: IdProyecto, recurso: z.string().min(1).max(100) }), 'params'), validar(EsquemaContenidoEditado, 'body'), async (req, res, next) => {
    try {
      const nuevo = req.bodyOk.contenido
      if (JSON.stringify(nuevo).length > MAX_CONTENIDO_EDITADO) return res.status(413).json({ error: 'El contenido pesa más de ' + MAX_CONTENIDO_EDITADO / 1024 + ' KB.' })
      const f = (await sinUsuario(Q.pipeLeerContenido, [req.pipe.propietarioId, req.paramsOk.id, req.paramsOk.recurso])).rows[0]
      const parte = req.bodyOk.parte
      const actual = parte === 'recurso' ? f?.contenido : f?.[parte]?.contenido
      if (!f || !actual) return res.status(404).json({ error: parte === 'recurso' ? 'Este recurso no tiene contenido guardado para editar.' : 'Este recurso no tiene esa parte guardada para editar.' })
      const cmp = compararEsquemas(esquemaDe(actual), esquemaDe(nuevo))
      if (!cmp.coincide) return res.status(400).json({ error: 'Solo se pueden editar textos: el contenido cambió de estructura (' + [...cmp.faltan.map((x) => 'falta ' + x.split(':')[0]), ...cmp.sobran.map((x) => 'sobra ' + x.split(':')[0])].slice(0, 5).join(', ') + ').' })
      const r = parte === 'recurso'
        ? await sinUsuario(Q.pipeContenidoGuardar, [req.pipe.propietarioId, req.paramsOk.id, req.paramsOk.recurso, JSON.stringify(nuevo)])
        : await sinUsuario(parte === 'actividad' ? Q.pipeActividadGuardar : Q.pipeBibliografiaGuardar, [req.pipe.propietarioId, req.paramsOk.id, req.paramsOk.recurso, JSON.stringify({ ...f[parte], contenido: nuevo })])
      if (!r.rowCount) return res.status(404).json({ error: 'Este recurso no tiene contenido guardado para editar.' })
      auditar(req.usuario.id, 'recurso.contenido_editar', 'proyecto', req.paramsOk.id, req)
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

// Aprobar el contenido de un recurso y pedir su publicación: n8n arma el .h5p y lo sube a Drive (si ya había archivo, reemplaza su contenido). El resultado llega por aviso.
rutas.post('/proyectos/:id/pipeline/recursos/:recurso/aprobar', exigirSesion, pipelineCurso('proyectos.crear'), limiteEditarRecurso,
  validar(z.object({ id: IdProyecto, recurso: z.string().min(1).max(100) }), 'params'), async (req, res, next) => {
    try {
      if (await correcciones.bloqueaAprobar(req.pipe.propietarioId, req.paramsOk.id, req.paramsOk.recurso)) return res.status(409).json({ error: correcciones.MENSAJE_PENDIENTE, correccionPendiente: true })
      const r = await lanzarPublicar({ usuario: req.pipe.usuario, proyectoId: req.paramsOk.id, recursoId: req.paramsOk.recurso })
      if (r.codigo === 202) auditar(req.usuario.id, 'recurso.aprobar_publicar', 'proyecto', req.paramsOk.id, req)
      res.status(r.codigo).json(r.cuerpo)
    } catch (err) { next(err) }
  })

// Arma el .h5p con el contenido guardado (editado o no): el servidor llama al servicio de plantillas con su clave y entrega el archivo; la clave nunca llega al navegador.
rutas.post('/proyectos/:id/pipeline/recursos/:recurso/h5p', exigirSesion, pipelineCurso('proyectos.ver_propios'), limiteEditarRecurso,
  validar(z.object({ id: IdProyecto, recurso: z.string().min(1).max(100) }), 'params'), async (req, res, next) => {
    try {
      if (!config.servicioPlantillasClave) return res.status(503).json({ error: 'El servicio de plantillas H5P no está configurado en el servidor (falta SERVICIO_PLANTILLAS_CLAVE).' })
      const f = (await sinUsuario(Q.pipeLeerContenido, [req.pipe.propietarioId, req.paramsOk.id, req.paramsOk.recurso])).rows[0]
      if (!f || !f.contenido) return res.status(404).json({ error: 'Este recurso no tiene contenido guardado.' })
      if (!f.plantilla) return res.status(409).json({ error: 'Este recurso no tiene plantilla registrada.' })
      let r
      try {
        r = await fetch(config.servicioPlantillasUrl + '/h5p', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.servicioPlantillasClave }, body: JSON.stringify(cuerpoServicioH5p(f)), signal: AbortSignal.timeout(90 * 1000) })
      } catch { return res.status(502).json({ error: 'El servicio de plantillas H5P no respondió. Inténtalo de nuevo en un momento.' }) }
      if (!r.ok) {
        let msg = ''
        try { const t = await r.text(); try { msg = JSON.parse(t).error || JSON.parse(t).mensaje || '' } catch { msg = t } } catch { /* sin cuerpo */ }
        const motivo = String(msg || '').replace(/\s+/g, ' ').slice(0, 300)
        return res.status(r.status === 400 ? 422 : 502).json({ error: r.status === 400 ? 'El servicio no pudo armar el H5P con este contenido' + (motivo ? ': ' + motivo : '.') : 'El servicio de plantillas H5P respondió con un error (' + r.status + ').' })
      }
      const buf = Buffer.from(await r.arrayBuffer())
      const sin = r.headers.get('x-iconos-sin-resolver')
      const nombre = String(f.codigo || f.id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'recurso'
      res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="' + nombre + '.h5p"', 'Content-Length': String(buf.length), 'Cache-Control': 'no-store',
        'Access-Control-Expose-Headers': 'X-Iconos-Sin-Resolver', ...(sin ? { 'X-Iconos-Sin-Resolver': sin.replace(/[^\x20-\x7E]/g, '').slice(0, 500) } : {}) })
      auditar(req.usuario.id, 'recurso.h5p_descargar', 'proyecto', req.paramsOk.id, req)
      res.send(buf)
    } catch (err) { next(err) }
  })

// Lanza la generación de matrices (las que faltan, o volver a generar con forzar). Responde 202 en cuanto n8n confirma la orden.
rutas.post('/proyectos/:id/pipeline/matrices', exigirSesion, pipelineCurso('proyectos.crear'), limiteLanzar, validar(z.object({ id: IdProyecto }), 'params'), validar(EsquemaLanzarMatrices, 'body'), async (req, res, next) => {
  try {
    const { unidades, forzar, conservar } = req.bodyOk
    const r = await lanzarMatrices({ usuario: req.pipe.usuario, proyectoId: req.paramsOk.id, unidades, forzar, conservar })
    if (r.codigo === 202) auditar(req.usuario.id, conservar ? 'matrices.actualizar' : forzar ? 'matrices.regenerar' : 'matrices.generar', 'proyecto', req.paramsOk.id, req)
    res.status(r.codigo).json(r.cuerpo)
  } catch (err) { next(err) }
})

// Lanza la generación de recursos H5P de las matrices ya listas. Responde 202 cuando n8n ya planificó y aceptó la corrida.
rutas.post('/proyectos/:id/pipeline/h5p', exigirSesion, pipelineCurso('proyectos.crear'), limiteLanzar, validar(z.object({ id: IdProyecto }), 'params'), validar(EsquemaLanzarH5p, 'body'), async (req, res, next) => {
  try {
    const { maximo, unidades, reintentarErrores, regenerar } = req.bodyOk
    if (regenerar && await correcciones.bloqueaRegenerar(req.pipe.propietarioId, req.paramsOk.id, regenerar)) return res.status(409).json({ error: correcciones.MENSAJE_PENDIENTE + ': espere a que el docente la marque como corregida.', correccionPendiente: true })
    const r = await lanzarH5p({ usuario: req.pipe.usuario, proyectoId: req.paramsOk.id, maximo, unidades, reintentarErrores, regenerar, encolar: true, pedidoPor: req.usuario.id })
    if (r.codigo === 202) auditar(req.usuario.id, regenerar ? 'h5p.regenerar' : reintentarErrores ?'h5p.reintentar' : 'h5p.generar', 'proyecto', req.paramsOk.id, req)
    res.status(r.codigo).json(r.cuerpo)
  } catch (err) { next(err) }
})

// Estado de diseño de los cursos de la persona (para etiquetas en el panel) y de uno solo; enviar a diseño (solo la persona dueña).
rutas.get('/diseno', exigirSesion, exigirPermiso('proyectos.ver_propios'), async (req, res, next) => {
  try { res.json((await sinUsuario(Q.disenoLista, [req.usuario.id])).rows) } catch (e) { next(e) }
})
rutas.get('/proyectos/:id/diseno', exigirSesion, exigirPermiso('proyectos.ver_propios'), validar(z.object({ id: IdProyecto }), 'params'), async (req, res, next) => {
  try {
    const f = await estadoDiseno(req.usuario.id, req.paramsOk.id)
    const datos = f ? null : ((await conUsuario(req.usuario, (c) => c.query(Q.pipeProyectoDatos, [req.usuario.id, req.paramsOk.id]))).rows[0] || {}).datos
    res.json({ estado: f ? f.estado : null, disenador: f ? f.disenador || null : null, enviado_en: f ? f.enviado_en : null, asignado_en: f ? f.asignado_en : null, actualizado_en: f ? f.actualizado_en : null,
      envio: f || !datos ? null : revisarEnvio(datos) })
  } catch (e) { next(e) }
})
rutas.post('/proyectos/:id/enviar-diseno', exigirSesion, exigirPermiso('proyectos.editar'), validar(z.object({ id: IdProyecto }), 'params'), async (req, res, next) => {
  try {
    const r = await enviarADiseno(req.usuario, req.paramsOk.id)
    if (r.codigo === 200) auditar(req.usuario.id, 'proyecto.enviar_diseno', 'proyecto', req.paramsOk.id, req)
    res.status(r.codigo).json(r.cuerpo)
  } catch (e) { next(e) }
})

// Asignación a diseño (coordinación): bandeja de cursos enviados, diseñadores con su carga y asignación manual o rápida.
const IdUuid = z.string().uuid()
const PedidoAsignar = z.object({ propietarioId: IdUuid, proyectoId: IdProyecto }).strict()
const auditarDiseno = (req) => (accion, entidad, id) => auditar(req.usuario.id, accion, entidad, id, req)
rutas.get('/diseno/bandeja', exigirSesion, exigirPermiso('diseno.asignar'), async (req, res, next) => {
  try { res.json(await asignarDiseno.bandeja(req.usuario)) } catch (e) { next(e) }
})
rutas.get('/diseno/disenadores', exigirSesion, exigirPermiso('diseno.asignar'), async (req, res, next) => {
  try { res.json(await asignarDiseno.disenadores()) } catch (e) { next(e) }
})
rutas.get('/diseno/mios', exigirSesion, async (req, res, next) => {
  try {
    if (!req.usuario.roles.includes('disenador')) return res.status(403).json({ error: 'No tienes permiso para esto' })
    res.json(await asignarDiseno.misCursos(req.usuario))
  } catch (e) { next(e) }
})
rutas.get('/diseno/cursos/:propietario/:id', exigirSesion, validar(z.object({ propietario: IdUuid, id: IdProyecto }), 'params'), async (req, res, next) => {
  try {
    const p = await asignarDiseno.cursoParaDisenador(req.usuario, req.paramsOk.propietario, req.paramsOk.id)
    if (!p) return res.status(403).json({ error: 'No tienes permiso para esto' })
    res.json(p)
  } catch (e) { next(e) }
})
rutas.post('/diseno/asignar', exigirSesion, exigirPermiso('diseno.asignar'), validar(PedidoAsignar.extend({ disenadorId: IdUuid }).strict(), 'body'), async (req, res, next) => {
  try { const r = await asignarDiseno.asignar(req.usuario, req.bodyOk, auditarDiseno(req)); res.status(r.codigo).json(r.cuerpo) } catch (e) { next(e) }
})
rutas.post('/diseno/asignar-rapido', exigirSesion, exigirPermiso('diseno.asignar'), validar(PedidoAsignar, 'body'), async (req, res, next) => {
  try { const r = await asignarDiseno.asignar(req.usuario, { ...req.bodyOk, rapido: true }, auditarDiseno(req)); res.status(r.codigo).json(r.cuerpo) } catch (e) { next(e) }
})
rutas.post('/diseno/asignar-rapido-todos', exigirSesion, exigirPermiso('diseno.asignar'), async (req, res, next) => {
  try { res.json(await asignarDiseno.asignarTodos(req.usuario, auditarDiseno(req))) } catch (e) { next(e) }
})

// Correcciones docente <-> diseñador por recurso (la lógica y los permisos están en correcciones.js).
const responderCorr = (res, r) => res.status(r.codigo).json(r.cuerpo)
const IdCorr = z.object({ id: IdUuid })
const Mensaje = z.object({ mensaje: z.string().max(4000).optional() }).strict()
rutas.post('/diseno/correcciones', exigirSesion, validar(z.object({ propietario: IdUuid, proyecto: IdProyecto, recursoId: z.string().min(1).max(100), mensaje: z.string().max(4000) }).strict(), 'body'), async (req, res, next) => {
  try { responderCorr(res, await correcciones.crear(req.usuario, req.bodyOk, auditarDiseno(req))) } catch (e) { next(e) }
})
rutas.get('/diseno/correcciones', exigirSesion, validar(z.object({ propietario: IdUuid.optional(), proyecto: IdProyecto.optional() }), 'query'), async (req, res, next) => {
  try { responderCorr(res, await correcciones.listar(req.usuario, req.queryOk.propietario || req.usuario.id, req.queryOk.proyecto)) } catch (e) { next(e) }
})
rutas.post('/diseno/correcciones/:id/mensajes', exigirSesion, validar(IdCorr, 'params'), validar(z.object({ texto: z.string().max(4000) }).strict(), 'body'), async (req, res, next) => {
  try { responderCorr(res, await correcciones.responder(req.usuario, req.paramsOk.id, req.bodyOk.texto, auditarDiseno(req))) } catch (e) { next(e) }
})
rutas.post('/diseno/correcciones/:id/corregida', exigirSesion, validar(IdCorr, 'params'), validar(Mensaje, 'body'), async (req, res, next) => {
  try { responderCorr(res, await correcciones.marcarCorregida(req.usuario, req.paramsOk.id, req.bodyOk.mensaje, auditarDiseno(req))) } catch (e) { next(e) }
})
rutas.post('/diseno/correcciones/:id/cerrar', exigirSesion, validar(IdCorr, 'params'), async (req, res, next) => {
  try { responderCorr(res, await correcciones.cerrar(req.usuario, req.paramsOk.id, auditarDiseno(req))) } catch (e) { next(e) }
})
rutas.post('/diseno/correcciones/:id/reabrir', exigirSesion, validar(IdCorr, 'params'), validar(Mensaje, 'body'), async (req, res, next) => {
  try { responderCorr(res, await correcciones.reabrir(req.usuario, req.paramsOk.id, req.bodyOk.mensaje, auditarDiseno(req))) } catch (e) { next(e) }
})
rutas.post('/proyectos/:id/devolver-diseno', exigirSesion, validar(z.object({ id: IdProyecto }), 'params'), async (req, res, next) => {
  try { responderCorr(res, await correcciones.devolverADiseno(req.usuario, req.paramsOk.id, auditarDiseno(req))) } catch (e) { next(e) }
})

rutas.put('/proyectos/:id', exigirSesion,
  validar(z.object({ id: IdProyecto }), 'params'), bloqueoDiseno('curso'),
  async (req, res, next) => {
    try {
      const p = Proyecto.safeParse(req.body)
      if (!p.success || p.data.id !== req.paramsOk.id) return res.status(400).json({ error: 'Datos no válidos' })
      const { _v: versionBase, ...datos } = p.data
      const resultado = await conUsuario(req.usuario, async (c) => {
        const previo = (await c.query(Q.proyectoObtener, [req.usuario.id, datos.id])).rows[0]
        const existe = Boolean(previo)
        // crear exige proyectos.crear; modificar exige proyectos.editar
        if (!req.usuario.permisos.has(existe ? 'proyectos.editar' : 'proyectos.crear')) return null
        // Si quien guarda partió de una versión que ya no es la vigente, alguien lo cambió en otra pestaña o equipo: no se pisa.
        // (Una página antigua que no envía versión sigue guardando como antes.)
        if (existe && versionBase !== undefined && versionBase !== previo.version) return { conflicto: { version: previo.version, actual: { ...previo.datos, _v: previo.version } } }
        const g = (await c.query(Q.proyectoGuardar, [req.usuario.id, datos.id, datos.programa, datos.curso, JSON.stringify(datos)])).rows[0]
        await c.query(Q.enlacesBorrarDelProyecto, [req.usuario.id, datos.id])
        for (const e of extraerEnlaces(datos)) await c.query(Q.enlaceInsertar, [req.usuario.id, datos.id, e.tipo, e.unidad, e.nombre, e.url])
        return { estado: existe ? 'actualizado' : 'creado', version: g.version }
      })
      if (!resultado) return res.status(403).json({ error: 'No tienes permiso para esto' })
      if (resultado.conflicto) return res.status(409).json({ error: 'Este syllabus cambió en otra pestaña o equipo desde que lo abrió.', conflicto: true, ...resultado.conflicto })
      if (resultado.estado === 'creado') await auditar(req.usuario.id, 'proyecto_crear', 'proyecto', datos.id, req)
      res.json({ ok: true, version: resultado.version })
    } catch (e) { next(e) }
  })

rutas.delete('/proyectos/:id', exigirSesion, exigirPermiso('proyectos.eliminar'),
  validar(z.object({ id: IdProyecto }), 'params'), async (req, res, next) => {
    try {
      const n = await conUsuario(req.usuario, async (c) => (await c.query(Q.proyectoEliminar, [req.usuario.id, req.paramsOk.id])).rowCount)
      if (!n) return res.status(404).json({ error: 'No encontrado' })
      await auditar(req.usuario.id, 'proyecto_eliminar', 'proyecto', req.paramsOk.id, req)
      res.json({ ok: true })
    } catch (e) { next(e) }
  })

// ------------------------------------------------------------------ guion desde un Google Doc
// El navegador no puede leer Google Docs (CORS): lo descarga el servidor. Solo se extrae el ID del documento y la
// petición va SIEMPRE a docs.google.com; la dirección que envía el usuario nunca se usa tal cual (sin SSRF).
const MAX_GUION = 10 * 1024 * 1024
// Cupo por persona (tras iniciar sesión); sin sesión, por dirección IP. Así varios gestores en la misma red no se gastan el cupo entre sí.
const porPersona = (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip))
const limiteGuion = rateLimit({ windowMs: 60 * 1000, limit: 20, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })
rutas.post('/guion-url', exigirSesion, exigirPermiso('proyectos.crear'), limiteGuion,
  validar(z.object({ url: z.string().max(500).regex(/^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]{10,100}(?:[/?#].*)?$/) }), 'body'),
  async (req, res, next) => {
    try {
      const id = req.bodyOk.url.match(/\/document\/d\/([A-Za-z0-9_-]+)/)[1]
      const r = await fetch('https://docs.google.com/document/d/' + id + '/export?format=docx', { redirect: 'follow', signal: AbortSignal.timeout(20000) })
      const tipo = r.headers.get('content-type') || ''
      if (!r.ok || !/officedocument|octet-stream/i.test(tipo)) return res.status(422).json({ error: 'No se pudo leer el documento. Revisa que permita la lectura a cualquier persona con el enlace.' })
      const datos = Buffer.from(await r.arrayBuffer())
      if (datos.length > MAX_GUION) return res.status(413).json({ error: 'El documento es demasiado grande' })
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(datos)
    } catch (e) { if (e.name === 'TimeoutError') return res.status(504).json({ error: 'Google Docs tardó demasiado en responder' }); next(e) }
  })

// ------------------------------------------------------------------ usuarios (solo con usuarios.gestionar)
const Rol = z.enum(['admin', 'coordinador', 'docente', 'disenador', 'editor_html', 'editor_imagenes', 'generador_rubricas', 'auditor_guiones'])
const Roles = z.array(Rol).min(1).max(7).refine((a) => new Set(a).size === a.length)
const admin = [exigirSesion, exigirPermiso('usuarios.gestionar')]

rutas.get('/usuarios', ...admin, async (req, res, next) => {
  try { res.json((await sinUsuario(Q.usuariosListar, [])).rows) } catch (e) { next(e) }
})

rutas.post('/usuarios', ...admin,
  validar(z.object({ nombre: z.string().min(2).max(120), correo: z.string().email().max(200), clave: z.string(), roles: Roles }).strict(), 'body'),
  async (req, res, next) => {
    try {
      const { nombre, correo, clave, roles } = req.bodyOk
      if (!claveValida(clave)) return res.status(400).json({ error: MENSAJE_CLAVE })
      try {
        const f = (await sinUsuario(Q.usuarioCrear, [nombre, correo.toLowerCase(), await hashClave(clave), roles])).rows[0]
        await auditar(req.usuario.id, 'usuario_crear', 'usuario', f.id, req)
        res.status(201).json(f)
      } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'Ese correo ya está registrado' })
        throw e
      }
    } catch (e) { next(e) }
  })

const sobreOtro = (req, res) => {
  if (req.paramsOk.id === req.usuario.id) { res.status(400).json({ error: 'No puedes cambiar tu propio usuario aquí' }); return false }
  return true
}

rutas.patch('/usuarios/:id/roles', ...admin, validar(z.object({ id: IdUsuario }), 'params'), validar(z.object({ roles: Roles }).strict(), 'body'),
  async (req, res, next) => {
    try {
      // Cada persona puede editar sus propios roles. Nadie puede quitar el rol de administrador si es el único administrador activo.
      const n = await conTransaccion(async (c) => {
        if (!req.bodyOk.roles.includes('admin')) {
          const a = (await c.query(Q.adminsAlCambiarRoles, [req.paramsOk.id])).rows[0]
          if (a.es_admin && a.otros === 0) throw Object.assign(new Error('último administrador'), { ultimoAdmin: true })
        }
        await c.query(Q.rolesDelUsuarioBorrar, [req.paramsOk.id])
        const asignados = (await c.query(Q.rolDelUsuarioAsignar, [req.paramsOk.id, req.bodyOk.roles])).rowCount
        // Si algún rol no existe en la base (migración pendiente) no se guarda nada: antes se «guardaba» sin asignarlo.
        if (asignados !== req.bodyOk.roles.length) throw Object.assign(new Error('rol inexistente'), { rolInexistente: true })
        return (await c.query(Q.usuarioSubirVersion, [req.paramsOk.id])).rows[0]
      })
      if (!n) return res.status(404).json({ error: 'No encontrado' })
      // Subir la versión cierra las sesiones de esa persona; si se editó a sí misma, se renueva la suya para no sacarla de la plataforma.
      if (req.paramsOk.id === req.usuario.id) emitirSesion(res, req.usuario, n.version_token)
      await auditar(req.usuario.id, 'usuario_rol', 'usuario', req.paramsOk.id, req)
      res.json({ ok: true })
    } catch (e) {
      if (e.ultimoAdmin) return res.status(409).json({ error: 'No se puede quitar el rol de administrador al único administrador activo: asigna antes ese rol a otra persona.' })
      if (e.rolInexistente) return res.status(409).json({ error: 'Alguno de esos roles no existe en la base de datos. Falta aplicar la migración (npm run db:migrar).' })
      next(e)
    }
  })

// Nombre y correo (también en la propia cuenta: la sesión va por id, no por correo).
rutas.patch('/usuarios/:id/datos', ...admin, validar(z.object({ id: IdUsuario }), 'params'),
  validar(z.object({ nombre: z.string().trim().min(2).max(120), correo: z.string().trim().email().max(200) }).strict(), 'body'),
  async (req, res, next) => {
    try {
      const { nombre, correo } = req.bodyOk
      let f
      try { f = (await sinUsuario(Q.usuarioCambiarDatos, [req.paramsOk.id, nombre, correo.toLowerCase()])).rows[0] } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'Ese correo ya está registrado' })
        throw e
      }
      if (!f) return res.status(404).json({ error: 'No encontrado' })
      await auditar(req.usuario.id, 'usuario_datos', 'usuario', req.paramsOk.id, req)
      res.json(f)
    } catch (e) { next(e) }
  })

rutas.patch('/usuarios/:id/activo', ...admin, validar(z.object({ id: IdUsuario }), 'params'), validar(z.object({ activo: z.boolean() }).strict(), 'body'),
  async (req, res, next) => {
    try {
      if (!sobreOtro(req, res)) return
      const n = (await sinUsuario(Q.usuarioCambiarActivo, [req.paramsOk.id, req.bodyOk.activo])).rowCount
      if (!n) return res.status(404).json({ error: 'No encontrado' })
      await auditar(req.usuario.id, req.bodyOk.activo ? 'usuario_activar' : 'usuario_desactivar', 'usuario', req.paramsOk.id, req)
      res.json({ ok: true })
    } catch (e) { next(e) }
  })

// Elimina la cuenta y, en cascada, todo lo suyo (syllabus, enlaces y bibliografía). No se puede deshacer; para solo quitar el acceso existe «desactivar».
rutas.delete('/usuarios/:id', ...admin, validar(z.object({ id: IdUsuario }), 'params'),
  async (req, res, next) => {
    try {
      if (!sobreOtro(req, res)) return
      const f = (await sinUsuario(Q.usuarioBorrar, [req.paramsOk.id])).rows[0]
      if (!f) return res.status(404).json({ error: 'No encontrado' })
      await auditar(req.usuario.id, 'usuario_eliminar', 'usuario', req.paramsOk.id, req)
      res.json({ ok: true })
    } catch (e) { next(e) }
  })

rutas.patch('/usuarios/:id/clave', ...admin, validar(z.object({ id: IdUsuario }), 'params'), validar(z.object({ clave: z.string() }).strict(), 'body'),
  async (req, res, next) => {
    try {
      if (!claveValida(req.bodyOk.clave)) return res.status(400).json({ error: MENSAJE_CLAVE })
      const n = (await sinUsuario(Q.usuarioCambiarClave, [req.paramsOk.id, await hashClave(req.bodyOk.clave)])).rowCount
      if (!n) return res.status(404).json({ error: 'No encontrado' })
      await auditar(req.usuario.id, 'usuario_clave', 'usuario', req.paramsOk.id, req)
      res.json({ ok: true })
    } catch (e) { next(e) }
  })

// ------------------------------------------------------------------ direcciones de n8n (compartidas por todas las personas)
const CLAVES_N8N = { syllabus: 'n8n.syllabus', guiones: 'n8n.guiones', matrices: 'n8n.matrices', h5p: 'n8n.h5p', publicar: 'n8n.publicar', preparacion: 'n8n.preparacion', rubricas: 'n8n.rubricas', auditor: 'n8n.auditor', compartir_carpeta: 'n8n.compartir_carpeta' }
rutas.get('/config/n8n', exigirSesion, async (req, res, next) => {
  try {
    const f = (await sinUsuario(Q.configLeer, [[...Object.values(CLAVES_N8N), CLAVE_PRUEBAS]])).rows
    const v = (c) => (f.find((x) => x.clave === c) || {}).valor || ''
    res.json({ syllabus: v(CLAVES_N8N.syllabus), guiones: v(CLAVES_N8N.guiones), matrices: v(CLAVES_N8N.matrices), h5p: v(CLAVES_N8N.h5p), publicar: v(CLAVES_N8N.publicar), preparacion: v(CLAVES_N8N.preparacion), rubricas: v(CLAVES_N8N.rubricas), auditor: v(CLAVES_N8N.auditor), compartir_carpeta: v(CLAVES_N8N.compartir_carpeta), pruebas_plantillas: pruebasEncendidas((f.find((x) => x.clave === CLAVE_PRUEBAS) || {}).valor) }) // '' = la dirección original
  } catch (e) { next(e) }
})
// ------------------------------------------------------------------ tipos de actividad (texto del guion → categoría ACT; coincidencia exacta normalizada)
rutas.get('/actividad-tipos', exigirSesion, async (req, res, next) => {
  try { res.json({ tipos: (await sinUsuario(Q.actividadTiposListar, [])).rows.map((f) => ({ tipo: f.nombre, categoria: f.categoria })) }) } catch (e) { next(e) }
})
const FilaTipo = z.object({ tipo: z.string().trim().min(1).max(300), categoria: z.string().trim().toUpperCase().regex(/^ACT-[A-Z]-\d{2}$/) }).strict()
// «filas» = lista que se guarda (con reemplazar:true es la lista COMPLETA: lo que no esté se quita); «borrar» = tipos a quitar.
rutas.put('/actividad-tipos', ...admin, validar(z.object({ filas: z.array(FilaTipo).max(300).default([]), borrar: z.array(z.string().max(300)).max(300).default([]), reemplazar: z.boolean().default(false) }).strict(), 'body'),
  async (req, res, next) => {
    try {
      const { filas, borrar, reemplazar } = req.bodyOk
      const vistos = new Set()
      for (const f of filas) {
        const n = normalizarTipo(f.tipo)
        if (!n || n.length > 150) return res.status(400).json({ error: 'El tipo «' + f.tipo.slice(0, 60) + '» no es válido (1 a 150 caracteres).' })
        if (vistos.has(n)) return res.status(400).json({ error: 'El tipo «' + f.tipo.slice(0, 60) + '» está repetido (se ignoran mayúsculas, tildes y espacios).' })
        vistos.add(n); f.n = n
      }
      await conTransaccion(async (c) => {
        if (reemplazar) await c.query(Q.actividadTiposBorrarTodo)
        for (const t of borrar) await c.query(Q.actividadTipoBorrar, [normalizarTipo(t)])
        for (const f of filas) await c.query(Q.actividadTipoGuardar, [f.n, f.categoria, f.tipo])
      })
      await auditar(req.usuario.id, 'config_actividad_tipos', 'configuracion', null, req)
      res.json({ ok: true, tipos: (await sinUsuario(Q.actividadTiposListar, [])).rows.map((f) => ({ tipo: f.nombre, categoria: f.categoria })) })
    } catch (e) { next(e) }
  })
// Solo lectura: lo que se perdería si se reinicia el servidor ahora.
rutas.get('/admin/trabajos-en-curso', ...admin, async (req, res, next) => {
  try { res.json(await trabajosEnCurso(sinUsuario)) } catch (e) { next(e) }
})
const UrlN8n = z.union([z.literal(''), z.string().trim().max(500).regex(/^https:\/\/\S+$/)])
rutas.put('/config/n8n', ...admin, validar(z.object({ syllabus: UrlN8n.optional(), guiones: UrlN8n.optional(), matrices: UrlN8n.optional(), h5p: UrlN8n.optional(), publicar: UrlN8n.optional(), preparacion: UrlN8n.optional(), rubricas: UrlN8n.optional(), auditor: UrlN8n.optional(), compartir_carpeta: UrlN8n.optional(), pruebas_plantillas: z.boolean().optional() }).strict(), 'body'),
  async (req, res, next) => {
    try {
      // Modo de pruebas de plantillas: encendido, la preparación del curso asigna cualquier plantilla subida (aprobada o no). Se registra quién lo cambia.
      if (req.bodyOk.pruebas_plantillas !== undefined) {
        await sinUsuario(Q.configGuardar, [CLAVE_PRUEBAS, req.bodyOk.pruebas_plantillas ? '1' : '0']) // se guarda siempre: apagarlo también es una decisión (sin valor manda el de por defecto)
        await auditar(req.usuario.id, req.bodyOk.pruebas_plantillas ? 'pruebas_plantillas_encender' : 'pruebas_plantillas_apagar', 'configuracion', null, req)
      }
      for (const [campo, clave] of Object.entries(CLAVES_N8N)) {
        const u = req.bodyOk[campo]
        if (u === undefined) continue
        if (u === '') await sinUsuario(Q.configBorrar, [clave]); else await sinUsuario(Q.configGuardar, [clave, u])
      }
      await auditar(req.usuario.id, 'config_n8n', 'configuracion', null, req)
      res.json({ ok: true })
    } catch (e) { next(e) }
  })

// ------------------------------------------------------------------ categorías de las plantillas HTML (para n8n)
// Una categoría (ID del catálogo + nombre) reúne las variantes de un mismo tipo de recurso. Ver: quien ve las plantillas. Cambiar: quien las revisa.
// Las plantillas existentes son las que publica el build (plantillas-html/plantillas.json); aquí solo se les asigna categoría.
// «G-09», «PRE-05», «ACT-G-01» (actividad general) y «ACT-E-03-TEC» (actividad específica: número y, al final, la formación TEC / PRO / ESP / DOC), como en el plan de trabajo.
// Se sigue aceptando el orden anterior «ACT-E-TEC-03» para no romper lo ya creado.
const IdCategoria = z.string().regex(/^(?:[A-Z]{1,4}(?:-[A-Z]{1,4}){0,2}-[0-9]{2,3}|ACT-E-[0-9]{2,3}-(?:TEC|PRO|ESP|DOC))$/)
const FORMACION_DE_SUFIJO = { TEC: 'tecnologico', PRO: 'profesional', ESP: 'especializacion', DOC: 'doctorado' }
// Formación que ya lleva el código de la categoría («ACT-E-03-TEC» → tecnologico); null si no la lleva (recursos y «ACT-G-01»).
const formacionDelId = (id) => { const m = /^ACT-E-[0-9]{2,3}-(TEC|PRO|ESP|DOC)$/.exec(id || ''); return m ? FORMACION_DE_SUFIJO[m[1]] : null }
const errorFormacionDelId = (id, otras) => ({ error: id + ' es una categoría de la formación ' + formacionDelId(id) + ' (la lleva en su código): no se puede marcar para ' + otras.join(', ') + '.' })
const NombrePlantilla = z.string().regex(/^[a-z0-9-]{1,80}$/)
const NombreCategoria = z.string().trim().min(1).max(120)
const TipoPlantilla = z.enum(['recurso', 'actividad', 'bibliografia'])
export const nombresPlantillasPublicadas = () => {
  try {
    const f = path.join(config.carpetaWeb, 'plantillas-html', 'plantillas.json')
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    return (j.plantillas || []).map((p) => p.nombre).filter((n) => typeof n === 'string')
  } catch { return [] }
}
const FORMACIONES = ['tecnologico', 'profesional', 'especializacion', 'doctorado']
// { 'G-01': [{ formacion: 'tecnologico', prioridad: 'P' }, …] }: para qué formaciones sirve cada categoría (en el orden de las formaciones).
const formacionesPorCategoria = (filas) => {
  const m = {}
  for (const f of filas) (m[f.categoria] = m[f.categoria] || []).push({ formacion: f.formacion, prioridad: f.prioridad })
  for (const k of Object.keys(m)) m[k].sort((a, b) => FORMACIONES.indexOf(a.formacion) - FORMACIONES.indexOf(b.formacion))
  return m
}
rutas.get('/plantillas/categorias', exigirSesion, exigirPermiso('plantillas.ver'), async (req, res, next) => {
  try {
    const [c, a, u, o, fo] = await Promise.all([sinUsuario(Q.categoriasListar), sinUsuario(Q.categoriasAsignaciones), sinUsuario(Q.subidasListar), sinUsuario(Q.ocultasListar), sinUsuario(Q.formacionesListar)])
    const eliminadas = new Set(o.rows.filter((x) => x.eliminada).map((x) => x.plantilla))
    const activas = u.rows.filter((x) => !x.archivada_en)
    const archivadas = u.rows.filter((x) => x.archivada_en)
    const catDe = Object.fromEntries(a.rows.map((x) => [x.plantilla, x.categoria]))
    const plantillas = [...new Set([...nombresPlantillasPublicadas(), ...activas.map((x) => x.nombre)])].filter((n) => !eliminadas.has(n)).sort()
    res.json({
      categorias: c.rows, formaciones: formacionesPorCategoria(fo.rows), asignaciones: Object.fromEntries(a.rows.map((x) => [x.plantilla, x.categoria])), plantillas, ocultas: o.rows.filter((x) => !x.eliminada).map((x) => x.plantilla),
      archivadas: archivadas.map((x) => ({ nombre: x.nombre, archivadaEn: x.archivada_en, por: x.archivada_por || null, categoria: catDe[x.nombre] || null, formacion: x.formacion || null })).sort((p, q) => String(q.archivadaEn).localeCompare(String(p.archivadaEn)) || p.nombre.localeCompare(q.nombre)),
      subidas: Object.fromEntries(activas.map((x) => [x.nombre, { por: x.por, actualizado: x.actualizado, ejemplo: !!x.ejemplo, propia: x.subida_por === req.usuario.id, formacion: x.formacion || null }]))
    })
  } catch (e) { next(e) }
})
const CuerpoFormaciones = z.object({ formaciones: z.array(z.object({ formacion: z.enum(FORMACIONES), prioridad: z.enum(['P', 'C']).default('P') }).strict()).max(4) }).strict()
  .refine((b) => new Set(b.formaciones.map((x) => x.formacion)).size === b.formaciones.length)
const ListaFormaciones = z.array(z.object({ formacion: z.enum(FORMACIONES), prioridad: z.enum(['P', 'C']).default('P') }).strict()).max(4)
  .refine((l) => new Set(l.map((x) => x.formacion)).size === l.length)
rutas.post('/plantillas/categorias', exigirSesion, exigirPermiso('plantillas.revisar'), validar(z.object({ id: IdCategoria, nombre: NombreCategoria, tipo: TipoPlantilla.default('recurso'), formaciones: ListaFormaciones.optional() }).strict(), 'body'), async (req, res, next) => {
  try {
    const { id, nombre, tipo } = req.bodyOk
    let formaciones = req.bodyOk.formaciones || []
    const fid = formacionDelId(id)
    const otras = formaciones.filter((f) => fid && f.formacion !== fid).map((f) => f.formacion)
    if (otras.length) return res.status(400).json(errorFormacionDelId(id, otras))
    if (fid && !formaciones.length) formaciones = [{ formacion: fid, prioridad: 'P' }] // la formación que lleva el código queda marcada sola
    // la categoría y sus formaciones se guardan juntas: o queda todo o no queda nada
    const r = await conTransaccion(async (c) => {
      const x = await c.query(Q.categoriaCrear, [id, nombre, tipo])
      if (x.rowCount) for (const f of formaciones) await c.query(Q.formacionPoner, [id, f.formacion, f.prioridad])
      return x
    })
    if (!r.rowCount) return res.status(409).json({ error: 'Ya existe una categoría con el ID ' + id + '.' })
    await auditar(req.usuario.id, 'plantilla_categoria_crear', 'plantilla_categoria', id, req)
    res.status(201).json({ id, nombre })
  } catch (e) { next(e) }
})
rutas.put('/plantillas/categorias/:id', exigirSesion, exigirPermiso('plantillas.revisar'), validar(z.object({ id: IdCategoria }), 'params'), validar(z.object({ nombre: NombreCategoria.optional(), tipo: TipoPlantilla.optional() }).strict().refine((b) => b.nombre !== undefined || b.tipo !== undefined), 'body'), async (req, res, next) => {
  try {
    const r = await sinUsuario(Q.categoriaRenombrar, [req.paramsOk.id, req.bodyOk.nombre ?? null, req.bodyOk.tipo ?? null])
    if (!r.rowCount) return res.status(404).json({ error: 'No encontrado' })
    await auditar(req.usuario.id, 'plantilla_categoria_renombrar', 'plantilla_categoria', req.paramsOk.id, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})
rutas.delete('/plantillas/categorias/:id', exigirSesion, exigirPermiso('plantillas.revisar'), validar(z.object({ id: IdCategoria }), 'params'), async (req, res, next) => {
  try {
    // sus plantillas quedan sin categoría y lo asignado con ellas en algún curso queda inválido
    const r = await conTransaccion(async (c) => { await invalidarAsignaciones(c, Q.asignInvalidarCategoria, [req.paramsOk.id]); return c.query(Q.categoriaBorrar, [req.paramsOk.id]) })
    if (!r.rowCount) return res.status(404).json({ error: 'No encontrado' })
    await auditar(req.usuario.id, 'plantilla_categoria_borrar', 'plantilla_categoria', req.paramsOk.id, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})
rutas.put('/plantillas/categorias/:id/formaciones', exigirSesion, exigirPermiso('plantillas.revisar'), validar(z.object({ id: IdCategoria }), 'params'), validar(CuerpoFormaciones, 'body'), async (req, res, next) => {
  try {
    const { id } = req.paramsOk
    if (!(await sinUsuario(Q.categoriasListar)).rows.some((c) => c.id === id)) return res.status(404).json({ error: 'No encontrado' })
    const fid = formacionDelId(id)
    const otras = req.bodyOk.formaciones.filter((f) => fid && f.formacion !== fid).map((f) => f.formacion)
    if (otras.length) return res.status(400).json(errorFormacionDelId(id, otras))
    await conTransaccion(async (c) => {
      await c.query(Q.formacionesBorrar, [id])
      for (const f of req.bodyOk.formaciones) await c.query(Q.formacionPoner, [id, f.formacion, f.prioridad])
    })
    await auditar(req.usuario.id, 'plantilla_categoria_formaciones', 'plantilla_categoria', id, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})
rutas.put('/plantillas/asignacion/:plantilla', exigirSesion, exigirPermiso('plantillas.revisar'), validar(z.object({ plantilla: NombrePlantilla }), 'params'), validar(z.object({ categoria: IdCategoria.nullable() }).strict(), 'body'), async (req, res, next) => {
  try {
    const { plantilla } = req.paramsOk
    const { categoria } = req.bodyOk
    if (categoria === null) await sinUsuario(Q.categoriaQuitar, [plantilla])
    else {
      if (!(await sinUsuario(Q.categoriasListar)).rows.some((c) => c.id === categoria)) return res.status(404).json({ error: 'No existe esa categoría.' })
      await sinUsuario(Q.categoriaAsignar, [plantilla, categoria])
    }
    await auditar(req.usuario.id, 'plantilla_categoria_asignar', 'plantilla', plantilla, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// Quitar de n8n (y volver a mostrar) una plantilla DEL SISTEMA: son archivos del código y no se borran, pero así dejan de ofrecerse sin tocar el código.
rutas.put('/plantillas/ocultas/:nombre', exigirSesion, exigirPermiso('plantillas.revisar'), validar(z.object({ nombre: z.string().regex(/^[a-z0-9-]{1,80}$/) }), 'params'), validar(z.object({ oculta: z.boolean() }).strict(), 'body'), async (req, res, next) => {
  try {
    const { nombre } = req.paramsOk
    if (!nombresPlantillasPublicadas().includes(nombre)) return res.status(404).json({ error: 'No es una plantilla del sistema. Las que subió una persona se eliminan.' })
    if (req.bodyOk.oculta) await sinUsuario(Q.ocultaPoner, [nombre, req.usuario.nombre])
    else await sinUsuario(Q.ocultaQuitar, [nombre])
    await auditar(req.usuario.id, req.bodyOk.oculta ? 'plantilla_ocultar' : 'plantilla_mostrar', 'plantilla', nombre, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})
// Eliminar una plantilla DEL SISTEMA desde la pantalla: su archivo es del código y no se borra, pero queda quitada de n8n y ya no se ve en la pantalla.
// Se hace a propósito sin vuelta atrás desde aquí (para volver a tenerla hay que quitar la fila de plantilla_ocultas).
rutas.delete('/plantillas/sistema/:nombre', exigirSesion, exigirPermiso('plantillas.revisar'), validar(z.object({ nombre: z.string().regex(/^[a-z0-9-]{1,80}$/) }), 'params'), async (req, res, next) => {
  try {
    const { nombre } = req.paramsOk
    if (!nombresPlantillasPublicadas().includes(nombre)) return res.status(404).json({ error: 'No es una plantilla del sistema.' })
    await sinUsuario(Q.ocultaEliminar, [nombre, req.usuario.nombre])
    await sinUsuario(Q.categoriaQuitar, [nombre])
    await conTransaccion((c) => invalidarAsignaciones(c, Q.asignInvalidarPlantilla, [nombre, 'plantilla_eliminada']))
    await auditar(req.usuario.id, 'plantilla_eliminar_sistema', 'plantilla', nombre, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// Subir plantillas nuevas desde la pantalla. Se arman y validan igual que las del build; no pueden pisar una del sistema.
// Una subida de varios archivos manda, por cada uno, una revisión y una subida (hasta 20 archivos): el tope por minuto lo permite con holgura.
const limiteSubir = rateLimit({ windowMs: 60 * 1000, limit: 240, keyGenerator: (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip)), standardHeaders: true, legacyHeaders: false })
const NombreSubida = z.string().regex(/^[a-z0-9-]{1,80}$/)
const HtmlSubido = z.string().min(1).max(MAX_HTML + 4096)
// El nombre sale solo del ID de la categoría y del orden de subida: G-08 → g-08-v01, g-08-v02… (minúsculas, que es como se guardan y se sirven los nombres).
// Quien llama puede mandar «nombre» (uso interno); la pantalla no lo manda. Sin categoría no hay ID de dónde sacar el nombre.
const FormacionSubida = z.enum(FORMACIONES)
const CuerpoSubir = z.object({ nombre: NombreSubida.optional(), html: HtmlSubido, categoria: IdCategoria.nullish(), formacion: FormacionSubida.nullish(), calificable: z.boolean().nullish() }).strict()
// Nombre de una variante: «g-08-v01» (categoría de una sola formación) o «g-09-tec-v01» (categoría compartida: cada formación numera las suyas).
const ABREV_FORMACION = { tecnologico: 'tec', profesional: 'pre', especializacion: 'esp', doctorado: 'doc' }
const nombreVariante = (cat, n, formacion) => cat.toLowerCase() + (formacion ? '-' + ABREV_FORMACION[formacion] : '') + '-v' + String(n).padStart(2, '0')
// Categorías de ACTIVIDAD: el nombre sale del plan («ACT-G-01-TEC-P-V2», «ACT-E-03-TEC-P-V1»): categoría + formación (si el código de la categoría no la lleva ya, como «ACT-E-03-TEC») + tipo
// (c = calificable, p = práctica) + «v» y el número SIN ceros, y cada formación y tipo numera las suyas. Profesional se escribe «pro» (en los recursos es «pre»).
const ABREV_ACTIVIDAD = { tecnologico: 'tec', profesional: 'pro', especializacion: 'esp', doctorado: 'doc' }
const nombreActividad = (cat, formacion, calificable, n) => {
  const ab = ABREV_ACTIVIDAD[formacion]
  const yaLleva = new RegExp('-' + ab.toUpperCase() + '(-|$)').test(cat)
  return cat.toLowerCase() + (yaLleva ? '' : '-' + ab) + '-' + (calificable ? 'c' : 'p') + '-v' + n
}
// ¿Es una categoría de actividades? y de qué tipo es la variante: lo elegido, lo que dice la ficha o lo que ya tenía (true calificable, false práctica).
const contextoActividad = async (categoria, pedido, ficha, actual) => {
  const es = categoria ? ((await sinUsuario(Q.categoriasListar)).rows.find((c) => c.id === categoria) || {}).tipo === 'actividad' : false
  if (!es) return { es: false, calificable: null }
  const c = [pedido, ficha, actual].find((x) => typeof x === 'boolean')
  return typeof c === 'boolean' ? { es: true, calificable: c } : { es: true, calificable: null, falta: true }
}
const errorTipo = (categoria) => ({ error: categoria + ' es una categoría de actividades: elija si esta variante es calificable o práctica (o ponga «Tipo de actividad: calificable» o «práctica» en la ficha). Cada tipo tiene sus propios campos.', requiereTipo: true })
const errorFormacionActividad = (categoria, fo) => ({ error: categoria + ' no tiene ninguna formación marcada: márquela en «Categorías para n8n» o elija la formación de esta variante (el nombre de las actividades la lleva).', requiereFormacion: true, formaciones: fo.formaciones })
// Nombre que le toca a una variante nueva (gasta un número del contador).
const nombreNuevo = async (ejecuta, categoria, fo, act) => {
  if (act.es) return nombreActividad(categoria, fo.formacion, act.calificable, (await ejecuta(Q.actividadSiguiente, [categoria, fo.formacion, act.calificable])).rows[0].n)
  return nombreVariante(categoria, await numeroSiguiente(ejecuta, categoria, fo), fo.compartida ? fo.formacion : null)
}
// Si al quitar una variante (eliminada o movida a otra categoría) su grupo de numeración se queda sin ninguna subida, ese grupo vuelve a numerar desde 1.
// El grupo se deduce del nombre: «g-09-v03» (la categoría), «g-09-tec-v03» (una formación de una categoría compartida), «act-g-01-tec-p-v2» o «act-e-03-tec-p-v2» (formación y tipo).
// Mientras quede alguna subida del grupo (aunque esté en otra categoría) no se reinicia, para no repetir un nombre que existe. Devuelve true si reinició.
const FORMACION_DE_ABREV_REC = Object.fromEntries(Object.entries(ABREV_FORMACION).map(([k, v]) => [v, k]))
const FORMACION_DE_ABREV_ACT = Object.fromEntries(Object.entries(ABREV_ACTIVIDAD).map(([k, v]) => [v, k]))
const reiniciarNumeracionSiVacia = async (c, categoria, nombre) => {
  if (!categoria || !nombre || !nombre.startsWith(categoria.toLowerCase() + '-')) return false
  const cat = categoria.toLowerCase()
  const resto = nombre.slice(cat.length)
  const vacio = async (patron) => !(await c.query(Q.subidaHayNombre, [patron])).rowCount
  let m = /^(?:-(tec|pro|esp|doc))?-(c|p)-v\d+$/.exec(resto) // actividad
  if (m) {
    const formacion = m[1] ? FORMACION_DE_ABREV_ACT[m[1]] : formacionDelId(categoria)
    if (!formacion || !(await vacio('^' + cat + (m[1] ? '-' + m[1] : '') + '-' + m[2] + '-v[0-9]+$'))) return false
    await c.query(Q.actividadReiniciar, [categoria, formacion, m[2] === 'c'])
    return true
  }
  m = /^-(tec|pre|esp|doc)-v\d+$/.exec(resto) // recurso de una categoría compartida: cada formación numera las suyas
  if (m) {
    if (!(await vacio('^' + cat + '-' + m[1] + '-v[0-9]+$'))) return false
    await c.query(Q.categoriaReiniciarFormacion, [categoria, FORMACION_DE_ABREV_REC[m[1]]])
    return true
  }
  if (/^-v\d+$/.test(resto)) { // recurso de una categoría de una sola formación: la categoría entera
    if (!(await vacio('^' + cat + '(-(tec|pre|esp|doc))?-v[0-9]+$'))) return false
    await c.query(Q.categoriaReiniciar, [categoria])
    return true
  }
  return false
}
// Siguiente número de la categoría (o de su formación, si es compartida); no se reutiliza mientras queden otras del grupo (ver reiniciarNumeracionSiVacia). «ejecuta» es una función (consulta, parámetros).
const numeroSiguiente = async (ejecuta, categoria, fo) => (fo && fo.compartida && fo.formacion
  ? (await ejecuta(Q.categoriaSiguienteVarianteFormacion, [categoria, fo.formacion])).rows[0].n
  : (await ejecuta(Q.categoriaSiguienteVariante, [categoria])).rows[0].n)

// Todas las variantes de una categoría usan los mismos campos de contenido (los de su ejemplo): la categoría define los campos y la variante solo cambia el diseño.
// Se compara con la variante subida más antigua de la categoría que tenga ejemplo; devuelve null si no hay con qué comparar.
// En una categoría que sirve a varias formaciones (compartida), cada formación tiene sus propios campos: se compara solo con las variantes de la misma formación.
// En una categoría de una sola formación (o sin formaciones marcadas) se compara con toda la categoría, como siempre.
const compararConCategoria = async (categoria, excluir, esquema, formacion, calificable = null) => {
  if (!categoria || !esquema) return null
  const ref = (await sinUsuario(Q.esquemaReferencia, [categoria, excluir || '', formacion || null, typeof calificable === 'boolean' ? calificable : null])).rows[0]
  if (!ref || !ref.esquema) return null
  return { ...compararEsquemas(ref.esquema, esquema), referencia: ref.nombre }
}
const resumenCampos = (l) => l.slice(0, 4).map((p) => p.split(':')[0]).join(', ') + (l.length > 4 ? ' y ' + (l.length - 4) + ' más' : '')
// Formación de una variante y con qué se compara. «pedida» es la elegida en la pantalla o, si no, la de la ficha.
// Categoría compartida (2 o más formaciones): la formación es obligatoria y debe ser una de las marcadas. Si no, se guarda lo pedido (o la única formación de la categoría).
const formacionDeSubida = async (categoria, pedida) => {
  // «ACT-E-03-TEC» ya dice su formación: no hace falta marcarla en la categoría ni elegirla al subir (y no puede ser otra)
  const fid = formacionDelId(categoria)
  if (fid) return pedida && pedida !== fid ? { compartida: false, formaciones: [fid], formacion: pedida, invalida: true } : { compartida: false, formaciones: [fid], formacion: fid, comparar: null }
  const fs = categoria ? (await sinUsuario(Q.formacionesListar)).rows.filter((x) => x.categoria === categoria).map((x) => x.formacion).sort((p, q) => FORMACIONES.indexOf(p) - FORMACIONES.indexOf(q)) : []
  if (fs.length < 2) return { compartida: false, formaciones: fs, formacion: pedida || (fs.length === 1 ? fs[0] : null), comparar: null }
  if (!pedida) return { compartida: true, formaciones: fs, formacion: null, falta: true }
  if (!fs.includes(pedida)) return { compartida: true, formaciones: fs, formacion: pedida, invalida: true }
  return { compartida: true, formaciones: fs, formacion: pedida, comparar: pedida }
}
const errorFormacion = (categoria, fo) => fo.falta
  ? { error: categoria + ' sirve para varias formaciones (' + fo.formaciones.join(', ') + '): elija a cuál pertenece esta variante, o ponga «Formación: …» en la ficha. Cada formación tiene sus propios campos.', requiereFormacion: true, formaciones: fo.formaciones }
  : { error: categoria + ' no está marcada para la formación ' + fo.formacion + ' (sí para: ' + fo.formaciones.join(', ') + ').', requiereFormacion: true, formaciones: fo.formaciones }
const errorEsquema = (categoria, cmp) => ({
  error: 'Los campos de esta plantilla no coinciden con los de las demás variantes de ' + categoria + ' (' + cmp.referencia + '): ' +
    [cmp.faltan.length ? 'le faltan ' + resumenCampos(cmp.faltan) : '', cmp.sobran.length ? 'le sobran ' + resumenCampos(cmp.sobran) : ''].filter(Boolean).join('; ') + '. Todas las variantes de una categoría (y formación) usan los mismos campos y solo cambia el diseño.',
  requiereConfirmacion: 'esquema', faltan: cmp.faltan, sobran: cmp.sobran, referencia: cmp.referencia
})
rutas.post('/plantillas/subidas', exigirSesion, exigirAlguno('plantillas.revisar', 'plantillas.subir'), limiteSubir, validar(CuerpoSubir, 'body'), async (req, res, next) => {
  try {
    const { html } = req.bodyOk
    let nombre = req.bodyOk.nombre
    if (nombre && (NOMBRES_RESERVADOS.includes(nombre) || nombresPlantillasPublicadas().includes(nombre))) return res.status(409).json({ error: 'Ese nombre ya lo usa una plantilla del sistema. Elija otro.' })
    const armada = armarSubida(html)
    if (!armada.ok) return res.status(400).json({ error: armada.error })
    const categoria = req.bodyOk.categoria || armada.ficha.categoria || null // si no se eligió categoría, se usa la que dice la ficha de la plantilla
    if (!nombre && !categoria) return res.status(400).json({ error: 'Elija la categoría de la plantilla: el nombre sale de su ID.' })
    if (categoria && !(await sinUsuario(Q.categoriasListar)).rows.some((c) => c.id === categoria)) return res.status(404).json({ error: 'No existe la categoría ' + categoria + (req.bodyOk.categoria ? '.' : ' (la dice la ficha de la plantilla).') })
    const fo = await formacionDeSubida(categoria, req.bodyOk.formacion || armada.ficha.formacion || null)
    if (fo.falta || fo.invalida) return res.status(400).json(errorFormacion(categoria, fo))
    const act = await contextoActividad(categoria, req.bodyOk.calificable, armada.ficha.calificable, null)
    if (act.falta) return res.status(400).json(errorTipo(categoria))
    if (act.es && !fo.formacion) return res.status(400).json(errorFormacionActividad(categoria, fo))
    const cmp = await compararConCategoria(categoria, '', armada.esquema, fo.comparar, act.calificable)
    if (cmp && !cmp.coincide) return res.status(409).json(errorEsquema(categoria, cmp))
    const esq = armada.esquema ? JSON.stringify(armada.esquema) : null
    let r = null
    if (nombre) r = await sinUsuario(Q.subidaCrear, [nombre, html, armada.html, req.usuario.id, req.usuario.nombre, esq, fo.formacion, act.calificable])
    else {
      // Número de variante: contador de la categoría (solo vuelve a 1 si la categoría se quedó sin variantes). Si el nombre ya existiera (se subió a mano con ese nombre), se pasa al siguiente.
      for (let i = 0; i < 20 && !(r && r.rowCount); i++) {
        nombre = await nombreNuevo(sinUsuario, categoria, fo, act)
        await sinUsuario(Q.historialLiberar, ['pub-' + nombre, nombre]) // si el número se reinició, no hereda la revisión de una variante eliminada con ese nombre
        r = await sinUsuario(Q.subidaCrear, [nombre, html, armada.html, req.usuario.id, req.usuario.nombre, esq, fo.formacion, act.calificable])
      }
    }
    if (!r || !r.rowCount) return res.status(409).json({ error: 'Ya hay una plantilla subida con ese nombre. Use «Reemplazar» para cambiarla.' })
    if (categoria) await sinUsuario(Q.categoriaAsignar, [nombre, categoria])
    await auditar(req.usuario.id, 'plantilla_subir', 'plantilla', nombre, req)
    res.status(201).json({ nombre })
  } catch (e) { next(e) }
})
// Vista previa ANTES de subir: valida y arma el archivo igual que la subida, pero sin guardarlo. Devuelve el HTML con el ejemplo puesto (o la plantilla
// vacía si no trae ejemplo) y el nombre que le tocaría en la categoría. Si no cumple las reglas, responde 400 con el motivo.
rutas.post('/plantillas/subidas/previa', exigirSesion, exigirAlguno('plantillas.revisar', 'plantillas.subir'), limiteSubir, validar(z.object({ html: HtmlSubido, categoria: IdCategoria.nullish(), formacion: FormacionSubida.nullish(), reemplaza: NombreSubida.nullish(), calificable: z.boolean().nullish() }).strict(), 'body'), async (req, res, next) => {
  try {
    const { html } = req.bodyOk
    const armada = armarSubida(html)
    if (!armada.ok) return res.status(400).json({ error: armada.error })
    const categoria = req.bodyOk.categoria || armada.ficha.categoria || null // sin categoría elegida, la de la ficha
    // Formación: la elegida o, si no, la de la ficha. En una categoría compartida hace falta una (requiereFormacion) y la comparación de campos es solo con esa formación.
    const fo = await formacionDeSubida(categoria, req.bodyOk.formacion || armada.ficha.formacion || null)
    // «reemplaza»: al reemplazar una variante, ella misma no cuenta como referencia (igual que hace el PUT al guardar)
    // Categoría de actividades: además hace falta el tipo (calificable o práctica); cada tipo tiene sus propios campos y su propia numeración.
    const act = await contextoActividad(categoria, req.bodyOk.calificable, armada.ficha.calificable, null)
    const cmp = categoria && !fo.falta && !fo.invalida && !act.falta ? await compararConCategoria(categoria, req.bodyOk.reemplaza || '', armada.esquema, fo.comparar, act.calificable) : null
    let nombre = null
    const nombres = {} // categoría compartida: el nombre que le tocaría en cada formación (la pantalla cambia de formación sin pedir otra revisión)
    if (categoria) {
      const c = (await sinUsuario(Q.categoriaSiguiente, [categoria])).rows[0]
      if (!c) return res.status(404).json({ error: 'No existe esa categoría.' })
      if (act.es) {
        // actividades: el nombre lleva formación y tipo; hasta que no se sepa el tipo no hay nombre que mostrar
        if (act.calificable !== null) {
          const ver = async (f) => nombreActividad(categoria, f, act.calificable, (await sinUsuario(Q.actividadSiguienteVer, [categoria, f, act.calificable])).rows[0].n)
          if (fo.compartida) for (const f of fo.formaciones) nombres[f] = await ver(f)
          nombre = fo.formacion ? await ver(fo.formacion) : null
        }
      } else if (fo.compartida) {
        for (const f of fo.formaciones) nombres[f] = nombreVariante(categoria, (await sinUsuario(Q.categoriaSiguienteFormacion, [categoria, f])).rows[0].siguiente_variante, f)
        nombre = fo.formacion ? nombres[fo.formacion] || null : null
      } else nombre = nombreVariante(categoria, c.siguiente_variante)
    }
    const vacia = armada.html.replace('{{TITULO}}', () => 'Vista previa').replace('/*CONTENIDO*/', () => '{}')
    const avisos = []
    if (req.bodyOk.categoria && armada.ficha.categoria && armada.ficha.categoria !== req.bodyOk.categoria) avisos.push('La ficha dice que es de ' + armada.ficha.categoria + ' y la vas a subir a ' + req.bodyOk.categoria + '.')
    if (armada.ficha.formacion && categoria) {
      if (fo.formaciones.length && !fo.formaciones.includes(armada.ficha.formacion)) avisos.push('La ficha dice formación ' + armada.ficha.formacion + ', pero ' + categoria + ' no está marcada para esa formación.')
      else if (req.bodyOk.formacion && req.bodyOk.formacion !== armada.ficha.formacion) avisos.push('La ficha dice formación ' + armada.ficha.formacion + ' y la vas a subir como ' + req.bodyOk.formacion + '.')
    }
    if (categoria && fo.invalida) avisos.push(errorFormacion(categoria, fo).error)
    // Actividades: si la ficha dice un tipo y se eligió otro, se avisa (el nombre lleva la «c» o la «p»).
    if (act.es && typeof armada.ficha.calificable === 'boolean' && typeof req.bodyOk.calificable === 'boolean' && armada.ficha.calificable !== req.bodyOk.calificable) avisos.push('La ficha dice que es ' + (armada.ficha.calificable ? 'calificable' : 'práctica') + ' y la vas a subir como ' + (req.bodyOk.calificable ? 'calificable' : 'práctica') + '.')
    // En una categoría compartida la pantalla puede cambiar de formación sin volver a pedir la revisión: se devuelve la comparación de cada formación.
    const esquemas = {}
    if (categoria && fo.compartida && armada.esquema && !act.falta) {
      for (const f of fo.formaciones) {
        const c = await compararConCategoria(categoria, req.bodyOk.reemplaza || '', armada.esquema, f, act.calificable)
        esquemas[f] = c ? { coincide: c.coincide, faltan: c.faltan, sobran: c.sobran, referencia: c.referencia } : null
      }
    }
    res.json({ ok: true, esquemas, nombres, conEjemplo: !!armada.ejemplo, html: armada.ejemplo || vacia, nombre, ficha: armada.ficha, categoriaUsada: categoria, formacionUsada: fo.formacion, requiereFormacion: !!(fo.falta || fo.invalida), esActividad: act.es, calificableUsado: act.calificable, requiereTipo: !!act.falta, formaciones: fo.formaciones, avisos, esquema: cmp ? { coincide: cmp.coincide, faltan: cmp.faltan, sobran: cmp.sobran, referencia: cmp.referencia } : null })
  } catch (e) { next(e) }
})
// Quien revisa puede cambiar cualquier plantilla subida; quien solo sube (Editor HTML) puede reemplazar, mover o eliminar únicamente las que subió él.
const soloLoPropio = async (req, res, next) => {
  try {
    if (req.usuario.permisos.has('plantillas.revisar')) return next()
    const f = (await sinUsuario(Q.subidaDueno, [req.paramsOk.nombre])).rows[0]
    if (!f) return res.status(404).json({ error: 'No hay una plantilla subida con ese nombre.' })
    if (!req.usuario.permisos.has('plantillas.subir') || f.subida_por !== req.usuario.id) return res.status(403).json({ error: 'Solo puedes cambiar las plantillas que subiste tú.' })
    next()
  } catch (e) { next(e) }
}
// Prepara el reemplazo de una variante (compartido por el reemplazo individual y el masivo): arma el HTML, resuelve formación y tipo.
// Devuelve { status, body } si no se puede, o { armada, fo, act, categoria } si sí.
const prepararReemplazo = async (nombre, html, pedido = {}) => {
  const armada = armarSubida(html)
  if (!armada.ok) return { status: 400, body: { error: armada.error } }
  const enCat = (await sinUsuario(Q.categoriasAsignaciones)).rows.find((x) => x.plantilla === nombre)
  const actual = (await sinUsuario(Q.subidaEsquema, [nombre])).rows[0]
  // formación: la elegida, la de la ficha o la que ya tenía la variante
  const fo = await formacionDeSubida(enCat && enCat.categoria, pedido.formacion || armada.ficha.formacion || (actual && actual.formacion) || null)
  if (fo.falta || fo.invalida) return { status: 400, body: errorFormacion(enCat.categoria, fo) }
  const act = await contextoActividad(enCat && enCat.categoria, pedido.calificable, armada.ficha.calificable, actual && actual.calificable)
  if (act.falta) return { status: 400, body: errorTipo(enCat.categoria) }
  return { armada, fo, act, categoria: enCat ? enCat.categoria : null }
}
const paramsReemplazo = (nombre, html, usuario, p) => [nombre, html, p.armada.html, usuario.id, usuario.nombre, p.armada.esquema ? JSON.stringify(p.armada.esquema) : null, p.fo.formacion, p.act.calificable]
rutas.put('/plantillas/subidas/:nombre', exigirSesion, exigirAlguno('plantillas.revisar', 'plantillas.subir'), limiteSubir, validar(z.object({ nombre: NombreSubida }), 'params'), soloLoPropio, validar(z.object({ html: HtmlSubido, formacion: FormacionSubida.nullish(), calificable: z.boolean().nullish() }).strict(), 'body'), async (req, res, next) => {
  try {
    const p = await prepararReemplazo(req.paramsOk.nombre, req.bodyOk.html, req.bodyOk)
    if (p.status) return res.status(p.status).json(p.body)
    const cmp = await compararConCategoria(p.categoria, req.paramsOk.nombre, p.armada.esquema, p.fo.comparar, p.act.calificable)
    if (cmp && !cmp.coincide) return res.status(409).json(errorEsquema(p.categoria, cmp))
    const r = await sinUsuario(Q.subidaReemplazar, paramsReemplazo(req.paramsOk.nombre, req.bodyOk.html, req.usuario, p))
    if (!r.rowCount) return res.status(404).json({ error: 'No hay una plantilla subida con ese nombre (las del sistema no se reemplazan desde aquí).' })
    await auditar(req.usuario.id, 'plantilla_reemplazar', 'plantilla', req.paramsOk.nombre, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})
// Reemplazo en masa: varias variantes (de una o más categorías) se reemplazan todas a la vez o ninguna. Los campos se comparan solo entre las nuevas
// de cada grupo (categoría + formación + tipo) y contra las del grupo que NO se reemplazan. «soloVerificar» no guarda nada.
rutas.post('/plantillas/subidas/reemplazo-masivo', exigirSesion, exigirAlguno('plantillas.revisar', 'plantillas.subir'), limiteSubir, validar(z.object({
  archivos: z.array(z.object({ nombre: NombreSubida, html: HtmlSubido }).strict()).min(1).max(40),
  soloVerificar: z.boolean().optional()
}).strict(), 'body'), async (req, res, next) => {
  try {
    const { archivos, soloVerificar } = req.bodyOk
    const nombres = archivos.map((a) => a.nombre)
    const dup = nombres.filter((n, i) => nombres.indexOf(n) !== i)
    if (dup.length) return res.status(400).json({ error: 'Hay variantes repetidas: ' + [...new Set(dup)].join(', ') + '.' })
    const detalle = {} // nombre → { ok, error?, faltan, sobran, referencia }
    const listos = []
    for (const a of archivos) {
      const f = (await sinUsuario(Q.subidaDueno, [a.nombre])).rows[0]
      if (!f) { detalle[a.nombre] = { ok: false, error: 'No hay una plantilla subida con ese nombre (las del sistema no se reemplazan desde aquí).' }; continue }
      if (!req.usuario.permisos.has('plantillas.revisar') && f.subida_por !== req.usuario.id) return res.status(403).json({ error: 'Solo puedes cambiar las plantillas que subiste tú.' })
      const p = await prepararReemplazo(a.nombre, a.html, {})
      if (p.status) { detalle[a.nombre] = { ok: false, error: p.body.error }; continue }
      listos.push({ nombre: a.nombre, html: a.html, ...p })
      detalle[a.nombre] = { ok: true, faltan: [], sobran: [], referencia: null }
    }
    // grupos: categoría + formación (si la categoría es compartida) + tipo
    const grupos = new Map()
    for (const l of listos) {
      if (!l.categoria || !l.armada.esquema) continue
      const k = JSON.stringify([l.categoria, l.fo.comparar || null, l.act.calificable])
      if (!grupos.has(k)) grupos.set(k, [])
      grupos.get(k).push(l)
    }
    const marca = (l, cmp, otro) => {
      detalle[l.nombre] = { ok: false, faltan: cmp.faltan, sobran: cmp.sobran, referencia: otro, error: 'Los campos no coinciden con ' + otro + ': ' + [cmp.faltan.length ? 'faltan ' + resumenCampos(cmp.faltan) : '', cmp.sobran.length ? 'sobran ' + resumenCampos(cmp.sobran) : ''].filter(Boolean).join('; ') + '.' }
    }
    for (const g of grupos.values()) {
      const ref = g[0]
      for (const l of g.slice(1)) { const c = compararEsquemas(ref.armada.esquema, l.armada.esquema); if (!c.coincide) marca(l, c, ref.nombre) }
      const fuera = (await sinUsuario(Q.esquemaReferenciaFuera, [ref.categoria, g.map((x) => x.nombre), ref.fo.comparar || null, typeof ref.act.calificable === 'boolean' ? ref.act.calificable : null])).rows[0]
      if (fuera && fuera.esquema) for (const l of g) { if (!detalle[l.nombre].ok) continue; const c = compararEsquemas(fuera.esquema, l.armada.esquema); if (!c.coincide) marca(l, c, fuera.nombre) }
    }
    const resultados = archivos.map((a) => ({ nombre: a.nombre, ...detalle[a.nombre] }))
    if (resultados.some((r) => !r.ok)) return res.status(409).json({ error: 'No se reemplazó ninguna variante: ' + resultados.filter((r) => !r.ok).length + ' de ' + resultados.length + ' no cumplen. Se reemplazan todas a la vez o ninguna.', resultados })
    const esquemas = Object.fromEntries(listos.map((l) => [l.nombre, l.armada.esquema || null]))
    if (soloVerificar) return res.json({ ok: true, verificado: true, resultados: resultados.map((r) => ({ ...r, esquema: esquemas[r.nombre] })) })
    await conTransaccion(async (c) => {
      for (const l of listos) {
        const r = await c.query(Q.subidaReemplazar, paramsReemplazo(l.nombre, l.html, req.usuario, l))
        if (!r.rowCount) throw Object.assign(new Error('desapareció ' + l.nombre), { desaparecio: l.nombre })
      }
    })
    for (const l of listos) await auditar(req.usuario.id, 'plantilla_reemplazar', 'plantilla', l.nombre, req)
    await auditar(req.usuario.id, 'plantilla_reemplazo_masivo', 'plantilla', nombres.join(', ').slice(0, 500), req)
    res.json({ ok: true, resultados: resultados.map((r) => ({ ...r, esquema: esquemas[r.nombre] })) })
  } catch (e) {
    if (e.desaparecio) return res.status(409).json({ error: 'No se reemplazó ninguna: ' + e.desaparecio + ' ya no existe.' })
    next(e)
  }
})
// Mover una plantilla subida a otra categoría: como el nombre sale del ID de la categoría, se le da el siguiente nombre de la categoría nueva (g-09-v03 → g-10-v01)
// y se traslada con ella su categoría y su historial de revisión.
rutas.post('/plantillas/subidas/:nombre/mover', exigirSesion, exigirAlguno('plantillas.revisar', 'plantillas.subir'), limiteSubir, validar(z.object({ nombre: NombreSubida }), 'params'), soloLoPropio, validar(z.object({ categoria: IdCategoria, formacion: FormacionSubida.nullish(), calificable: z.boolean().nullish() }).strict(), 'body'), async (req, res, next) => {
  try {
    const { nombre } = req.paramsOk
    const { categoria } = req.bodyOk
    if (!(await sinUsuario(Q.categoriasListar)).rows.some((c) => c.id === categoria)) return res.status(404).json({ error: 'No existe esa categoría.' })
    const actual = (await sinUsuario(Q.categoriasAsignaciones)).rows.find((x) => x.plantilla === nombre)
    if (actual && actual.categoria === categoria) return res.status(400).json({ error: 'Ya está en esa categoría.' })
    const propio = (await sinUsuario(Q.subidaEsquema, [nombre])).rows[0]
    const fo = await formacionDeSubida(categoria, req.bodyOk.formacion || (propio && propio.formacion) || null)
    if (fo.falta || fo.invalida) return res.status(400).json(errorFormacion(categoria, fo))
    const act = await contextoActividad(categoria, req.bodyOk.calificable, null, propio && propio.calificable)
    if (act.falta) return res.status(400).json(errorTipo(categoria))
    if (act.es && !fo.formacion) return res.status(400).json(errorFormacionActividad(categoria, fo))
    const cmp = await compararConCategoria(categoria, nombre, propio && propio.esquema, fo.comparar, act.calificable)
    if (cmp && !cmp.coincide) return res.status(409).json(errorEsquema(categoria, cmp))
    let nuevo = null
    await conTransaccion(async (c) => {
      for (let i = 0; i < 20 && !nuevo; i++) {
        const cand = await nombreNuevo((q, p) => c.query(q, p), categoria, fo, act)
        if ((await c.query(Q.subidaDueno, [cand])).rowCount) continue // ese nombre ya existe (se subió a mano): se prueba el siguiente
        nuevo = cand
      }
      if (!nuevo) throw Object.assign(new Error('sin nombre libre'), { sinNombre: true })
      await c.query(Q.historialLiberar, ['pub-' + nuevo, nuevo])
      await c.query(Q.subidaRenombrar, [nombre, nuevo])
      await c.query(Q.categoriaQuitar, [nombre])
      await c.query(Q.categoriaAsignar, [nuevo, categoria])
      await c.query(Q.historialRenombrar, ['pub-' + nombre, 'pub-' + nuevo])
      if (fo.formacion) await c.query(Q.subidaFormacionPoner, [nuevo, fo.formacion])
      await c.query(Q.subidaCalificablePoner, [nuevo, act.calificable]) // solo las actividades guardan su tipo
      await invalidarAsignaciones(c, Q.asignInvalidarPlantilla, [nombre, 'plantilla_movida_a_' + nuevo]) // lo asignado con ella en algún curso queda inválido (no se reasigna solo)
      await reiniciarNumeracionSiVacia(c, actual && actual.categoria, nombre) // si la categoría de origen se quedó sin variantes, su numeración empieza de nuevo
    })
    await auditar(req.usuario.id, 'plantilla_mover', 'plantilla', nombre + ' → ' + nuevo, req)
    res.json({ nombre: nuevo })
  } catch (e) {
    if (e.sinNombre) return res.status(409).json({ error: 'No se pudo asignar un nombre libre en esa categoría.' })
    next(e)
  }
})
// Descarga masiva de las plantillas subidas (no las del sistema) en un ZIP: <Tipo>/<ID categoría> <nombre>/[<formación>/]<plantilla>.html, cada una tal cual se subió, e indice.csv.
// Filtros opcionales: ?tipo=recurso|actividad|bibliografia y ?categoria=ID. Se arma en memoria (tope ~200 MB → 413).
const TIPOS_CARPETA = { recurso: 'Recursos', actividad: 'Actividades', bibliografia: 'Bibliografía' }
const MAX_ZIP = 200 * 1024 * 1024
rutas.get('/plantillas/subidas/descarga-masiva.zip', exigirSesion, exigirPermiso('plantillas.ver'), validar(z.object({ tipo: TipoPlantilla.optional(), categoria: IdCategoria.optional() }).strict(), 'query'), async (req, res, next) => {
  try {
    const q = req.queryOk || req.query
    const filas = (await sinUsuario(Q.subidasMasivas, [q.tipo || null, q.categoria || null])).rows
    if (filas.reduce((s, f) => s + Buffer.byteLength(f.html_crudo || ''), 0) > MAX_ZIP) return res.status(413).json({ error: 'Las plantillas pesan demasiado para un solo ZIP; filtre por tipo o categoría.' })
    const usados = new Set()
    const entradas = []
    const csv = [['nombre', 'categoria', 'nombre_categoria', 'tipo', 'formacion', 'estado', 'calificable']]
    for (const f of filas) {
      const partes = [f.tipo ? TIPOS_CARPETA[f.tipo] || sanear(f.tipo) : 'Sin categoría', f.categoria ? sanear(f.categoria + ' ' + f.categoria_nombre) : 'Sin categoría']
      if (f.formaciones > 1 && f.formacion) partes.push(sanear(f.formacion))
      const base = partes.join('/') + '/' + sanear(f.nombre, 100)
      let ruta = base + '.html'
      for (let i = 2; usados.has(ruta.toLowerCase()); i++) ruta = base + '-' + i + '.html'
      usados.add(ruta.toLowerCase())
      entradas.push({ ruta, datos: Buffer.from(f.html_crudo || '', 'utf8'), fecha: f.actualizado ? new Date(f.actualizado) : undefined })
      csv.push([f.nombre, f.categoria || '', f.categoria_nombre || '', f.tipo || '', f.formacion || '', f.archivada_en ? 'archivada' : f.estado, f.tipo === 'actividad' && typeof f.calificable === 'boolean' ? (f.calificable ? 'si' : 'no') : ''])
    }
    const celda = (v) => { const t = String(v).replace(/^([=+\-@])/, "'$1"); return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t }
    entradas.push({ ruta: 'indice.csv', datos: Buffer.concat([Buffer.from('﻿'), Buffer.from(csv.map((r) => r.map(celda).join(';')).join('\r\n') + '\r\n', 'utf8')]) })
    const zip = crearZip(entradas)
    if (zip.length > MAX_ZIP) return res.status(413).json({ error: 'El ZIP pasa de 200 MB; filtre por tipo o categoría.' })
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="plantillas-praxia-' + new Date().toISOString().slice(0, 10) + '.zip"', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
    res.send(zip)
  } catch (e) { next(e) }
})
// Vista previa de una plantilla subida: si traía contenido de ejemplo, el HTML con ese contenido puesto (se arma al pedirlo desde el HTML original guardado).
rutas.get('/plantillas/subidas/:nombre/ejemplo', exigirSesion, exigirPermiso('plantillas.ver'), validar(z.object({ nombre: NombreSubida }), 'params'), async (req, res, next) => {
  try {
    const f = await sinUsuario(Q.subidaCrudo, [req.paramsOk.nombre])
    if (!f.rows[0]) return res.status(404).json({ error: 'No hay una plantilla subida con ese nombre.' })
    const armada = armarSubida(f.rows[0].html_crudo)
    res.json({ html: armada.ok ? armada.ejemplo : null })
  } catch (e) { next(e) }
})
// Descarga de una plantilla subida: el archivo original, tal cual se subió (sin armar).
rutas.get('/plantillas/subidas/:nombre/original', exigirSesion, exigirPermiso('plantillas.ver'), validar(z.object({ nombre: NombreSubida }), 'params'), async (req, res, next) => {
  try {
    const f = await sinUsuario(Q.subidaCrudo, [req.paramsOk.nombre])
    if (!f.rows[0]) return res.status(404).json({ error: 'No hay una plantilla subida con ese nombre.' })
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + req.paramsOk.nombre.replace(/[^A-Za-z0-9._-]/g, '_') + '.html"', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
    res.send(f.rows[0].html_crudo)
  } catch (e) { next(e) }
})
// Archivar (y restaurar) plantillas subidas: no se borran, pero salen de las categorías, del índice de n8n y del reparto de variantes; lo asignado con ellas en los cursos queda
// inválido (se puede volver a asignar con las nuevas). Siguen entregándose por su dirección, para poder editar los recursos que ya se generaron con ellas.
rutas.post('/plantillas/subidas/archivar-todas', exigirSesion, exigirPermiso('plantillas.revisar'), validar(z.object({ categoria: z.string().regex(/^[A-Za-z0-9-]{1,40}$/).optional() }).strict(), 'body'), async (req, res, next) => {
  try {
    const categoria = req.bodyOk.categoria ? req.bodyOk.categoria.toUpperCase() : null
    const nombres = await conTransaccion(async (c) => {
      const r = await c.query(Q.subidasArchivarTodas, [req.usuario.nombre, categoria])
      const lista = r.rows.map((x) => x.nombre)
      if (lista.length) await invalidarAsignaciones(c, Q.asignInvalidarVarias, [lista, 'plantilla_archivada'])
      return lista
    })
    await auditar(req.usuario.id, 'plantilla_archivar_todas', 'plantilla', (categoria || 'todas') + ' (' + nombres.length + ')', req)
    res.json({ ok: true, archivadas: nombres.length })
  } catch (e) { next(e) }
})
rutas.put('/plantillas/subidas/:nombre/archivo', exigirSesion, exigirPermiso('plantillas.revisar'), validar(z.object({ nombre: NombreSubida }), 'params'), validar(z.object({ archivada: z.boolean() }).strict(), 'body'), async (req, res, next) => {
  try {
    const { nombre } = req.paramsOk
    const hecho = await conTransaccion(async (c) => {
      if (!req.bodyOk.archivada) return (await c.query(Q.subidaRestaurar, [nombre])).rowCount > 0
      const r = await c.query(Q.subidaArchivar, [nombre, req.usuario.nombre])
      if (r.rowCount) await invalidarAsignaciones(c, Q.asignInvalidarVarias, [[nombre], 'plantilla_archivada'])
      return r.rowCount > 0
    })
    if (!hecho) return res.status(404).json({ error: req.bodyOk.archivada ? 'No hay una plantilla subida activa con ese nombre.' : 'No hay una plantilla archivada con ese nombre.' })
    await auditar(req.usuario.id, req.bodyOk.archivada ? 'plantilla_archivar' : 'plantilla_restaurar', 'plantilla', nombre, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})
// ELIMINAR en bloque las plantillas subidas (todas, o solo las archivadas; y opcionalmente solo las de una categoría). No tiene vuelta atrás: se borran de la base (el historial de revisión
// queda). Hace lo mismo que eliminar una por una: la saca de su categoría, invalida lo asignado con ella en los cursos y, si un grupo de numeración se queda sin ninguna, su numeración vuelve a empezar.
// Solo la administración (usuarios.gestionar), no quien revisa plantillas. Exige «confirmar: true» a propósito. Los recursos ya generados con ellas ya no se podrán abrir en el editor (necesitan su plantilla).
rutas.post('/plantillas/subidas/eliminar-todas', exigirSesion, exigirPermiso('usuarios.gestionar'), validar(z.object({
  confirmar: z.literal(true), solo: z.enum(['todas', 'archivadas']).default('todas'), categoria: z.string().regex(/^[A-Za-z0-9-]{1,40}$/).optional()
}).strict(), 'body'), async (req, res, next) => {
  try {
    const categoria = req.bodyOk.categoria ? req.bodyOk.categoria.toUpperCase() : null
    const total = await conTransaccion(async (c) => {
      const filas = (await c.query(Q.subidasParaEliminar, [categoria, req.bodyOk.solo === 'archivadas'])).rows
      for (const f of filas) { await c.query(Q.subidaBorrar, [f.nombre]); await c.query(Q.categoriaQuitar, [f.nombre]) }
      for (const f of filas) await reiniciarNumeracionSiVacia(c, f.categoria, f.nombre) // ya sin ninguna del grupo: vuelve a v01
      if (filas.length) await invalidarAsignaciones(c, Q.asignInvalidarVarias, [filas.map((f) => f.nombre), 'plantilla_eliminada'])
      return filas.length
    })
    await auditar(req.usuario.id, 'plantilla_eliminar_todas', 'plantilla', (categoria || 'todas') + (req.bodyOk.solo === 'archivadas' ? ' archivadas' : '') + ' (' + total + ')', req)
    res.json({ ok: true, eliminadas: total })
  } catch (e) { next(e) }
})
rutas.delete('/plantillas/subidas/:nombre', exigirSesion, exigirAlguno('plantillas.revisar', 'plantillas.subir'), validar(z.object({ nombre: NombreSubida }), 'params'), soloLoPropio, async (req, res, next) => {
  try {
    const r = await conTransaccion(async (c) => {
      const previa = (await c.query(Q.categoriasAsignaciones)).rows.find((x) => x.plantilla === req.paramsOk.nombre)
      const borrada = await c.query(Q.subidaBorrar, [req.paramsOk.nombre])
      if (borrada.rowCount) {
        await c.query(Q.categoriaQuitar, [req.paramsOk.nombre])
        await reiniciarNumeracionSiVacia(c, previa && previa.categoria, req.paramsOk.nombre) // si la categoría se quedó sin variantes, su numeración empieza de nuevo
        await invalidarAsignaciones(c, Q.asignInvalidarPlantilla, [req.paramsOk.nombre, 'plantilla_eliminada']) // lo asignado con ella en algún curso queda inválido
      }
      return borrada
    })
    if (!r.rowCount) return res.status(404).json({ error: 'No hay una plantilla subida con ese nombre.' })
    await auditar(req.usuario.id, 'plantilla_eliminar', 'plantilla', req.paramsOk.nombre, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ------------------------------------------------------------------ revisión de plantillas HTML (ciclo diseñador ↔ administrador)
// Estados: revision (el diseñador pide cambios) → corregida (el administrador dice que ya están) → aprobada / rechazada / revision otra vez
// (el diseñador verifica), hasta que el diseñador la aprueba. Ver el estado: quien ve las plantillas. Decidir: diseñador y administrador
// (el administrador puede aprobar o rechazar, pero tiene que confirmar que es algo del diseñador y queda registrado en calidad de qué actuó).
// Marcar como corregida: solo quien tiene plantillas.corregir (administrador). Cambiar un estado ya aprobado o rechazado exige confirmarlo.
const RE_DOC_GOOGLE = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+/
const enCalidadDe = (u) => (u.roles.includes('disenador') ? 'disenador' : 'administrador')
rutas.get('/plantillas/revisiones', exigirSesion, exigirPermiso('plantillas.ver'), async (req, res, next) => {
  try { res.json((await sinUsuario(Q.historialListar, [])).rows) } catch (e) { next(e) }
})

// Lo que se exige de la observación y el enlace según el estado (devuelve el mensaje de error o null).
function revisarContenido(estado, observacion, docUrl) {
  if (estado === 'revision') {
    if (observacion.length < 3) return 'Escriba la observación: qué hay que cambiar.'
  } else if (estado === 'rechazada' && observacion.length < 3) return 'Escriba por qué se rechaza la plantilla.'
  if (docUrl && !RE_DOC_GOOGLE.test(docUrl)) return 'El enlace debe ser de un documento de Google Docs.'
  return null
}

// Quien notifica un cambio (marca como corregida) para pedir una nueva revisión: quien tiene el permiso de corregir (administración) o el Editor HTML que subió esa plantilla.
// Así quien sube una plantilla puede responder cuando se la rechazan o le piden cambios.
const subidaDe = async (plantilla) => (plantilla.startsWith('pub-') ? (await sinUsuario(Q.subidaDueno, [plantilla.slice(4)])).rows[0] : null)
const puedeNotificarCambio = async (usuario, plantilla) => {
  if (usuario.permisos.has('plantillas.corregir')) return true
  if (!usuario.permisos.has('plantillas.subir')) return false
  const s = await subidaDe(plantilla)
  return !!s && s.subida_por === usuario.id
}
// Aviso temporal (no se guarda) para quien le importa lo que acaba de pasar: a quien subió la plantilla si el diseñador aprueba, rechaza o pide cambios;
// y al diseñador que hizo la solicitud o la decisión si le notifican el cambio. Nadie recibe aviso de lo que hizo él mismo.
async function avisarMovimiento(actor, fila) {
  try {
    let destino = null
    if (fila.estado === 'corregida') { const ref = fila.referencia ? (await sinUsuario(Q.historialObtener, [fila.referencia])).rows[0] : null; destino = ref ? ref.usuarioId : null }
    else { const s = await subidaDe(fila.plantilla); destino = s ? s.subida_por : null }
    if (!destino || destino === actor.id) return
    publicarAviso(destino, { tipo: fila.estado, quien: actor.nombre, plantilla: fila.plantilla, nombre: fila.plantilla.replace(/^pub-/, '') })
  } catch { /* el aviso es un extra: si falla, la decisión ya quedó guardada */ }
}
// Recoge (y borra) los avisos temporales de quien llama; la pantalla los pide cada pocos segundos.
rutas.get('/plantillas/avisos', exigirSesion, exigirPermiso('plantillas.ver'), (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ avisos: tomarAvisos(req.usuario.id) })
})
const NuevaRevision = z.object({
  plantilla: z.string().regex(/^[a-z0-9-]{1,80}$/),
  estado: z.enum(['aprobada', 'rechazada', 'revision', 'corregida']),
  observacion: z.string().trim().max(2000),
  docUrl: z.string().trim().max(500).optional(),
  confirmadoAdmin: z.boolean().optional(), // el administrador reconoce que aprobar, rechazar o pedir cambios es algo del diseñador
  confirmadoCambio: z.boolean().optional() // reconoce que cambia un estado ya aprobado o rechazado
}).strict()
rutas.post('/plantillas/revisiones', exigirSesion, validar(NuevaRevision, 'body'), async (req, res, next) => {
  try {
    const { plantilla, estado, observacion, confirmadoAdmin, confirmadoCambio } = req.bodyOk
    const docUrl = estado === 'revision' ? (req.bodyOk.docUrl || '') : ''
    if (estado === 'corregida' ? !(await puedeNotificarCambio(req.usuario, plantilla)) : !req.usuario.permisos.has('plantillas.revisar')) return res.status(403).json({ error: 'No tienes permiso para esto' })
    const mal = revisarContenido(estado, observacion, docUrl)
    if (mal) return res.status(400).json({ error: mal })
    const rol = estado === 'corregida' ? 'administrador' : enCalidadDe(req.usuario)
    const r = await conTransaccion(async (c) => {
      await c.query(Q.historialBloquear, [plantilla])
      const ultimo = (await c.query(Q.historialUltimo, [plantilla])).rows[0]
      if (estado === 'corregida') {
        // Se responde a una solicitud de cambios o a un rechazo. Al responder a un rechazo hay que contar qué se cambió.
        if (!ultimo || (ultimo.estado !== 'revision' && ultimo.estado !== 'rechazada')) return { codigo: 409, cuerpo: { error: 'No hay una solicitud de revisión ni un rechazo pendiente al que responder.' } }
        if (ultimo.estado === 'rechazada' && observacion.length < 3) return { codigo: 400, cuerpo: { error: 'Cuente qué cambió para responder al rechazo.' } }
      } else {
        if (rol === 'administrador' && !confirmadoAdmin) return { codigo: 409, cuerpo: { requiereConfirmacion: 'admin', error: 'Aprobar, rechazar o pedir cambios en una plantilla es algo que debe hacer el diseñador. Si continúa, quedará registrado que lo hizo usted como administrador.' } }
        if (ultimo && (ultimo.estado === 'aprobada' || ultimo.estado === 'rechazada') && !confirmadoCambio) return { codigo: 409, cuerpo: { requiereConfirmacion: 'cambio', error: 'Esta plantilla ya estaba ' + (ultimo.estado === 'aprobada' ? 'aprobada' : 'rechazada') + '. Si continúa, cambia ese estado.' } }
      }
      const f = (await c.query(Q.historialCrear, [plantilla, estado, observacion, docUrl || null, req.usuario.id, req.usuario.nombre, rol, estado === 'corregida' ? ultimo.id : null])).rows[0]
      return { codigo: 201, cuerpo: f }
    })
    if (r.codigo === 201) { await auditar(req.usuario.id, 'plantilla_' + estado, 'plantilla', plantilla, req); await avisarMovimiento(req.usuario, r.cuerpo) }
    res.status(r.codigo).json(r.cuerpo)
  } catch (e) { next(e) }
})

// Editar una solicitud de revisión (o una corrección) ya enviada: solo quien la creó, y mientras siga siendo lo último de esa plantilla.
// Queda marcada como editada, con quién y cuándo fue la última edición.
const EditarRevision = z.object({ observacion: z.string().trim().max(2000), docUrl: z.string().trim().max(500).optional() }).strict()
rutas.patch('/plantillas/revisiones/:id', exigirSesion, validar(z.object({ id: z.string().regex(/^\d{1,18}$/) }), 'params'), validar(EditarRevision, 'body'), async (req, res, next) => {
  try {
    const r = await conTransaccion(async (c) => {
      const fila = (await c.query(Q.historialObtener, [req.paramsOk.id])).rows[0]
      if (!fila) return { codigo: 404, cuerpo: { error: 'No encontrado' } }
      await c.query(Q.historialBloquear, [fila.plantilla])
      const ultimo = (await c.query(Q.historialUltimo, [fila.plantilla])).rows[0]
      if (fila.usuarioId !== req.usuario.id) return { codigo: 403, cuerpo: { error: 'Solo quien la envió puede editarla.' } }
      if (fila.estado !== 'revision' && fila.estado !== 'corregida') return { codigo: 409, cuerpo: { error: 'Solo se pueden editar las solicitudes de revisión y las correcciones.' } }
      if (fila.estado === 'corregida' ? !(await puedeNotificarCambio(req.usuario, fila.plantilla)) : !req.usuario.permisos.has('plantillas.revisar')) return { codigo: 403, cuerpo: { error: 'No tienes permiso para esto' } }
      if (!ultimo || ultimo.id !== fila.id) return { codigo: 409, cuerpo: { error: 'Ya hay un movimiento posterior sobre esta plantilla: esta solicitud ya no se puede editar.' } }
      const observacion = req.bodyOk.observacion
      const docUrl = fila.estado === 'revision' ? (req.bodyOk.docUrl || '') : ''
      const mal = revisarContenido(fila.estado, observacion, docUrl)
      if (mal) return { codigo: 400, cuerpo: { error: mal } }
      if (observacion === fila.observacion && (docUrl || null) === (fila.docUrl || null)) return { codigo: 400, cuerpo: { error: 'No hay cambios que guardar.' } }
      const f = (await c.query(Q.historialEditar, [fila.id, observacion, docUrl || null, req.usuario.nombre])).rows[0]
      return { codigo: 200, cuerpo: f }
    })
    if (r.codigo === 200) await auditar(req.usuario.id, 'plantilla_editar', 'plantilla', r.cuerpo.plantilla, req)
    res.status(r.codigo).json(r.cuerpo)
  } catch (e) { next(e) }
})

rutas.get('/auditoria', exigirSesion, exigirPermiso('auditoria.ver'), async (req, res, next) => {
  try { res.json((await sinUsuario(Q.auditoriaListar, [])).rows) } catch (e) { next(e) }
})
