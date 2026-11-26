// Receptor de los AVISOS de n8n (pipeline guiones → matrices → H5P). n8n avisa a Praxia cuando ocurren los eventos y Praxia los guarda ligados
// al curso; Praxia no consulta a n8n. Un solo endpoint, sin sesión de persona, protegido por FIRMA:
//   POST /api/n8n/eventos        un aviso, o { "eventos": [ … ] } (hasta 50)
//   cabeceras: X-Praxia-Fecha (segundos)  ·  X-Praxia-Firma = HMAC-SHA256 en hexadecimal de  fecha + "." + cuerpo exacto
// Respuestas: 200 procesado · 202 aviso sin curso conocido (no reintentar) · 400 cuerpo inválido · 401 firma o fecha inválida ·
// 413 demasiado grande · 429 demasiados (reintentar con espera) · 5xx error o caída (REINTENTAR). Se responde 200 solo después de guardar.
import crypto from 'node:crypto'
import express, { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../config.js'
import { conTransaccion, sinUsuario } from '../db.js'
import { Q, QConservar } from '../consultas.js'

const VENTANA_S = 300 // un aviso con más de 5 minutos de diferencia respecto a la hora del servidor se rechaza (evita repeticiones)
const MAX_AVISOS = 50

// El cuerpo se guarda tal como llegó: la firma se calcula sobre esos mismos bytes, no sobre el JSON ya interpretado.
export const analizarCuerpoEventos = express.json({ limit: '2mb', verify: (req, res, buf) => { req.cuerpoCrudo = buf } })
export const rutasEventosN8n = Router()
const limiteAvisos = rateLimit({ windowMs: 60 * 1000, limit: 600, keyGenerator: (req) => ipKeyGenerator(req.ip), standardHeaders: true, legacyHeaders: false })

// ---------------------------------------------------------------- firma
export function firmaValida(req) {
  const fecha = req.get('x-praxia-fecha') || ''
  const firma = req.get('x-praxia-firma') || ''
  if (!/^\d{9,12}$/.test(fecha) || !/^[0-9a-fA-F]{64}$/.test(firma)) return false
  if (Math.abs(Date.now() / 1000 - Number(fecha)) > VENTANA_S) return false
  const crudo = req.cuerpoCrudo || Buffer.alloc(0)
  const recibida = Buffer.from(firma, 'hex')
  // Se aceptan el secreto vigente y el anterior (rotación sin cortes); la comparación es de tiempo constante.
  for (const secreto of [config.n8nEventosSecreto, config.n8nEventosSecretoAnterior]) {
    if (!secreto) continue
    const esperada = crypto.createHmac('sha256', secreto).update(fecha + '.').update(crudo).digest()
    if (esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida)) return true
  }
  return false
}

// ---------------------------------------------------------------- forma de los avisos
const texto = (n) => z.string().transform((s) => s.slice(0, n))
const idTexto = z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(100))
const UrlGoogle = z.string().max(600).regex(/^https:\/\/(docs|drive)\.google\.com\//)
const entero = z.number().int().min(0).max(1e9)
// Imagen del recurso y consumo de IA: un valor inválido (http, con espacios o comillas, demasiado grande) se ignora en vez de rechazar el aviso.
export const esUrlImagen = (v) => {
  if (typeof v !== 'string' || v.length > 500 || !/^https:\/\/[^\s"'<>]+$/.test(v)) return false
  const sinQuery = v.split(/[?#]/)[0].toLowerCase()
  if (sinQuery.includes('/plantillas-html/') || /\.(html?|json)$/.test(sinQuery)) return false
  if (/^https:\/\/proyectos\.americana\.edu\.co\//.test(sinQuery) && sinQuery.includes('/api/')) return false
  return true
}
const ImagenUrl = z.preprocess((v) => (esUrlImagen(v) ? v : undefined), z.string().optional())
const Consumo = z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length <= 4000 ? v : undefined), z.record(z.string(), z.unknown()).optional())
// n8n arma los avisos con cadenas vacías donde no hay dato (origen_trabajo_id: '', enlace_recurso: ''…): una cadena vacía cuenta como «sin dato»,
// no como un identificador o un enlace mal formados (antes se rechazaban con 400 y el emisor de n8n descarta los 400 sin reintentar).
const sinVacio = (v) => (typeof v === 'string' && v.trim() === '' ? null : v)
const opc = (esquema) => z.preprocess(sinVacio, esquema.nullish())

const Comun = z.object({
  evento_id: z.string().regex(/^[A-Za-z0-9_.:-]{8,100}$/),
  etapa: z.enum(['guiones', 'matrices', 'h5p']),
  trabajo_id: opc(z.string().uuid()),
  origen_trabajo_id: opc(z.string().uuid()),
  proyecto_id: opc(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)),
  carpeta_raiz: opc(UrlGoogle),
  secuencia: entero.nullish(),
  fecha_evento: z.string().datetime({ offset: true })
})
const ejecucion = z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(100))

// Tolerante a propósito: un nombre raro nunca debe tumbar el aviso entero (n8n descarta los 400 sin reintentar).
// El contenido final del recurso (el JSON con el que se pintó la plantilla): un objeto, o ese mismo objeto como texto JSON (n8n suele mandarlo así).
// Es tolerante: si no es un objeto o pasa de MAX_CONTENIDO se toma como «sin dato» (un 400 haría que n8n descartara todo el aviso, estado incluido).
const MAX_CONTENIDO = 400 * 1024
const ContenidoAviso = z.preprocess((v) => {
  if (typeof v === 'string') { if (!v.trim()) return null; try { v = JSON.parse(v) } catch { return null } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  if (JSON.stringify(v).length > MAX_CONTENIDO) { console.warn('[avisos] contenido de recurso demasiado grande: se ignora'); return null }
  return v
}, z.record(z.string(), z.any()).nullish())
const PlantillaAviso = z.string().transform((x) => x.trim().toLowerCase().slice(0, 80))
// Partes extra del H5P (actividad y bibliografía): una parte inválida se IGNORA (null) sin rechazar el aviso.
const MAX_PARTE = 200000
const NOMBRE_PLANTILLA = /^[a-z0-9-]{1,80}$/
const ParteAviso = z.preprocess((v) => {
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return null } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const plantilla = typeof v.plantilla === 'string' ? v.plantilla.trim().toLowerCase() : ''
  let c = v.contenido
  if (typeof c === 'string') { try { c = JSON.parse(c) } catch { c = null } }
  if (!NOMBRE_PLANTILLA.test(plantilla) || !c || typeof c !== 'object' || Array.isArray(c)) { console.warn('[avisos] parte de recurso inválida: se ignora'); return null }
  if (JSON.stringify(c).length > MAX_PARTE) { console.warn('[avisos] parte de recurso demasiado grande: se ignora'); return null }
  return { plantilla, contenido: c, ...(esUrlImagen(v.imagen_url) ? { imagen_url: v.imagen_url } : {}) }
}, z.object({ plantilla: z.string(), contenido: z.record(z.string(), z.any()), imagen_url: z.string().optional() }).nullish())
const TipoActividad = z.preprocess((v) => (typeof v === 'string' && v.trim() && v.length <= 200 ? v.trim() : null), z.string().nullish())
const ActividadGuion = z.preprocess((v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  try { if (JSON.stringify(v).length > 4000) return null } catch { return null }
  return v
}, z.record(z.string(), z.any()).nullish())
const Fila = z.object({
  id: idTexto,
  id_base: texto(100).nullish(), variante: texto(100).nullish(), alcance: texto(100).nullish(),
  tema: z.number().int().min(0).max(999).nullish(),
  codigo: texto(100).nullish(), formato: texto(100).nullish(), titulo: texto(500).nullish(),
  con_actividad: z.boolean().nullish(), generador: texto(30).nullish(),
  estado: z.enum(['PENDIENTE', 'EN_PROCESO', 'POR_REVISAR', 'GENERADO', 'ERROR']),
  observaciones: texto(2000).nullish(), enlace_guion: opc(UrlGoogle), enlace_recurso: opc(UrlGoogle),
  plantilla: opc(PlantillaAviso) // nombre de la plantilla de Praxia («g-11-doc-v01»); una cadena vacía cuenta como «sin dato»
})
const Motivo = z.string().regex(/^[a-z0-9_]{1,60}$/)

const Evento = z.discriminatedUnion('evento', [
  Comun.extend({
    evento: z.literal('guiones_terminados'),
    unidad: z.number().int().min(0).max(99), formacion: texto(60).nullish(), resultado: z.enum(['ok', 'error']), detalle: texto(2000).nullish(),
    guiones: z.array(z.object({ tema: z.number().int().min(0).max(999).nullish(), nombre: texto(300).nullish(), url: UrlGoogle })).max(200).default([])
  }),
  Comun.extend({
    evento: z.literal('matrices_inicio'), ejecucion_id: ejecucion,
    unidades: z.array(z.number().int().min(1).max(99)).min(1).max(100), forzar: z.boolean().default(false), conservar: z.boolean().optional()
  }),
  Comun.extend({
    evento: z.literal('matrices_fin'), ejecucion_id: ejecucion,
    resultados: z.array(z.object({
      unidad: z.number().int().min(1).max(99), formacion: texto(60).nullish(),
      resultado: z.enum(['creada', 'omitida_ya_existe', 'reemplazada', 'actualizada', 'error']),
      matriz: z.object({ id: texto(200).nullish(), url: opc(UrlGoogle), nombre: texto(300).nullish() }).nullish(),
      anterior_id: texto(200).nullish(), detalle: texto(2000).nullish(),
      filas: z.array(Fila).max(2000).nullish()
    })).min(1).max(100)
  }),
  Comun.extend({
    evento: z.literal('h5p_inicio'), ejecucion_id: ejecucion, maximo: z.number().int().min(0).max(100000).nullish(),
    plan: z.object({
      a_generar: z.array(z.object({ id: idTexto, codigo: texto(100).nullish() })).max(5000).default([]),
      omitidas: z.array(z.object({ id: idTexto, codigo: texto(100).nullish(), motivo: Motivo })).max(5000).default([])
    })
  }),
  Comun.extend({
    evento: z.literal('h5p_recurso'), ejecucion_id: ejecucion,
    unidad: z.number().int().min(0).max(99).nullish(), id: idTexto, codigo: texto(100).nullish(),
    estado: z.enum(['PENDIENTE', 'EN_PROCESO', 'POR_REVISAR', 'GENERADO', 'ERROR']), enlace_recurso: opc(UrlGoogle), observaciones: texto(2000).nullish(),
    plantilla: opc(PlantillaAviso), contenido: ContenidoAviso, imagen_url: ImagenUrl, consumo: Consumo,
    tipo_actividad: TipoActividad, actividad_guion: ActividadGuion, actividad: ParteAviso, bibliografia: ParteAviso,
    alerta_actividad: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 600) : null), z.string().nullish()), // lo que no es texto se ignora sin rechazar el aviso
    revision_pendiente: z.preprocess((v) => (typeof v === 'string' && /^\d{1,4}$/.test(v.trim()) ? Number(v) : (Number.isInteger(v) && v >= 0 && v <= 9999 ? v : null)), z.number().nullish()) // campos que quedaron para revisión humana; lo no válido cuenta como «sin dato»
  }),
  Comun.extend({
    evento: z.literal('h5p_fin'), ejecucion_id: ejecucion,
    resumen: z.object({ generados: entero.default(0), errores: entero.default(0), omitidos: entero.default(0), pendientes_restantes: entero.nullish(), por_revisar: entero.nullish() })
  })
])

// Lo que queda en el registro de avisos: el aviso sin las listas pesadas (se guardan resumidas).
function resumir(ev) {
  const { filas, guiones, resultados, plan, contenido, ...resto } = ev
  const salida = { ...resto }
  if (contenido) salida.contenido = 'objeto (' + Object.keys(contenido).length + ' campos)'
  if (guiones) salida.guiones = guiones.length
  if (resultados) salida.resultados = resultados.map((r) => ({ unidad: r.unidad, resultado: r.resultado, filas: r.filas ? r.filas.length : null }))
  if (plan) salida.plan = { a_generar: plan.a_generar.length, omitidas: plan.omitidas.length }
  return salida
}

// ---------------------------------------------------------------- aplicar un aviso
async function resolverOrigen(c, ev) {
  for (const id of [ev.trabajo_id, ev.origen_trabajo_id]) {
    if (!id) continue
    const f = (await c.query(Q.pipeOrigenObtener, [id])).rows[0]
    if (f) return f
  }
  return null
}

// Clave de la fila a la que se refiere un aviso de H5P: la que se guardó con su código (cuando los ids se repiten) o, si no, su id.
async function claveFila(c, P, Y, id, codigo) {
  if (codigo) {
    const f = (await c.query(Q.pipeFilaPorClave, [P, Y, String(codigo).slice(0, 100)])).rows[0]
    if (f) return f.id
  }
  return String(id)
}

// Devuelve cuántos cambios se hicieron de verdad (0 = el aviso era más antiguo que lo ya guardado) o null si no toca ninguna tabla.
async function aplicar(c, ev, o, fecha, sec) {
  const P = o.propietario_id
  const Y = o.proyecto_id
  const eje = ev.ejecucion_id
  const carpeta = ev.carpeta_raiz || o.carpeta_raiz || null
  const base = [P, Y, ev.etapa, eje, ev.trabajo_id || null, ev.origen_trabajo_id || null, carpeta]
  let n = 0
  switch (ev.evento) {
    case 'guiones_terminados':
      return null // hoy solo queda en el registro de avisos (los guiones ya los guarda el trabajo de guiones al recoger su respuesta)
    case 'matrices_inicio':
      await c.query(Q.pipeEjecucionInicio, [...base, null, null, fecha]) // la corrida se anota siempre; el aviso cuenta como aplicado solo si cambia el estado de alguna matriz
      for (const u of ev.unidades) n += (await c.query(Q.pipeMatrizGuardar, [P, Y, u, null, 'generando', null, null, null, null, null, fecha, sec])).rowCount
      return n
    case 'matrices_fin': {
      const ESTADO = { creada: 'creada', omitida_ya_existe: 'omitida', reemplazada: 'reemplazada', actualizada: 'actualizada', error: 'error' }
      for (const r of ev.resultados) {
        const estado = ESTADO[r.resultado]
        const m = r.matriz || {}
        const g = await c.query(Q.pipeMatrizGuardar, [P, Y, r.unidad, r.formacion || null, estado, m.id || null, m.url || null, m.nombre || null, r.detalle || null, r.filas ? r.filas.length : null, fecha, sec])
        if (!g.rowCount) continue // un aviso más antiguo que lo que ya hay de esa unidad
        n++
        if (r.filas && estado !== 'error') {
          // El «ID del recurso» de la matriz es el del catálogo (G-11-A…) y se repite entre temas Y entre unidades; la fila se distingue por su código de posición
          // (U1-T2-R3), único por curso. Por eso la clave de la fila es SIEMPRE el código cuando viene; sin código, el id (como antes). Las filas guardadas antes con el id
          // como clave siguen funcionando (los avisos de H5P las encuentran por id) y se reemplazan solas cuando se vuelven a generar las matrices de su unidad.
          const repetidos = new Set(r.filas.map((f) => f.id)).size !== r.filas.length
          if (repetidos && r.filas.some((f) => !f.codigo)) console.warn('[avisos] matrices_fin con ids de fila repetidos y filas sin código (unidad ' + r.unidad + '): se perderán filas')
          const claves = r.filas.map((f) => f.codigo || f.id)
          for (const [k, f] of r.filas.entries()) {
            // «actualizada»: n8n conservó la hoja; sus filas no deben degradar lo que Praxia ya tiene (variante «no degradar»)
            await c.query(estado === 'actualizada' ? QConservar : Q.pipeRecursoGuardar, [P, Y, claves[k], r.unidad, f.id_base || null, f.variante || null, f.alcance || null, f.tema ?? null, f.codigo || null, f.formato || null, f.titulo || null,
              f.con_actividad ?? null, f.generador || null, f.estado, f.observaciones || null, f.enlace_guion || null, f.enlace_recurso || null, null, fecha, sec, f.plantilla || null, null, null, null, null, null, null, null, null, null])
          }
          await c.query(Q.pipeRecursosQuitarSobrantes, [P, Y, r.unidad, claves, fecha])
        }
      }
      await c.query(Q.pipeEjecucionFin, [...base, JSON.stringify({ resultados: ev.resultados.map((r) => ({ unidad: r.unidad, resultado: r.resultado })) }), fecha])
      return n
    }
    case 'h5p_inicio':
      await c.query(Q.pipeEjecucionInicio, [...base, ev.maximo ?? null, JSON.stringify(ev.plan), fecha])
      n++
      {
        const aGenerar = new Set()
        for (const g of ev.plan.a_generar) aGenerar.add(await claveFila(c, P, Y, g.id, g.codigo))
        for (const om of ev.plan.omitidas) {
          const clave = await claveFila(c, P, Y, om.id, om.codigo)
          n += (await c.query(Q.pipeRecursoOmitir, [P, Y, clave, om.motivo, fecha, sec])).rowCount
          // «regenerar» que n8n omitió: la fila no se va a procesar, vuelve a lo que era
          if (!aGenerar.has(clave)) n += (await c.query(Q.pipeRegenerarRestaurar, [P, Y, [clave], 'No se regeneró: n8n lo omitió (' + om.motivo + ')', fecha])).rowCount
        }
      }
      return n
    case 'h5p_recurso': {
      const r = await c.query(Q.pipeRecursoGuardar, [P, Y, await claveFila(c, P, Y, ev.id, ev.codigo), ev.unidad ?? null, null, null, null, null, ev.codigo || null, null, null, null, null, ev.estado,
        ev.observaciones || null, null, ev.enlace_recurso || null, null, fecha, sec, ev.plantilla || null, ev.contenido ? JSON.stringify(ev.contenido) : null, ev.revision_pendiente ?? null, ev.imagen_url || null, ev.consumo ? JSON.stringify(ev.consumo) : null,
        ev.tipo_actividad || null, ev.actividad_guion ? JSON.stringify(ev.actividad_guion) : null, ev.actividad ? JSON.stringify(ev.actividad) : null, ev.bibliografia ? JSON.stringify(ev.bibliografia) : null, ev.alerta_actividad ?? null])
      // Un recurso que termina (GENERADO/ERROR) solo avanza una corrida que ya existe; si no hay corrida es una publicación tras aprobar y no debe aparecer como «generando».
      if (ev.estado === 'GENERADO' || ev.estado === 'ERROR') await c.query(Q.pipeEjecucionTocarExistente, [P, Y, ev.etapa, eje, fecha])
      else await c.query(Q.pipeEjecucionTocar, [...base, fecha])
      return r.rowCount
    }
    case 'h5p_fin': {
      const plan = (await c.query(Q.pipeEjecucionPlan, [P, Y, ev.etapa, eje])).rows[0]?.plan
      await c.query(Q.pipeEjecucionFin, [...base, JSON.stringify(ev.resumen), fecha])
      if (plan && Array.isArray(plan.a_generar)) {
        const aGenerar = new Set()
        for (const g of plan.a_generar) aGenerar.add(await claveFila(c, P, Y, g.id, g.codigo))
        const sobrantes = (await c.query(Q.pipeRegenerarPendientes, [P, Y])).rows.map((f) => f.id).filter((id) => !aGenerar.has(id))
        if (sobrantes.length) await c.query(Q.pipeRegenerarRestaurar, [P, Y, sobrantes, 'No se regeneró: la corrida terminó sin procesarlo', fecha])
      }
      return 1
    }
    default:
      return null
  }
}

// Cada aviso va en su propia transacción: el aviso queda registrado y aplicado, o ninguna de las dos cosas (y n8n reintenta).
async function procesar(ev) {
  const ahora = new Date()
  const f = new Date(ev.fecha_evento)
  const fecha = (f.getTime() > ahora.getTime() + 5 * 60 * 1000 ? ahora : f).toISOString() // un reloj adelantado no puede bloquear los avisos siguientes
  const sec = ev.secuencia ?? 0
  return conTransaccion(async (c) => {
    const o = await resolverOrigen(c, ev)
    let resultado = 'aplicado'
    let motivo = null
    if (!o) { resultado = 'huerfano'; motivo = 'sin_trabajo'; console.warn('[avisos] huérfano: ' + ev.evento + ' sin trabajo conocido (trabajo_id ' + (ev.trabajo_id || '-') + ', origen_trabajo_id ' + (ev.origen_trabajo_id || '-') + ')') }
    else if (ev.proyecto_id && ev.proyecto_id !== o.proyecto_id) { resultado = 'rechazado'; motivo = 'proyecto_distinto' }
    const ins = await c.query(Q.pipeEventoInsertar, [ev.evento_id, ev.evento, ev.etapa, ev.trabajo_id || null, ev.origen_trabajo_id || null, ev.ejecucion_id || null,
      o ? o.propietario_id : null, o ? o.proyecto_id : null, ev.secuencia ?? null, fecha, resultado, motivo, JSON.stringify(resumir(ev))])
    if (!ins.rowCount) return { tipo: 'duplicado' } // ya recibido: un reintento de n8n no cambia nada
    if (resultado !== 'aplicado') return { tipo: resultado, motivo }
    const cambios = await aplicar(c, ev, o, fecha, sec)
    if (cambios === 0) {
      await c.query(Q.pipeEventoResultado, [ev.evento_id, 'ignorado_antiguo', 'mas_antiguo_que_lo_guardado'])
      return { tipo: 'ignorado' }
    }
    return { tipo: 'aplicado' }
  })
}

rutasEventosN8n.post('/eventos', limiteAvisos, async (req, res, next) => {
  try {
    if (!config.n8nEventosSecreto) return res.status(503).json({ error: 'El receptor de avisos no está configurado' })
    if (!firmaValida(req)) {
      console.warn('[avisos] rechazado 401: firma o fecha no válidas (cabecera de fecha: ' + (req.get('x-praxia-fecha') || 'ausente') + ', firma: ' + (req.get('x-praxia-firma') ? 'presente' : 'ausente') + ')')
      return res.status(401).json({ error: 'Firma o fecha no válidas' })
    }
    const cuerpo = req.body
    const lista = cuerpo && Array.isArray(cuerpo.eventos) ? cuerpo.eventos : cuerpo && typeof cuerpo === 'object' ? [cuerpo] : []
    if (!lista.length || lista.length > MAX_AVISOS) return res.status(400).json({ error: 'Envíe un aviso o entre 1 y ' + MAX_AVISOS + ' en «eventos»' })
    const avisos = []
    for (const [i, bruto] of lista.entries()) {
      const r = Evento.safeParse(bruto)
      if (!r.success) {
        const problemas = r.error.issues.slice(0, 3).map((x) => x.path.join('.') + ': ' + x.message)
        console.warn('[avisos] rechazado 400: aviso no válido (' + (bruto && bruto.evento) + '): ' + problemas.join(' | '))
        return res.status(400).json({ error: 'Aviso no válido', indice: i, problemas }) // contrato mal armado: no se guarda nada ni conviene reintentar
      }
      avisos.push(r.data)
    }
    const cuenta = { aplicados: 0, duplicados: 0, ignorados: 0, huerfanos: 0 }
    const rechazados = []
    for (const ev of avisos) {
      const r = await procesar(ev)
      if (r.tipo === 'aplicado') cuenta.aplicados++
      else if (r.tipo === 'duplicado') cuenta.duplicados++
      else if (r.tipo === 'ignorado') cuenta.ignorados++
      else if (r.tipo === 'huerfano') cuenta.huerfanos++
      else if (r.tipo === 'rechazado') rechazados.push({ evento_id: ev.evento_id, motivo: r.motivo })
    }
    const soloHuerfanos = cuenta.huerfanos > 0 && cuenta.aplicados + cuenta.duplicados + cuenta.ignorados === 0 && !rechazados.length
    res.status(soloHuerfanos ? 202 : 200).json({ ok: true, ...cuenta, rechazados, ...(soloHuerfanos ? { huerfano: true } : {}) })
  } catch (e) { next(e) }
})

// Origen de un trabajo que Praxia lanza: así cualquier aviso posterior de la cadena (aunque llegue semanas después, cuando el trabajo ya se
// recogió y se borró) se atribuye a la persona y al curso correctos.
export const registrarOrigen = ({ trabajoId, propietarioId, proyectoId, carpeta = null, etapa, unidad = null }) =>
  sinUsuario(Q.pipeOrigenGuardar, [trabajoId, propietarioId, proyectoId, carpeta, etapa, unidad])

export async function limpiarPipeline() {
  await sinUsuario(Q.pipeEventosLimpiar, [])
  await sinUsuario(Q.pipeOrigenLimpiar, [])
}
