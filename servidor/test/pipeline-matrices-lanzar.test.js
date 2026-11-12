// Fase 2: lanzar la generación de matrices desde Praxia. n8n se simula con un servidor HTTP local que confirma (ack) la orden;
// el resultado llega después por avisos firmados, como en producción.
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
const PUERTO_PG = 54338
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-mat-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789'
const CARPETA = 'https://drive.google.com/drive/folders/carpetaMatrices1'

let servidor, base, pool, n8n, config
const recibidas = []
let respuestaN8n = { estado: 200, cuerpo: { ok: true } }
const ids = {}

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await dueno.end()
  n8n = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => {
      recibidas.push(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'))
      res.writeHead(respuestaN8n.estado, { 'content-type': 'application/json' })
      res.end(JSON.stringify(respuestaN8n.cuerpo))
    })
  }).listen(0)
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.N8N_EVENTOS_SECRETO = SECRETO
  process.env.LIMITE_LANZAR_PIPELINE = '500'
  process.env.N8N_MATRICES_URL = 'http://127.0.0.1:' + n8n.address().port + '/webhook/matrices'
  process.env.N8N_H5P_URL = 'http://127.0.0.1:' + n8n.address().port + '/webhook/h5p'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  config = (await import('../src/config.js')).config
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [nombre, correo] of [['Ana', 'ana@u.co'], ['Beto', 'beto@u.co']]) ids[nombre.toLowerCase()] = (await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), ['docente']])).rows[0].id
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})

after(async () => {
  servidor && servidor.close()
  n8n && n8n.close()
  pool && (await pool.end())
  await servidorPg.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  const h = { cookie, 'x-ova': '1', 'content-type': 'application/json' }
  return (metodo, ruta, cuerpo) => fetch(base + '/api' + ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
}
const curso = (id, aprobadas = [1, 2]) => ({
  id, programa: 'P', curso: 'Curso ' + id, creado: Date.now(), syllabusUrl: 'https://docs.google.com/document/d/syllabusX1234', carpetaUrl: CARPETA,
  syllabus: { estado: 'listo', mensaje: '', documentos: [1, 2, 3].map((u) => ({ unidad: u, nombre: 'U' + u, url: 'https://docs.google.com/document/d/g' + u + 'abcdefghij', aprobado: aprobadas.includes(u), visto: true, temas: [] })) },
  recursos: [], guiones: [], info: {}
})
const firmado = async (obj) => {
  const cuerpo = JSON.stringify(obj)
  const fecha = String(Math.floor(Date.now() / 1000))
  const firma = crypto.createHmac('sha256', SECRETO).update(fecha + '.' + cuerpo).digest('hex')
  return fetch(base + '/api/n8n/eventos', { method: 'POST', headers: { 'content-type': 'application/json', 'x-praxia-fecha': fecha, 'x-praxia-firma': firma }, body: cuerpo })
}
const origenes = (persona, proyecto) => pool.query("SELECT * FROM pipeline_origen WHERE propietario_id = $1 AND proyecto_id = $2 AND etapa = 'matrices'", [ids[persona], proyecto]).then((r) => r.rows)

test('lanzar: valida el curso y las unidades, entrega la orden a n8n con los identificadores y anota el origen', async () => {
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('PUT', '/proyectos/curso-m', curso('curso-m'))).status, 200)
  assert.equal((await fetch(base + '/api/proyectos/curso-m/pipeline/matrices', { method: 'POST', headers: { 'x-ova': '1', 'content-type': 'application/json' }, body: '{"unidades":[1]}' })).status, 401)
  assert.equal((await ana('POST', '/proyectos/curso-m/pipeline/matrices', { unidades: [] })).status, 400)
  assert.equal((await ana('POST', '/proyectos/curso-m/pipeline/matrices', { unidades: [1], extra: 1 })).status, 400)
  assert.equal((await ana('POST', '/proyectos/curso-m/pipeline/matrices', { unidades: [3] })).status, 400) // la 3 no está aprobada
  assert.equal((await ana('POST', '/proyectos/no-existe/pipeline/matrices', { unidades: [1] })).status, 404)
  assert.equal(recibidas.length, 0)
  const r = await ana('POST', '/proyectos/curso-m/pipeline/matrices', { unidades: [2, 1, 2] })
  assert.equal(r.status, 202)
  const j = await r.json()
  assert.deepEqual(j.unidades, [1, 2])
  assert.equal(recibidas.length, 1)
  assert.deepEqual(recibidas[0], { trabajo_id: j.trabajo_id, proyecto_id: 'curso-m', carpeta_raiz: CARPETA, unidades: [1, 2], forzar: false })
  const o = await origenes('ana', 'curso-m')
  assert.equal(o.length, 1); assert.equal(o[0].trabajo_id, j.trabajo_id); assert.equal(o[0].carpeta_raiz, CARPETA)
  const lectura = await (await ana('GET', '/proyectos/curso-m/pipeline')).json()
  assert.equal(lectura.puedeGenerarMatrices, true)
})

test('una sola generación a la vez por curso; al terminar (aviso firmado) se puede volver a lanzar, con forzar', async () => {
  const ana = await entrar('ana@u.co')
  const seg = await ana('POST', '/proyectos/curso-m/pipeline/matrices', { unidades: [1] })
  assert.equal(seg.status, 409); assert.equal((await seg.json()).ya, true)
  assert.equal(recibidas.length, 1) // no se molestó a n8n
  const trabajo = (await origenes('ana', 'curso-m'))[0].trabajo_id
  const fecha = (s) => new Date(Date.now() - 60 * 1000 + s * 1000).toISOString()
  const comunes = { etapa: 'matrices', origen_trabajo_id: trabajo, trabajo_id: trabajo, proyecto_id: 'curso-m', ejecucion_id: 'ej-m1' }
  assert.equal((await firmado({ evento_id: 'm-inicio-0001', evento: 'matrices_inicio', ...comunes, unidades: [1, 2], forzar: false, secuencia: 1, fecha_evento: fecha(1) })).status, 200)
  assert.equal((await ana('POST', '/proyectos/curso-m/pipeline/matrices', { unidades: [1] })).status, 409) // la corrida avisó: sigue en curso
  assert.equal((await firmado({ evento_id: 'm-fin-0001', evento: 'matrices_fin', ...comunes, secuencia: 2, fecha_evento: fecha(2),
    resultados: [{ unidad: 1, formacion: 'Tecnológico', resultado: 'creada', matriz: { id: 'M1', url: 'https://docs.google.com/spreadsheets/d/m1abcdefgh/edit', nombre: 'Matriz U1' }, filas: [] }] })).status, 200)
  const otra = await ana('POST', '/proyectos/curso-m/pipeline/matrices', { unidades: [1], forzar: true })
  assert.equal(otra.status, 202)
  assert.equal(recibidas.at(-1).forzar, true)
})

test('si n8n no acepta la orden (409, error o caído) se avisa con claridad y no queda bloqueado el curso', async () => {
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('PUT', '/proyectos/curso-n', curso('curso-n'))).status, 200)
  respuestaN8n = { estado: 409, cuerpo: { error: 'ya hay una ejecución' } }
  let r = await ana('POST', '/proyectos/curso-n/pipeline/matrices', { unidades: [1] })
  assert.equal(r.status, 409); assert.equal((await origenes('ana', 'curso-n')).length, 0)
  respuestaN8n = { estado: 500, cuerpo: { error: 'boom' } }
  r = await ana('POST', '/proyectos/curso-n/pipeline/matrices', { unidades: [1] })
  assert.equal(r.status, 502); assert.equal((await origenes('ana', 'curso-n')).length, 0)
  const guardada = config.n8nMatricesUrl
  config.n8nMatricesUrl = 'http://127.0.0.1:1/nada' // nadie escucha
  r = await ana('POST', '/proyectos/curso-n/pipeline/matrices', { unidades: [1] })
  assert.equal(r.status, 502); assert.equal((await origenes('ana', 'curso-n')).length, 0)
  config.n8nMatricesUrl = ''
  r = await ana('POST', '/proyectos/curso-n/pipeline/matrices', { unidades: [1] })
  assert.equal(r.status, 503)
  assert.equal((await (await ana('GET', '/proyectos/curso-n/pipeline')).json()).puedeGenerarMatrices, false)
  config.n8nMatricesUrl = guardada
  respuestaN8n = { estado: 200, cuerpo: { ok: true } }
  assert.equal((await ana('POST', '/proyectos/curso-n/pipeline/matrices', { unidades: [1] })).status, 202) // ya no estaba bloqueado
})

test('nadie lanza sobre un curso ajeno y dos clics a la vez lanzan una sola vez', async () => {
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  assert.equal((await beto('POST', '/proyectos/curso-m/pipeline/matrices', { unidades: [1] })).status, 404)
  assert.equal((await ana('PUT', '/proyectos/curso-p', curso('curso-p'))).status, 200)
  const antes = recibidas.length
  const rs = await Promise.all([1, 2, 3, 4].map(() => ana('POST', '/proyectos/curso-p/pipeline/matrices', { unidades: [1] })))
  const codigos = rs.map((r) => r.status).sort()
  assert.deepEqual(codigos, [202, 409, 409, 409])
  assert.equal(recibidas.length, antes + 1)
})

test('H5P: exige matrices listas, valida unidades y máximo, entrega la orden con el plan por pedir y recoge el ejecucion_id del ack', async () => {
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('PUT', '/proyectos/curso-h', curso('curso-h'))).status, 200)
  assert.equal((await fetch(base + '/api/proyectos/curso-h/pipeline/h5p', { method: 'POST', headers: { 'x-ova': '1', 'content-type': 'application/json' }, body: '{}' })).status, 401)
  assert.equal((await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 0 })).status, 400)
  assert.equal((await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 5, otro: 1 })).status, 400)
  const sinMatrices = await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 5 })
  assert.equal(sinMatrices.status, 409); assert.match((await sinMatrices.json()).error, /matrices/)
  // n8n avisa que la matriz de la unidad 1 quedó lista (así llega en producción)
  const comun = { etapa: 'matrices', proyecto_id: 'curso-h', ejecucion_id: 'ej-h-m' }
  const mat = await ana('POST', '/proyectos/curso-h/pipeline/matrices', { unidades: [1] })
  assert.equal(mat.status, 202)
  const tm = (await mat.json()).trabajo_id
  const f = (s) => new Date(Date.now() - 60 * 1000 + s * 1000).toISOString()
  assert.equal((await firmado({ evento_id: 'h-m-fin-0001', evento: 'matrices_fin', ...comun, trabajo_id: tm, origen_trabajo_id: tm, secuencia: 1, fecha_evento: f(1),
    resultados: [{ unidad: 1, formacion: 'Tecnológico', resultado: 'creada', matriz: { id: 'MH1', url: 'https://docs.google.com/spreadsheets/d/mh1abcdefgh/edit', nombre: 'Matriz U1' }, filas: [] }] })).status, 200)
  assert.equal((await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 5, unidades: [2] })).status, 400) // la unidad 2 no tiene matriz
  respuestaN8n = { estado: 200, cuerpo: { ejecucion_id: 'ej-n8n-77', plan: { a_generar: [], omitidas: [] } } }
  const antes = recibidas.length
  const r = await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 7, unidades: [1], reintentarErrores: true })
  assert.equal(r.status, 202)
  const j = await r.json()
  assert.equal(j.ejecucion_id, 'ej-n8n-77')
  assert.equal(recibidas.length, antes + 1)
  assert.deepEqual(recibidas.at(-1), { trabajo_id: j.trabajo_id, proyecto_id: 'curso-h', carpeta_raiz: CARPETA, maximo: 7, unidades: [1], reintentar_errores: true })
  const o = await pool.query("SELECT etapa, carpeta_raiz FROM pipeline_origen WHERE trabajo_id = $1", [j.trabajo_id])
  assert.deepEqual(o.rows[0], { etapa: 'h5p', carpeta_raiz: CARPETA })
  respuestaN8n = { estado: 200, cuerpo: { ok: true } }
})

test('H5P: una sola corrida a la vez, el 409 de n8n y los fallos se explican y no dejan bloqueado el curso, y sin configurar da 503', async () => {
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 3 })).status, 409) // la anterior sigue en curso (sin aviso de fin)
  // se da por terminada con el aviso firmado
  const o = (await pool.query("SELECT trabajo_id FROM pipeline_origen WHERE propietario_id = $1 AND proyecto_id = 'curso-h' AND etapa = 'h5p'", [ids.ana])).rows[0].trabajo_id
  const f = (s) => new Date(Date.now() - 30 * 1000 + s * 1000).toISOString()
  const comun = { etapa: 'h5p', trabajo_id: o, proyecto_id: 'curso-h', ejecucion_id: 'ej-n8n-77' }
  assert.equal((await firmado({ evento_id: 'h-h-ini-0001', evento: 'h5p_inicio', ...comun, secuencia: 1, fecha_evento: f(1), maximo: 7, plan: { a_generar: [], omitidas: [] } })).status, 200)
  assert.equal((await firmado({ evento_id: 'h-h-fin-0001', evento: 'h5p_fin', ...comun, secuencia: 2, fecha_evento: f(2), resumen: { generados: 0, errores: 0, omitidos: 0 } })).status, 200)
  respuestaN8n = { estado: 409, cuerpo: { error: 'ya hay una ejecución' } }
  let r = await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 3 })
  assert.equal(r.status, 409); assert.equal((await r.json()).ya, true)
  respuestaN8n = { estado: 500, cuerpo: { error: 'boom' } }
  assert.equal((await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 3 })).status, 502)
  const guardada = config.n8nH5pUrl
  config.n8nH5pUrl = ''
  assert.equal((await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 3 })).status, 503)
  assert.equal((await (await ana('GET', '/proyectos/curso-h/pipeline')).json()).puedeGenerarH5p, false)
  config.n8nH5pUrl = guardada
  respuestaN8n = { estado: 200, cuerpo: { ok: true } }
  assert.equal((await ana('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 3 })).status, 202) // los fallos no dejaron bloqueado el curso
  const beto = await entrar('beto@u.co')
  assert.equal((await beto('POST', '/proyectos/curso-h/pipeline/h5p', { maximo: 3 })).status, 404) // curso ajeno
})
