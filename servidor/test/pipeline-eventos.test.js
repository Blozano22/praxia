// Receptor de avisos de n8n (pipeline guiones → matrices → H5P): firma, contrato, idempotencia, orden, atribución al curso correcto y
// aislamiento entre personas. Usa un «n8n simulado» que firma los avisos igual que lo hará el subflujo real.
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
const PUERTO_PG = 54337
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-pip-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789'
const SECRETO_ANTERIOR = 'secreto-anterior-0123456789abcdef0123456789'
const DOC = 'https://docs.google.com/document/d/guion_1-abc'
const HOJA = 'https://docs.google.com/spreadsheets/d/matriz_1-abc/edit'

let servidor, base, pool
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
  for (const f of ['001_esquema.sql', '002_bibliografia.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await dueno.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.N8N_EVENTOS_SECRETO = SECRETO
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
const fila = (id, estado = 'PENDIENTE', extra = {}) => ({ id, id_base: 'b-' + id, codigo: 'U1-T1-' + id, formato: 'Línea de tiempo', titulo: 'Título ' + id, generador: 'H5P', estado, enlace_guion: DOC, ...extra })

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
