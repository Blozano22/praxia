// Fase 3 del diseño: el diseñador asignado genera matrices y H5P del curso del docente, actuando en nombre del dueño.
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
const PUERTO_PG = 56010
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-dpl-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789'
const CARPETA = 'https://drive.google.com/drive/folders/carpetaDiseno1'
let servidor, base, pool, n8n
const recibidas = []
const ids = {}

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql', '025_asignar_diseno.sql', '026_correcciones.sql', '027_cola_regenerar.sql', '028_cola_partes.sql', '029_permiso_h5p.sql', '030_plantilla_reemplazada.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await dueno.end()
  n8n = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => { recibidas.push(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') })
  }).listen(0)
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.PRUEBAS_PLANTILLAS = '0'
  process.env.N8N_EVENTOS_SECRETO = SECRETO
  process.env.LIMITE_LANZAR_PIPELINE = '500'
  process.env.LIMITE_LOGIN = '1000'
  process.env.N8N_MATRICES_URL = 'http://127.0.0.1:' + n8n.address().port + '/webhook/matrices'
  process.env.N8N_H5P_URL = 'http://127.0.0.1:' + n8n.address().port + '/webhook/h5p'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [n, c, rol] of [['Ana', 'ana@u.co', 'docente'], ['Dina', 'dina@u.co', 'disenador'], ['Dario', 'dario@u.co', 'disenador'], ['Admin', 'admin@u.co', 'admin']]) ids[n.toLowerCase()] = (await pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), [rol]])).rows[0].id
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
  const fn = (metodo, ruta, cuerpo, extra = {}) => fetch(base + '/api' + ruta, { method: metodo, headers: { cookie, 'x-ova': '1', 'content-type': 'application/json', ...extra }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
  return fn
}
const curso = (id) => ({
  id, programa: 'P', curso: 'Curso ' + id, creado: Date.now(), syllabusUrl: 'https://docs.google.com/document/d/syllabusX1234', carpetaUrl: CARPETA,
  syllabus: { estado: 'listo', mensaje: '', documentos: [1, 2].map((u) => ({ unidad: u, nombre: 'U' + u, url: 'https://docs.google.com/document/d/g' + u + 'abcdefghij', aprobado: true, visto: true, temas: [] })) },
  recursos: [], guiones: [], info: { nivel: 'Profesional' },
  guionesUnidad: Object.fromEntries([1, 2].map((u) => [u, { fecha: 1, archivos: [{ nombre: 'Guion tema 1', tema: 1, url: 'https://docs.google.com/document/d/u' + u + 'g1abcdefghij', aprobado: true, info: {} }] }]))
})
const firmado = async (obj) => {
  const cuerpo = JSON.stringify(obj)
  const fecha = String(Math.floor(Date.now() / 1000))
  const firma = crypto.createHmac('sha256', SECRETO).update(fecha + '.' + cuerpo).digest('hex')
  return fetch(base + '/api/n8n/eventos', { method: 'POST', headers: { 'content-type': 'application/json', 'x-praxia-fecha': fecha, 'x-praxia-firma': firma }, body: cuerpo })
}
const estado = (id, st, dis) => pool.query('UPDATE curso_diseno SET estado = $2, disenador_id = $3 WHERE proyecto_id = $1', [id, st, dis])
const q = () => '?propietario=' + ids.ana

test('preparación: curso de Ana enviado a diseño y asignado a Dina', async () => {
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('PUT', '/proyectos/c1', curso('c1'))).status, 200)
  assert.equal((await ana('POST', '/proyectos/c1/enviar-diseno', {})).status, 200)
  await estado('c1', 'asignado', ids.dina)
})

test('diseñador asignado lanza matrices y H5P del curso ajeno; los datos son del dueño; el docente sigue bloqueado', async () => {
  const dina = await entrar('dina@u.co'); const ana = await entrar('ana@u.co')
  let r = await dina('POST', '/proyectos/c1/pipeline/matrices' + q(), { unidades: [1] })
  assert.equal(r.status, 202)
  const j = await r.json()
  assert.equal(recibidas.length, 1); assert.equal(recibidas[0].proyecto_id, 'c1'); assert.equal(recibidas[0].carpeta_raiz, CARPETA)
  const o = (await pool.query('SELECT propietario_id FROM pipeline_origen WHERE trabajo_id = $1', [j.trabajo_id])).rows[0]
  assert.equal(o.propietario_id, ids.ana)
  // aviso posterior de n8n: se atribuye al curso del dueño
  const f = (s) => new Date(Date.now() - 60000 + s * 1000).toISOString()
  const comunes = { etapa: 'matrices', origen_trabajo_id: j.trabajo_id, trabajo_id: j.trabajo_id, proyecto_id: 'c1', ejecucion_id: 'ej-d1' }
  assert.equal((await firmado({ evento_id: 'd-fin-00001', evento: 'matrices_fin', ...comunes, secuencia: 1, fecha_evento: f(1),
    resultados: [{ unidad: 1, formacion: 'Profesional', resultado: 'creada', matriz: { id: 'M1', url: 'https://docs.google.com/spreadsheets/d/m1abcdefgh/edit', nombre: 'Matriz U1' }, filas: [] }] })).status, 200)
  const m = (await pool.query("SELECT propietario_id FROM pipeline_matrices WHERE proyecto_id = 'c1'")).rows
  assert.ok(m.length >= 1); assert.ok(m.every((x) => x.propietario_id === ids.ana))
  // H5P
  r = await dina('POST', '/proyectos/c1/pipeline/h5p' + q(), { unidades: [1] })
  assert.equal(r.status, 202)
  const o2 = (await pool.query('SELECT propietario_id FROM pipeline_origen WHERE trabajo_id = $1', [(await r.json()).trabajo_id])).rows[0]
  assert.equal(o2.propietario_id, ids.ana)
  // lectura con la query y con el encabezado
  r = await dina('GET', '/proyectos/c1/pipeline' + q()); assert.equal(r.status, 200)
  assert.equal((await r.json()).matrices.length, 1)
  assert.equal((await dina('GET', '/proyectos/c1/pipeline', undefined, { 'x-propietario': ids.ana })).status, 200)
  // sin propietario: es la ruta del propio docente y el diseñador no tiene permisos de proyectos
  assert.equal((await dina('GET', '/proyectos/c1/pipeline')).status, 403)
  // el docente dueño sigue bloqueado
  assert.equal((await ana('POST', '/proyectos/c1/pipeline/matrices', { unidades: [1] })).status, 409)
  assert.equal((await dina('POST', '/proyectos/c1/pipeline/matrices?propietario=no-uuid', { unidades: [1] })).status, 400)
  // auditoría: el actor es el diseñador
  await new Promise((s) => setTimeout(s, 300))
  const aud = (await pool.query("SELECT usuario_id FROM auditoria WHERE accion = 'matrices.generar' AND entidad_id = 'c1'")).rows
  assert.equal(aud.length, 1); assert.equal(aud[0].usuario_id, ids.dina)
  // datos del curso en solo lectura
  r = await dina('GET', '/diseno/cursos/' + ids.ana + '/c1'); assert.equal(r.status, 200)
  const c = await r.json(); assert.equal(c.curso, 'Curso c1'); assert.equal(c.estado, 'asignado'); assert.ok(c.datos.carpetaUrl)
})

test('diseñador no asignado y otro diseñador: 403', async () => {
  const dario = await entrar('dario@u.co')
  const n = recibidas.length
  for (const [m, ruta, cuerpo] of [['POST', '/proyectos/c1/pipeline/matrices' + q(), { unidades: [1] }], ['POST', '/proyectos/c1/pipeline/h5p' + q(), {}], ['GET', '/proyectos/c1/pipeline' + q()], ['GET', '/diseno/cursos/' + ids.ana + '/c1']]) {
    assert.equal((await dario(m, ruta, cuerpo)).status, 403, m + ' ' + ruta)
  }
  assert.equal(recibidas.length, n)
  await estado('c1', 'en_diseno', null) // sin diseñador asignado
  const dina = await entrar('dina@u.co')
  assert.equal((await dina('POST', '/proyectos/c1/pipeline/matrices' + q(), { unidades: [1] })).status, 403)
  await estado('c1', 'asignado', ids.dina)
})

test('en_revision_docente (heredado): el diseñador sigue operando el pipeline, sin bloqueo por revisión', async () => {
  const dina = await entrar('dina@u.co')
  await estado('c1', 'en_revision_docente', ids.dina)
  const n = recibidas.length
  assert.equal((await dina('GET', '/proyectos/c1/pipeline' + q())).status, 200)
  assert.equal((await dina('GET', '/diseno/cursos/' + ids.ana + '/c1')).status, 200)
  const r = await dina('POST', '/proyectos/c1/pipeline/h5p' + q(), {})
  assert.ok(!(await r.json()).bloqueado)
  await estado('c1', 'asignado', ids.dina)
})

test('el administrador puede operar cualquier curso con propietario', async () => {
  const admin = await entrar('admin@u.co')
  assert.equal((await admin('GET', '/proyectos/c1/pipeline' + q())).status, 200)
  const r = await admin('POST', '/proyectos/c1/pipeline/matrices' + q(), { unidades: [2] })
  assert.ok([202, 409].includes(r.status), 'status ' + r.status)
  assert.equal((await admin('GET', '/diseno/cursos/' + ids.ana + '/c1')).status, 200)
})

test('H5P: el docente recibe 403 (permiso recursos.generar); diseñador y administración no', async () => {
  const ana = await entrar('ana@u.co'); const dina = await entrar('dina@u.co'); const admin = await entrar('admin@u.co')
  const n = recibidas.length
  assert.equal((await ana('POST', '/proyectos/c1/pipeline/h5p', { unidades: [1] })).status, 403)
  assert.equal((await ana('POST', '/proyectos/c1/pipeline/h5p', { reintentarErrores: true })).status, 403)
  assert.equal(recibidas.length, n)
  assert.notEqual((await dina('POST', '/proyectos/c1/pipeline/h5p' + q(), { unidades: [1] })).status, 403)
  assert.notEqual((await admin('POST', '/proyectos/c1/pipeline/h5p' + q(), { unidades: [1] })).status, 403)
  // el flag de la pantalla: verdadero para el diseñador (con la URL de n8n configurada), falso para el docente
  assert.equal((await (await dina('GET', '/proyectos/c1/pipeline' + q())).json()).puedeGenerarH5p, true)
  assert.equal((await (await ana('GET', '/proyectos/c1/pipeline')).json()).puedeGenerarH5p, false)
})
