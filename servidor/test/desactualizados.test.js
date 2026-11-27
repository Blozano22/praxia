// «Recursos desactualizados» de GET /api/proyectos/:id/pipeline: generados sin actividad cuya unidad ya tiene actividad asignada,
// o cuya matriz se reemplazó después de generarlos y no traen actividad ni bibliografía.
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
const PUERTO_PG = 54700
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-desact-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
let servidor, base, pool, dueno, idAna

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql', '025_asignar_diseno.sql', '026_correcciones.sql', '027_cola_regenerar.sql', '028_cola_partes.sql', '029_permiso_h5p.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  idAna = (await pool.query(Q.usuarioCrear, ['Ana', 'ana@u.co', await hashClave(CLAVE), ['docente', 'admin']])).rows[0].id
  await dueno.query("INSERT INTO proyectos (propietario_id, id, programa, curso, datos) VALUES ($1, 'curso-a', 'P', 'C', '{}')", [idAna])
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

const rec = (codigo, unidad, estado, extra = {}) => dueno.query(
  `INSERT INTO pipeline_recursos (propietario_id, proyecto_id, id, unidad, tema, codigo, generador, estado, plantilla, contenido, actividad, bibliografia, consumo, actualizado_en)
   VALUES ($1,'curso-a',$2,$3,1,$2,'H5P',$4,'g-01-v01',$5,$6,$7,$8, now() - interval '1 hour')`,
  [idAna, codigo, unidad, estado, extra.sinContenido ? null : '{"a":1}', extra.actividad ? '{"x":1}' : null, extra.bib ? '{"y":1}' : null, extra.costo != null ? JSON.stringify({ costo_estimado_usd: extra.costo }) : null])

async function leer() {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo: 'ana@u.co', clave: CLAVE }) })
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  return (await fetch(base + '/api/proyectos/curso-a/pipeline', { headers: { cookie, 'x-ova': '1' } })).json()
}

test('sin actividades asignadas ni matriz reemplazada: total 0', async () => {
  await rec('U1-T1-R1', 1, 'GENERADO', { costo: 0.1 })
  await rec('U1-T1-R2', 1, 'POR_REVISAR')
  const d = (await leer()).desactualizados
  assert.deepEqual([d.total, d.codigos], [0, []])
})

test('actividad asignada (A3 ↔ R3) y matriz reemplazada después de generar: cuentan solo los generados/por revisar con contenido y sin la parte', async () => {
  await rec('U1-T1-R3', 1, 'GENERADO', { costo: 0.2 })      // tiene A3 asignada -> cuenta
  await rec('U1-T1-R4', 1, 'PENDIENTE')                      // no cuenta
  await rec('U1-T1-R5', 1, 'ERROR')                          // no cuenta
  await rec('U1-T1-R6', 1, 'GENERADO', { sinContenido: true }) // sin contenido, no cuenta
  await rec('U1-T1-R7', 1, 'GENERADO', { actividad: true })  // ya la lleva
  await rec('U1-PRES', 1, 'GENERADO')                        // presentación sin actividad: no cuenta
  await rec('U2-T1-R1', 2, 'POR_REVISAR')                    // matriz U2 reemplazada -> cuenta
  await rec('U2-T1-R2', 2, 'GENERADO', { bib: true })        // trae bibliografía, no cuenta
  await dueno.query("INSERT INTO asignacion_variantes (propietario_id, proyecto_id, codigo, unidad, categoria, formacion, plantilla, estado, asignada_en) VALUES ($1,'curso-a','U1-T1-A3',1,'G-12','tecnologico','g-12-tec-v01','asignada', now())", [idAna])
  await dueno.query("INSERT INTO asignacion_variantes (propietario_id, proyecto_id, codigo, unidad, categoria, formacion, estado, motivo) VALUES ($1,'curso-a','U1-T1-A7',1,'G-12','tecnologico','pendiente','sin variante')", [idAna])
  await dueno.query("INSERT INTO pipeline_matrices (propietario_id, proyecto_id, unidad, estado, actualizado_en) VALUES ($1,'curso-a',2,'reemplazada', now())", [idAna])
  const d = (await leer()).desactualizados
  assert.deepEqual(d.codigos.sort(), ['U1-T1-R3', 'U2-T1-R1'])
  assert.equal(d.total, 2)
  assert.equal(d.motivos['U1-T1-R3'], 'actividad_asignada'); assert.equal(d.motivos['U2-T1-R1'], 'matriz_actualizada')
  assert.equal(d.sinCosto, 1); assert.equal(d.costoEstimadoUsd, 0.4) // 0.2 guardado + promedio (0.2) por el que no trae costo
})
