// Ciclo de revisión de las plantillas HTML entre el diseñador y el administrador:
//   el diseñador pide cambios (revision) → el administrador los marca como corregidos (corregida) → el diseñador verifica y aprueba,
//   rechaza o vuelve a pedir cambios. Se puede editar lo que uno envió (queda marcado), el administrador que aprueba o rechaza debe
//   confirmar que es algo del diseñador (y queda registrado), y cambiar un estado ya aprobado o rechazado exige confirmarlo.
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
const PUERTO_PG = 54336
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-cic-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const DOC = 'https://docs.google.com/document/d/abc_123-XYZ/edit'
let servidor, base, pool

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  // Estado de un servidor que ya usaba la primera versión: tabla antigua con una decisión, creada antes de migrar.
  await dueno.query(`CREATE TABLE plantilla_revisiones (id bigserial PRIMARY KEY, plantilla text NOT NULL, estado text NOT NULL, observacion text NOT NULL DEFAULT '',
    doc_url text, usuario_id uuid, usuario_nombre text NOT NULL, creado timestamptz NOT NULL DEFAULT now())`)
  await dueno.query("INSERT INTO plantilla_revisiones (plantilla, estado, observacion, usuario_nombre) VALUES ('antigua', 'aprobada', 'de la primera versión', 'Persona Antigua')")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await dueno.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [nombre, correo, rol] of [['Dani', 'dani@u.co', 'disenador'], ['Dora', 'dora@u.co', 'disenador'], ['Admin', 'admin@u.co', 'admin'], ['Ana', 'ana@u.co', 'docente']]) {
    await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), [rol]])
  }
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})

after(async () => {
  servidor && servidor.close()
  pool && (await pool.end())
  await servidorPg.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  return (metodo, ruta, cuerpo) => fetch(base + '/api' + ruta, {
    method: metodo,
    headers: { cookie, 'x-ova': '1', ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
  })
}
const enviar = (c, plantilla, estado, observacion, extra = {}) => c('POST', '/plantillas/revisiones', { plantilla, estado, observacion, ...extra })
const historial = async (c, plantilla) => (await (await c('GET', '/plantillas/revisiones')).json()).filter((x) => x.plantilla === plantilla)

test('las decisiones de la primera versión se copian al historial nuevo al migrar', async () => {
  const ana = await entrar('ana@u.co')
  const h = await historial(ana, 'antigua')
  assert.equal(h.length, 1)
  assert.equal(h[0].estado, 'aprobada'); assert.equal(h[0].usuario, 'Persona Antigua'); assert.equal(h[0].rol, 'disenador'); assert.equal(h[0].editadoEn, null)
})

test('el diseñador pide cambios, la solicitud queda registrada y solo la ve (no la decide) quien no tiene permiso', async () => {
  const dani = await entrar('dani@u.co')
  const ana = await entrar('ana@u.co')
  assert.equal((await enviar(dani, 'lectura', 'revision', 'Cambiar colores')).status, 400) // falta el documento
  assert.equal((await enviar(dani, 'lectura', 'revision', 'Cambiar colores', { docUrl: 'https://ejemplo.com/x' })).status, 400) // no es de Google Docs
  assert.equal((await enviar(dani, 'lectura', 'revision', 'x', { docUrl: DOC })).status, 400) // observación muy corta
  assert.equal((await enviar(dani, 'lectura', 'rechazada', '')).status, 400)
  assert.equal((await enviar(dani, 'Mala Clave', 'aprobada', '')).status, 400)
  assert.equal((await enviar(dani, 'lectura', 'otra', 'x')).status, 400)
  const r = await enviar(dani, 'lectura', 'revision', 'Cambiar los colores del título', { docUrl: DOC })
  assert.equal(r.status, 201)
  const f = await r.json()
  assert.equal(f.estado, 'revision'); assert.equal(f.docUrl, DOC); assert.equal(f.usuario, 'Dani'); assert.equal(f.rol, 'disenador'); assert.equal(f.editadoEn, null)
  assert.equal((await enviar(ana, 'lectura', 'aprobada', '')).status, 403) // un docente no decide
  assert.equal((await ana('GET', '/plantillas/revisiones')).status, 200) // pero sí ve
})

test('quien envió la solicitud puede editarla (queda marcada con quién y cuándo); nadie más', async () => {
  const dani = await entrar('dani@u.co')
  const dora = await entrar('dora@u.co')
  const admin = await entrar('admin@u.co')
  const id = (await historial(dani, 'lectura'))[0].id
  assert.equal((await dani('PATCH', '/plantillas/revisiones/' + id, { observacion: 'Cambiar los colores del título', docUrl: DOC })).status, 400) // sin cambios
  assert.equal((await dani('PATCH', '/plantillas/revisiones/' + id, { observacion: 'Cambiar colores', docUrl: 'https://ejemplo.com/x' })).status, 400) // enlace inválido
  assert.equal((await dani('PATCH', '/plantillas/revisiones/' + id, { observacion: 'Cambiar colores' })).status, 400) // la solicitud necesita su documento
  const nuevoDoc = 'https://docs.google.com/document/d/otro_doc-999'
  const ok = await dani('PATCH', '/plantillas/revisiones/' + id, { observacion: 'Cambiar los colores y la letra del título', docUrl: nuevoDoc })
  assert.equal(ok.status, 200)
  const e = await ok.json()
  assert.equal(e.observacion, 'Cambiar los colores y la letra del título'); assert.equal(e.docUrl, nuevoDoc)
  assert.equal(e.editadoPor, 'Dani'); assert.ok(e.editadoEn); assert.equal(e.usuario, 'Dani') // «enviada por Dani» no cambia
  assert.equal((await dora('PATCH', '/plantillas/revisiones/' + id, { observacion: 'Pisando lo de Dani', docUrl: DOC })).status, 403) // otro diseñador
  assert.equal((await admin('PATCH', '/plantillas/revisiones/' + id, { observacion: 'Pisando lo de Dani', docUrl: DOC })).status, 403) // ni el administrador
  assert.equal((await dani('PATCH', '/plantillas/revisiones/999999', { observacion: 'no existe' })).status, 404)
})

test('el administrador marca como corregida; el diseñador no puede, y sin solicitud pendiente tampoco', async () => {
  const dani = await entrar('dani@u.co')
  const admin = await entrar('admin@u.co')
  assert.equal((await enviar(dani, 'lectura', 'corregida', 'ya está')).status, 403) // el diseñador no marca corregida
  assert.equal((await enviar(admin, 'infografia', 'corregida', 'ya está')).status, 409) // no hay solicitud pendiente en otra plantilla
  const pendiente = (await historial(dani, 'lectura'))[0]
  const r = await enviar(admin, 'lectura', 'corregida', 'Cambié los colores y la letra')
  assert.equal(r.status, 201)
  const f = await r.json()
  assert.equal(f.estado, 'corregida'); assert.equal(f.usuario, 'Admin'); assert.equal(f.rol, 'administrador'); assert.equal(f.referencia, pendiente.id)
  assert.equal((await enviar(admin, 'lectura', 'corregida', 'otra vez')).status, 409) // ya está corregida: no hay solicitud pendiente
  // la solicitud original ya no es lo último: su autor no la puede editar
  assert.equal((await dani('PATCH', '/plantillas/revisiones/' + pendiente.id, { observacion: 'Cambio tardío', docUrl: DOC })).status, 409)
  // el administrador puede editar su propia corrección mientras sea lo último
  const e = await admin('PATCH', '/plantillas/revisiones/' + f.id, { observacion: 'Cambié los colores, la letra y el espaciado' })
  assert.equal(e.status, 200)
  const ed = await e.json()
  assert.equal(ed.editadoPor, 'Admin'); assert.ok(ed.editadoEn); assert.equal(ed.docUrl, null)
})

test('el diseñador verifica lo corregido: vuelve a pedir cambios y, cuando está bien, aprueba (sin alertas intermedias)', async () => {
  const dani = await entrar('dani@u.co')
  const admin = await entrar('admin@u.co')
  const r1 = await enviar(dani, 'lectura', 'revision', 'Falta alinear el pie de página', { docUrl: DOC }) // tras «corregida» no pide confirmación
  assert.equal(r1.status, 201)
  assert.equal((await enviar(admin, 'lectura', 'corregida', 'Alineado')).status, 201)
  assert.equal((await enviar(dani, 'lectura', 'aprobada', 'Ahora sí')).status, 201)
  const h = await historial(dani, 'lectura')
  assert.deepEqual(h.map((x) => x.estado).reverse(), ['revision', 'corregida', 'revision', 'corregida', 'aprobada']) // el ciclo completo, en orden
})

test('cambiar un estado ya aprobado o rechazado exige confirmarlo', async () => {
  const dani = await entrar('dani@u.co')
  const r = await enviar(dani, 'lectura', 'revision', 'Ahora quiero otro ajuste', { docUrl: DOC }) // la última decisión es «aprobada»
  assert.equal(r.status, 409)
  const c = await r.json()
  assert.equal(c.requiereConfirmacion, 'cambio'); assert.match(c.error, /aprobada/)
  assert.equal((await enviar(dani, 'lectura', 'rechazada', 'Mejor la rechazo')).status, 409)
  assert.equal((await enviar(dani, 'lectura', 'revision', 'Ahora quiero otro ajuste', { docUrl: DOC, confirmadoCambio: true })).status, 201)
  // rechazada también se protege
  assert.equal((await enviar(dani, 'mapa', 'rechazada', 'No sirve')).status, 201) // primera decisión: sin alerta
  const otra = await enviar(dani, 'mapa', 'aprobada', 'Me arrepentí')
  assert.equal(otra.status, 409); assert.match((await otra.json()).error, /rechazada/)
  assert.equal((await enviar(dani, 'mapa', 'aprobada', 'Me arrepentí', { confirmadoCambio: true })).status, 201)
})

test('el administrador que aprueba o rechaza debe confirmar que es algo del diseñador, y queda registrado como administrador', async () => {
  const admin = await entrar('admin@u.co')
  const sin = await enviar(admin, 'flujo', 'aprobada', 'Aprobada por mí')
  assert.equal(sin.status, 409)
  const a = await sin.json()
  assert.equal(a.requiereConfirmacion, 'admin'); assert.match(a.error, /diseñador/)
  assert.equal((await enviar(admin, 'flujo', 'rechazada', 'La rechazo yo')).status, 409)
  assert.equal((await enviar(admin, 'flujo', 'revision', 'Pido cambios yo', { docUrl: DOC })).status, 409)
  const ok = await enviar(admin, 'flujo', 'aprobada', 'Aprobada por mí', { confirmadoAdmin: true })
  assert.equal(ok.status, 201)
  const f = await ok.json()
  assert.equal(f.usuario, 'Admin'); assert.equal(f.rol, 'administrador'); assert.equal(f.estado, 'aprobada')
  // sobre algo ya aprobado necesita las dos confirmaciones (primero la de administrador, luego la del cambio)
  const dos = await enviar(admin, 'flujo', 'rechazada', 'Ahora la rechazo', { confirmadoAdmin: true })
  assert.equal(dos.status, 409); assert.equal((await dos.json()).requiereConfirmacion, 'cambio')
  assert.equal((await enviar(admin, 'flujo', 'rechazada', 'Ahora la rechazo', { confirmadoAdmin: true, confirmadoCambio: true })).status, 201)
  // el diseñador, en cambio, no tiene la advertencia de administrador
  const dani = await entrar('dani@u.co')
  const d = await (await enviar(dani, 'crucigrama', 'aprobada', 'Aprobada')).json()
  assert.equal(d.rol, 'disenador')
})

test('dos personas decidiendo a la vez sobre lo mismo se atienden una tras otra', async () => {
  const admin = await entrar('admin@u.co')
  const dani = await entrar('dani@u.co')
  assert.equal((await enviar(dani, 'portada', 'revision', 'Ajustar portada', { docUrl: DOC })).status, 201)
  // dos intentos de marcar la misma solicitud como corregida: solo el primero prospera
  const [a, b] = await Promise.all([enviar(admin, 'portada', 'corregida', 'Uno'), enviar(admin, 'portada', 'corregida', 'Dos')])
  assert.deepEqual([a.status, b.status].sort(), [201, 409])
  assert.equal((await historial(dani, 'portada')).filter((x) => x.estado === 'corregida').length, 1)
})
