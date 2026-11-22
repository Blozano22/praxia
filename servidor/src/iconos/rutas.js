// Banco de íconos: SVG reemplazables que el flujo de H5P coloca en los campos «icono» de las plantillas.
//  · rutasIconos (con sesión, /api/iconos): la pantalla del banco. Ver: quien ve las plantillas. Subir, editar y archivar: quien revisa o sube plantillas.
//  · rutasBancoIconos (con clave, /api/banco-iconos): lo que consume el servicio de H5P (lista por lotes con versión, un ícono por id y búsqueda). Cabecera X-API-Key.
// Cada SVG se normaliza al guardarlo (ver normalizar.js): sin colores fijos, sin elementos peligrosos y con los id de los degradados prefijados con el id del ícono.
import crypto from 'node:crypto'
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { config } from '../config.js'
import { exigirAlguno, exigirPermiso, exigirSesion } from '../seguridad.js'
import { normalizarSvg } from './normalizar.js'

export const rutasIconos = Router()
export const rutasBancoIconos = Router()

const MAX_PAQUETE = 400
const ip = (req) => String(req.ip || '').slice(0, 64)
const auditar = (usuarioId, accion, id, req) => sinUsuario(Q.auditoriaRegistrar, [usuarioId, accion, 'icono', String(id).slice(0, 100), ip(req)]).catch(() => {})
const limiteEscribir = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.LIMITE_ICONOS || 60), keyGenerator: (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip)), standardHeaders: true, legacyHeaders: false })
const limiteServicio = rateLimit({ windowMs: 60 * 1000, limit: 600, keyGenerator: (req) => ipKeyGenerator(req.ip), standardHeaders: true, legacyHeaders: false })

// ---- forma de los datos
const Id = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'solo a-z, 0-9 y guiones').max(80)
const Texto = (min, max) => z.string().trim().min(min).max(max)
const Opc = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).nullish())
const Etiquetas = z.array(z.string().trim().min(1).max(40)).min(3, 'mínimo 3 etiquetas').max(12, 'máximo 12 etiquetas')
const Meta = z.object({
  tipo: z.enum(['recurso', 'actividad']),
  categoria: Opc(80), subcategoria: Opc(80),
  nombre_es: Texto(1, 80), nombre_en: Texto(1, 80),
  etiquetas_es: Etiquetas, etiquetas_en: Etiquetas,
  descripcion: Texto(10, 400), prompt: Texto(3, 2000),
  estilo: z.string().trim().regex(/^[a-z0-9-]{1,40}$/, 'solo a-z, 0-9 y guiones (máx. 40)'),
  tonos: z.union([z.literal(1), z.literal(2)], { message: 'debe ser 1 o 2' }),
  conjunto: Opc(60)
})
const IconoNuevo = Meta.extend({ id: Id, svg: z.string().min(1, 'falta el svg') })
const ParcheIcono = Meta.partial().extend({ svg: z.string().min(1).optional() })
const resumen = (e) => e.issues.slice(0, 3).map((x) => (x.path.length ? x.path.join('.') + ': ' : '') + x.message).join('; ')
const validar = (esquema, origen) => (req, res, next) => {
  const r = esquema.safeParse(req[origen])
  if (!r.success) return res.status(400).json({ error: 'Datos no válidos: ' + resumen(r.error) })
  req[origen + 'Ok'] = r.data
  next()
}
const IdParam = z.object({ id: Id })
const nulo = (v) => (v === undefined || v === null || v === '' ? null : v)

// Valida, normaliza y guarda un ícono. Devuelve { id, creado } o { id, error }.
async function guardar(bruto, conjuntoPaquete, usuario) {
  const id = String((bruto && bruto.id) || '?').slice(0, 80)
  const r = IconoNuevo.safeParse({ ...(bruto || {}), conjunto: bruto && bruto.conjunto !== undefined ? bruto.conjunto : conjuntoPaquete })
  if (!r.success) return { id, error: resumen(r.error) }
  const d = r.data
  const n = normalizarSvg(d.svg, d.id)
  if (!n.ok) return { id: d.id, error: 'SVG: ' + n.error }
  const dup = (await sinUsuario(Q.icoDuplicado, [d.tipo, n.hash, d.id])).rows[0]
  if (dup) return { id: d.id, error: 'es el mismo dibujo que «' + dup.id + '», que ya está en el banco' }
  const u = await sinUsuario(Q.icoUpsert, [d.id, d.tipo, n.svg, n.viewBox, n.hash, nulo(d.categoria), nulo(d.subcategoria), d.nombre_es, d.nombre_en, d.etiquetas_es, d.etiquetas_en, d.descripcion, d.prompt, d.estilo, d.tonos, nulo(d.conjunto), usuario.nombre || ''])
  return { id: d.id, creado: !!u.rows[0].creado }
}
const salida = (f) => ({ id: f.id, tipo: f.tipo, svg: f.svg, categoria: f.categoria, subcategoria: f.subcategoria, nombre_es: f.nombre_es, nombre_en: f.nombre_en, etiquetas_es: f.etiquetas_es, etiquetas_en: f.etiquetas_en,
  descripcion: f.descripcion, prompt: f.prompt, estilo: f.estilo, tonos: f.tonos, conjunto: f.conjunto, por: f.subido_nombre || null, archivado: !!f.archivado_en, archivadoEn: f.archivado_en || null, actualizado: f.actualizado })

// =============================================================== pantalla del banco (con sesión)
const puedeEscribir = exigirAlguno('plantillas.revisar', 'plantillas.subir')

rutasIconos.get('/', exigirSesion, exigirPermiso('plantillas.ver'), async (req, res, next) => {
  try {
    const q = z.object({ tipo: z.enum(['recurso', 'actividad']).optional(), estado: z.enum(['activos', 'archivados', 'todos']).default('activos'), q: z.string().trim().max(100).optional(),
      estilo: z.string().trim().max(40).optional(), limite: z.coerce.number().int().min(1).max(200).default(60), desde: z.coerce.number().int().min(0).max(100000).default(0) }).safeParse(req.query)
    if (!q.success) return res.status(400).json({ error: 'Datos no válidos: ' + resumen(q.error) })
    const b = q.data
    const texto = b.q ? b.q.replace(/[\\%_]/g, (c) => '\\' + c) : null
    const r = await sinUsuario(Q.icoListar, [b.tipo || null, b.estado, texto, b.estilo || null, b.limite, b.desde])
    res.json({ total: r.rows.length ? Number(r.rows[0].total) : 0, iconos: r.rows.map(salida) })
  } catch (e) { next(e) }
})
rutasIconos.get('/estilos', exigirSesion, exigirPermiso('plantillas.ver'), async (req, res, next) => {
  try { res.json({ estilos: (await sinUsuario(Q.icoEstilos)).rows }) } catch (e) { next(e) }
})

// Subir un paquete: { version: 1, conjunto?, iconos: [ { id, svg, … } ] }. Cada ícono se valida por separado: los buenos entran y los malos se devuelven con su motivo.
rutasIconos.post('/paquete', exigirSesion, puedeEscribir, limiteEscribir, validar(z.object({ version: z.literal(1, { message: 'la versión del paquete debe ser 1' }), conjunto: Opc(60), iconos: z.array(z.any()).min(1, 'el paquete no trae íconos').max(MAX_PAQUETE, 'máximo ' + MAX_PAQUETE + ' íconos por paquete') }), 'body'), async (req, res, next) => {
  try {
    const { conjunto, iconos } = req.bodyOk
    let creados = 0, actualizados = 0
    const rechazados = []
    for (const bruto of iconos) {
      const r = await guardar(bruto, conjunto, req.usuario)
      if (r.error) rechazados.push({ id: r.id, motivo: r.error }); else if (r.creado) creados++; else actualizados++
    }
    await auditar(req.usuario.id, 'icono_paquete', conjunto || 'sin-conjunto', req)
    res.json({ ok: true, total: iconos.length, creados, actualizados, rechazados })
  } catch (e) { next(e) }
})

// Añadir un ícono a mano.
rutasIconos.post('/', exigirSesion, puedeEscribir, limiteEscribir, async (req, res, next) => {
  try {
    const id = req.body && typeof req.body.id === 'string' ? req.body.id : ''
    if (id && (await sinUsuario(Q.icoUno, [id])).rows[0]) return res.status(409).json({ error: 'Ya hay un ícono con el id «' + id + '». Edítalo desde su tarjeta.' })
    const r = await guardar(req.body, undefined, req.usuario)
    if (r.error) return res.status(400).json({ error: r.id + ': ' + r.error })
    await auditar(req.usuario.id, 'icono_crear', r.id, req)
    res.status(201).json({ ok: true, id: r.id })
  } catch (e) { next(e) }
})

// Editar los datos de un ícono (y, si se manda, reemplazar su SVG).
rutasIconos.put('/:id', exigirSesion, puedeEscribir, limiteEscribir, validar(IdParam, 'params'), validar(ParcheIcono, 'body'), async (req, res, next) => {
  try {
    const { id } = req.paramsOk
    const actual = (await sinUsuario(Q.icoUno, [id])).rows[0]
    if (!actual) return res.status(404).json({ error: 'No hay un ícono con ese id.' })
    const p = req.bodyOk
    const d = { tipo: p.tipo ?? actual.tipo, categoria: p.categoria !== undefined ? p.categoria : actual.categoria, subcategoria: p.subcategoria !== undefined ? p.subcategoria : actual.subcategoria,
      nombre_es: p.nombre_es ?? actual.nombre_es, nombre_en: p.nombre_en ?? actual.nombre_en, etiquetas_es: p.etiquetas_es ?? actual.etiquetas_es, etiquetas_en: p.etiquetas_en ?? actual.etiquetas_en,
      descripcion: p.descripcion ?? actual.descripcion, prompt: p.prompt ?? actual.prompt, estilo: p.estilo ?? actual.estilo, tonos: p.tonos ?? actual.tonos, conjunto: p.conjunto !== undefined ? p.conjunto : actual.conjunto }
    let svg = actual.svg, viewbox = actual.viewbox, hash = actual.hash
    if (p.svg !== undefined) {
      const n = normalizarSvg(p.svg, id)
      if (!n.ok) return res.status(400).json({ error: 'SVG: ' + n.error })
      svg = n.svg; viewbox = n.viewBox; hash = n.hash
    }
    if (hash !== actual.hash || d.tipo !== actual.tipo) {
      const dup = (await sinUsuario(Q.icoDuplicado, [d.tipo, hash, id])).rows[0]
      if (dup) return res.status(400).json({ error: 'Es el mismo dibujo que «' + dup.id + '», que ya está en el banco.' })
    }
    await sinUsuario(Q.icoActualizar, [id, d.tipo, svg, viewbox, hash, nulo(d.categoria), nulo(d.subcategoria), d.nombre_es, d.nombre_en, d.etiquetas_es, d.etiquetas_en, d.descripcion, d.prompt, d.estilo, d.tonos, nulo(d.conjunto)])
    await auditar(req.usuario.id, 'icono_editar', id, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// Archivar o restaurar. Un ícono archivado no se ofrece al flujo de H5P, pero se sigue pudiendo pedir por su id (los recursos ya generados lo necesitan para regenerarse).
rutasIconos.put('/:id/archivo', exigirSesion, puedeEscribir, limiteEscribir, validar(IdParam, 'params'), validar(z.object({ archivado: z.boolean() }).strict(), 'body'), async (req, res, next) => {
  try {
    const { id } = req.paramsOk
    const r = await sinUsuario(Q.icoArchivar, [id, req.bodyOk.archivado, req.usuario.nombre || ''])
    if (!r.rowCount) return res.status(404).json({ error: req.bodyOk.archivado ? 'No hay un ícono activo con ese id.' : 'No hay un ícono archivado con ese id.' })
    await auditar(req.usuario.id, req.bodyOk.archivado ? 'icono_archivar' : 'icono_restaurar', id, req)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// =============================================================== servicio de H5P (con clave)
const resumenClave = (t) => crypto.createHash('sha256').update(String(t || '')).digest()
function exigirClaveServicio(req, res, next) {
  if (!config.iconosClave) return res.status(503).json({ error: 'El banco de íconos no está configurado para el servicio (falta la clave).' })
  if (!crypto.timingSafeEqual(resumenClave(req.get('x-api-key')), resumenClave(config.iconosClave))) return res.status(401).json({ error: 'Clave no válida.' })
  next()
}
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ficha = (f) => ({ id: f.id, tipo: f.tipo, nombre_es: f.nombre_es, nombre_en: f.nombre_en, etiquetas_es: f.etiquetas_es, etiquetas_en: f.etiquetas_en, descripcion: f.descripcion, prompt: f.prompt,
  estilo: f.estilo, tonos: f.tonos, conjunto: f.conjunto, categoria: f.categoria, subcategoria: f.subcategoria, viewBox: f.viewbox, svg: f.svg })
const FiltroServicio = z.object({ tipo: z.enum(['recurso', 'actividad']).optional(), estilo: z.string().trim().regex(/^[a-z0-9-]{1,40}$/).optional() })
const version = async () => { const v = (await sinUsuario(Q.icoVersion)).rows[0]; return v.n + '-' + v.m }

// La lista completa de los íconos activos (opcionalmente de un tipo y un estilo), con la versión del banco. Responde 304 si «If-None-Match» trae la misma versión.
rutasBancoIconos.get('/lista', limiteServicio, exigirClaveServicio, async (req, res, next) => {
  try {
    const q = FiltroServicio.safeParse(req.query)
    if (!q.success) return res.status(400).json({ error: 'Datos no válidos: ' + resumen(q.error) })
    const v = await version()
    const etag = 'W/"' + v + ':' + (q.data.tipo || '') + ':' + (q.data.estilo || '') + '"'
    res.set({ ETag: etag, 'Cache-Control': 'no-cache', 'X-Banco-Version': v })
    if (req.get('if-none-match') === etag) return res.status(304).end()
    const r = await sinUsuario(Q.icoLista, [q.data.tipo || null, q.data.estilo || null])
    res.json({ version: v, total: r.rows.length, iconos: r.rows.map(ficha) })
  } catch (e) { next(e) }
})

// Búsqueda por texto en nombres, etiquetas, descripción y prompt (sin tildes): devuelve los mejores íconos activos, del más al menos parecido.
rutasBancoIconos.get('/buscar', limiteServicio, exigirClaveServicio, async (req, res, next) => {
  try {
    const q = FiltroServicio.extend({ q: z.string().trim().min(1).max(200), limite: z.coerce.number().int().min(1).max(50).default(10) }).safeParse(req.query)
    if (!q.success) return res.status(400).json({ error: 'Datos no válidos: ' + resumen(q.error) })
    const palabras = [...new Set(norm(q.data.q).split(/[^a-z0-9]+/).filter((p) => p.length >= 2))]
    const filas = (await sinUsuario(Q.icoLista, [q.data.tipo || null, q.data.estilo || null])).rows
    const puntuar = (f) => {
      const nombre = norm(f.nombre_es + ' ' + f.nombre_en + ' ' + f.id)
      const etiquetas = norm([...f.etiquetas_es, ...f.etiquetas_en].join(' '))
      const texto = norm(f.descripcion + ' ' + f.prompt + ' ' + (f.categoria || '') + ' ' + (f.subcategoria || ''))
      return palabras.reduce((s, p) => s + (nombre.includes(p) ? 5 : 0) + (etiquetas.includes(p) ? 3 : 0) + (texto.includes(p) ? 1 : 0), 0)
    }
    const ordenadas = filas.map((f) => ({ f, p: puntuar(f) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p || a.f.id.localeCompare(b.f.id)).slice(0, q.data.limite)
    res.json({ version: await version(), total: ordenadas.length, iconos: ordenadas.map((x) => ({ ...ficha(x.f), puntaje: x.p })) })
  } catch (e) { next(e) }
})

// Un ícono por su id (también los archivados: un recurso ya generado puede necesitarlo para volver a armarse).
rutasBancoIconos.get('/:id', limiteServicio, exigirClaveServicio, async (req, res, next) => {
  try {
    const p = IdParam.safeParse(req.params)
    if (!p.success) return res.status(400).json({ error: 'Id no válido.' })
    const f = (await sinUsuario(Q.icoUno, [p.data.id])).rows[0]
    if (!f) return res.status(404).json({ error: 'No hay un ícono con ese id.' })
    res.json({ ...ficha(f), archivado: !!f.archivado_en })
  } catch (e) { next(e) }
})
