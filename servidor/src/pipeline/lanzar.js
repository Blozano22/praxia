// Fases 2 y 3 del pipeline: lanzar desde Praxia la generación de matrices (A: «las que faltan», B: «volver a generar») y la de H5P.
// El navegador nunca llama a n8n: lo hace el servidor. n8n responde enseguida (ack) y el resultado llega después por avisos firmados
// (src/pipeline/eventos.js), así que aquí solo se valida, se anota el origen del trabajo y se entrega la orden.
//   POST /api/proyectos/:id/pipeline/matrices   { unidades: [1,2], forzar: false }                      →   202 { trabajo_id }
//   POST /api/proyectos/:id/pipeline/h5p        { unidades?: [1], reintentarErrores?: bool }   (maximo es opcional: lo define n8n)  →   202 { trabajo_id, ejecucion_id? }
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { config } from '../config.js'
import { conTransaccion, conUsuario, sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { publicar } from '../guiones/rutas.js'
import { esUrlImagen } from './eventos.js'

const RE_CARPETA = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+/
const RE_CODIGO = /^U\d{1,3}-(?:T\d{1,3}-R\d{1,3}|PRES)$/
const LISTAS = ['creada', 'omitida', 'reemplazada'] // estados de una matriz que ya se puede usar

// Las direcciones de los webhooks las guarda el administrador en «Conexión n8n» (tabla configuracion); si no hay una guardada ahí,
// se usa la del .env (N8N_MATRICES_URL / N8N_H5P_URL). Vacío = esa función queda desactivada.
async function urlConfigurada(clave, respaldo) {
  const f = (await sinUsuario(Q.configLeer, [[clave]])).rows[0]
  return (f && f.valor) || respaldo || ''
}
export const urlMatrices = () => urlConfigurada('n8n.matrices', config.n8nMatricesUrl)
export const urlH5p = () => urlConfigurada('n8n.h5p', config.n8nH5pUrl)
export const urlPublicar = () => urlConfigurada('n8n.publicar', config.n8nPublicarUrl)

const Unidades = z.array(z.number().int().min(1).max(200)).min(1).max(50)
export const EsquemaLanzarMatrices = z.object({ unidades: Unidades, forzar: z.boolean().default(false) }).strict()
export const EsquemaLanzarH5p = z.object({
  maximo: z.number().int().min(1).max(200).optional(), // opcional: cuántos recursos tiene la corrida como tope. Praxia ya no lo pide; lo define n8n
  unidades: Unidades.optional(),
  reintentarErrores: z.boolean().default(false),
  regenerar: z.array(z.string().regex(RE_CODIGO)).min(1).max(200).optional() // códigos de posición de recursos ya creados que se vuelven a generar
}).strict()

const falla = (codigo, error, extra = {}) => ({ codigo, cuerpo: { error, ...extra } })

const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
// Lo que n8n necesita de cada unidad para armar su matriz: la formación y los guiones ya generados (de lo que Praxia guardó del flujo de guiones).
// «asignaciones»: las variantes de plantilla que Praxia eligió para los recursos de esta unidad (código «U1-T2-R3» → plantilla), para que la matriz diga qué plantilla usa cada recurso.
function detalleUnidad(datos, numero, asignadas = []) {
  const archivos = ((((datos || {}).guionesUnidad || {})[numero] || {}).archivos) || []
  const lista = Array.isArray(archivos) ? archivos : []
  const guiones = []
  for (const a of lista.slice(0, 200)) {
    let url = ''
    try { const u = new URL(texto(a && a.url, 600)); if (u.protocol === 'https:') url = u.href } catch { /* sin enlace */ }
    if (!url) continue
    const tema = Number.parseInt(a.tema, 10)
    guiones.push({ tema: Number.isFinite(tema) ? tema : null, nombre: texto(a.nombre, 300), url })
  }
  const info = (datos && datos.info) || {}
  const delGuion = lista.map((a) => texto(a && a.info && a.info.nivel, 120)).find(Boolean)
  const formacion = delGuion || texto(info.nivel, 120) || texto(info.nivel_de_formacion, 120)
  const asignaciones = asignadas.filter((f) => f.estado === 'asignada' && f.plantilla).map((f) => ({ codigo: f.codigo, categoria: f.categoria, id_catalogo: f.id_catalogo || null, formacion: f.formacion, plantilla: f.plantilla }))
  return { numero, formacion, guiones, asignaciones }
}

// Valida que el curso sea de la persona y tenga carpeta; devuelve { datos, carpeta } o una falla.
async function leerCurso(usuario, proyectoId) {
  // El curso se lee con la sesión de la persona: la política de filas (RLS) garantiza que sea suyo.
  const f = (await conUsuario(usuario, (cx) => cx.query(Q.pipeProyectoDatos, [usuario.id, proyectoId]))).rows[0]
  if (!f) return falla(404, 'No se encontró el curso.')
  const datos = f.datos || {}
  const carpeta = String(datos.carpetaUrl || '')
  if (!RE_CARPETA.test(carpeta)) return falla(400, 'El curso no tiene una carpeta de Drive válida.')
  return { datos, carpeta }
}

// Una sola generación a la vez por curso y etapa. La comprobación y el registro del origen van juntos bajo un candado para que dos
// clics seguidos (o dos pestañas) no lancen dos veces. Devuelve el id del trabajo o null si ya había una en curso.
async function reservar({ usuarioId, proyectoId, carpeta, etapa, unidad }) {
  const trabajoId = randomUUID()
  const ocupado = await conTransaccion(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['pipeline-' + etapa + ':' + usuarioId + ':' + proyectoId])
    if ((await c.query(Q.pipeEnCurso, [usuarioId, proyectoId, etapa])).rows.length) return true
    await c.query(Q.pipeOrigenGuardar, [trabajoId, usuarioId, proyectoId, carpeta, etapa, unidad])
    return false
  })
  return ocupado ? null : trabajoId
}

// Entrega la orden a n8n. n8n solo confirma que la recibió (o, en H5P, que ya planificó); el resultado llega por avisos.
async function entregar({ url, cuerpo, minutos, trabajoId, publicarFn, nombre }) {
  const olvidar = () => sinUsuario(Q.pipeOrigenBorrar, [trabajoId]).catch(() => {})
  try {
    const r = await publicarFn(url, cuerpo, minutos)
    if (r.estado === 409) { await olvidar(); return falla(409, 'n8n ya está generando ' + nombre + ' en la carpeta de este curso.', { ya: true }) }
    if (r.estado === 400) {
      await olvidar()
      let motivo = ''
      try { const j = JSON.parse(r.texto); motivo = texto(j.error || j.motivo || j.message || j.mensaje, 300) } catch { motivo = texto(String(r.texto || '').replace(/\s+/g, ' '), 300) }
      return falla(400, 'n8n rechazó la orden' + (motivo ? ': ' + motivo : '.'))
    }
    if (r.estado < 200 || r.estado >= 300) { await olvidar(); return falla(502, 'n8n no aceptó la orden (HTTP ' + r.estado + ').') }
    let ack = null
    try { ack = JSON.parse(r.texto) } catch { /* el ack puede venir sin cuerpo */ }
    return { codigo: 202, ack }
  } catch (e) {
    await olvidar()
    return falla(502, 'No se pudo avisar a n8n: ' + ((e && (e.code || e.message)) || 'error').toString().slice(0, 200))
  }
}

// Devuelve { codigo, cuerpo } listo para responder. «publicarFn» solo se cambia en las pruebas.
export async function lanzarMatrices({ usuario, proyectoId, unidades, forzar, publicarFn = publicar }) {
  const url = await urlMatrices()
  if (!url) return falla(503, 'La generación de matrices no está configurada en el servidor.')
  const curso = await leerCurso(usuario, proyectoId)
  if (curso.codigo) return curso
  const aprobadas = new Set(((curso.datos.syllabus && curso.datos.syllabus.documentos) || []).filter((d) => d && d.aprobado).map((d) => Number(d.unidad)))
  const pedidas = [...new Set(unidades)].sort((a, b) => a - b)
  const sin = pedidas.filter((u) => !aprobadas.has(u))
  if (sin.length) return falla(400, 'Estas unidades no existen o no están aprobadas: ' + sin.join(', ') + '.')
  const detalle = []
  for (const n of pedidas) {
    let filas = []
    try { filas = (await sinUsuario(Q.asignConsultar, [usuario.id, proyectoId, n, null])).rows } catch { /* sin la tabla de asignaciones: la matriz se arma sin plantillas */ }
    detalle.push(detalleUnidad(curso.datos, n, filas))
  }
  const sinGuiones = detalle.filter((d) => !d.guiones.length).map((d) => d.numero)
  if (sinGuiones.length) return falla(400, 'Estas unidades todavía no tienen guiones generados, y la matriz se arma con ellos: ' + sinGuiones.join(', ') + '.')

  const trabajoId = await reservar({ usuarioId: usuario.id, proyectoId, carpeta: curso.carpeta, etapa: 'matrices', unidad: pedidas.length === 1 ? pedidas[0] : null })
  if (!trabajoId) return falla(409, 'Ya se están generando las matrices de este curso. Espere a que termine.', { ya: true })
  // Dos minutos son de sobra para que n8n confirme que recibió la orden.
  const r = await entregar({ url, minutos: 2, trabajoId, publicarFn, nombre: 'matrices',
    cuerpo: { trabajo_id: trabajoId, proyecto_id: proyectoId, carpeta_raiz: curso.carpeta, unidades: pedidas, unidades_detalle: detalle, forzar } })
  if (r.codigo !== 202) return r
  const ejecucion = r.ack && typeof r.ack.ejecucion_id === 'string' ? r.ack.ejecucion_id.slice(0, 100) : undefined
  return { codigo: 202, cuerpo: { trabajo_id: trabajoId, unidades: pedidas, forzar, ...(ejecucion ? { ejecucion_id: ejecucion } : {}) } }
}

export async function lanzarH5p({ usuario, proyectoId, maximo, unidades, reintentarErrores, regenerar, publicarFn = publicar }) {
  const url = await urlH5p()
  if (!url) return falla(503, 'La generación de H5P no está configurada en el servidor.')
  const curso = await leerCurso(usuario, proyectoId)
  if (curso.codigo) return curso

  // Regenerar: solo filas ya creadas del curso, por revisar / generadas / con error y con plantilla asignada (la plantilla nunca cambia).
  let codigosReg = null
  let filasReg = []
  if (regenerar && regenerar.length) {
    codigosReg = [...new Set(regenerar)]
    filasReg = (await sinUsuario(Q.pipeRegenerarLeer, [usuario.id, proyectoId, codigosReg])).rows
    const porCodigo = new Map(filasReg.map((f) => [f.codigo, f]))
    const invalidos = codigosReg.filter((c) => { const f = porCodigo.get(c); return !f || !(['POR_REVISAR', 'GENERADO', 'ERROR'].includes(f.estado) || f.vencida) || !f.plantilla })
    if (invalidos.length) return falla(409, 'No se pueden regenerar estos recursos (no existen en el curso, siguen pendientes o en proceso, o no tienen plantilla): ' + invalidos.join(', ') + '.', { invalidos })
    unidades = [...new Set(filasReg.map((f) => f.unidad).filter((u) => Number.isInteger(u)))].sort((a, b) => a - b)
    if (!unidades.length) unidades = undefined
  }

  // Solo se puede generar H5P de unidades que ya tienen su matriz.
  const listas = new Set((await sinUsuario(Q.pipeLeerMatrices, [usuario.id, proyectoId])).rows.filter((m) => LISTAS.includes(m.estado)).map((m) => m.unidad))
  if (!listas.size) return falla(409, 'Primero genere las matrices del curso: todavía no hay ninguna lista.')
  let pedidas = null
  if (unidades) {
    pedidas = [...new Set(unidades)].sort((a, b) => a - b)
    const sin = pedidas.filter((u) => !listas.has(u))
    if (sin.length) return falla(400, 'Estas unidades no tienen una matriz lista: ' + sin.join(', ') + '.')
  }

  const trabajoId = await reservar({ usuarioId: usuario.id, proyectoId, carpeta: curso.carpeta, etapa: 'h5p', unidad: pedidas && pedidas.length === 1 ? pedidas[0] : null })
  if (!trabajoId) return falla(409, 'Ya se están generando los recursos H5P de este curso. Espere a que termine.', { ya: true })
  // Regenerar: las filas pasan a EN_PROCESO sin perder enlace, imagen, consumo ni contenido hasta que llegue el aviso nuevo.
  if (codigosReg) {
    const ids = filasReg.map((f) => f.id)
    await sinUsuario(Q.pipeRegenerarMarcar, [usuario.id, proyectoId, ids])
  }
  // El orquestador responde después de planificar (lee las matrices): se le da más margen que a una simple confirmación.
  const r = await entregar({ url, minutos: 5, trabajoId, publicarFn, nombre: 'recursos H5P',
    cuerpo: { trabajo_id: trabajoId, proyecto_id: proyectoId, carpeta_raiz: curso.carpeta, ...(maximo ? { maximo } : {}), ...(pedidas && !codigosReg ? { unidades: pedidas } : {}), ...(codigosReg ? { regenerar: codigosReg } : {}), reintentar_errores: reintentarErrores } })
  if (r.codigo !== 202) {
    if (codigosReg) await sinUsuario(Q.pipeRegenerarRevertir, [usuario.id, proyectoId, filasReg.map((f) => f.id), filasReg.map((f) => f.estado), filasReg.map((f) => f.actualizadoEn)]).catch(() => {})
    return r
  }
  const ejecucion = r.ack && typeof r.ack.ejecucion_id === 'string' ? r.ack.ejecucion_id.slice(0, 100) : undefined
  return { codigo: 202, cuerpo: { trabajo_id: trabajoId, ...(maximo ? { maximo } : {}), ...(pedidas && !codigosReg ? { unidades: pedidas } : {}), ...(codigosReg ? { regenerar: codigosReg } : {}), reintentarErrores, ...(ejecucion ? { ejecucion_id: ejecucion } : {}) } }
}


// Etapa 2 del H5P: la persona aprobó el contenido de un recurso y n8n debe armar el .h5p y publicarlo en Drive (si ya había un archivo, reemplaza el contenido del mismo archivo).
// Devuelve { codigo, cuerpo }. El resultado llega después por un aviso h5p_recurso (GENERADO con el enlace, o ERROR); mientras tanto «aprobado_en» marca que se está publicando.
export async function lanzarPublicar({ usuario, proyectoId, recursoId, publicarFn = publicar }) {
  const url = await urlPublicar()
  if (!url) return falla(503, 'La publicación de recursos H5P no está configurada en el servidor.')
  const curso = await leerCurso(usuario, proyectoId)
  if (curso.codigo) return curso
  const previo = (await sinUsuario(Q.pipeLeerContenido, [usuario.id, proyectoId, recursoId])).rows[0]
  if (!previo) return falla(404, 'No hay un recurso con ese identificador en este curso.')
  if (!previo.contenido) return falla(409, 'Este recurso todavía no tiene contenido para aprobar.')
  if (!previo.plantilla) return falla(409, 'Este recurso no tiene plantilla registrada.')
  if (!['POR_REVISAR', 'GENERADO', 'ERROR'].includes(previo.estado)) return falla(409, 'Este recurso todavía se está generando: espere a que quede por revisar.')
  const marcado = (await sinUsuario(Q.pipeAprobar, [usuario.id, proyectoId, recursoId])).rows[0]
  if (!marcado) return falla(409, 'Este recurso ya se está publicando. Espere a que termine.', { ya: true })
  const trabajoId = randomUUID()
  await sinUsuario(Q.pipeOrigenGuardarPublicar, [trabajoId, usuario.id, proyectoId, curso.carpeta, 'h5p', marcado.unidad ?? null])
  const reemplazar = /^https:\/\/(?:drive|docs)\.google\.com\//.test(marcado.enlaceRecurso || '')
  const r = await entregar({ url, minutos: 2, trabajoId, publicarFn, nombre: 'la publicación del H5P',
    cuerpo: { trabajo_id: trabajoId, proyecto_id: proyectoId, carpeta_raiz: curso.carpeta, id: marcado.id, codigo: marcado.codigo || null, unidad: marcado.unidad ?? null,
      plantilla: marcado.plantilla, contenido: marcado.contenido, enlace_recurso: reemplazar ? marcado.enlaceRecurso : null, reemplazar,
      ...(esUrlImagen(marcado.imagenUrl) ? { imagen_url: marcado.imagenUrl } : {}),
      ...(marcado.actividad ? { actividad: { plantilla: marcado.actividad.plantilla, contenido: marcado.actividad.contenido, imagen_url: marcado.actividad.imagen_url || null } } : {}),
      ...(marcado.bibliografia ? { bibliografia: { plantilla: marcado.bibliografia.plantilla, contenido: marcado.bibliografia.contenido } } : {}) } })
  if (r.codigo !== 202) { await sinUsuario(Q.pipeAprobarRevertir, [usuario.id, proyectoId, recursoId]).catch(() => {}); return r }
  return { codigo: 202, cuerpo: { trabajo_id: trabajoId, id: marcado.id, reemplazar } }
}
