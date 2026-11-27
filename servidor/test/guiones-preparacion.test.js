// «Generar guiones» con preparación del curso: el trabajo del servidor exige todas las unidades aprobadas, llama al flujo de n8n de preparación (que asigna las
// variantes pidiéndoselas a Praxia) y ESPERA su respuesta, y entrega al flujo de guiones las variantes de la unidad. Usa un n8n simulado que se comporta como el real:
// la preparación llama a Praxia (firmada) y los guiones solo anotan lo recibido.
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
const PUERTO_PG = 54346
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-gprep-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789'
const CARPETA = 'https://drive.google.com/drive/folders/carpetaGuiones1'

let servidor, base, pool, dueno, n8n
const ids = {}
const prep = [] // lo que recibió el flujo de preparación
const guiones = [] // lo que recibió el flujo de guiones
let planPrep = {} // proyecto → recursos que el flujo de preparación pedirá a Praxia
let falloPrep = null // { estado, cuerpo } para que la preparación falle
let pausaPrep = null // promesa que retiene la respuesta de la preparación

const firmar = (cuerpo) => { const fecha = Math.floor(Date.now() / 1000); return { 'x-praxia-fecha': String(fecha), 'x-praxia-firma': crypto.createHmac('sha256', SECRETO).update(fecha + '.' + cuerpo).digest('hex') } }

before(async () => {
  await servidorPg.initialise(); await servidorPg.start(); await servidorPg.createDatabase('ova')
  dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql', '012_banco_iconos.sql', '013_asignacion_por_unidad.sql', '014_tipo_bibliografia.sql', '015_imagen_consumo_recurso.sql', '017_partes_recurso.sql', '018_estado_previo.sql', '019_actividad_tipos.sql', '020_alerta_actividad.sql', '021_matriz_actualizada.sql', '024_curso_diseno.sql', '025_asignar_diseno.sql', '026_correcciones.sql', '027_cola_regenerar.sql', '028_cola_partes.sql', '029_permiso_h5p.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  n8n = http.createServer((req, res) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', async () => {
      const cuerpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')
      const responder = (estado, obj) => { res.writeHead(estado, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.url === '/webhook/guiones') { guiones.push(cuerpo); return responder(200, { archivos: [{ nombre: 'Guion', tema: 1 }] }) }
      prep.push(cuerpo)
      if (pausaPrep) await pausaPrep
      if (falloPrep) return responder(falloPrep.estado, falloPrep.cuerpo)
      // como el flujo real: pide a Praxia (firmado) las variantes de los recursos que sacó de las estructuras
      const recursos = planPrep[cuerpo.proyecto_id] || []
      if (recursos.length) {
        const c = JSON.stringify({ trabajo_id: cuerpo.trabajo_id, formacion: cuerpo.formacion, forzar: cuerpo.forzar, recursos })
        const r = await fetch(base + '/api/n8n/asignaciones/pedir', { method: 'POST', headers: { 'content-type': 'application/json', ...firmar(c) }, body: c })
        if (!r.ok) return responder(500, { error: 'Praxia rechazó el pedido: ' + r.status })
      }
      responder(200, { ok: true })
    })
  }).listen(0)
  const puerto = n8n.address().port
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.PRUEBAS_PLANTILLAS = '0' // por defecto el modo de pruebas de plantillas está encendido; estas pruebas parten de apagado
  process.env.N8N_EVENTOS_SECRETO = SECRETO
  process.env.N8N_PREPARACION_URL = 'http://127.0.0.1:' + puerto + '/webhook/preparacion'
  process.env.LIMITE_LOGIN = '1000'
  process.env.LIMITE_GUIONES = '1000'
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  ids.ana = (await pool.query(Q.usuarioCrear, ['Ana', 'ana@u.co', await hashClave(CLAVE), ['docente']])).rows[0].id
  await dueno.query("INSERT INTO configuracion (clave, valor) VALUES ('n8n.guiones', $1)", ['http://127.0.0.1:' + puerto + '/webhook/guiones'])
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})
after(async () => {
  servidor && servidor.close()
  n8n && n8n.close()
  pool && (await pool.end())
  dueno && (await dueno.end())
  await servidorPg.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const h = { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1', 'content-type': 'application/json' }
  return (m, ruta, cuerpo) => fetch(base + '/api' + ruta, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
}
const esperar = async (fn, ms = 8000) => {
  const fin = Date.now() + ms
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > fin) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 40)) }
}
const curso = (id, aprobadas = [1, 2], nivel = 'Tecnológico') => ({
  id, programa: 'P', curso: 'Curso ' + id, creado: Date.now(), syllabusUrl: 'https://docs.google.com/document/d/syllabusX1234', carpetaUrl: CARPETA,
  syllabus: { estado: 'listo', mensaje: '', documentos: [1, 2].map((u) => ({ unidad: u, nombre: 'Unidad ' + u, url: 'https://docs.google.com/document/d/g' + u + 'abcdefghij', aprobado: aprobadas.includes(u), visto: true, temas: [] })) },
  recursos: [], guiones: [], info: nivel ? { nivel } : {}
})
// Una lectura de bibliografía completa del curso (como dueño de la base: la API la crea leyendo Google Docs).
async function bibliografia(proyecto) {
  const bib = crypto.randomUUID()
  await dueno.query("INSERT INTO bib_trabajos (id, propietario_id, proyecto_id, estado, total, resueltas) VALUES ($1, $2, $3, 'listo', 2, 2)", [bib, ids.ana, proyecto])
  for (const u of [1, 2]) await dueno.query("INSERT INTO bib_fuentes (trabajo_id, propietario_id, orden, entrada_cruda, unidad, categoria, estado, titulo, referencia_apa, cita_apa) VALUES ($1, $2, $3, 'Autor (2020). Libro.', $4, 'basica', 'resuelta', 'Libro', 'Autor (2020). Libro.', '(Autor, 2020)')", [bib, ids.ana, u, u])
  return bib
}
const categoria = async (id, formacion = 'tecnologico') => { await dueno.query('INSERT INTO plantilla_categorias (id, nombre) VALUES ($1, $1)', [id]); await dueno.query('INSERT INTO plantilla_categoria_formacion (categoria, formacion) VALUES ($1, $2)', [id, formacion]) }
const variante = async (nombre, cat, formacion = 'tecnologico') => {
  await dueno.query("INSERT INTO plantilla_subidas (nombre, html_crudo, html, subida_nombre, formacion) VALUES ($1, 'x', 'x', 'prueba', $2)", [nombre, formacion])
  await dueno.query('INSERT INTO plantilla_categoria (plantilla, categoria) VALUES ($1, $2)', [nombre, cat])
  await dueno.query("INSERT INTO plantilla_historial (plantilla, estado, observacion, usuario_nombre) VALUES ($1, 'aprobada', 'ok', 'Dani')", ['pub-' + nombre])
}
const rec = (codigo, cat) => ({ codigo, categoria: cat, id_catalogo: cat + '-A', id_base: cat })
const pedido = (proyecto, bib, unidad, extra = {}) => ({ proyecto, unidad, unidadUrl: 'https://docs.google.com/document/d/g' + unidad + 'abcdefghij', syllabusUrl: 'https://docs.google.com/document/d/syllabusX1234', bibliografiaId: bib, ...extra })
const trabajo = async (ana, proyecto, unidad) => (await (await ana('GET', '/guiones/trabajos')).json()).find((t) => t.proyecto === proyecto && t.unidad === unidad)
const terminado = (ana, proyecto, unidad) => esperar(async () => { const t = await trabajo(ana, proyecto, unidad); return t && t.estado !== 'en_curso' ? t : null })
const limpiar = async (ana, t) => { await ana('DELETE', '/guiones/trabajos/' + t.id) }

test('sin todas las unidades aprobadas no se genera nada (lo exige el servidor, no solo la pantalla)', async () => {
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('PUT', '/proyectos/curso-sin', curso('curso-sin', [1]))).status, 200)
  const bib = await bibliografia('curso-sin')
  const r = await ana('POST', '/guiones/trabajos', pedido('curso-sin', bib, 1))
  assert.equal(r.status, 409)
  assert.match((await r.json()).error, /todas las unidades están aprobadas.*Faltan por aprobar: 2/)
  assert.equal(prep.length + guiones.length, 0) // no se llamó a n8n
})

test('la preparación asigna las variantes de todo el curso y los guiones de cada unidad reciben las suyas; lo asignado se reutiliza', async () => {
  const ana = await entrar('ana@u.co')
  await categoria('TST-01')
  for (const n of [1, 2]) await variante('tst-01-v0' + n, 'TST-01')
  assert.equal((await ana('PUT', '/proyectos/curso-g', curso('curso-g'))).status, 200)
  const bib = await bibliografia('curso-g')
  planPrep['curso-g'] = [rec('U1-PRES', 'TST-01'), rec('U1-T1-R1', 'TST-01'), rec('U2-PRES', 'TST-01'), rec('U2-T1-R1', 'TST-01'), rec('U2-T1-R2', 'TST-01')] // la unidad 2 tiene más recursos que variantes (2): el último se queda sin variante
  const r = await ana('POST', '/guiones/trabajos', pedido('curso-g', bib, 1))
  assert.equal(r.status, 202)
  const t1 = await terminado(ana, 'curso-g', 1)
  assert.equal(t1.estado, 'listo', t1.error)
  // el flujo de preparación recibió la orden con lo que necesita
  assert.equal(prep.length, 1)
  assert.equal(prep[0].proyecto_id, 'curso-g'); assert.equal(prep[0].formacion, 'tecnologico'); assert.equal(prep[0].carpeta_raiz, CARPETA); assert.equal(prep[0].forzar, false)
  assert.deepEqual(prep[0].unidades_detalle.map((u) => u.numero), [1, 2]); assert.match(prep[0].unidades_detalle[0].url, /^https:\/\/docs\.google\.com\/document\/d\//)
  assert.equal((await pool.query("SELECT etapa FROM pipeline_origen WHERE trabajo_id = $1", [prep[0].trabajo_id])).rows[0].etapa, 'preparacion')
  // el flujo de guiones recibió, además de lo de siempre, las variantes de ESA unidad (y solo de ella)
  assert.equal(guiones.length, 1)
  assert.deepEqual(guiones[0].asignaciones.map((a) => [a.codigo, a.categoria, a.plantilla]), [['U1-PRES', 'TST-01', 'tst-01-v01'], ['U1-T1-R1', 'TST-01', 'tst-01-v02']])
  assert.equal(guiones[0].bibliografia.fuentes.every((f) => f.unidad === 1), true); assert.equal(guiones[0].unidad, 1)
  await limpiar(ana, t1)
  // la unidad 2 tiene un recurso sin variante: el trabajo falla con un mensaje que dice cuál y por qué. Como algo quedó pendiente, se vuelve a preparar.
  const r2 = await ana('POST', '/guiones/trabajos', pedido('curso-g', bib, 2))
  assert.equal(r2.status, 202)
  const t2 = await terminado(ana, 'curso-g', 2)
  assert.equal(t2.estado, 'error'); assert.match(t2.error, /unidad 2 \(1 recurso\):\n• Ya no quedan variantes libres[^:]*: TST-01\n/)
  assert.equal(prep.length, 2); assert.equal(guiones.length, 1) // no se generaron guiones con huecos
  await limpiar(ana, t2)
  // se aprueba otra variante: al volver a generar la unidad 2 se resuelve, y lo de la unidad 1 sigue igual
  await variante('tst-01-v03', 'TST-01')
  const r3 = await ana('POST', '/guiones/trabajos', pedido('curso-g', bib, 2))
  assert.equal(r3.status, 202)
  const t3 = await terminado(ana, 'curso-g', 2)
  assert.equal(t3.estado, 'listo', t3.error)
  assert.deepEqual(guiones[1].asignaciones.map((a) => [a.codigo, a.plantilla]), [['U2-PRES', 'tst-01-v01'], ['U2-T1-R1', 'tst-01-v02'], ['U2-T1-R2', 'tst-01-v03']])
  await limpiar(ana, t3)
  // con todo asignado, otra generación de una unidad NO vuelve a llamar a la preparación: se reutiliza lo asignado
  assert.equal(prep.length, 3) // la 1.ª (curso entero), la 2.ª (unidad 2 con algo pendiente) y la 3.ª (al aprobarse otra variante)
  const r4 = await ana('POST', '/guiones/trabajos', pedido('curso-g', bib, 1))
  assert.equal(r4.status, 202)
  const t4 = await terminado(ana, 'curso-g', 1)
  assert.equal(t4.estado, 'listo', t4.error)
  assert.equal(prep.length, 3) // no hubo una 4.ª llamada
  assert.deepEqual(guiones[2].asignaciones.map((a) => a.plantilla), ['tst-01-v01', 'tst-01-v02'])
  await limpiar(ana, t4)
  // «reasignar» pide volver a repartir todo el curso (el flujo recibe forzar: true)
  const antes = prep.length
  const r5 = await ana('POST', '/guiones/trabajos', pedido('curso-g', bib, 1, { reasignar: true }))
  assert.equal(r5.status, 202)
  const t5 = await terminado(ana, 'curso-g', 1)
  assert.equal(t5.estado, 'listo', t5.error)
  assert.equal(prep.length, antes + 1); assert.equal(prep[antes].forzar, true)
  await limpiar(ana, t5)
})

test('dos unidades pedidas a la vez comparten una sola preparación y no repiten variantes', async () => {
  const ana = await entrar('ana@u.co')
  await categoria('TST-02')
  for (const n of [1, 2, 3, 4]) await variante('tst-02-v0' + n, 'TST-02')
  assert.equal((await ana('PUT', '/proyectos/curso-h', curso('curso-h'))).status, 200)
  const bib = await bibliografia('curso-h')
  planPrep['curso-h'] = [rec('U1-PRES', 'TST-02'), rec('U1-T1-R1', 'TST-02'), rec('U2-PRES', 'TST-02'), rec('U2-T1-R1', 'TST-02')]
  const antesPrep = prep.length, antesGui = guiones.length
  let soltar
  pausaPrep = new Promise((r) => { soltar = r }) // la preparación tarda: la segunda unidad llega mientras tanto
  const [a, b] = await Promise.all([ana('POST', '/guiones/trabajos', pedido('curso-h', bib, 1)), ana('POST', '/guiones/trabajos', pedido('curso-h', bib, 2))])
  assert.equal(a.status, 202); assert.equal(b.status, 202)
  await esperar(() => prep.length > antesPrep)
  await new Promise((r) => setTimeout(r, 150))
  pausaPrep = null; soltar()
  const [t1, t2] = [await terminado(ana, 'curso-h', 1), await terminado(ana, 'curso-h', 2)]
  assert.equal(t1.estado, 'listo', t1.error); assert.equal(t2.estado, 'listo', t2.error)
  assert.equal(prep.length - antesPrep, 1) // una sola llamada a la preparación
  const nuevos = guiones.slice(antesGui)
  assert.equal(nuevos.length, 2)
  for (const g of nuevos) { const usadas = g.asignaciones.map((x) => x.plantilla); assert.equal(usadas.length, 2); assert.equal(new Set(usadas).size, 2) } // ninguna repetida dentro de cada unidad
  await limpiar(ana, t1); await limpiar(ana, t2)
})

test('si el flujo de preparación falla o no deja variantes, el trabajo termina con un mensaje claro y no se generan guiones', async () => {
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('PUT', '/proyectos/curso-f', curso('curso-f'))).status, 200)
  assert.equal((await ana('PUT', '/proyectos/curso-nf', curso('curso-nf', [1, 2], ''))).status, 200)
  const bib = await bibliografia('curso-f')
  const antesGui = guiones.length
  falloPrep = { estado: 500, cuerpo: { error: 'no se pudieron leer las estructuras' } }
  assert.equal((await ana('POST', '/guiones/trabajos', pedido('curso-f', bib, 1))).status, 202)
  const t = await terminado(ana, 'curso-f', 1)
  assert.equal(t.estado, 'error'); assert.match(t.error, /preparación del curso falló \(HTTP 500\): no se pudieron leer las estructuras/)
  await limpiar(ana, t)
  falloPrep = null
  planPrep['curso-f'] = [] // el flujo responde bien pero no asignó nada
  assert.equal((await ana('POST', '/guiones/trabajos', pedido('curso-f', bib, 1))).status, 202)
  const t2 = await terminado(ana, 'curso-f', 1)
  assert.equal(t2.estado, 'error'); assert.match(t2.error, /no asignó variantes a la unidad 1/)
  await limpiar(ana, t2)
  // un curso que no dice su formación no se puede preparar
  const bib2 = await bibliografia('curso-nf')
  assert.equal((await ana('POST', '/guiones/trabajos', pedido('curso-nf', bib2, 1))).status, 202)
  const t3 = await terminado(ana, 'curso-nf', 1)
  assert.equal(t3.estado, 'error'); assert.match(t3.error, /no dice su formación/)
  await limpiar(ana, t3)
  assert.equal(guiones.length, antesGui) // en ningún caso se llamó al flujo de guiones
})

test('modo de pruebas de plantillas: se asignan las plantillas subidas aunque no estén aprobadas ni sean de la formación, y un curso sin formación no se detiene; apagado, todo vuelve a exigirse', async () => {
  const ana = await entrar('ana@u.co')
  // dos plantillas SUBIDAS pero sin aprobar: una de Tecnológico y otra de Profesional
  await dueno.query("INSERT INTO plantilla_categorias (id, nombre) VALUES ('PRU-01', 'Prueba')")
  for (const [nombre, formacion] of [['pru-01-tec-v01', 'tecnologico'], ['pru-01-pro-v01', 'profesional']]) {
    await dueno.query("INSERT INTO plantilla_subidas (nombre, html_crudo, html, subida_nombre, formacion) VALUES ($1, 'x', 'x', 'prueba', $2)", [nombre, formacion])
    await dueno.query('INSERT INTO plantilla_categoria (plantilla, categoria) VALUES ($1, $2)', [nombre, 'PRU-01'])
    await dueno.query('INSERT INTO plantilla_categoria_formacion (categoria, formacion) VALUES ($1, $2)', ['PRU-01', formacion])
  }
  // sin el modo: el curso sin formación se detiene, y con formación no hay variantes aprobadas
  assert.equal((await ana('PUT', '/proyectos/curso-sinf', curso('curso-sinf', [1, 2], ''))).status, 200)
  assert.equal((await ana('PUT', '/proyectos/curso-conf', curso('curso-conf'))).status, 200)
  const bibSin = await bibliografia('curso-sinf'); const bibCon = await bibliografia('curso-conf')
  planPrep['curso-sinf'] = [rec('U1-T1-R1', 'PRU-01'), rec('U1-T1-R2', 'PRU-01')]
  planPrep['curso-conf'] = [rec('U1-T1-R1', 'PRU-01'), rec('U1-T1-R2', 'PRU-01')]
  assert.equal((await ana('POST', '/guiones/trabajos', pedido('curso-sinf', bibSin, 1))).status, 202)
  const t0 = await terminado(ana, 'curso-sinf', 1)
  assert.equal(t0.estado, 'error'); assert.match(t0.error, /no dice su formación/); await limpiar(ana, t0)
  assert.equal((await ana('POST', '/guiones/trabajos', pedido('curso-conf', bibCon, 1))).status, 202)
  const t1 = await terminado(ana, 'curso-conf', 1)
  assert.equal(t1.estado, 'error'); assert.match(t1.error, /unidad 1 \(2 recursos\):\n• No hay variantes aprobadas: PRU-01 ×2\n/); await limpiar(ana, t1)
  // con el modo encendido (lo enciende la administración en «Conexión n8n»): se asigna lo subido, las de la formación del curso primero
  await dueno.query("INSERT INTO configuracion (clave, valor) VALUES ('n8n.pruebas_plantillas', '1') ON CONFLICT (clave) DO UPDATE SET valor = '1'")
  const antesPrep = prep.length
  assert.equal((await ana('POST', '/guiones/trabajos', pedido('curso-conf', bibCon, 1, { reasignar: true }))).status, 202)
  const t2 = await terminado(ana, 'curso-conf', 1)
  assert.equal(t2.estado, 'listo', t2.error)
  assert.equal(prep.length, antesPrep + 1); assert.equal(prep[prep.length - 1].modo_pruebas, true)
  assert.deepEqual(guiones[guiones.length - 1].asignaciones.map((a) => [a.codigo, a.plantilla]), [['U1-T1-R1', 'pru-01-tec-v01'], ['U1-T1-R2', 'pru-01-pro-v01']]) // la de Tecnológico primero, y luego la otra
  await limpiar(ana, t2)
  // el curso que no dice su formación ya no se detiene: llega al flujo y recibe plantillas
  assert.equal((await ana('POST', '/guiones/trabajos', pedido('curso-sinf', bibSin, 1))).status, 202)
  const t3 = await terminado(ana, 'curso-sinf', 1)
  assert.equal(t3.estado, 'listo', t3.error)
  assert.equal(prep[prep.length - 1].formacion, 'tecnologico'); assert.equal(guiones[guiones.length - 1].asignaciones.length, 2)
  await limpiar(ana, t3)
  // apagado: vuelve a exigirse lo aprobado
  await dueno.query("UPDATE configuracion SET valor = '0' WHERE clave = 'n8n.pruebas_plantillas'")
  assert.equal((await ana('POST', '/guiones/trabajos', pedido('curso-conf', bibCon, 1, { reasignar: true }))).status, 202)
  const t4 = await terminado(ana, 'curso-conf', 1)
  assert.equal(t4.estado, 'error'); assert.match(t4.error, /No hay variantes aprobadas/); await limpiar(ana, t4)
})
