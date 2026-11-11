// La creación de las unidades la hace el servidor como un trabajo con identificador (igual que los guiones), y la lectura de
// bibliografía de un syllabus se retoma por su enlace desde cualquier pestaña o equipo. Usa un n8n simulado.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const PUERTO_PG = 54335
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-un-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const DOC = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit'
const CARPETA = 'https://drive.google.com/drive/folders/1CarpetaDestino'

let servidor, base, pool, n8n, urlN8n, recuperarUnidades, dueno
const ids = {}
const recibidos = []
let respuestaN8n = null // { estado, cuerpo } o null = esperar
const esperando = []
const liberar = () => { while (esperando.length) esperando.shift()() }

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))

  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  ;({ recuperarUnidades } = await import('../src/unidades/rutas.js'))
  pool = db.pool
  for (const [nombre, correo] of [['Ana', 'ana@u.co'], ['Beto', 'beto@u.co']]) ids[correo] = (await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), ['docente']])).rows[0].id

  n8n = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', async () => {
      recibidos.push(JSON.parse(Buffer.concat(partes).toString('utf8')))
      if (!respuestaN8n) await new Promise((r) => esperando.push(r))
      const r = respuestaN8n || { estado: 200, cuerpo: { documentos: [{ unidad: 1, nombre: 'Unidad 1', url: 'https://docs.google.com/document/d/u1' }] } }
      res.writeHead(r.estado, { 'content-type': 'application/json' })
      res.end(JSON.stringify(r.cuerpo))
    })
  }).listen(0)
  urlN8n = 'http://127.0.0.1:' + n8n.address().port + '/webhook/unidades'
  await dueno.query("INSERT INTO configuracion (clave, valor) VALUES ('n8n.syllabus', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", [urlN8n])

  // Una lectura de bibliografía completa de Ana, del documento DOC
  ids.bib = crypto.randomUUID()
  await dueno.query("INSERT INTO bib_trabajos (id, propietario_id, estado, total, resueltas, syllabus_doc) VALUES ($1, $2, 'listo', 1, 1, '1AbCdEfGhIjKlMnOp')", [ids.bib, ids['ana@u.co']])
  await dueno.query("INSERT INTO bib_fuentes (trabajo_id, propietario_id, orden, entrada_cruda, unidad, categoria, estado, titulo, referencia_apa, cita_apa) VALUES ($1, $2, 1, 'Autor (2020). Libro.', 1, 'basica', 'resuelta', 'Libro', 'Autor (2020). Libro.', '(Autor, 2020)')", [ids.bib, ids['ana@u.co']])

  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})

after(async () => {
  liberar()
  servidor && servidor.close()
  n8n && n8n.close()
  dueno && (await dueno.end())
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
const esperar = async (fn, ms = 6000) => {
  const fin = Date.now() + ms
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > fin) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 40)) }
}
const lista = async (c) => (await c('GET', '/unidades/trabajos')).json()
const cuerpo = (extra = {}) => ({ syllabusUrl: DOC, carpetaUrl: CARPETA, bibliografiaId: ids.bib, curso: 'Didáctica', ...extra })

test('crear las unidades: trabajo con identificador, sin doble envío, y su resultado espera a la persona', async () => {
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  respuestaN8n = null // n8n tarda
  const r = await ana('POST', '/unidades/trabajos', cuerpo())
  assert.equal(r.status, 202)
  const t = await r.json()
  assert.ok(t.id && t.estado === 'en_curso')
  const doble = await ana('POST', '/unidades/trabajos', cuerpo({ syllabusUrl: DOC + '?usp=sharing' })) // mismo documento, otro formato de enlace
  assert.equal(doble.status, 409)
  const d = await doble.json()
  assert.equal(d.ya, true); assert.equal(d.id, t.id)
  await esperar(() => recibidos.length >= 1)
  const enviado = recibidos[0]
  assert.equal(enviado.trabajo_id, t.id) // el identificador viaja a n8n
  assert.equal(enviado.syllabus_url, DOC); assert.equal(enviado.carpeta_destino_url, CARPETA)
  assert.equal(enviado.bibliografia.fuentes.length, 1); assert.equal(enviado.bibliografia.fuentes[0].id, 'U1-B1')
  const enCurso = (await lista(ana)).find((x) => x.id === t.id)
  assert.equal(enCurso.estado, 'en_curso'); assert.equal(enCurso.curso, 'Didáctica'); assert.equal(enCurso.carpetaUrl, CARPETA)
  assert.deepEqual(await lista(beto), []) // nadie ve los trabajos de otra persona
  assert.equal((await ana('GET', '/unidades/trabajos/' + t.id + '/respuesta')).status, 404) // aún no terminó
  assert.equal((await ana('DELETE', '/unidades/trabajos/' + t.id)).status, 404) // y uno en curso no se borra

  respuestaN8n = { estado: 200, cuerpo: { documentos: [{ unidad: 1, nombre: 'Unidad 1', url: 'https://docs.google.com/document/d/u1' }] } }
  liberar()
  await esperar(async () => (await lista(ana)).find((x) => x.id === t.id).estado === 'listo')
  const resp = await (await ana('GET', '/unidades/trabajos/' + t.id + '/respuesta')).json()
  assert.equal(JSON.parse(resp.respuesta).documentos[0].nombre, 'Unidad 1')
  assert.equal((await beto('GET', '/unidades/trabajos/' + t.id + '/respuesta')).status, 404) // ajeno
  assert.equal((await beto('DELETE', '/unidades/trabajos/' + t.id)).status, 404)
  assert.equal((await ana('DELETE', '/unidades/trabajos/' + t.id)).status, 200)
  const otra = await ana('POST', '/unidades/trabajos', cuerpo()) // ya recogido: se puede volver a crear
  assert.equal(otra.status, 202)
  await esperar(async () => (await lista(ana)).filter((x) => x.estado === 'en_curso').length === 0)
})

test('si n8n falla, el trabajo queda con error; al reiniciar el servidor lo que seguía en curso se marca como fallido', async () => {
  const ana = await entrar('ana@u.co')
  for (const x of await lista(ana)) await ana('DELETE', '/unidades/trabajos/' + x.id)
  respuestaN8n = { estado: 500, cuerpo: { message: 'se rompió el flujo' } }
  const t = await (await ana('POST', '/unidades/trabajos', cuerpo())).json()
  await esperar(async () => (await lista(ana)).find((x) => x.id === t.id).estado === 'error')
  assert.match((await lista(ana)).find((x) => x.id === t.id).error, /HTTP 500.*se rompió el flujo/)
  await ana('DELETE', '/unidades/trabajos/' + t.id)

  respuestaN8n = null
  const antes = recibidos.length
  const t2 = await (await ana('POST', '/unidades/trabajos', cuerpo())).json()
  await esperar(() => recibidos.length > antes)
  await recuperarUnidades()
  const f = (await lista(ana)).find((x) => x.id === t2.id)
  assert.equal(f.estado, 'error'); assert.match(f.error, /reinici/)
  respuestaN8n = { estado: 200, cuerpo: { documentos: [] } }
  liberar()
  await new Promise((r) => setTimeout(r, 300))
  assert.equal((await lista(ana)).find((x) => x.id === t2.id).estado, 'error') // la respuesta tardía no lo pisa
})

test('la ruta valida los datos, exige sesión y no usa la bibliografía de otra persona', async () => {
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  assert.equal((await fetch(base + '/api/unidades/trabajos', { headers: { 'x-ova': '1' } })).status, 401)
  assert.equal((await ana('POST', '/unidades/trabajos', cuerpo({ syllabusUrl: 'https://ejemplo.com/x' }))).status, 400)
  assert.equal((await ana('POST', '/unidades/trabajos', cuerpo({ carpetaUrl: 'https://ejemplo.com/carpeta' }))).status, 400)
  assert.equal((await ana('POST', '/unidades/trabajos', cuerpo({ bibliografiaId: 'no-es-uuid' }))).status, 400)
  assert.equal((await ana('POST', '/unidades/trabajos', cuerpo({ extra: 1 }))).status, 400)
  assert.equal((await ana('POST', '/unidades/trabajos', cuerpo({ bibliografiaId: crypto.randomUUID() }))).status, 404) // no existe
  assert.equal((await beto('POST', '/unidades/trabajos', cuerpo())).status, 404) // existe, pero es de Ana
})

test('la lectura de bibliografía se retoma por el enlace del syllabus, desde cualquier pestaña, y solo la propia y reciente', async () => {
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  const por = (c, url) => c('GET', '/bibliografia/trabajos/por-syllabus?url=' + encodeURIComponent(url))
  const r = await por(ana, DOC + '?usp=sharing') // otro formato del mismo enlace
  assert.equal(r.status, 200)
  const f = await r.json()
  assert.equal(f.id, ids.bib); assert.equal(f.estado, 'listo')
  assert.equal((await por(beto, DOC)).status, 404) // la lectura es de Ana
  assert.equal((await por(ana, 'https://docs.google.com/document/d/OtroDocumentoDistinto123')).status, 404)
  assert.equal((await por(ana, 'https://ejemplo.com/x')).status, 400)
  await dueno.query("UPDATE bib_trabajos SET creado = now() - interval '15 days' WHERE id = $1", [ids.bib])
  assert.equal((await por(ana, DOC)).status, 404) // una lectura de hace más de 14 días ya no se retoma sola
})
