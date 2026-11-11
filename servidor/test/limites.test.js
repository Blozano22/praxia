// Límites de velocidad pensados para una institución: varias personas desde la misma red no se bloquean entre sí.
//  - Al iniciar sesión solo cuentan los intentos FALLIDOS (los correctos no gastan el cupo de la IP).
//  - Los demás límites (bibliografía, guiones…) son por persona, no por IP.
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
const PUERTO_PG = 54333
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-lim-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
let servidor, base, pool

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const duenio = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await duenio.connect()
  await duenio.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql']) await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await duenio.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '3' // 3 intentos fallidos por IP en la ventana
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [nombre, correo] of [['Ana', 'ana@u.co'], ['Beto', 'beto@u.co']]) await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), ['docente']])
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})

after(async () => {
  servidor && servidor.close()
  pool && (await pool.end())
  await servidorPg.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

const login = (correo, clave) => fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave }) })
async function entrar(correo) {
  const r = await login(correo, CLAVE)
  assert.equal(r.status, 200)
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  return (metodo, ruta, cuerpo) => fetch(base + '/api' + ruta, { method: metodo, headers: { cookie, 'x-ova': '1', 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
}

test('el cupo de generación es por persona: una no gasta el de otra aunque compartan la red', async () => {
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  const malo = { proyecto: '' } // datos inválidos: responde 400 pero cuenta para el límite (12 por minuto)
  for (let i = 0; i < 12; i++) assert.equal((await ana('POST', '/guiones/trabajos', malo)).status, 400, 'intento ' + (i + 1))
  assert.equal((await ana('POST', '/guiones/trabajos', malo)).status, 429) // Ana agotó el suyo
  assert.equal((await beto('POST', '/guiones/trabajos', malo)).status, 400) // Beto, desde la misma IP, sigue con el cupo completo
})

test('al iniciar sesión solo cuentan los intentos fallidos, no los correctos', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await login('ana@u.co', CLAVE)).status, 200, 'acceso correcto ' + (i + 1)) // más que el límite de 3
  for (let i = 0; i < 3; i++) assert.equal((await login('beto@u.co', 'ClaveIncorrecta1')).status, 401, 'fallo ' + (i + 1))
  assert.equal((await login('beto@u.co', 'ClaveIncorrecta1')).status, 429) // el cuarto fallo de la misma IP sí se frena
})
