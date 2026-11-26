// Fase 4 del diseño: correcciones docente <-> diseñador por recurso (pedir, bloqueo del recurso, corregir, devolver, cerrar, reabrir).
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
const PUERTO_PG = 56400
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-corr-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const CARPETA = 'https://drive.google.com/drive/folders/carpetaCorr1'
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
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql', '025_asignar_diseno.sql', '026_correcciones.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', '026_correcciones.sql'), 'utf8')) // idempotente
  await dueno.end()
  n8n = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => { recibidas.push(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') })
  }).listen(0)
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.PRUEBAS_PLANTILLAS = '0'
  process.env.LIMITE_LANZAR_PIPELINE = '500'
  process.env.LIMITE_EDITAR_RECURSO = '500'
  process.env.LIMITE_LOGIN = '1000'
  const url = 'http://127.0.0.1:' + n8n.address().port
  process.env.N8N_MATRICES_URL = url + '/webhook/matrices'
  process.env.N8N_H5P_URL = url + '/webhook/h5p'
  process.env.N8N_PUBLICAR_URL = url + '/webhook/publicar'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [n, c, rol] of [['Ana', 'ana@u.co', 'docente'], ['Beto', 'beto@u.co', 'docente'], ['Dina', 'dina@u.co', 'disenador'], ['Dario', 'dario@u.co', 'disenador'], ['Admin', 'admin@u.co', 'admin']]) ids[n.toLowerCase()] = (await pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), [rol]])).rows[0].id
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
  return (metodo, ruta, cuerpo, extra = {}) => fetch(base + '/api' + ruta, { method: metodo, headers: { cookie, 'x-ova': '1', 'content-type': 'application/json', ...extra }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
}
const curso = (id) => ({
  id, programa: 'P', curso: 'Curso ' + id, creado: Date.now(), syllabusUrl: 'https://docs.google.com/document/d/syllabusX1234', carpetaUrl: CARPETA,
  syllabus: { estado: 'listo', mensaje: '', documentos: [1, 2].map((u) => ({ unidad: u, nombre: 'U' + u, url: 'https://docs.google.com/document/d/g' + u + 'abcdefghij', aprobado: true, visto: true, temas: [] })) },
  recursos: [], guiones: [], info: { nivel: 'Profesional' },
  guionesUnidad: Object.fromEntries([1, 2].map((u) => [u, { fecha: 1, archivos: [{ nombre: 'Guion tema 1', tema: 1, url: 'https://docs.google.com/document/d/u' + u + 'g1abcdefghij', aprobado: true, info: {} }] }]))
})
const estadoCurso = async (id) => (await pool.query('SELECT estado FROM curso_diseno WHERE proyecto_id = $1', [id])).rows[0].estado
const q = () => '?propietario=' + ids.ana
const hilo = async (fn) => (await fn('GET', '/diseno/correcciones?propietario=' + ids.ana + '&proyecto=c1')).json()
let corrId

test('preparación: curso c1 de Ana asignado a Dina, con una matriz lista y dos recursos', async () => {
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('PUT', '/proyectos/c1', curso('c1'))).status, 200)
  assert.equal((await ana('POST', '/proyectos/c1/enviar-diseno', {})).status, 200)
  await pool.query("UPDATE curso_diseno SET estado = 'asignado', disenador_id = $1 WHERE proyecto_id = 'c1'", [ids.dina])
  await pool.query("INSERT INTO pipeline_matrices (propietario_id, proyecto_id, unidad, formacion, estado, actualizado_en) VALUES ($1, 'c1', 1, 'Profesional', 'creada', now())", [ids.ana])
  for (const [id, cod] of [['r1', 'U1-T1-R1'], ['r2', 'U1-T1-R2']]) {
    await pool.query("INSERT INTO pipeline_recursos (propietario_id, proyecto_id, id, unidad, tema, codigo, titulo, estado, plantilla, contenido, actualizado_en) VALUES ($1, 'c1', $2, 1, 1, $3, 'Rec ' || $2, 'GENERADO', 'pub-x', '{\"a\":\"b\"}'::jsonb, now())", [ids.ana, id, cod])
  }
})

test('pedir corrección: el recurso se bloquea y el curso pasa a revisión del docente', async () => {
  const dina = await entrar('dina@u.co')
  assert.equal((await dina('POST', '/diseno/correcciones', { propietario: ids.ana, proyecto: 'c1', recursoId: 'r1', mensaje: '   ' })).status, 400)
  assert.equal((await dina('POST', '/diseno/correcciones', { propietario: ids.ana, proyecto: 'c1', recursoId: 'zz', mensaje: 'x' })).status, 404)
  const r = await dina('POST', '/diseno/correcciones', { propietario: ids.ana, proyecto: 'c1', recursoId: 'r1', mensaje: 'ALERTA actividad no generada: el guion no trae bloque de actividad' })
  assert.equal(r.status, 201)
  corrId = (await r.json()).id
  assert.equal(await estadoCurso('c1'), 'en_revision_docente')
  assert.equal((await dina('POST', '/diseno/correcciones', { propietario: ids.ana, proyecto: 'c1', recursoId: 'r1', mensaje: 'otra' })).status, 409)
  const rec = (await (await dina('GET', '/proyectos/c1/pipeline' + q())).json()).recursos
  assert.deepEqual(rec.find((x) => x.id === 'r1').correccion, { id: corrId, estado: 'abierta' })
  assert.equal(rec.find((x) => x.id === 'r2').correccion, undefined)
  const aud = (await pool.query("SELECT accion FROM auditoria WHERE accion LIKE 'correccion.%'")).rows.map((x) => x.accion)
  assert.deepEqual(aud, ['correccion.pedir'])
})

test('con la corrección abierta: aprobar 409 y regenerar 409 (admin, que sí opera en revisión)', async () => {
  const admin = await entrar('admin@u.co'); const dina = await entrar('dina@u.co')
  let r = await admin('POST', '/proyectos/c1/pipeline/recursos/r1/aprobar' + q(), {})
  assert.equal(r.status, 409); assert.match((await r.json()).error, /corrección pendiente/)
  assert.equal((await admin('POST', '/proyectos/c1/pipeline/recursos/U1-T1-R1/aprobar' + q(), {})).status, 409) // también por código
  r = await admin('POST', '/proyectos/c1/pipeline/h5p' + q(), { regenerar: ['U1-T1-R1'] })
  assert.equal(r.status, 409); assert.match((await r.json()).error, /corrección pendiente/)
  assert.equal(recibidas.length, 0)
  // el diseñador, con el curso en revisión, solo lee
  assert.equal((await dina('POST', '/proyectos/c1/pipeline/h5p' + q(), { regenerar: ['U1-T1-R2'] })).status, 409)
  // otro recurso del mismo curso no está bloqueado por la corrección
  assert.notEqual((await admin('POST', '/proyectos/c1/pipeline/recursos/r2/aprobar' + q(), {})).status, 409)
})

test('permisos: otro docente, otro diseñador, el docente no pide, ids no válidos', async () => {
  const beto = await entrar('beto@u.co'); const dario = await entrar('dario@u.co'); const ana = await entrar('ana@u.co'); const dina = await entrar('dina@u.co')
  assert.equal((await beto('GET', '/diseno/correcciones?propietario=' + ids.ana + '&proyecto=c1')).status, 403)
  assert.equal((await dario('GET', '/diseno/correcciones?propietario=' + ids.ana + '&proyecto=c1')).status, 403)
  assert.equal((await dario('POST', '/diseno/correcciones', { propietario: ids.ana, proyecto: 'c1', recursoId: 'r2', mensaje: 'x' })).status, 403)
  assert.equal((await ana('POST', '/diseno/correcciones', { propietario: ids.ana, proyecto: 'c1', recursoId: 'r2', mensaje: 'x' })).status, 403)
  assert.equal((await beto('POST', '/diseno/correcciones/' + corrId + '/mensajes', { texto: 'hola' })).status, 403)
  assert.equal((await dario('POST', '/diseno/correcciones/' + corrId + '/mensajes', { texto: 'hola' })).status, 403)
  assert.equal((await beto('POST', '/diseno/correcciones/' + corrId + '/corregida', {})).status, 403)
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/corregida', {})).status, 403) // solo el docente dueño
  assert.equal((await dario('POST', '/diseno/correcciones/' + corrId + '/cerrar', {})).status, 403)
  assert.equal((await beto('POST', '/proyectos/c1/devolver-diseno', {})).status, 404)
  assert.equal((await ana('POST', '/diseno/correcciones/00000000-0000-4000-8000-000000000000/cerrar', {})).status, 404)
  assert.equal((await ana('POST', '/diseno/correcciones/no-uuid/cerrar', {})).status, 400)
})

test('mensajes visibles para ambos; el docente ve sus solicitudes en su tablero', async () => {
  const ana = await entrar('ana@u.co'); const dina = await entrar('dina@u.co')
  assert.equal((await ana('POST', '/diseno/correcciones/' + corrId + '/mensajes', { texto: 'Ya reviso el guion' })).status, 200)
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/mensajes', { texto: 'Gracias' })).status, 200)
  for (const fn of [ana, dina]) {
    const l = await hilo(fn)
    assert.equal(l.estado, 'en_revision_docente')
    assert.deepEqual(l.correcciones[0].mensajes.map((m) => m.rol), ['disenador', 'docente', 'disenador'])
    assert.equal(l.correcciones[0].codigo, 'U1-T1-R1')
  }
  assert.equal((await (await ana('GET', '/diseno/correcciones')).json()).correcciones.length, 1)
})

test('devolver con solicitudes abiertas: 409; marcar corregida y devolver: ok', async () => {
  const ana = await entrar('ana@u.co'); const dina = await entrar('dina@u.co')
  assert.equal((await ana('POST', '/proyectos/c1/devolver-diseno', {})).status, 409)
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/cerrar', {})).status, 409) // aún abierta
  assert.equal((await ana('POST', '/diseno/correcciones/' + corrId + '/corregida', { mensaje: 'Agregué la actividad al guion' })).status, 200)
  assert.equal((await ana('POST', '/diseno/correcciones/' + corrId + '/corregida', {})).status, 409)
  assert.equal((await ana('POST', '/proyectos/c1/devolver-diseno', {})).status, 200)
  assert.equal(await estadoCurso('c1'), 'asignado')
  assert.equal((await ana('POST', '/proyectos/c1/devolver-diseno', {})).status, 409)
  assert.equal((await (await dina('GET', '/diseno/mios')).json())[0].correcciones_listas, 1)
})

test('corregida: aprobar sigue bloqueado, regenerar sí; el diseñador cierra y el recurso se desbloquea', async () => {
  const dina = await entrar('dina@u.co')
  let r = await dina('POST', '/proyectos/c1/pipeline/recursos/r1/aprobar' + q(), {})
  assert.equal(r.status, 409); assert.match((await r.json()).error, /corrección pendiente/)
  assert.equal((await (await dina('GET', '/proyectos/c1/pipeline' + q())).json()).recursos.find((x) => x.id === 'r1').correccion.estado, 'corregida')
  r = await dina('POST', '/proyectos/c1/pipeline/h5p' + q(), { regenerar: ['U1-T1-R1'] })
  assert.equal(r.status, 202)
  assert.deepEqual(recibidas.at(-1).regenerar, ['U1-T1-R1'])
  await pool.query("UPDATE pipeline_recursos SET estado = 'GENERADO' WHERE id = 'r1'") // simula el aviso de n8n con el recurso nuevo
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/cerrar', {})).status, 200)
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/cerrar', {})).status, 409)
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/mensajes', { texto: 'x' })).status, 409) // cerrada
  r = await dina('POST', '/proyectos/c1/pipeline/recursos/r1/aprobar' + q(), {})
  assert.notEqual(r.status, 409) // ya no lo bloquea la corrección
  const rec = (await (await dina('GET', '/proyectos/c1/pipeline' + q())).json()).recursos.find((x) => x.id === 'r1')
  assert.equal(rec.correccion, undefined)
  assert.equal((await hilo(dina)).correcciones.length, 1) // con el curso, el hilo cerrado sigue visible
})

test('reabrir: vuelve a abierta, el curso a revisión y se repite el ciclo', async () => {
  const dina = await entrar('dina@u.co'); const ana = await entrar('ana@u.co')
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/reabrir', {})).status, 400)
  assert.equal((await ana('POST', '/diseno/correcciones/' + corrId + '/reabrir', { mensaje: 'x' })).status, 403)
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/reabrir', { mensaje: 'Sigue sin actividad' })).status, 200)
  assert.equal(await estadoCurso('c1'), 'en_revision_docente')
  const l = await hilo(dina)
  assert.equal(l.correcciones[0].estado, 'abierta'); assert.equal(l.correcciones[0].mensajes.at(-1).texto, 'Sigue sin actividad')
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/reabrir', { mensaje: 'otra vez' })).status, 409)
  assert.equal((await ana('POST', '/diseno/correcciones/' + corrId + '/corregida', {})).status, 200)
  assert.equal((await ana('POST', '/proyectos/c1/devolver-diseno', {})).status, 200)
  assert.equal((await dina('POST', '/diseno/correcciones/' + corrId + '/cerrar', {})).status, 200)
  const aud = (await pool.query("SELECT accion FROM auditoria WHERE accion LIKE 'correccion.%'")).rows.map((x) => x.accion)
  for (const a of ['correccion.pedir', 'correccion.mensaje', 'correccion.corregida', 'correccion.devolver', 'correccion.cerrar', 'correccion.reabrir']) assert.ok(aud.includes(a), a)
})
