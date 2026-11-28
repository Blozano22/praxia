// Reemplazo en masa de variantes de una categoría: todas a la vez o ninguna; los campos se comparan entre las nuevas y contra las que no se reemplazan.
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
const PUERTO_PG = 54500
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-rm-'))
const web = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-web-rm-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
// Lo que escribe el build (sin categorías): 3 acordeones, una línea de tiempo, una de crucigrama y una nueva sin categoría.
const NOMBRES = ['acordeon', 'acordeon-2', 'acordeon-3', 'crucigrama', 'lineatiempo', 'nueva-plantilla']

let servidor, base, pool
let poolCerrado = false
before(async () => {
  fs.mkdirSync(path.join(web, 'plantillas-html'))
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>app</title>')
  for (const n of NOMBRES) fs.writeFileSync(path.join(web, 'plantillas-html', n + '.html'), '<html><title>{{TITULO}}</title>/*CONTENIDO*/</html>')
  fs.writeFileSync(path.join(web, 'plantillas-html', 'plantillas.json'), JSON.stringify({ marcas: { titulo: '{{TITULO}}', contenido: '/*CONTENIDO*/' }, total: NOMBRES.length, plantillas: NOMBRES.map((n) => ({ nombre: n, archivo: n + '.html' })) }))
  await servidorPg.initialise(); await servidorPg.start(); await servidorPg.createDatabase('ova')
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  const sql = (f) => fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8')
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql', '025_asignar_diseno.sql', '026_correcciones.sql', '027_cola_regenerar.sql', '028_cola_partes.sql', '029_permiso_h5p.sql', '030_plantilla_reemplazada.sql', '031_disenador_sin_categorias.sql']) await dueno.query(sql(f))
  await dueno.query(sql('001_esquema.sql')) // volver a migrar no debe repetir ni pisar el punto de partida
  await dueno.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.SERVICIO_PLANTILLAS_CLAVE = 'clave-del-banco' // el banco de íconos la usa por defecto con el servicio de H5P
  process.env.CARPETA_WEB = web
  process.env.PLANTILLAS_INDICE_SOLO_SUBIDAS = '0' // estas pruebas parten de un índice con las plantillas del build; la prueba de «solo subidas» lo cambia a propósito
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [n, c, r] of [['Admin', 'admin@u.co', ['admin', 'disenador']], ['Dani', 'dani@u.co', 'disenador'], ['Ana', 'ana@u.co', 'docente'], ['Edi', 'edi@u.co', 'editor_html'], ['Edu', 'edu@u.co', 'editor_html']]) await pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), [r].flat()])
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

const html = (datos) => '<!doctype html><html lang="es"><head><meta charset="utf-8"><!-- Formación: tecnologico --><title>{{TITULO}}</title><style>/*CSS*/</style></head><body><div id="app"></div><script>const D=/*CONTENIDO*/' + JSON.stringify(datos) + '/*FIN-CONTENIDO*/;</script></body></html>'
const BASE = { titulo: 'T', datos: [{ texto: 'a' }] }
const NUEVO = { titulo: 'T', imagen_url: 'x', datos: [{ texto: 'a', imagen_url: 'x' }] }
const esquemaDe = async (n) => (await pool.query('SELECT esquema FROM plantilla_subidas WHERE nombre = $1', [n])).rows[0].esquema

test('reemplazo en masa: de punta a punta, validaciones, atomicidad y permisos', async () => {
  const dani = await entrar('dani@u.co'), ana = await entrar('ana@u.co'), edi = await entrar('edi@u.co'), edu = await entrar('edu@u.co')
  const subir = async (u, cat) => (await (await u('POST', '/plantillas/subidas', { html: html(BASE), categoria: cat })).json()).nombre
  const v1 = await subir(dani, 'G-10'), v2 = await subir(dani, 'G-10'), v3 = await subir(dani, 'G-10')
  const sin = [v1, v2, v3].map((n) => n)
  assert.ok(v1 && v2 && v3 && v1 !== v2)
  const viejo = await esquemaDe(v1)
  const masivo = (u, archivos, soloVerificar) => u('POST', '/plantillas/subidas/reemplazo-masivo', { archivos, soloVerificar })
  // una sola de las tres con campos nuevos: no coincide con las que no se reemplazan
  let r = await masivo(dani, [{ nombre: v1, html: html(NUEVO) }])
  assert.equal(r.status, 409)
  let j = await r.json(); assert.equal(j.resultados[0].ok, false); assert.ok(j.resultados[0].sobran.some((p) => p.startsWith('imagen_url')))
  assert.deepEqual(await esquemaDe(v1), viejo)
  // las nuevas entre sí con campos distintos
  r = await masivo(dani, [{ nombre: v1, html: html(NUEVO) }, { nombre: v2, html: html(BASE) }, { nombre: v3, html: html(NUEVO) }])
  assert.equal(r.status, 409)
  assert.deepEqual(await esquemaDe(v1), viejo); assert.deepEqual(await esquemaDe(v3), viejo) // atomicidad: ninguna cambió
  // nombres: inexistente y duplicado
  assert.equal((await masivo(dani, [{ nombre: 'no-existe', html: html(NUEVO) }])).status, 409)
  assert.equal((await masivo(dani, [{ nombre: v1, html: html(NUEVO) }, { nombre: v1, html: html(NUEVO) }])).status, 400)
  assert.equal((await masivo(dani, [])).status, 400)
  assert.equal((await masivo(dani, [{ nombre: 'acordeon', html: html(NUEVO) }])).status, 409) // del sistema
  assert.equal((await masivo(dani, [{ nombre: v1, html: '<html>sin marcas</html>' }])).status, 409)
  // permisos
  assert.equal((await masivo(ana, [{ nombre: v1, html: html(NUEVO) }])).status, 403)
  assert.equal((await masivo(edi, [{ nombre: v1, html: html(NUEVO) }])).status, 403) // no son suyas
  // verificar no guarda
  const todas = [v1, v2, v3].map((nombre) => ({ nombre, html: html(NUEVO) }))
  r = await masivo(dani, todas, true); assert.equal(r.status, 200); assert.equal((await r.json()).verificado, true)
  assert.deepEqual(await esquemaDe(v1), viejo)
  // reemplazar todas: pasa y las tres quedan con el esquema nuevo
  r = await masivo(dani, todas); assert.equal(r.status, 200)
  j = await r.json(); assert.deepEqual(j.resultados.map((x) => x.ok), [true, true, true])
  for (const n of sin) { const e = await esquemaDe(n); assert.ok(e.includes('imagen_url:texto') && e.includes('datos[].imagen_url:texto')) }
  const aud = await pool.query("SELECT count(*)::int AS n FROM auditoria WHERE accion = 'plantilla_reemplazo_masivo'").catch(() => null)
  if (aud) assert.equal(aud.rows[0].n, 1)
  // un editor reemplaza en masa solo lo suyo
  const e1 = await subir(edi, 'G-09'), e2 = await subir(edi, 'G-09'), d1 = await subir(edu, 'G-11')
  assert.ok(e1 && e2 && d1)
  assert.equal((await masivo(edi, [e1, e2, d1].map((nombre) => ({ nombre, html: html(NUEVO) })))).status, 403) // d1 es de otra persona: nada se guarda
  assert.equal((await masivo(edi, [e1, e2].map((nombre) => ({ nombre, html: html(NUEVO) })))).status, 200)
})

test('reemplazar no cambia el autor: el admin reemplaza (suelto y en masa) y queda registrado quién', async () => {
  const edi = await entrar('edi@u.co'), admin = await entrar('admin@u.co')
  const subir = async () => (await (await edi('POST', '/plantillas/subidas', { html: html(BASE), categoria: 'G-12' })).json()).nombre
  const a = await subir(), b = await subir()
  const fila = async (n) => (await pool.query('SELECT subida_por, subida_nombre, reemplazada_nombre, reemplazada_en FROM plantilla_subidas WHERE nombre = $1', [n])).rows[0]
  const antes = await fila(a)
  assert.equal(antes.subida_nombre, 'Edi'); assert.equal(antes.reemplazada_en, null)
  assert.equal((await admin('POST', '/plantillas/subidas/reemplazo-masivo', { archivos: [a, b].map((nombre) => ({ nombre, html: html(NUEVO) })) })).status, 200)
  assert.equal((await admin('PUT', '/plantillas/subidas/' + a, { html: html(NUEVO) })).status, 200)
  for (const n of [a, b]) {
    const f = await fila(n)
    assert.equal(f.subida_nombre, 'Edi'); assert.equal(f.reemplazada_nombre, 'Admin'); assert.ok(f.reemplazada_en)
  }
  assert.equal((await fila(a)).subida_por, antes.subida_por)
  // sigue siendo suya: puede editarla
  assert.equal((await edi('PUT', '/plantillas/subidas/' + a, { html: html(NUEVO) })).status, 200)
})
