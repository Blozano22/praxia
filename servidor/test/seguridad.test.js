// Prueba de extremo a extremo contra un PostgreSQL real y temporal (embedded-postgres).
// Verifica permisos, propiedad de los datos (cada usuario solo ve lo que crea) y resistencia a inyección SQL.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const PUERTO_PG = 54329
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-pg-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })

let servidor, base, pool
const CLAVE = 'ClaveSegura123'

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')

  const duenio = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await duenio.connect()
  await duenio.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', '001_esquema.sql'), 'utf8'))
  await duenio.end()

  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '1000' // la prueba hace muchos accesos desde una misma IP
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  const { Q } = await import('../src/consultas.js')
  pool = db.pool

  for (const [nombre, correo, rol] of [['Admin', 'admin@u.co', 'admin'], ['Ana', 'ana@u.co', 'docente'], ['Beto', 'beto@u.co', 'docente'], ['Coco', 'coco@u.co', 'coordinador'], ['Cora', 'cora@u.co', 'coordinador'], ['Dani', 'dani@u.co', 'disenador']]) {
    await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), [rol]])
  }
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})

after(async () => {
  servidor && servidor.close()
  pool && (await pool.end())
  await servidorPg.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

// Cliente mínimo con cookie de sesión.
async function entrar(correo, clave = CLAVE) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave }) })
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  const api = (metodo, ruta, cuerpo) => fetch(base + '/api' + ruta, {
    method: metodo,
    headers: { cookie, 'x-ova': '1', ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
  })
  return { estado: r.status, api }
}
const proyecto = (id, extra = {}) => ({
  id, programa: 'Licenciatura', curso: 'Didáctica ' + id, creado: Date.now(),
  syllabusUrl: 'https://docs.google.com/document/d/abc', carpetaUrl: 'https://drive.google.com/drive/folders/xyz',
  syllabus: { estado: 'listo', documentos: [{ unidad: 1, nombre: 'Unidad 1', url: 'https://docs.google.com/document/d/u1', temas: [] }, { unidad: 2, nombre: 'Insegura', url: 'http://sitio.com/x' }] },
  guionesUnidad: { 1: { archivos: [{ nombre: 'Guion 1', url: 'https://docs.google.com/document/d/g1' }] } },
  ...extra
})

test('el login rechaza claves incorrectas con el mismo mensaje, exista o no el correo', async () => {
  const a = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo: 'ana@u.co', clave: 'incorrecta' }) })
  const b = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo: 'nadie@u.co', clave: 'incorrecta' }) })
  assert.equal(a.status, 401)
  assert.equal(b.status, 401)
  assert.deepEqual(await a.json(), await b.json())
})

test('cada usuario solo ve y modifica lo que él creó', async () => {
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  assert.equal(ana.estado, 200)

  assert.equal((await ana.api('PUT', '/proyectos/p1', proyecto('p1'))).status, 200)
  const listaAna = await (await ana.api('GET', '/proyectos')).json()
  assert.equal(listaAna.length, 1)

  // Beto no ve nada de Ana
  assert.deepEqual(await (await beto.api('GET', '/proyectos')).json(), [])
  assert.deepEqual(await (await beto.api('GET', '/proyectos/p1/enlaces')).json(), [])
  // Beto no puede borrar el de Ana
  assert.equal((await beto.api('DELETE', '/proyectos/p1')).status, 404)
  // Beto usando el mismo id crea el SUYO: no pisa el de Ana
  assert.equal((await beto.api('PUT', '/proyectos/p1', proyecto('p1', { curso: 'De Beto' }))).status, 200)
  const deAna = await (await ana.api('GET', '/proyectos')).json()
  assert.equal(deAna[0].curso, 'Didáctica p1')
  const deBeto = await (await beto.api('GET', '/proyectos')).json()
  assert.equal(deBeto[0].curso, 'De Beto')
  assert.equal((await ana.api('DELETE', '/proyectos/p1')).status, 200)
  assert.equal((await (await beto.api('GET', '/proyectos')).json()).length, 1)
  await beto.api('DELETE', '/proyectos/p1')
})

test('los enlaces se guardan por propietario y solo https', async () => {
  const coco = await entrar('coco@u.co')
  await coco.api('PUT', '/proyectos/e1', proyecto('e1'))
  const enlaces = await (await coco.api('GET', '/proyectos/e1/enlaces')).json()
  const tipos = enlaces.map((e) => e.tipo).sort()
  assert.deepEqual(tipos, ['carpeta', 'documento_unidad', 'guion', 'syllabus'])
  assert.ok(enlaces.every((e) => e.url.startsWith('https://')))
})

test('la base de datos protege las filas aunque la consulta no filtre (RLS)', async () => {
  const { rows: us } = await pool.query("SELECT id, correo FROM usuarios WHERE correo IN ('ana@u.co','beto@u.co')")
  const ana = us.find((u) => u.correo === 'ana@u.co').id
  const beto = us.find((u) => u.correo === 'beto@u.co').id
  const a = await entrar('ana@u.co')
  await a.api('PUT', '/proyectos/rls1', proyecto('rls1'))

  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.usuario_id', $1, true)", [beto])
    // consulta SIN filtro por propietario: aun así solo debe devolver lo de Beto
    const r = await c.query('SELECT propietario_id FROM proyectos')
    assert.ok(r.rows.every((f) => f.propietario_id === beto))
    // intento de escribir como Ana estando en la sesión de Beto: la base lo rechaza
    await assert.rejects(c.query("INSERT INTO proyectos (propietario_id, id, programa, curso, datos) VALUES ($1,'robo','x','x','{}')", [ana]))
    await c.query('ROLLBACK')
    // sin identificar al usuario no se ve nada
    await c.query('BEGIN')
    assert.equal((await c.query('SELECT 1 FROM proyectos')).rowCount, 0)
    await c.query('ROLLBACK')
  } finally { c.release() }
})

test('intentos de inyección SQL no tienen efecto', async () => {
  const ana = await entrar('ana@u.co')
  // login con carga maliciosa: se rechaza por formato
  const m = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo: "' OR 1=1 --", clave: "' OR '1'='1" }) })
  assert.equal(m.status, 400)
  const m2 = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo: "ana@u.co' OR '1'='1", clave: 'x' }) })
  assert.equal(m2.status, 400)
  // identificadores con SQL: rechazados antes de llegar a la base
  assert.equal((await ana.api('PUT', "/proyectos/x'; DROP TABLE proyectos;--", proyecto('x'))).status, 400)
  assert.equal((await ana.api('DELETE', "/proyectos/1 OR 1=1")).status, 400)
  // texto con comillas y SQL dentro de un campo: se guarda como texto, sin ejecutarse
  const raro = proyecto('inj1', { programa: "'); DROP TABLE enlaces; --", curso: "Robert'); DELETE FROM proyectos; --" })
  assert.equal((await ana.api('PUT', '/proyectos/inj1', raro)).status, 200)
  const lista = await (await ana.api('GET', '/proyectos')).json()
  assert.equal(lista.find((p) => p.id === 'inj1').programa, "'); DROP TABLE enlaces; --")
  const tablas = (await pool.query("SELECT to_regclass('public.proyectos') AS p, to_regclass('public.enlaces') AS e")).rows[0]
  assert.ok(tablas.p && tablas.e)
  await ana.api('DELETE', '/proyectos/inj1')
})

test('los permisos por rol se respetan', async () => {
  const ana = await entrar('ana@u.co')
  const admin = await entrar('admin@u.co')
  assert.equal((await ana.api('GET', '/usuarios')).status, 403)
  assert.equal((await ana.api('GET', '/auditoria')).status, 403)
  // el admin gestiona usuarios pero no entra a los syllabus de nadie
  assert.equal((await admin.api('GET', '/usuarios')).status, 200)
  assert.equal((await admin.api('GET', '/proyectos')).status, 403)
  const nuevo = await admin.api('POST', '/usuarios', { nombre: 'Nuevo', correo: 'nuevo@u.co', clave: 'débil', roles: ['docente'] })
  assert.equal(nuevo.status, 400)
  const ok = await admin.api('POST', '/usuarios', { nombre: 'Nuevo', correo: 'nuevo@u.co', clave: CLAVE, roles: ['docente'] })
  assert.equal(ok.status, 201)
  assert.equal((await admin.api('POST', '/usuarios', { nombre: 'Otro', correo: 'nuevo@u.co', clave: CLAVE, roles: ['docente'] })).status, 409)
  // rol inventado: rechazado
  assert.equal((await admin.api('POST', '/usuarios', { nombre: 'Otro', correo: 'otro@u.co', clave: CLAVE, roles: ['superadmin'] })).status, 400)
  // la respuesta nunca incluye hashes de clave
  const lista = JSON.stringify(await (await admin.api('GET', '/usuarios')).json())
  assert.ok(!lista.includes('clave_hash') && !lista.includes('$2'))
})

test('desactivar un usuario cierra su sesión al instante', async () => {
  const admin = await entrar('admin@u.co')
  const beto = await entrar('beto@u.co')
  assert.equal((await beto.api('GET', '/auth/yo')).status, 200)
  const id = (await pool.query("SELECT id FROM usuarios WHERE correo='beto@u.co'")).rows[0].id
  assert.equal((await admin.api('PATCH', `/usuarios/${id}/activo`, { activo: false })).status, 200)
  assert.equal((await beto.api('GET', '/auth/yo')).status, 401)
  assert.equal((await entrar('beto@u.co')).estado, 401)
  assert.equal((await admin.api('PATCH', `/usuarios/${id}/activo`, { activo: true })).status, 200)
})

test('una persona con dos roles (admin y docente) suma los permisos de ambos', async () => {
  const admin = await entrar('admin@u.co')
  const r = await admin.api('POST', '/usuarios', { nombre: 'Doble', correo: 'doble@u.co', clave: CLAVE, roles: ['admin', 'docente'] })
  assert.equal(r.status, 201)
  const doble = await entrar('doble@u.co')
  const yo = await (await doble.api('GET', '/auth/yo')).json()
  assert.deepEqual(yo.roles, ['admin', 'docente'])
  // como admin gestiona usuarios; como docente crea y ve SUS syllabus
  assert.equal((await doble.api('GET', '/usuarios')).status, 200)
  assert.equal((await doble.api('PUT', '/proyectos/d1', proyecto('d1'))).status, 200)
  assert.equal((await (await doble.api('GET', '/proyectos')).json()).length, 1)
  // y sigue sin ver los de otras personas
  const ana = await entrar('ana@u.co')
  assert.deepEqual(await (await ana.api('GET', '/proyectos')).json().then((l) => l.filter((p) => p.id === 'd1')), [])
  // roles repetidos o vacíos se rechazan
  assert.equal((await admin.api('POST', '/usuarios', { nombre: 'X', correo: 'x@u.co', clave: CLAVE, roles: ['docente', 'docente'] })).status, 400)
  assert.equal((await admin.api('POST', '/usuarios', { nombre: 'X', correo: 'x@u.co', clave: CLAVE, roles: [] })).status, 400)
  // cambiar sus roles deja una sola cosa
  const id = (await pool.query("SELECT id FROM usuarios WHERE correo='doble@u.co'")).rows[0].id
  assert.equal((await admin.api('PATCH', `/usuarios/${id}/roles`, { roles: ['docente'] })).status, 200)
  assert.equal((await doble.api('GET', '/usuarios')).status, 401) // su sesión anterior se cerró al cambiar roles
  const doble2 = await entrar('doble@u.co')
  assert.equal((await doble2.api('GET', '/usuarios')).status, 403)
})

test('las escrituras sin el encabezado de seguridad se rechazan', async () => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ correo: 'ana@u.co', clave: CLAVE }) })
  assert.equal(r.status, 400)
})

test('tras 5 fallos la cuenta se bloquea aunque luego llegue la clave correcta', async () => {
  for (let i = 0; i < 5; i++) await entrar('coco@u.co', 'mala' + i)
  assert.equal((await entrar('coco@u.co')).estado, 401)
})

test('el coordinador ve el avance de todos los cursos (solo cifras, solo lectura) y el docente no', async () => {
  const ana = await entrar('ana@u.co'), beto = await entrar('beto@u.co'), coco = await entrar('cora@u.co')
  assert.equal((await ana.api('PUT', '/proyectos/seg-ana', proyecto('seg-ana'))).status, 200)
  assert.equal((await beto.api('PUT', '/proyectos/seg-beto', proyecto('seg-beto'))).status, 200)

  const resp = await coco.api('GET', '/seguimiento')
  const lista = await resp.json()
  assert.equal(resp.status, 200, JSON.stringify(lista))
  const ids = lista.map((f) => f.id)
  assert.ok(ids.includes('seg-ana') && ids.includes('seg-beto'), 'el coordinador ve los cursos de todos')
  const fila = lista.find((f) => f.id === 'seg-ana')
  assert.equal(fila.responsable, 'Ana')
  assert.equal(fila.unidades, 2)
  assert.equal(fila.unidades_con_guion, 1)
  assert.ok(!('datos' in fila) && !('guionesUnidad' in fila), 'solo cifras, no el contenido')

  // sigue sin poder abrir ni modificar lo ajeno
  const propios = await (await coco.api('GET', '/proyectos')).json()
  assert.ok(!propios.some((p) => p.id === 'seg-ana'), 'su lista de trabajo sigue siendo solo lo suyo')
  assert.equal((await coco.api('DELETE', '/proyectos/seg-ana')).status, 404)

  assert.equal((await ana.api('GET', '/seguimiento')).status, 403, 'el docente no tiene seguimiento')
})

test('el diseñador solo puede ver las plantillas: sin syllabus, seguimiento ni usuarios', async () => {
  const dani = await entrar('dani@u.co')
  const yo = await (await dani.api('GET', '/auth/yo')).json()
  assert.deepEqual(yo.roles, ['disenador'])
  assert.deepEqual(yo.permisos, ['plantillas.ver'])
  assert.equal((await dani.api('GET', '/proyectos')).status, 403)
  assert.equal((await dani.api('PUT', '/proyectos/dis-1', proyecto('dis-1'))).status, 403)
  assert.equal((await dani.api('GET', '/seguimiento')).status, 403)
  assert.equal((await dani.api('GET', '/usuarios')).status, 403)
})

test('el administrador edita nombre y correo; no se repite un correo y los demás roles no pueden', async () => {
  const admin = await entrar('admin@u.co')
  const lista = await (await admin.api('GET', '/usuarios')).json()
  const dani = lista.find((u) => u.correo === 'dani@u.co')
  const ana = lista.find((u) => u.correo === 'ana@u.co')
  const ok = await admin.api('PATCH', '/usuarios/' + dani.id + '/datos', { nombre: 'Daniela D.', correo: 'Daniela@U.co' })
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { id: dani.id, nombre: 'Daniela D.', correo: 'daniela@u.co' })
  assert.equal((await admin.api('PATCH', '/usuarios/' + dani.id + '/datos', { nombre: 'Daniela D.', correo: 'ana@u.co' })).status, 409)
  assert.equal((await admin.api('PATCH', '/usuarios/' + dani.id + '/datos', { nombre: 'x', correo: 'no-es-correo' })).status, 400)
  assert.equal((await admin.api('PATCH', '/usuarios/' + dani.id + '/datos', { nombre: 'Dani', correo: 'dani@u.co', rol: 'admin' })).status, 400)
  const beto = await entrar('beto@u.co')
  assert.equal((await beto.api('PATCH', '/usuarios/' + ana.id + '/datos', { nombre: 'Otra', correo: 'otra@u.co' })).status, 403)
  assert.equal((await admin.api('PATCH', '/usuarios/' + dani.id + '/datos', { nombre: 'Dani', correo: 'dani@u.co' })).status, 200)
})

test('ninguna consulta se arma concatenando texto', () => {
  const codigo = fs.readFileSync(path.join(aqui, '..', 'src', 'consultas.js'), 'utf8')
  assert.ok(!codigo.includes('${'), 'consultas.js no debe interpolar valores')
  const rutas = fs.readFileSync(path.join(aqui, '..', 'src', 'rutas.js'), 'utf8')
  assert.ok(!/query\(\s*[`'"]/.test(rutas), 'las rutas no escriben SQL: usan las consultas fijas de Q')
})
