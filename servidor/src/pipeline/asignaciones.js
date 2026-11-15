// Asignación de variantes de plantilla HTML por curso, ANTES de generar los guiones.
// n8n pide variante para los recursos de un curso; Praxia las reparte entre las variantes APROBADAS de la formación del curso, sin repetir ninguna dentro de
// la misma categoría en todo el curso (la regla la garantiza la base: sql/005), y guarda lo asignado. Lo asignado no cambia si se vuelve a pedir, salvo orden
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

export const rutasAsignaciones = Router()
const limite = rateLimit({ windowMs: 60 * 1000, limit: 300, keyGenerator: (req) => ipKeyGenerator(req.ip), standardHeaders: true, legacyHeaders: false })

const FORMACIONES = ['tecnologico', 'profesional', 'especializacion', 'doctorado']
const Codigo = z.string().regex(/^U[0-9]{1,3}-(PRES|T[0-9]{1,2}-R[0-9]{1,3})$/)
const Categoria = z.string().regex(/^[A-Za-z]{1,4}-[0-9]{2,3}$/).transform((s) => s.toUpperCase())
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
    id_base: Opc(z.string().max(100))
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
const unidadDe = (codigo) => Number(/^U(\d+)-/.exec(codigo)[1])

// Variantes que pueden asignarse a un recurso: de esa categoría, aprobadas (salvo que se pida lo contrario) y de la formación del curso.
// Las que no dicen su formación (subidas antiguas) también valen si la categoría sirve a esa formación, pero van después de las que sí la dicen.
function elegibles(variantes, formacion, formacionesCategoria, soloAprobadas) {
  if (!variantes.length) return { lista: [], motivo: 'categoria_sin_variantes' }
  if (formacionesCategoria.length && !formacionesCategoria.includes(formacion)) return { lista: [], motivo: 'categoria_no_es_de_la_formacion' }
  const deFormacion = variantes.filter((v) => v.formacion === formacion || !v.formacion)
  if (!deFormacion.length) return { lista: [], motivo: 'sin_variantes_de_la_formacion' }
  const validas = soloAprobadas ? deFormacion.filter((v) => v.ultimo === 'aprobada') : deFormacion
  if (!validas.length) return { lista: [], motivo: 'sin_variantes_aprobadas' }
  return { lista: [...validas.filter((v) => v.formacion === formacion), ...validas.filter((v) => !v.formacion)], motivo: null }
}

const forma = (f) => ({ codigo: f.codigo, unidad: f.unidad, id_catalogo: f.id_catalogo, id_base: f.id_base, categoria: f.categoria, formacion: f.formacion, plantilla: f.plantilla, estado: f.estado, motivo: f.motivo,
  ...(f.plantilla_anterior ? { plantilla_anterior: f.plantilla_anterior } : {}), asignada_en: f.asignada_en ? new Date(f.asignada_en).toISOString() : null })

rutasAsignaciones.post('/asignaciones/pedir', limite, async (req, res, next) => {
  try {
    const b = validar(Pedir, req, res)
    if (!b) return
    const o = (await sinUsuario(Q.pipeOrigenObtener, [b.trabajo_id])).rows[0]
    if (!o) return res.status(404).json({ error: 'trabajo_desconocido' })
    const resultados = await conTransaccion(async (c) => {
      // Un curso a la vez: las unidades que se piden en paralelo esperan su turno y ven lo que acaba de asignar la anterior.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['asign:' + o.propietario_id + ':' + o.proyecto_id])
      const cats = new Set((await c.query(Q.categoriasListar)).rows.map((k) => k.id))
      const formDe = {}
      for (const x of (await c.query(Q.formacionesListar)).rows) (formDe[x.categoria] ||= []).push(x.formacion)
      const existentes = Object.fromEntries((await c.query(Q.asignExistentes, [o.propietario_id, o.proyecto_id, b.recursos.map((r) => r.codigo)])).rows.map((f) => [f.codigo, f]))
      const porCategoria = {} // categoría → { variantes (elegibles), usadas }
      const cargar = async (cat) => {
        if (!porCategoria[cat]) {
          const vars = (await c.query(Q.asignElegibles, [cat])).rows
          porCategoria[cat] = { vars, usadas: new Set((await c.query(Q.asignUsadas, [o.propietario_id, o.proyecto_id, cat])).rows.map((x) => x.plantilla)) }
        }
        return porCategoria[cat]
      }
      const salida = []
      for (const r of b.recursos) {
        const ex = existentes[r.codigo]
        const unidad = r.unidad ?? unidadDe(r.codigo)
        if (!cats.has(r.categoria)) { salida.push({ codigo: r.codigo, resultado: 'error', motivo: 'categoria_inexistente', categoria: r.categoria, plantilla: null }); continue }
        if (ex && ex.estado === 'asignada' && !b.forzar) {
          // Idempotente: lo ya asignado no cambia. Si ahora piden otra categoría para ese código, se avisa en vez de pisarlo.
          if (ex.categoria !== r.categoria) { salida.push({ ...forma(ex), resultado: 'conflicto', motivo: 'ya_asignada_en_otra_categoria' }); continue }
          salida.push({ ...forma(ex), resultado: 'ya_asignada' })
          continue
        }
        const cat = await cargar(r.categoria)
        if (ex && ex.plantilla && b.forzar) { (porCategoria[ex.categoria] || (await cargar(ex.categoria))).usadas.delete(ex.plantilla) } // recalcular desde cero libera la suya
        const { lista, motivo } = elegibles(cat.vars, b.formacion, formDe[r.categoria] || [], b.solo_aprobadas)
        const libre = lista.find((v) => !cat.usadas.has(v.nombre))
        const base = [o.propietario_id, o.proyecto_id, r.codigo, unidad, r.id_catalogo || null, r.id_base || null, r.categoria, b.formacion]
        const anterior = ex ? (ex.plantilla || ex.plantilla_anterior || null) : null
        if (libre) {
          cat.usadas.add(libre.nombre)
          await c.query(Q.asignGuardar, [...base, libre.nombre, null, 'asignada', null, b.trabajo_id])
          salida.push({ codigo: r.codigo, resultado: 'asignada', categoria: r.categoria, formacion: b.formacion, plantilla: libre.nombre, motivo: null })
        } else {
          const m = motivo || 'variantes_agotadas' // había elegibles pero ya las tienen otros recursos del curso
          await c.query(Q.asignGuardar, [...base, null, anterior, 'pendiente', m, b.trabajo_id])
          salida.push({ codigo: r.codigo, resultado: 'pendiente', categoria: r.categoria, formacion: b.formacion, plantilla: null, motivo: m })
        }
      }
      return salida
    })
    const cuenta = (x) => resultados.filter((r) => r.resultado === x).length
    res.json({ ok: true, proyecto_id: o.proyecto_id, resultados, resumen: { asignadas: cuenta('asignada'), ya_asignadas: cuenta('ya_asignada'), pendientes: cuenta('pendiente'), conflictos: cuenta('conflicto'), errores: cuenta('error') } })
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
