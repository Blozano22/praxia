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
let dueno, servidor, base, pool, Q, trabajosEnCurso, textoTrabajos
const ids = {}

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const duenio = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await duenio.connect()
  await duenio.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const m of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '010_pipeline_aprobacion.sql', '027_cola_regenerar.sql']) await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', m), 'utf8'))
  dueno = duenio
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
  dueno && (await dueno.end())
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
  assert.equal(r.avisos.length + r.colgados.length, 0)
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

test('bloquean: unidades, bibliografía y preparación; avisan: corridas, matrices, recursos y cola; colgados aparte', async () => {
  const u = ids['ana@u.co']
  const q = (t, v) => dueno.query(t, v)
  await q("INSERT INTO proyectos (propietario_id, id, programa, curso, datos) VALUES ($1, 'c1', 'p', 'c', '{}'::jsonb) ON CONFLICT DO NOTHING", [u])
  await q("DELETE FROM guiones_trabajos")
  // Bloquean (recientes)
  await q("INSERT INTO unidades_trabajos (propietario_id, syllabus_doc, syllabus_url, carpeta_url, proyecto_id, estado) VALUES ($1,'d1','u','c','c1','en_curso')", [u])
  await q("INSERT INTO bib_trabajos (propietario_id, proyecto_id, estado, total) VALUES ($1,'c1','procesando',3)", [u])
  await q("INSERT INTO pipeline_origen (trabajo_id, propietario_id, proyecto_id, carpeta_raiz, etapa) VALUES (gen_random_uuid(), $1,'c1','x','preparacion')", [u])
  // Preparación vieja: ya no cuenta
  await q("INSERT INTO pipeline_origen (trabajo_id, propietario_id, proyecto_id, carpeta_raiz, etapa, creado) VALUES (gen_random_uuid(), $1,'c1','x','preparacion', now() - interval '3 hours')", [u])
  // Bibliografía y unidades colgadas
  await q("INSERT INTO bib_trabajos (propietario_id, proyecto_id, estado, total, creado, actualizado) VALUES ($1,'c1','pendiente',1, now() - interval '5 hours', now() - interval '5 hours')", [u])
  await q("INSERT INTO unidades_trabajos (propietario_id, syllabus_doc, syllabus_url, carpeta_url, proyecto_id, estado, creado) VALUES ($1,'d2','u','c','c1','en_curso', now() - interval '5 hours')", [u])
  // Avisan
  await q("INSERT INTO pipeline_ejecuciones (propietario_id, proyecto_id, etapa, ejecucion_id, estado, ultimo_evento_en) VALUES ($1,'c1','h5p','e1','en_curso', now())", [u])
  await q("INSERT INTO pipeline_ejecuciones (propietario_id, proyecto_id, etapa, ejecucion_id, estado, ultimo_evento_en) VALUES ($1,'c1','matrices','e2','en_curso', now() - interval '2 days')", [u])
  await q("INSERT INTO pipeline_matrices (propietario_id, proyecto_id, unidad, estado, actualizado_en) VALUES ($1,'c1',2,'generando', now())", [u])
  await q("INSERT INTO pipeline_recursos (propietario_id, proyecto_id, id, unidad, estado, actualizado_en) VALUES ($1,'c1','r1',2,'EN_PROCESO', now())", [u])
  await q("INSERT INTO regenerar_cola (propietario_id, proyecto_id, codigo) VALUES ($1,'c1','U2-A')", [u])
  const r = await trabajosEnCurso((t, v) => dueno.query(t, v))
  const tipos = (l) => l.map((x) => x.tipo).sort()
  assert.deepEqual(tipos(r.trabajos), ['bibliografia', 'preparacion', 'unidades'])
  assert.equal(r.total, 3)
  assert.deepEqual(tipos(r.avisos), ['cola', 'corridas', 'matrices', 'recursos'])
  assert.deepEqual(tipos(r.colgados), ['bibliografia', 'corridas', 'unidades'])
  const t = textoTrabajos(r)
  assert.match(t, /NO reinicie todavía/); assert.match(t, /Atención: 4 trabajo/); assert.match(t, /se pueden perder avisos/); assert.match(t, /Colgados/)
  assert.equal((await (await api('adm@u.co', '/admin/trabajos-en-curso')).json()).total, 3)
})

test('solo avisos o solo colgados no bloquean', async () => {
  const q = (t, v) => dueno.query(t, v)
  await q("DELETE FROM unidades_trabajos WHERE estado='en_curso' AND creado > now() - interval '1 hour'")
  await q("DELETE FROM bib_trabajos WHERE actualizado > now() - interval '1 hour' OR creado > now() - interval '1 hour'")
  await q("DELETE FROM pipeline_origen WHERE etapa = 'preparacion'")
  const r = await trabajosEnCurso((t2, v) => dueno.query(t2, v))
  assert.equal(r.total, 0)
  assert.ok(r.avisos.length > 0 && r.colgados.length > 0)
  assert.match(textoTrabajos(r), /^Se puede reiniciar/)
})
