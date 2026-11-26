// Avisos temporales de las plantillas HTML y respuesta del Editor HTML: cuando el diseñador aprueba, rechaza o pide cambios, a quien subió la plantilla le llega un aviso
// (que no se guarda en ningún lado); cuando quien subió la corrige y notifica el cambio —también si le rechazaron la plantilla—, el aviso le llega al diseñador.
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
const PUERTO_PG = 54348
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-avi-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'

let servidor, base, pool, dueno, avisos
before(async () => {
  await servidorPg.initialise(); await servidorPg.start(); await servidorPg.createDatabase('ova')
  dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  avisos = await import('../src/avisos.js')
  pool = db.pool
  for (const [nombre, correo, rol] of [['Dani', 'dani@u.co', 'disenador'], ['Edu', 'edu@u.co', 'editor_html'], ['Eva', 'eva@u.co', 'editor_html'], ['Admin', 'admin@u.co', 'admin'], ['Ana', 'ana@u.co', 'docente']]) {
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
  return (m, ruta, cuerpo) => fetch(base + '/api' + ruta, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
}
const html = (campos) => '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{{TITULO}}</title></head><body><script type="application/json" id="contenido">/*CONTENIDO*/' + JSON.stringify(campos) + '/*FIN-CONTENIDO*/</script></body></html>'
const enviar = (u, plantilla, estado, observacion = '', extra = {}) => u('POST', '/plantillas/revisiones', { plantilla, estado, observacion, ...extra })
const recoger = async (u) => (await (await u('GET', '/plantillas/avisos')).json()).avisos
const subirComo = async (u, categoria) => { const r = await u('POST', '/plantillas/subidas', { html: html({ titulo: 't' }), categoria }); assert.equal(r.status, 201); return (await r.json()).nombre }

test('a quien subió la plantilla le llega un aviso cuando el diseñador la aprueba; se recoge una sola vez y el diseñador no recibe el suyo', async () => {
  const dani = await entrar('dani@u.co'); const edu = await entrar('edu@u.co')
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'G-71', nombre: 'Prueba de avisos' })).status, 201)
  const nombre = await subirComo(edu, 'G-71')
  assert.equal(nombre, 'g-71-v01')
  assert.equal((await enviar(dani, 'pub-' + nombre, 'aprobada', 'Está bien')).status, 201)
  const a = await recoger(edu)
  assert.equal(a.length, 1)
  assert.equal(a[0].tipo, 'aprobada'); assert.equal(a[0].quien, 'Dani'); assert.equal(a[0].nombre, nombre); assert.equal(a[0].plantilla, 'pub-' + nombre)
  assert.ok(a[0].id && a[0].creado)
  assert.deepEqual(await recoger(edu), []) // ya se recogió: no se guarda en ningún lado
  assert.deepEqual(await recoger(dani), []) // nadie recibe aviso de lo que hizo él mismo
})

test('si le piden cambios, quien subió la plantilla los notifica al corregirla y el aviso le llega al diseñador; otro editor no puede', async () => {
  const dani = await entrar('dani@u.co'); const edu = await entrar('edu@u.co'); const eva = await entrar('eva@u.co')
  const nombre = await subirComo(edu, 'G-71') // g-71-v02
  assert.equal((await enviar(dani, 'pub-' + nombre, 'revision', 'Cambia el color del título')).status, 201)
  const a = await recoger(edu)
  assert.equal(a.length, 1); assert.equal(a[0].tipo, 'revision')
  // otro Editor HTML no puede notificar el cambio de una plantilla que no subió; tampoco un diseñador
  assert.equal((await enviar(eva, 'pub-' + nombre, 'corregida', 'ya')).status, 403)
  assert.equal((await enviar(dani, 'pub-' + nombre, 'corregida', 'ya')).status, 403)
  assert.deepEqual(await recoger(dani), []) // lo rechazado no genera aviso
  // quien la subió responde: queda «corregida» y el diseñador que pidió los cambios recibe el aviso
  const r = await enviar(edu, 'pub-' + nombre, 'corregida', 'Cambié el color del título')
  assert.equal(r.status, 201)
  const fila = await r.json()
  assert.equal(fila.estado, 'corregida'); assert.equal(fila.usuario, 'Edu')
  const b = await recoger(dani)
  assert.equal(b.length, 1); assert.equal(b[0].tipo, 'corregida'); assert.equal(b[0].quien, 'Edu'); assert.equal(b[0].plantilla, 'pub-' + nombre)
  assert.deepEqual(await recoger(edu), [])
  // ya está corregida: no hay nada más a lo que responder
  assert.equal((await enviar(edu, 'pub-' + nombre, 'corregida', 'otra vez')).status, 409)
  // quien notificó puede editar su nota mientras sea lo último; otro editor no
  const ultimo = (await (await dani('GET', '/plantillas/revisiones')).json()).find((x) => x.plantilla === 'pub-' + nombre)
  assert.equal((await edu('PATCH', '/plantillas/revisiones/' + ultimo.id, { observacion: 'Cambié el color y el tamaño del título' })).status, 200)
  assert.equal((await eva('PATCH', '/plantillas/revisiones/' + ultimo.id, { observacion: 'intruso' })).status, 403)
})

test('también se responde a un rechazo: hay que contar qué cambió, y el diseñador recibe el aviso', async () => {
  const dani = await entrar('dani@u.co'); const edu = await entrar('edu@u.co')
  const nombre = await subirComo(edu, 'G-71') // g-71-v03
  assert.equal((await enviar(dani, 'pub-' + nombre, 'rechazada', 'Se sale de la paleta')).status, 201)
  assert.equal((await recoger(edu))[0].tipo, 'rechazada')
  assert.equal((await enviar(edu, 'pub-' + nombre, 'corregida', '')).status, 400) // sin contar qué cambió
  const r = await enviar(edu, 'pub-' + nombre, 'corregida', 'Ajusté los colores a la paleta')
  assert.equal(r.status, 201)
  const rechazo = (await (await dani('GET', '/plantillas/revisiones')).json()).find((x) => x.plantilla === 'pub-' + nombre && x.estado === 'rechazada')
  assert.equal((await r.json()).referencia, rechazo.id) // la respuesta apunta al rechazo
  const b = await recoger(dani)
  assert.equal(b.length, 1); assert.equal(b[0].tipo, 'corregida')
  // el diseñador la vuelve a revisar y aprueba: el aviso vuelve a quien la subió
  assert.equal((await enviar(dani, 'pub-' + nombre, 'aprobada', 'Ahora sí')).status, 201)
  assert.equal((await recoger(edu))[0].tipo, 'aprobada')
})

test('una plantilla que ya no tiene quién la subió, o que no es una subida, no genera avisos ni errores; el administrador corrige como antes', async () => {
  const dani = await entrar('dani@u.co'); const admin = await entrar('admin@u.co'); const edu = await entrar('edu@u.co')
  assert.equal((await enviar(dani, 'plantilla-del-sistema', 'revision', 'Revisar')).status, 201)
  assert.equal((await enviar(admin, 'plantilla-del-sistema', 'corregida', 'Hecho')).status, 201) // el permiso de corregir sigue siendo del administrador
  assert.equal((await recoger(dani)).length, 1) // la corrección sí le avisa al diseñador que la pidió
  assert.equal((await enviar(edu, 'plantilla-del-sistema', 'revision', 'x')).status, 403) // el editor no decide sobre las plantillas
  assert.equal((await enviar(edu, 'plantilla-del-sistema', 'corregida', 'x')).status, 403) // y de una que no subió, tampoco responde
})

test('los avisos se descartan a los 3 minutos y solo los ve quien tiene permiso de ver las plantillas', async () => {
  const dani = await entrar('dani@u.co'); const ana = await entrar('ana@u.co')
  const antes = Date.now
  try {
    Date.now = () => antes() - 4 * 60 * 1000
    const viejo = avisos.publicarAviso('usuario-x', { tipo: 'aprobada', quien: 'Alguien', plantilla: 'pub-a', nombre: 'a' })
    assert.ok(viejo)
  } finally { Date.now = antes }
  assert.deepEqual(avisos.tomarAvisos('usuario-x'), []) // vencido
  assert.equal((await ana('GET', '/plantillas/avisos')).status, 403) // la docente no ve las plantillas
  assert.equal((await fetch(base + '/api/plantillas/avisos', { headers: { 'x-ova': '1' } })).status, 401)
  assert.equal((await dani('GET', '/plantillas/avisos')).status, 200)
})
