// Fase 4 del diseño: el diseñador pide al docente corregir algo de un recurso (depende del guion) y ambos conversan en un hilo.
//  abierta (pidió el diseñador; el estado del curso no cambia: solo se bloquea ese recurso) → corregida (el docente) → cerrada (el diseñador) o reabrir (vuelve a abierta).
// Mientras haya una corrección abierta o corregida en un recurso, no se aprueba/publica; regenerar solo se permite si está corregida.
import { conTransaccion, sinUsuario } from './db.js'
import { Q } from './consultas.js'
import { estadoDiseno } from './diseno.js'

export const MENSAJE_PENDIENTE = 'Este recurso tiene una corrección pendiente'
const esAdmin = (u) => (u.roles || []).includes('admin')
const falla = (codigo, error) => ({ codigo, cuerpo: { error } })
const SIN_PERMISO = () => falla(403, 'No tienes permiso para esto')
const texto = (v) => (typeof v === 'string' ? v.trim().slice(0, 4000) : '')

const esDisenador = (u, curso) => Boolean(curso) && (esAdmin(u) || curso.disenador_id === u.id)
const cargar = async (id) => (await sinUsuario(Q.corrObtener, [id])).rows[0] || null

export async function crear(usuario, { propietario, proyecto, recursoId, mensaje }, auditar) {
  const msg = texto(mensaje)
  if (!msg) return falla(400, 'Escribe el mensaje para el docente.')
  const curso = await estadoDiseno(propietario, proyecto)
  if (!esDisenador(usuario, curso)) return SIN_PERMISO()
  if (curso.estado !== 'asignado') return falla(409, 'El curso no está en diseño: no se puede pedir una corrección ahora.')
  const rec = (await sinUsuario(Q.corrRecursoBuscar, [propietario, proyecto, recursoId])).rows[0]
  if (!rec) return falla(404, 'No se encontró ese recurso en el curso.')
  if ((await sinUsuario(Q.corrPendienteDeRecurso, [propietario, proyecto, rec.id])).rows.length) return falla(409, MENSAJE_PENDIENTE + ': responda en su hilo.')
  const id = await conTransaccion(async (c) => {
    const nueva = (await c.query(Q.corrCrear, [propietario, proyecto, rec.id, rec.codigo || null, usuario.id])).rows[0].id
    await c.query(Q.corrMensajeCrear, [nueva, usuario.id, 'disenador', msg])
    return nueva
  })
  if (auditar) await auditar('correccion.pedir', 'correccion', id)
  return { codigo: 201, cuerpo: { ok: true, id, estado: 'abierta', curso: 'asignado' } }
}

// { correcciones, estado }. proyecto null = todas las abiertas/corregidas del docente (para su tablero).
export async function listar(usuario, propietario, proyecto) {
  const propio = propietario === usuario.id
  const curso = proyecto ? await estadoDiseno(propietario, proyecto) : null
  const coord = (usuario.permisos && usuario.permisos.has('diseno.asignar')) || esAdmin(usuario)
  if (!propio && !coord && !(proyecto && esDisenador(usuario, curso))) return SIN_PERMISO()
  const filas = (await sinUsuario(Q.corrLista, [propietario, proyecto || null, Boolean(proyecto)])).rows
  return { codigo: 200, cuerpo: { estado: curso ? curso.estado : null, correcciones: filas } }
}

export async function responder(usuario, id, mensaje, auditar) {
  const msg = texto(mensaje)
  if (!msg) return falla(400, 'Escribe el mensaje.')
  const f = await cargar(id)
  if (!f) return falla(404, 'No encontrado')
  const rol = f.propietario_id === usuario.id ? 'docente' : (esDisenador(usuario, { disenador_id: f.disenador_id }) ? 'disenador' : null)
  if (!rol) return SIN_PERMISO()
  if (f.estado === 'cerrada') return falla(409, 'Esta corrección ya está cerrada: reábrala para escribir.')
  await sinUsuario(Q.corrMensajeCrear, [id, usuario.id, rol, msg])
  if (auditar) await auditar('correccion.mensaje', 'correccion', id)
  return { codigo: 200, cuerpo: { ok: true } }
}

export async function marcarCorregida(usuario, id, mensaje, auditar) {
  const f = await cargar(id)
  if (!f) return falla(404, 'No encontrado')
  if (f.propietario_id !== usuario.id) return SIN_PERMISO()
  const msg = texto(mensaje)
  if (!(await sinUsuario(Q.corrEstado, [id, ['abierta'], 'corregida'])).rowCount) return falla(409, 'Solo se puede marcar como corregida una solicitud abierta.')
  if (msg) await sinUsuario(Q.corrMensajeCrear, [id, usuario.id, 'docente', msg])
  if (auditar) await auditar('correccion.corregida', 'correccion', id)
  return { codigo: 200, cuerpo: { ok: true, estado: 'corregida' } }
}

export async function devolverADiseno(usuario, proyecto, auditar) {
  const curso = await estadoDiseno(usuario.id, proyecto)
  if (!curso) return falla(404, 'El curso no fue enviado a diseño.')
  if (curso.estado !== 'en_revision_docente') return falla(409, 'El curso no está en revisión del docente.')
  if ((await sinUsuario(Q.corrAbiertas, [usuario.id, proyecto])).rows[0].n > 0) return falla(409, 'Aún hay solicitudes sin marcar como corregidas.')
  if (!(await sinUsuario(Q.corrCursoEstado, [usuario.id, proyecto, 'asignado', ['en_revision_docente']])).rowCount) return falla(409, 'El curso no está en revisión del docente.')
  if (auditar) await auditar('correccion.devolver', 'curso_diseno', String(proyecto).slice(0, 80))
  return { codigo: 200, cuerpo: { ok: true, estado: 'asignado' } }
}

export async function cerrar(usuario, id, auditar) {
  const f = await cargar(id)
  if (!f) return falla(404, 'No encontrado')
  if (!esDisenador(usuario, { disenador_id: f.disenador_id })) return SIN_PERMISO()
  if (!(await sinUsuario(Q.corrEstado, [id, ['corregida'], 'cerrada'])).rowCount) return falla(409, 'Solo se puede cerrar una solicitud ya corregida por el docente.')
  if (auditar) await auditar('correccion.cerrar', 'correccion', id)
  return { codigo: 200, cuerpo: { ok: true, estado: 'cerrada' } }
}

export async function reabrir(usuario, id, mensaje, auditar) {
  const msg = texto(mensaje)
  if (!msg) return falla(400, 'Explique qué falta corregir.')
  const f = await cargar(id)
  if (!f) return falla(404, 'No encontrado')
  if (!esDisenador(usuario, { disenador_id: f.disenador_id })) return SIN_PERMISO()
  if (!['asignado', 'en_revision_docente'].includes(f.curso_estado)) return falla(409, 'El curso no está en diseño.')
  const ok = await conTransaccion(async (c) => {
    if (!(await c.query(Q.corrEstado, [id, ['corregida', 'cerrada'], 'abierta'])).rowCount) return false
    await c.query(Q.corrMensajeCrear, [id, usuario.id, 'disenador', msg])
    return true
  })
  if (!ok) return falla(409, 'Solo se puede reabrir una solicitud corregida o cerrada.')
  if (auditar) await auditar('correccion.reabrir', 'correccion', id)
  return { codigo: 200, cuerpo: { ok: true, estado: 'abierta', curso: 'asignado' } }
}

// ---- pipeline
export async function bloqueaAprobar(propietarioId, proyectoId, recurso) {
  return (await sinUsuario(Q.corrPendienteDeRecurso, [propietarioId, proyectoId, recurso])).rows.length > 0
}
export async function bloqueaRegenerar(propietarioId, proyectoId, codigos) {
  return (await sinUsuario(Q.corrAbiertasDeCodigos, [propietarioId, proyectoId, codigos])).rows.length > 0
}
// Añade a cada recurso `correccion: {id, estado}` si tiene una sin cerrar.
export async function conCorrecciones(propietarioId, proyectoId, recursos) {
  const m = new Map((await sinUsuario(Q.corrPorRecurso, [propietarioId, proyectoId])).rows.map((x) => [x.recurso_id, { id: x.id, estado: x.estado }]))
  return recursos.map((r) => (m.has(r.id) ? { ...r, correccion: m.get(r.id) } : r))
}
