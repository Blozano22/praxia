// Control de versiones del syllabus: si alguien guarda a partir de una versión vieja (otra pestaña u otro equipo ya lo cambió),
// el servidor lo rechaza con 409 y la versión vigente, en vez de pisar lo guardado.
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
const PUERTO_PG = 54334
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-ver-'))
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
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  await pool.query(Q.usuarioCrear, ['Ana', 'ana@u.co', await hashClave(CLAVE), ['docente']])
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
const proyecto = (extra = {}) => ({ id: 'curso-1', programa: 'Licenciatura', curso: 'Didáctica', creado: 1, syllabus: { estado: 'listo', documentos: [] }, ...extra })

test('cada guardado sube la versión; guardar con una versión vieja se rechaza con 409 y la vigente', async () => {
  const ana = await entrar('ana@u.co')
  const crear = await ana('PUT', '/proyectos/curso-1', proyecto())
  assert.equal(crear.status, 200)
  assert.equal((await crear.json()).version, 1)
  const lista = await (await ana('GET', '/proyectos')).json()
  assert.equal(lista[0]._v, 1)

  const ok = await ana('PUT', '/proyectos/curso-1', proyecto({ _v: 1, curso: 'Didáctica II' }))
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).version, 2)

  // otra pestaña que sigue en la versión 1 intenta guardar: no pisa lo de la versión 2
  const viejo = await ana('PUT', '/proyectos/curso-1', proyecto({ _v: 1, curso: 'Cambio desde la pestaña vieja' }))
  assert.equal(viejo.status, 409)
  const c = await viejo.json()
  assert.equal(c.conflicto, true); assert.equal(c.version, 2)
  assert.equal(c.actual.curso, 'Didáctica II'); assert.equal(c.actual._v, 2)
  assert.equal((await (await ana('GET', '/proyectos')).json())[0].curso, 'Didáctica II') // lo guardado sigue intacto

  // con la versión vigente sí guarda
  assert.equal((await ana('PUT', '/proyectos/curso-1', proyecto({ _v: 2, curso: 'Didáctica III' }))).status, 200)
})

test('una página antigua que no envía versión sigue pudiendo guardar, y la versión nunca queda dentro del syllabus', async () => {
  const ana = await entrar('ana@u.co')
  const r = await ana('PUT', '/proyectos/curso-1', proyecto({ curso: 'Sin versión' }))
  assert.equal(r.status, 200)
  const v = (await r.json()).version
  assert.equal(v, 4)
  const p = (await (await ana('GET', '/proyectos')).json())[0]
  assert.equal(p._v, v)
})

test('dos guardados a la vez con la misma versión: uno gana y el otro recibe el conflicto', async () => {
  const ana = await entrar('ana@u.co')
  const actual = (await (await ana('GET', '/proyectos')).json())[0]._v
  const [a, b] = await Promise.all([
    ana('PUT', '/proyectos/curso-1', proyecto({ _v: actual, curso: 'A' })),
    ana('PUT', '/proyectos/curso-1', proyecto({ _v: actual, curso: 'B' }))
  ])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
})
