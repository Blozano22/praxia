// «Plantillas con imágenes» contra una base real (PostgreSQL embebido): migración 016, rol «editor_imagenes» con solo su permiso, rutas y consultas reales.
// La base temporal se crea en UTF8 (las demás suites usan la codificación por defecto de Windows, WIN1252, y fallan localmente por eso; en Linux no).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const PUERTO_PG = 54352
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-img-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] })
const CLAVE = 'ClaveSegura123'

let servidor, base, pool, dueno
before(async () => {
  await servidorPg.initialise(); await servidorPg.start(); await servidorPg.createDatabase('ova')
  dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  const sql = path.join(aqui, '..', 'sql')
  for (const f of fs.readdirSync(sql).filter((x) => x.endsWith('.sql')).sort()) await dueno.query(fs.readFileSync(path.join(sql, f), 'utf8'))
  await dueno.query(fs.readFileSync(path.join(sql, '016_plantillas_imagenes.sql'), 'utf8')) // la migración se puede repetir
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [nombre, correo, rol] of [['Dani', 'dani@u.co', 'disenador'], ['Edu', 'edu@u.co', 'editor_html'], ['Ela', 'ela@u.co', 'editor_imagenes'], ['Admin', 'admin@u.co', 'admin'], ['Rita', 'rita@u.co', 'generador_rubricas']]) {
    await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), [rol]])
  }
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})
after(async () => {
  servidor && servidor.close()
  pool && (await pool.end())
  dueno && (await dueno.end())
  await servidorPg.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const h = { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1', 'content-type': 'application/json' }
  return async (m, ruta, cuerpo) => {
    const x = await fetch(base + '/api' + ruta, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
    let d = null
    try { d = await x.json() } catch { /* sin cuerpo */ }
    return { estado: x.status, d }
  }
}
const HTML = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{{TITULO}}</title><style>.a{background-image:url(https://cdn.ejemplo.co/fondo.jpg)}</style></head><body>' +
  '<img src="https://cdn.ejemplo.co/uno.png" alt="Uno"><img src="https://cdn.ejemplo.co/uno.png" alt="Uno otra vez"><img srcset="https://cdn.ejemplo.co/dos.png 1x, https://cdn.ejemplo.co/dos2.png 2x" alt="Dos">' +
  '<script type="application/json" id="contenido">/*CONTENIDO*/{"titulo":"Hola"}/*FIN-CONTENIDO*/</script></body></html>'

test('el rol editor_imagenes tiene solo su permiso y no puede tocar el resto de las plantillas', async () => {
  const r = await pool.query("SELECT p.codigo FROM roles r JOIN rol_permisos rp ON rp.rol_id = r.id JOIN permisos p ON p.id = rp.permiso_id WHERE r.nombre = 'editor_imagenes'")
  assert.deepEqual(r.rows.map((x) => x.codigo), ['plantillas.imagenes'])
  const ela = await entrar('ela@u.co')
  assert.deepEqual((await ela('GET', '/auth/yo')).d.permisos, ['plantillas.imagenes'])
  for (const [m, ruta, cuerpo] of [['GET', '/plantillas/categorias'], ['GET', '/plantillas/revisiones'], ['POST', '/plantillas/subidas', { html: HTML, categoria: 'G-72' }], ['PUT', '/plantillas/subidas/g-72-v01', { html: HTML }], ['DELETE', '/plantillas/subidas/g-72-v01'], ['POST', '/plantillas/subidas/archivar-todas', {}], ['POST', '/plantillas/revisiones', { plantilla: 'pub-g-72-v01', estado: 'aprobada', observacion: '' }]]) {
    assert.equal((await ela(m, ruta, cuerpo)).estado, 403, m + ' ' + ruta)
  }
  // y los demás roles de plantillas no entran a la pantalla nueva
  for (const c of ['edu@u.co', 'dani@u.co', 'admin@u.co']) assert.equal((await (await entrar(c))('GET', '/plantillas-imagenes')).estado, 403, c)
  assert.equal((await fetch(base + '/api/plantillas-imagenes', { headers: { 'x-ova': '1' } })).status, 401) // sin sesión
})

test('el administrador puede asignar el rol nuevo desde Usuarios', async () => {
  const admin = await entrar('admin@u.co')
  const u = (await admin('GET', '/usuarios')).d.find((x) => x.correo === 'edu@u.co')
  assert.equal((await admin('PATCH', '/usuarios/' + u.id + '/roles', { roles: ['editor_html', 'editor_imagenes'] })).estado, 200)
  const edu = await entrar('edu@u.co')
  assert.deepEqual((await edu('GET', '/auth/yo')).d.roles.sort(), ['editor_html', 'editor_imagenes'])
  assert.equal((await edu('GET', '/plantillas-imagenes')).estado, 200)
  assert.equal((await admin('PATCH', '/usuarios/' + u.id + '/roles', { roles: ['editor_html'] })).estado, 200)
})

test('listar, ver, guardar URL: solo cambian esas URL, las dos versiones del HTML coinciden y queda en historial y auditoría', async () => {
  const dani = await entrar('dani@u.co'); const edu = await entrar('edu@u.co'); const ela = await entrar('ela@u.co')
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'G-72', nombre: 'Con imágenes' })).estado, 201)
  const s = await edu('POST', '/plantillas/subidas', { html: HTML, categoria: 'G-72' })
  assert.equal(s.estado, 201)
  const nombre = s.d.nombre
  const sinImg = await edu('POST', '/plantillas/subidas', { html: HTML.replace(/<img[^>]*>/g, '').replace(/<style>.*<\/style>/, ''), categoria: 'G-72' }) // misma ficha, sin imágenes

  const lista = (await ela('GET', '/plantillas-imagenes')).d.plantillas
  assert.deepEqual(lista.map((p) => p.nombre), [nombre]) // la que no trae imágenes no sale
  assert.equal(lista[0].imagenes, 5); assert.equal(lista[0].unicas, 4); assert.equal(lista[0].categoria.id, 'G-72'); assert.equal(lista[0].sinValidar, 4)
  assert.equal(sinImg.estado, 201); assert.ok(!lista.some((p) => p.nombre === sinImg.d.nombre))

  const det = (await ela('GET', '/plantillas-imagenes/' + nombre)).d
  assert.deepEqual(det.imagenes.map((i) => i.url), ['https://cdn.ejemplo.co/fondo.jpg', 'https://cdn.ejemplo.co/uno.png', 'https://cdn.ejemplo.co/uno.png', 'https://cdn.ejemplo.co/dos.png', 'https://cdn.ejemplo.co/dos2.png'])
  assert.equal((await ela('POST', '/plantillas-imagenes/' + nombre + '/vista', { cambios: { 1: 'https://nuevo.co/n.png' } })).d.html.includes('https://nuevo.co/n.png'), true)

  const val = (await ela('POST', '/plantillas-imagenes/' + nombre + '/validar', { urls: ['http://127.0.0.1/a.png', 'http://169.254.169.254/latest', 'file:///etc/passwd'] })).d.resultados
  assert.deepEqual(Object.values(val).map((x) => x.estado), ['bloqueada', 'bloqueada', 'bloqueada'])
  assert.equal((await ela('PUT', '/plantillas-imagenes/' + nombre, { base: det.base, cambios: [{ indice: 1, url: 'http://localhost:3002/a.png' }] })).estado, 400)

  const antes = (await pool.query('SELECT html_crudo, html, subida_por FROM plantilla_subidas WHERE nombre = $1', [nombre])).rows[0]
  const g = await ela('PUT', '/plantillas-imagenes/' + nombre, { base: det.base, cambios: [{ indice: 2, url: 'https://nuevo.co/uno-b.png?a=1&b=2' }, { indice: 3, url: 'https://nuevo.co/dos.png' }] })
  assert.equal(g.estado, 200, JSON.stringify(g.d)); assert.equal(g.d.cambiadas, 2)
  const despues = (await pool.query('SELECT html_crudo, html, subida_por, esquema FROM plantilla_subidas WHERE nombre = $1', [nombre])).rows[0]
  assert.equal(despues.subida_por, antes.subida_por) // la plantilla sigue siendo de quien la subió
  assert.equal(despues.html_crudo.replace('https://nuevo.co/uno-b.png?a=1&amp;b=2', 'https://cdn.ejemplo.co/uno.png').replace('https://nuevo.co/dos.png', 'https://cdn.ejemplo.co/dos.png'), antes.html_crudo)
  assert.ok(despues.html.includes('https://nuevo.co/uno-b.png?a=1&amp;b=2') && !despues.html.includes('cdn.ejemplo.co/dos.png'))
  assert.ok(despues.html.includes('https://cdn.ejemplo.co/uno.png') && despues.html.includes('https://cdn.ejemplo.co/fondo.jpg')) // lo que no se tocó, igual
  assert.ok(despues.esquema) // el esquema de campos no se altera

  const h = (await pool.query('SELECT usuario_nombre, cambios FROM plantilla_imagenes_historial WHERE plantilla = $1', [nombre])).rows
  assert.equal(h.length, 1); assert.equal(h[0].usuario_nombre, 'Ela'); assert.deepEqual(h[0].cambios.map((c) => c.indice), [2, 3]); assert.equal(h[0].cambios[0].antes, 'https://cdn.ejemplo.co/uno.png')
  assert.equal((await pool.query("SELECT 1 FROM auditoria WHERE accion = 'plantilla_imagenes_editar' AND entidad_id = $1", [nombre])).rowCount, 1)
  // la plantilla se entrega con la URL nueva (n8n y la vista pública)
  assert.ok((await (await fetch(base + '/plantillas-html/' + nombre + '.html')).text()).includes('https://nuevo.co/dos.png'))
  // con la versión vieja en pantalla ya no se puede guardar encima
  assert.equal((await ela('PUT', '/plantillas-imagenes/' + nombre, { base: det.base, cambios: [{ indice: 0, url: 'https://nuevo.co/f.jpg' }] })).estado, 409)
  assert.equal((await ela('GET', '/plantillas-imagenes/' + nombre)).d.historial.length, 1)
})

test('cambio masivo con la base real: agrupa por URL, aplica en varias plantillas, salta la editada por otra persona y deja historial y auditoría', async () => {
  const dani = await entrar('dani@u.co'); const edu = await entrar('edu@u.co'); const ela = await entrar('ela@u.co')
  const subir = async () => (await edu('POST', '/plantillas/subidas', { html: HTML, categoria: 'G-72' })).d.nombre
  const n1 = await subir(); const n2 = await subir()
  assert.ok(n1 && n2 && n1 !== n2)
  const m = (await ela('GET', '/plantillas-imagenes/masivo')).d
  const fila = m.urls.find((u) => u.url === 'https://cdn.ejemplo.co/uno.png')
  assert.ok(fila.plantillas.length >= 2 && fila.plantillas.some((p) => p.nombre === n1) && fila.plantillas.some((p) => p.nombre === n2))
  const act = (n) => m.plantillas.find((p) => p.nombre === n).actualizado
  // otra persona edita n2 mientras tanto
  const det2 = (await ela('GET', '/plantillas-imagenes/' + n2)).d
  assert.equal((await ela('PUT', '/plantillas-imagenes/' + n2, { base: det2.base, cambios: [{ indice: 0, url: 'https://cdn.ejemplo.co/fondo2.jpg' }] })).estado, 200)
  // la URL nueva es de red: se confirma expresamente (en el servidor de pruebas no hay internet)
  const r = await ela('POST', '/plantillas-imagenes/masivo/aplicar', { confirmarInvalida: true, reemplazos: [{ anterior: 'https://cdn.ejemplo.co/uno.png', nueva: 'https://nuevo.invalid/uno.png', plantillas: [n1, n2].map((n) => ({ nombre: n, actualizado: act(n) })) }] })
  assert.equal(r.estado, 200, JSON.stringify(r.d))
  assert.ok(r.d.cambiadas.some((x) => x.nombre === n1)); assert.deepEqual(r.d.saltadas, [{ nombre: n2, motivo: 'modificada' }])
  const f1 = (await pool.query('SELECT html_crudo, html FROM plantilla_subidas WHERE nombre = $1', [n1])).rows[0]
  assert.equal(f1.html_crudo.split('https://nuevo.invalid/uno.png').length - 1, 2); assert.ok(!f1.html_crudo.includes('cdn.ejemplo.co/uno.png') && f1.html.includes('https://nuevo.invalid/uno.png'))
  const f2 = (await pool.query('SELECT html_crudo FROM plantilla_subidas WHERE nombre = $1', [n2])).rows[0]
  assert.ok(f2.html_crudo.includes('cdn.ejemplo.co/uno.png') && f2.html_crudo.includes('fondo2.jpg')) // la editada por otra persona, intacta
  const h = (await pool.query('SELECT usuario_nombre, cambios FROM plantilla_imagenes_historial WHERE plantilla = $1 ORDER BY id', [n1])).rows
  assert.equal(h.length, 1); assert.equal(h[0].usuario_nombre, 'Ela'); assert.equal(h[0].cambios[0].despues, 'https://nuevo.invalid/uno.png'); assert.equal(h[0].cambios[0].masivo, true)
  assert.equal((await pool.query("SELECT 1 FROM auditoria WHERE accion = 'plantilla_imagenes_masivo'")).rowCount, 1)
  // sin confirmar, una URL que no responde no se aplica
  assert.equal((await ela('POST', '/plantillas-imagenes/masivo/aplicar', { reemplazos: [{ anterior: 'https://nuevo.invalid/uno.png', nueva: 'https://otro.invalid/uno.png', plantillas: [{ nombre: n1, actualizado: (await ela('GET', '/plantillas-imagenes/masivo')).d.plantillas.find((p) => p.nombre === n1).actualizado }] }] })).estado, 422)
  assert.equal((await dani('GET', '/plantillas-imagenes/masivo')).estado, 403)
})

test('rol generador_rubricas: solo su permiso; la dirección del flujo la guarda la administración y la lee la pantalla', async () => {
  const r = await pool.query("SELECT p.codigo FROM roles r JOIN rol_permisos rp ON rp.rol_id = r.id JOIN permisos p ON p.id = rp.permiso_id WHERE r.nombre = 'generador_rubricas'")
  assert.deepEqual(r.rows.map((x) => x.codigo), ['rubricas.generar'])
  const rita = await entrar('rita@u.co'); const admin = await entrar('admin@u.co'); const ela = await entrar('ela@u.co')
  assert.deepEqual((await rita('GET', '/auth/yo')).d.permisos, ['rubricas.generar'])
  for (const [m, ruta] of [['GET', '/plantillas-imagenes'], ['GET', '/plantillas/categorias'], ['GET', '/proyectos'], ['GET', '/usuarios']]) assert.equal((await rita(m, ruta)).estado, 403, ruta)
  assert.equal((await ela('GET', '/rubricas/estado')).estado, 403) // los demás roles no entran
  assert.equal((await rita('GET', '/rubricas/estado')).d.configurada, false)
  assert.equal((await rita('PUT', '/config/n8n', { rubricas: 'https://n8n.x/webhook/rubricas' })).estado, 403) // solo la administración la cambia
  assert.equal((await admin('PUT', '/config/n8n', { rubricas: 'https://n8n.x/webhook/rubricas' })).estado, 200)
  assert.equal((await admin('GET', '/config/n8n')).d.rubricas, 'https://n8n.x/webhook/rubricas')
  assert.equal((await rita('GET', '/rubricas/estado')).d.configurada, true)
  assert.equal((await rita('POST', '/rubricas', { unidades: ['https://ejemplo.com/x'], carpeta_url: 'x' })).estado, 400)
  const u = (await admin('GET', '/usuarios')).d.find((x) => x.correo === 'rita@u.co')
  assert.equal((await admin('PATCH', '/usuarios/' + u.id + '/roles', { roles: ['generador_rubricas', 'editor_imagenes'] })).estado, 200) // la administración puede asignarlo
})
