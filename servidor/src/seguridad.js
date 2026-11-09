import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { sinUsuario } from './db.js'
import { Q } from './consultas.js'

export const COOKIE = 'ova_sesion'
const COSTO = 12
// Hash de relleno: así el login tarda lo mismo exista o no el correo.
const RELLENO = bcrypt.hashSync('relleno-para-igualar-tiempos', COSTO)

export const hashClave = (clave) => bcrypt.hash(clave, COSTO)
export const compararClave = (clave, hash) => bcrypt.compare(clave, hash || RELLENO)

export function claveValida(clave) {
  return typeof clave === 'string' && clave.length >= 10 && clave.length <= 100 &&
    /[a-z]/.test(clave) && /[A-Z]/.test(clave) && /\d/.test(clave)
}

export function emitirSesion(res, usuario, version) {
  const token = jwt.sign({ sub: usuario.id, v: version }, config.secretoJwt, { algorithm: 'HS256', expiresIn: config.horasSesion + 'h' })
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: config.cookieSegura, maxAge: config.horasSesion * 3600 * 1000, path: config.rutaBase
  })
}

// Identifica al usuario en cada petición. Vuelve a leer en la base de datos: si lo desactivaron,
// le cambiaron el rol o cerró sesión, el token anterior deja de servir de inmediato.
export async function exigirSesion(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE]
    if (!token) return res.status(401).json({ error: 'Inicia sesión' })
    let datos
    try { datos = jwt.verify(token, config.secretoJwt, { algorithms: ['HS256'] }) } catch { return res.status(401).json({ error: 'Sesión vencida' }) }
    const f = (await sinUsuario(Q.usuarioParaSesion, [datos.sub])).rows[0]
    if (!f || !f.activo || f.version_token !== datos.v) return res.status(401).json({ error: 'Sesión vencida' })
    const permisos = new Set((await sinUsuario(Q.permisosDelUsuario, [f.id])).rows.map((x) => x.codigo))
    req.usuario = { id: f.id, nombre: f.nombre, correo: f.correo, roles: f.roles, permisos }
    next()
  } catch (e) { next(e) }
}

export const exigirPermiso = (codigo) => (req, res, next) =>
  req.usuario && req.usuario.permisos.has(codigo) ? next() : res.status(403).json({ error: 'No tienes permiso para esto' })

// Protección contra peticiones enviadas desde otras páginas: toda escritura debe traer este encabezado
// (un formulario ajeno no puede añadirlo) y viajar como JSON.
export function exigirCabecera(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const conCuerpo = Number(req.get('content-length') || 0) > 0
  // Única excepción: la subida de un documento a una fuente de la bibliografía (archivo en bruto); sigue exigiendo x-ova.
  const subida = req.is('application/octet-stream') && /\/bibliografia\/fuentes\/[0-9a-f-]{36}\/archivo$/i.test(req.originalUrl.split('?')[0])
  if (req.get('x-ova') !== '1' || (conCuerpo && !req.is('application/json') && !subida)) return res.status(400).json({ error: 'Petición no válida' })
  next()
}
