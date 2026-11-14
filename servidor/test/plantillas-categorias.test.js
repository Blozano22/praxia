// Categorías de las plantillas HTML (para n8n): cada categoría (ID del catálogo + nombre) reúne variantes; el índice público sale agrupado
// sin romper lo que n8n ya lee, y si la base de datos falla se entrega el archivo del build tal cual.
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
const PUERTO_PG = 54339
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-cat-'))
const web = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-web-cat-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
// Lo que escribe el build (sin categorías): 3 acordeones, una línea de tiempo, una de crucigrama y una nueva sin categoría.
const NOMBRES = ['acordeon', 'acordeon-2', 'acordeon-3', 'crucigrama', 'lineatiempo', 'nueva-plantilla']

let servidor, base, pool
let poolCerrado = false
before(async () => {
  fs.mkdirSync(path.join(web, 'plantillas-html'))
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>app</title>')
  for (const n of NOMBRES) fs.writeFileSync(path.join(web, 'plantillas-html', n + '.html'), '<html><title>{{TITULO}}</title>/*CONTENIDO*/</html>')
  fs.writeFileSync(path.join(web, 'plantillas-html', 'plantillas.json'), JSON.stringify({ marcas: { titulo: '{{TITULO}}', contenido: '/*CONTENIDO*/' }, total: NOMBRES.length, plantillas: NOMBRES.map((n) => ({ nombre: n, archivo: n + '.html' })) }))
  await servidorPg.initialise(); await servidorPg.start(); await servidorPg.createDatabase('ova')
  const dueno = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await dueno.connect()
  await dueno.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  const sql = (f) => fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8')
  for (const f of ['001_esquema.sql', '002_bibliografia.sql']) await dueno.query(sql(f))
  await dueno.query(sql('001_esquema.sql')) // volver a migrar no debe repetir ni pisar el punto de partida
  await dueno.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.CARPETA_WEB = web
  process.env.PLANTILLAS_INDICE_SOLO_SUBIDAS = '0' // estas pruebas parten de un índice con las plantillas del build; la prueba de «solo subidas» lo cambia a propósito
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool
  for (const [n, c, r] of [['Admin', 'admin@u.co', ['admin', 'disenador']], ['Dani', 'dani@u.co', 'disenador'], ['Ana', 'ana@u.co', 'docente'], ['Edi', 'edi@u.co', 'editor_html'], ['Edu', 'edu@u.co', 'editor_html']]) await pool.query(Q.usuarioCrear, [n, c, await hashClave(CLAVE), [r].flat()])
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})
after(async () => {
  servidor && servidor.close()
  if (pool && !poolCerrado) await pool.end()
  await servidorPg.stop()
  for (const d of [dir, web]) fs.rmSync(d, { recursive: true, force: true })
})

async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const h = { cookie: (r.headers.get('set-cookie') || '').split(';')[0], 'x-ova': '1', 'content-type': 'application/json' }
  return (m, ruta, cuerpo) => fetch(base + '/api' + ruta, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
}
const indice = async () => (await fetch(base + '/plantillas-html/plantillas.json')).json()

test('punto de partida: el catálogo ya está creado, las plantillas de nombre inequívoco ya tienen categoría y migrar de nuevo no lo repite', async () => {
  const dani = await entrar('dani@u.co')
  const j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.equal(j.categorias.length, 13); assert.deepEqual(j.categorias.find((c) => c.id === 'G-09'), { id: 'G-09', nombre: 'Acordeón', tipo: 'recurso' })
  assert.equal(j.asignaciones.acordeon, 'G-09'); assert.equal(j.asignaciones['lineatiempo-3'], 'G-12')
  assert.equal(j.asignaciones.crucigrama, undefined) // sin ID en el catálogo: queda sin categoría
  assert.deepEqual(j.plantillas, NOMBRES) // las que publicó el build
})

test('quién puede: ver, cualquiera que vea las plantillas; cambiar, quien las revisa (diseñador y administrador), y sin sesión nada', async () => {
  assert.equal((await fetch(base + '/api/plantillas/categorias', { headers: { 'x-ova': '1' } })).status, 401)
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('GET', '/plantillas/categorias')).status, 403) // el docente no ve las plantillas HTML
  assert.equal((await ana('POST', '/plantillas/categorias', { id: 'G-20', nombre: 'Nueva' })).status, 403)
  assert.equal((await ana('PUT', '/plantillas/asignacion/crucigrama', { categoria: 'G-09' })).status, 403)
  assert.equal((await ana('DELETE', '/plantillas/categorias/G-09')).status, 403)
})

test('crear, renombrar, asignar, quitar y borrar una categoría; todo se valida', async () => {
  const dani = await entrar('dani@u.co')
  const admin = await entrar('admin@u.co')
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'g-20', nombre: 'x' })).status, 400) // el ID es del catálogo: letras mayúsculas, guion y números
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'G-20', nombre: '   ' })).status, 400)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'G-20', nombre: 'Crucigrama', extra: 1 })).status, 400)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'G-20', nombre: 'Crucigrama' })).status, 201)
  assert.equal((await admin('POST', '/plantillas/categorias', { id: 'G-20', nombre: 'Otra' })).status, 409) // ya existe
  assert.equal((await dani('PUT', '/plantillas/categorias/G-20', { nombre: 'Crucigrama interactivo' })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/categorias/G-99', { nombre: 'No existe' })).status, 404)
  assert.equal((await dani('PUT', '/plantillas/asignacion/crucigrama', { categoria: 'G-20' })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/asignacion/crucigrama', { categoria: 'G-77' })).status, 404) // categoría inexistente
  assert.equal((await dani('PUT', '/plantillas/asignacion/Mala Plantilla', { categoria: 'G-20' })).status, 400)
  assert.equal((await dani('PUT', '/plantillas/asignacion/nueva-plantilla', { categoria: 'G-09' })).status, 200) // una variante nueva de acordeón
  const j = await (await admin('GET', '/plantillas/categorias')).json()
  assert.equal(j.categorias.find((c) => c.id === 'G-20').nombre, 'Crucigrama interactivo'); assert.equal(j.asignaciones.crucigrama, 'G-20')
  assert.equal((await dani('PUT', '/plantillas/asignacion/nueva-plantilla', { categoria: null })).status, 200) // quitarla
  assert.equal((await (await admin('GET', '/plantillas/categorias')).json()).asignaciones['nueva-plantilla'], undefined)
  const aud = (await pool.query("SELECT accion FROM auditoria WHERE accion LIKE 'plantilla_categoria%'")).rows.map((x) => x.accion)
  assert.ok(aud.includes('plantilla_categoria_crear') && aud.includes('plantilla_categoria_asignar'))
})

test('el índice público sale agrupado por categoría, sin sesión, y conserva lo que n8n ya leía', async () => {
  const j = await indice()
  // lo de siempre
  assert.equal(j.total, NOMBRES.length); assert.equal(j.marcas.contenido, '/*CONTENIDO*/'); assert.deepEqual(j.plantillas.map((p) => p.nombre), NOMBRES)
  assert.ok(j.plantillas.every((p) => p.archivo === p.nombre + '.html'))
  // lo nuevo
  assert.equal(j.plantillas.find((p) => p.nombre === 'acordeon-2').id_catalogo, 'G-09')
  const acordeon = j.categorias.find((c) => c.id === 'G-09')
  assert.deepEqual(acordeon.variantes.map((v) => v.nombre), ['acordeon', 'acordeon-2', 'acordeon-3'])
  assert.equal(acordeon.nombre, 'Acordeón')
  assert.deepEqual(j.categorias.find((c) => c.id === 'G-20').variantes.map(({ nombre, archivo }) => ({ nombre, archivo })), [{ nombre: 'crucigrama', archivo: 'crucigrama.html' }])
  assert.deepEqual(j.sin_categoria.map((p) => p.nombre), ['nueva-plantilla']) // la que se dejó sin categoría
  assert.equal(j.categorias.find((c) => c.id === 'G-01').variantes.length, 0) // categoría sin variantes todavía
})

const PLANTILLA = (extra = '') => '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{{TITULO}}</title><style>/*CSS*/</style></head><body><div id="app"></div><script>const D=/*CONTENIDO*/;</script>' + extra + '</body></html>'

test('subir una plantilla desde la pantalla: se arma como las del build, queda en el índice con su categoría y se entrega aislada', async () => {
  const dani = await entrar('dani@u.co')
  const r = await dani('POST', '/plantillas/subidas', { nombre: 'tarjetas-repaso', html: PLANTILLA(), categoria: 'G-10' })
  assert.equal(r.status, 201)
  const j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.ok(j.plantillas.includes('tarjetas-repaso')); assert.equal(j.asignaciones['tarjetas-repaso'], 'G-10'); assert.ok(j.subidas['tarjetas-repaso'])
  // la descarga n8n: sin sesión, armada (estilos incrustados, marcas intactas) y con el aislamiento
  const h = await fetch(base + '/plantillas-html/tarjetas-repaso.html')
  assert.equal(h.status, 200)
  assert.match(h.headers.get('content-type'), /text\/html/)
  assert.match(h.headers.get('content-security-policy'), /sandbox/); assert.doesNotMatch(h.headers.get('content-security-policy'), /allow-same-origin/)
  assert.equal(h.headers.get('access-control-allow-origin'), '*')
  const html = await h.text()
  assert.ok(html.includes('{{TITULO}}') && html.includes('/*CONTENIDO*/')); assert.equal(html.includes('/*CSS*/'), false)
  // el índice público la suma y la agrupa
  const ix = await indice()
  const p = ix.plantillas.find((x) => x.nombre === 'tarjetas-repaso')
  assert.deepEqual([p.archivo, p.id_catalogo, p.subida], ['tarjetas-repaso.html', 'G-10', true])
  assert.deepEqual(ix.categorias.find((c) => c.id === 'G-10').variantes.map(({ nombre, archivo }) => ({ nombre, archivo })), [{ nombre: 'tarjetas-repaso', archivo: 'tarjetas-repaso.html' }])
  assert.equal(ix.total, NOMBRES.length + 1)
})

test('una plantilla subida que no cumple las reglas del build se rechaza con el motivo; no pisa las del sistema; solo la sube quien revisa', async () => {
  const dani = await entrar('dani@u.co')
  const ana = await entrar('ana@u.co')
  const subir = (cuerpo) => dani('POST', '/plantillas/subidas', cuerpo)
  const motivo = async (r) => (await r.json()).error
  assert.match(await motivo(await subir({ nombre: 'sin-html', html: 'solo texto {{TITULO}} /*CONTENIDO*/' })), /<html>/)
  assert.match(await motivo(await subir({ nombre: 'sin-titulo', html: '<html><body>/*CONTENIDO*/</body></html>' })), /\{\{TITULO\}\} y tiene 0/)
  assert.match(await motivo(await subir({ nombre: 'sin-contenido', html: '<html><title>{{TITULO}}</title></html>' })), /CONTENIDO\*\/ y tiene 0/)
  assert.match(await motivo(await subir({ nombre: 'doble-titulo', html: PLANTILLA('<h1>{{TITULO}}</h1>') })), /\{\{TITULO\}\} y tiene 2/)
  assert.match(await motivo(await subir({ nombre: 'marca-interna', html: PLANTILLA('<i>/*TEMA*/</i><i>/*TEMA*/</i>') })), /sin reemplazar \/\*TEMA\*\//)
  assert.equal((await subir({ nombre: 'enorme', html: PLANTILLA('x'.repeat(1700 * 1024)) })).status, 400) // más de 1,5 MB
  assert.equal((await subir({ nombre: 'Mal Nombre', html: PLANTILLA() })).status, 400)
  assert.equal((await subir({ nombre: 'ok-pero', html: PLANTILLA(), categoria: 'G-77' })).status, 404) // categoría inexistente
  assert.equal((await subir({ nombre: 'acordeon', html: PLANTILLA() })).status, 409) // es una del sistema
  assert.equal((await subir({ nombre: 'plantillas', html: PLANTILLA() })).status, 409) // reservado
  assert.equal((await subir({ nombre: 'tarjetas-repaso', html: PLANTILLA() })).status, 409) // ya subida: se usa Reemplazar
  assert.equal((await ana('POST', '/plantillas/subidas', { nombre: 'de-ana', html: PLANTILLA() })).status, 403)
  assert.equal((await fetch(base + '/api/plantillas/subidas', { method: 'POST', headers: { 'x-ova': '1', 'content-type': 'application/json' }, body: '{}' })).status, 401)
  assert.equal((await fetch(base + '/plantillas-html/sin-html.html')).status, 404) // lo rechazado no quedó publicado
})

test('reemplazar y eliminar una plantilla subida; las del sistema no se tocan desde aquí', async () => {
  const dani = await entrar('dani@u.co')
  assert.equal((await dani('PUT', '/plantillas/subidas/tarjetas-repaso', { html: PLANTILLA('<p id="v2">segunda versión</p>') })).status, 200)
  assert.match(await (await fetch(base + '/plantillas-html/tarjetas-repaso.html')).text(), /segunda versión/)
  assert.equal((await dani('PUT', '/plantillas/subidas/tarjetas-repaso', { html: '<html>sin marcas</html>' })).status, 400)
  assert.match(await (await fetch(base + '/plantillas-html/tarjetas-repaso.html')).text(), /segunda versión/) // el intento malo no cambió nada
  assert.equal((await dani('PUT', '/plantillas/subidas/acordeon', { html: PLANTILLA() })).status, 404)
  assert.equal((await dani('DELETE', '/plantillas/subidas/acordeon')).status, 404)
  assert.equal((await dani('DELETE', '/plantillas/subidas/tarjetas-repaso')).status, 200)
  assert.equal((await fetch(base + '/plantillas-html/tarjetas-repaso.html')).status, 404)
  const j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.equal(j.plantillas.includes('tarjetas-repaso'), false); assert.equal(j.asignaciones['tarjetas-repaso'], undefined)
  assert.equal((await indice()).plantillas.some((p) => p.nombre === 'tarjetas-repaso'), false)
})

test('cada categoría es de un tipo: «recurso» o «actividad» de autoaprendizaje; se elige al crearla, se puede cambiar y sale en el índice', async () => {
  const dani = await entrar('dani@u.co')
  // sin decir el tipo, es un recurso
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'G-30', nombre: 'Otro recurso' })).status, 201)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-01', nombre: 'Crucigrama', tipo: 'actividad' })).status, 201)
  assert.equal((await dani('POST', '/plantillas/categorias', { id: 'ACT-02', nombre: 'Mala', tipo: 'juego' })).status, 400) // solo esos dos tipos
  let j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.equal(j.categorias.find((c) => c.id === 'G-30').tipo, 'recurso'); assert.equal(j.categorias.find((c) => c.id === 'ACT-01').tipo, 'actividad')
  assert.equal((await dani('PUT', '/plantillas/asignacion/crucigrama', { categoria: 'ACT-01' })).status, 200)
  // cambiar solo el tipo conserva el nombre; cambiar solo el nombre conserva el tipo; una petición vacía se rechaza
  assert.equal((await dani('PUT', '/plantillas/categorias/G-30', { tipo: 'actividad' })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/categorias/G-30', { nombre: 'Otra actividad' })).status, 200)
  assert.equal((await dani('PUT', '/plantillas/categorias/G-30', {})).status, 400)
  j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.deepEqual(j.categorias.find((c) => c.id === 'G-30'), { id: 'G-30', nombre: 'Otra actividad', tipo: 'actividad' })
  // el índice público lo trae por categoría y por plantilla
  const ix = await indice()
  assert.equal(ix.categorias.find((c) => c.id === 'ACT-01').tipo, 'actividad')
  assert.deepEqual([ix.plantillas.find((p) => p.nombre === 'crucigrama').tipo, ix.plantillas.find((p) => p.nombre === 'acordeon').tipo, ix.plantillas.find((p) => p.nombre === 'nueva-plantilla').tipo], ['actividad', 'recurso', null])
  assert.equal((await dani('DELETE', '/plantillas/categorias/ACT-01')).status, 200)
  assert.equal((await dani('DELETE', '/plantillas/categorias/G-30')).status, 200)
})

test('quitar de n8n una plantilla del sistema (y volver a mostrarla) sin tocar el código; las subidas se eliminan, no se ocultan', async () => {
  const dani = await entrar('dani@u.co')
  const ana = await entrar('ana@u.co')
  assert.equal((await fetch(base + '/plantillas-html/acordeon-3.html')).status, 200)
  assert.equal((await ana('PUT', '/plantillas/ocultas/acordeon-3', { oculta: true })).status, 403)
  assert.equal((await dani('PUT', '/plantillas/ocultas/no-existe', { oculta: true })).status, 404)
  assert.equal((await dani('PUT', '/plantillas/ocultas/acordeon-3', { oculta: 'si' })).status, 400)
  assert.equal((await dani('PUT', '/plantillas/ocultas/acordeon-3', { oculta: true })).status, 200)
  // ya no se ofrece a n8n: ni en el índice (plantillas, categoría ni total) ni en la descarga
  let ix = await indice()
  assert.equal(ix.plantillas.some((p) => p.nombre === 'acordeon-3'), false); assert.equal(ix.total, NOMBRES.length - 1)
  assert.deepEqual(ix.categorias.find((c) => c.id === 'G-09').variantes.map((v) => v.nombre), ['acordeon', 'acordeon-2'])
  assert.equal((await fetch(base + '/plantillas-html/acordeon-3.html')).status, 404)
  assert.equal((await fetch(base + '/plantillas-html/acordeon-2.html')).status, 200) // las demás siguen
  // la pantalla la sigue viendo (para poder volver a mostrarla)
  const j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.deepEqual(j.ocultas, ['acordeon-3']); assert.ok(j.plantillas.includes('acordeon-3'))
  // a una subida no se le aplica: se elimina
  assert.equal((await dani('POST', '/plantillas/subidas', { nombre: 'subida-x', html: PLANTILLA() })).status, 201)
  assert.equal((await dani('PUT', '/plantillas/ocultas/subida-x', { oculta: true })).status, 404)
  assert.equal((await dani('DELETE', '/plantillas/subidas/subida-x')).status, 200)
  // volver a mostrarla
  assert.equal((await dani('PUT', '/plantillas/ocultas/acordeon-3', { oculta: false })).status, 200)
  ix = await indice()
  assert.equal(ix.plantillas.some((p) => p.nombre === 'acordeon-3'), true); assert.equal(ix.total, NOMBRES.length)
  assert.equal((await fetch(base + '/plantillas-html/acordeon-3.html')).status, 200)
  assert.deepEqual((await (await dani('GET', '/plantillas/categorias')).json()).ocultas, [])
})

test('eliminar una plantilla del sistema: sale de la pantalla y de n8n, sin vuelta atrás desde la pantalla', async () => {
  const dani = await entrar('dani@u.co')
  const ana = await entrar('ana@u.co')
  assert.equal((await ana('DELETE', '/plantillas/sistema/acordeon-3')).status, 403)
  assert.equal((await dani('DELETE', '/plantillas/sistema/no-existe')).status, 404)
  assert.equal((await dani('DELETE', '/plantillas/sistema/acordeon-3')).status, 200)
  const j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.equal(j.plantillas.includes('acordeon-3'), false); assert.equal(j.ocultas.includes('acordeon-3'), false)
  assert.equal((await indice()).plantillas.some((p) => p.nombre === 'acordeon-3'), false)
  assert.equal((await fetch(base + '/plantillas-html/acordeon-3.html')).status, 404)
  // «mostrar» no la trae de vuelta
  assert.equal((await dani('PUT', '/plantillas/ocultas/acordeon-3', { oculta: false })).status, 200)
  assert.equal((await fetch(base + '/plantillas-html/acordeon-3.html')).status, 404)
})

test('una plantilla puede traer su contenido de ejemplo entre /*CONTENIDO*/ y /*FIN-CONTENIDO*/: n8n recibe la marca sola y la vista previa usa el ejemplo', async () => {
  const dani = await entrar('dani@u.co')
  const con = (cuerpo) => '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{{TITULO}}</title></head><body><script type="application/json" id="contenido">/*CONTENIDO*/' + cuerpo + '/*FIN-CONTENIDO*/</script></body></html>'
  assert.equal((await dani('POST', '/plantillas/subidas', { nombre: 'con-ejemplo', html: con('{ "titulo": "Mi ejemplo", "texto": "uno </script> dos" }') })).status, 201)
  const servida = await (await fetch(base + '/plantillas-html/con-ejemplo.html')).text()
  assert.ok(servida.includes('/*CONTENIDO*/</script>') && !servida.includes('Mi ejemplo') && !servida.includes('FIN-CONTENIDO'))
  const ej = (await (await dani('GET', '/plantillas/subidas/con-ejemplo/ejemplo')).json()).html
  assert.ok(ej.includes('Mi ejemplo') && !ej.includes('{{TITULO}}') && !ej.includes('/*CONTENIDO*/') && !ej.includes('uno </script>'))
  const lista = (await (await dani('GET', '/plantillas/categorias')).json()).subidas
  assert.equal(lista['con-ejemplo'].ejemplo, true)
  assert.equal((await dani('POST', '/plantillas/subidas', { nombre: 'ej-malo', html: con('{ no es json }') })).status, 400)
  assert.equal((await dani('POST', '/plantillas/subidas', { nombre: 'ej-lista', html: con('[1,2]') })).status, 400)
  // sin ejemplo: la vista previa no tiene HTML propio
  assert.equal((await dani('POST', '/plantillas/subidas', { nombre: 'sin-ejemplo', html: PLANTILLA() })).status, 201)
  assert.equal((await (await dani('GET', '/plantillas/subidas/sin-ejemplo/ejemplo')).json()).html, null)
  assert.equal((await (await dani('GET', '/plantillas/categorias')).json()).subidas['sin-ejemplo'].ejemplo, false)
  assert.equal((await dani('GET', '/plantillas/subidas/no-hay/ejemplo')).status, 404)
  for (const n of ['con-ejemplo', 'sin-ejemplo']) assert.equal((await dani('DELETE', '/plantillas/subidas/' + n)).status, 200)
})

test('el nombre de una plantilla subida sale del ID de la categoría y del orden de subida (g-09-v01, g-09-v02…) y el número no se reutiliza', async () => {
  const dani = await entrar('dani@u.co')
  const ana = await entrar('ana@u.co')
  const sube = (cuerpo) => dani('POST', '/plantillas/subidas', { html: PLANTILLA(), ...cuerpo })
  const r1 = await sube({ categoria: 'G-09' })
  assert.equal(r1.status, 201); assert.equal((await r1.json()).nombre, 'g-09-v01')
  assert.equal((await (await sube({ categoria: 'G-09' })).json()).nombre, 'g-09-v02')
  assert.equal((await (await sube({ categoria: 'G-01' })).json()).nombre, 'g-01-v01') // cada categoría lleva su propia cuenta
  // se entrega con ese nombre y queda en su categoría
  assert.equal((await fetch(base + '/plantillas-html/g-09-v01.html')).status, 200)
  const j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.equal(j.asignaciones['g-09-v01'], 'G-09')
  // al eliminar no se reutiliza el número
  assert.equal((await dani('DELETE', '/plantillas/subidas/g-09-v02')).status, 200)
  assert.equal((await (await sube({ categoria: 'G-09' })).json()).nombre, 'g-09-v03')
  // sin categoría ni nombre no hay de dónde sacar el nombre; sin permiso, tampoco
  assert.equal((await sube({})).status, 400)
  assert.equal((await ana('POST', '/plantillas/subidas', { html: PLANTILLA(), categoria: 'G-09' })).status, 403)
  // quien manda el nombre a mano lo conserva, y si ya existe el nombre automático se pasa al siguiente
  assert.equal((await sube({ nombre: 'g-09-v04', categoria: 'G-09' })).status, 201)
  assert.equal((await (await sube({ categoria: 'G-09' })).json()).nombre, 'g-09-v05')
  for (const n of ['g-09-v01', 'g-09-v03', 'g-09-v04', 'g-09-v05', 'g-01-v01']) assert.equal((await dani('DELETE', '/plantillas/subidas/' + n)).status, 200)
})

test('rol «editor_html»: ve la galería y sube variantes con vista previa, pero no ve las categorías para n8n ni aprueba, rechaza o manda a revisión', async () => {
  const edi = await entrar('edi@u.co')
  const ana = await entrar('ana@u.co')
  const dani = await entrar('dani@u.co')
  const html = PLANTILLA()
  // permisos: ve las plantillas y sube; no tiene los de revisar, corregir ni el de ver «Categorías para n8n»
  const yo = await (await edi('GET', '/auth/yo')).json()
  assert.ok(yo.roles.includes('editor_html'))
  assert.ok(yo.permisos.includes('plantillas.ver') && yo.permisos.includes('plantillas.subir'))
  for (const p of ['plantillas.revisar', 'plantillas.corregir', 'plantillas.categorias']) assert.equal(yo.permisos.includes(p), false, p)
  const yoDani = await (await dani('GET', '/auth/yo')).json()
  assert.ok(yoDani.permisos.includes('plantillas.categorias')); assert.equal((await (await ana('GET', '/auth/yo')).json()).permisos.includes('plantillas.categorias'), false) // el docente no ve nada de las plantillas
  // ve la galería (categorías, revisiones) en solo lectura
  assert.equal((await edi('GET', '/plantillas/categorias')).status, 200)
  assert.equal((await edi('GET', '/plantillas/revisiones')).status, 200)
  // vista previa antes de subir: valida y devuelve el nombre que le tocaría, sin guardar nada
  const previa = await edi('POST', '/plantillas/subidas/previa', { html, categoria: 'G-09' })
  assert.equal(previa.status, 200)
  const pj = await previa.json()
  assert.equal(pj.ok, true); assert.equal(pj.conEjemplo, false); assert.match(pj.nombre, /^g-09-v\d\d$/); assert.ok(pj.html.includes('<html'))
  assert.equal((await fetch(base + '/plantillas-html/' + pj.nombre + '.html')).status, 404) // la previa no guarda
  const conEj = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{{TITULO}}</title></head><body><script type="application/json" id="contenido">/*CONTENIDO*/{"titulo":"Con ejemplo"}/*FIN-CONTENIDO*/</script></body></html>'
  const pj2 = await (await edi('POST', '/plantillas/subidas/previa', { html: conEj })).json()
  assert.equal(pj2.conEjemplo, true); assert.ok(pj2.html.includes('Con ejemplo')); assert.equal(pj2.nombre, null)
  assert.equal((await edi('POST', '/plantillas/subidas/previa', { html: '<html><body>sin marcas</body></html>' })).status, 400)
  assert.equal((await edi('POST', '/plantillas/subidas/previa', { html, categoria: 'Z-99' })).status, 404)
  assert.equal((await ana('POST', '/plantillas/subidas/previa', { html, categoria: 'G-09' })).status, 403)
  // sube: queda con el nombre automático y en la categoría elegida
  const sube = await edi('POST', '/plantillas/subidas', { html, categoria: 'G-09' })
  assert.equal(sube.status, 201); const nombre = (await sube.json()).nombre
  assert.equal(nombre, pj.nombre) // el nombre que anunció la vista previa es el que se le da
  assert.equal((await fetch(base + '/plantillas-html/' + nombre + '.html')).status, 200)
  // lo demás sigue siendo de quien revisa: categorías, asignación, ocultar y eliminar las del sistema (lo propio se cambia, ver la prueba siguiente)
  assert.equal((await edi('POST', '/plantillas/categorias', { id: 'G-77', nombre: 'Nueva' })).status, 403)
  assert.equal((await edi('PUT', '/plantillas/asignacion/acordeon', { categoria: 'G-09' })).status, 403)
  assert.equal((await edi('PUT', '/plantillas/ocultas/acordeon-3', { oculta: true })).status, 403)
  assert.equal((await edi('DELETE', '/plantillas/sistema/acordeon-3')).status, 403)
  // no puede aprobar, rechazar, mandar a revisión ni marcar como corregida
  for (const estado of ['aprobada', 'rechazada', 'revision', 'corregida']) assert.equal((await edi('POST', '/plantillas/revisiones', { plantilla: 'acordeon', estado, observacion: 'x' })).status, 403, estado)
  assert.equal((await dani('DELETE', '/plantillas/subidas/' + nombre)).status, 200)
})

test('formaciones por categoría: salen del catálogo, aparecen en el índice y se editan solo quien revisa', async () => {
  const dani = await entrar('dani@u.co')
  const ana = await entrar('ana@u.co')
  // punto de partida: el catálogo de IDs ya trae para qué formaciones sirve cada categoría
  const j = await (await dani('GET', '/plantillas/categorias')).json()
  assert.deepEqual(j.formaciones['G-01'].map((x) => x.formacion), ['tecnologico', 'profesional', 'especializacion', 'doctorado'])
  assert.deepEqual(j.formaciones['G-01'].map((x) => x.prioridad), ['P', 'P', 'C', 'C'])
  assert.deepEqual(j.formaciones['G-06'].map((x) => x.formacion), ['tecnologico', 'profesional', 'especializacion']) // micro-learning no va en doctorado
  // el índice público lo trae por categoría, sin romper lo que ya leía n8n
  const ix = await indice()
  assert.deepEqual(ix.categorias.find((c) => c.id === 'G-09').formaciones, [{ formacion: 'tecnologico', prioridad: 'P' }, { formacion: 'profesional', prioridad: 'P' }, { formacion: 'especializacion', prioridad: 'C' }, { formacion: 'doctorado', prioridad: 'C' }])
  assert.ok(Array.isArray(ix.categorias.find((c) => c.id === 'G-09').variantes))
  // editar: solo quien revisa; se valida
  assert.equal((await ana('PUT', '/plantillas/categorias/G-09/formaciones', { formaciones: [] })).status, 403)
  assert.equal((await dani('PUT', '/plantillas/categorias/Z-99/formaciones', { formaciones: [] })).status, 404)
  assert.equal((await dani('PUT', '/plantillas/categorias/G-09/formaciones', { formaciones: [{ formacion: 'bachillerato', prioridad: 'P' }] })).status, 400)
  assert.equal((await dani('PUT', '/plantillas/categorias/G-09/formaciones', { formaciones: [{ formacion: 'doctorado' }, { formacion: 'doctorado' }] })).status, 400)
  assert.equal((await dani('PUT', '/plantillas/categorias/G-09/formaciones', { formaciones: [{ formacion: 'doctorado', prioridad: 'C' }, { formacion: 'tecnologico' }] })).status, 200)
  const k = await (await dani('GET', '/plantillas/categorias')).json()
  assert.deepEqual(k.formaciones['G-09'], [{ formacion: 'tecnologico', prioridad: 'P' }, { formacion: 'doctorado', prioridad: 'C' }])
  // volver a migrar no pisa lo editado
  assert.deepEqual((await indice()).categorias.find((c) => c.id === 'G-09').formaciones.map((x) => x.formacion), ['tecnologico', 'doctorado'])
  // una categoría sin formaciones sale con la lista vacía
  assert.equal((await dani('PUT', '/plantillas/categorias/G-09/formaciones', { formaciones: [] })).status, 200)
  assert.deepEqual((await indice()).categorias.find((c) => c.id === 'G-09').formaciones, [])
  // se restablece para no afectar otras pruebas
  assert.equal((await dani('PUT', '/plantillas/categorias/G-09/formaciones', { formaciones: [{ formacion: 'tecnologico' }, { formacion: 'profesional' }, { formacion: 'especializacion', prioridad: 'C' }, { formacion: 'doctorado', prioridad: 'C' }] })).status, 200)
})

test('subir varios archivos seguidos a la misma categoría: cada uno con su nombre en orden, y uno que falla no frena a los demás', async () => {
  const dani = await entrar('dani@u.co')
  const bueno = PLANTILLA()
  const archivos = [bueno, '<html><body>sin marcas</body></html>', bueno, bueno]
  const nombres = []
  const errores = []
  // la pantalla sube uno tras otro (revisión y subida de cada uno); 40 peticiones en un minuto no deben toparse con el tope
  for (const html of archivos) {
    const previa = await dani('POST', '/plantillas/subidas/previa', { html, categoria: 'G-10' })
    if (previa.status !== 200) { errores.push(previa.status); continue }
    const r = await dani('POST', '/plantillas/subidas', { html, categoria: 'G-10' })
    assert.equal(r.status, 201); nombres.push((await r.json()).nombre)
  }
  assert.deepEqual(errores, [400])
  assert.equal(nombres.length, 3)
  const nums = nombres.map((n) => Number(/-v(\d+)$/.exec(n)[1]))
  assert.deepEqual(nums, [nums[0], nums[0] + 1, nums[0] + 2]) // en el orden en que se subieron, sin huecos
  assert.ok(nombres.every((n) => n.startsWith('g-10-v')))
  for (let i = 0; i < 40; i++) assert.equal((await dani('POST', '/plantillas/subidas/previa', { html: bueno, categoria: 'G-10' })).status, 200, 'revisión ' + i)
  for (const n of nombres) assert.equal((await dani('DELETE', '/plantillas/subidas/' + n)).status, 200)
})

test('cada editor puede reemplazar, mover y eliminar solo las plantillas que subió; quien revisa, cualquiera', async () => {
  const edi = await entrar('edi@u.co')
  const edu = await entrar('edu@u.co')
  const dani = await entrar('dani@u.co')
  const ana = await entrar('ana@u.co')
  const html = PLANTILLA()
  const suya = (await (await edi('POST', '/plantillas/subidas', { html, categoria: 'G-09' })).json()).nombre
  const deEdu = (await (await edu('POST', '/plantillas/subidas', { html, categoria: 'G-09' })).json()).nombre
  // la lista le dice cuáles son suyas
  const lista = (await (await edi('GET', '/plantillas/categorias')).json()).subidas
  assert.equal(lista[suya].propia, true); assert.equal(lista[deEdu].propia, false)
  // lo ajeno no se toca: ni reemplazar, ni mover, ni eliminar
  assert.equal((await edi('PUT', '/plantillas/subidas/' + deEdu, { html })).status, 403)
  assert.equal((await edi('POST', '/plantillas/subidas/' + deEdu + '/mover', { categoria: 'G-10' })).status, 403)
  assert.equal((await edi('DELETE', '/plantillas/subidas/' + deEdu)).status, 403)
  assert.equal((await ana('DELETE', '/plantillas/subidas/' + suya)).status, 403)
  assert.equal((await edi('DELETE', '/plantillas/subidas/no-existe')).status, 404)
  // lo propio sí: reemplazar
  assert.equal((await edi('PUT', '/plantillas/subidas/' + suya, { html })).status, 200)
  // mover: cambia de categoría y de nombre (el nombre lleva el ID de la categoría) y arrastra su historial
  assert.equal((await edi('POST', '/plantillas/subidas/' + suya + '/mover', { categoria: 'G-09' })).status, 400) // ya está ahí
  assert.equal((await edi('POST', '/plantillas/subidas/' + suya + '/mover', { categoria: 'Z-99' })).status, 404)
  await pool.query("INSERT INTO plantilla_historial (plantilla, estado, observacion, usuario_nombre, rol) VALUES ($1, 'revision', 'cambios', 'Dani', 'disenador')", ['pub-' + suya])
  const mv = await edi('POST', '/plantillas/subidas/' + suya + '/mover', { categoria: 'G-10' })
  assert.equal(mv.status, 200)
  const nuevo = (await mv.json()).nombre
  assert.match(nuevo, /^g-10-v\d\d$/)
  assert.equal((await fetch(base + '/plantillas-html/' + suya + '.html')).status, 404) // el nombre viejo ya no existe
  assert.equal((await fetch(base + '/plantillas-html/' + nuevo + '.html')).status, 200)
  const j = await (await edi('GET', '/plantillas/categorias')).json()
  assert.equal(j.asignaciones[nuevo], 'G-10'); assert.equal(j.asignaciones[suya], undefined)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM plantilla_historial WHERE plantilla = $1", ['pub-' + nuevo])).rows[0].n, 1)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM plantilla_historial WHERE plantilla = $1", ['pub-' + suya])).rows[0].n, 0)
  // eliminar lo propio
  assert.equal((await edi('DELETE', '/plantillas/subidas/' + nuevo)).status, 200)
  assert.equal((await fetch(base + '/plantillas-html/' + nuevo + '.html')).status, 404)
  // quien revisa cambia cualquiera
  assert.equal((await dani('POST', '/plantillas/subidas/' + deEdu + '/mover', { categoria: 'G-10' })).status, 200)
  const movida = (await (await dani('GET', '/plantillas/categorias')).json()).asignaciones
  const enG10 = Object.keys(movida).find((n) => movida[n] === 'G-10' && n.startsWith('g-10-v'))
  assert.ok(enG10)
  assert.equal((await dani('DELETE', '/plantillas/subidas/' + enG10)).status, 200)
})

test('las variantes de una categoría usan los mismos campos de contenido; el índice dice el estado de cada una y si sus campos coinciden', async () => {
  const dani = await entrar('dani@u.co')
  const edi = await entrar('edi@u.co')
  const con = (campos) => '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{{TITULO}}</title></head><body><script type="application/json" id="contenido">/*CONTENIDO*/' + JSON.stringify(campos) + '/*FIN-CONTENIDO*/</script></body></html>'
  const A = { titulo: 'A', bloques: [{ titulo: 'x', texto: 'y' }], nivel: 'tecnologia' }
  const A2 = { titulo: 'Otro', bloques: [{ titulo: 'm', texto: 'n' }, { titulo: 'o', texto: 'p' }] } // mismos campos (cambian los valores y la cantidad; «nivel» no cuenta)
  const B = { titulo: 'B', pasos: [{ nombre: 'x' }] } // campos distintos
  const sube = (campos, extra = {}, quien = edi) => quien('POST', '/plantillas/subidas', { html: con(campos), categoria: 'G-11', ...extra })
  // la primera de la categoría fija los campos; la segunda con los mismos entra
  const r1 = await sube(A); assert.equal(r1.status, 201); const n1 = (await r1.json()).nombre
  const r2 = await sube(A2); assert.equal(r2.status, 201); const n2 = (await r2.json()).nombre
  // una con campos distintos se rechaza, con el detalle, y no se guarda
  const r3 = await sube(B)
  assert.equal(r3.status, 409)
  const d3 = await r3.json()
  assert.equal(d3.requiereConfirmacion, 'esquema'); assert.ok(d3.faltan.length && d3.sobran.length); assert.equal(d3.referencia, n1); assert.match(d3.error, /mismos campos/)
  // el editor no puede forzarla; quien revisa sí, y queda marcada
  assert.equal((await sube(B, { esquemaDistinto: true })).status, 409)
  const r4 = await sube(B, { esquemaDistinto: true }, dani); assert.equal(r4.status, 201); const n4 = (await r4.json()).nombre
  // la vista previa avisa antes de subir
  const pv = await (await edi('POST', '/plantillas/subidas/previa', { html: con(B), categoria: 'G-11' })).json()
  assert.equal(pv.esquema.coincide, false); assert.equal(pv.esquema.referencia, n1)
  assert.equal((await (await edi('POST', '/plantillas/subidas/previa', { html: con(A2), categoria: 'G-11' })).json()).esquema.coincide, true)
  assert.equal((await (await edi('POST', '/plantillas/subidas/previa', { html: con(A2) })).json()).esquema, null) // sin categoría no hay con qué comparar
  // reemplazar y mover también respetan los campos
  assert.equal((await edi('PUT', '/plantillas/subidas/' + n2, { html: con(B) })).status, 409)
  assert.equal((await edi('PUT', '/plantillas/subidas/' + n2, { html: con(A) })).status, 200)
  assert.equal((await edi('POST', '/plantillas/subidas/' + n2 + '/mover', { categoria: 'G-10' })).status, 200) // G-10 no tiene variantes con ejemplo: entra sin problema
  // el índice: estado por variante (sin historial = en_revision) y si los campos coinciden con los de su categoría
  const ix = await indice()
  const v = ix.categorias.find((c) => c.id === 'G-11').variantes
  const e1 = v.find((x) => x.nombre === n1); const e4 = v.find((x) => x.nombre === n4)
  assert.equal(e1.estado, 'en_revision'); assert.equal(e1.fecha_estado, null); assert.equal(e1.esquema_ok, true); assert.equal(e4.esquema_ok, false)
  assert.equal(e1.archivo, n1 + '.html') // el nombre del índice es el de la dirección pública
  assert.equal((await fetch(base + '/plantillas-html/' + n1 + '.html')).status, 200)
  await pool.query("INSERT INTO plantilla_historial (plantilla, estado, observacion, usuario_nombre, rol) VALUES ($1, 'aprobada', 'ok', 'Dani', 'disenador'), ($2, 'rechazada', 'no', 'Dani', 'disenador'), ($3, 'corregida', 'ya', 'Dani', 'disenador')", ['pub-' + n1, 'pub-' + n4, 'pub-' + n1 + 'x'])
  const v2 = (await indice()).categorias.find((c) => c.id === 'G-11').variantes
  assert.equal(v2.find((x) => x.nombre === n1).estado, 'aprobada'); assert.match(v2.find((x) => x.nombre === n1).fecha_estado, /^\d{4}-\d\d-\d\dT/)
  assert.equal(v2.find((x) => x.nombre === n4).estado, 'rechazada')
  for (const n of [n1, n4]) assert.equal((await dani('DELETE', '/plantillas/subidas/' + n)).status, 200)
  const mov = Object.keys((await (await dani('GET', '/plantillas/categorias')).json()).asignaciones).find((n) => n.startsWith('g-10-v'))
  if (mov) assert.equal((await dani('DELETE', '/plantillas/subidas/' + mov)).status, 200)
})

test('el índice público lista solo las plantillas subidas desde Praxia (Praxia es la única fuente), sin las del sistema', async () => {
  const dani = await entrar('dani@u.co')
  const sube = await dani('POST', '/plantillas/subidas', { html: PLANTILLA(), categoria: 'G-12' })
  assert.equal(sube.status, 201); const nombre = (await sube.json()).nombre
  delete process.env.PLANTILLAS_INDICE_SOLO_SUBIDAS // comportamiento por defecto
  try {
    const ix = await indice()
    assert.deepEqual(ix.plantillas.map((p) => p.nombre), [nombre])
    assert.equal(ix.total, 1)
    assert.deepEqual(ix.categorias.find((c) => c.id === 'G-12').variantes.map((v) => v.nombre), [nombre])
    assert.deepEqual(ix.categorias.find((c) => c.id === 'G-09').variantes, []) // las del sistema ya no salen
    assert.deepEqual(ix.sin_categoria, [])
    assert.ok(ix.marcas && ix.marcas.titulo === '{{TITULO}}') // lo demás del índice sigue igual
    assert.equal((await fetch(base + '/plantillas-html/' + nombre + '.html')).status, 200)
  } finally { process.env.PLANTILLAS_INDICE_SOLO_SUBIDAS = '0' }
  assert.equal((await dani('DELETE', '/plantillas/subidas/' + nombre)).status, 200)
})

test('la ficha de la plantilla puede decir su categoría y su formación: Praxia la preselecciona, avisa si no coincide y guarda la formación de la variante', async () => {
  const edi = await entrar('edi@u.co')
  const ficha = (cat, form) => ['<!--', '  FICHA', '  Categoría Praxia: ' + cat, '  Formación: ' + form, '-->'].join('\n')
  const con = (f) => '<!doctype html><html lang="es"><head><meta charset="utf-8">' + f + '<title>{{TITULO}}</title></head><body><script type="application/json" id="contenido">/*CONTENIDO*/{"titulo":"X","items":[{"a":"b"}]}/*FIN-CONTENIDO*/</script></body></html>'
  // la vista previa, sin categoría elegida, usa la de la ficha (nombre y comparación) y devuelve lo que leyó
  const pv = await (await edi('POST', '/plantillas/subidas/previa', { html: con(ficha('G-03', 'Especialización')) })).json()
  assert.deepEqual(pv.ficha, { categoria: 'G-03', formacion: 'especializacion' }); assert.equal(pv.categoriaUsada, 'G-03'); assert.match(pv.nombre, /^g-03-v\d\d$/); assert.deepEqual(pv.avisos, [])
  // si elegiste otra categoría, avisa; y si la formación de la ficha no es de esa categoría (G-06 no es de doctorado), también
  const pv2 = await (await edi('POST', '/plantillas/subidas/previa', { html: con(ficha('G-03', 'tecnologico')), categoria: 'G-09' })).json()
  assert.ok(pv2.avisos.some((a) => /G-03/.test(a) && /G-09/.test(a)))
  const pv3 = await (await edi('POST', '/plantillas/subidas/previa', { html: con(ficha('G-06', 'doctorado')), categoria: 'G-06' })).json()
  assert.ok(pv3.avisos.some((a) => /doctorado/.test(a)))
  // sin categoría en la petición, sube a la de la ficha y guarda la formación; sin ficha ni categoría se rechaza; con una categoría que no existe, 404
  const r = await edi('POST', '/plantillas/subidas', { html: con(ficha('G-03', 'Licenciatura')) })
  assert.equal(r.status, 201); const n = (await r.json()).nombre
  assert.match(n, /^g-03-v\d\d$/)
  const lista = await (await edi('GET', '/plantillas/categorias')).json()
  assert.equal(lista.asignaciones[n], 'G-03'); assert.equal(lista.subidas[n].formacion, 'profesional') // «licenciatura» es profesional
  assert.equal((await edi('POST', '/plantillas/subidas', { html: con('') })).status, 400)
  assert.equal((await edi('POST', '/plantillas/subidas', { html: con(ficha('Z-99', 'doctorado')) })).status, 404)
  // el índice trae la formación de cada variante (null si la ficha no la dice)
  delete process.env.PLANTILLAS_INDICE_SOLO_SUBIDAS
  try {
    const v = (await indice()).categorias.find((c) => c.id === 'G-03').variantes.find((x) => x.nombre === n)
    assert.equal(v.formacion, 'profesional')
  } finally { process.env.PLANTILLAS_INDICE_SOLO_SUBIDAS = '0' }
  // una variante con la ficha sin formación queda con null
  const sin = (await (await edi('POST', '/plantillas/subidas', { html: con('<!-- sin ficha -->'), categoria: 'G-03' })).json()).nombre
  assert.equal((await (await edi('GET', '/plantillas/categorias')).json()).subidas[sin].formacion, null)
  const dani = await entrar('dani@u.co')
  for (const x of [n, sin]) assert.equal((await dani('DELETE', '/plantillas/subidas/' + x)).status, 200)
})

test('borrar una categoría deja sus plantillas sin categoría; si falla la base de datos se entrega el archivo del build tal cual', async () => {
  const dani = await entrar('dani@u.co')
  assert.equal((await dani('DELETE', '/plantillas/categorias/G-20')).status, 200)
  assert.equal((await dani('DELETE', '/plantillas/categorias/G-20')).status, 404)
  let j = await indice()
  assert.equal(j.categorias.some((c) => c.id === 'G-20'), false)
  assert.equal(j.plantillas.find((p) => p.nombre === 'crucigrama').id_catalogo, null)
  assert.ok(j.sin_categoria.some((p) => p.nombre === 'crucigrama'))
  // la base de datos deja de responder: n8n sigue recibiendo las plantillas
  await pool.end(); poolCerrado = true
  const r = await fetch(base + '/plantillas-html/plantillas.json')
  assert.equal(r.status, 200)
  j = await r.json()
  assert.equal(j.total, NOMBRES.length); assert.equal(j.categorias, undefined)
})

