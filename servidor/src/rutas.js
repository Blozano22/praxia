import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { conUsuario, conTransaccion, sinUsuario } from './db.js'
import { Q } from './consultas.js'
import { config } from './config.js'
import { extraerEnlaces } from './enlaces.js'
import { EsquemaLanzarH5p, EsquemaLanzarMatrices, lanzarH5p, lanzarMatrices, urlH5p, urlMatrices } from './pipeline/lanzar.js'
import { COOKIE, claveValida, compararClave, emitirSesion, exigirPermiso, exigirSesion, hashClave } from './seguridad.js'

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
rutas.get('/proyectos/:id/pipeline', exigirSesion, exigirPermiso('proyectos.ver_propios'), validar(z.object({ id: IdProyecto }), 'params'), async (req, res, next) => {
  try {
    const p = [req.usuario.id, req.paramsOk.id]
    const [m, r, e] = await Promise.all([sinUsuario(Q.pipeLeerMatrices, p), sinUsuario(Q.pipeLeerRecursos, p), sinUsuario(Q.pipeLeerEjecuciones, p)])
    // El plan de una corrida puede ser largo: se entrega el conteo y la lista de lo omitido con su motivo, no todos los recursos a generar.
    const ejecuciones = e.rows.map((x) => ({ ...x, plan: x.plan ? { aGenerar: (x.plan.a_generar || []).length, omitidas: (x.plan.omitidas || []).slice(0, 500) } : null }))
    res.json({ matrices: m.rows, recursos: r.rows, ejecuciones, generado: new Date().toISOString(), puedeGenerarMatrices: Boolean(await urlMatrices()), puedeGenerarH5p: Boolean(await urlH5p()) })
  } catch (err) { next(err) }
})

// Lanza la generación de matrices (las que faltan, o volver a generar con forzar). Responde 202 en cuanto n8n confirma la orden.
const limiteLanzar = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.LIMITE_LANZAR_PIPELINE || 12), keyGenerator: (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip)), standardHeaders: true, legacyHeaders: false })
rutas.post('/proyectos/:id/pipeline/matrices', exigirSesion, exigirPermiso('proyectos.crear'), limiteLanzar, validar(z.object({ id: IdProyecto }), 'params'), validar(EsquemaLanzarMatrices, 'body'), async (req, res, next) => {
  try {
    const { unidades, forzar } = req.bodyOk
    const r = await lanzarMatrices({ usuario: req.usuario, proyectoId: req.paramsOk.id, unidades, forzar })
    if (r.codigo === 202) auditar(req.usuario.id, forzar ? 'matrices.regenerar' : 'matrices.generar', 'proyecto', req.paramsOk.id, req)
    res.status(r.codigo).json(r.cuerpo)
  } catch (err) { next(err) }
})

// Lanza la generación de recursos H5P de las matrices ya listas. Responde 202 cuando n8n ya planificó y aceptó la corrida.
rutas.post('/proyectos/:id/pipeline/h5p', exigirSesion, exigirPermiso('proyectos.crear'), limiteLanzar, validar(z.object({ id: IdProyecto }), 'params'), validar(EsquemaLanzarH5p, 'body'), async (req, res, next) => {
  try {
    const { maximo, unidades, reintentarErrores } = req.bodyOk
    const r = await lanzarH5p({ usuario: req.usuario, proyectoId: req.paramsOk.id, maximo, unidades, reintentarErrores })
    if (r.codigo === 202) auditar(req.usuario.id, reintentarErrores ? 'h5p.reintentar' : 'h5p.generar', 'proyecto', req.paramsOk.id, req)
    res.status(r.codigo).json(r.cuerpo)
  } catch (err) { next(err) }
})

rutas.put('/proyectos/:id', exigirSesion,
  validar(z.object({ id: IdProyecto }), 'params'),
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
const Rol = z.enum(['admin', 'coordinador', 'docente', 'disenador'])
const Roles = z.array(Rol).min(1).max(4).refine((a) => new Set(a).size === a.length)
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
      if (!sobreOtro(req, res)) return
      const n = await conTransaccion(async (c) => {
        await c.query(Q.rolesDelUsuarioBorrar, [req.paramsOk.id])
        const asignados = (await c.query(Q.rolDelUsuarioAsignar, [req.paramsOk.id, req.bodyOk.roles])).rowCount
        // Si algún rol no existe en la base (migración pendiente) no se guarda nada: antes se «guardaba» sin asignarlo.
        if (asignados !== req.bodyOk.roles.length) throw Object.assign(new Error('rol inexistente'), { rolInexistente: true })
        return (await c.query(Q.usuarioSubirVersion, [req.paramsOk.id])).rowCount
      })
      if (!n) return res.status(404).json({ error: 'No encontrado' })
      await auditar(req.usuario.id, 'usuario_rol', 'usuario', req.paramsOk.id, req)
      res.json({ ok: true })
    } catch (e) {
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
const CLAVES_N8N = { syllabus: 'n8n.syllabus', guiones: 'n8n.guiones', matrices: 'n8n.matrices', h5p: 'n8n.h5p' }
rutas.get('/config/n8n', exigirSesion, async (req, res, next) => {
  try {
    const f = (await sinUsuario(Q.configLeer, [Object.values(CLAVES_N8N)])).rows
    const v = (c) => (f.find((x) => x.clave === c) || {}).valor || ''
    res.json({ syllabus: v(CLAVES_N8N.syllabus), guiones: v(CLAVES_N8N.guiones), matrices: v(CLAVES_N8N.matrices), h5p: v(CLAVES_N8N.h5p) }) // '' = la dirección original
  } catch (e) { next(e) }
})
const UrlN8n = z.union([z.literal(''), z.string().trim().max(500).regex(/^https:\/\/\S+$/)])
rutas.put('/config/n8n', ...admin, validar(z.object({ syllabus: UrlN8n.optional(), guiones: UrlN8n.optional(), matrices: UrlN8n.optional(), h5p: UrlN8n.optional() }).strict(), 'body'),
  async (req, res, next) => {
    try {
      for (const [campo, clave] of Object.entries(CLAVES_N8N)) {
        const u = req.bodyOk[campo]
        if (u === undefined) continue
        if (u === '') await sinUsuario(Q.configBorrar, [clave]); else await sinUsuario(Q.configGuardar, [clave, u])
      }
      await auditar(req.usuario.id, 'config_n8n', 'configuracion', null, req)
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
    if (!RE_DOC_GOOGLE.test(docUrl)) return 'Para mandarla a revisión pegue el enlace del documento de Google Docs con los cambios que desea.'
  } else if (estado === 'rechazada' && observacion.length < 3) return 'Escriba por qué se rechaza la plantilla.'
  if (docUrl && !RE_DOC_GOOGLE.test(docUrl)) return 'El enlace debe ser de un documento de Google Docs.'
  return null
}

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
    if (!req.usuario.permisos.has(estado === 'corregida' ? 'plantillas.corregir' : 'plantillas.revisar')) return res.status(403).json({ error: 'No tienes permiso para esto' })
    const mal = revisarContenido(estado, observacion, docUrl)
    if (mal) return res.status(400).json({ error: mal })
    const rol = estado === 'corregida' ? 'administrador' : enCalidadDe(req.usuario)
    const r = await conTransaccion(async (c) => {
      await c.query(Q.historialBloquear, [plantilla])
      const ultimo = (await c.query(Q.historialUltimo, [plantilla])).rows[0]
      if (estado === 'corregida') {
        if (!ultimo || ultimo.estado !== 'revision') return { codigo: 409, cuerpo: { error: 'No hay una solicitud de revisión pendiente para marcar como corregida.' } }
      } else {
        if (rol === 'administrador' && !confirmadoAdmin) return { codigo: 409, cuerpo: { requiereConfirmacion: 'admin', error: 'Aprobar, rechazar o pedir cambios en una plantilla es algo que debe hacer el diseñador. Si continúa, quedará registrado que lo hizo usted como administrador.' } }
        if (ultimo && (ultimo.estado === 'aprobada' || ultimo.estado === 'rechazada') && !confirmadoCambio) return { codigo: 409, cuerpo: { requiereConfirmacion: 'cambio', error: 'Esta plantilla ya estaba ' + (ultimo.estado === 'aprobada' ? 'aprobada' : 'rechazada') + '. Si continúa, cambia ese estado.' } }
      }
      const f = (await c.query(Q.historialCrear, [plantilla, estado, observacion, docUrl || null, req.usuario.id, req.usuario.nombre, rol, estado === 'corregida' ? ultimo.id : null])).rows[0]
      return { codigo: 201, cuerpo: f }
    })
    if (r.codigo === 201) await auditar(req.usuario.id, 'plantilla_' + estado, 'plantilla', plantilla, req)
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
      if (!req.usuario.permisos.has(fila.estado === 'corregida' ? 'plantillas.corregir' : 'plantillas.revisar')) return { codigo: 403, cuerpo: { error: 'No tienes permiso para esto' } }
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
