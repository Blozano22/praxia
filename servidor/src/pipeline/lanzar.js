// Fase 2 del pipeline: lanzar desde Praxia la generación de matrices de recursos (A: «las que faltan», B: «volver a generar»).
// El navegador nunca llama a n8n: lo hace el servidor. n8n responde enseguida (ack) y el resultado llega después por avisos firmados
// (src/pipeline/eventos.js), así que aquí solo se valida, se anota el origen del trabajo y se entrega la orden.
//   POST /api/proyectos/:id/pipeline/matrices   { unidades: [1,2], forzar: false }   →   202 { trabajo_id }
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { config } from '../config.js'
import { conTransaccion, conUsuario, sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { publicar } from '../guiones/rutas.js'

const RE_CARPETA = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+/

export const urlMatrices = () => config.n8nMatricesUrl || ''

export const EsquemaLanzarMatrices = z.object({
  unidades: z.array(z.number().int().min(1).max(200)).min(1).max(50),
  forzar: z.boolean().default(false)
}).strict()

const falla = (codigo, error, extra = {}) => ({ codigo, cuerpo: { error, ...extra } })

// Devuelve { codigo, cuerpo } listo para responder. «publicarFn» solo se cambia en las pruebas.
export async function lanzarMatrices({ usuario, proyectoId, unidades, forzar, publicarFn = publicar }) {
  const url = urlMatrices()
  if (!url) return falla(503, 'La generación de matrices no está configurada en el servidor.')
  const usuarioId = usuario.id

  // El curso se lee con la sesión de la persona: la política de filas (RLS) garantiza que sea suyo.
  const f = (await conUsuario(usuario, (cx) => cx.query(Q.pipeProyectoDatos, [usuarioId, proyectoId]))).rows[0]
  if (!f) return falla(404, 'No se encontró el curso.')
  const datos = f.datos || {}
  const carpeta = String(datos.carpetaUrl || '')
  if (!RE_CARPETA.test(carpeta)) return falla(400, 'El curso no tiene una carpeta de Drive válida.')
  const aprobadas = new Set(((datos.syllabus && datos.syllabus.documentos) || []).filter((d) => d && d.aprobado).map((d) => Number(d.unidad)))
  const pedidas = [...new Set(unidades)].sort((a, b) => a - b)
  const sin = pedidas.filter((u) => !aprobadas.has(u))
  if (sin.length) return falla(400, 'Estas unidades no existen o no están aprobadas: ' + sin.join(', ') + '.')

  // Una sola generación de matrices a la vez por curso. La comprobación y el registro van juntos bajo un candado para que dos clics
  // seguidos (o dos pestañas) no lancen dos veces.
  const trabajoId = randomUUID()
  const ocupado = await conTransaccion(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['pipeline-matrices:' + usuarioId + ':' + proyectoId])
    if ((await c.query(Q.pipeMatrizEnCurso, [usuarioId, proyectoId])).rows.length) return true
    await c.query(Q.pipeOrigenGuardar, [trabajoId, usuarioId, proyectoId, carpeta, 'matrices', pedidas.length === 1 ? pedidas[0] : null])
    return false
  })
  if (ocupado) return falla(409, 'Ya se están generando las matrices de este curso. Espere a que termine.', { ya: true })

  const olvidar = () => sinUsuario(Q.pipeOrigenBorrar, [trabajoId]).catch(() => {})
  try {
    // n8n solo confirma que recibió la orden; el resultado llega por avisos. Dos minutos son de sobra para esa confirmación.
    const r = await publicarFn(url, { trabajo_id: trabajoId, proyecto_id: proyectoId, carpeta_raiz: carpeta, unidades: pedidas, forzar }, 2)
    if (r.estado === 409) { await olvidar(); return falla(409, 'n8n ya está generando matrices en la carpeta de este curso.', { ya: true }) }
    if (r.estado < 200 || r.estado >= 300) { await olvidar(); return falla(502, 'n8n no aceptó la orden (HTTP ' + r.estado + ').') }
  } catch (e) {
    await olvidar()
    return falla(502, 'No se pudo avisar a n8n: ' + ((e && (e.code || e.message)) || 'error').toString().slice(0, 200))
  }
  return { codigo: 202, cuerpo: { trabajo_id: trabajoId, unidades: pedidas, forzar } }
}
