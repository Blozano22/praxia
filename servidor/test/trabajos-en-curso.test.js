// «¿Se puede reiniciar?»: lista las generaciones en curso (script y ruta usan el mismo código) y la ruta es solo para administración.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const PUERTO_PG = 54398
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-tec-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
let servidor, base, pool, Q, trabajosEnCurso, textoTrabajos
const ids = {}

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const duenio = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await duenio.connect()
  await duenio.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', '001_esquema.sql'), 'utf8'))
  await duenio.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = 'x'.repeat(96)
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  ;({ Q } = await import('../src/consultas.js'))
  ;({ trabajosEnCurso, textoTrabajos } = await import('../src/trabajos-en-curso.js'))
  pool = db.pool
  for (const [n, c, r] of [['Admin', 'adm@u.co', 'admin'], ['Ana', 'ana@u.co', 'docente']]) ids[c] = (await pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), [r]])).rows[0].id
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})
after(async () => {
  servidor && servidor.close()
  pool && (await pool.end())
  await servidorPg.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function api(correo, ruta) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  return fetch(base + '/api' + ruta, { headers: { cookie, 'x-ova': '1' } })
}

test('sin trabajos en curso se puede reiniciar', async () => {
  const r = await trabajosEnCurso((t, v) => pool.query(t, v))
  assert.equal(r.total, 0)
  assert.match(textoTrabajos(r), /^Se puede reiniciar/)
  const h = await api('adm@u.co', '/admin/trabajos-en-curso')
  assert.equal(h.status, 200)
  assert.equal((await h.json()).total, 0)
})

test('un trabajo en curso se lista; uno terminado no; la ruta es solo para administración', async () => {
  await pool.query(Q.guionTrabajoCrear, [ids['ana@u.co'], 'curso-7', 3])
  const hecho = (await pool.query(Q.guionTrabajoCrear, [ids['ana@u.co'], 'curso-8', 1])).rows[0]
  await pool.query(Q.guionTrabajoListo, [hecho.id, '{}'])
  const r = await trabajosEnCurso((t, v) => pool.query(t, v))
  assert.equal(r.total, 1)
  assert.equal(r.trabajos[0].proyecto, 'curso-7'); assert.equal(r.trabajos[0].unidad, 3)
  assert.match(textoTrabajos(r), /NO reinicie todavía/)
  const h = await (await api('adm@u.co', '/admin/trabajos-en-curso')).json()
  assert.equal(h.total, 1)
  assert.equal((await api('ana@u.co', '/admin/trabajos-en-curso')).status, 403)
})
