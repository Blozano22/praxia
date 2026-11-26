// «Plantillas con imágenes»: escaneo y reemplazo de URL (sin base ni red), validación con red simulada y rutas con base simulada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { aplicarCambios, escanearImagenes, revisarUrlImagen, tipoDeImagen } from '../src/plantillas/imagenes-html.js'
import { crearRutasImagenes, validarImagen } from '../src/plantillas/imagenes.js'
import { armarSubida } from '../src/plantillas/subidas.js'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = fs.readFileSync(path.join(aqui, 'fixtures', 'imagenes', 'varias.html'), 'utf8')
const urls = (l) => l.map((i) => i.url)

test('escanea las imágenes en orden de aparición, sin scripts, comentarios ni data:', () => {
  const im = escanearImagenes(FIXTURE)
  assert.deepEqual(urls(im), [
    'https://cdn.ejemplo.co/fondo-css.jpg',
    'https://cdn.ejemplo.co/textura.png?v=1&w=2', // &amp; se muestra como &
    'https://cdn.ejemplo.co/logo.png',
    'https://cdn.ejemplo.co/figura.jpg?a=1&b=2',
    'https://cdn.ejemplo.co/logo.png', // duplicada: aparece dos veces, cada una con su índice
    'https://cdn.ejemplo.co/g-480.webp', 'https://cdn.ejemplo.co/g-960.webp',
    'https://cdn.ejemplo.co/g.jpg', 'https://cdn.ejemplo.co/g.jpg', 'https://cdn.ejemplo.co/g@2x.jpg',
    'https://cdn.ejemplo.co/fondo-inline.jpg',
    'imagenes/relativa.png'
  ])
  assert.deepEqual(im.map((i) => i.indice), im.map((_, n) => n))
  assert.ok(!urls(im).some((u) => /comentado|script\.co|fuente\.woff2|^data:/.test(u)))
  assert.equal(im[2].alt, 'Logo de la universidad'); assert.equal(im[2].ancho, '120'); assert.equal(im[2].alto, '60')
  assert.equal(im[2].lugar, 'img src'); assert.equal(im[0].lugar, 'fondo (CSS)'); assert.equal(im[10].lugar, 'fondo (style)'); assert.equal(im[5].lugar, 'source srcset')
  assert.match(im[3].contexto, /figura/)
})

test('cambiar una URL no toca nada más del HTML', () => {
  const im = escanearImagenes(FIXTURE)
  const r = aplicarCambios(FIXTURE, { 3: 'https://nuevo.co/fig.png?x=1&y=2', 0: 'https://nuevo.co/fondo.jpg' })
  assert.ok(r.ok, r.error)
  assert.equal(r.cambios.length, 2)
  assert.ok(r.html.includes("src='https://nuevo.co/fig.png?x=1&amp;y=2'")) // el & se escapa en el atributo y se conservan las comillas simples
  assert.ok(r.html.includes('url("https://nuevo.co/fondo.jpg")'))
  const despues = escanearImagenes(r.html)
  const sin = (l) => urls(l).filter((u, n) => n !== 0 && n !== 3)
  assert.deepEqual(sin(despues), sin(im))
  // si se devuelven las URL originales, queda el archivo idéntico, byte a byte
  assert.equal(aplicarCambios(r.html, { 3: im[3].url, 0: im[0].url }).html, FIXTURE)
  // un cambio sin efecto no cambia nada
  assert.equal(aplicarCambios(FIXTURE, { 2: im[2].url }).cambios.length, 0)
})

test('cambiar una URL duplicada solo cambia esa aparición; el srcset conserva sus descriptores', () => {
  const r = aplicarCambios(FIXTURE, { 4: 'https://nuevo.co/otro-logo.png', 9: 'https://nuevo.co/g2.jpg' })
  assert.ok(r.ok, r.error)
  assert.equal(escanearImagenes(r.html)[2].url, 'https://cdn.ejemplo.co/logo.png')
  assert.equal(escanearImagenes(r.html)[4].url, 'https://nuevo.co/otro-logo.png')
  assert.ok(r.html.includes('srcset="https://cdn.ejemplo.co/g.jpg 1x, https://nuevo.co/g2.jpg 2x"'))
  assert.ok(r.html.includes('480w, https://cdn.ejemplo.co/g-960.webp 960w'))
})

test('un cambio no puede meter scripts ni salir del atributo', () => {
  for (const mala of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'https://x.co/a" onerror="alert(1)', 'https://x.co/a b.png', "https://x.co/a'.png", 'https://x.co/<s>.png', 'ftp://x.co/a.png', 'https://x.co/a)b.png', '//x.co/a.png', '']) {
    assert.equal(aplicarCambios(FIXTURE, { 2: mala }).ok, false, 'debía rechazar: ' + mala)
  }
  assert.equal(aplicarCambios(FIXTURE, { 99: 'https://x.co/a.png' }).ok, false) // imagen que no existe
})

test('revisarUrlImagen: solo http/https y nada interno', () => {
  for (const ok of ['https://cdn.ejemplo.co/a.png', 'http://ejemplo.co:8080/a.png?x=1']) assert.equal(revisarUrlImagen(ok), null, ok)
  for (const mala of ['http://localhost/a.png', 'http://127.0.0.1/a.png', 'http://10.0.0.5/a.png', 'http://192.168.1.1/a.png', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/a.png', 'http://2130706433/a.png',
    'https://servidor.internal/a.png', 'https://impresora.local/a.png', 'https://u:p@ejemplo.co/a.png', 'https://ejemplo.co:22/a.png', 'file:///etc/passwd', 'relativa.png', 'https://' + 'a'.repeat(2100) + '.co/x.png']) {
    assert.ok(revisarUrlImagen(mala), 'debía rechazar: ' + mala.slice(0, 60))
  }
})

test('tipoDeImagen reconoce imágenes por sus bytes, no por lo que diga el servidor', () => {
  assert.equal(tipoDeImagen(Buffer.from('89504e470d0a1a0a0000', 'hex')), 'PNG')
  assert.equal(tipoDeImagen(Buffer.from('ffd8ffe000104a46', 'hex')), 'JPEG')
  assert.equal(tipoDeImagen(Buffer.from('GIF89a....')), 'GIF')
  assert.equal(tipoDeImagen(Buffer.from('RIFF\u0001\u0000\u0000\u0000WEBPVP8 ', 'latin1')), 'WebP')
  assert.equal(tipoDeImagen(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')), 'SVG')
  assert.equal(tipoDeImagen(Buffer.from('<!doctype html><html><body>Error 404</body></html>')), null)
  assert.equal(tipoDeImagen(Buffer.from('{"error":"x"}')), null)
})

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
test('validarImagen: válida, no responde, no es imagen, bloqueada (red simulada)', async () => {
  const ok = async () => {}
  const dep = (r) => ({ destino: ok, bajar: async () => { if (r instanceof Error) throw r; return r } })
  assert.equal((await validarImagen('https://x.co/a.png', dep({ estado: 200, tipo: 'image/png', datos: PNG }))).estado, 'valida')
  assert.equal((await validarImagen('https://x.co/a.png', dep({ estado: 404, tipo: 'text/html', datos: Buffer.from('no') }))).estado, 'no_responde')
  assert.equal((await validarImagen('https://x.co/a.png', dep({ estado: 200, tipo: 'text/html', datos: Buffer.from('<html>hola</html>') }))).estado, 'no_es_imagen')
  assert.equal((await validarImagen('https://x.co/a.png', dep(Object.assign(new Error('x'), { name: 'TimeoutError' })))).estado, 'no_responde')
  assert.equal((await validarImagen('https://x.co/a.png', dep(new Error('El archivo es demasiado grande')))).estado, 'no_responde')
  // internas: ni siquiera se intenta descargar
  let intentos = 0
  const espia = { destino: ok, bajar: async () => { intentos++; return { estado: 200, tipo: 'image/png', datos: PNG } } }
  for (const u of ['http://localhost/a.png', 'http://127.0.0.1:8080/a.png', 'http://169.254.169.254/x', 'ftp://x.co/a.png', 'imagenes/a.png']) assert.equal((await validarImagen(u, espia)).estado, 'bloqueada', u)
  assert.equal(intentos, 0)
  // y si el nombre resuelve a una IP interna (lo detecta validarDestino con el DNS), tampoco se descarga
  const real = await validarImagen('https://x.co/a.png', { destino: async () => { throw new Error('Dirección interna no permitida') }, bajar: espia.bajar })
  assert.equal(real.estado, 'bloqueada'); assert.equal(intentos, 0)
})

// ---- rutas con base simulada -------------------------------------------------------------------------------------------------
function baseFalsa(crudo) {
  const est = { crudo, html: null, historial: [], validaciones: new Map(), auditoria: [] }
  const fila = () => ({ nombre: 'g-09-v01', html_crudo: est.crudo, actualizado: new Date('2026-01-01'), formacion: 'profesional', categoria: 'G-09', categoria_nombre: 'Acordeón', categoria_tipo: 'recurso' })
  const sql = async (t, v = []) => {
    if (/auditoria/.test(t)) { est.auditoria.push(v); return { rows: [] } }
    if (/AS revision/.test(t)) return { rows: [{ ...fila(), ejemplo: false, revision: 'aprobada' }, { nombre: 'sin-imgs', actualizado: new Date('2026-01-02'), formacion: null, categoria: null, categoria_nombre: null, categoria_tipo: null, ejemplo: false, revision: null }, { nombre: 'a-act-v01', actualizado: new Date('2026-01-03'), formacion: null, categoria: 'ACT-E-01-TEC', categoria_nombre: 'Cuestionario', categoria_tipo: 'actividad', ejemplo: true, revision: null }] }
    if (/SELECT nombre, html_crudo FROM plantilla_subidas/.test(t)) return { rows: v[0].map((n) => ({ nombre: n, html_crudo: n === 'g-09-v01' ? est.crudo : n === 'a-act-v01' ? '<html><body><img src="https://x.co/a.png"></body></html>' : '<html><body>sin imágenes</body></html>' })) }
    if (/FROM plantilla_imagenes_validacion WHERE plantilla = \$1/.test(t)) return { rows: [...est.validaciones].map(([url, x]) => ({ url, ...x })) }
    if (/FROM plantilla_imagenes_validacion$/.test(t.trim())) return { rows: [...est.validaciones].map(([url, x]) => ({ plantilla: 'g-09-v01', url, ...x })) }
    if (/INSERT INTO plantilla_imagenes_validacion/.test(t)) { est.validaciones.set(v[1], { estado: v[2], detalle: v[3], validadoEn: new Date(), validadoPor: v[4] }); return { rows: [] } }
    if (/FROM plantilla_imagenes_historial/.test(t)) return { rows: est.historial.slice().reverse() }
    if (/WHERE s\.nombre = \$1/.test(t)) return v[0] === 'g-09-v01' ? { rows: [fila()] } : { rows: [] }
    throw new Error('consulta no prevista: ' + t.slice(0, 80))
  }
  const transaccion = async (trabajo) => trabajo({
    query: async (t, v = []) => {
      if (/FOR UPDATE/.test(t)) return { rows: v[0] === 'g-09-v01' ? [{ html_crudo: est.crudo }] : [] }
      if (/UPDATE plantilla_subidas/.test(t)) { est.crudo = v[1]; est.html = v[2]; return { rows: [] } }
      if (/INSERT INTO plantilla_imagenes_historial/.test(t)) { est.historial.push({ id: est.historial.length + 1, usuario: v[2], cambios: JSON.parse(v[3]), creado: new Date() }); return { rows: [] } }
      if (/DELETE FROM plantilla_imagenes_validacion/.test(t)) { for (const u of [...est.validaciones.keys()]) if (!v[1].includes(u)) est.validaciones.delete(u); return { rows: [] } }
      throw new Error('consulta no prevista: ' + t.slice(0, 80))
    }
  })
  return { est, sql, transaccion }
}

async function conServidor(opciones, prueba) {
  const app = express()
  app.use(express.json())
  app.use('/api/plantillas-imagenes', crearRutasImagenes(opciones))
  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)) })
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/plantillas-imagenes'
  const pedir = async (m, ruta, cuerpo) => {
    const r = await fetch(base + ruta, { method: m, headers: cuerpo ? { 'content-type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
    let d = null
    try { d = await r.json() } catch { /* sin cuerpo */ }
    return { estado: r.status, d }
  }
  try { await prueba(pedir) } finally { srv.close() }
}
// Misma regla que la real (exigirPermiso('plantillas.imagenes')), con una sesión simulada.
const conUsuario = (permisos) => [
  (req, res, next) => { req.usuario = { id: '00000000-0000-0000-0000-000000000001', nombre: 'Ela Editora', permisos: new Set(permisos) }; next() },
  (req, res, next) => (req.usuario.permisos.has('plantillas.imagenes') ? next() : res.status(403).json({ error: 'No tienes permiso para esto' }))
]

test('rutas: sin el permiso plantillas.imagenes no se entra a ninguna', async () => {
  const b = baseFalsa(FIXTURE)
  await conServidor({ antes: conUsuario(['plantillas.ver', 'plantillas.revisar', 'plantillas.subir']), sql: b.sql, transaccion: b.transaccion }, async (pedir) => {
    for (const [m, ruta, cuerpo] of [['GET', '/'], ['GET', '/g-09-v01'], ['POST', '/g-09-v01/vista', {}], ['POST', '/g-09-v01/validar', { urls: ['https://x.co/a.png'] }], ['PUT', '/g-09-v01', { base: 'a'.repeat(20), cambios: [{ indice: 0, url: 'https://x.co/a.png' }] }]]) {
      assert.equal((await pedir(m, ruta, cuerpo)).estado, 403, m + ' ' + ruta)
    }
  })
  assert.equal(b.est.crudo, FIXTURE)
})

test('rutas: listar, ver, validar y guardar (queda en historial y auditoría, sin tocar el resto)', async () => {
  const b = baseFalsa(FIXTURE)
  const bajar = async (u) => (u.includes('muerta') ? { estado: 404, tipo: 'text/html', datos: Buffer.from('no') } : { estado: 200, tipo: 'image/png', datos: PNG })
  await conServidor({ antes: conUsuario(['plantillas.imagenes']), sql: b.sql, transaccion: b.transaccion, bajar, destino: async () => {} }, async (pedir) => {
    const lista = (await pedir('GET', '/')).d.plantillas
    assert.deepEqual(lista.map((p) => p.nombre), ['g-09-v01', 'a-act-v01']) // sin imágenes no sale; recursos antes que actividades
    assert.equal(lista[0].imagenes, 12); assert.equal(lista[0].unicas, 10); assert.equal(lista[0].sinValidar, 10); assert.equal(lista[0].revision, 'aprobada')

    const det = (await pedir('GET', '/g-09-v01')).d
    assert.equal(det.imagenes.length, 12); assert.equal(det.imagenes[0].estado, 'sin_validar'); assert.ok(!('inicio' in det.imagenes[0]))
    assert.equal((await pedir('GET', '/no-existe')).estado, 404)

    const v = (await pedir('POST', '/g-09-v01/validar', { urls: ['https://cdn.ejemplo.co/logo.png', 'https://nuevo.co/muerta.png', 'http://127.0.0.1/a.png'] })).d.resultados
    assert.equal(v['https://cdn.ejemplo.co/logo.png'].estado, 'valida'); assert.equal(v['https://nuevo.co/muerta.png'].estado, 'no_responde'); assert.equal(v['http://127.0.0.1/a.png'].estado, 'bloqueada')
    assert.equal((await pedir('POST', '/g-09-v01/validar', { urls: [] })).estado, 400)
    assert.equal((await pedir('GET', '/g-09-v01')).d.imagenes[2].estado, 'valida')

    const vista = (await pedir('POST', '/g-09-v01/vista', { cambios: { 2: 'https://nuevo.co/logo2.png', 3: 'no es url' } })).d
    assert.ok(vista.html.includes('https://nuevo.co/logo2.png')); assert.deepEqual(vista.ignoradas, [3]); assert.ok(!vista.html.includes('{{TITULO}}'))
    assert.equal(b.est.crudo, FIXTURE) // la vista previa no guarda

    const base = det.base
    for (const mala of [{ indice: 2, url: 'http://localhost/a.png' }, { indice: 2, url: 'javascript:alert(1)' }, { indice: 500, url: 'https://x.co/a.png' }]) assert.notEqual((await pedir('PUT', '/g-09-v01', { base, cambios: [mala] })).estado, 200)
    assert.equal((await pedir('PUT', '/g-09-v01', { base: 'f'.repeat(20), cambios: [{ indice: 2, url: 'https://nuevo.co/a.png' }] })).estado, 409) // la plantilla cambió mientras tanto
    assert.equal((await pedir('PUT', '/g-09-v01', { base, cambios: [{ indice: 2, url: det.imagenes[2].url }] })).estado, 400) // sin cambios reales
    assert.equal(b.est.crudo, FIXTURE)

    const g = await pedir('PUT', '/g-09-v01', { base, cambios: [{ indice: 2, url: 'https://nuevo.co/logo2.png' }, { indice: 3, url: 'https://nuevo.co/fig.png' }] })
    assert.equal(g.estado, 200); assert.equal(g.d.cambiadas, 2)
    assert.equal(escanearImagenes(b.est.crudo)[2].url, 'https://nuevo.co/logo2.png')
    assert.notEqual(g.d.base, base)
    assert.equal(g.d.imagenes[2].estado, 'sin_validar') // la URL nueva no se validó todavía
    // las dos versiones coherentes: la armada sale del crudo nuevo
    assert.equal(b.est.html, armarSubida(b.est.crudo).html)
    assert.ok(b.est.html.includes('https://nuevo.co/logo2.png') && !b.est.html.includes('https://cdn.ejemplo.co/figura.jpg'))
    // lo demás idéntico: solo difieren esas dos URL
    assert.equal(b.est.crudo.replace('https://nuevo.co/logo2.png', 'https://cdn.ejemplo.co/logo.png').replace('https://nuevo.co/fig.png', 'https://cdn.ejemplo.co/figura.jpg?a=1&amp;b=2'), FIXTURE)
    assert.equal(b.est.historial.length, 1); assert.equal(b.est.historial[0].usuario, 'Ela Editora'); assert.equal(b.est.historial[0].cambios[0].antes, 'https://cdn.ejemplo.co/logo.png')
    assert.equal(g.d.historial.length, 1)
    assert.ok(b.est.auditoria.some((a) => a[1] === 'plantilla_imagenes_editar' && a[3] === 'g-09-v01'))
  })
})

// ---- URL de imagen definidas en JavaScript (constante + img.src = CONSTANTE) --------------------------------------------------
const SCRIPT = fs.readFileSync(path.join(aqui, 'fixtures', 'imagenes', 'script.html'), 'utf8')
test('script: detecta URL de imagen en literales de JS, con variable y contexto, y nada más', () => {
  const im = escanearImagenes(SCRIPT)
  assert.deepEqual(urls(im), [
    'https://drive.google.com/thumbnail?id=1oqZTfJsT6CfNgBByHyRh05cUuJKtCErR&sz=w1000', // el & va tal cual: en JS no es una entidad
    'https://cdn.ejemplo.co/otra.webp', 'https://cdn.ejemplo.co/igual.png', 'https://cdn.ejemplo.co/igual.png',
    'https://cdn.ejemplo.co/sin-extension/123', // su variable se asigna a .src
    'https://cdn.ejemplo.co/directa' // asignada directamente a .src
  ])
  assert.ok(im.every((i) => i.lugar === 'script'))
  assert.deepEqual(im.map((i) => i.variable), ['IMAGEN_EJEMPLO', 'OTRA', 'REPETIDA', 'REPETIDA2', 'SIN_EXT', null])
  assert.match(im[0].contexto, /IMAGEN_EJEMPLO/)
  assert.ok(!urls(im).some((u) => /comentada|pagina\.html|api\.ejemplo|json\.co/.test(u)))
})

test('script: cambiar la URL conserva comillas y todo lo demás; escapa la comilla; la vuelta atrás deja el archivo idéntico', () => {
  const im = escanearImagenes(SCRIPT)
  const r = aplicarCambios(SCRIPT, { 0: 'https://nuevo.co/a.png?x=1&y=2', 1: 'https://nuevo.co/o.webp' })
  assert.ok(r.ok, r.error)
  assert.ok(r.html.includes("var IMAGEN_EJEMPLO = 'https://nuevo.co/a.png?x=1&y=2';")) // comillas simples y & sin tocar
  assert.ok(r.html.includes('var OTRA = "https://nuevo.co/o.webp";')) // comillas dobles
  assert.ok(r.html.includes('img.src = IMAGEN_EJEMPLO;'))
  assert.equal(aplicarCambios(r.html, { 0: im[0].url, 1: im[1].url }).html, SCRIPT)
  // la URL repetida: cada aparición es su propio cambio
  const d = aplicarCambios(SCRIPT, { 3: 'https://nuevo.co/b.png' })
  assert.deepEqual(urls(escanearImagenes(d.html)).slice(2, 4), ['https://cdn.ejemplo.co/igual.png', 'https://nuevo.co/b.png'])
  // una URL sin extensión sigue encontrándose si su variable va a .src
  assert.ok(aplicarCambios(SCRIPT, { 4: 'https://nuevo.co/sin/ext' }).ok)
  // la que no se podría volver a encontrar se rechaza con un mensaje claro, sin guardar
  const mala = aplicarCambios(SCRIPT, { 2: 'https://nuevo.co/sin-ext' })
  assert.equal(mala.ok, false); assert.match(mala.error, /termine|terminar/)
  for (const x of ['javascript:alert(1)', "https://x.co/a.png';alert(1);'", 'data:image/png;base64,AAAA', String.raw`https://x.co/a\.png`]) assert.equal(aplicarCambios(SCRIPT, { 0: x }).ok, false, x)
})

test('script: la vista armada también lleva la URL nueva', () => {
  const r = aplicarCambios(SCRIPT, { 0: 'https://nuevo.co/a.png' })
  const armada = armarSubida(r.html)
  assert.ok(armada.ok, armada.error)
  assert.ok(armada.ejemplo.includes("var IMAGEN_EJEMPLO = 'https://nuevo.co/a.png';"))
})
