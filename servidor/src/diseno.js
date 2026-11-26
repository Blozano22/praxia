// Estado de «diseño» del curso (tabla curso_diseno; sin fila = con el docente) y el bloqueo que implica.
//  en_diseno / asignado      → el docente no puede guardar el curso, lanzar guiones ni usar el pipeline (solo lectura).
//  en_revision_docente       → puede guardar el curso y regenerar guiones, pero NO matrices, H5P ni el resto del pipeline.
// Los administradores no se bloquean (soporte).
import { conUsuario, sinUsuario } from './db.js'
import { Q } from './consultas.js'
import { estadoAprobacion } from './pipeline/preparacion.js'

export const MENSAJE_BLOQUEO = 'El curso está en diseño: solo lectura.'
export const MENSAJE_PIPELINE = 'El curso está en diseño o en revisión: matrices y H5P los genera el diseñador.'

export async function estadoDiseno(propietarioId, proyectoId) {
  return (await sinUsuario(Q.disenoObtener, [propietarioId, String(proyectoId)])).rows[0] || null
}

const esAdmin = (u) => Boolean(u && (u.roles || []).includes('admin'))

// ¿Debe bloquearse? tipo 'curso' (guardar, guiones) o 'pipeline' (matrices, H5P, recursos). Devuelve el mensaje o null.
export function motivoBloqueo(fila, tipo) {
  if (!fila) return null
  if (fila.estado === 'en_revision_docente') return tipo === 'pipeline' ? MENSAJE_PIPELINE : null
  return MENSAJE_BLOQUEO
}

// Responde 409 si corresponde; true si la ruta puede continuar. Úsese donde ya se conoce el id del curso.
export async function exigirEditable(req, res, proyectoId, tipo = 'curso') {
  if (esAdmin(req.usuario)) return true
  const m = motivoBloqueo(await estadoDiseno(req.usuario.id, proyectoId), tipo)
  if (!m) return true
  res.status(409).json({ error: m, bloqueado: true })
  return false
}

// Middleware para rutas con :id del curso.
export const bloqueoDiseno = (tipo = 'curso') => async (req, res, next) => {
  try { if (await exigirEditable(req, res, req.params.id, tipo)) next() } catch (e) { next(e) }
}

// Fase 3: el diseñador asignado actúa en nombre del dueño del curso. La petición trae `propietario` (query o cabecera x-propietario).
// Devuelve { error: {codigo, cuerpo} } o { propietarioId, usuario (efectivo, con id del dueño), delegado, estado }.
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function cursoPipeline(req, proyectoId, escritura) {
  const pedido = String((req.query && req.query.propietario) || req.get('x-propietario') || '').trim()
  const u = req.usuario
  if (!pedido || pedido.toLowerCase() === u.id) return { propietarioId: u.id, usuario: u, delegado: false }
  if (!RE_UUID.test(pedido)) return { error: { codigo: 400, cuerpo: { error: 'Propietario no válido.' } } }
  const dueno = pedido.toLowerCase()
  const efectivo = { id: dueno, permisos: new Set(['proyectos.ver_propios']), roles: [] }
  if (esAdmin(u)) return { propietarioId: dueno, usuario: efectivo, delegado: true }
  const f = await estadoDiseno(dueno, proyectoId)
  if (!f || f.disenador_id !== u.id) return { error: { codigo: 403, cuerpo: { error: 'No tienes permiso para esto' } } }
  if (escritura && f.estado !== 'asignado') return { error: { codigo: 409, cuerpo: { error: 'El curso está en revisión del docente', bloqueado: true } } }
  return { propietarioId: dueno, usuario: efectivo, delegado: true, estado: f.estado }
}

// Middleware: deja en req.pipe el curso efectivo. Sin `propietario`: permiso normal del docente + bloqueo de la fase 1 (en escritura).
// Con `propietario`: la autorización es la asignación (o ser admin); no se exigen permisos proyectos.*.
export const pipelineCurso = (permiso, escritura = true) => async (req, res, next) => {
  try {
    const id = req.params.id
    const r = await cursoPipeline(req, id, escritura)
    if (r.error) return res.status(r.error.codigo).json(r.error.cuerpo)
    if (!r.delegado) {
      if (!req.usuario.permisos.has(permiso)) return res.status(403).json({ error: 'No tienes permiso para esto' })
      if (escritura && !(await exigirEditable(req, res, id, 'pipeline'))) return
    }
    req.pipe = r
    next()
  } catch (e) { next(e) }
}

// ¿Está el curso listo para enviarlo? Todas las unidades aprobadas y todos los guiones de todas ellas aprobados (al menos uno por unidad).
export function revisarEnvio(datos) {
  const a = estadoAprobacion(datos)
  const faltan = []
  if (!a.hay) faltan.push('El curso no tiene unidades.')
  if (a.pendientes.length) faltan.push('Unidades sin aprobar: ' + a.pendientes.join(', ') + '.')
  const gu = (datos && datos.guionesUnidad && typeof datos.guionesUnidad === 'object') ? datos.guionesUnidad : {}
  const sinGuion = []; const sinAprobar = []
  for (const d of a.unidades) {
    const n = Number(d.unidad)
    const arch = Array.isArray((gu[n] || {}).archivos) ? gu[n].archivos : []
    if (!arch.length) { sinGuion.push(n); continue }
    const nom = arch.filter((x) => !x || x.aprobado !== true).length
    if (nom) sinAprobar.push(n)
  }
  if (sinGuion.length) faltan.push('Unidades sin guiones generados: ' + sinGuion.join(', ') + '.')
  if (sinAprobar.length) faltan.push('Unidades con guiones sin aprobar: ' + sinAprobar.join(', ') + '.')
  return { listo: faltan.length === 0, faltan, unidadesSinAprobar: a.pendientes, unidadesSinGuion: sinGuion, unidadesGuionesSinAprobar: sinAprobar }
}

export async function enviarADiseno(usuario, proyectoId) {
  const datos = ((await conUsuario(usuario, (c) => c.query(Q.pipeProyectoDatos, [usuario.id, proyectoId]))).rows[0] || {}).datos
  if (!datos) return { codigo: 404, cuerpo: { error: 'No encontrado' } }
  if (await estadoDiseno(usuario.id, proyectoId)) return { codigo: 409, cuerpo: { error: 'El curso ya fue enviado a diseño.', yaEnviado: true } }
  const r = revisarEnvio(datos)
  if (!r.listo) return { codigo: 409, cuerpo: { error: 'Aún no se puede enviar a diseño. ' + r.faltan.join(' '), faltan: r.faltan, ...r } }
  const f = (await sinUsuario(Q.disenoCrear, [usuario.id, proyectoId, usuario.id])).rows[0]
  if (!f) return { codigo: 409, cuerpo: { error: 'El curso ya fue enviado a diseño.', yaEnviado: true } }
  return { codigo: 200, cuerpo: { ok: true, estado: f.estado, enviado_en: f.enviado_en } }
}
