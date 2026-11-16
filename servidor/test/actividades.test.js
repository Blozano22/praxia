// Actividades (categorías ACT-G-01, ACT-E-TEC-03…): códigos de categoría con varios bloques, tipo de variante (calificable «c» / práctica «p»), nombres como los del plan
// («act-g-01-tec-p-v2»), campos propios por formación y tipo, y asignación al curso (calificable marcada por n8n, azar entre las prácticas, repetición con aviso).
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
const PUERTO_PG = 54347
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-act-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
const SECRETO = 'secreto-de-prueba-0123456789abcdef0123456789'
const TRABAJO = crypto.randomUUID()

let servidor, base, pool, dueno, idAna
before(async () => {
  await servidorPg.initialise(); await servidorPg.start(); await servidorPg.createDatabase('ova')
  dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  for (const f of ['001_esquema.sql', '005_asignacion_variantes.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8')) // migrar de nuevo no repite ni pisa nada
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.N8N_EVENTOS_SECRETO = SECRETO
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  const { registrarOrigen } = await import('../src/pipeline/eventos.js')
  pool = db.pool
  const ids = {}
  for (const [n, c, r] of [['Dani', 'dani@u.co', 'disenador'], ['Ana', 'ana@u.co', 'docente']]) ids[n.toLowerCase()] = (await pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), [r]])).rows[0].id
  idAna = ids.ana
  await dueno.query("INSERT INTO proyectos (propietario_id, id, programa, curso, datos) VALUES ($1, 'curso-a', 'Programa', 'Curso', '{}')", [idAna])
  await registrarOrigen({ trabajoId: TRABAJO, propietarioId: idAna, proyectoId: 'curso-a', etapa: 'preparacion' })
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

async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const h = { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1', 'content-type': 'application/json' }
  return (m, ruta, cuerpo) => fetch(base + '/api' + ruta, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
}
const html = (campos, ficha = '') => '<!doctype html><html lang="es"><head><meta charset="utf-8">' + (ficha ? '<!--\n' + ficha + '\n-->' : '') + '<title>{{TITULO}}</title></head><body><script type="application/json" id="contenido">/*CONTENIDO*/' + JSON.stringify(campos) + '/*FIN-CONTENIDO*/</script></body></html>'
const indice = async () => (await fetch(base + '/plantillas-html/plantillas.json')).json()

test('categorías de actividad con códigos «ACT-G-01» y «ACT-E-TEC-03», marcadas para sus formaciones', async () => {
  const dani = await entrar('dani@u.co')
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-G-01', nombre: 'Emparejamiento', tipo: 'actividad' })).status, 201)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-E-TEC-03', nombre: 'Emparejar normas con situaciones', tipo: 'actividad' })).status, 201)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-G-03', nombre: 'Arrastre y suelte', tipo: 'actividad' })).status, 201)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-E-TEC-AB-03', nombre: 'demasiados bloques', tipo: 'actividad' })).status, 400)
  assert.equal((await dani('PUT', '/plantillas/categorias/ACT-G-01/formaciones', { formaciones: [{ formacion: 'tecnologico' }, { formacion: 'profesional' }] })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/categorias/ACT-E-TEC-03/formaciones', { formaciones: [{ formacion: 'tecnologico' }] })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/categorias/ACT-G-03/formaciones', { formaciones: [{ formacion: 'tecnologico' }] })).status, 200)
  const c = (await (await dani('GET', '/plantillas/categorias')).json()).categorias.find((x) => x.id === 'ACT-E-TEC-03')
  assert.equal(c.tipo, 'actividad')
  // crear una categoría ya con sus formaciones (una sola llamada); un valor repetido o desconocido no deja nada a medias
  const antes = (await (await dani('GET', '/plantillas/categorias')).json()).categorias.length
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-X-09', nombre: 'Con formaciones', tipo: 'actividad', formaciones: [{ formacion: 'tecnologico', prioridad: 'P' }, { formacion: 'profesional', prioridad: 'C' }] })).status, 201)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-X-08', nombre: 'Repetida', tipo: 'actividad', formaciones: [{ formacion: 'tecnologico' }, { formacion: 'tecnologico' }] })).status, 400)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-X-07', nombre: 'Rara', tipo: 'actividad', formaciones: [{ formacion: 'inventada' }] })).status, 400)
  const j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.equal(j.categorias.length, antes + 1)
  assert.deepEqual(j.formaciones['ACT-X-09'].map((f) => [f.formacion, f.prioridad]).sort(), [['profesional', 'C'], ['tecnologico', 'P']])
  assert.equal((await dani('DELETE', '/plantillas/categorias/ACT-X-09')).status, 200)
})

test('subir una actividad exige decir si es calificable o práctica, y el nombre sale del plan: categoría, formación, tipo y número de variante', async () => {
  const dani = await entrar('dani@u.co')
  const subir = async (cuerpo) => { const r = await dani('POST', '/plantillas/subidas', cuerpo); return { estado: r.status, ...(await r.json()) } }
  const base1 = { titulo: 't', texto: 'x' }
  // sin tipo no se sabe cómo llamarla
  const sinTipo = await subir({ html: html(base1), categoria: 'ACT-G-01', formacion: 'tecnologico' })
  assert.equal(sinTipo.estado, 400); assert.equal(sinTipo.requiereTipo, true)
  // sin formación (la categoría sirve a dos): tampoco
  const sinForm = await subir({ html: html(base1), categoria: 'ACT-G-01', calificable: false })
  assert.equal(sinForm.estado, 400); assert.equal(sinForm.requiereFormacion, true)
  // la calificable lleva un campo más (la nota) y no por eso se rechaza: cada tipo tiene sus propios campos
  const c1 = await subir({ html: html({ ...base1, nota: 5 }), categoria: 'ACT-G-01', formacion: 'tecnologico', calificable: true })
  assert.equal(c1.estado, 201); assert.equal(c1.nombre, 'act-g-01-tec-c-v1')
  const p1 = await subir({ html: html(base1), categoria: 'ACT-G-01', formacion: 'tecnologico', calificable: false })
  assert.equal(p1.nombre, 'act-g-01-tec-p-v1')
  const p2 = await subir({ html: html(base1), categoria: 'ACT-G-01', formacion: 'tecnologico', calificable: false })
  assert.equal(p2.nombre, 'act-g-01-tec-p-v2') // el número cuenta las de su formación y tipo, en el orden de subida
  // una práctica con campos distintos a los de las otras prácticas se rechaza
  const mala = await subir({ html: html({ ...base1, nota: 5 }), categoria: 'ACT-G-01', formacion: 'tecnologico', calificable: false })
  assert.equal(mala.estado, 409); assert.equal(mala.requiereConfirmacion, 'esquema')
  // Profesional se escribe «pro» en las actividades (en los recursos es «pre») y numera aparte
  const pro = await subir({ html: html({ titulo: 'otro', cosas: [1] }), categoria: 'ACT-G-01', formacion: 'profesional', calificable: false })
  assert.equal(pro.nombre, 'act-g-01-pro-p-v1')
  // categoría de una sola formación que no lleva la formación en su código: se añade (ACT-G-03-TEC…)
  assert.equal((await subir({ html: html(base1), categoria: 'ACT-G-03', calificable: true })).nombre, 'act-g-03-tec-c-v1')
  // categoría que ya lleva la formación en su código (ACT-E-TEC-03): no se repite
  assert.equal((await subir({ html: html(base1), categoria: 'ACT-E-TEC-03', calificable: false })).nombre, 'act-e-tec-03-p-v1')
  // la ficha puede decir categoría, formación y tipo
  const ficha = ['  Categoría Praxia: ACT-E-TEC-03', '  Formación: tecnologico', '  Tipo de actividad: calificable'].join('\n')
  const porFicha = await subir({ html: html(base1, ficha) })
  assert.equal(porFicha.nombre, 'act-e-tec-03-c-v1')
  const pv = await (await dani('POST', '/plantillas/subidas/previa', { html: html(base1, ficha) })).json()
  assert.deepEqual(pv.ficha, { categoria: 'ACT-E-TEC-03', formacion: 'tecnologico', calificable: true }); assert.equal(pv.nombre, 'act-e-tec-03-c-v2'); assert.equal(pv.esActividad, true)
  const pvSin = await (await dani('POST', '/plantillas/subidas/previa', { html: html(base1), categoria: 'ACT-G-03' })).json()
  assert.equal(pvSin.requiereTipo, true); assert.equal(pvSin.nombre, null)
  // el índice trae el tipo de cada variante y sus campos se comparan con los de su tipo
  const ix = await indice()
  const v = Object.fromEntries(ix.plantillas.map((x) => [x.nombre, x]))
  assert.equal(v['act-g-01-tec-c-v1'].calificable, true); assert.equal(v['act-g-01-tec-p-v2'].calificable, false); assert.equal(v['act-g-01-tec-p-v2'].esquema_ok, true); assert.equal(v['act-g-01-tec-c-v1'].esquema_ok, true)
  assert.equal(ix.categorias.find((c) => c.id === 'ACT-G-01').variantes.find((x) => x.nombre === 'act-g-01-pro-p-v1').calificable, false)
})

test('reemplazar y mover una actividad conservan o piden su tipo', async () => {
  const dani = await entrar('dani@u.co')
  const r = await dani('PUT', '/plantillas/subidas/act-g-01-tec-p-v2', { html: html({ titulo: 'nuevo', texto: 'y' }) }) // sigue siendo práctica
  assert.equal(r.status, 200)
  const mover = await dani('POST', '/plantillas/subidas/act-g-01-tec-p-v2/mover', { categoria: 'ACT-G-03' })
  assert.equal(mover.status, 200); assert.equal((await mover.json()).nombre, 'act-g-03-tec-p-v1') // conserva su tipo; en la categoría nueva numera el suyo
})

// ---------------------------------------------------------------- asignación al curso
const firmar = (cuerpo) => { const f = Math.floor(Date.now() / 1000); return { 'x-praxia-fecha': String(f), 'x-praxia-firma': crypto.createHmac('sha256', SECRETO).update(f + '.' + cuerpo).digest('hex') } }
const pedir = async (recursos, extra = {}) => {
  const cuerpo = JSON.stringify({ trabajo_id: TRABAJO, formacion: 'tecnologico', recursos, ...extra })
  const r = await fetch(base + '/api/n8n/asignaciones/pedir', { method: 'POST', headers: { 'content-type': 'application/json', ...firmar(cuerpo) }, body: cuerpo })
  return { estado: r.status, datos: await r.json() }
}
const rec = (codigo, categoria, calificable) => ({ codigo, categoria, ...(calificable === undefined ? {} : { calificable }) })
const porCodigo = (d) => Object.fromEntries(d.resultados.map((x) => [x.codigo, x]))
const crear = async (id, tipo, formaciones = ['tecnologico']) => {
  await dueno.query('INSERT INTO plantilla_categorias (id, nombre, tipo) VALUES ($1, $1, $2)', [id, tipo])
  for (const f of formaciones) await dueno.query("INSERT INTO plantilla_categoria_formacion (categoria, formacion, prioridad) VALUES ($1, $2, 'P')", [id, f])
}
const variante = async (nombre, cat, formacion, calificable) => {
  await dueno.query("INSERT INTO plantilla_subidas (nombre, html_crudo, html, subida_nombre, formacion, calificable) VALUES ($1, 'x', 'x', 'prueba', $2, $3)", [nombre, formacion, calificable])
  await dueno.query('INSERT INTO plantilla_categoria (plantilla, categoria) VALUES ($1, $2)', [nombre, cat])
  await dueno.query("INSERT INTO plantilla_historial (plantilla, estado, observacion, usuario_nombre) VALUES ($1, 'aprobada', 'ok', 'Dani')", ['pub-' + nombre])
}

test('la calificable la marca n8n: recibe una variante calificable y las prácticas otras al azar, sin mezclar tipos', async () => {
  await crear('ASG-01', 'actividad')
  await variante('asg-01-tec-c-v1', 'ASG-01', 'tecnologico', true)
  await variante('asg-01-tec-p-v1', 'ASG-01', 'tecnologico', false)
  await variante('asg-01-tec-p-v2', 'ASG-01', 'tecnologico', false)
  // sin decir si es calificable no se adivina
  const sin = porCodigo((await pedir([rec('U1-T3-R1', 'ASG-01')])).datos)
  assert.equal(sin['U1-T3-R1'].resultado, 'error'); assert.equal(sin['U1-T3-R1'].motivo, 'falta_calificable')
  const r = await pedir([rec('U1-T3-R1', 'ASG-01', true), rec('U1-T1-R2', 'ASG-01', false), rec('U1-T2-R1', 'ASG-01', false)])
  assert.equal(r.estado, 200)
  const p = porCodigo(r.datos)
  assert.equal(p['U1-T3-R1'].plantilla, 'asg-01-tec-c-v1'); assert.equal(p['U1-T3-R1'].repetida, false)
  assert.deepEqual([p['U1-T1-R2'].plantilla, p['U1-T2-R1'].plantilla].sort(), ['asg-01-tec-p-v1', 'asg-01-tec-p-v2']) // las dos prácticas, sin repetir ni usar la calificable
  assert.ok(r.datos.resultados.every((x) => x.repetida === false && x.aviso === null))
  // se agotaron las prácticas: se repite una y se avisa (no se deja el recurso sin variante)
  const r2 = porCodigo((await pedir([rec('U2-T1-R1', 'ASG-01', false)])).datos)['U2-T1-R1']
  assert.equal(r2.resultado, 'asignada'); assert.equal(r2.repetida, true); assert.match(r2.aviso, /repetida/i); assert.match(r2.plantilla, /^asg-01-tec-p-v[12]$/)
  // la calificable también se puede repetir en el mismo curso (es la excepción)
  const r3 = porCodigo((await pedir([rec('U2-T3-R1', 'ASG-01', true)])).datos)['U2-T3-R1']
  assert.equal(r3.plantilla, 'asg-01-tec-c-v1'); assert.equal(r3.repetida, true)
  // volver a pedir no cambia nada, y lo repetido sigue marcado como repetido
  const r4 = await pedir([rec('U2-T1-R1', 'ASG-01', false), rec('U2-T3-R1', 'ASG-01', true)])
  const p4 = porCodigo(r4.datos)
  assert.equal(p4['U2-T1-R1'].resultado, 'ya_asignada'); assert.equal(p4['U2-T1-R1'].plantilla, r2.plantilla); assert.equal(p4['U2-T1-R1'].repetida, true)
  assert.equal(p4['U2-T3-R1'].plantilla, 'asg-01-tec-c-v1'); assert.equal(p4['U2-T3-R1'].repetida, true)
  // recalcular desde cero con forzar tampoco falla con lo repetido
  assert.equal((await pedir([rec('U2-T1-R1', 'ASG-01', false)], { forzar: true })).estado, 200)
  const guardadas = (await dueno.query("SELECT codigo, repetida FROM asignacion_variantes WHERE categoria = 'ASG-01' ORDER BY codigo")).rows
  assert.equal(guardadas.length, 5) // los cinco recursos pedidos (el que no decía si era calificable no se guardó)
})

test('pedir un tipo que la categoría no tiene se dice con su motivo, y los recursos normales siguen sin repetir variantes', async () => {
  await crear('ASG-02', 'actividad')
  await variante('asg-02-tec-p-v1', 'ASG-02', 'tecnologico', false) // solo práctica
  const p = porCodigo((await pedir([rec('U4-T3-R1', 'ASG-02', true)])).datos)['U4-T3-R1']
  assert.equal(p.resultado, 'pendiente'); assert.equal(p.motivo, 'categoria_sin_calificables')
  // un recurso (no actividad): si se agotan las variantes sigue siendo «variantes_agotadas», sin repetir
  await crear('ASG-03', 'recurso')
  await dueno.query("INSERT INTO plantilla_subidas (nombre, html_crudo, html, subida_nombre, formacion) VALUES ('asg-03-v01', 'x', 'x', 'prueba', 'tecnologico')")
  await dueno.query("INSERT INTO plantilla_categoria (plantilla, categoria) VALUES ('asg-03-v01', 'ASG-03')")
  await dueno.query("INSERT INTO plantilla_historial (plantilla, estado, observacion, usuario_nombre) VALUES ('pub-asg-03-v01', 'aprobada', 'ok', 'Dani')")
  const rr = porCodigo((await pedir([rec('U3-T1-R1', 'ASG-03'), rec('U3-T1-R2', 'ASG-03')])).datos)
  assert.equal(rr['U3-T1-R1'].resultado, 'asignada'); assert.equal(rr['U3-T1-R2'].resultado, 'pendiente'); assert.equal(rr['U3-T1-R2'].motivo, 'variantes_agotadas')
})
