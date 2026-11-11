import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { conUsuario, conTransaccion, sinUsuario } from './db.js'
import { Q } from './consultas.js'
import { config } from './config.js'
import { extraerEnlaces } from './enlaces.js'
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
const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.LIMITE_LOGIN || 20), skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos. Espera unos minutos.' } })

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
        return res.status(401).json({ error: 'Correo o clave incorrectos' }) // mismo mensaje en todos los casos
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
  creado: z.number().optional()
}).passthrough()

rutas.get('/proyectos', exigirSesion, exigirPermiso('proyectos.ver_propios'), async (req, res, next) => {
  try {
    const filas = await conUsuario(req.usuario, async (c) => (await c.query(Q.proyectosListar, [req.usuario.id])).rows)
    res.json(filas.map((f) => f.datos))
  } catch (e) { next(e) }
})

// Coordinación: avance de todos los cursos (solo cifras y de lectura; para abrir un curso hay que ser su dueño).
rutas.get('/seguimiento', exigirSesion, exigirPermiso('proyectos.ver_todos'), async (req, res, next) => {
  try {
    const filas = await conUsuario(req.usuario, async (c) => (await c.query(Q.seguimientoListar)).rows)
    res.json(filas)
  } catch (e) { next(e) }
})

rutas.get('/proyectos/:id/enlaces', exigirSesion, exigirPermiso('proyectos.ver_propios'),
  validar(z.object({ id: IdProyecto }), 'params'), async (req, res, next) => {
    try {
      const filas = await conUsuario(req.usuario, async (c) => (await c.query(Q.enlacesDelProyecto, [req.usuario.id, req.paramsOk.id])).rows)
      res.json(filas)
    } catch (e) { next(e) }
  })

rutas.put('/proyectos/:id', exigirSesion,
  validar(z.object({ id: IdProyecto }), 'params'),
  async (req, res, next) => {
    try {
      const p = Proyecto.safeParse(req.body)
      if (!p.success || p.data.id !== req.paramsOk.id) return res.status(400).json({ error: 'Datos no válidos' })
      const datos = p.data
      const resultado = await conUsuario(req.usuario, async (c) => {
        const existe = (await c.query(Q.proyectoObtener, [req.usuario.id, datos.id])).rowCount > 0
        // crear exige proyectos.crear; modificar exige proyectos.editar
        if (!req.usuario.permisos.has(existe ? 'proyectos.editar' : 'proyectos.crear')) return null
        await c.query(Q.proyectoGuardar, [req.usuario.id, datos.id, datos.programa, datos.curso, JSON.stringify(datos)])
        await c.query(Q.enlacesBorrarDelProyecto, [req.usuario.id, datos.id])
        for (const e of extraerEnlaces(datos)) await c.query(Q.enlaceInsertar, [req.usuario.id, datos.id, e.tipo, e.unidad, e.nombre, e.url])
        return existe ? 'actualizado' : 'creado'
      })
      if (!resultado) return res.status(403).json({ error: 'No tienes permiso para esto' })
      if (resultado === 'creado') await auditar(req.usuario.id, 'proyecto_crear', 'proyecto', datos.id, req)
      res.json({ ok: true })
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
const CLAVES_N8N = { syllabus: 'n8n.syllabus', guiones: 'n8n.guiones' }
rutas.get('/config/n8n', exigirSesion, async (req, res, next) => {
  try {
    const f = (await sinUsuario(Q.configLeer, [Object.values(CLAVES_N8N)])).rows
    const v = (c) => (f.find((x) => x.clave === c) || {}).valor || ''
    res.json({ syllabus: v(CLAVES_N8N.syllabus), guiones: v(CLAVES_N8N.guiones) }) // '' = la dirección original
  } catch (e) { next(e) }
})
const UrlN8n = z.union([z.literal(''), z.string().trim().max(500).regex(/^https:\/\/\S+$/)])
rutas.put('/config/n8n', ...admin, validar(z.object({ syllabus: UrlN8n.optional(), guiones: UrlN8n.optional() }).strict(), 'body'),
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

// ------------------------------------------------------------------ revisión de plantillas HTML
// Ver las decisiones: quien ve las plantillas. Decidir (aprobar, rechazar, mandar a revisión): diseñador y administrador.
const RE_DOC_GOOGLE = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+/
rutas.get('/plantillas/revisiones', exigirSesion, exigirPermiso('plantillas.ver'), async (req, res, next) => {
  try { res.json((await sinUsuario(Q.revisionesListar, [])).rows) } catch (e) { next(e) }
})
const NuevaRevision = z.object({
  plantilla: z.string().regex(/^[a-z0-9-]{1,80}$/),
  estado: z.enum(['aprobada', 'rechazada', 'revision']),
  observacion: z.string().trim().max(2000),
  docUrl: z.string().trim().max(500).optional()
}).strict()
rutas.post('/plantillas/revisiones', exigirSesion, exigirPermiso('plantillas.revisar'), validar(NuevaRevision, 'body'), async (req, res, next) => {
  try {
    const { plantilla, estado, observacion } = req.bodyOk
    const docUrl = req.bodyOk.docUrl || ''
    if (estado !== 'aprobada' && observacion.length < 3) return res.status(400).json({ error: 'Escriba la observación: qué hay que cambiar o por qué se rechaza.' })
    if (estado === 'revision' && !RE_DOC_GOOGLE.test(docUrl)) return res.status(400).json({ error: 'Para mandarla a revisión pegue el enlace del documento de Google Docs con los cambios que desea.' })
    if (docUrl && !RE_DOC_GOOGLE.test(docUrl)) return res.status(400).json({ error: 'El enlace debe ser de un documento de Google Docs.' })
    const f = (await sinUsuario(Q.revisionCrear, [plantilla, estado, observacion, docUrl || null, req.usuario.id, req.usuario.nombre])).rows[0]
    await auditar(req.usuario.id, 'plantilla_' + estado, 'plantilla', plantilla, req)
    res.status(201).json(f)
  } catch (e) { next(e) }
})

rutas.get('/auditoria', exigirSesion, exigirPermiso('auditoria.ver'), async (req, res, next) => {
  try { res.json((await sinUsuario(Q.auditoriaListar, [])).rows) } catch (e) { next(e) }
})
