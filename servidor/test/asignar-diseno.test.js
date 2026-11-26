// Fase 2 del diseño: la coordinación asigna cursos enviados a diseño a diseñadores (carga, reasignar, rápido, gancho de Drive).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const PUERTO_PG = 55600
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-asd-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
let servidor, base, pool, falso, urlFalso
const recibidos = []
let respuestaFalsa = 200

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const duenio = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await duenio.connect()
  await duenio.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql', '025_asignar_diseno.sql', '026_correcciones.sql']) await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', '025_asignar_diseno.sql'), 'utf8')) // idempotente
  await duenio.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  const crear = async (n, c, roles) => pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), roles])
  await crear('Ana', 'ana@u.co', ['docente'])
  await crear('Coord', 'coord@u.co', ['coordinador'])
  await crear('Admin', 'admin@u.co', ['docente', 'admin'])
  await crear('Dina', 'dina@u.co', ['disenador'])
  await crear('Darío', 'dario@u.co', ['disenador'])
  falso = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => { recibidos.push(JSON.parse(Buffer.concat(partes).toString('utf8'))); res.statusCode = respuestaFalsa; res.end('{}') })
  }).listen(0)
  urlFalso = 'http://127.0.0.1:' + falso.address().port + '/compartir'
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})

after(async () => {
  servidor && servidor.close()
  falso && falso.close()
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
const doc = (u) => ({ unidad: u, nombre: 'U' + u, url: 'https://docs.google.com/document/d/abc' + u, aprobado: true })
const proyecto = (id) => ({ id, programa: 'Licenciatura', curso: 'Curso ' + id, creado: 1, carpetaUrl: 'https://drive.google.com/drive/folders/CARPETA' + id,
  syllabus: { estado: 'listo', documentos: [doc(1)] }, guionesUnidad: { 1: { fecha: 1, archivos: [{ nombre: 'g.docx', aprobado: true }] } } })
const idUsuario = async (correo) => (await pool.query('SELECT id FROM usuarios WHERE correo = $1', [correo])).rows[0].id
const filaBd = async (id) => (await pool.query('SELECT * FROM curso_diseno WHERE proyecto_id = $1', [id])).rows[0]
let ana, coord, admin, dina, dario, anaId

async function enviar(id) {
  assert.equal((await ana('PUT', '/proyectos/' + id, proyecto(id))).status, 200)
  assert.equal((await ana('POST', '/proyectos/' + id + '/enviar-diseno', {})).status, 200)
}

test('la bandeja y los diseñadores solo los ve quien tiene diseno.asignar', async () => {
  ana = await entrar('ana@u.co'); coord = await entrar('coord@u.co'); admin = await entrar('admin@u.co'); dina = await entrar('dina@u.co'); dario = await entrar('dario@u.co')
  anaId = await idUsuario('ana@u.co')
  await enviar('c1'); await enviar('c2'); await enviar('c3'); await enviar('c4')
  for (const ruta of ['/diseno/bandeja', '/diseno/disenadores']) {
    assert.equal((await ana('GET', ruta)).status, 403)
    assert.equal((await dina('GET', ruta)).status, 403)
    assert.equal((await coord('GET', ruta)).status, 200)
    assert.equal((await admin('GET', ruta)).status, 200)
  }
  assert.equal((await ana('POST', '/diseno/asignar-rapido', { propietarioId: anaId, proyectoId: 'c1' })).status, 403)
  const b = await (await coord('GET', '/diseno/bandeja')).json()
  assert.equal(b.length, 4)
  assert.equal(b[0].curso, 'Curso c1'); assert.equal(b[0].docente, 'Ana'); assert.equal(b[0].docente_correo, 'ana@u.co'); assert.equal(b[0].estado, 'en_diseno'); assert.equal(b[0].disenador, null)
  const bAdmin = await (await admin('GET', '/diseno/bandeja')).json()
  assert.equal(bAdmin[0].curso, 'Curso c1') // la administración también ve el nombre del curso
})

test('diseñadores con su carga (solo activos con el rol)', async () => {
  const l = await (await coord('GET', '/diseno/disenadores')).json()
  assert.deepEqual(l.map((d) => [d.nombre, d.carga]), [['Darío', 0], ['Dina', 0]])
})

test('asignar a quien no es diseñador o un curso no enviado falla', async () => {
  const r = await coord('POST', '/diseno/asignar', { propietarioId: anaId, proyectoId: 'c1', disenadorId: anaId })
  assert.equal(r.status, 400)
  assert.equal((await coord('POST', '/diseno/asignar', { propietarioId: anaId, proyectoId: 'c1', disenadorId: 'no-uuid' })).status, 400)
  assert.equal((await coord('POST', '/diseno/asignar', { propietarioId: anaId, proyectoId: 'no-enviado', disenadorId: await idUsuario('dina@u.co') })).status, 409)
  assert.equal((await coord('POST', '/diseno/asignar-rapido', { propietarioId: anaId, proyectoId: 'no-enviado' })).status, 409)
})

test('asignar sin dirección de Drive: queda asignado, auditado y sin_configurar; reasignar conserva el estado', async () => {
  const dinaId = await idUsuario('dina@u.co'); const darioId = await idUsuario('dario@u.co')
  let r = await coord('POST', '/diseno/asignar', { propietarioId: anaId, proyectoId: 'c1', disenadorId: dinaId })
  assert.equal(r.status, 200)
  let d = await r.json()
  assert.equal(d.estado, 'asignado'); assert.equal(d.reasignado, false); assert.equal(d.drive_compartido, 'sin_configurar'); assert.match(d.carpeta, /folders\/CARPETAc1/)
  let f = await filaBd('c1')
  assert.equal(f.estado, 'asignado'); assert.equal(f.disenador_id, dinaId); assert.ok(f.asignado_en); assert.equal(f.drive_compartido, 'sin_configurar')
  const aud = (await pool.query("SELECT entidad_id FROM auditoria WHERE accion = 'diseno.asignar'")).rows
  assert.equal(aud.length, 1)
  assert.equal(aud[0].entidad_id, 'c1 en_diseno:->asignado:' + dinaId.slice(0, 8))
  // en revisión del docente: reasignar cambia el diseñador y conserva el estado
  await pool.query("UPDATE curso_diseno SET estado = 'en_revision_docente' WHERE proyecto_id = 'c1'")
  r = await coord('POST', '/diseno/asignar', { propietarioId: anaId, proyectoId: 'c1', disenadorId: darioId })
  d = await r.json()
  assert.equal(d.estado, 'en_revision_docente'); assert.equal(d.reasignado, true)
  f = await filaBd('c1')
  assert.equal(f.estado, 'en_revision_docente'); assert.equal(f.disenador_id, darioId)
  const l = await (await coord('GET', '/diseno/disenadores')).json()
  assert.deepEqual(l.map((x) => [x.nombre, x.carga]), [['Darío', 1], ['Dina', 0]])
  const mios = await (await dario('GET', '/diseno/mios')).json()
  assert.equal(mios.length, 1); assert.equal(mios[0].curso, 'Curso c1'); assert.equal(mios[0].docente, 'Ana'); assert.equal(mios[0].estado, 'en_revision_docente')
  assert.equal((await (await dina('GET', '/diseno/mios')).json()).length, 0)
  assert.equal((await ana('GET', '/diseno/mios')).status, 403)
})

test('asignación rápida: el de menos carga y, en empate, quien tiene la asignación más antigua', async () => {
  // Darío tiene 1 (c1), Dina 0 → Dina
  let d = await (await coord('POST', '/diseno/asignar-rapido', { propietarioId: anaId, proyectoId: 'c2' })).json()
  assert.equal(d.disenador.nombre, 'Dina'); assert.equal(d.estado, 'asignado')
  // 1 y 1: gana la asignación más antigua (Darío, c1 asignado antes que c2)
  d = await (await coord('POST', '/diseno/asignar-rapido', { propietarioId: anaId, proyectoId: 'c3' })).json()
  assert.equal(d.disenador.nombre, 'Darío')
})

test('asignar todos los pendientes recalcula la carga uno a uno', async () => {
  const r = await (await coord('POST', '/diseno/asignar-rapido-todos', {})).json()
  assert.equal(r.asignados, 1); assert.equal(r.hechos[0].proyecto_id, 'c4')
  const r2 = await (await coord('POST', '/diseno/asignar-rapido-todos', {})).json()
  assert.equal(r2.asignados, 0)
})

test('con dirección de Drive: manda correo y carpeta; error o caída no rompen la asignación', async () => {
  await pool.query("INSERT INTO configuracion (clave, valor) VALUES ('n8n.compartir_carpeta', $1)", [urlFalso])
  const dinaId = await idUsuario('dina@u.co')
  let d = await (await coord('POST', '/diseno/asignar', { propietarioId: anaId, proyectoId: 'c3', disenadorId: dinaId })).json() // c3 estaba con Darío
  assert.equal(d.drive_compartido, 'ok')
  assert.equal(recibidos.length, 1)
  assert.deepEqual(recibidos[0], { proyecto_id: 'c3', carpeta_raiz: 'https://drive.google.com/drive/folders/CARPETAc3', correo_disenador: 'dina@u.co', rol: 'writer', anterior_correo: 'dario@u.co' })
  assert.equal((await filaBd('c3')).drive_compartido, 'ok')
  respuestaFalsa = 500
  d = await (await coord('POST', '/diseno/asignar', { propietarioId: anaId, proyectoId: 'c3', disenadorId: dinaId })).json()
  assert.equal(d.drive_compartido, 'error: HTTP 500')
  assert.equal((await filaBd('c3')).drive_compartido, 'error: HTTP 500')
  await pool.query("UPDATE configuracion SET valor = 'http://127.0.0.1:1/x' WHERE clave = 'n8n.compartir_carpeta'")
  const r = await coord('POST', '/diseno/asignar', { propietarioId: anaId, proyectoId: 'c3', disenadorId: dinaId })
  assert.equal(r.status, 200)
  assert.match((await r.json()).drive_compartido, /^error: /)
  assert.equal((await filaBd('c3')).disenador_id, dinaId)
})
