// Descarga masiva de las plantillas subidas: ZIP con carpetas por tipo/categoría/formación, cada archivo igual al original y un indice.csv.
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
const PUERTO_PG = 54371
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-zip-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
let servidor, base, pool, leerZip
const HTML_A = '<!doctype html>\n<html><body><h1>Año ñandú — original A</h1>' + '<p>relleno repetido</p>'.repeat(200) + '</body></html>\r\n'
const HTML_B = '<html><body>B con "comillas" y bytes: éè</body></html>'
const RA = 'Recursos/ZZ-01 Lectura/tecnologico/zz-01-tec-v1.html'
const RB = 'Actividades/ZZ-02 Qué_Cómo_ _taller__/zz-02-c-v1.html'

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql', '025_asignar_diseno.sql', '026_correcciones.sql', '027_cola_regenerar.sql', '028_cola_partes.sql', '029_permiso_h5p.sql', '030_plantilla_reemplazada.sql', '031_disenador_sin_categorias.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  // Dos categorías (recurso con dos formaciones, y actividad con un nombre de caracteres prohibidos) con una plantilla subida cada una.
  await dueno.query("INSERT INTO plantilla_categorias (id, nombre, tipo) VALUES ('ZZ-01', 'Lectura', 'recurso'), ('ZZ-02', 'Qué/Cómo: <taller>?', 'actividad')")
  await dueno.query("INSERT INTO plantilla_categoria_formacion (categoria, formacion, prioridad) VALUES ('ZZ-01', 'tecnologico', 'P'), ('ZZ-01', 'profesional', 'P')")
  await dueno.query("INSERT INTO plantilla_subidas (nombre, html_crudo, html, subida_nombre, formacion) VALUES ('zz-01-tec-v1', $1, 'x', 'Dani', 'tecnologico')", [HTML_A])
  await dueno.query("INSERT INTO plantilla_subidas (nombre, html_crudo, html, subida_nombre, calificable) VALUES ('zz-02-c-v1', $1, 'x', 'Dani', true)", [HTML_B])
  await dueno.query("INSERT INTO plantilla_categoria (plantilla, categoria) VALUES ('zz-01-tec-v1', 'ZZ-01'), ('zz-02-c-v1', 'ZZ-02')")
  await dueno.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  leerZip = (await import('../src/plantillas/zip.js')).leerZip
  pool = db.pool
  for (const [nombre, correo, rol] of [['Dani', 'dani@u.co', 'disenador'], ['Ana', 'ana@u.co', 'docente']]) await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), [rol]])
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
  return (ruta) => fetch(base + '/api' + ruta, { headers: { cookie, 'x-ova': '1' } })
}
const RUTA = '/plantillas/subidas/descarga-masiva.zip'
const zip = async (c, ruta) => leerZip(Buffer.from(await (await c(ruta)).arrayBuffer()))

test('sin sesión 401 y sin permiso 403', async () => {
  assert.equal((await fetch(base + '/api' + RUTA, { headers: { 'x-ova': '1' } })).status, 401)
  assert.equal((await (await entrar('ana@u.co'))(RUTA)).status, 403)
})

test('el ZIP trae carpetas por tipo/categoría/formación, los originales byte a byte y el índice', async () => {
  const r = await (await entrar('dani@u.co'))(RUTA)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/zip')
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="plantillas-praxia-\d{4}-\d{2}-\d{2}\.zip"$/)
  const z = leerZip(Buffer.from(await r.arrayBuffer()))
  assert.deepEqual(Object.keys(z).sort(), [RB, RA, 'indice.csv'].sort())
  assert.ok(z[RA].equals(Buffer.from(HTML_A, 'utf8')))
  assert.ok(z[RB].equals(Buffer.from(HTML_B, 'utf8')))
  const csv = z['indice.csv']
  assert.deepEqual([...csv.subarray(0, 3)], [0xEF, 0xBB, 0xBF])
  const lineas = csv.toString('utf8').slice(1).trim().split('\r\n')
  assert.equal(lineas[0], 'nombre;categoria;nombre_categoria;tipo;formacion;estado;calificable')
  assert.ok(lineas.includes('zz-01-tec-v1;ZZ-01;Lectura;recurso;tecnologico;revision;'))
  assert.ok(lineas.includes('zz-02-c-v1;ZZ-02;Qué/Cómo: <taller>?;actividad;;revision;si'))
})

test('el filtro por tipo y por categoría deja solo lo pedido; un filtro inválido da 400', async () => {
  const dani = await entrar('dani@u.co')
  assert.deepEqual(Object.keys(await zip(dani, RUTA + '?tipo=actividad')).sort(), [RB, 'indice.csv'].sort())
  assert.deepEqual(Object.keys(await zip(dani, RUTA + '?categoria=ZZ-01')).sort(), [RA, 'indice.csv'].sort())
  assert.deepEqual(Object.keys(await zip(dani, RUTA + '?tipo=bibliografia')), ['indice.csv'])
  assert.equal((await dani(RUTA + '?tipo=otro')).status, 400)
})
