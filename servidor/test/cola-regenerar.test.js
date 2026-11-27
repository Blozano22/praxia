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
const PUERTO_PG = 59401
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-cola-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789'
const CARPETA = 'https://drive.google.com/drive/folders/carpetaMatrices1'

let servidor, base, pool, n8n, config
const recibidas = []
const urlsRecibidas = [] // ruta de cada orden recibida (paralela a «recibidas»)
let respuestaN8n = { estado: 200, cuerpo: { ok: true } }
const ids = {}

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql', '025_asignar_diseno.sql', '026_correcciones.sql', '027_cola_regenerar.sql', '028_cola_partes.sql', '029_permiso_h5p.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await dueno.end()
  n8n = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => {
      recibidas.push(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); urlsRecibidas.push(req.url)
      res.writeHead(respuestaN8n.estado, { 'content-type': 'application/json' })
      res.end(JSON.stringify(respuestaN8n.cuerpo))
    })
  }).listen(0)
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.PRUEBAS_PLANTILLAS = '0' // por defecto el modo de pruebas de plantillas está encendido; estas pruebas parten de apagado
  process.env.N8N_EVENTOS_SECRETO = SECRETO
  process.env.LIMITE_LANZAR_PIPELINE = '500'
  process.env.N8N_MATRICES_URL = 'http://127.0.0.1:' + n8n.address().port + '/webhook/matrices'
  process.env.N8N_PREPARACION_URL = 'http://127.0.0.1:' + n8n.address().port + '/webhook/preparacion'
  process.env.N8N_H5P_URL = 'http://127.0.0.1:' + n8n.address().port + '/webhook/h5p'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  config = (await import('../src/config.js')).config
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [nombre, correo, rol] of [['Ana', 'ana@u.co', 'docente,admin'], ['Beto', 'beto@u.co', 'docente'], ['Admin', 'admin@u.co', 'admin']]) ids[nombre.toLowerCase()] = (await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), rol.split(',')])).rows[0].id
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
  recursos: [], guiones: [], info: { nivel: 'Profesional' },
  guionesUnidad: Object.fromEntries([1, 2].map((u) => [u, { fecha: 1, archivos: [
    { nombre: 'Guion tema 2', tema: 2, url: 'https://docs.google.com/document/d/u' + u + 'g2abcdefghij', info: { nivel: 'Tecnológico' }, guion: { largo: 'x'.repeat(50) } },
    { nombre: 'Guion tema 1', tema: 1, url: 'https://docs.google.com/document/d/u' + u + 'g1abcdefghij', info: {} },
    { nombre: 'Sin enlace', tema: 3, url: '' }
  ] }]))
})
const firmado = async (obj) => {
  const cuerpo = JSON.stringify(obj)
  const fecha = String(Math.floor(Date.now() / 1000))
  const firma = crypto.createHmac('sha256', SECRETO).update(fecha + '.' + cuerpo).digest('hex')
  return fetch(base + '/api/n8n/eventos', { method: 'POST', headers: { 'content-type': 'application/json', 'x-praxia-fecha': fecha, 'x-praxia-firma': firma }, body: cuerpo })
}

const f = (s) => new Date(Date.now() - 600 * 1000 + s * 1000).toISOString()
let sec = 0
// Prepara un curso con matriz lista y N recursos GENERADOS con plantilla; devuelve el trabajo de la corrida inicial.
async function prepararCurso(ana, id, n) {
  assert.equal((await ana('PUT', '/proyectos/' + id, curso(id))).status, 200)
  const tm = (await (await ana('POST', '/proyectos/' + id + '/pipeline/matrices', { unidades: [1] })).json()).trabajo_id
  assert.equal((await firmado({ evento_id: id + '-m-fin', evento: 'matrices_fin', etapa: 'matrices', proyecto_id: id, ejecucion_id: 'ej-' + id + '-m', trabajo_id: tm, origen_trabajo_id: tm, secuencia: 1, fecha_evento: f(1),
    resultados: [{ unidad: 1, formacion: 'Tecnológico', resultado: 'creada', matriz: { id: 'M' + id, url: 'https://docs.google.com/spreadsheets/d/m1abcdefgh/edit', nombre: 'M' }, filas: [] }] })).status, 200)
  const t = (await (await ana('POST', '/proyectos/' + id + '/pipeline/h5p', {})).json()).trabajo_id
  for (let i = 1; i <= n; i++) {
    sec++
    assert.equal((await firmado({ evento_id: id + '-r-' + i, evento: 'h5p_recurso', etapa: 'h5p', trabajo_id: t, proyecto_id: id, ejecucion_id: 'ej-' + id, secuencia: sec, fecha_evento: f(sec), unidad: 1, id: 'r' + i, codigo: 'U1-T1-R' + i,
      estado: 'GENERADO', plantilla: 'quiz', enlace_recurso: 'https://drive.google.com/file/d/arch' + i + 'abcdef/view', contenido: { v: i } })).status, 200)
  }
  return t
}
const fin = (id, t, n, eje) => firmado({ evento_id: id + '-fin-' + n, evento: 'h5p_fin', etapa: 'h5p', trabajo_id: t, proyecto_id: id, ejecucion_id: eje || 'ej-' + id, secuencia: 900 + n, fecha_evento: new Date(Date.now() - 100000 + n * 1000).toISOString(), resumen: {} })
const esperar = async (cond) => { for (let i = 0; i < 100; i++) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)) } return false }
const colaDe = async (id) => (await pool.query('SELECT codigo FROM regenerar_cola WHERE proyecto_id = $1 ORDER BY codigo', [id])).rows.map((x) => x.codigo)

test('regenerar con corrida en curso: 202 encolado (no 409), GET marca enColaRegenerar y h5p_fin lanza una corrida nueva con TODA la cola (sin tope de 30) y la vacía', async () => {
  const ana = await entrar('ana@u.co')
  const t = await prepararCurso(ana, 'curso-cola', 35)
  assert.equal((await fin('curso-cola', t, 1)).status, 200)
  const antes = recibidas.length
  const a = await ana('POST', '/proyectos/curso-cola/pipeline/h5p', { regenerar: ['U1-T1-R1'] })
  assert.equal(a.status, 202)
  const t2 = (await a.json()).trabajo_id
  assert.equal(recibidas.length, antes + 1)
  const codigos = []
  for (let i = 2; i <= 35; i++) codigos.push('U1-T1-R' + i)
  const b = await ana('POST', '/proyectos/curso-cola/pipeline/h5p', { regenerar: codigos.slice(0, 20) })
  assert.equal(b.status, 202)
  let jb = await b.json()
  assert.equal(jb.encolado, true); assert.equal(jb.en_cola, 20)
  jb = await (await ana('POST', '/proyectos/curso-cola/pipeline/h5p', { regenerar: codigos })).json()
  assert.equal(jb.en_cola, 34)
  assert.equal(recibidas.length, antes + 1) // no se molestó a n8n
  assert.equal((await ana('POST', '/proyectos/curso-cola/pipeline/h5p', { regenerar: ['U1-T1-R1'] })).status, 409) // ese recurso ya se está regenerando
  const g = await (await ana('GET', '/proyectos/curso-cola/pipeline')).json()
  assert.equal(g.colaRegenerar, 34)
  assert.equal(g.recursos.find((x) => x.codigo === 'U1-T1-R2').enColaRegenerar, true)
  assert.equal(g.recursos.find((x) => x.codigo === 'U1-T1-R1').enColaRegenerar, undefined)
  // h5p_fin de la corrida en curso: sale una orden nueva con los 34
  assert.equal((await fin('curso-cola', t2, 2, 'ej-b')).status, 200)
  assert.ok(await esperar(async () => recibidas.length === antes + 2))
  const orden = recibidas.at(-1)
  const esperado = [...[...codigos.slice(0, 20)].sort(), ...[...codigos.slice(20)].sort()] // por orden de pedido
  assert.deepEqual(orden.regenerar, esperado)
  assert.ok(await esperar(async () => (await colaDe('curso-cola')).length === 0))
})

test('cola: si el lanzamiento falla los códigos siguen en cola; lo que ya no sirve se descarta; lo inexistente no se encola', async () => {
  const ana = await entrar('ana@u.co')
  const t = await prepararCurso(ana, 'curso-cola2', 3)
  assert.equal((await fin('curso-cola2', t, 1)).status, 200)
  const t2 = (await (await ana('POST', '/proyectos/curso-cola2/pipeline/h5p', { regenerar: ['U1-T1-R1'] })).json()).trabajo_id
  assert.equal((await ana('POST', '/proyectos/curso-cola2/pipeline/h5p', { regenerar: ['U1-T1-R9'] })).status, 409)
  assert.equal((await ana('POST', '/proyectos/curso-cola2/pipeline/h5p', { regenerar: ['U1-T1-R2', 'U1-T1-R3'] })).status, 202)
  await pool.query("UPDATE pipeline_recursos SET estado = 'PENDIENTE', plantilla = NULL WHERE proyecto_id = 'curso-cola2' AND id = 'r3'") // cambió mientras esperaba
  respuestaN8n = { estado: 500, cuerpo: {} }
  const antes = recibidas.length
  assert.equal((await fin('curso-cola2', t2, 2, 'ej-b2')).status, 200) // el aviso se procesa aunque el lanzamiento falle
  assert.ok(await esperar(async () => recibidas.length > antes))
  await new Promise((r) => setTimeout(r, 400))
  assert.deepEqual(await colaDe('curso-cola2'), ['U1-T1-R2'])
  respuestaN8n = { estado: 200, cuerpo: { ok: true } }
})

test('consumo y costo estimado: solo los ve un administrador (GET pipeline y GET contenido)', async () => {
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  assert.equal((await beto('PUT', '/proyectos/curso-beto', curso('curso-beto'))).status, 200)
  await pool.query("INSERT INTO pipeline_recursos (propietario_id, proyecto_id, id, unidad, codigo, estado, plantilla, contenido, consumo, actualizado_en) VALUES ($1, 'curso-beto', 'rb', 1, 'U1-T1-R1', 'GENERADO', 'quiz', '{\"v\":1}', '{\"usd\":0.5,\"tokens\":10}', now())", [ids.beto])
  const pb = await (await beto('GET', '/proyectos/curso-beto/pipeline')).json()
  assert.equal(pb.recursos.length, 1); assert.equal('consumo' in pb.recursos[0], false)
  assert.equal('costoEstimadoUsd' in pb.desactualizados, false)
  const cb = await (await beto('GET', '/proyectos/curso-beto/pipeline/recursos/rb/contenido')).json()
  assert.equal('consumo' in cb, false)
  await pool.query("UPDATE pipeline_recursos SET consumo = '{\"usd\":0.5}' WHERE proyecto_id = 'curso-cola' AND id = 'r5'")
  const pa = await (await ana('GET', '/proyectos/curso-cola/pipeline')).json()
  assert.deepEqual(pa.recursos.find((x) => x.id === 'r5').consumo, { usd: 0.5 })
  assert.equal('costoEstimadoUsd' in pa.desactualizados, true)
})

test('regenerar por partes: la orden lleva el ítem objeto con «actual» (contenido editado, actividad, bibliografía, imágenes) y los demás ítems siguen como texto', async () => {
  const ana = await entrar('ana@u.co')
  const t = await prepararCurso(ana, 'curso-partes', 3)
  const img = 'https://lh3.googleusercontent.com/imgrecurso1'
  const imgAct = 'https://lh3.googleusercontent.com/imgactividad1'
  sec++
  assert.equal((await firmado({ evento_id: 'cp-act-001', evento: 'h5p_recurso', etapa: 'h5p', trabajo_id: t, proyecto_id: 'curso-partes', ejecucion_id: 'ej-curso-partes', secuencia: sec, fecha_evento: f(sec), unidad: 1, id: 'r1', codigo: 'U1-T1-R1',
    estado: 'POR_REVISAR', plantilla: 'quiz', contenido: { v: 1, diapositivas: [{ imagen: { src: img } }] }, imagen_url: img,
    actividad: { plantilla: 'quiz', contenido: { pregunta: 'A' }, imagen_url: imgAct }, bibliografia: { plantilla: 'biblio', contenido: { refs: ['x'] } } })).status, 200)
  await pool.query('UPDATE pipeline_recursos SET contenido = $1::jsonb WHERE proyecto_id = $2 AND id = $3', [JSON.stringify({ v: 1, editado: true }), 'curso-partes', 'r1'])
  assert.equal((await fin('curso-partes', t, 1)).status, 200)
  const antes = recibidas.length
  // validaciones
  for (const mal of [{ codigo: 'U1-T1-R1', partes: ['otra'] }, { codigo: 'U1-T1-R1', partes: [] }, { codigo: 'U1-T1-R1', imagenes: ['a.b'] }, { codigo: 'U1-T1-R1', partes: ['imagenes'], imagenes: ['a b;drop'] },
    { codigo: 'U1-T1-R1', partes: ['imagenes'], imagenes: ['x'.repeat(201)] }, { codigo: 'U1-T1-R1', partes: ['imagenes'], imagenes: Array.from({ length: 51 }, (_, i) => 'a[' + i + '].b') }, { codigo: 'U1-T1-R1', partes: ['imagenes'], extra: 1 }]) {
    assert.equal((await ana('POST', '/proyectos/curso-partes/pipeline/h5p', { regenerar: [mal] })).status, 400, JSON.stringify(mal).slice(0, 80))
  }
  assert.equal(recibidas.length, antes)
  const ok = await ana('POST', '/proyectos/curso-partes/pipeline/h5p', { regenerar: [{ codigo: 'U1-T1-R1', partes: ['imagenes', 'actividad'], imagenes: ['diapositivas[2].imagen.src', 'actividad:items[0].imagen', 'IMAGEN_EJEMPLO'] }, 'U1-T1-R2', { codigo: 'U1-T1-R3' }] })
  assert.equal(ok.status, 202)
  const orden = recibidas.at(-1)
  assert.equal(orden.regenerar[1], 'U1-T1-R2')
  assert.equal(orden.regenerar[2], 'U1-T1-R3') // objeto sin partes = texto
  const it = orden.regenerar[0]
  assert.deepEqual(it.partes, ['imagenes', 'actividad'])
  assert.deepEqual(it.imagenes, ['diapositivas[2].imagen.src', 'actividad:items[0].imagen', 'IMAGEN_EJEMPLO'])
  assert.deepEqual(it.actual.contenido, { v: 1, editado: true })
  assert.deepEqual(it.actual.actividad, { plantilla: 'quiz', contenido: { pregunta: 'A' } })
  assert.deepEqual(it.actual.bibliografia, { plantilla: 'biblio', contenido: { refs: ['x'] } })
  assert.equal(it.actual.imagen_url, img)
  assert.equal(it.actual.imagen_url_actividad, imgAct)
  // el aviso con partes_regeneradas se acepta, guarda todo y deja «Regenerado: …» en observaciones
  const t2 = (await ok.json()).trabajo_id
  sec++
  assert.equal((await firmado({ evento_id: 'cp-fin-001', evento: 'h5p_recurso', etapa: 'h5p', trabajo_id: t2, proyecto_id: 'curso-partes', ejecucion_id: 'ej-p2', secuencia: sec, fecha_evento: new Date().toISOString(), unidad: 1, id: 'r1', codigo: 'U1-T1-R1',
    estado: 'POR_REVISAR', plantilla: 'quiz', contenido: { v: 1, nuevo: true }, imagen_url: img, partes_regeneradas: ['imagenes', 'actividad', 'basura'],
    actividad: { plantilla: 'quiz', contenido: { pregunta: 'B' } }, bibliografia: { plantilla: 'biblio', contenido: { refs: ['x'] } } })).status, 200)
  const fila = (await pool.query('SELECT estado, contenido, actividad, bibliografia, observaciones FROM pipeline_recursos WHERE proyecto_id = $1 AND id = $2', ['curso-partes', 'r1'])).rows[0]
  assert.equal(fila.estado, 'POR_REVISAR')
  assert.deepEqual(fila.contenido, { v: 1, nuevo: true })
  assert.deepEqual(fila.actividad.contenido, { pregunta: 'B' })
  assert.deepEqual(fila.bibliografia.contenido, { refs: ['x'] })
  assert.match(fila.observaciones, /Regenerado: imágenes, actividad\./)
})

test('cola por partes: encolar guarda partes, combina (todo gana; si no, unión) y drenar envía el ítem con «actual»', async () => {
  const ana = await entrar('ana@u.co')
  const t = await prepararCurso(ana, 'curso-cola3', 4)
  assert.equal((await fin('curso-cola3', t, 1)).status, 200)
  const t2 = (await (await ana('POST', '/proyectos/curso-cola3/pipeline/h5p', { regenerar: ['U1-T1-R1'] })).json()).trabajo_id
  const post = (regenerar) => ana('POST', '/proyectos/curso-cola3/pipeline/h5p', { regenerar })
  assert.equal((await post([{ codigo: 'U1-T1-R2', partes: ['recurso'] }, { codigo: 'U1-T1-R3', partes: ['imagenes'], imagenes: ['a.b'] }, { codigo: 'U1-T1-R4', partes: ['actividad'] }])).status, 202)
  assert.equal((await post([{ codigo: 'U1-T1-R2', partes: ['bibliografia'] }, { codigo: 'U1-T1-R3', partes: ['imagenes'], imagenes: ['c[1].d'] }, 'U1-T1-R4'])).status, 202)
  const cola = (await pool.query('SELECT codigo, partes, imagenes FROM regenerar_cola WHERE proyecto_id = $1 ORDER BY codigo', ['curso-cola3'])).rows
  assert.deepEqual(cola.map((x) => x.codigo), ['U1-T1-R2', 'U1-T1-R3', 'U1-T1-R4'])
  assert.deepEqual([...cola[0].partes].sort(), ['bibliografia', 'recurso']); assert.equal(cola[0].imagenes, null)
  assert.deepEqual(cola[1].imagenes.sort(), ['a.b', 'c[1].d'])
  assert.equal(cola[2].partes, null) // todo gana
  await pool.query('UPDATE pipeline_recursos SET contenido = $1::jsonb WHERE proyecto_id = $2 AND id = $3', [JSON.stringify({ ed: 1 }), 'curso-cola3', 'r2'])
  const antes = recibidas.length
  assert.equal((await fin('curso-cola3', t2, 2, 'ej-c3')).status, 200)
  assert.ok(await esperar(async () => recibidas.length === antes + 1))
  const orden = recibidas.at(-1).regenerar
  const r2 = orden.find((x) => x.codigo === 'U1-T1-R2')
  assert.deepEqual([...r2.partes].sort(), ['bibliografia', 'recurso'])
  assert.deepEqual(r2.actual.contenido, { ed: 1 })
  assert.equal(orden.find((x) => x.codigo === 'U1-T1-R3').actual.imagen_url, null)
  assert.ok(orden.includes('U1-T1-R4'))
  assert.ok(await esperar(async () => (await colaDe('curso-cola3')).length === 0))
})

test('actualizar actividades: preparación sin forzar y luego matrices con conservar:true; si la preparación falla no hay matriz; el docente no puede', async () => {
  const ana = await entrar('ana@u.co') // docente y admin
  const beto = await entrar('beto@u.co') // docente
  recibidas.length = 0; urlsRecibidas.length = 0
  assert.equal((await ana('PUT', '/proyectos/curso-act', curso('curso-act', [1, 2, 3]))).status, 200)
  await pool.query("INSERT INTO asignacion_variantes (propietario_id, proyecto_id, codigo, unidad, categoria, formacion, plantilla, estado) VALUES ($1, 'curso-act', 'U1-T1-R1', 1, 'TST-01', 'profesional', 'tst-01-v01', 'asignada')", [ids.ana])
  const url = '/proyectos/curso-act/pipeline/actualizar-actividades'
  assert.equal((await ana('POST', url, { unidad: 0 })).status, 400)
  assert.equal((await ana('POST', url, {})).status, 400)
  assert.equal((await ana('POST', url, { unidad: 1, extra: 1 })).status, 400)
  const b = await beto('POST', '/proyectos/curso-act/pipeline/actualizar-actividades', { unidad: 1 })
  assert.ok([403, 404, 409].includes(b.status), 'el docente no actualiza: ' + b.status)
  assert.equal(recibidas.length, 0)
  // preparación falla: no se llama a matrices
  respuestaN8n = { estado: 500, cuerpo: { error: 'fallo de prueba' } }
  const mal = await ana('POST', url, { unidad: 1 })
  assert.equal(mal.status, 409)
  assert.match((await mal.json()).error, /preparación del curso falló/)
  assert.deepEqual(urlsRecibidas, ['/webhook/preparacion'])
  // todo bien: preparación (forzar false) y luego matrices conservar
  respuestaN8n = { estado: 200, cuerpo: { ok: true } }
  const ok = await ana('POST', url, { unidad: 1 })
  assert.equal(ok.status, 202)
  const j = await ok.json()
  assert.equal(j.preparacion.asignadas, 1)
  assert.ok(j.matrices.trabajo_id)
  assert.deepEqual(urlsRecibidas, ['/webhook/preparacion', '/webhook/preparacion', '/webhook/matrices'])
  assert.equal(recibidas[1].forzar, false)
  assert.equal(recibidas[2].conservar, true)
  assert.deepEqual(recibidas[2].unidades, [1])
})
