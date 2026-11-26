// Receptor de avisos de n8n (pipeline guiones → matrices → H5P): firma, contrato, idempotencia, orden, atribución al curso correcto y
// aislamiento entre personas. Usa un «n8n simulado» que firma los avisos igual que lo hará el subflujo real.
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
const PUERTO_PG = 54382
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-pip-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789'
const SECRETO_ANTERIOR = 'secreto-anterior-0123456789abcdef0123456789'
const DOC = 'https://docs.google.com/document/d/guion_1-abc'
const HOJA = 'https://docs.google.com/spreadsheets/d/matriz_1-abc/edit'

let servidor, base, pool, servicioH5p, ultimaPeticionServicio, n8nPublicar, ordenesPublicar = [], publicarFalla = false
const ids = {} // personas
const T = { ana: crypto.randomUUID(), beto: crypto.randomUUID(), ajeno: crypto.randomUUID() }
let n = 0
const eid = () => 'evento-' + String(++n).padStart(6, '0')
const inicio = Date.now() - 20 * 60 * 1000
const t = (seg) => new Date(inicio + seg * 1000).toISOString()

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await dueno.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.N8N_EVENTOS_SECRETO = SECRETO
  // «Servicio de plantillas H5P» simulado: arma un .h5p (aquí unos bytes cualquiera) si la clave es la correcta; 400 si la plantilla es «mala».
  servicioH5p = http.createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (d) => { cuerpo += d })
    req.on('end', () => {
      ultimaPeticionServicio = { url: req.url, clave: req.headers['x-api-key'], cuerpo: cuerpo ? JSON.parse(cuerpo) : null }
      if (req.url !== '/h5p' || req.headers['x-api-key'] !== 'clave-del-servicio') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"clave"}') }
      if (ultimaPeticionServicio.cuerpo.plantilla === 'mala') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"contenido inválido"}') }
      res.writeHead(200, { 'content-type': 'application/zip', 'x-iconos-sin-resolver': 'np_99' }); res.end(Buffer.from('PK-h5p-simulado'))
    })
  })
  await new Promise((r) => servicioH5p.listen(0, '127.0.0.1', r))
  process.env.SERVICIO_PLANTILLAS_URL = 'http://127.0.0.1:' + servicioH5p.address().port
  process.env.SERVICIO_PLANTILLAS_CLAVE = 'clave-del-servicio'
  // «n8n» simulado para la orden de PUBLICAR un recurso: guarda la orden y confirma (o falla si publicarFalla).
  n8nPublicar = http.createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (d) => { cuerpo += d })
    req.on('end', () => {
      ordenesPublicar.push(JSON.parse(cuerpo))
      if (publicarFalla) { res.writeHead(500); return res.end('error') }
      res.writeHead(202, { 'content-type': 'application/json' }); res.end('{"ok":true}')
    })
  })
  await new Promise((r) => n8nPublicar.listen(0, '127.0.0.1', r))
  process.env.N8N_PUBLICAR_URL = 'http://127.0.0.1:' + n8nPublicar.address().port + '/webhook/publicar'
  process.env.N8N_EVENTOS_SECRETO_ANTERIOR = SECRETO_ANTERIOR
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  const { registrarOrigen } = await import('../src/pipeline/eventos.js')
  pool = db.pool
  for (const [nombre, correo] of [['Ana', 'ana@u.co'], ['Beto', 'beto@u.co']]) ids[nombre.toLowerCase()] = (await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), ['docente']])).rows[0].id
  // Dos personas con un curso del MISMO identificador (los identificadores de curso solo son únicos por persona)
  await registrarOrigen({ trabajoId: T.ana, propietarioId: ids.ana, proyectoId: 'curso-a', carpeta: 'https://drive.google.com/drive/folders/carpetaAna', etapa: 'guiones', unidad: 1 })
  await registrarOrigen({ trabajoId: T.beto, propietarioId: ids.beto, proyectoId: 'curso-a', carpeta: 'https://drive.google.com/drive/folders/carpetaBeto', etapa: 'guiones', unidad: 1 })
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})

after(async () => {
  servidor && servidor.close()
  servicioH5p && servicioH5p.close()
  n8nPublicar && n8nPublicar.close()
  pool && (await pool.end())
  await servidorPg.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

// Cliente que hace lo mismo que el emisor de n8n: serializa una vez, firma esos mismos bytes y los envía.
const firmar = (cuerpo, { fecha = Math.floor(Date.now() / 1000), secreto = SECRETO } = {}) =>
  ({ 'x-praxia-fecha': String(fecha), 'x-praxia-firma': crypto.createHmac('sha256', secreto).update(fecha + '.' + cuerpo).digest('hex') })
async function enviar(obj, opciones) {
  const cuerpo = typeof obj === 'string' ? obj : JSON.stringify(obj)
  const r = await fetch(base + '/api/n8n/eventos', { method: 'POST', headers: { 'content-type': 'application/json', ...firmar(cuerpo, opciones) }, body: cuerpo })
  let datos = null
  try { datos = await r.json() } catch { /* sin cuerpo */ }
  return { estado: r.status, datos }
}
const aviso = (evento, etapa, extra = {}, seg = 0) => ({ evento_id: eid(), evento, etapa, trabajo_id: T.ana, proyecto_id: 'curso-a', fecha_evento: t(seg), secuencia: seg, ...extra })
const una = (persona, tabla, where = '1=1', val = []) => pool.query(`SELECT * FROM ${tabla} WHERE propietario_id = $1 AND ${where}`, [ids[persona], ...val]).then((r) => r.rows)
const fila = (id, estado = 'PENDIENTE', extra = {}) => ({ id, id_base: 'b-' + id, formato: 'Línea de tiempo', titulo: 'Título ' + id, generador: 'H5P', estado, enlace_guion: DOC, ...extra })

test('la firma protege el receptor: sin firma, con firma mala, vencida o con el cuerpo alterado se rechaza', async () => {
  const ok = aviso('h5p_fin', 'h5p', { ejecucion_id: 'x1', resumen: { generados: 0, errores: 0, omitidos: 0 } })
  const cuerpo = JSON.stringify(ok)
  const sin = await fetch(base + '/api/n8n/eventos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpo })
  assert.equal(sin.status, 401)
  assert.equal((await enviar(cuerpo, { secreto: 'otro-secreto-cualquiera-0123456789abcdef' })).estado, 401)
  assert.equal((await enviar(cuerpo, { fecha: Math.floor(Date.now() / 1000) - 11 * 60 })).estado, 401) // vencida (más de 5 min)
  assert.equal((await enviar(cuerpo, { fecha: Math.floor(Date.now() / 1000) + 11 * 60 })).estado, 401) // del futuro
  // el cuerpo cambia después de firmarlo (un solo byte)
  const fecha = Math.floor(Date.now() / 1000)
  const r = await fetch(base + '/api/n8n/eventos', { method: 'POST', headers: { 'content-type': 'application/json', ...firmar(cuerpo, { fecha }) }, body: cuerpo.replace('x1', 'x2') })
  assert.equal(r.status, 401)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pipeline_eventos')).rows[0].n, 0) // nada de lo rechazado quedó registrado
  // el secreto anterior también vale (rotación sin cortes)
  assert.equal((await enviar(cuerpo, { secreto: SECRETO_ANTERIOR })).estado, 200)
})

test('el contrato se valida entero antes de guardar nada: avisos mal armados dan 400 y no se reintentan', async () => {
  const antes = (await pool.query('SELECT count(*)::int AS n FROM pipeline_eventos')).rows[0].n
  const sinId = aviso('h5p_fin', 'h5p', { ejecucion_id: 'x', resumen: {} }); delete sinId.evento_id
  const r1 = await enviar(sinId)
  assert.equal(r1.estado, 400); assert.ok(r1.datos.problemas.some((p) => p.startsWith('evento_id')))
  assert.equal((await enviar(aviso('evento_inventado', 'h5p'))).estado, 400)
  assert.equal((await enviar(aviso('matrices_fin', 'matrices', { ejecucion_id: 'e', resultados: [{ unidad: 1, resultado: 'creada', matriz: { url: 'http://inseguro.example/x' } }] }))).estado, 400) // enlace no permitido
  assert.equal((await enviar(aviso('matrices_fin', 'matrices', { ejecucion_id: 'e', resultados: [{ unidad: 1, resultado: 'rara' }] }))).estado, 400)
  assert.equal((await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'e', id: 'f1', estado: 'PENDIENTE', fecha_evento: 'ayer' }))).estado, 400)
  assert.equal((await enviar({ eventos: [] })).estado, 400)
  assert.equal((await enviar('no es json')).estado, 400)
  const buenos = Array.from({ length: 3 }, () => aviso('h5p_recurso', 'h5p', { ejecucion_id: 'lote', id: 'zz' + n, estado: 'EN_PROCESO' }))
  assert.equal((await enviar({ eventos: [...buenos, { evento: 'roto' }] })).estado, 400) // un aviso malo en el lote: no se guarda ninguno
  assert.equal((await enviar({ eventos: Array.from({ length: 51 }, () => buenos[0]) })).estado, 400)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pipeline_eventos')).rows[0].n, antes)
})

test('un aviso que no se puede atribuir a ningún trabajo queda como huérfano (202) y un reintento se reconoce como repetido', async () => {
  const a = aviso('h5p_fin', 'h5p', { trabajo_id: crypto.randomUUID(), ejecucion_id: 'huerfana', resumen: { generados: 1 } })
  const r = await enviar(a)
  assert.equal(r.estado, 202); assert.equal(r.datos.huerfano, true); assert.equal(r.datos.huerfanos, 1)
  assert.equal((await pool.query('SELECT resultado, motivo FROM pipeline_eventos WHERE evento_id = $1', [a.evento_id])).rows[0].resultado, 'huerfano')
  const otra = await enviar(a) // n8n reintenta el mismo aviso
  assert.equal(otra.estado, 200); assert.equal(otra.datos.duplicados, 1); assert.equal(otra.datos.huerfanos, 0)
})

test('matrices: inicio y fin guardan la matriz y sus filas en el curso (la cadena se atribuye con origen_trabajo_id) y un reintento no cambia nada', async () => {
  const comunes = { trabajo_id: null, origen_trabajo_id: T.ana, ejecucion_id: 'm1', carpeta_raiz: 'https://drive.google.com/drive/folders/carpetaAna' }
  const ini = await enviar(aviso('matrices_inicio', 'matrices', { ...comunes, unidades: [1, 2], forzar: false }, 1))
  assert.equal(ini.datos.aplicados, 1)
  assert.deepEqual((await una('ana', 'pipeline_matrices')).map((m) => m.estado), ['generando', 'generando'])
  const fin = aviso('matrices_fin', 'matrices', {
    ...comunes,
    resultados: [
      { unidad: 1, formacion: 'Tecnológico', resultado: 'creada', matriz: { id: 'M1', url: HOJA, nombre: 'Matriz de recursos - Tecnológico - Unidad 1' }, filas: [fila('f1'), fila('f2', 'GENERADO', { enlace_recurso: 'https://drive.google.com/file/d/h5p1/view' })] },
      { unidad: 2, formacion: 'Tecnológico', resultado: 'error', detalle: 'No se pudo copiar la plantilla' }
    ]
  }, 5)
  const r = await enviar(fin)
  assert.equal(r.estado, 200); assert.equal(r.datos.aplicados, 1)
  const [m1, m2] = await una('ana', 'pipeline_matrices', '1=1 ORDER BY unidad')
  assert.equal(m1.estado, 'creada'); assert.equal(m1.matriz_url, HOJA); assert.equal(m1.filas_total, 2); assert.equal(m1.formacion, 'Tecnológico')
  assert.equal(m2.estado, 'error'); assert.match(m2.detalle, /plantilla/)
  const rec = await una('ana', 'pipeline_recursos', '1=1 ORDER BY id')
  assert.deepEqual(rec.map((x) => [x.id, x.estado, x.unidad]), [['f1', 'PENDIENTE', 1], ['f2', 'GENERADO', 1]])
  assert.equal(rec[1].enlace_recurso, 'https://drive.google.com/file/d/h5p1/view')
  const [ej] = await una('ana', 'pipeline_ejecuciones', "etapa = 'matrices'")
  assert.equal(ej.estado, 'terminada'); assert.equal(ej.origen_trabajo_id, T.ana)
  const repetido = await enviar(fin) // reintento de n8n con el mismo evento_id
  assert.equal(repetido.datos.duplicados, 1); assert.equal(repetido.datos.aplicados, 0)
  assert.equal((await una('ana', 'pipeline_recursos')).length, 2)
})

test('orden: un aviso más antiguo que lo guardado no lo pisa (inicio tardío tras el fin, EN_PROCESO tardío tras GENERADO)', async () => {
  const tardio = await enviar(aviso('matrices_inicio', 'matrices', { origen_trabajo_id: T.ana, trabajo_id: null, ejecucion_id: 'm1', unidades: [1] }, 2)) // t=2 < fin t=5
  assert.equal(tardio.datos.ignorados, 1)
  assert.equal((await una('ana', 'pipeline_matrices', 'unidad = 1'))[0].estado, 'creada')
  assert.equal((await pool.query("SELECT resultado FROM pipeline_eventos WHERE evento_id = $1", ['evento-' + String(n).padStart(6, '0')])).rows[0].resultado, 'ignorado_antiguo')

  const h = (estado, seg, extra = {}) => aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h1', unidad: 1, id: 'f1', estado, ...extra }, seg)
  assert.equal((await enviar(h('GENERADO', 21, { enlace_recurso: 'https://drive.google.com/file/d/h5pf1/view' }))).datos.aplicados, 1)
  assert.equal((await enviar(h('EN_PROCESO', 19))).datos.ignorados, 1) // llegó tarde: ya estaba generado
  const f1 = (await una('ana', 'pipeline_recursos', "id = 'f1'"))[0]
  assert.equal(f1.estado, 'GENERADO'); assert.equal(f1.enlace_recurso, 'https://drive.google.com/file/d/h5pf1/view')
  // recuperación de una fila atascada: un aviso posterior sí puede devolverla a PENDIENTE
  assert.equal((await enviar(h('PENDIENTE', 40, { observaciones: 'Se volvió a tomar: llevaba 30 min en proceso' }))).datos.aplicados, 1)
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'f1'"))[0].estado, 'PENDIENTE')
})

test('H5P: el plan con lo omitido y su motivo, el avance por recurso y el resumen final quedan en el curso', async () => {
  const ini = await enviar(aviso('h5p_inicio', 'h5p', {
    ejecucion_id: 'h2', maximo: 5,
    plan: { a_generar: [{ id: 'f1', codigo: 'U1-T1-f1' }], omitidas: [{ id: 'f2', codigo: 'U1-T1-f2', motivo: 'sin_plantilla' }, { id: 'no-existe', motivo: 'tipo_inactivo' }] }
  }, 50))
  assert.equal(ini.estado, 200)
  const [ej] = await una('ana', 'pipeline_ejecuciones', "ejecucion_id = 'h2'")
  assert.equal(ej.estado, 'en_curso'); assert.equal(ej.maximo, 5); assert.equal(ej.plan.omitidas.length, 2); assert.equal(ej.plan.a_generar[0].id, 'f1')
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'f2'"))[0].omision, 'sin_plantilla') // el motivo queda en la fila que ya se conocía
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'no-existe'")).length, 0) // no se inventan filas
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'EN_PROCESO' }, 51))
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'ERROR', observaciones: 'El guion no tiene fechas' }, 52))
  const f1 = (await una('ana', 'pipeline_recursos', "id = 'f1'"))[0]
  assert.equal(f1.estado, 'ERROR'); assert.equal(f1.observaciones, 'El guion no tiene fechas'); assert.equal(f1.omision, null)
  // La plantilla usada viaja en el aviso (se tolera mayúscula y espacios; vacía = sin dato) y se conserva en avisos posteriores que no la traen.
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'EN_PROCESO', plantilla: ' G-11-DOC-V01 ' }, 53))
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'f1'"))[0].plantilla, 'g-11-doc-v01')
  const sinPl = await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'ERROR', observaciones: 'x', plantilla: '' }, 54))
  assert.equal(sinPl.estado, 200)
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'f1'"))[0].plantilla, 'g-11-doc-v01')
  // El contenido final (JSON) viaja en h5p_recurso, como objeto o como texto JSON; lo no válido o muy grande se ignora sin rechazar el aviso (el estado sí se aplica) y se conserva el anterior.
  const CONT = { titulo: 'Los cinco pasos', bloques: [{ texto: 'uno' }, { texto: 'dos' }] }
  assert.equal((await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'GENERADO', contenido: CONT }, 55))).estado, 200)
  assert.deepEqual((await una('ana', 'pipeline_recursos', "id = 'f1'"))[0].contenido, CONT)
  const CONT2 = { titulo: 'Segundo', bloques: [] }
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'GENERADO', contenido: JSON.stringify(CONT2) }, 56))
  assert.deepEqual((await una('ana', 'pipeline_recursos', "id = 'f1'"))[0].contenido, CONT2)
  for (const [k, malo] of [['texto roto', '{no es json'], ['lista', [1, 2]], ['vacío', ''], ['enorme', { x: 'y'.repeat(450 * 1024) }]]) {
    const r = await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'GENERADO', observaciones: 'tras ' + k, contenido: malo }, 57))
    assert.equal(r.estado, 200, k)
    const fila = (await una('ana', 'pipeline_recursos', "id = 'f1'"))[0]
    assert.equal(fila.observaciones, 'tras ' + k); assert.deepEqual(fila.contenido, CONT2, k)
  }
  // revision_pendiente: entero ≥ 0 (también como texto numérico); 0 se guarda; lo no válido es «sin dato» y no pisa lo guardado
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'GENERADO', revision_pendiente: 3 }, 58))
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'f1'"))[0].revision_pendiente, 3)
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'GENERADO', revision_pendiente: 'abc' }, 59))
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'f1'"))[0].revision_pendiente, 3)
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'GENERADO', revision_pendiente: '0' }, 60))
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'f1'"))[0].revision_pendiente, 0)
  const reg = (await pool.query("SELECT carga FROM pipeline_eventos WHERE tipo = 'h5p_recurso' AND carga ->> 'contenido' IS NOT NULL LIMIT 1")).rows[0]
  assert.match(reg.carga.contenido, /^objeto \(\d+ campos\)$/) // el registro de avisos no guarda el JSON completo
  const fin = await enviar(aviso('h5p_fin', 'h5p', { ejecucion_id: 'h2', resumen: { generados: 0, errores: 1, omitidos: 2, pendientes_restantes: 0 } }, 60))
  assert.equal(fin.datos.aplicados, 1)
  const [ej2] = await una('ana', 'pipeline_ejecuciones', "ejecucion_id = 'h2'")
  assert.equal(ej2.estado, 'terminada'); assert.equal(ej2.resumen.errores, 1); assert.ok(ej2.terminado_en)
})

test('un aviso nunca escribe en un curso ajeno: la persona sale del trabajo, no de lo que diga el aviso', async () => {
  // aviso con el trabajo de Ana pero el curso de otro: se rechaza y no se escribe nada
  const antes = (await una('ana', 'pipeline_recursos')).length
  const r = await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'x', unidad: 1, id: 'robado', estado: 'GENERADO', proyecto_id: 'otro-curso' }, 70))
  assert.equal(r.datos.rechazados.length, 1); assert.equal(r.datos.rechazados[0].motivo, 'proyecto_distinto')
  assert.equal((await una('ana', 'pipeline_recursos')).length, antes)
  // Beto tiene un curso con el MISMO identificador que el de Ana: sus avisos solo tocan lo suyo
  assert.equal((await una('beto', 'pipeline_recursos')).length, 0)
  const b = await enviar(aviso('h5p_recurso', 'h5p', { trabajo_id: T.beto, ejecucion_id: 'b1', unidad: 1, id: 'f1', estado: 'GENERADO', enlace_recurso: 'https://drive.google.com/file/d/deBeto/view' }, 71))
  assert.equal(b.datos.aplicados, 1)
  assert.equal((await una('beto', 'pipeline_recursos', "id = 'f1'"))[0].enlace_recurso, 'https://drive.google.com/file/d/deBeto/view')
  assert.notEqual((await una('ana', 'pipeline_recursos', "id = 'f1'"))[0].enlace_recurso, 'https://drive.google.com/file/d/deBeto/view')
})

test('una matriz nueva reemplaza la foto de su unidad, sin pisar lo que cambió después; un error no borra las filas ni la matriz', async () => {
  const comunes = { trabajo_id: T.ana, ejecucion_id: 'snap' }
  await enviar(aviso('matrices_fin', 'matrices', { ...comunes, resultados: [{ unidad: 5, resultado: 'creada', matriz: { id: 'M5', url: HOJA }, filas: [fila('a'), fila('b'), fila('c')] }] }, 80))
  await enviar(aviso('h5p_recurso', 'h5p', { ...comunes, unidad: 5, id: 'b', estado: 'GENERADO' }, 100)) // más reciente que la foto siguiente
  await enviar(aviso('matrices_fin', 'matrices', { ...comunes, resultados: [{ unidad: 5, resultado: 'reemplazada', anterior_id: 'M5', matriz: { id: 'M5b', url: HOJA }, filas: [fila('a')] }] }, 90))
  const ids5 = (await una('ana', 'pipeline_recursos', 'unidad = 5 ORDER BY id')).map((x) => x.id)
  assert.deepEqual(ids5, ['a', 'b']) // «c» ya no está en la matriz; «b» se queda porque cambió después de esa foto
  assert.equal((await una('ana', 'pipeline_matrices', 'unidad = 5'))[0].matriz_id, 'M5b')
  await enviar(aviso('matrices_fin', 'matrices', { ...comunes, resultados: [{ unidad: 5, resultado: 'error', detalle: 'Drive no respondió' }] }, 110))
  const m5 = (await una('ana', 'pipeline_matrices', 'unidad = 5'))[0]
  assert.equal(m5.estado, 'error'); assert.equal(m5.matriz_id, 'M5b') // conserva lo que ya se sabía de la matriz
  assert.equal((await una('ana', 'pipeline_recursos', 'unidad = 5')).length, 2)
})

test('lote de avisos y reloj adelantado: se aplican todos, y un aviso «del futuro» no bloquea los siguientes', async () => {
  const lote = [1, 2, 3].map((i) => aviso('h5p_recurso', 'h5p', { ejecucion_id: 'lote', unidad: 6, id: 'l' + i, estado: 'EN_PROCESO' }, 120 + i))
  const r = await enviar({ eventos: lote })
  assert.equal(r.estado, 200); assert.equal(r.datos.aplicados, 3)
  assert.equal((await una('ana', 'pipeline_recursos', 'unidad = 6')).length, 3)
  const futuro = aviso('h5p_recurso', 'h5p', { ejecucion_id: 'lote', unidad: 6, id: 'l1', estado: 'GENERADO', fecha_evento: new Date(Date.now() + 3 * 3600 * 1000).toISOString() }, 130)
  await enviar(futuro)
  const guardada = (await una('ana', 'pipeline_recursos', "id = 'l1'"))[0].actualizado_en
  assert.ok(guardada.getTime() <= Date.now() + 1000, 'la fecha adelantada se recortó a la hora del servidor')
})

test('el vector de firma de la documentación coincide con el algoritmo real (para que n8n pueda comprobar su nodo Crypto)', () => {
  const firma = crypto.createHmac('sha256', 'secreto-de-prueba').update('1700000000.{"evento_id":"prueba-0001"}').digest('hex')
  assert.equal(firma, 'd0e2186090dde1bb100aaa47b5cff7c63bec6e4a3fdf4a044b031b18cde92c99')
})

test('la pantalla del curso lee lo guardado: cada persona ve solo lo de su curso, y hace falta sesión', async () => {
  const entrar = async (correo) => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
    return (ruta) => fetch(base + '/api' + ruta, { headers: { cookie, 'x-ova': '1' } })
  }
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  assert.equal((await fetch(base + '/api/proyectos/curso-a/pipeline', { headers: { 'x-ova': '1' } })).status, 401)
  assert.equal((await ana('/proyectos/no%20valido!/pipeline')).status, 400)
  const a = await (await ana('/proyectos/curso-a/pipeline')).json()
  assert.ok(a.matrices.length >= 3); assert.equal(a.matrices.find((m) => m.unidad === 1).matrizUrl, HOJA)
  assert.ok(a.recursos.some((r) => r.id === 'f1' && r.unidad === 1)); assert.ok(a.generado)
  const h2 = a.ejecuciones.find((e) => e.ejecucionId === 'h2')
  assert.equal(h2.etapa, 'h5p'); assert.equal(h2.plan.aGenerar, 1); assert.equal(h2.plan.omitidas[0].motivo, 'sin_plantilla'); assert.equal(h2.resumen.errores, 1)
  const b = await (await beto('/proyectos/curso-a/pipeline')).json() // mismo identificador de curso, otra persona
  assert.equal(b.matrices.length, 0); assert.deepEqual(b.recursos.map((r) => r.id), ['f1'])
  assert.equal(b.recursos[0].enlaceRecurso, 'https://drive.google.com/file/d/deBeto/view')
  const vacio = await (await ana('/proyectos/otro-curso/pipeline')).json()
  assert.deepEqual([vacio.matrices.length, vacio.recursos.length, vacio.ejecuciones.length], [0, 0, 0])
})

test('lo que lleva tiempo sin avisos se marca «sin respuesta» (no cuenta como en proceso): corrida 15 min, matriz 15 min, recurso 30 min', async () => {
  const antiguo = (seg) => t(seg) // hace unos 20 minutos
  await enviar(aviso('h5p_inicio', 'h5p', { ejecucion_id: 'vieja', plan: { a_generar: [], omitidas: [] }, fecha_evento: antiguo(3), secuencia: 1 }))
  await enviar(aviso('h5p_inicio', 'h5p', { ejecucion_id: 'reciente', plan: { a_generar: [], omitidas: [] }, fecha_evento: new Date().toISOString(), secuencia: 1 }))
  await enviar(aviso('matrices_inicio', 'matrices', { origen_trabajo_id: T.ana, trabajo_id: null, ejecucion_id: 'mv', unidades: [9], fecha_evento: antiguo(4), secuencia: 1 }))
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'vieja', unidad: 9, id: 'atascado', estado: 'EN_PROCESO', fecha_evento: new Date(Date.now() - 40 * 60 * 1000).toISOString(), secuencia: 1 }))
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'reciente', unidad: 9, id: 'trabajando', estado: 'EN_PROCESO', fecha_evento: new Date().toISOString(), secuencia: 2 }))
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo: 'ana@u.co', clave: CLAVE }) })
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  const d = await (await fetch(base + '/api/proyectos/curso-a/pipeline', { headers: { cookie, 'x-ova': '1' } })).json()
  assert.equal(d.ejecuciones.find((e) => e.ejecucionId === 'vieja').sinRespuesta, true)
  assert.equal(d.ejecuciones.find((e) => e.ejecucionId === 'reciente').sinRespuesta, false)
  assert.equal(d.matrices.find((m) => m.unidad === 9).sinRespuesta, true)
  assert.equal(d.matrices.find((m) => m.unidad === 1).sinRespuesta, false) // una matriz ya creada nunca está «sin respuesta»
  assert.equal(d.recursos.find((x) => x.id === 'atascado').sinRespuesta, true)
  assert.equal(d.recursos.find((x) => x.id === 'trabajando').sinRespuesta, false)
})

test('el contenido de un recurso se lee por su ruta (solo el del propio curso) y la lista solo dice si lo tiene', async () => {
  const entrar = async (correo) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) }); return { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1' } }
  const ana = await entrar('ana@u.co')
  assert.equal((await fetch(base + '/api/proyectos/curso-a/pipeline/recursos/f1/contenido', { headers: { 'x-ova': '1' } })).status, 401)
  const ok = await fetch(base + '/api/proyectos/curso-a/pipeline/recursos/f1/contenido', { headers: ana })
  assert.equal(ok.status, 200)
  const j = await ok.json()
  assert.equal(j.id, 'f1'); assert.equal(j.contenido.titulo, 'Segundo'); assert.equal(j.plantilla, 'g-11-doc-v01')
  assert.equal((await fetch(base + '/api/proyectos/curso-a/pipeline/recursos/no-existe/contenido', { headers: ana })).status, 404)
  assert.equal((await fetch(base + '/api/proyectos/curso-b/pipeline/recursos/f1/contenido', { headers: ana })).status, 404) // otro curso: no se ve
  const d = await (await fetch(base + '/api/proyectos/curso-a/pipeline', { headers: ana })).json()
  const f1 = d.recursos.find((x) => x.id === 'f1')
  assert.equal(f1.revisionPendiente, 0); assert.equal(f1.conContenido, true); assert.equal(f1.contenido, undefined) // la lista no carga el JSON
  assert.equal(d.recursos.find((x) => x.id === 'trabajando').conContenido, false)
  // sin contenido guardado: 404 con motivo
  assert.equal((await fetch(base + '/api/proyectos/curso-a/pipeline/recursos/trabajando/contenido', { headers: ana })).status, 404)
})

test('editar el contenido de un recurso: solo textos, solo el propio curso; y el .h5p se arma en el servidor con la clave del servicio', async () => {
  const entrar = async (correo) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) }); return { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1', 'content-type': 'application/json' } }
  const ana = await entrar('ana@u.co'), beto = await entrar('beto@u.co')
  const url = '/api/proyectos/curso-a/pipeline/recursos/f1/contenido'
  const put = (h, cuerpo) => fetch(base + url, { method: 'PUT', headers: h, body: JSON.stringify(cuerpo) })
  assert.equal((await fetch(base + url, { method: 'PUT', headers: { 'x-ova': '1', 'content-type': 'application/json' }, body: '{}' })).status, 401)
  assert.equal((await put(ana, { contenido: 'no' })).status, 400)
  assert.equal((await put(ana, { contenido: { titulo: 'Editado', bloques: [{ texto: 'nuevo campo' }] } })).status, 400) // cambia la estructura
  assert.equal((await put(ana, { contenido: { titulo: 5, bloques: [] } })).status, 400) // cambia un tipo
  assert.equal((await put(ana, { contenido: { titulo: 'x'.repeat(450 * 1024), bloques: [] } })).status, 413)
  assert.equal((await put(beto, { contenido: { titulo: 'de Beto', bloques: [] } })).status, 404) // el curso-a de Beto no tiene ese recurso
  assert.equal((await put(ana, { contenido: { titulo: 'Título corregido', bloques: [] } })).status, 200)
  const j = await (await fetch(base + url, { headers: ana })).json()
  assert.equal(j.contenido.titulo, 'Título corregido'); assert.ok(j.editadoEn); assert.equal(typeof j.formacion === 'string' || j.formacion === null, true)
  // un recurso sin contenido no se puede «crear» por esta vía
  assert.equal((await fetch(base + '/api/proyectos/curso-a/pipeline/recursos/trabajando/contenido', { method: 'PUT', headers: ana, body: JSON.stringify({ contenido: { a: 'b' } }) })).status, 404)
  // el aviso siguiente de n8n sigue mandando (una regeneración reemplaza lo editado)
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'h2', unidad: 1, id: 'f1', estado: 'GENERADO', contenido: { titulo: 'Regenerado', bloques: [] } }, 70))
  assert.equal((await (await fetch(base + url, { headers: ana })).json()).contenido.titulo, 'Regenerado')
  // .h5p: el servidor llama al servicio con la clave y entrega el archivo
  const h5p = (h, id = 'f1') => fetch(base + '/api/proyectos/curso-a/pipeline/recursos/' + id + '/h5p', { method: 'POST', headers: h })
  assert.equal((await fetch(base + '/api/proyectos/curso-a/pipeline/recursos/f1/h5p', { method: 'POST', headers: { 'x-ova': '1' } })).status, 401)
  const ok = await h5p(ana)
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'application/zip'); assert.match(ok.headers.get('content-disposition'), /attachment; filename="[A-Za-z0-9_-]+\.h5p"/)
  assert.equal(ok.headers.get('x-iconos-sin-resolver'), 'np_99'); assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), 'PK-h5p-simulado')
  assert.equal(ultimaPeticionServicio.clave, 'clave-del-servicio'); assert.equal(ultimaPeticionServicio.cuerpo.plantilla, 'g-11-doc-v01'); assert.equal(ultimaPeticionServicio.cuerpo.contenido.titulo, 'Regenerado')
  assert.equal((await h5p(ana, 'trabajando')).status, 404) // sin contenido
  assert.equal((await h5p(beto)).status, 404) // otro curso
  await pool.query("UPDATE pipeline_recursos SET plantilla = 'mala' WHERE propietario_id = $1 AND id = 'f1'", [ids.ana])
  const mala = await h5p(ana); assert.equal(mala.status, 422); assert.match((await mala.json()).error, /contenido inválido/)
  await pool.query("UPDATE pipeline_recursos SET plantilla = NULL WHERE propietario_id = $1 AND id = 'f1'", [ids.ana])
  assert.equal((await h5p(ana)).status, 409)
  await pool.query("UPDATE pipeline_recursos SET plantilla = 'g-11-doc-v01' WHERE propietario_id = $1 AND id = 'f1'", [ids.ana])
})

test('etapa 2: un recurso «por revisar» se aprueba y n8n recibe la orden de publicar; mientras tanto figura «publicando» y el aviso GENERADO lo cierra', async () => {
  const entrar = async (correo) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) }); return { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1', 'content-type': 'application/json' } }
  const ana = await entrar('ana@u.co'), beto = await entrar('beto@u.co')
  const CONT = { titulo: 'Por revisar', bloques: [{ texto: 'uno' }] }
  // el curso de Ana (con su carpeta de Drive) tiene que existir para poder publicar
  assert.equal((await fetch(base + '/api/proyectos/curso-a', { method: 'PUT', headers: ana, body: JSON.stringify({ id: 'curso-a', programa: 'P', curso: 'Curso A', creado: Date.now(), carpetaUrl: 'https://drive.google.com/drive/folders/carpetaAna', recursos: [], guiones: [], info: {} }) })).status, 200)
  const lista = async () => (await (await fetch(base + '/api/proyectos/curso-a/pipeline', { headers: ana })).json()).recursos.find((x) => x.id === 'pub1')
  const aprobar = (h, id = 'pub1') => fetch(base + '/api/proyectos/curso-a/pipeline/recursos/' + id + '/aprobar', { method: 'POST', headers: h })
  // la etapa 1 termina con estado POR_REVISAR y el contenido
  assert.equal((await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'p1', unidad: 1, id: 'pub1', codigo: 'U1-T1-R9', estado: 'EN_PROCESO', plantilla: 'g-11-doc-v01' }, 80))).estado, 200)
  assert.equal((await aprobar(ana)).status, 409) // todavía se está generando
  assert.equal((await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'p1', unidad: 1, id: 'pub1', estado: 'POR_REVISAR', contenido: CONT, revision_pendiente: 1 }, 81))).estado, 200)
  let f = await lista()
  assert.equal(f.estado, 'POR_REVISAR'); assert.equal(f.conContenido, true); assert.equal(f.publicando, false); assert.equal(f.revisionPendiente, 1)
  // quién puede aprobar y qué se rechaza
  assert.equal((await fetch(base + '/api/proyectos/curso-a/pipeline/recursos/pub1/aprobar', { method: 'POST', headers: { 'x-ova': '1' } })).status, 401)
  assert.equal((await aprobar(ana, 'no-existe')).status, 404)
  assert.equal((await aprobar(beto)).status, 404) // el curso-a de Beto no tiene ese recurso
  assert.equal((await aprobar(ana, 'trabajando')).status, 409) // sin contenido
  // aprobar: n8n recibe la orden completa (no hay archivo todavía: reemplazar=false)
  ordenesPublicar.length = 0
  const ok = await aprobar(ana)
  assert.equal(ok.status, 202); const { trabajo_id: tp } = await ok.json()
  assert.equal(ordenesPublicar.length, 1)
  const o = ordenesPublicar[0]
  assert.equal(o.trabajo_id, tp); assert.equal(o.proyecto_id, 'curso-a'); assert.equal(o.id, 'pub1'); assert.equal(o.codigo, 'U1-T1-R9'); assert.equal(o.plantilla, 'g-11-doc-v01')
  assert.deepEqual(o.contenido, CONT); assert.equal(o.reemplazar, false); assert.equal(o.enlace_recurso, null); assert.match(o.carpeta_raiz, /drive\.google\.com\/drive\/folders\/carpetaAna/)
  assert.equal('imagen_url' in o, false) // sin imagen en la fila no se manda el campo
  f = await lista(); assert.equal(f.publicando, true)
  assert.equal((await aprobar(ana)).status, 409) // ya se está publicando: no se manda dos veces
  assert.equal(ordenesPublicar.length, 1)
  // n8n avisa con el trabajo_id de la orden: GENERADO con el enlace → deja de estar «publicando»; el contenido se conserva
  const ENL = 'https://drive.google.com/file/d/archivo_pub1/view'
  const despues = new Date(Date.now() + 2000).toISOString()
  assert.equal((await enviar(aviso('h5p_recurso', 'h5p', { trabajo_id: tp, ejecucion_id: 'pub-' + tp, unidad: 1, id: 'pub1', estado: 'GENERADO', enlace_recurso: ENL, plantilla: 'g-11-doc-v01', fecha_evento: despues, secuencia: 90 }))).estado, 200)
  f = await lista(); assert.equal(f.estado, 'GENERADO'); assert.equal(f.publicando, false); assert.equal(f.enlaceRecurso, ENL); assert.equal(f.conContenido, true)
  // publicar no es una corrida de generación: el aviso GENERADO de la publicación no crea una corrida «en curso» (la pantalla no debe decir «generando los recursos H5P»)
  assert.equal((await una('ana', 'pipeline_ejecuciones', "ejecucion_id = $2", ['pub-' + tp])).length, 0)
  // volver a aprobar un recurso ya publicado: la orden pide reemplazar el MISMO archivo
  ordenesPublicar.length = 0
  assert.equal((await aprobar(ana)).status, 202)
  assert.equal(ordenesPublicar[0].reemplazar, true); assert.equal(ordenesPublicar[0].enlace_recurso, ENL); assert.equal('imagen_url' in ordenesPublicar[0], false)
  // con imagen https válida en la fila, la orden la lleva de primer nivel; una inválida guardada a mano no se manda
  const IMGP = 'https://drive.google.com/thumbnail?id=pub1&sz=w800'
  await pool.query("UPDATE pipeline_recursos SET imagen_url = $2, aprobado_en = NULL WHERE propietario_id = $1 AND id = 'pub1'", [ids.ana, IMGP])
  ordenesPublicar.length = 0
  assert.equal((await aprobar(ana)).status, 202); assert.equal(ordenesPublicar[0].imagen_url, IMGP)
  await pool.query("UPDATE pipeline_recursos SET imagen_url = 'http://x.co/a.png', aprobado_en = NULL WHERE propietario_id = $1 AND id = 'pub1'", [ids.ana])
  ordenesPublicar.length = 0
  assert.equal((await aprobar(ana)).status, 202); assert.equal('imagen_url' in ordenesPublicar[0], false)
  // un error al publicar: queda ERROR, conserva el contenido y se puede reintentar
  const tardio = new Date(Date.now() + 4000).toISOString()
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'pub-x', unidad: 1, id: 'pub1', estado: 'ERROR', observaciones: 'Drive no respondió', fecha_evento: tardio, secuencia: 91 }))
  f = await lista(); assert.equal(f.estado, 'ERROR'); assert.equal(f.publicando, false); assert.equal(f.conContenido, true)
  // si n8n no acepta la orden, la aprobación se deshace
  publicarFalla = true
  assert.equal((await aprobar(ana)).status, 502)
  publicarFalla = false
  f = await lista(); assert.equal(f.publicando, false)
  assert.equal((await aprobar(ana)).status, 202) // y se puede volver a intentar
  // un contenido nuevo por revisar anula la aprobación anterior
  const nuevo = new Date(Date.now() + 6000).toISOString()
  await enviar(aviso('h5p_recurso', 'h5p', { ejecucion_id: 'p2', unidad: 1, id: 'pub1', estado: 'POR_REVISAR', contenido: { titulo: 'Nuevo', bloques: [] }, fecha_evento: nuevo, secuencia: 92 }))
  f = await lista(); assert.equal(f.estado, 'POR_REVISAR'); assert.equal(f.publicando, false)
})

test('la pantalla recibe qué recursos planificó la corrida (para mostrarlos «en cola» desde el principio)', async () => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo: 'ana@u.co', clave: CLAVE }) })
  const h = { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1' }
  const plan = { a_generar: [{ id: 'x1', codigo: 'U9-T1-R1' }, { id: 'x2' }], omitidas: [] }
  assert.equal((await enviar(aviso('h5p_inicio', 'h5p', { ejecucion_id: 'cola1', plan, fecha_evento: new Date().toISOString(), secuencia: 1 }))).estado, 200)
  const d = await (await fetch(base + '/api/proyectos/curso-a/pipeline', { headers: h })).json()
  const e = d.ejecuciones.find((x) => x.ejecucionId === 'cola1')
  assert.equal(e.plan.aGenerar, 2)
  assert.deepEqual(e.plan.aGenerarClaves, [{ id: 'x1', codigo: 'U9-T1-R1' }, { id: 'x2', codigo: null }])
})

test('vista global: solo quien ve todos los cursos la lee; trae cifras por curso de todas las personas y los avisos sin atribuir', async () => {
  const { Q } = await import('../src/consultas.js')
  const { hashClave } = await import('../src/seguridad.js')
  await pool.query(Q.usuarioCrear, ['Coord', 'coord@u.co', await hashClave(CLAVE), ['coordinador']])
  const entrar = async (correo) => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
    return (ruta) => fetch(base + '/api' + ruta, { headers: { cookie, 'x-ova': '1' } })
  }
  assert.equal((await fetch(base + '/api/pipeline/resumen', { headers: { 'x-ova': '1' } })).status, 401)
  assert.equal((await (await entrar('ana@u.co'))('/pipeline/resumen')).status, 403) // una docente no ve lo de las demás personas
  const r = await (await entrar('coord@u.co'))('/pipeline/resumen')
  assert.equal(r.status, 200)
  const j = await r.json()
  const personas = new Set(j.cursos.map((c) => c.correo))
  assert.ok(personas.has('ana@u.co') && personas.has('beto@u.co')) // el mismo identificador de curso en dos personas sigue siendo dos filas
  const ana = j.cursos.find((c) => c.correo === 'ana@u.co' && c.id === 'curso-a')
  assert.ok(ana.matricesListas >= 1); assert.ok(ana.recursos >= 1); assert.equal(typeof ana.enCurso, 'number'); assert.ok(ana.sinRespuesta >= 1) // lo de la prueba de «sin respuesta»
  assert.ok(j.avisosProblema.some((a) => a.resultado === 'huerfano')) // el aviso sin trabajo de la prueba de huérfanos
  assert.ok(j.avisos24h.aplicados > 0 && j.avisos24h.huerfanos > 0)
  assert.equal(j.secretoConfigurado, true)
})

test('los avisos tal como los arma n8n (cadenas vacías en origen_trabajo_id y enlaces, tema null, fecha con Z) se aceptan y se aplican', async () => {
  // Forma real tomada de una corrida de n8n: el padre manda trabajo_id y deja origen_trabajo_id vacío; las filas traen enlace_recurso ''.
  const comun = { etapa: 'matrices', trabajo_id: T.ana, origen_trabajo_id: '', proyecto_id: 'curso-a', carpeta_raiz: 'https://drive.google.com/drive/folders/carpetaAna', ejecucion_id: '378640' }
  const ahora = Date.now()
  const inicio = { ...comun, evento_id: 'n8n-real-inicio-001', evento: 'matrices_inicio', secuencia: 1, fecha_evento: new Date(ahora - 8000).toISOString(), unidades: [7], forzar: false }
  const fin = {
    ...comun, evento_id: 'n8n-real-fin-0001', evento: 'matrices_fin', secuencia: 2, fecha_evento: new Date(ahora - 1000).toISOString(),
    resultados: [{ unidad: 7, formacion: 'Doctorado', resultado: 'omitida_ya_existe', detalle: 'La matriz ya existia; no se modifico.',
      matriz: { id: 'hoja-real-77', url: 'https://docs.google.com/spreadsheets/d/hoja-real-77/edit', nombre: 'Matriz de recursos - Doctorado - Unidad 7' },
      filas: [
        { id: 'G-00', id_base: 'G-00', variante: '', alcance: 'General', tema: null, codigo: 'U7-PRES · G-00', formato: 'Diapositivas de presentación', titulo: '', con_actividad: false, generador: 'H5P', estado: 'PENDIENTE', observaciones: '', enlace_guion: DOC, enlace_recurso: '' },
        { id: 'G-11-C', id_base: 'G-11', variante: 'C', alcance: 'General', tema: 1, codigo: 'U7-T1-R1 · G-11-C', formato: 'Lecturas', titulo: 'Fundamentos', con_actividad: false, generador: 'H5P', estado: 'PENDIENTE', observaciones: '', enlace_guion: DOC, enlace_recurso: '' }
      ] }]
  }
  const a = await enviar(inicio)
  assert.equal(a.estado, 200, JSON.stringify(a.datos)); assert.equal(a.datos.aplicados, 1)
  const b = await enviar(fin)
  assert.equal(b.estado, 200, JSON.stringify(b.datos)); assert.equal(b.datos.aplicados, 1)
  const m = (await una('ana', 'pipeline_matrices', 'proyecto_id = $2 AND unidad = 7', ['curso-a']))[0]
  assert.equal(m.estado, 'omitida'); assert.equal(m.matriz_url, 'https://docs.google.com/spreadsheets/d/hoja-real-77/edit')
  const filas = await una('ana', 'pipeline_recursos', 'proyecto_id = $2 AND unidad = 7', ['curso-a'])
  assert.equal(filas.length, 2); assert.ok(filas.every((f) => f.enlace_recurso === null))
})

test('el «ID del recurso» del catálogo se repite entre temas: ninguna fila se pierde (se guardan por código) y los avisos de H5P llegan a la fila correcta', async () => {
  const ahora = Date.now()
  const comun = { etapa: 'matrices', trabajo_id: T.ana, proyecto_id: 'curso-a', ejecucion_id: 'rep-1' }
  const f = (id, codigo, tema) => ({ id, id_base: id.slice(0, 4), variante: id.slice(5), alcance: 'General', tema, codigo, formato: 'Formato', titulo: 'T ' + codigo, con_actividad: false, generador: 'H5P', estado: 'PENDIENTE', observaciones: '', enlace_guion: DOC, enlace_recurso: '' })
  const filas = [f('G-08-C', 'U8-T1-R1 · G-08-C', 1), f('G-11-A', 'U8-T1-R2 · G-11-A', 1), f('G-08-C', 'U8-T2-R1 · G-08-C', 2), f('G-11-A', 'U8-T3-R1 · G-11-A', 3), f('G-08-C', 'U8-T3-R2 · G-08-C', 3)]
  const fin = { ...comun, evento_id: 'rep-fin-0001', evento: 'matrices_fin', secuencia: 2, fecha_evento: new Date(ahora - 2000).toISOString(), resultados: [{ unidad: 8, formacion: 'Doctorado', resultado: 'creada', matriz: { id: 'hoja-rep', url: 'https://docs.google.com/spreadsheets/d/hoja-rep/edit', nombre: 'M8' }, filas }] }
  assert.equal((await enviar(fin)).estado, 200)
  const guardadas = await una('ana', 'pipeline_recursos', 'proyecto_id = $2 AND unidad = 8', ['curso-a'])
  assert.equal(guardadas.length, 5) // antes quedaban 2: las filas con el mismo id se pisaban entre sí
  assert.deepEqual(guardadas.map((x) => x.codigo).sort(), filas.map((x) => x.codigo).sort())
  // H5P avisa con el id repetido y el código: se actualiza solo la fila de ese código
  const rec = { etapa: 'h5p', trabajo_id: T.ana, proyecto_id: 'curso-a', ejecucion_id: 'rep-h5p', unidad: 8, id: 'G-08-C', codigo: 'U8-T2-R1 · G-08-C' }
  assert.equal((await enviar({ ...rec, evento_id: 'rep-rec-0001', evento: 'h5p_recurso', estado: 'GENERADO', enlace_recurso: 'https://drive.google.com/file/d/uno/view', secuencia: 1, fecha_evento: new Date(ahora - 1000).toISOString() })).estado, 200)
  const despues = await una('ana', 'pipeline_recursos', 'proyecto_id = $2 AND unidad = 8', ['curso-a'])
  assert.deepEqual(despues.filter((x) => x.estado === 'GENERADO').map((x) => x.codigo), ['U8-T2-R1 · G-08-C'])
  assert.equal(despues.filter((x) => x.estado === 'PENDIENTE').length, 4)
})

test('el mismo «ID del recurso» en DOS unidades del curso no se pisa (la clave es el código de posición); lo guardado antes con el id como clave sigue funcionando y se reemplaza al regenerar su unidad', async () => {
  const ahora = Date.now()
  const comun = { etapa: 'matrices', trabajo_id: T.ana, proyecto_id: 'curso-a', ejecucion_id: 'rep-u' }
  const f = (id, codigo) => ({ id, id_base: id.slice(0, 4), variante: id.slice(5), alcance: 'General', tema: 1, codigo, formato: 'Formato', titulo: 'T ' + codigo, con_actividad: false, generador: 'H5P', estado: 'PENDIENTE', observaciones: '', enlace_guion: DOC, enlace_recurso: '' })
  const fin = (u, filas, sec) => ({ ...comun, evento_id: 'rep-u-fin-' + u + '-' + sec, evento: 'matrices_fin', secuencia: sec, fecha_evento: new Date(ahora - 5000 + sec * 1000).toISOString(), resultados: [{ unidad: u, formacion: 'Doctorado', resultado: 'creada', matriz: { id: 'hoja-u' + u, url: 'https://docs.google.com/spreadsheets/d/hoja-u' + u + '/edit', nombre: 'M' + u }, filas }] })
  // filas con ids que se repiten ENTRE unidades (y ninguno repetido dentro de cada una): antes la de la 2.ª unidad pisaba a la de la 1.ª
  assert.equal((await enviar(fin(21, [f('G-12-A', 'U21-T1-R1'), f('G-09-C', 'U21-T1-R2')], 1))).estado, 200)
  assert.equal((await enviar(fin(22, [f('G-12-A', 'U22-T1-R1'), f('G-09-C', 'U22-T1-R2')], 2))).estado, 200)
  const todas = await una('ana', 'pipeline_recursos', 'proyecto_id = $2 AND unidad IN (21, 22)', ['curso-a'])
  assert.equal(todas.length, 4)
  assert.deepEqual(todas.filter((x) => x.unidad === 21).map((x) => x.id).sort(), ['U21-T1-R1', 'U21-T1-R2'])
  // una fila guardada ANTES con el id como clave (otra unidad, de una corrida anterior)
  await pool.query("INSERT INTO pipeline_recursos (propietario_id, proyecto_id, id, unidad, codigo, estado, actualizado_en, secuencia) VALUES ($1, 'curso-a', 'G-05-A', 23, 'U23-T1-R1', 'PENDIENTE', now() - interval '1 day', 1)", [ids.ana])
  const rec = { etapa: 'h5p', trabajo_id: T.ana, proyecto_id: 'curso-a', ejecucion_id: 'rep-u-h5p', unidad: 23, id: 'G-05-A', codigo: 'U23-T1-R1' }
  assert.equal((await enviar({ ...rec, evento_id: 'rep-u-rec-0001', evento: 'h5p_recurso', estado: 'GENERADO', enlace_recurso: 'https://drive.google.com/file/d/vieja/view', secuencia: 5, fecha_evento: new Date(ahora - 1000).toISOString() })).estado, 200)
  const vieja = await una('ana', 'pipeline_recursos', 'proyecto_id = $2 AND unidad = 23', ['curso-a'])
  assert.equal(vieja.length, 1); assert.equal(vieja[0].id, 'G-05-A'); assert.equal(vieja[0].estado, 'GENERADO') // el aviso llegó a la fila vieja, sin crear otra
  // al volver a generar las matrices de esa unidad, la fila vieja se reemplaza por la de clave nueva
  assert.equal((await enviar(fin(23, [f('G-05-A', 'U23-T1-R1')], 6))).estado, 200)
  const nueva = await una('ana', 'pipeline_recursos', 'proyecto_id = $2 AND unidad = 23', ['curso-a'])
  assert.equal(nueva.length, 1); assert.equal(nueva[0].id, 'U23-T1-R1')
})

test('imagen y consumo del recurso: se guardan, un aviso posterior sin ellos no los borra, lo inválido se ignora y la persona puede cambiar la imagen', async () => {
  const IMG = 'https://drive.google.com/thumbnail?id=abc123&sz=w1600'
  const consumo = { texto: { modelo: 'm', entrada: 1000, salida: 500, llamadas: 2 }, imagenes: [{ modelo: 'i', calidad: 'media', tamano: '1024', uso: 'portada' }], costo_estimado_usd: 0.0421, costo_parcial: false }
  const h = (estado, seg, extra = {}) => aviso('h5p_recurso', 'h5p', { ejecucion_id: 'img', unidad: 8, id: 'img1', estado, ...extra }, 300 + seg)
  assert.equal((await enviar(h('GENERADO', 1, { imagen_url: IMG, consumo }))).datos.aplicados, 1)
  let f = (await una('ana', 'pipeline_recursos', "id = 'img1'"))[0]
  assert.equal(f.imagen_url, IMG); assert.equal(f.consumo.costo_estimado_usd, 0.0421); assert.equal(f.consumo.texto.entrada, 1000)
  // aviso posterior sin los campos (o con basura): no los pisa y el aviso se aplica
  assert.equal((await enviar(h('GENERADO', 2, { enlace_recurso: 'https://drive.google.com/file/d/x1/view' }))).datos.aplicados, 1)
  const mal = await enviar(h('GENERADO', 3, { imagen_url: 'http://inseguro.example/a.png', consumo: 'texto' }))
  assert.equal(mal.estado, 200); assert.equal(mal.datos.aplicados, 1)
  assert.equal((await enviar(h('GENERADO', 4, { imagen_url: 'https://x.co/a b.png' }))).datos.aplicados, 1)
  f = (await una('ana', 'pipeline_recursos', "id = 'img1'"))[0]
  assert.equal(f.estado, 'GENERADO'); assert.equal(f.imagen_url, IMG); assert.equal(f.consumo.costo_estimado_usd, 0.0421)
  // lectura y cambio manual (solo la persona dueña del curso)
  const entrar = async (correo) => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
    return (ruta, metodo = 'GET', cuerpo) => fetch(base + '/api' + ruta, { method: metodo, headers: { cookie, 'x-ova': '1', 'content-type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
  }
  const ana = await entrar('ana@u.co')
  const lista = await (await ana('/proyectos/curso-a/pipeline')).json()
  const leida = lista.recursos.find((x) => x.id === 'img1')
  assert.equal(leida.imagenUrl, IMG); assert.equal(leida.consumo.costo_estimado_usd, 0.0421)
  const NUEVA = 'https://drive.google.com/thumbnail?id=nueva&sz=w800'
  const ruta = '/proyectos/curso-a/pipeline/recursos/imagen'
  assert.equal((await ana(ruta, 'PUT', { recursoId: 'img1', imagenUrl: 'http://x.co/a.png' })).status, 400)
  assert.equal((await ana(ruta, 'PUT', { recursoId: 'img1', imagenUrl: 'https://x.co/a b' })).status, 400)
  assert.equal((await ana(ruta, 'PUT', { recursoId: 'no-hay', imagenUrl: NUEVA })).status, 404)
  assert.equal((await ana(ruta, 'PUT', { recursoId: 'img1', imagenUrl: NUEVA })).status, 200)
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'img1'"))[0].imagen_url, NUEVA)
  assert.equal((await una('beto', 'pipeline_recursos', "id = 'img1'")).length, 0) // el curso de Beto (mismo identificador) no se toca
  const beto = await entrar('beto@u.co')
  assert.equal((await beto(ruta, 'PUT', { recursoId: 'img1', imagenUrl: NUEVA })).status, 404) // su curso no tiene ese recurso
})

test('partes del recurso (actividad y bibliografía): guardado con COALESCE, parte inválida ignorada, edición por parte, orden de publicar y regenerar', async () => {
  const entrar = async (correo) => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
    return (ruta, metodo = 'GET', cuerpo) => fetch(base + '/api' + ruta, { method: metodo, headers: { cookie, 'x-ova': '1', 'content-type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
  }
  const ana = await entrar('ana@u.co'), beto = await entrar('beto@u.co')
  await ana('/proyectos/curso-a', 'PUT', { id: 'curso-a', programa: 'P', curso: 'Curso A', creado: Date.now(), carpetaUrl: 'https://drive.google.com/drive/folders/carpetaAna', recursos: [], guiones: [], info: {} })
  const ACT = { plantilla: 'act-quiz-v01', contenido: { titulo: 'Quiz', preguntas: [{ texto: 'p1' }] }, imagen_url: 'https://x.co/a.png' }
  const BIB = { plantilla: 'bib-v01', contenido: { titulo: 'Bibliografía', items: [{ ref: 'r1' }] } }
  const h = (seg, extra = {}) => aviso('h5p_recurso', 'h5p', { ejecucion_id: 'pt', unidad: 9, id: 'pt1', codigo: 'U9-T1-R1', estado: 'POR_REVISAR', plantilla: 'g-11-doc-v01', ...extra }, 600 + seg)
  const GUION = { tipo: 'quiz', nombre: 'Quiz final', instrucciones: 'Responda' }
  // parte inválida (plantilla mala, contenido no objeto) se ignora sin rechazar el aviso
  const mal = await enviar(h(1, { contenido: { titulo: 'R', bloques: [] }, tipo_actividad: 'Quiz', actividad: { plantilla: 'MAL NOMBRE!', contenido: {} }, bibliografia: { plantilla: 'bib-v01', contenido: 'texto' } }))
  assert.equal(mal.estado, 200); assert.equal(mal.datos.aplicados, 1)
  let f = (await una('ana', 'pipeline_recursos', "id = 'pt1'"))[0]
  assert.equal(f.tipo_actividad, 'Quiz'); assert.equal(f.actividad, null); assert.equal(f.bibliografia, null)
  const rutaImg = '/proyectos/curso-a/pipeline/recursos/imagen'
  assert.equal((await ana(rutaImg, 'PUT', { recursoId: 'pt1', imagenUrl: 'https://x.co/n.png', parte: 'actividad' })).status, 404) // sin actividad
  // las 4 columnas se guardan
  assert.equal((await enviar(h(2, { actividad_guion: GUION, actividad: ACT, bibliografia: { ...BIB, contenido: JSON.stringify(BIB.contenido) } }))).datos.aplicados, 1)
  f = (await una('ana', 'pipeline_recursos', "id = 'pt1'"))[0]
  const NUEVA = 'https://x.co/nueva.png'
  assert.equal((await ana(rutaImg, 'PUT', { recursoId: 'pt1', imagenUrl: NUEVA, parte: 'actividad' })).status, 200)
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'pt1'"))[0].actividad.imagen_url, NUEVA)
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'pt1'"))[0].actividad.plantilla, 'act-quiz-v01')
  assert.equal((await ana(rutaImg, 'PUT', { recursoId: 'pt1', imagenUrl: NUEVA, parte: 'otra' })).status, 400)
  assert.equal((await beto(rutaImg, 'PUT', { recursoId: 'pt1', imagenUrl: NUEVA, parte: 'actividad' })).status, 404)
  assert.equal((await ana(rutaImg, 'PUT', { recursoId: 'pt1', imagenUrl: '', parte: 'actividad' })).status, 200)
  assert.equal('imagen_url' in (await una('ana', 'pipeline_recursos', "id = 'pt1'"))[0].actividad, false)
  await ana(rutaImg, 'PUT', { recursoId: 'pt1', imagenUrl: 'https://x.co/a.png', parte: 'actividad' })
  assert.deepEqual(f.actividad_guion, GUION); assert.deepEqual(f.actividad, ACT); assert.deepEqual(f.bibliografia, BIB)
  // un aviso posterior sin esos campos no los borra
  assert.equal((await enviar(h(3, { estado: 'GENERADO' }))).datos.aplicados, 1)
  f = (await una('ana', 'pipeline_recursos', "id = 'pt1'"))[0]
  assert.equal(f.tipo_actividad, 'Quiz'); assert.deepEqual(f.actividad, ACT); assert.deepEqual(f.bibliografia, BIB)
  await pool.query("UPDATE pipeline_recursos SET estado = 'POR_REVISAR' WHERE propietario_id = $1 AND id = 'pt1'", [ids.ana])
  // lectura: la lista trae banderas; el detalle trae las partes completas
  const lista = (await (await ana('/proyectos/curso-a/pipeline')).json()).recursos.find((x) => x.codigo === 'U9-T1-R1')
  assert.equal(lista.tieneActividad, true); assert.equal(lista.tieneBibliografia, true); assert.equal(lista.tipoActividad, 'Quiz'); assert.deepEqual(lista.actividadGuion, GUION); assert.equal('actividad' in lista, false)
  const ruta = '/proyectos/curso-a/pipeline/recursos/' + lista.id + '/contenido'
  const det = await (await ana(ruta)).json()
  assert.deepEqual(det.actividad, ACT); assert.deepEqual(det.bibliografia, BIB)
  // edición por parte: misma estructura sí, otra no, parte inválida 400, ajeno 404
  const okA = { titulo: 'Quiz editado', preguntas: [{ texto: 'otra' }] }
  assert.equal((await ana(ruta, 'PUT', { parte: 'actividad', contenido: okA })).status, 200)
  assert.equal((await ana(ruta, 'PUT', { parte: 'actividad', contenido: { titulo: 'x' } })).status, 400)
  assert.equal((await ana(ruta, 'PUT', { parte: 'otra', contenido: okA })).status, 400)
  assert.equal((await ana(ruta, 'PUT', { parte: 'bibliografia', contenido: { titulo: 'B2', items: [{ ref: 'r2' }] } })).status, 200)
  assert.equal((await beto(ruta, 'PUT', { parte: 'actividad', contenido: okA })).status, 404)
  assert.equal((await ana(ruta, 'PUT', { contenido: { titulo: 'R2', bloques: [] } })).status, 200) // por defecto: el recurso
  f = (await una('ana', 'pipeline_recursos', "id = 'pt1'"))[0]
  assert.deepEqual(f.actividad.contenido, okA); assert.equal(f.actividad.plantilla, ACT.plantilla); assert.equal(f.actividad.imagen_url, ACT.imagen_url)
  assert.ok(f.actividad_editado_en); assert.ok(f.bibliografia_editado_en); assert.equal(f.bibliografia.contenido.items[0].ref, 'r2')
  // regenerar (marcar EN_PROCESO) conserva las partes hasta el aviso nuevo; el aviso nuevo con una parte borra solo su *_editado_en
  const { Q } = await import('../src/consultas.js')
  await pool.query(Q.pipeRegenerarMarcar, [ids.ana, 'curso-a', [lista.id]])
  f = (await una('ana', 'pipeline_recursos', "id = 'pt1'"))[0]
  assert.equal(f.estado, 'EN_PROCESO'); assert.deepEqual(f.actividad.contenido, okA); assert.ok(f.bibliografia_editado_en)
  assert.equal((await enviar(h(10, { actividad: ACT, fecha_evento: new Date(Date.now() + 60000).toISOString(), secuencia: 99 }))).datos.aplicados, 1)
  f = (await una('ana', 'pipeline_recursos', "id = 'pt1'"))[0]
  assert.deepEqual(f.actividad, ACT); assert.equal(f.actividad_editado_en, null); assert.ok(f.bibliografia_editado_en)
  // publicar: con partes la orden las lleva (contenido vigente); sin ellas no manda las claves
  ordenesPublicar.length = 0
  assert.equal((await ana('/proyectos/curso-a/pipeline/recursos/' + lista.id + '/aprobar', 'POST')).status, 202)
  const o = ordenesPublicar[0]
  assert.deepEqual(o.actividad, ACT); assert.deepEqual(o.bibliografia, { plantilla: BIB.plantilla, contenido: { titulo: 'B2', items: [{ ref: 'r2' }] } })
  await pool.query("UPDATE pipeline_recursos SET actividad = NULL, bibliografia = NULL, aprobado_en = NULL WHERE propietario_id = $1 AND id = 'pt1'", [ids.ana])
  ordenesPublicar.length = 0
  assert.equal((await ana('/proyectos/curso-a/pipeline/recursos/' + lista.id + '/aprobar', 'POST')).status, 202)
  assert.equal('actividad' in ordenesPublicar[0], false); assert.equal('bibliografia' in ordenesPublicar[0], false)
})

test('regenerar ignorado por n8n: la fila vuelve a su estado previo con observación (inicio con omitidas, fin sin procesar, vencidas) y un aviso normal limpia estado_previo', async () => {
  const { Q } = await import('../src/consultas.js')
  const f = (seg) => new Date(Date.now() + 120000 + seg * 1000).toISOString()
  const av = (evento, extra, seg) => aviso(evento, 'h5p', { ...extra, fecha_evento: f(seg), secuencia: 5000 + seg }, 0)
  const rec = (id, estado, seg, extra = {}) => enviar(av('h5p_recurso', { ejecucion_id: 'rg0', unidad: 7, id, codigo: 'U7-' + id, estado, plantilla: 'g-11-doc-v01', ...extra }, seg))
  const ids7 = ['ra', 'rb', 'rc', 'rd', 're']
  await rec('ra', 'POR_REVISAR', 0); await rec('rb', 'GENERADO', 0, { enlace_recurso: 'https://drive.google.com/file/d/xx/view' }); await rec('rc', 'POR_REVISAR', 0); await rec('rd', 'ERROR', 0); await rec('re', 'POR_REVISAR', 0)
  const est = async (id) => (await una('ana', 'pipeline_recursos', 'id = $2', [id]))[0]
  await pool.query(Q.pipeRegenerarMarcar, [ids.ana, 'curso-a', ids7])
  assert.deepEqual(await Promise.all(ids7.map(async (i) => { const r = await est(i); return r.estado + '/' + r.estado_previo })),
    ['EN_PROCESO/POR_REVISAR', 'EN_PROCESO/GENERADO', 'EN_PROCESO/POR_REVISAR', 'EN_PROCESO/ERROR', 'EN_PROCESO/POR_REVISAR'])
  // inicio: ra omitida (vuelve), rb en a_generar (no se toca), rc/rd/re sin mencionar (siguen)
  await enviar(av('h5p_inicio', { ejecucion_id: 'rg1', plan: { a_generar: [{ id: 'rb', codigo: 'U7-rb' }, { id: 'rd', codigo: 'U7-rd' }], omitidas: [{ id: 'ra', codigo: 'U7-ra', motivo: 'estado_no_pendiente' }] } }, 10))
  let r = await est('ra'); assert.equal(r.estado, 'POR_REVISAR'); assert.equal(r.estado_previo, null); assert.equal(r.observaciones, 'No se regeneró: n8n lo omitió (estado_no_pendiente)')
  r = await est('rb'); assert.equal(r.estado, 'EN_PROCESO'); assert.equal(r.estado_previo, 'GENERADO')
  // un aviso viejo (anterior al marcado) no revierte
  // fin: rc y re no estaban en a_generar -> vuelven; rb/rd (en el plan) no se tocan
  await enviar(av('h5p_fin', { ejecucion_id: 'rg1', resumen: { generados: 0 } }, 20))
  r = await est('rc'); assert.equal(r.estado, 'POR_REVISAR'); assert.equal(r.observaciones, 'No se regeneró: la corrida terminó sin procesarlo')
  assert.equal((await est('re')).estado_previo, null)
  assert.equal((await est('rb')).estado, 'EN_PROCESO'); assert.equal((await est('rd')).estado_previo, 'ERROR')
  // un h5p_recurso normal limpia estado_previo
  await rec('rb', 'GENERADO', 30, { enlace_recurso: 'https://drive.google.com/file/d/yy/view' }); await rec('rd', 'POR_REVISAR', 30)
  assert.equal((await est('rb')).estado_previo, null); assert.equal((await est('rd')).estado, 'POR_REVISAR')
  // filas EN_PROCESO vencidas (>30 min, sin estado_previo): se pueden volver a marcar; las recientes no
  await pool.query("UPDATE pipeline_recursos SET estado = 'EN_PROCESO', estado_previo = NULL, actualizado_en = now() - interval '40 minutes' WHERE propietario_id = $1 AND id IN ('ra','rb','rc')", [ids.ana])
  await pool.query("UPDATE pipeline_recursos SET contenido = '{\"titulo\":\"x\"}'::jsonb WHERE propietario_id = $1 AND id = 'ra'", [ids.ana])
  await pool.query("UPDATE pipeline_recursos SET contenido = NULL, enlace_recurso = NULL WHERE propietario_id = $1 AND id = 'rc'", [ids.ana])
  await pool.query("UPDATE pipeline_recursos SET estado = 'EN_PROCESO', actualizado_en = now() WHERE propietario_id = $1 AND id = 're'", [ids.ana])
  const lect = (await pool.query(Q.pipeRegenerarLeer, [ids.ana, 'curso-a', ['U7-ra', 'U7-re']])).rows
  assert.equal(lect.find((x) => x.codigo === 'U7-ra').vencida, true); assert.equal(lect.find((x) => x.codigo === 'U7-re').vencida, false)
  await pool.query(Q.pipeRegenerarMarcar, [ids.ana, 'curso-a', ['ra', 'rb', 'rc', 're']])
  assert.deepEqual(await Promise.all(['ra', 'rb', 'rc', 're'].map(async (i) => (await est(i)).estado_previo)), ['POR_REVISAR', 'GENERADO', 'ERROR', null])
})

test('alerta_actividad: el aviso con el campo manda (vacío limpia), sin el campo se conserva, una actividad nueva por revisar la limpia, y un valor no válido se ignora', async () => {
  const { Q } = await import('../src/consultas.js')
  const h = (estado, seg, extra = {}) => aviso('h5p_recurso', 'h5p', { ejecucion_id: 'al', unidad: 1, id: 'al1', estado, ...extra }, seg)
  const alerta = async () => (await una('ana', 'pipeline_recursos', 'id = $2', ['al1']))[0].alerta_actividad
  const TXT = 'ALERTA actividad sin asignar: el tipo «X» del guion no coincide; corríjalo y regenere el recurso'
  assert.equal((await enviar(h('POR_REVISAR', 600, { alerta_actividad: TXT }))).estado, 200)
  assert.equal(await alerta(), TXT)
  await enviar(h('EN_PROCESO', 601)) // sin el campo: se conserva
  assert.equal(await alerta(), TXT)
  const lect = (await pool.query(Q.pipeLeerRecursos, [ids.ana, 'curso-a'])).rows.find((x) => x.id === 'al1')
  assert.equal(lect.alertaActividad, TXT)
  await enviar(h('POR_REVISAR', 602, { alerta_actividad: '' })) // vacío: sin alerta
  assert.equal(await alerta(), null)
  await enviar(h('POR_REVISAR', 603, { alerta_actividad: TXT }))
  await enviar(h('POR_REVISAR', 604, { actividad: { plantilla: 'act-v01', contenido: { titulo: 'Act' } } })) // actividad nueva sin el campo: la limpia
  assert.equal(await alerta(), null)
  await enviar(h('GENERADO', 605, { alerta_actividad: TXT }))
  assert.equal((await enviar(h('GENERADO', 606, { alerta_actividad: 42 }))).estado, 200) // no es texto: se ignora, el aviso se acepta
  assert.equal(await alerta(), TXT) // y como si no viniera: se conserva
})

test('matrices_fin «actualizada»: se acepta, cuenta como matriz lista y no degrada recursos que Praxia ya tiene; «reemplazada» sigue igual', async () => {
  const comunes = { trabajo_id: T.ana, ejecucion_id: 'conservar' }
  assert.equal((await enviar(aviso('matrices_inicio', 'matrices', { ...comunes, unidades: [11], forzar: false, conservar: true }, 800))).estado, 200)
  await enviar(aviso('matrices_fin', 'matrices', { ...comunes, resultados: [{ unidad: 11, resultado: 'creada', matriz: { id: 'M11', url: HOJA }, filas: [fila('x11'), fila('y11')] }] }, 801))
  await enviar(aviso('h5p_recurso', 'h5p', { ...comunes, unidad: 11, id: 'x11', estado: 'GENERADO', enlace_recurso: 'https://drive.google.com/file/d/x11/view', contenido: { a: 1 }, observaciones: 'listo' }, 802))
  const r = await enviar(aviso('matrices_fin', 'matrices', { ...comunes, resultados: [{ unidad: 11, resultado: 'actualizada', matriz: { id: 'M11', url: HOJA }, detalle: 'Se conservó la matriz', filas: [fila('x11', 'PENDIENTE'), fila('y11', 'PENDIENTE')] }] }, 803))
  assert.equal(r.estado, 200, JSON.stringify(r.datos))
  assert.equal((await una('ana', 'pipeline_matrices', 'unidad = 11'))[0].estado, 'actualizada')
  const x = (await una('ana', 'pipeline_recursos', "id = 'x11'"))[0]
  assert.equal(x.estado, 'GENERADO'); assert.deepEqual(x.contenido, { a: 1 }); assert.equal(x.enlace_recurso, 'https://drive.google.com/file/d/x11/view'); assert.equal(x.observaciones, 'listo')
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'y11'"))[0].estado, 'PENDIENTE')
  // «reemplazada» mantiene su comportamiento: la fila toma el estado de la hoja
  await enviar(aviso('matrices_fin', 'matrices', { ...comunes, resultados: [{ unidad: 11, resultado: 'reemplazada', matriz: { id: 'M11b', url: HOJA }, filas: [fila('x11', 'PENDIENTE'), fila('y11', 'PENDIENTE')] }] }, 804))
  assert.equal((await una('ana', 'pipeline_matrices', 'unidad = 11'))[0].estado, 'reemplazada')
  assert.equal((await una('ana', 'pipeline_recursos', "id = 'x11'"))[0].estado, 'PENDIENTE')
})
