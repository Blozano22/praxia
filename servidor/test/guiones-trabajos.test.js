// La generación de guiones la hace el servidor: es un trabajo con identificador que sigue aunque se cierre la página,
// no se puede lanzar dos veces para la misma unidad y su resultado espera a la persona. Usa un n8n simulado.
// Además: la sesión se renueva sola al usarla y tiene un tope máximo.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import jwt from 'jsonwebtoken'
import pg from 'pg'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const PUERTO_PG = 54332
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-gt-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'

let servidor, base, pool, n8n, urlN8n, lanzarTrabajo, recuperarTrabajos, Q, secreto
const ids = {}
// n8n simulado: guarda lo recibido y responde cuando el test lo libera.
const recibidos = []
let respuestaN8n = null // { estado, cuerpo } o null = esperar
const esperando = [] // peticiones de n8n que aguardan a que el test las libere
const liberar = () => { while (esperando.length) esperando.shift()() }

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
  secreto = crypto.randomBytes(48).toString('hex')
  process.env.JWT_SECRET = secreto
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  ;({ Q } = await import('../src/consultas.js'))
  ;({ lanzarTrabajo, recuperarTrabajos } = await import('../src/guiones/rutas.js'))
  pool = db.pool
  for (const [nombre, correo, rol] of [['Ana', 'ana@u.co', 'docente'], ['Beto', 'beto@u.co', 'docente']]) {
    ids[correo] = (await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), [rol]])).rows[0].id
  }

  n8n = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', async () => {
      recibidos.push(JSON.parse(Buffer.concat(partes).toString('utf8')))
      if (!respuestaN8n) await new Promise((r) => esperando.push(r))
      const r = respuestaN8n || { estado: 200, cuerpo: { archivos: [{ nombre: 'Guion 1', tema: 1 }] } }
      res.writeHead(r.estado, { 'content-type': 'application/json' })
      res.end(JSON.stringify(r.cuerpo))
    })
  }).listen(0)
  urlN8n = 'http://127.0.0.1:' + n8n.address().port + '/webhook/guiones'

  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})

after(async () => {
  liberar()
  servidor && servidor.close()
  n8n && n8n.close()
  pool && (await pool.end())
  await servidorPg.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  const api = (metodo, ruta, cuerpo) => fetch(base + '/api' + ruta, {
    method: metodo,
    headers: { cookie, 'x-ova': '1', ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
  })
  return { estado: r.status, api, cookie }
}
const esperar = async (fn, ms = 5000) => {
  const fin = Date.now() + ms
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > fin) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 40)) }
}
const lista = async (c) => (await (await c.api('GET', '/guiones/trabajos')).json())
const lanzar = (correo, proyecto, unidad, url = urlN8n) => lanzarTrabajo({ usuarioId: ids[correo], proyecto, unidad, url, cuerpo: { unidad_url: 'https://docs.google.com/document/d/abc', unidad, bibliografia: { fuentes: [] } } })

test('un trabajo tiene identificador, no se duplica y termina con su respuesta aunque nadie esté mirando', async () => {
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  respuestaN8n = null // n8n tarda
  const t = await lanzar('ana@u.co', 'p1', 1)
  assert.ok(t.id && !t.ya)
  assert.equal((await lanzar('ana@u.co', 'p1', 1)).ya, true) // el mismo syllabus y unidad: no se lanza otra vez
  assert.equal((await lanzar('ana@u.co', 'p1', 1)).id, t.id)
  const otra = await lanzar('ana@u.co', 'p1', 2) // otra unidad sí
  assert.ok(otra.id && otra.id !== t.id)
  await esperar(() => recibidos.length >= 2)
  assert.equal(recibidos[0].trabajo_id, t.id) // el identificador viaja a n8n
  const enCurso = (await lista(ana)).find((x) => x.id === t.id)
  assert.equal(enCurso.estado, 'en_curso'); assert.equal(enCurso.proyecto, 'p1'); assert.equal(enCurso.unidad, 1)
  assert.deepEqual(await lista(beto), []) // nadie ve los trabajos de otra persona
  assert.equal((await ana.api('GET', '/guiones/trabajos/' + t.id + '/respuesta')).status, 404) // aún no terminó
  assert.equal((await ana.api('DELETE', '/guiones/trabajos/' + t.id)).status, 404) // y uno en curso no se borra

  // n8n responde: el trabajo queda listo sin que nadie lo esté esperando (como si se hubiera cerrado la página)
  respuestaN8n = { estado: 200, cuerpo: { archivos: [{ nombre: 'Guion 1', tema: 1 }] } }
  liberar()
  await esperar(async () => (await lista(ana)).find((x) => x.id === t.id).estado === 'listo')
  await esperar(async () => (await lista(ana)).find((x) => x.id === otra.id).estado === 'listo')
  const r = await (await ana.api('GET', '/guiones/trabajos/' + t.id + '/respuesta')).json()
  assert.deepEqual(JSON.parse(r.respuesta), { archivos: [{ nombre: 'Guion 1', tema: 1 }] })
  assert.equal((await beto.api('GET', '/guiones/trabajos/' + t.id + '/respuesta')).status, 404) // ajeno
  assert.equal((await beto.api('DELETE', '/guiones/trabajos/' + t.id)).status, 404)
  assert.equal((await ana.api('DELETE', '/guiones/trabajos/' + t.id)).status, 200)
  assert.equal((await lista(ana)).some((x) => x.id === t.id), false)
  assert.equal((await lanzar('ana@u.co', 'p1', 1)).ya, undefined) // terminado y recogido: se puede volver a generar
  await esperar(async () => (await lista(ana)).filter((x) => x.estado === 'en_curso').length === 0)
})

test('si n8n falla o no responde, el trabajo queda con error y se puede reintentar', async () => {
  const ana = await entrar('ana@u.co')
  respuestaN8n = { estado: 500, cuerpo: { message: 'se rompió el flujo' } }
  const t = await lanzar('ana@u.co', 'p9', 1)
  await esperar(async () => (await lista(ana)).find((x) => x.id === t.id).estado === 'error')
  assert.match((await lista(ana)).find((x) => x.id === t.id).error, /HTTP 500.*se rompió el flujo/)
  const sinN8n = await lanzar('ana@u.co', 'p9', 2, 'http://127.0.0.1:1/nada')
  await esperar(async () => (await lista(ana)).find((x) => x.id === sinN8n.id).estado === 'error')
  assert.match((await lista(ana)).find((x) => x.id === sinN8n.id).error, /No se pudo completar con n8n/)
  assert.equal((await ana.api('DELETE', '/guiones/trabajos/' + t.id)).status, 200)
  assert.ok(!(await lanzar('ana@u.co', 'p9', 1)).ya) // tras un error se puede reintentar
})

test('al reiniciar el servidor lo que seguía en curso se marca como fallido y la respuesta tardía no lo pisa', async () => {
  const ana = await entrar('ana@u.co')
  respuestaN8n = null
  const antes = recibidos.length
  const t = await lanzar('ana@u.co', 'p7', 1)
  await esperar(() => recibidos.length > antes)
  await recuperarTrabajos()
  const f = (await lista(ana)).find((x) => x.id === t.id)
  assert.equal(f.estado, 'error'); assert.match(f.error, /reinici/)
  respuestaN8n = { estado: 200, cuerpo: { archivos: [] } }
  liberar()
  await new Promise((r) => setTimeout(r, 300))
  assert.equal((await lista(ana)).find((x) => x.id === t.id).estado, 'error')
})

test('la ruta valida los datos, exige sesión y no inventa bibliografías', async () => {
  const ana = await entrar('ana@u.co')
  const bueno = { proyecto: 'p1', unidad: 1, unidadUrl: 'https://docs.google.com/document/d/abc', bibliografiaId: crypto.randomUUID() }
  assert.equal((await fetch(base + '/api/guiones/trabajos', { headers: { 'x-ova': '1' } })).status, 401)
  assert.equal((await ana.api('POST', '/guiones/trabajos', { ...bueno, unidadUrl: 'https://ejemplo.com/x' })).status, 400)
  assert.equal((await ana.api('POST', '/guiones/trabajos', { ...bueno, bibliografiaId: 'no-es-uuid' })).status, 400)
  assert.equal((await ana.api('POST', '/guiones/trabajos', { ...bueno, extra: 1 })).status, 400)
  assert.equal((await ana.api('POST', '/guiones/trabajos', bueno)).status, 404) // esa bibliografía no existe
})

test('por la ruta real: arma el paquete de bibliografía, lo envía a n8n con el id y rechaza el doble envío', async () => {
  const ana = await entrar('ana@u.co')
  // Una lectura de bibliografía completa de Ana (se crea como dueño de la base: la API la crea leyendo Google Docs).
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  const bib = crypto.randomUUID()
  await dueno.query("INSERT INTO bib_trabajos (id, propietario_id, proyecto_id, estado, total, resueltas) VALUES ($1, $2, 'pr', 'listo', 1, 1)", [bib, ids['ana@u.co']])
  await dueno.query("INSERT INTO bib_fuentes (trabajo_id, propietario_id, orden, entrada_cruda, unidad, categoria, estado, titulo, referencia_apa, cita_apa) VALUES ($1, $2, 1, 'Autor (2020). Libro.', 1, 'basica', 'resuelta', 'Libro', 'Autor (2020). Libro.', '(Autor, 2020)')", [bib, ids['ana@u.co']])
  await dueno.query("INSERT INTO configuracion (clave, valor) VALUES ('n8n.guiones', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", [urlN8n])
  await dueno.end()
  respuestaN8n = null
  const antes = recibidos.length
  const cuerpo = { proyecto: 'pr', unidad: 1, unidadUrl: 'https://docs.google.com/document/d/unidad1', syllabusUrl: 'https://docs.google.com/document/d/syl', bibliografiaId: bib }
  const r = await ana.api('POST', '/guiones/trabajos', cuerpo)
  assert.equal(r.status, 202)
  const t = await r.json()
  assert.ok(t.id && t.estado === 'en_curso')
  const doble = await ana.api('POST', '/guiones/trabajos', cuerpo)
  assert.equal(doble.status, 409)
  const d = await doble.json()
  assert.equal(d.ya, true); assert.equal(d.id, t.id)
  await esperar(() => recibidos.length > antes)
  const enviado = recibidos[antes]
  assert.equal(enviado.trabajo_id, t.id)
  assert.equal(enviado.proyecto_id, 'pr') // 7.1(a): el curso viaja a n8n (y carpeta_raiz cuando el curso tiene carpeta; aquí no hay curso guardado)
  assert.equal('carpeta_raiz' in enviado, false)
  // se anotó a qué persona y curso pertenece el trabajo, para atribuir los avisos que n8n mande después
  const origen = (await pool.query('SELECT proyecto_id, etapa, unidad FROM pipeline_origen WHERE trabajo_id = $1', [t.id])).rows[0]
  assert.deepEqual(origen, { proyecto_id: 'pr', etapa: 'guiones', unidad: 1 })
  assert.equal(enviado.unidad_url, cuerpo.unidadUrl); assert.equal(enviado.syllabus_url, cuerpo.syllabusUrl); assert.equal(enviado.unidad, 1)
  assert.equal(enviado.bibliografia.fuentes.length, 1); assert.equal(enviado.bibliografia.fuentes[0].id, 'U1-B1')
  respuestaN8n = { estado: 200, cuerpo: { archivos: [{ nombre: 'Guion 1', tema: 1 }] } }
  liberar()
  await esperar(async () => (await lista(ana)).find((x) => x.id === t.id).estado === 'listo')
  // la bibliografía de otra persona no sirve
  const beto = await entrar('beto@u.co')
  assert.equal((await beto.api('POST', '/guiones/trabajos', cuerpo)).status, 404)
})

test('la sesión se renueva sola al usarla y tiene un tope máximo desde que se inició', async () => {
  const ahora = Math.floor(Date.now() / 1000)
  const v = (await pool.query(Q.usuarioParaSesion, [ids['ana@u.co']])).rows[0].version_token
  const llamar = (token) => fetch(base + '/api/auth/yo', { headers: { cookie: 'ova_sesion=' + token } })
  const firmar = (ini, exp) => jwt.sign({ sub: ids['ana@u.co'], v, ini, exp }, secreto, { algorithm: 'HS256' })
  // quedan 2 días de vigencia (menos de la mitad de 7): al usarla se renueva
  const r1 = await llamar(firmar(ahora - 5 * 86400, ahora + 2 * 86400))
  assert.equal(r1.status, 200)
  assert.match(r1.headers.get('set-cookie') || '', /ova_sesion=/)
  // vigencia recién renovada: no se vuelve a emitir en cada petición
  const r2 = await llamar(firmar(ahora - 60, ahora + 7 * 86400))
  assert.equal(r2.status, 200)
  assert.equal(r2.headers.get('set-cookie'), null)
  // pasaron más de 30 días desde el inicio de sesión: vence aunque se haya usado
  assert.equal((await llamar(firmar(ahora - 31 * 86400, ahora + 3 * 86400))).status, 401)
  // el inicio de sesión normal da una sesión larga (7 días sin actividad)
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo: 'ana@u.co', clave: CLAVE }) })
  const vida = Number(/Max-Age=(\d+)/i.exec(login.headers.get('set-cookie'))[1])
  assert.ok(vida >= 6 * 86400 && vida <= 7 * 86400, 'vida de la cookie: ' + vida)
})
