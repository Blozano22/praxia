// Asignación de variantes por curso (sql/005 + src/pipeline/asignaciones.js): firma, reparto entre las APROBADAS de la formación sin repetir en el curso (ni entre
// unidades), idempotencia, concurrencia, aislamiento entre personas y qué pasa con lo asignado si la plantilla se elimina, se mueve o su categoría se elimina.
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
const PUERTO_PG = 54345
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-asig-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789'
const T = { ana: crypto.randomUUID(), beto: crypto.randomUUID() }

let servidor, base, pool, dueno
const ids = {}

before(async () => {
  await servidorPg.initialise(); await servidorPg.start(); await servidorPg.createDatabase('ova')
  dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', '005_asignacion_variantes.sql'), 'utf8')) // volver a migrar no repite ni pisa nada
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.PRUEBAS_PLANTILLAS = '0' // por defecto el modo de pruebas de plantillas está encendido; estas pruebas parten de apagado
  process.env.N8N_EVENTOS_SECRETO = SECRETO
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  const { registrarOrigen } = await import('../src/pipeline/eventos.js')
  pool = db.pool
  for (const [n, c, r] of [['Ana', 'ana@u.co', 'docente'], ['Beto', 'beto@u.co', 'docente'], ['Dani', 'dani@u.co', 'disenador']]) ids[n.toLowerCase()] = (await pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), [r]])).rows[0].id
  // Dos personas con un curso del MISMO identificador; los cursos existen (la asignación es del curso)
  for (const p of ['ana', 'beto']) await dueno.query("INSERT INTO proyectos (propietario_id, id, programa, curso, datos) VALUES ($1, 'curso-a', 'Programa', 'Curso', '{}')", [ids[p]])
  await registrarOrigen({ trabajoId: T.ana, propietarioId: ids.ana, proyectoId: 'curso-a', etapa: 'preparacion' })
  await registrarOrigen({ trabajoId: T.beto, propietarioId: ids.beto, proyectoId: 'curso-a', etapa: 'preparacion' })
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

// ---- cliente como el de n8n: firma el cuerpo exacto
const firmar = (cuerpo, { fecha = Math.floor(Date.now() / 1000), secreto = SECRETO } = {}) =>
  ({ 'x-praxia-fecha': String(fecha), 'x-praxia-firma': crypto.createHmac('sha256', secreto).update(fecha + '.' + cuerpo).digest('hex') })
async function llamar(ruta, obj, opciones) {
  const cuerpo = typeof obj === 'string' ? obj : JSON.stringify(obj)
  const r = await fetch(base + '/api/n8n/asignaciones/' + ruta, { method: 'POST', headers: { 'content-type': 'application/json', ...firmar(cuerpo, opciones) }, body: cuerpo })
  let datos = null
  try { datos = await r.json() } catch { /* sin cuerpo */ }
  return { estado: r.status, datos }
}
const pedir = (recursos, extra = {}, trabajo = T.ana) => llamar('pedir', { trabajo_id: trabajo, formacion: 'tecnologico', recursos, ...extra })
const consultar = (extra = {}, trabajo = T.ana) => llamar('consultar', { trabajo_id: trabajo, ...extra })
const rec = (codigo, categoria, extra = {}) => ({ codigo, categoria, id_catalogo: categoria + '-A', id_base: categoria, ...extra })
async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const h = { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1', 'content-type': 'application/json' }
  return (m, ruta, cuerpo) => fetch(base + '/api' + ruta, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
}
// ---- catálogo de prueba (se escribe como dueño)
const categoria = (id, formaciones = ['tecnologico']) => dueno.query('INSERT INTO plantilla_categorias (id, nombre) VALUES ($1, $1)', [id]).then(() => Promise.all(formaciones.map((f) => dueno.query('INSERT INTO plantilla_categoria_formacion (categoria, formacion) VALUES ($1, $2)', [id, f]))))
const variante = async (nombre, cat, formacion, estado) => {
  await dueno.query("INSERT INTO plantilla_subidas (nombre, html_crudo, html, subida_nombre, formacion) VALUES ($1, 'x', 'x', 'prueba', $2)", [nombre, formacion])
  await dueno.query('INSERT INTO plantilla_categoria (plantilla, categoria) VALUES ($1, $2)', [nombre, cat])
  if (estado) await aprobar(nombre, estado)
}
const aprobar = (nombre, estado = 'aprobada') => dueno.query("INSERT INTO plantilla_historial (plantilla, estado, observacion, usuario_nombre) VALUES ($1, $2, 'ok', 'Dani')", ['pub-' + nombre, estado])
const filas = (persona = 'ana') => dueno.query('SELECT * FROM asignacion_variantes WHERE propietario_id = $1 ORDER BY codigo', [ids[persona]]).then((r) => r.rows)
const porCodigo = (d) => Object.fromEntries(d.resultados.map((r) => [r.codigo, r]))

test('la firma protege las dos rutas y el trabajo_id decide persona y curso', async () => {
  const cuerpo = JSON.stringify({ trabajo_id: T.ana, formacion: 'tecnologico', recursos: [rec('U1-T1-R1', 'TST-01')] })
  for (const ruta of ['pedir', 'consultar']) {
    const sin = await fetch(base + '/api/n8n/asignaciones/' + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpo })
    assert.equal(sin.status, 401)
    assert.equal((await llamar(ruta, cuerpo, { secreto: 'otro-secreto-cualquiera-0123456789abcdef' })).estado, 401)
    assert.equal((await llamar(ruta, cuerpo, { fecha: Math.floor(Date.now() / 1000) - 11 * 60 })).estado, 401)
  }
  assert.equal((await pedir([rec('U1-T1-R1', 'TST-01')], {}, crypto.randomUUID())).datos.error, 'trabajo_desconocido')
  assert.equal((await consultar({}, crypto.randomUUID())).estado, 404)
  assert.equal((await llamar('pedir', 'no es json')).estado, 400)
  assert.equal((await pedir([rec('U1-T1-R1', 'TST-01'), rec('U1-T1-R1', 'TST-01')])).estado, 400) // código repetido en el mismo pedido
  assert.equal((await pedir([rec('R1', 'TST-01')])).estado, 400) // no es un código de posición
  assert.equal((await pedir([rec('U1-T1-R1', 'tst')])).estado, 400)
  assert.equal((await pedir([rec('U1-T1-R1', 'TST-01')], { formacion: 'otra' })).estado, 400)
  assert.equal((await filas()).length, 0) // nada de lo rechazado quedó guardado
})

test('reparte solo entre las aprobadas de la formación, sin repetir dentro de cada UNIDAD (la misma variante sí puede estar en otra unidad); lo asignado no cambia al volver a pedir', async () => {
  await categoria('TST-01')
  await categoria('TST-02') // existe, pero ningún recurso tiene aún asignada una variante de ella
  await variante('tst-01-v01', 'TST-01', 'tecnologico', 'aprobada')
  await variante('tst-01-v02', 'TST-01', 'tecnologico', 'aprobada')
  await variante('tst-01-v03', 'TST-01', 'tecnologico', 'revision') // aún no aprobada
  await variante('tst-01-v04', 'TST-01', 'doctorado', 'aprobada') // aprobada, pero de otra formación
  const pedido = [rec('U1-T1-R1', 'TST-01'), rec('U1-T1-R2', 'TST-01'), rec('U1-T1-R3', 'TST-01'), rec('U2-T1-R1', 'TST-01', { unidad: 2 })]
  const r = await pedir(pedido)
  assert.equal(r.estado, 200)
  const p = porCodigo(r.datos)
  assert.equal(p['U1-T1-R1'].resultado, 'asignada'); assert.equal(p['U1-T1-R1'].plantilla, 'tst-01-v01')
  assert.equal(p['U1-T1-R2'].plantilla, 'tst-01-v02')
  // en la unidad 1 hay más recursos que variantes elegibles: «sin variante» se dice, no se inventa ni se repite
  assert.equal(p['U1-T1-R3'].resultado, 'pendiente'); assert.equal(p['U1-T1-R3'].plantilla, null); assert.equal(p['U1-T1-R3'].motivo, 'variantes_agotadas')
  // la unidad 2 reparte desde cero: la misma variante que usa la unidad 1 está libre en ella
  assert.equal(p['U2-T1-R1'].resultado, 'asignada'); assert.equal(p['U2-T1-R1'].plantilla, 'tst-01-v01')
  assert.deepEqual(r.datos.resumen, { asignadas: 3, ya_asignadas: 0, pendientes: 1, conflictos: 0, errores: 0 })
  const bd = Object.fromEntries((await filas()).map((f) => [f.codigo, f]))
  assert.equal(bd['U1-T1-R3'].estado, 'pendiente'); assert.equal(bd['U1-T1-R3'].unidad, 1); assert.equal(bd['U2-T1-R1'].unidad, 2); assert.equal(bd['U1-T1-R1'].id_catalogo, 'TST-01-A') // el id de catálogo se repite entre recursos: no es clave
  // volver a pedir lo mismo no cambia nada de lo asignado
  const r2 = await pedir(pedido)
  const p2 = porCodigo(r2.datos)
  assert.equal(p2['U1-T1-R1'].resultado, 'ya_asignada'); assert.equal(p2['U1-T1-R1'].plantilla, 'tst-01-v01'); assert.equal(p2['U1-T1-R2'].resultado, 'ya_asignada')
  assert.equal(p2['U1-T1-R3'].resultado, 'pendiente'); assert.equal(p2['U2-T1-R1'].resultado, 'ya_asignada')
  // al aprobarse otra variante, lo pendiente se resuelve en la siguiente petición y lo ya asignado sigue igual
  await aprobar('tst-01-v03')
  const p3 = porCodigo((await pedir(pedido)).datos)
  assert.equal(p3['U1-T1-R3'].resultado, 'asignada'); assert.equal(p3['U1-T1-R3'].plantilla, 'tst-01-v03'); assert.equal(p3['U2-T1-R1'].plantilla, 'tst-01-v01')
  assert.equal(p3['U1-T1-R1'].plantilla, 'tst-01-v01'); assert.equal(p3['U1-T1-R2'].plantilla, 'tst-01-v02')
  // el mismo código no puede pasar a otra categoría sin orden explícita
  const c = porCodigo((await pedir([rec('U1-T1-R1', 'TST-02')])).datos)
  assert.equal(c['U1-T1-R1'].resultado, 'conflicto'); assert.equal(c['U1-T1-R1'].motivo, 'ya_asignada_en_otra_categoria')
})

test('motivos claros cuando no hay variante: categoría inexistente, de otra formación, sin aprobadas; solo_aprobadas:false las deja pasar', async () => {
  await categoria('TST-03')
  await variante('tst-03-v01', 'TST-03', 'tecnologico', 'revision')
  const r = porCodigo((await pedir([rec('U1-T2-R1', 'TST-99'), rec('U1-T2-R2', 'TST-01', {}), rec('U1-T2-R3', 'TST-03')], { formacion: 'doctorado' })).datos)
  assert.equal(r['U1-T2-R1'].resultado, 'error'); assert.equal(r['U1-T2-R1'].motivo, 'categoria_inexistente')
  assert.equal(r['U1-T2-R2'].motivo, 'categoria_no_es_de_la_formacion') // TST-01 solo sirve a tecnologico
  assert.equal(r['U1-T2-R3'].motivo, 'categoria_no_es_de_la_formacion')
  const s = porCodigo((await pedir([rec('U1-T2-R3', 'TST-03')])).datos)
  assert.equal(s['U1-T2-R3'].motivo, 'sin_variantes_aprobadas')
  const l = porCodigo((await pedir([rec('U1-T2-R3', 'TST-03')], { solo_aprobadas: false })).datos)
  assert.equal(l['U1-T2-R3'].resultado, 'asignada'); assert.equal(l['U1-T2-R3'].plantilla, 'tst-03-v01')
  await categoria('TST-04'); // categoría sin ninguna variante
  assert.equal(porCodigo((await pedir([rec('U1-T2-R4', 'TST-04')])).datos)['U1-T2-R4'].motivo, 'categoria_sin_variantes')
})

test('unidades pedidas a la vez: la base garantiza que ninguna variante se repite DENTRO DE UNA UNIDAD', async () => {
  await categoria('TST-05')
  for (const n of [1, 2, 3, 4, 5, 6]) await variante('tst-05-v0' + n, 'TST-05', 'tecnologico', 'aprobada')
  const unidad = (u) => [1, 2, 3].map((k) => rec('U' + u + '-T3-R' + k, 'TST-05', { unidad: u }))
  const todas = await Promise.all([3, 4, 5, 6].map((u) => pedir(unidad(u))))
  assert.ok(todas.every((x) => x.estado === 200))
  const asignadas = (await filas()).filter((f) => f.categoria === 'TST-05' && f.plantilla)
  assert.equal(asignadas.length, 12) // 4 unidades × 3 recursos: cada unidad tiene variantes de sobra (6) y todas se asignan
  for (const u of [3, 4, 5, 6]) {
    const deLaUnidad = asignadas.filter((f) => f.unidad === u).map((f) => f.plantilla)
    assert.equal(deLaUnidad.length, 3); assert.equal(new Set(deLaUnidad).size, 3) // sin repetir dentro de la unidad
  }
  assert.equal((await filas()).filter((f) => f.categoria === 'TST-05' && f.estado === 'pendiente').length, 0)
  // la regla está en la base y no solo en el servidor: repetir una variante EN LA MISMA UNIDAD falla; en otra unidad, no
  const f0 = asignadas[0]
  const insertar = (codigo, unidad) => pool.query("INSERT INTO asignacion_variantes (propietario_id, proyecto_id, codigo, unidad, categoria, formacion, plantilla, estado) VALUES ($1, 'curso-a', $2, $3, 'TST-05', 'tecnologico', $4, 'asignada')", [ids.ana, codigo, unidad, f0.plantilla])
  await assert.rejects(insertar('U' + f0.unidad + '-T9-R1', f0.unidad), (e) => e.code === '23505')
  await insertar('U9-T9-R1', 9)
})

test('cada persona tiene lo suyo: el mismo identificador de curso en otra persona es otro curso; consultar por curso, unidad o códigos', async () => {
  const b = porCodigo((await pedir([rec('U1-T1-R1', 'TST-01')], {}, T.beto)).datos)
  assert.equal(b['U1-T1-R1'].plantilla, 'tst-01-v01') // la de Ana no le quita nada a Beto
  assert.equal((await filas('beto')).length, 1)
  const todas = (await consultar()).datos.asignaciones
  assert.ok(todas.every((a) => a.codigo.startsWith('U')) && todas.length === (await filas()).length)
  assert.deepEqual((await consultar({ unidad: 2 })).datos.asignaciones.map((a) => a.codigo), ['U2-T1-R1'])
  const dos = (await consultar({ codigos: ['U1-T1-R1', 'U1-T1-R2'] })).datos.asignaciones
  assert.deepEqual(dos.map((a) => [a.codigo, a.plantilla, a.estado]), [['U1-T1-R1', 'tst-01-v01', 'asignada'], ['U1-T1-R2', 'tst-01-v02', 'asignada']])
  assert.equal((await consultar({ codigos: ['U7-T1-R1'] })).datos.asignaciones.length, 0)
})

test('forzar recalcula desde cero lo pedido; sin forzar nada cambia', async () => {
  await aprobar('tst-03-v01') // ahora sí está aprobada
  const antes = (await filas()).find((f) => f.codigo === 'U1-T2-R3')
  assert.equal(antes.plantilla, 'tst-03-v01')
  const sin = porCodigo((await pedir([rec('U1-T2-R3', 'TST-03')])).datos)
  assert.equal(sin['U1-T2-R3'].resultado, 'ya_asignada')
  await dueno.query("INSERT INTO plantilla_historial (plantilla, estado, observacion, usuario_nombre) VALUES ('pub-tst-03-v01', 'rechazada', 'no', 'Dani')") // se rechaza después de asignarla
  assert.equal(porCodigo((await pedir([rec('U1-T2-R3', 'TST-03')])).datos)['U1-T2-R3'].resultado, 'ya_asignada') // lo ya asignado no se toca solo
  const f = porCodigo((await pedir([rec('U1-T2-R3', 'TST-03')], { forzar: true })).datos)
  assert.equal(f['U1-T2-R3'].resultado, 'pendiente'); assert.equal(f['U1-T2-R3'].motivo, 'sin_variantes_aprobadas') // forzar vuelve a elegir con las reglas de ahora
  assert.equal((await filas()).find((x) => x.codigo === 'U1-T2-R3').plantilla_anterior, 'tst-03-v01')
})

test('si la plantilla asignada se elimina, se mueve o su categoría se elimina, la asignación queda inválida y se puede volver a asignar', async () => {
  const dani = await entrar('dani@u.co')
  await variante('tst-01-v05', 'TST-01', 'tecnologico', 'aprobada')
  // eliminar
  assert.equal((await dani('DELETE', '/plantillas/subidas/tst-01-v01')).status, 200)
  const e = (await filas()).find((f) => f.codigo === 'U1-T1-R1')
  assert.equal(e.estado, 'invalida'); assert.equal(e.plantilla, null); assert.equal(e.plantilla_anterior, 'tst-01-v01'); assert.equal(e.motivo, 'plantilla_eliminada')
  assert.equal((await filas('beto'))[0].estado, 'invalida') // la de otra persona con esa misma plantilla también
  // lo inválido no se reasigna solo: al volver a pedir se le da otra variante libre del curso
  const r = porCodigo((await pedir([rec('U1-T1-R1', 'TST-01')])).datos)
  assert.equal(r['U1-T1-R1'].resultado, 'asignada'); assert.equal(r['U1-T1-R1'].plantilla, 'tst-01-v05')
  // mover a otra categoría: cambia de nombre y de categoría, así que ya no sirve para lo asignado
  const mov =await dani('POST', '/plantillas/subidas/tst-01-v02/mover', { categoria: 'TST-02', formacion: 'tecnologico' })
  assert.equal(mov.status, 200)
  const nuevo = (await mov.json()).nombre
  const m = (await filas()).find((f) => f.codigo === 'U1-T1-R2')
  assert.equal(m.estado, 'invalida'); assert.equal(m.plantilla_anterior, 'tst-01-v02'); assert.equal(m.motivo, 'plantilla_movida_a_' + nuevo)
  // eliminar la categoría: lo asignado con sus plantillas queda inválido
  assert.equal((await filas()).find((f) => f.codigo === 'U1-T2-R3').estado, 'pendiente')
  await aprobar('tst-03-v01') // vuelve a estar aprobada
  assert.equal(porCodigo((await pedir([rec('U1-T2-R3', 'TST-03')])).datos)['U1-T2-R3'].plantilla, 'tst-03-v01')
  assert.equal((await dani('DELETE', '/plantillas/categorias/TST-03')).status, 200)
  const c = (await filas()).find((f) => f.codigo === 'U1-T2-R3')
  assert.equal(c.estado, 'invalida'); assert.equal(c.motivo, 'categoria_eliminada')
  // ninguna fila «asignada» apunta a una plantilla que ya no existe
  const colgadas = await dueno.query("SELECT a.codigo FROM asignacion_variantes a WHERE a.plantilla IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plantilla_subidas s WHERE s.nombre = a.plantilla)")
  assert.equal(colgadas.rowCount, 0)
})

test('una variante sin formación (subida antigua) solo se reparte si su categoría sirve a una sola formación; en una compartida no se sabe de cuál es', async () => {
  await categoria('TST-07', ['tecnologico', 'profesional']) // categoría compartida
  await variante('tst-07-v01', 'TST-07', null, 'aprobada') // sin formación
  await variante('tst-07-v02', 'TST-07', 'tecnologico', 'aprobada')
  const c = porCodigo((await pedir([rec('U3-T1-R1', 'TST-07'), rec('U3-T1-R2', 'TST-07')])).datos)
  assert.equal(c['U3-T1-R1'].plantilla, 'tst-07-v02') // la que sí dice su formación
  assert.equal(c['U3-T1-R2'].resultado, 'pendiente') // la otra no se usa: podría ser de profesional
  await categoria('TST-08', ['tecnologico']) // categoría de una sola formación
  await variante('tst-08-v01', 'TST-08', null, 'aprobada')
  assert.equal(porCodigo((await pedir([rec('U3-T2-R1', 'TST-08')])).datos)['U3-T2-R1'].plantilla, 'tst-08-v01')
})

test('las categorías de bibliografía no se reparten a ningún recurso', async () => {
  await dueno.query("INSERT INTO plantilla_categorias (id, nombre, tipo) VALUES ('TSB-01', 'Bibliografía', 'bibliografia')")
  await dueno.query("INSERT INTO plantilla_categoria_formacion (categoria, formacion) VALUES ('TSB-01', 'tecnologico')")
  await variante('tsb-01-v01', 'TSB-01', 'tecnologico', 'aprobada')
  const r = porCodigo((await pedir([rec('U1-T1-R9', 'TSB-01')])).datos)
  assert.equal(r['U1-T1-R9'].resultado, 'error'); assert.equal(r['U1-T1-R9'].motivo, 'categoria_de_bibliografia'); assert.equal(r['U1-T1-R9'].plantilla, null)
  assert.equal((await filas()).filter((f) => f.categoria === 'TSB-01').length, 0)
})

test('si se despliega el código antes de migrar (la tabla no existe), eliminar y mover plantillas siguen funcionando', async () => {
  const dani = await entrar('dani@u.co')
  await categoria('TST-09'); await variante('tst-09-v01', 'TST-09', 'tecnologico', 'aprobada'); await variante('tst-09-v02', 'TST-09', 'tecnologico', 'aprobada')
  await dueno.query('DROP TABLE asignacion_variantes')
  assert.equal((await dani('DELETE', '/plantillas/subidas/tst-09-v01')).status, 200)
  assert.equal((await dani('POST', '/plantillas/subidas/tst-09-v02/mover', { categoria: 'TST-02', formacion: 'tecnologico' })).status, 200)
  assert.equal((await dani('DELETE', '/plantillas/categorias/TST-09')).status, 200)
})
