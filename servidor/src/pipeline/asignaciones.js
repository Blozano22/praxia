// Asignación de variantes de plantilla HTML por curso, ANTES de generar los guiones.
// n8n pide variante para los recursos de un curso; Praxia las reparte entre las variantes APROBADAS de la formación del curso, sin repetir ninguna dentro de
// la misma categoría dentro de cada UNIDAD (la regla la garantiza la base: sql/013; antes valía para todo el curso), y guarda lo asignado. Lo asignado no cambia si se vuelve a pedir, salvo orden
// explícita (forzar). Misma protección que los avisos (src/pipeline/eventos.js): sin sesión, con FIRMA HMAC sobre el cuerpo, y la persona y el curso salen de
// pipeline_origen a partir del trabajo_id (nunca de lo que diga n8n). Por eso las dos rutas son POST: la firma cubre el cuerpo, que lleva lo que se pide.
//   POST /api/n8n/asignaciones/pedir      reparte (y guarda) variantes para una lista de recursos
//   POST /api/n8n/asignaciones/consultar  lee lo asignado de un curso (todo, una unidad, o una lista de códigos)
// cabeceras: X-Praxia-Fecha (segundos) · X-Praxia-Firma = HMAC-SHA256 hex de  fecha + "." + cuerpo exacto  (igual que los avisos).
// Respuestas: 200 · 400 cuerpo inválido · 401 firma o fecha · 404 trabajo_id desconocido · 409 choque de concurrencia (reintentar) · 429 · 503 sin secreto.
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../config.js'
import { conTransaccion, sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { firmaValida } from './eventos.js'
import { modoPruebasPlantillas } from './preparacion.js'

export const rutasAsignaciones = Router()
const limite = rateLimit({ windowMs: 60 * 1000, limit: 300, keyGenerator: (req) => ipKeyGenerator(req.ip), standardHeaders: true, legacyHeaders: false })

const FORMACIONES = ['tecnologico', 'profesional', 'especializacion', 'doctorado']
// «U1-T2-R3» es el recurso de la fila 3 de la tabla del tema 2; «U1-T2-A3» es la ACTIVIDAD de esa misma fila (el recurso y su actividad nacen en la misma fila y no pueden compartir código).
const Codigo = z.string().regex(/^U[0-9]{1,3}-(PRES|T[0-9]{1,2}-[RA][0-9]{1,3})$/)
const Categoria = z.string().regex(/^(?:[A-Za-z]{1,4}(?:-[A-Za-z]{1,4}){0,2}-[0-9]{2,3}|ACT-E-[0-9]{2,3}-(?:TEC|PRO|ESP|DOC))$/i).transform((s) => s.toUpperCase()) // «G-12», «PRE-05», «ACT-G-01», «ACT-E-03-TEC»
const sinVacio = (v) => (typeof v === 'string' && v.trim() === '' ? null : v)
const Opc = (esquema) => z.preprocess(sinVacio, esquema.nullish())

const Pedir = z.object({
  trabajo_id: z.string().uuid(),
  formacion: z.enum(FORMACIONES),
  forzar: z.boolean().default(false),
  solo_aprobadas: z.boolean().default(true), // false solo mientras aún no haya variantes aprobadas (pruebas)
  recursos: z.array(z.object({
    codigo: Codigo,
    categoria: Categoria,
    unidad: Opc(z.number().int().min(0).max(999)),
    id_catalogo: Opc(z.string().max(100)),
    id_base: Opc(z.string().max(100)),
    tipo_actividad: Opc(z.string().max(300)), // texto crudo del «Tipo de actividad» del guion: se compara con el nombre de las categorías de actividad
    calificable: z.boolean().nullish() // solo en categorías de actividad: true = la calificable de la unidad, false = práctica (lo lee n8n de la tabla de la unidad)
  })).min(1).max(500)
}).refine((b) => new Set(b.recursos.map((r) => r.codigo)).size === b.recursos.length, { message: 'hay códigos repetidos en «recursos»' })

const Consultar = z.object({
  trabajo_id: z.string().uuid(),
  unidad: Opc(z.number().int().min(0).max(999)),
  codigos: Opc(z.array(Codigo).min(1).max(500))
})

// Firma, secreto y forma del cuerpo; devuelve el cuerpo ya validado o responde y devuelve null.
function validar(esquema, req, res) {
  if (!config.n8nEventosSecreto) { res.status(503).json({ error: 'El receptor no está configurado' }); return null }
  if (!firmaValida(req)) { res.status(401).json({ error: 'Firma o fecha no válidas' }); return null }
  const r = esquema.safeParse(req.body)
  if (!r.success) { res.status(400).json({ error: 'Cuerpo no válido', problemas: r.error.issues.slice(0, 5).map((x) => x.path.join('.') + ': ' + x.message) }); return null }
  return r.data
}
// «Análisis de  Incidentes » → «analisis de incidentes»: sin mayúsculas, sin tildes, espacios colapsados y sin los de los extremos. Nada más (sin sinónimos).
export const normalizarTipo = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
// Código de la actividad de un recurso: U1-T1-R2 → U1-T1-A2 (la presentación nunca lleva actividad).
const codigoActividad = (codigo) => (/^U\d+-T\d+-R\d+$/.test(codigo) ? codigo.replace('-R', '-A') : null)
const unidadDe = (codigo) => Number(/^U(\d+)-/.exec(codigo)[1])

// Variantes que pueden asignarse a un recurso: de esa categoría, aprobadas (salvo que se pida lo contrario) y de la formación del curso.
// Las que no dicen su formación (subidas antiguas) valen SOLO si la categoría sirve a una única formación (entonces es la de la categoría); en una categoría compartida
// entre formaciones no se sabe de cuál es y no se reparten (habría que decirle su formación a la variante), y van después de las que sí la dicen.
export function elegibles(variantes, formacion, formacionesCategoria, soloAprobadas, pruebas = false) {
  if (!variantes.length) return { lista: [], motivo: 'categoria_sin_variantes' }
  // Modo de pruebas: todas las subidas, estén aprobadas o no y sean de la formación que sean; primero las de la formación del curso, luego las que no dicen formación.
  if (pruebas) { const rango = (v) => (v.formacion === formacion ? 0 : !v.formacion ? 1 : 2); return { lista: [...variantes].sort((a, b) => rango(a) - rango(b)), motivo: null } }
  if (formacionesCategoria.length && !formacionesCategoria.includes(formacion)) return { lista: [], motivo: 'categoria_no_es_de_la_formacion' }
  const sinFormacionVale = formacionesCategoria.length <= 1
  const deFormacion = variantes.filter((v) => v.formacion === formacion || (!v.formacion && sinFormacionVale))
  if (!deFormacion.length) return { lista: [], motivo: 'sin_variantes_de_la_formacion' }
  const validas = soloAprobadas ? deFormacion.filter((v) => v.ultimo === 'aprobada') : deFormacion
  if (!validas.length) return { lista: [], motivo: 'sin_variantes_aprobadas' }
  return { lista: [...validas.filter((v) => v.formacion === formacion), ...validas.filter((v) => !v.formacion)], motivo: null }
}

const azar = (l) => l[Math.floor(Math.random() * l.length)]
const avisoRepetida = (categoria) => 'Variante repetida: ya se usaron todas las de ese tipo en ' + categoria + ' dentro de esta unidad.'
// La calificable es una sola variante por categoría y formación: repetirla en un curso es lo normal y no lleva aviso (motivo «calificable_repetida»).
const forma = (f) => ({ codigo: f.codigo, unidad: f.unidad, id_catalogo: f.id_catalogo, id_base: f.id_base, categoria: f.categoria, formacion: f.formacion, plantilla: f.plantilla, estado: f.estado, motivo: f.motivo,
  repetida: !!f.repetida, aviso: f.repetida && f.motivo !== 'calificable_repetida' ? avisoRepetida(f.categoria) : null,
  ...(f.plantilla_anterior ? { plantilla_anterior: f.plantilla_anterior } : {}), asignada_en: f.asignada_en ? new Date(f.asignada_en).toISOString() : null })

rutasAsignaciones.post('/asignaciones/pedir', limite, async (req, res, next) => {
  try {
    const b = validar(Pedir, req, res)
    if (!b) return
    const o = (await sinUsuario(Q.pipeOrigenObtener, [b.trabajo_id])).rows[0]
    if (!o) return res.status(404).json({ error: 'trabajo_desconocido' })
    const pruebas = await modoPruebasPlantillas() // interruptor de la administración: ver preparacion.js
    const resultados = await conTransaccion(async (c) => {
      // Un curso a la vez: las unidades que se piden en paralelo esperan su turno y ven lo que acaba de asignar la anterior.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['asign:' + o.propietario_id + ':' + o.proyecto_id])
      const filasCats = (await c.query(Q.categoriasListar)).rows
      const cats = new Map(filasCats.map((k) => [k.id, k.tipo])) // categoría → 'recurso' | 'actividad' | 'bibliografia'
      const formDe = {}
      for (const x of (await c.query(Q.formacionesListar)).rows) (formDe[x.categoria] ||= []).push(x.formacion)
      const existentes = Object.fromEntries((await c.query(Q.asignExistentes, [o.propietario_id, o.proyecto_id, b.recursos.flatMap((r) => [r.codigo, ...(r.tipo_actividad && codigoActividad(r.codigo) ? [codigoActividad(r.codigo)] : [])])])).rows.map((f) => [f.codigo, f]))
      const porCategoria = {} // categoría → { variantes (elegibles), usadas }
      const cargar = async (cat) => {
        if (!porCategoria[cat]) {
          const vars = (await c.query(Q.asignElegibles, [cat])).rows
          const us = (await c.query(Q.asignUsadas, [o.propietario_id, o.proyecto_id, cat])).rows
          // La unicidad es POR UNIDAD: por cada unidad, usadas = variantes ya dadas a un recurso de esa unidad (sin contar las repetidas); veces = cuántos recursos tienen cada una (para repartir las repeticiones)
          const porUnidad = new Map()
          for (const x of us) {
            if (!porUnidad.has(x.unidad)) porUnidad.set(x.unidad, { usadas: new Set(), veces: new Map() })
            const u = porUnidad.get(x.unidad)
            if (x.original) u.usadas.add(x.plantilla)
            u.veces.set(x.plantilla, x.veces)
          }
          porCategoria[cat] = { vars, porUnidad }
        }
        return porCategoria[cat]
      }
      const usoDe = (cat, unidad) => { const k = unidad ?? -1; if (!cat.porUnidad.has(k)) cat.porUnidad.set(k, { usadas: new Set(), veces: new Map() }); return cat.porUnidad.get(k) }
      const salida = []
      const procesar = async (r) => {
        const ex = existentes[r.codigo]
        const unidad = r.unidad ?? unidadDe(r.codigo)
        if (!cats.has(r.categoria)) { return { codigo: r.codigo, resultado: 'error', motivo: 'categoria_inexistente', categoria: r.categoria, plantilla: null } }
        if (cats.get(r.categoria) === 'bibliografia') { return { codigo: r.codigo, resultado: 'error', motivo: 'categoria_de_bibliografia', categoria: r.categoria, plantilla: null } } // no se reparten por recurso
        if (ex && ex.estado === 'asignada' && !b.forzar) {
          // Idempotente: lo ya asignado no cambia. Si ahora piden otra categoría para ese código, se avisa en vez de pisarlo.
          if (ex.categoria !== r.categoria) { return { ...forma(ex), resultado: 'conflicto', motivo: 'ya_asignada_en_otra_categoria' } }
          return { ...forma(ex), resultado: 'ya_asignada' }
        }
        const esAct = cats.get(r.categoria) === 'actividad'
        // En las categorías de actividad hay que saber si el recurso es la calificable o una práctica: lo dice n8n (lo lee de la tabla de la unidad); Praxia no lo adivina.
        if (esAct && typeof r.calificable !== 'boolean') { return { codigo: r.codigo, resultado: 'error', motivo: 'falta_calificable', categoria: r.categoria, plantilla: null } }
        const cat = await cargar(r.categoria)
        const uso = usoDe(cat, unidad) // lo usado en ESTA unidad
        if (ex && ex.plantilla && b.forzar) { // recalcular desde cero libera la suya
          const uf = usoDe(porCategoria[ex.categoria] || (await cargar(ex.categoria)), ex.unidad)
          if (!ex.repetida) uf.usadas.delete(ex.plantilla)
          uf.veces.set(ex.plantilla, Math.max(0, (uf.veces.get(ex.plantilla) || 0) - 1))
        }
        // actividades: solo las del tipo pedido (calificable o práctica)
        const delTipo = esAct ? cat.vars.filter((v) => v.calificable === r.calificable) : cat.vars
        let { lista, motivo } = elegibles(delTipo, b.formacion, formDe[r.categoria] || [], b.solo_aprobadas, pruebas)
        if (esAct && cat.vars.length && !delTipo.length) motivo = r.calificable ? 'categoria_sin_calificables' : 'categoria_sin_practicas'
        let libre, repetida = false
        if (esAct) {
          // al azar entre las libres; si ya se usaron todas, se REPITE una (la menos usada) y se avisa en vez de dejar el recurso sin variante
          const libres = lista.filter((v) => !uso.usadas.has(v.nombre))
          const preferidas = pruebas ? libres.filter((v) => v.formacion === b.formacion) : [] // en pruebas, si hay libres de la formación del curso, esas primero
          libre = libres.length ? azar(preferidas.length ? preferidas : libres) : null
          if (!libre && lista.length) {
            const min = Math.min(...lista.map((v) => uso.veces.get(v.nombre) || 0))
            libre = azar(lista.filter((v) => (uso.veces.get(v.nombre) || 0) === min))
            repetida = true
          }
        } else libre = lista.find((v) => !uso.usadas.has(v.nombre))
        const base = [o.propietario_id, o.proyecto_id, r.codigo, unidad, r.id_catalogo || null, r.id_base || null, r.categoria, b.formacion]
        const anterior = ex ? (ex.plantilla || ex.plantilla_anterior || null) : null
        if (libre) {
          if (!repetida) uso.usadas.add(libre.nombre)
          uso.veces.set(libre.nombre, (uso.veces.get(libre.nombre) || 0) + 1)
          const motivoRep = r.calificable === true ? 'calificable_repetida' : 'variante_repetida'
          await c.query(Q.asignGuardar, [...base, libre.nombre, null, 'asignada', repetida ? motivoRep : null, b.trabajo_id, repetida])
          return { codigo: r.codigo, resultado: 'asignada', categoria: r.categoria, formacion: b.formacion, plantilla: libre.nombre, motivo: repetida ? motivoRep : null, repetida, aviso: repetida && r.calificable !== true ? avisoRepetida(r.categoria) : null }
        } else {
          const m = motivo || 'variantes_agotadas' // había elegibles pero ya las tienen otros recursos de la misma unidad
          await c.query(Q.asignGuardar, [...base, null, anterior, 'pendiente', m, b.trabajo_id, false])
          return { codigo: r.codigo, resultado: 'pendiente', categoria: r.categoria, formacion: b.formacion, plantilla: null, motivo: m, repetida: false, aviso: null }
        }
      }
      // Plantilla de bibliografía de la formación del curso: la misma para todos los recursos; no se guarda en asignacion_variantes.
      let bibliografia = { plantilla: null, motivo: 'sin_plantilla_bibliografia' }
      for (const [id, tipo] of cats) {
        if (tipo !== 'bibliografia' || !(formDe[id] || []).includes(b.formacion)) continue
        const cat = await cargar(id)
        const { lista } = elegibles(cat.vars, b.formacion, formDe[id] || [], b.solo_aprobadas, pruebas)
        if (lista.length) { bibliografia = { plantilla: lista[0].nombre }; break }
      }
      // El «Tipo de actividad» del guion se compara (normalizado) con el NOMBRE de las categorías de actividad marcadas para la formación del curso
      // (las variantes sin formación las resuelve elegibles). Con varias coincidencias manda la de la formación del curso.
      const nombresAct = new Map()
      for (const k of filasCats) if (k.tipo === 'actividad') { const n = normalizarTipo(k.nombre); if (n) (nombresAct.get(n) || nombresAct.set(n, []).get(n)).push(k.id) }
      const categoriaPorNombre = (texto) => {
        const ids = nombresAct.get(normalizarTipo(texto)) || []
        return ids.find((id) => (formDe[id] || []).includes(b.formacion))
      }
      for (const r of b.recursos) {
        const e = await procesar(r)
        const codAct = codigoActividad(r.codigo)
        if (r.tipo_actividad && codAct) {
          const real = categoriaPorNombre(r.tipo_actividad)
          if (!real) {
            e.actividad = { codigo: codAct, resultado: 'omitida', motivo: 'tipo_actividad_sin_categoria', tipo: r.tipo_actividad }
            await c.query(Q.pipeRecursoAlerta, [o.propietario_id, o.proyecto_id, r.codigo, 'ALERTA: El tipo de actividad «' + r.tipo_actividad + '» del guion no coincide con el nombre de ninguna categoría de actividad de la formación: corrija el guion o las categorías y regenere el recurso.'])
          } else {
            const a = await procesar({ codigo: codAct, categoria: real, unidad: r.unidad, id_catalogo: r.id_catalogo, id_base: r.id_base, calificable: r.calificable })
            e.actividad = { codigo: a.codigo, categoria: a.categoria, plantilla: a.plantilla ?? null, resultado: a.resultado, ...(a.motivo ? { motivo: a.motivo } : {}) }
          }
        }
        e.bibliografia = bibliografia
        salida.push(e)
      }
      return salida
    })
    const cuenta = (x) => resultados.filter((r) => r.resultado === x).length
    res.json({ ok: true, ...(pruebas ? { modo_pruebas: true } : {}), proyecto_id: o.proyecto_id, resultados, resumen: { asignadas: cuenta('asignada'), ya_asignadas: cuenta('ya_asignada'), pendientes: cuenta('pendiente'), conflictos: cuenta('conflicto'), errores: cuenta('error') } })
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'conflicto_concurrente', detalle: 'Otra petición asignó una variante a la vez; repita la petición.' })
    next(e)
  }
})

rutasAsignaciones.post('/asignaciones/consultar', limite, async (req, res, next) => {
  try {
    const b = validar(Consultar, req, res)
    if (!b) return
    const o = (await sinUsuario(Q.pipeOrigenObtener, [b.trabajo_id])).rows[0]
    if (!o) return res.status(404).json({ error: 'trabajo_desconocido' })
    const filas = (await sinUsuario(Q.asignConsultar, [o.propietario_id, o.proyecto_id, b.unidad ?? null, b.codigos ?? null])).rows
    res.json({ ok: true, proyecto_id: o.proyecto_id, asignaciones: filas.map(forma) })
  } catch (e) { next(e) }
})

// Marca como inválido lo asignado a un curso con una plantilla que se elimina, se mueve o cuya categoría se elimina (tabla de sql/005). Si esa tabla aún no existe
// (se desplegó el código antes de «npm run db:migrar») NO se rompe la gestión de plantillas: se avisa en el registro y se sigue. Va en un punto de guardado para que
// el error no deje abortada la transacción de quien llama.
export async function invalidarAsignaciones(c, texto, valores) {
  await c.query('SAVEPOINT asignaciones')
  try { await c.query(texto, valores); await c.query('RELEASE SAVEPOINT asignaciones') } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT asignaciones')
    if (e && e.code !== '42P01') throw e
    console.warn('[asignación] falta la tabla asignacion_variantes: ejecute npm run db:migrar')
  }
}
