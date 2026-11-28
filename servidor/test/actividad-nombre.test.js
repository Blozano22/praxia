// Tipo de actividad del guion → categoría de actividad por NOMBRE (normalizado) en /asignaciones/pedir; bibliografía por formación; plantillas.json publica las categorías.
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
const PUERTO_PG = 54421
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-actnombre-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789'
const T = { ana: crypto.randomUUID() }

let servidor, base, pool, dueno
const ids = {}

before(async () => {
  await servidorPg.initialise(); await servidorPg.start(); await servidorPg.createDatabase('ova')
  dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql', '025_asignar_diseno.sql', '026_correcciones.sql', '027_cola_regenerar.sql', '028_cola_partes.sql', '029_permiso_h5p.sql', '030_plantilla_reemplazada.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', '019_actividad_tipos.sql'), 'utf8')) // volver a migrar no duplica la siembra
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.PRUEBAS_PLANTILLAS = '0'
  process.env.N8N_EVENTOS_SECRETO = SECRETO
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  const { registrarOrigen } = await import('../src/pipeline/eventos.js')
  pool = db.pool
  for (const [n, c, r] of [['Ana', 'ana@u.co', 'docente'], ['Root', 'root@u.co', 'admin']]) ids[n.toLowerCase()] = (await pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), [r]])).rows[0].id
  await dueno.query("INSERT INTO proyectos (propietario_id, id, programa, curso, datos) VALUES ($1, 'curso-a', 'Programa', 'Curso', '{}')", [ids.ana])
  await registrarOrigen({ trabajoId: T.ana, propietarioId: ids.ana, proyectoId: 'curso-a', etapa: 'preparacion' })
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

const firmar = (cuerpo) => { const fecha = Math.floor(Date.now() / 1000); return { 'x-praxia-fecha': String(fecha), 'x-praxia-firma': crypto.createHmac('sha256', SECRETO).update(fecha + '.' + cuerpo).digest('hex') } }
async function pedir(recursos, extra = {}) {
  const cuerpo = JSON.stringify({ trabajo_id: T.ana, formacion: 'tecnologico', recursos, ...extra })
  const r = await fetch(base + '/api/n8n/asignaciones/pedir', { method: 'POST', headers: { 'content-type': 'application/json', ...firmar(cuerpo) }, body: cuerpo })
  return { estado: r.status, datos: await r.json().catch(() => null) }
}
const rec = (codigo, categoria, extra = {}) => ({ codigo, categoria, id_catalogo: categoria + '-A', id_base: categoria, ...extra })
async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const h = { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1', 'content-type': 'application/json' }
  return (m, ruta, cuerpo) => fetch(base + '/api' + ruta, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
}
const categoria = async (id, tipo, formacion = 'tecnologico', nombre = id) => {
  await dueno.query('INSERT INTO plantilla_categorias (id, nombre, tipo) VALUES ($1, $3, $2)', [id, tipo, nombre])
  await dueno.query('INSERT INTO plantilla_categoria_formacion (categoria, formacion) VALUES ($1, $2)', [id, formacion])
}
const variante = async (nombre, cat, formacion, calificable) => {
  await dueno.query("INSERT INTO plantilla_subidas (nombre, html_crudo, html, subida_nombre, formacion, calificable) VALUES ($1, 'x', 'x', 'prueba', $2, $3)", [nombre, formacion, calificable])
  await dueno.query('INSERT INTO plantilla_categoria (plantilla, categoria) VALUES ($1, $2)', [nombre, cat])
  await dueno.query("INSERT INTO plantilla_historial (plantilla, estado, observacion, usuario_nombre) VALUES ($1, 'aprobada', 'ok', 'Dani')", ['pub-' + nombre])
}
const filas = () => dueno.query('SELECT * FROM asignacion_variantes WHERE propietario_id = $1 ORDER BY codigo', [ids.ana]).then((r) => r.rows)
const porCodigo = (d) => Object.fromEntries(d.resultados.map((r) => [r.codigo, r]))

test('actividad por nombre de categoría (sin importar mayúsculas, tildes ni espacios), sin repetir por unidad, alerta si no coincide; bibliografía por formación y sin guardarla', async () => {
  await categoria('ACT-E-03-TEC', 'actividad', 'tecnologico', 'Emparejar normas con situaciones'); await categoria('ACT-G-08', 'actividad', 'tecnologico', 'Tarea'); await categoria('ACT-E-09-PRO', 'actividad', 'profesional', 'Análisis de incidentes'); await categoria('TST-01', 'recurso'); await categoria('BIB-01', 'bibliografia')
  await variante('e03-p1', 'ACT-E-03-TEC', 'tecnologico', false)
  await variante('e03-p2', 'ACT-E-03-TEC', 'tecnologico', false)
  await variante('g08-p1', 'ACT-G-08', 'tecnologico', false)
  await variante('tst-v1', 'TST-01', 'tecnologico', null)
  await variante('bib-v1', 'BIB-01', 'tecnologico', null)
  await dueno.query("INSERT INTO pipeline_recursos (propietario_id, proyecto_id, id, codigo, estado, actualizado_en) VALUES ($1, 'curso-a', 'fila-1', 'U1-T1-R3', 'PENDIENTE', now())", [ids.ana])
  const r = await pedir([
    rec('U1-T1-R1', 'TST-01', { tipo_actividad: '  EMPAREJAR  normas con SITUACIONES ', calificable: false }),
    rec('U1-T1-R2', 'TST-01', { tipo_actividad: 'Emparejar normas con situaciones', calificable: false }),
    rec('U1-T1-R3', 'TST-01', { tipo_actividad: 'Cuestionario interactivo', calificable: false }),
    rec('U1-T1-R4', 'TST-01', { tipo_actividad: 'Simulación de caso', calificable: false }),
    rec('U1-T1-R5', 'TST-01', { tipo_actividad: 'Emparejar normas con situaciones', calificable: false }),
    rec('U1-T1-R6', 'TST-01', { tipo_actividad: 'tarea' }),
    rec('U1-PRES', 'TST-01', { tipo_actividad: 'Tarea', calificable: false })
  ])
  assert.equal(r.estado, 200)
  const p = porCodigo(r.datos)
  assert.equal(p['U1-T1-R1'].actividad.codigo, 'U1-T1-A1'); assert.equal(p['U1-T1-R1'].actividad.categoria, 'ACT-E-03-TEC'); assert.equal(p['U1-T1-R1'].actividad.resultado, 'asignada')
  assert.notEqual(p['U1-T1-R1'].actividad.plantilla, p['U1-T1-R2'].actividad.plantilla)
  assert.equal(p['U1-T1-R5'].actividad.resultado, 'asignada') // ya se usaron las dos de la unidad: se repite con aviso, como las demás actividades
  assert.equal(p['U1-T1-R5'].actividad.motivo, 'variante_repetida')
  for (const c of ['U1-T1-R3', 'U1-T1-R4']) { assert.equal(p[c].actividad.resultado, 'omitida'); assert.equal(p[c].actividad.motivo, 'tipo_actividad_sin_categoria') }
  assert.equal(p['U1-T1-R3'].actividad.tipo, 'Cuestionario interactivo')
  assert.equal(p['U1-T1-R6'].actividad.motivo, 'falta_calificable')
  assert.equal(p['U1-PRES'].actividad, undefined)
  for (const x of r.datos.resultados) assert.deepEqual(x.bibliografia, { plantilla: 'bib-v1' })
  const bd = await filas()
  const cods = bd.map((f) => f.codigo)
  assert.ok(cods.includes('U1-T1-A1') && cods.includes('U1-T1-A2') && !cods.includes('U1-T1-A3') && !cods.includes('U1-T1-A4'))
  assert.ok(!bd.some((f) => f.categoria === 'BIB-01'))
  const al = (await dueno.query("SELECT observaciones FROM pipeline_recursos WHERE id = 'fila-1'")).rows[0].observaciones
  assert.match(al, /Cuestionario interactivo.*no coincide/)
  const r2 = await pedir([rec('U2-T1-R1', 'TST-01')], { formacion: 'doctorado' })
  assert.deepEqual(r2.datos.resultados[0].bibliografia, { plantilla: null, motivo: 'sin_plantilla_bibliografia' })
  // el nombre existe, pero la categoría es de otra formación: no se asigna
  const r3 = await pedir([rec('U3-T1-R1', 'TST-01', { tipo_actividad: 'ANÁLISIS  de incidentes', calificable: false })])
  assert.equal(porCodigo(r3.datos)['U3-T1-R1'].actividad.motivo, 'tipo_actividad_sin_categoria')
})

test('plantillas.json publica las categorías con id, nombre, tipo y formaciones', async () => {
  const d = await (await fetch(base + '/plantillas-html/plantillas.json')).json()
  const c = d.categorias.find((x) => x.id === 'ACT-G-08')
  assert.equal(c.nombre, 'Tarea'); assert.equal(c.tipo, 'actividad'); assert.deepEqual(c.formaciones.map((f) => f.formacion), ['tecnologico'])
  assert.ok(d.categorias.some((x) => x.id === 'BIB-01' && x.tipo === 'bibliografia'))
})
