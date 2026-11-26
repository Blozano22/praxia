// Enviar a diseño: validación de aprobaciones, estado del curso y bloqueo de escritura del docente (solo lectura en diseño; en revisión solo guiones).
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
const PUERTO_PG = 55100
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-dis-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
let servidor, base, pool

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const duenio = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await duenio.connect()
  await duenio.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql']) await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', '024_curso_diseno.sql'), 'utf8')) // idempotente
  await duenio.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  await pool.query(Q.usuarioCrear, ['Ana', 'ana@u.co', await hashClave(CLAVE), ['docente']])
  await pool.query(Q.usuarioCrear, ['Bea', 'bea@u.co', await hashClave(CLAVE), ['docente']])
  await pool.query(Q.usuarioCrear, ['Admin', 'admin@u.co', await hashClave(CLAVE), ['docente', 'admin']])
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
  return (metodo, ruta, cuerpo) => fetch(base + '/api' + ruta, {
    method: metodo,
    headers: { cookie, 'x-ova': '1', ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
  })
}
const doc = (u, aprobado = true) => ({ unidad: u, nombre: 'U' + u, url: 'https://docs.google.com/document/d/abc' + u, aprobado })
const guion = (aprobado) => ({ fecha: 1, archivos: [{ nombre: 'g.docx', aprobado }] })
const proyecto = (extra = {}) => ({ id: 'curso-1', programa: 'Licenciatura', curso: 'Didáctica', creado: 1, syllabus: { estado: 'listo', documentos: [doc(1), doc(2)] }, guionesUnidad: { 1: guion(true), 2: guion(true) }, ...extra })
const GUIONES = '/../api/guiones/trabajos' // la ayuda de arriba antepone /api: esto llega a /api/guiones/trabajos
const pedidoGuion = { proyecto: 'curso-1', unidad: 1, unidadUrl: 'https://docs.google.com/document/d/abc1', bibliografiaId: crypto.randomUUID() }

test('enviar a diseño: sin aprobar todo responde 409 con el detalle y no crea estado', async () => {
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('PUT', '/proyectos/curso-1', proyecto({ syllabus: { estado: 'listo', documentos: [doc(1), doc(2, false)] }, guionesUnidad: { 1: guion(true), 2: guion(false) } }))).status, 200)
  let r = await ana('POST', '/proyectos/curso-1/enviar-diseno', {})
  assert.equal(r.status, 409)
  const d = await r.json()
  assert.match(d.error, /Unidades sin aprobar: 2/)
  assert.match(d.error, /guiones sin aprobar: 2/)
  assert.deepEqual(d.unidadesSinAprobar, [2])
  assert.equal((await (await ana('GET', '/proyectos/curso-1/diseno')).json()).estado, null)
  // unidad sin guiones generados
  const v = (await (await ana('GET', '/proyectos')).json())[0]._v
  await ana('PUT', '/proyectos/curso-1', proyecto({ _v: v, guionesUnidad: { 1: guion(true) } }))
  r = await ana('POST', '/proyectos/curso-1/enviar-diseno', {})
  assert.equal(r.status, 409)
  assert.match((await r.json()).error, /sin guiones generados: 2/)
})

test('enviar a diseño: con todo aprobado crea en_diseno; el segundo envío es 409; otro usuario no puede', async () => {
  const ana = await entrar('ana@u.co'); const bea = await entrar('bea@u.co')
  const v = (await (await ana('GET', '/proyectos')).json())[0]._v
  assert.equal((await ana('PUT', '/proyectos/curso-1', proyecto({ _v: v }))).status, 200)
  assert.equal((await bea('POST', '/proyectos/curso-1/enviar-diseno', {})).status, 404) // el curso es de Ana: para Bea no existe
  const ok = await ana('POST', '/proyectos/curso-1/enviar-diseno', {})
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).estado, 'en_diseno')
  const otra = await ana('POST', '/proyectos/curso-1/enviar-diseno', {})
  assert.equal(otra.status, 409)
  assert.match((await otra.json()).error, /ya fue enviado/)
  const e = await (await ana('GET', '/proyectos/curso-1/diseno')).json()
  assert.equal(e.estado, 'en_diseno')
  assert.ok(e.enviado_en)
  assert.deepEqual((await (await ana('GET', '/diseno')).json()).map((x) => x.estado), ['en_diseno'])
  assert.equal((await (await bea('GET', '/diseno')).json()).length, 0)
})

test('en_diseno y asignado: el docente no guarda ni usa guiones ni pipeline; leer sí', async () => {
  const ana = await entrar('ana@u.co')
  for (const estado of ['en_diseno', 'asignado']) {
    await pool.query("UPDATE curso_diseno SET estado = $1 WHERE proyecto_id = 'curso-1'", [estado])
    const put = await ana('PUT', '/proyectos/curso-1', proyecto({ curso: 'Cambio' }))
    assert.equal(put.status, 409)
    assert.match((await put.json()).error, /solo lectura/)
    for (const [m, ruta, cuerpo] of [['POST', '/proyectos/curso-1/pipeline/matrices', {}], ['POST', '/proyectos/curso-1/pipeline/h5p', {}], ['POST', '/proyectos/curso-1/pipeline/recursos/x/aprobar', {}], ['POST', '/proyectos/curso-1/pipeline/recursos/x/h5p', {}],
      ['PUT', '/proyectos/curso-1/pipeline/recursos/x/contenido', { contenido: {} }], ['PUT', '/proyectos/curso-1/pipeline/recursos/imagen', { recursoId: 'x', imagenUrl: '' }]]) assert.equal((await ana(m, ruta, cuerpo)).status, 409, m + ' ' + ruta)
    const g = await ana('POST', GUIONES, pedidoGuion)
    assert.equal(g.status, 409)
    assert.equal((await g.json()).bloqueado, true)
    assert.equal((await ana('GET', '/proyectos/curso-1/pipeline')).status, 200)
    assert.equal((await ana('GET', '/proyectos')).status, 200)
  }
})

test('en_revision_docente: guarda el curso y lanza guiones, pero no matrices ni H5P', async () => {
  const ana = await entrar('ana@u.co')
  await pool.query("UPDATE curso_diseno SET estado = 'en_revision_docente' WHERE proyecto_id = 'curso-1'")
  const v = (await (await ana('GET', '/proyectos')).json())[0]._v
  assert.equal((await ana('PUT', '/proyectos/curso-1', proyecto({ _v: v, curso: 'Corregido' }))).status, 200)
  for (const ruta of ['/proyectos/curso-1/pipeline/matrices', '/proyectos/curso-1/pipeline/h5p']) assert.equal((await ana('POST', ruta, {})).status, 409, ruta)
  const g = await ana('POST', GUIONES, pedidoGuion)
  assert.ok(!(await g.json()).bloqueado) // pasa el bloqueo (después falla por otra causa: no hay bibliografía)
})

test('un administrador no se bloquea aunque su curso esté en diseño', async () => {
  const adm = await entrar('admin@u.co')
  assert.equal((await adm('PUT', '/proyectos/curso-a', { ...proyecto(), id: 'curso-a' })).status, 200)
  assert.equal((await adm('POST', '/proyectos/curso-a/enviar-diseno', {})).status, 200)
  assert.equal((await adm('PUT', '/proyectos/curso-a', { ...proyecto(), id: 'curso-a', curso: 'Soporte' })).status, 200)
  const m = await adm('POST', '/proyectos/curso-a/pipeline/matrices', {})
  assert.ok(!((await m.json()).bloqueado))
})
