// Actividades (categorías ACT-G-01, ACT-E-03-TEC…): códigos de categoría con varios bloques, tipo de variante (calificable «c» / práctica «p»), nombres como los del plan
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
  for (const f of ['001_esquema.sql', '002_bibliografia.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  for (const f of ['001_esquema.sql', '005_asignacion_variantes.sql', '007_pipeline_plantilla.sql', '008_pipeline_contenido.sql', '009_pipeline_contenido_editado.sql', '010_pipeline_aprobacion.sql', '011_plantilla_archivo.sql']) await dueno.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8')) // migrar de nuevo no repite ni pisa nada
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

test('categorías de actividad con códigos «ACT-G-01» y «ACT-E-03-TEC», marcadas para sus formaciones', async () => {
  const dani = await entrar('dani@u.co')
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-G-01', nombre: 'Emparejamiento', tipo: 'actividad' })).status, 201)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-E-03-TEC', nombre: 'Emparejar normas con situaciones', tipo: 'actividad' })).status, 201)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-G-03', nombre: 'Arrastre y suelte', tipo: 'actividad' })).status, 201)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-E-TEC-AB-03', nombre: 'demasiados bloques', tipo: 'actividad' })).status, 400)
  assert.equal((await dani('PUT', '/plantillas/categorias/ACT-G-01/formaciones', { formaciones: [{ formacion: 'tecnologico' }, { formacion: 'profesional' }] })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/categorias/ACT-E-03-TEC/formaciones', { formaciones: [{ formacion: 'tecnologico' }] })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/categorias/ACT-G-03/formaciones', { formaciones: [{ formacion: 'tecnologico' }] })).status, 200)
  const c = (await (await dani('GET', '/plantillas/categorias')).json()).categorias.find((x) => x.id === 'ACT-E-03-TEC')
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
  // «ACT-E-05-PRO» lleva la formación al final, como en el plan: queda marcada sola y no admite otra
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-E-05-PRO', nombre: 'Específica profesional', tipo: 'actividad' })).status, 201)
  assert.deepEqual((await (await dani('GET', '/plantillas/categorias')).json()).formaciones['ACT-E-05-PRO'].map((f) => [f.formacion, f.prioridad]), [['profesional', 'P']])
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-E-06-DOC', nombre: 'Mal marcada', tipo: 'actividad', formaciones: [{ formacion: 'tecnologico' }] })).status, 400)
  assert.equal((await dani('PUT', '/plantillas/categorias/ACT-E-05-PRO/formaciones', { formaciones: [{ formacion: 'profesional' }, { formacion: 'doctorado' }] })).status, 400)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-E-07-XYZ', nombre: 'formación inexistente', tipo: 'actividad' })).status, 400)
  assert.equal((await dani('DELETE', '/plantillas/categorias/ACT-E-05-PRO')).status, 200)
})

test('una actividad específica «ACT-E-05-PRO» se sube sin elegir formación y el nombre sale igual que en el plan: act-e-05-pro-p-v1', async () => {
  const dani = await entrar('dani@u.co')
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-E-05-PRO', nombre: 'Específica profesional', tipo: 'actividad' })).status, 201)
  const subir = async (cuerpo) => { const r = await dani('POST', '/plantillas/subidas', cuerpo); return { estado: r.status, ...(await r.json()) } }
  const base1 = { titulo: 't', texto: 'x' }
  const a = await subir({ html: html(base1), categoria: 'ACT-E-05-PRO', calificable: false })
  assert.equal(a.estado, 201); assert.equal(a.nombre, 'act-e-05-pro-p-v1')
  const b = await subir({ html: html(base1), categoria: 'ACT-E-05-PRO', calificable: true })
  assert.equal(b.nombre, 'act-e-05-pro-c-v1')
  assert.equal((await subir({ html: html(base1), categoria: 'ACT-E-05-PRO', calificable: false })).nombre, 'act-e-05-pro-p-v2')
  // otra formación distinta a la del código no se admite
  assert.equal((await subir({ html: html(base1), categoria: 'ACT-E-05-PRO', calificable: false, formacion: 'tecnologico' })).estado, 400)
  // la ficha puede decir la categoría con la formación al final
  const ficha = ['  Categoría Praxia: ACT-E-05-PRO', '  Tipo de actividad: práctica'].join(String.fromCharCode(10))
  const pv = await (await dani('POST', '/plantillas/subidas/previa', { html: html(base1, ficha) })).json()
  assert.equal(pv.ficha.categoria, 'ACT-E-05-PRO')
  assert.equal(pv.nombre, 'act-e-05-pro-p-v3')
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
  // categoría que ya lleva la formación en su código (ACT-E-03-TEC): no se repite
  assert.equal((await subir({ html: html(base1), categoria: 'ACT-E-03-TEC', calificable: false })).nombre, 'act-e-03-tec-p-v1')
  // la ficha puede decir categoría, formación y tipo
  const ficha = ['  Categoría Praxia: ACT-E-03-TEC', '  Formación: tecnologico', '  Tipo de actividad: calificable'].join('\n')
  const porFicha = await subir({ html: html(base1, ficha) })
  assert.equal(porFicha.nombre, 'act-e-03-tec-c-v1')
  const pv = await (await dani('POST', '/plantillas/subidas/previa', { html: html(base1, ficha) })).json()
  assert.deepEqual(pv.ficha, { categoria: 'ACT-E-03-TEC', formacion: 'tecnologico', calificable: true }); assert.equal(pv.nombre, 'act-e-03-tec-c-v2'); assert.equal(pv.esActividad, true)
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
  assert.equal(r3.aviso, null); assert.equal(r3.motivo, 'calificable_repetida') // repetir la calificable es lo normal: sin aviso
  // volver a pedir no cambia nada, y lo repetido sigue marcado como repetido
  const r4 = await pedir([rec('U2-T1-R1', 'ASG-01', false), rec('U2-T3-R1', 'ASG-01', true)])
  const p4 = porCodigo(r4.datos)
  assert.equal(p4['U2-T1-R1'].resultado, 'ya_asignada'); assert.equal(p4['U2-T1-R1'].plantilla, r2.plantilla); assert.equal(p4['U2-T1-R1'].repetida, true)
  assert.equal(p4['U2-T3-R1'].plantilla, 'asg-01-tec-c-v1'); assert.equal(p4['U2-T3-R1'].repetida, true); assert.equal(p4['U2-T3-R1'].aviso, null)
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

test('si una categoría se queda sin variantes (por mover o eliminar), su numeración empieza de nuevo; mientras quede alguna, sigue', async () => {
  const dani = await entrar('dani@u.co')
  const subir = async (cuerpo) => { const r = await dani('POST', '/plantillas/subidas', cuerpo); return { estado: r.status, ...(await r.json()) } }
  const c1 = { titulo: 't', texto: 'x' }
  for (const id of ['G-91', 'G-92']) assert.equal((await dani('POST', '/plantillas/categorias', { id, nombre: 'Recurso ' + id })).status, 201)
  // se sube a la categoría equivocada (G-91), se mueve a la correcta (G-92) y G-91 queda vacía
  assert.equal((await subir({ html: html(c1), categoria: 'G-91' })).nombre, 'g-91-v01')
  assert.equal((await subir({ html: html(c1), categoria: 'G-91' })).nombre, 'g-91-v02')
  assert.equal((await (await dani('POST', '/plantillas/subidas/g-91-v01/mover', { categoria: 'G-92' })).json()).nombre, 'g-92-v01')
  assert.equal((await subir({ html: html(c1), categoria: 'G-91' })).nombre, 'g-91-v03') // aún queda g-91-v02: sigue contando
  assert.equal((await (await dani('POST', '/plantillas/subidas/g-91-v02/mover', { categoria: 'G-92' })).json()).nombre, 'g-92-v02')
  assert.equal((await (await dani('POST', '/plantillas/subidas/g-91-v03/mover', { categoria: 'G-92' })).json()).nombre, 'g-92-v03')
  assert.equal((await subir({ html: html(c1), categoria: 'G-91' })).nombre, 'g-91-v01') // quedó vacía: vuelve a empezar
  // eliminar la última también reinicia, y lo nuevo no hereda la revisión de lo que se eliminó con ese nombre
  assert.equal((await dani('POST', '/plantillas/revisiones', { plantilla: 'pub-g-91-v01', estado: 'rechazada', observacion: 'no sirve' })).status, 201)
  assert.equal((await dani('DELETE', '/plantillas/subidas/g-91-v01')).status, 200)
  const otra = await subir({ html: html(c1), categoria: 'G-91' })
  assert.equal(otra.nombre, 'g-91-v01')
  const v = (await indice()).plantillas.find((x) => x.nombre === 'g-91-v01')
  assert.equal(v.estado, 'en_revision'); assert.equal(v.fecha_estado, null) // no es «rechazada»: la revisión vieja quedó apartada
  // si se elimina una que no es la última del grupo, NO se reinicia (no se repite un nombre que existe)
  assert.equal((await subir({ html: html(c1), categoria: 'G-91' })).nombre, 'g-91-v02')
  assert.equal((await dani('DELETE', '/plantillas/subidas/g-91-v01')).status, 200)
  assert.equal((await subir({ html: html(c1), categoria: 'G-91' })).nombre, 'g-91-v03')
  // actividades: cada formación y tipo reinicia solo el suyo
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-G-07', nombre: 'Reinicio', tipo: 'actividad', formaciones: [{ formacion: 'tecnologico' }] })).status, 201)
  const a = { categoria: 'ACT-G-07', formacion: 'tecnologico' }
  assert.equal((await subir({ html: html(c1), ...a, calificable: false })).nombre, 'act-g-07-tec-p-v1')
  assert.equal((await subir({ html: html(c1), ...a, calificable: false })).nombre, 'act-g-07-tec-p-v2')
  assert.equal((await subir({ html: html(c1), ...a, calificable: true })).nombre, 'act-g-07-tec-c-v1')
  assert.equal((await dani('DELETE', '/plantillas/subidas/act-g-07-tec-p-v1')).status, 200)
  assert.equal((await dani('DELETE', '/plantillas/subidas/act-g-07-tec-p-v2')).status, 200)
  assert.equal((await subir({ html: html(c1), ...a, calificable: false })).nombre, 'act-g-07-tec-p-v1') // las prácticas quedaron vacías: reinician
  assert.equal((await subir({ html: html(c1), ...a, calificable: true })).nombre, 'act-g-07-tec-c-v2') // la calificable sigue con su cuenta
})

test('la ficha de las skills de actividades («Uso: Calificable | Práctica») se lee igual que «Tipo de actividad», y se avisa si no coincide con lo elegido', async () => {
  const dani = await entrar('dani@u.co')
  const ficha = (uso) => ['  FICHA DE LA PLANTILLA', '  Variante: ACT-G-07-TEC-C-V9 · Tipo: Actividad de autoaprendizaje', '  Categoría Praxia: ACT-G-07', '  Formación: tecnologico', '  Uso: ' + uso].join(String.fromCharCode(10))
  const previa = async (uso, extra = {}) => (await dani('POST', '/plantillas/subidas/previa', { html: html({ titulo: 't', texto: 'x' }, ficha(uso)), ...extra })).json()
  const a = await previa('Calificable')
  assert.deepEqual(a.ficha, { categoria: 'ACT-G-07', formacion: 'tecnologico', calificable: true })
  assert.match(a.nombre, /^act-g-07-tec-c-v\d+$/) // sin elegir nada, la ficha basta para saber que es calificable
  const b = await previa('Práctica')
  assert.equal(b.ficha.calificable, false); assert.match(b.nombre, /^act-g-07-tec-p-v\d+$/)
  // lo elegido en pantalla manda, pero se avisa que la ficha dice otra cosa
  const c = await previa('Calificable', { calificable: false })
  assert.match(c.nombre, /-p-v\d+$/)
  assert.ok(c.avisos.some((x) => /ficha dice que es calificable/.test(x) && /práctica/.test(x)))
  assert.ok(!(await previa('Práctica', { calificable: false })).avisos.some((x) => /ficha dice que es/.test(x)))
})

test('la actividad de una fila tiene su propio código («U#-T#-A#») y puede convivir con el recurso de esa misma fila', async () => {
  await crear('ASG-04', 'actividad'); await crear('ASG-05', 'recurso')
  await variante('asg-04-tec-p-v1', 'ASG-04', 'tecnologico', false)
  await variante('asg-04-tec-c-v1', 'ASG-04', 'tecnologico', true)
  await dueno.query("INSERT INTO plantilla_subidas (nombre, html_crudo, html, subida_nombre, formacion) VALUES ('asg-05-v01', 'x', 'x', 'prueba', 'tecnologico')")
  await dueno.query("INSERT INTO plantilla_categoria (plantilla, categoria) VALUES ('asg-05-v01', 'ASG-05')")
  await dueno.query("INSERT INTO plantilla_historial (plantilla, estado, observacion, usuario_nombre) VALUES ('pub-asg-05-v01', 'aprobada', 'ok', 'Dani')")
  // la fila 2 del tema 3 tiene un recurso (R2) y su actividad (A2): dos códigos distintos, dos variantes
  const r = await pedir([rec('U6-T3-R2', 'ASG-05'), rec('U6-T3-A2', 'ASG-04', true), rec('U6-T1-A1', 'ASG-04', false)])
  assert.equal(r.estado, 200)
  const p = porCodigo(r.datos)
  assert.equal(p['U6-T3-R2'].plantilla, 'asg-05-v01')
  assert.equal(p['U6-T3-A2'].plantilla, 'asg-04-tec-c-v1')
  assert.equal(p['U6-T1-A1'].plantilla, 'asg-04-tec-p-v1')
  // se consultan por su código, y la base los guarda
  const cuerpoC = JSON.stringify({ trabajo_id: TRABAJO, codigos: ['U6-T3-A2'] })
  const c = await (await fetch(base + '/api/n8n/asignaciones/consultar', { method: 'POST', headers: { 'content-type': 'application/json', ...firmar(cuerpoC) }, body: cuerpoC })).json()
  assert.equal(c.asignaciones.length, 1); assert.equal(c.asignaciones[0].codigo, 'U6-T3-A2'); assert.equal(c.asignaciones[0].plantilla, 'asg-04-tec-c-v1')
  // un código con otra letra no vale
  assert.equal((await pedir([rec('U6-T3-X2', 'ASG-04', true)])).estado, 400)
})
