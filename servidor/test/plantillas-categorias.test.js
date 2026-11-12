// Categorías de las plantillas HTML (para n8n): cada categoría (ID del catálogo + nombre) reúne variantes; el índice público sale agrupado
// sin romper lo que n8n ya lee, y si la base de datos falla se entrega el archivo del build tal cual.
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
const PUERTO_PG = 54339
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-cat-'))
const web = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-web-cat-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
// Lo que escribe el build (sin categorías): 3 acordeones, una línea de tiempo, una de crucigrama y una nueva sin categoría.
const NOMBRES = ['acordeon', 'acordeon-2', 'acordeon-3', 'lineatiempo', 'crucigrama', 'nueva-plantilla']

let servidor, base, pool
let poolCerrado = false
before(async () => {
  fs.mkdirSync(path.join(web, 'plantillas-html'))
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>app</title>')
  fs.writeFileSync(path.join(web, 'plantillas-html', 'plantillas.json'), JSON.stringify({ marcas: { titulo: '{{TITULO}}', contenido: '/*CONTENIDO*/' }, total: NOMBRES.length, plantillas: NOMBRES.map((n) => ({ nombre: n, archivo: n + '.html' })) }))
  await servidorPg.initialise(); await servidorPg.start(); await servidorPg.createDatabase('ova')
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  const sql = (f) => fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8')
  for (const f of ['001_esquema.sql', '002_bibliografia.sql']) await dueno.query(sql(f))
  await dueno.query(sql('001_esquema.sql')) // volver a migrar no debe repetir ni pisar el punto de partida
  await dueno.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.CARPETA_WEB = web
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [n, c, r] of [['Admin', 'admin@u.co', 'admin'], ['Dani', 'dani@u.co', 'disenador'], ['Ana', 'ana@u.co', 'docente']]) await pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), [r]])
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})
after(async () => {
  servidor && servidor.close()
  if (pool && !poolCerrado) await pool.end()
  await servidorPg.stop()
  for (const d of [dir, web]) fs.rmSync(d, { recursive: true, force: true })
})

async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const h = { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1', 'content-type': 'application/json' }
  return (m, ruta, cuerpo) => fetch(base + '/api' + ruta, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
}
const indice = async () => (await fetch(base + '/plantillas-html/plantillas.json')).json()

test('punto de partida: el catálogo ya está creado, las plantillas de nombre inequívoco ya tienen categoría y migrar de nuevo no lo repite', async () => {
  const dani = await entrar('dani@u.co')
  const j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.equal(j.categorias.length, 13); assert.deepEqual(j.categorias.find((c) => c.id === 'G-09'), { id: 'G-09', nombre: 'Acordeón' })
  assert.equal(j.asignaciones.acordeon, 'G-09'); assert.equal(j.asignaciones['lineatiempo-3'], 'G-12')
  assert.equal(j.asignaciones.crucigrama, undefined) // sin ID en el catálogo: queda sin categoría
  assert.deepEqual(j.plantillas, NOMBRES) // las que publicó el build
})

test('quién puede: ver, cualquiera que vea las plantillas; cambiar, quien las revisa (diseñador y administrador), y sin sesión nada', async () => {
  assert.equal((await fetch(base + '/api/plantillas/categorias', { headers: { 'x-ova': '1' } })).status, 401)
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('GET', '/plantillas/categorias')).status, 200)
  assert.equal((await ana('POST', '/plantillas/categorias', { id: 'G-20', nombre: 'Nueva' })).status, 403)
  assert.equal((await ana('PUT', '/plantillas/asignacion/crucigrama', { categoria: 'G-09' })).status, 403)
  assert.equal((await ana('DELETE', '/plantillas/categorias/G-09')).status, 403)
})

test('crear, renombrar, asignar, quitar y borrar una categoría; todo se valida', async () => {
  const dani = await entrar('dani@u.co')
  const admin = await entrar('admin@u.co')
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'g-20', nombre: 'x' })).status, 400) // el ID es del catálogo: letras mayúsculas, guion y números
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'G-20', nombre: '   ' })).status, 400)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'G-20', nombre: 'Crucigrama', extra: 1 })).status, 400)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'G-20', nombre: 'Crucigrama' })).status, 201)
  assert.equal((await admin('POST', '/plantillas/categorias', { id: 'G-20', nombre: 'Otra' })).status, 409) // ya existe
  assert.equal((await dani('PUT', '/plantillas/categorias/G-20', { nombre: 'Crucigrama interactivo' })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/categorias/G-99', { nombre: 'No existe' })).status, 404)
  assert.equal((await dani('PUT', '/plantillas/asignacion/crucigrama', { categoria: 'G-20' })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/asignacion/crucigrama', { categoria: 'G-77' })).status, 404) // categoría inexistente
  assert.equal((await dani('PUT', '/plantillas/asignacion/Mala Plantilla', { categoria: 'G-20' })).status, 400)
  assert.equal((await dani('PUT', '/plantillas/asignacion/nueva-plantilla', { categoria: 'G-09' })).status, 200) // una variante nueva de acordeón
  const j = await (await admin('GET', '/plantillas/categorias')).json()
  assert.equal(j.categorias.find((c) => c.id === 'G-20').nombre, 'Crucigrama interactivo'); assert.equal(j.asignaciones.crucigrama, 'G-20')
  assert.equal((await dani('PUT', '/plantillas/asignacion/nueva-plantilla', { categoria: null })).status, 200) // quitarla
  assert.equal((await (await admin('GET', '/plantillas/categorias')).json()).asignaciones['nueva-plantilla'], undefined)
  const aud = (await pool.query("SELECT accion FROM auditoria WHERE accion LIKE 'plantilla_categoria%'")).rows.map((x) => x.accion)
  assert.ok(aud.includes('plantilla_categoria_crear') && aud.includes('plantilla_categoria_asignar'))
})

test('el índice público sale agrupado por categoría, sin sesión, y conserva lo que n8n ya leía', async () => {
  const j = await indice()
  // lo de siempre
  assert.equal(j.total, NOMBRES.length); assert.equal(j.marcas.contenido, '/*CONTENIDO*/'); assert.deepEqual(j.plantillas.map((p) => p.nombre), NOMBRES)
  assert.ok(j.plantillas.every((p) => p.archivo === p.nombre + '.html'))
  // lo nuevo
  assert.equal(j.plantillas.find((p) => p.nombre === 'acordeon-2').id_catalogo, 'G-09')
  const acordeon = j.categorias.find((c) => c.id === 'G-09')
  assert.deepEqual(acordeon.variantes.map((v) => v.nombre), ['acordeon', 'acordeon-2', 'acordeon-3'])
  assert.equal(acordeon.nombre, 'Acordeón')
  assert.deepEqual(j.categorias.find((c) => c.id === 'G-20').variantes, [{ nombre: 'crucigrama', archivo: 'crucigrama.html' }])
  assert.deepEqual(j.sin_categoria.map((p) => p.nombre), ['nueva-plantilla']) // la que se dejó sin categoría
  assert.equal(j.categorias.find((c) => c.id === 'G-01').variantes.length, 0) // categoría sin variantes todavía
})

test('borrar una categoría deja sus plantillas sin categoría; si falla la base de datos se entrega el archivo del build tal cual', async () => {
  const dani = await entrar('dani@u.co')
  assert.equal((await dani('DELETE', '/plantillas/categorias/G-20')).status, 200)
  assert.equal((await dani('DELETE', '/plantillas/categorias/G-20')).status, 404)
  let j = await indice()
  assert.equal(j.categorias.some((c) => c.id === 'G-20'), false)
  assert.equal(j.plantillas.find((p) => p.nombre === 'crucigrama').id_catalogo, null)
  assert.ok(j.sin_categoria.some((p) => p.nombre === 'crucigrama'))
  // la base de datos deja de responder: n8n sigue recibiendo las plantillas
  await pool.end(); poolCerrado = true
  const r = await fetch(base + '/plantillas-html/plantillas.json')
  assert.equal(r.status, 200)
  j = await r.json()
  assert.equal(j.total, NOMBRES.length); assert.equal(j.categorias, undefined)
})
