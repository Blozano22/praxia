// Fase 2 del diseño: la coordinación asigna los cursos enviados a diseño (tabla curso_diseno) a diseñadores y comparte con ellos la carpeta de Drive.
// Praxia no tiene credenciales de Drive: si «Conexión n8n» tiene la dirección «compartir carpeta» (clave n8n.compartir_carpeta), se le pide a n8n que comparta.
import { conTransaccion, conUsuario, sinUsuario } from './db.js'
import { Q } from './consultas.js'
import { publicar } from './guiones/rutas.js'

export const CLAVE_COMPARTIR = 'n8n.compartir_carpeta'

// Los datos del curso (nombre, carpeta) pertenecen a otra persona: se leen con la misma política de filas que usa el seguimiento (ver_todos),
// solo para estas consultas ya acotadas a curso_diseno.
const comoLector = (usuario) => ({ id: usuario.id, permisos: new Set([...usuario.permisos, 'proyectos.ver_todos']) })
const leerProyectos = (usuario, consulta, valores = []) => conUsuario(comoLector(usuario), async (c) => (await c.query(consulta, valores)).rows)

export const bandeja = (usuario) => leerProyectos(usuario, Q.disenoBandeja)
export const misCursos = (usuario) => leerProyectos(usuario, Q.disenoMios, [usuario.id])
export const disenadores = async () => (await sinUsuario(Q.disenoDisenadores, [])).rows

// Menor carga; empate: la asignación más antigua (o ninguna); luego por nombre.
export function elegirDisenador(lista) {
  const t = (d) => (d.ultima_asignacion ? new Date(d.ultima_asignacion).getTime() : -Infinity)
  return [...lista].sort((a, b) => a.carga - b.carga || (t(a) < t(b) ? -1 : t(a) > t(b) ? 1 : 0) || a.nombre.localeCompare(b.nombre))[0] || null
}

async function compartirCarpeta(usuario, propietarioId, proyectoId, correo, anterior) {
  const resultado = async (v) => { await sinUsuario(Q.disenoDriveGuardar, [propietarioId, proyectoId, v]).catch(() => {}); return v }
  const url = ((await sinUsuario(Q.configLeer, [[CLAVE_COMPARTIR]])).rows[0] || {}).valor || ''
  if (!url) return resultado('sin_configurar')
  try {
    const carpeta = ((await leerProyectos(usuario, Q.pipeCarpetaDeProyecto, [propietarioId, proyectoId]))[0] || {}).carpeta || ''
    const r = await publicar(url, { proyecto_id: proyectoId, carpeta_raiz: carpeta, correo_disenador: correo, rol: 'writer', ...(anterior ? { anterior_correo: anterior } : {}) }, 0.15)
    if (r.estado >= 200 && r.estado < 300) return resultado('ok')
    return resultado('error: HTTP ' + r.estado)
  } catch (e) {
    return resultado(('error: ' + ((e && (e.code || e.message)) || 'desconocido')).slice(0, 200))
  }
}

// { codigo, cuerpo }. «disenador» ya validado o null (entonces se elige el de menor carga).
export async function asignar(usuario, { propietarioId, proyectoId, disenadorId, rapido = false }, auditar) {
  let dest = null
  if (rapido) {
    dest = elegirDisenador(await disenadores())
    if (!dest) return { codigo: 409, cuerpo: { error: 'No hay diseñadores activos.' } }
  } else {
    dest = (await sinUsuario(Q.disenoEsDisenador, [disenadorId])).rows[0]
    if (!dest) return { codigo: 400, cuerpo: { error: 'La persona elegida no es un diseñador activo.' } }
  }
  const r = await conTransaccion(async (c) => {
    const antes = (await c.query(Q.disenoFilaBloquear, [propietarioId, proyectoId])).rows[0]
    if (!antes) return null
    const despues = (await c.query(Q.disenoAsignar, [propietarioId, proyectoId, dest.id])).rows[0]
    return { antes, despues }
  })
  if (!r) return { codigo: 409, cuerpo: { error: 'El curso no fue enviado a diseño.' } }
  const corto = (id) => (id ? String(id).slice(0, 8) : '-')
  if (auditar) await auditar('diseno.asignar', 'curso_diseno', String(proyectoId).slice(0, 80) + ' ' + r.antes.estado + ':' + corto(r.antes.disenador_id) + '>' + r.despues.estado + ':' + corto(dest.id))
  const anterior = r.antes.disenador_id && r.antes.disenador_id !== dest.id ? r.antes.disenador_correo : null
  const drive = await compartirCarpeta(usuario, propietarioId, proyectoId, dest.correo, anterior)
  const carpeta = ((await leerProyectos(usuario, Q.pipeCarpetaDeProyecto, [propietarioId, proyectoId]))[0] || {}).carpeta || null
  return { codigo: 200, cuerpo: { ok: true, reasignado: r.antes.estado !== 'en_diseno', estado: r.despues.estado, disenador: { id: dest.id, nombre: dest.nombre }, drive_compartido: drive, carpeta } }
}

export async function asignarTodos(usuario, auditar) {
  const pend = (await sinUsuario(Q.disenoPendientes, [])).rows
  const hechos = []; const fallos = []
  for (const f of pend) {
    const r = await asignar(usuario, { propietarioId: f.propietario_id, proyectoId: f.proyecto_id, rapido: true }, auditar)
    if (r.codigo === 200) hechos.push({ proyecto_id: f.proyecto_id, disenador: r.cuerpo.disenador.nombre, drive_compartido: r.cuerpo.drive_compartido, carpeta: r.cuerpo.carpeta })
    else { fallos.push({ proyecto_id: f.proyecto_id, error: r.cuerpo.error }); if (r.codigo === 409 && /diseñadores/.test(r.cuerpo.error)) break }
  }
  return { ok: true, asignados: hechos.length, hechos, fallos }
}
