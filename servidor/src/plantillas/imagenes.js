// «Plantillas con imágenes»: API bajo /api/plantillas-imagenes (montada en app.js con exigirCabecera). Permiso propio: «plantillas.imagenes» (rol «editor_imagenes»).
//   GET  /                  → plantillas subidas que traen imágenes, en el mismo orden que «Plantillas HTML» (clase → categoría → nombre), con su estado de validación
//   GET  /:nombre           → imágenes de una plantilla en el orden en que aparecen (URL, alt, tamaño, contexto, último resultado de validación) + historial de cambios
//   POST /:nombre/vista     → HTML de vista previa con URL nuevas aplicadas (sin guardar)
//   POST /:nombre/validar   → comprueba que cada URL responda y sea una imagen (descarga segura anti-SSRF, con tope de tamaño y de tiempo)
//   PUT  /:nombre           → guarda URL nuevas: cambia solo el texto de esas URL en el HTML crudo y vuelve a armar la plantilla; queda en el historial y en la auditoría
// Solo toca las plantillas SUBIDAS (las del sistema son archivos del código). No sube, revisa, archiva ni elimina plantillas.
import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { conTransaccion, sinUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { descargar, validarDestino } from '../bibliografia/red.js'
import { exigirPermiso, exigirSesion } from '../seguridad.js'
import { armarSubida } from './subidas.js'
import { aplicarCambios, escanearImagenes, huellaHtml, MAX_CAMBIOS, publicas, revisarUrlImagen, tipoDeImagen } from './imagenes-html.js'

export const PERMISO_IMAGENES = 'plantillas.imagenes'
const MAX_BYTES_IMAGEN = 10 * 1024 * 1024
const TIEMPO_IMAGEN_MS = 15000
const NIVEL_VER = { tecnologico: 'tecnologia', profesional: 'profesional', especializacion: 'especializacion', doctorado: 'doctorado' }

const Nombre = z.object({ nombre: z.string().regex(/^[a-z0-9-]{1,80}$/) })
const Url = z.string().min(1).max(2100)
const CuerpoVista = z.object({ cambios: z.record(z.string().regex(/^\d{1,4}$/), Url).optional() }).strict()
const CuerpoValidar = z.object({ urls: z.array(Url).min(1).max(60) }).strict()
const MAX_PLANTILLAS_MASIVO = 300
const CuerpoMasivo = z.object({
  // por URL actual → nueva (todas las apariciones en las plantillas indicadas) y/o por USO suelto (plantilla + posición de la imagen dentro de ella)
  usos: z.array(z.object({ plantilla: z.string().regex(/^[a-z0-9-]{1,80}$/), actualizado: z.string().max(40), indice: z.number().int().min(0).max(9999), url: Url }).strict()).max(600).optional(),
  reemplazos: z.array(z.object({
    anterior: Url, nueva: Url,
    plantillas: z.array(z.object({ nombre: z.string().regex(/^[a-z0-9-]{1,80}$/), actualizado: z.string().max(40) }).strict()).min(1).max(MAX_PLANTILLAS_MASIVO)
  }).strict()).max(50).default([]),
  confirmarInvalida: z.boolean().optional()
}).strict().refine((b) => b.reemplazos.length > 0 || (b.usos && b.usos.length > 0), { message: 'Nada que cambiar' })
const CuerpoGuardar = z.object({
  base: z.string().regex(/^[0-9a-f]{20}$/),
  cambios: z.array(z.object({ indice: z.number().int().min(0).max(9999), url: Url }).strict()).min(1).max(MAX_CAMBIOS)
}).strict().refine((b) => new Set(b.cambios.map((c) => c.indice)).size === b.cambios.length, { message: 'Imagen repetida' })

class ErrorHttp extends Error { constructor(estado, mensaje, extra) { super(mensaje); this.estado = estado; this.extra = extra } }
const ip = (req) => String(req.ip || '').slice(0, 64)

const validar = (esquema, origen) => (req, res, next) => {
  const r = esquema.safeParse(req[origen])
  if (!r.success) return res.status(400).json({ error: 'Datos no válidos' })
  req[origen + 'Ok'] = r.data
  next()
}

// ---- validación de una URL (con red) ----------------------------------------------------------------------------------------
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
const BLOQUEO = /^(Dirección|Puerto no permitido|Solo se permiten|La dirección)/

// Devuelve { estado: 'valida' | 'no_responde' | 'no_es_imagen' | 'bloqueada', detalle }. Nunca lanza.
export async function validarImagen(url, { bajar = descargar, destino = validarDestino } = {}) {
  const motivo = revisarUrlImagen(url)
  if (motivo) return { estado: 'bloqueada', detalle: motivo }
  try {
    await destino(url)
    const r = await bajar(url, { maxBytes: MAX_BYTES_IMAGEN, tiempoMs: TIEMPO_IMAGEN_MS, aceptar: 'image/*,*/*;q=0.5' })
    if (r.estado < 200 || r.estado >= 300) return { estado: 'no_responde', detalle: 'Respondió con el código ' + r.estado + '.' }
    const tipo = tipoDeImagen(r.datos)
    if (!tipo) return { estado: 'no_es_imagen', detalle: 'Responde, pero no es una imagen' + (r.tipo ? ' (' + r.tipo.split(';')[0].slice(0, 60) + ')' : '') + '.' }
    return { estado: 'valida', detalle: tipo + ' · ' + kb(r.datos.length) }
  } catch (e) {
    const m = String((e && e.message) || '')
    if (BLOQUEO.test(m)) return { estado: 'bloqueada', detalle: m.slice(0, 120) }
    if (/demasiado grande/i.test(m)) return { estado: 'no_responde', detalle: 'Pesa más de ' + kb(MAX_BYTES_IMAGEN) + '.' }
    if ((e && e.name === 'TimeoutError') || /tiempo|timeout|abort/i.test(m)) return { estado: 'no_responde', detalle: 'Tardó demasiado en responder.' }
    if (e && /^(ENOTFOUND|EAI_AGAIN)$/.test(e.code || '')) return { estado: 'no_responde', detalle: 'No se encontró ese sitio.' }
    if (/redirecciones/i.test(m)) return { estado: 'no_responde', detalle: 'Demasiadas redirecciones.' }
    return { estado: 'no_responde', detalle: 'No respondió.' }
  }
}

// Valida varias a la vez (máximo 4 en paralelo), sin repetir las URL iguales.
async function validarVarias(urls, deps) {
  const unicas = [...new Set(urls)]
  const res = new Map()
  let i = 0
  await Promise.all(Array.from({ length: Math.min(4, unicas.length) }, async () => {
    while (i < unicas.length) { const u = unicas[i++]; res.set(u, await validarImagen(u, deps)) }
  }))
  return res
}

// ---- consultas -------------------------------------------------------------------------------------------------------------
const SQL = {
  meta: `SELECT s.nombre, s.actualizado, s.formacion, pc.categoria, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo,
           position('/*FIN-CONTENIDO*/' in s.html_crudo) > 0 AS ejemplo,
           (SELECT h.estado FROM plantilla_historial h WHERE h.plantilla = 'pub-' || s.nombre ORDER BY h.creado DESC, h.id DESC LIMIT 1) AS revision
         FROM plantilla_subidas s
         LEFT JOIN plantilla_categoria pc ON pc.plantilla = s.nombre
         LEFT JOIN plantilla_categorias c ON c.id = pc.categoria
         WHERE (to_jsonb(s) ->> 'archivada_en') IS NULL`,
  crudos: `SELECT nombre, html_crudo FROM plantilla_subidas WHERE nombre = ANY($1::text[])`,
  una: `SELECT s.nombre, s.html_crudo, s.actualizado, s.formacion, pc.categoria, c.nombre AS categoria_nombre, c.tipo AS categoria_tipo
          FROM plantilla_subidas s LEFT JOIN plantilla_categoria pc ON pc.plantilla = s.nombre LEFT JOIN plantilla_categorias c ON c.id = pc.categoria
         WHERE s.nombre = $1 AND (to_jsonb(s) ->> 'archivada_en') IS NULL`,
  bloquear: `SELECT html_crudo FROM plantilla_subidas WHERE nombre = $1 AND (to_jsonb(plantilla_subidas) ->> 'archivada_en') IS NULL FOR UPDATE`,
  guardar: `UPDATE plantilla_subidas SET html_crudo = $2, html = $3, actualizado = now() WHERE nombre = $1`,
  validaciones: `SELECT plantilla, url, estado, detalle, validado_en AS "validadoEn", validado_por AS "validadoPor" FROM plantilla_imagenes_validacion`,
  validacionesDe: `SELECT url, estado, detalle, validado_en AS "validadoEn", validado_por AS "validadoPor" FROM plantilla_imagenes_validacion WHERE plantilla = $1`,
  validacionPoner: `INSERT INTO plantilla_imagenes_validacion (plantilla, url, estado, detalle, validado_por) VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (plantilla, url) DO UPDATE SET estado = EXCLUDED.estado, detalle = EXCLUDED.detalle, validado_en = now(), validado_por = EXCLUDED.validado_por`,
  validacionPodar: `DELETE FROM plantilla_imagenes_validacion WHERE plantilla = $1 AND NOT (url = ANY($2::text[]))`,
  historialCrear: `INSERT INTO plantilla_imagenes_historial (plantilla, usuario_id, usuario_nombre, cambios) VALUES ($1, $2, $3, $4::jsonb)`,
  validacionesUnicas: `SELECT DISTINCT ON (url) url, estado, detalle, validado_en AS "validadoEn" FROM plantilla_imagenes_validacion ORDER BY url, validado_en DESC`,
  bloquearVarias: `SELECT nombre, html_crudo, actualizado FROM plantilla_subidas WHERE nombre = ANY($1::text[]) AND (to_jsonb(plantilla_subidas) ->> 'archivada_en') IS NULL ORDER BY nombre FOR UPDATE`,
  historialDe: `SELECT id, usuario_nombre AS usuario, cambios, creado FROM plantilla_imagenes_historial WHERE plantilla = $1 ORDER BY creado DESC, id DESC LIMIT 20`
}

const categoriaDe = (f) => (f.categoria ? { id: f.categoria, nombre: f.categoria_nombre || '', tipo: f.categoria_tipo || 'recurso' } : null)

// HTML de la vista previa: la plantilla con su contenido de ejemplo (o, si no trae, tal cual con el título y el contenido vacíos), como en «Plantillas HTML».
function htmlVista(crudo, nombre, formacion) {
  const armada = armarSubida(crudo)
  if (!armada.ok) return { ok: false, error: armada.error }
  let html = armada.ejemplo || armada.html.replace('{{TITULO}}', () => nombre).replace('/*CONTENIDO*/', () => '{}')
  const nivel = NIVEL_VER[formacion]
  if (nivel) {
    const marca = '<script>window.__NIVEL=' + JSON.stringify(nivel) + '</script>'
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + marca) : marca + html
  }
  return { ok: true, html }
}

export function crearRutasImagenes({ antes = [exigirSesion, exigirPermiso(PERMISO_IMAGENES)], sql = sinUsuario, transaccion = conTransaccion, bajar = descargar, destino = validarDestino } = {}) {
  const r = Router()
  r.use(...antes)
  const porPersona = (req) => (req.usuario ? 'u:' + req.usuario.id : ipKeyGenerator(req.ip))
  const limite = (n) => rateLimit({ windowMs: 60 * 1000, limit: n, keyGenerator: porPersona, standardHeaders: true, legacyHeaders: false })
  const auditar = (req, accion, id) => sql(Q.auditoriaRegistrar, [req.usuario.id, accion, 'plantilla', id, ip(req)]).catch(() => {})
  const envolver = (f) => async (req, res, next) => {
    try { await f(req, res) } catch (e) {
      if (e instanceof ErrorHttp) return res.status(e.estado).json({ error: e.message, ...(e.extra || {}) })
      next(e)
    }
  }
  const cacheEscaneo = new Map() // nombre → { clave, n, unicas, refs } (las plantillas cambian poco: se vuelve a escanear solo si cambió «actualizado»)
  // Deja en el caché el escaneo de las plantillas que faltan o cambiaron (solo esas se leen enteras de la base).
  const escaneos = async (filas) => {
    const faltan = filas.filter((f) => { const c = cacheEscaneo.get(f.nombre); return !c || c.clave !== String(f.actualizado) }).map((f) => f.nombre)
    if (!faltan.length) return
    const crudos = await sql(SQL.crudos, [faltan])
    const claves = new Map(filas.map((f) => [f.nombre, String(f.actualizado)]))
    for (const x of crudos.rows) {
      const im = escanearImagenes(x.html_crudo)
      cacheEscaneo.set(x.nombre, { clave: claves.get(x.nombre), n: im.length, unicas: [...new Set(im.map((i) => i.url))], refs: im.map((i) => ({ url: i.url, lugar: i.lugar, indice: i.indice, contexto: (i.contexto || '').slice(0, 140) })) })
    }
  }
  const ordenLista = (a, b) => {
    const clase = (p) => (p.categoria && p.categoria.tipo === 'actividad' ? 1 : 0)
    return clase(a) - clase(b) || (a.categoria ? 0 : 1) - (b.categoria ? 0 : 1) || (a.categoria && b.categoria ? a.categoria.id.localeCompare(b.categoria.id) : 0) || a.nombre.localeCompare(b.nombre)
  }

  const cargar = async (nombre) => {
    const f = (await sql(SQL.una, [nombre])).rows[0]
    if (!f) throw new ErrorHttp(404, 'No hay una plantilla subida con ese nombre.')
    return f
  }
  const conEstado = (imagenes, filas) => {
    const m = new Map(filas.map((x) => [x.url, x]))
    return publicas(imagenes).map((i) => { const v = m.get(i.url); return { ...i, estado: v ? v.estado : 'sin_validar', detalle: v ? v.detalle : '', validadoEn: v ? v.validadoEn : null } })
  }

  r.get('/', limite(120), envolver(async (req, res) => {
    const [meta, val] = await Promise.all([sql(SQL.meta), sql(SQL.validaciones)])
    await escaneos(meta.rows)
    const vals = new Map()
    for (const v of val.rows) vals.set(v.plantilla + '\n' + v.url, v.estado)
    const plantillas = meta.rows.map((f) => {
      const c = cacheEscaneo.get(f.nombre) || { n: 0, unicas: [] }
      const estados = c.unicas.map((u) => vals.get(f.nombre + '\n' + u) || 'sin_validar')
      return {
        nombre: f.nombre, categoria: categoriaDe(f), formacion: f.formacion || null, ejemplo: !!f.ejemplo, revision: f.revision || null, actualizado: f.actualizado,
        imagenes: c.n, unicas: c.unicas.length,
        validas: estados.filter((e) => e === 'valida').length, conProblema: estados.filter((e) => e !== 'valida' && e !== 'sin_validar').length, sinValidar: estados.filter((e) => e === 'sin_validar').length
      }
    }).filter((p) => p.imagenes > 0)
    // mismo orden que «Plantillas HTML»: recursos y luego actividades; dentro, por ID de categoría; dentro, por nombre. Sin categoría, al final de los recursos.
    plantillas.sort(ordenLista)
    res.set('Cache-Control', 'no-store').json({ plantillas })
  }))

  // ---- cambio masivo: por imagen, en todas las plantillas (van antes de /:nombre) ------------------------------------------------
  // URL únicas con las plantillas que las usan, y las plantillas con sus URL (para resaltar en ambos sentidos). Usa el caché de escaneo.
  r.get('/masivo', limite(60), envolver(async (req, res) => {
    const [meta, val] = await Promise.all([sql(SQL.meta), sql(SQL.validacionesUnicas)])
    await escaneos(meta.rows)
    const plantillas = meta.rows.map((f) => ({ nombre: f.nombre, categoria: categoriaDe(f), formacion: f.formacion || null, actualizado: f.actualizado, c: cacheEscaneo.get(f.nombre) }))
      .filter((p) => p.c && p.c.n > 0).sort(ordenLista)
    const porUrl = new Map()
    for (const p of plantillas) {
      for (const ref of p.c.refs) {
        const u = porUrl.get(ref.url) || { url: ref.url, usos: new Map() }
        const uso = u.usos.get(p.nombre) || { nombre: p.nombre, categoria: p.categoria ? { id: p.categoria.id, nombre: p.categoria.nombre } : null, lugares: new Set(), veces: 0, usos: [] }
        uso.lugares.add(ref.lugar); uso.veces++; uso.usos.push({ indice: ref.indice, lugar: ref.lugar, contexto: ref.contexto })
        u.usos.set(p.nombre, uso); porUrl.set(ref.url, u)
      }
    }
    const est = new Map(val.rows.map((v) => [v.url, v]))
    res.set('Cache-Control', 'no-store').json({
      plantillas: plantillas.map((p) => ({ nombre: p.nombre, categoria: p.categoria, actualizado: p.actualizado, imagenes: p.c.n, urls: p.c.unicas })),
      urls: [...porUrl.values()].map((u) => {
        const v = est.get(u.url)
        return { url: u.url, estado: v ? v.estado : 'sin_validar', detalle: v ? v.detalle : '', plantillas: [...u.usos.values()].map((x) => ({ ...x, lugares: [...x.lugares] })) }
      })
    })
  }))

  // Valida URL (las actuales y las nuevas que se piensa poner); el resultado se guarda para las plantillas que ya usan esa URL.
  r.post('/masivo/validar', limite(20), validar(CuerpoValidar, 'body'), envolver(async (req, res) => {
    const resultados = await validarVarias(req.bodyOk.urls, { bajar, destino })
    const meta = await sql(SQL.meta)
    await escaneos(meta.rows)
    const jobs = []
    for (const f of meta.rows) {
      const c = cacheEscaneo.get(f.nombre)
      if (!c) continue
      for (const u of c.unicas) { const x = resultados.get(u); if (x) jobs.push(sql(SQL.validacionPoner, [f.nombre, u, x.estado, x.detalle.slice(0, 300), req.usuario.nombre]).catch(() => {})) }
    }
    await Promise.all(jobs)
    const hoy = new Date().toISOString()
    res.set('Cache-Control', 'no-store').json({ resultados: Object.fromEntries([...resultados].map(([u, x]) => [u, { ...x, validadoEn: hoy }])) })
  }))

  // Reemplaza URL en TODAS las plantillas indicadas, en una sola transacción: o se cambian todas o ninguna. Una plantilla que otra persona editó mientras tanto
  // (cambió «actualizado») se salta y se avisa, sin pisar su cambio.
  r.post('/masivo/aplicar', limite(10), validar(CuerpoMasivo, 'body'), envolver(async (req, res) => {
    const { reemplazos, confirmarInvalida } = req.bodyOk
    const usos = req.bodyOk.usos || []
    const anteriores = new Set()
    const porPlantilla = new Map() // nombre → { actualizado, mapa: Map(anterior → nueva), sueltos: Map(indice → nueva) }
    const de = (nombre, actualizado) => { const x = porPlantilla.get(nombre) || { actualizado, mapa: new Map(), sueltos: new Map() }; porPlantilla.set(nombre, x); return x }
    for (const rp of reemplazos) {
      if (rp.anterior === rp.nueva) throw new ErrorHttp(400, 'La URL nueva es igual a la actual.')
      if (anteriores.has(rp.anterior)) throw new ErrorHttp(400, 'Una misma URL no puede reemplazarse dos veces en la misma petición.')
      anteriores.add(rp.anterior)
      for (const pl of rp.plantillas) de(pl.nombre, pl.actualizado).mapa.set(rp.anterior, rp.nueva)
    }
    for (const u of usos) {
      const x = de(u.plantilla, u.actualizado)
      if (x.sueltos.has(u.indice)) throw new ErrorHttp(400, 'Una misma imagen no puede cambiarse dos veces en la misma petición.')
      x.sueltos.set(u.indice, u.url)
    }
    const nuevas = [...new Set([...reemplazos.map((x) => x.nueva), ...usos.map((x) => x.url)])]
    for (const u of nuevas) { const motivo = revisarUrlImagen(u); if (motivo) throw new ErrorHttp(400, motivo) }
    if (porPlantilla.size > MAX_PLANTILLAS_MASIVO) throw new ErrorHttp(400, 'Demasiadas plantillas en una sola petición (máximo ' + MAX_PLANTILLAS_MASIVO + ').')
    for (const u of nuevas) {
      try { await destino(u) } catch (e) { if (!(e && /^(ENOTFOUND|EAI_AGAIN|ENODATA)$/.test(e.code || ''))) throw new ErrorHttp(400, String((e && e.message) || 'Dirección no permitida').slice(0, 160)) }
    }
    // la URL nueva debe responder y ser una imagen; si no, no se aplica salvo que la persona lo confirme (lo bloqueado nunca se permite)
    const val = await validarVarias(nuevas, { bajar, destino })
    const malas = [...val].filter(([, x]) => x.estado !== 'valida').map(([url, x]) => ({ url, estado: x.estado, detalle: x.detalle }))
    const bloqueadas = malas.filter((x) => x.estado === 'bloqueada')
    if (bloqueadas.length) throw new ErrorHttp(400, 'Una URL nueva no está permitida: ' + bloqueadas[0].detalle, { invalidas: malas })
    if (malas.length && !confirmarInvalida) throw new ErrorHttp(422, 'La URL nueva no es una imagen que responda. Confirme si quiere aplicarla de todos modos.', { requiereConfirmacion: true, invalidas: malas })

    const nombres = [...porPlantilla.keys()].sort()
    const resultado = await transaccion(async (c) => {
      const filas = new Map((await c.query(SQL.bloquearVarias, [nombres])).rows.map((f) => [f.nombre, f]))
      const cambiadas = []
      const saltadas = []
      for (const nombre of nombres) {
        const f = filas.get(nombre)
        const { actualizado, mapa, sueltos } = porPlantilla.get(nombre)
        if (!f) { saltadas.push({ nombre, motivo: 'no_existe' }); continue }
        if (new Date(actualizado).getTime() !== new Date(f.actualizado).getTime()) { saltadas.push({ nombre, motivo: 'modificada' }); continue }
        const imagenes = escanearImagenes(f.html_crudo)
        const pedido = {}
        for (const i of imagenes) if (mapa.has(i.url)) pedido[i.indice] = mapa.get(i.url) // la regla por URL...
        for (const [indice, url] of sueltos) { // ...y el uso suelto manda sobre ella
          if (!imagenes.some((i) => i.indice === indice)) throw new ErrorHttp(409, nombre + ': la imagen ' + (indice + 1) + ' ya no está en la plantilla. Recargue la pantalla.')
          pedido[indice] = url
        }
        if (!Object.keys(pedido).length) { saltadas.push({ nombre, motivo: 'sin_cambios' }); continue }
        const a = aplicarCambios(f.html_crudo, pedido) // solo cambia esas URL y comprueba que el resto quedó idéntico
        if (!a.ok) throw new ErrorHttp(400, nombre + ': ' + a.error)
        if (!a.cambios.length) { saltadas.push({ nombre, motivo: 'sin_cambios' }); continue }
        const armada = armarSubida(a.html)
        if (!armada.ok) throw new ErrorHttp(422, nombre + ': ' + armada.error)
        await c.query(SQL.guardar, [nombre, a.html, armada.html])
        await c.query(SQL.historialCrear, [nombre, req.usuario.id, req.usuario.nombre, JSON.stringify(a.cambios.map((x) => ({ ...x, masivo: true })))])
        await c.query(SQL.validacionPodar, [nombre, escanearImagenes(a.html).map((i) => i.url)])
        for (const u of new Set(a.cambios.map((x) => x.despues))) { const x = val.get(u); await c.query(SQL.validacionPoner, [nombre, u, x.estado, x.detalle.slice(0, 300), req.usuario.nombre]) }
        cambiadas.push({ nombre, imagenes: a.cambios.length })
      }
      return { cambiadas, saltadas }
    })
    if (resultado.cambiadas.length) await auditar(req, 'plantilla_imagenes_masivo', resultado.cambiadas.length + ' plantillas, ' + resultado.cambiadas.reduce((n, x) => n + x.imagenes, 0) + ' imágenes')
    res.json({ ok: true, ...resultado })
  }))

  r.get('/:nombre', limite(240), validar(Nombre, 'params'), envolver(async (req, res) => {
    const f = await cargar(req.paramsOk.nombre)
    const [val, hist] = await Promise.all([sql(SQL.validacionesDe, [f.nombre]), sql(SQL.historialDe, [f.nombre])])
    res.set('Cache-Control', 'no-store').json({
      nombre: f.nombre, categoria: categoriaDe(f), formacion: f.formacion || null, base: huellaHtml(f.html_crudo), actualizado: f.actualizado,
      imagenes: conEstado(escanearImagenes(f.html_crudo), val.rows), historial: hist.rows
    })
  }))

  r.post('/:nombre/vista', limite(240), validar(Nombre, 'params'), validar(CuerpoVista, 'body'), envolver(async (req, res) => {
    const f = await cargar(req.paramsOk.nombre)
    // vista previa tolerante: lo que todavía no es una URL válida (se está escribiendo) se ignora y la imagen sigue como estaba
    const buenas = {}
    const ignoradas = []
    for (const [k, u] of Object.entries(req.bodyOk.cambios || {})) { if (revisarUrlImagen(u)) ignoradas.push(Number(k)); else buenas[k] = u }
    const a = aplicarCambios(f.html_crudo, buenas)
    if (!a.ok) throw new ErrorHttp(409, a.error)
    const v = htmlVista(a.html, f.nombre, f.formacion)
    if (!v.ok) throw new ErrorHttp(422, v.error)
    res.set('Cache-Control', 'no-store').json({ html: v.html, ignoradas })
  }))

  r.post('/:nombre/validar', limite(20), validar(Nombre, 'params'), validar(CuerpoValidar, 'body'), envolver(async (req, res) => {
    const f = await cargar(req.paramsOk.nombre)
    const resultados = await validarVarias(req.bodyOk.urls, { bajar, destino })
    const hoy = new Date().toISOString()
    // se guarda el resultado de cada URL (las que ya están en la plantilla y las propuestas: al guardar, una propuesta ya validada queda con su estado)
    await Promise.all([...resultados].map(([u, x]) => sql(SQL.validacionPoner, [f.nombre, u, x.estado, x.detalle.slice(0, 300), req.usuario.nombre]).catch(() => {})))
    res.set('Cache-Control', 'no-store').json({ resultados: Object.fromEntries([...resultados].map(([u, x]) => [u, { ...x, validadoEn: hoy }])) })
  }))

  r.put('/:nombre', limite(30), validar(Nombre, 'params'), validar(CuerpoGuardar, 'body'), envolver(async (req, res) => {
    const nombre = req.paramsOk.nombre
    const { base, cambios } = req.bodyOk
    const pedido = Object.fromEntries(cambios.map((c) => [c.indice, c.url]))
    // además del formato, que el sitio no sea interno (se resuelve el nombre en el DNS); si el nombre simplemente no resuelve, se deja guardar: puede publicarse después
    for (const u of new Set(cambios.map((c) => c.url))) {
      const motivo = revisarUrlImagen(u)
      if (motivo) throw new ErrorHttp(400, motivo)
      try { await destino(u) } catch (e) { if (!(e && /^(ENOTFOUND|EAI_AGAIN|ENODATA)$/.test(e.code || ''))) throw new ErrorHttp(400, String((e && e.message) || 'Dirección no permitida').slice(0, 160)) }
    }
    const resultado = await transaccion(async (c) => {
      const f = (await c.query(SQL.bloquear, [nombre])).rows[0]
      if (!f) throw new ErrorHttp(404, 'No hay una plantilla subida con ese nombre.')
      if (huellaHtml(f.html_crudo) !== base) throw new ErrorHttp(409, 'Otra persona cambió esta plantilla mientras la editaba. Recargue para ver la versión actual.', { desactualizada: true })
      const a = aplicarCambios(f.html_crudo, pedido)
      if (!a.ok) throw new ErrorHttp(400, a.error)
      if (!a.cambios.length) throw new ErrorHttp(400, 'No hay cambios que guardar.')
      const armada = armarSubida(a.html) // las dos versiones (cruda y armada) salen del mismo HTML: siempre coherentes
      if (!armada.ok) throw new ErrorHttp(422, armada.error)
      await c.query(SQL.guardar, [nombre, a.html, armada.html])
      await c.query(SQL.historialCrear, [nombre, req.usuario.id, req.usuario.nombre, JSON.stringify(a.cambios)])
      await c.query(SQL.validacionPodar, [nombre, escanearImagenes(a.html).map((i) => i.url)])
      return { crudo: a.html, cambios: a.cambios }
    })
    await auditar(req, 'plantilla_imagenes_editar', nombre)
    const [val, hist] = await Promise.all([sql(SQL.validacionesDe, [nombre]), sql(SQL.historialDe, [nombre])])
    res.json({ ok: true, cambiadas: resultado.cambios.length, base: huellaHtml(resultado.crudo), imagenes: conEstado(escanearImagenes(resultado.crudo), val.rows), historial: hist.rows })
  }))
  return r
}

export const rutasImagenes = crearRutasImagenes()
