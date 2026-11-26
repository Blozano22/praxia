// «Generar rúbrica»: permiso, validación de enlaces, llamada al flujo de n8n en segundo plano, errores y un solo trabajo por persona. Sin base ni red (n8n simulado).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { crearRutasRubricas } from '../src/rubricas/rutas.js'

const DOC = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit'
const DOC2 = 'https://docs.google.com/document/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210/edit'
const CARPETA = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt'
const sesion = (permisos, id = '00000000-0000-0000-0000-000000000001') => [
  (req, res, next) => { req.usuario = { id, nombre: 'Rita', permisos: new Set(permisos) }; next() },
  (req, res, next) => (req.usuario.permisos.has('rubricas.generar') ? next() : res.status(403).json({ error: 'No tienes permiso para esto' }))
]

async function conServidor(opciones, prueba) {
  const app = express()
  app.use(express.json())
  app.use('/api/rubricas', crearRutasRubricas({ auditar: async () => {}, ...opciones }))
  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)) })
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/rubricas'
  const pedir = async (m, ruta, cuerpo) => {
    const r = await fetch(base + ruta, { method: m, headers: cuerpo ? { 'content-type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
    let d = null
    try { d = await r.json() } catch { /* sin cuerpo */ }
    return { estado: r.status, d }
  }
  try { await prueba(pedir) } finally { srv.close() }
}
const respuesta = (cuerpo, estado = 200) => ({ ok: estado < 300, status: estado, text: async () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) })
const esperar = async (pedir, id) => { for (let i = 0; i < 50; i++) { const r = await pedir('GET', '/' + id); if (r.d.estado !== 'en_curso') return r; await new Promise((x) => setTimeout(x, 20)) } throw new Error('no terminó') }

test('rúbricas: sin el permiso rubricas.generar no se entra a ninguna ruta', async () => {
  let llamadas = 0
  await conServidor({ antes: sesion(['plantillas.ver', 'plantillas.imagenes']), direccion: async () => 'https://n8n.x/webhook/r', llamar: async () => { llamadas++; return respuesta({}) } }, async (pedir) => {
    assert.equal((await pedir('GET', '/estado')).estado, 403)
    assert.equal((await pedir('POST', '/', { unidades: [DOC], carpeta_url: CARPETA })).estado, 403)
    assert.equal((await pedir('GET', '/' + crypto.randomUUID())).estado, 403)
  })
  assert.equal(llamadas, 0)
})

test('rúbricas: enlaces mal formados se rechazan sin llamar a n8n', async () => {
  let llamadas = 0
  await conServidor({ antes: sesion(['rubricas.generar']), direccion: async () => 'https://n8n.x/webhook/r', llamar: async () => { llamadas++; return respuesta({}) } }, async (pedir) => {
    for (const mal of [
      { unidades: [], carpeta_url: CARPETA }, { unidades: ['https://ejemplo.com/doc'], carpeta_url: CARPETA }, { unidades: [DOC], carpeta_url: 'https://ejemplo.com/carpeta' },
      { unidades: [DOC], carpeta_url: 'http://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt' }, { unidades: [DOC], carpeta_url: CARPETA, extra: 1 }, { unidades: Array(13).fill(DOC), carpeta_url: CARPETA }, { unidades: [DOC] }
    ]) assert.equal((await pedir('POST', '/', mal)).estado, 400, JSON.stringify(mal).slice(0, 80))
  })
  assert.equal(llamadas, 0)
})

test('rúbricas: sin dirección de n8n guardada responde 503 y /estado lo dice', async () => {
  await conServidor({ antes: sesion(['rubricas.generar']), direccion: async () => '', llamar: async () => respuesta({}) }, async (pedir) => {
    assert.equal((await pedir('GET', '/estado')).d.configurada, false)
    assert.equal((await pedir('POST', '/', { unidades: [DOC], carpeta_url: CARPETA })).estado, 503)
  })
})

test('rúbricas: genera en segundo plano, manda a n8n solo los dos datos y devuelve el enlace y los avisos', async () => {
  let enviado = null
  await conServidor({ antes: sesion(['rubricas.generar']), direccion: async () => 'https://n8n.x/webhook/r', llamar: async (url, op) => { enviado = { url, op }; return respuesta({ url: 'https://docs.google.com/spreadsheets/d/abc', log: ['Hoja de 3 créditos llena', 'Unidad 2 no tiene criterios: revisar'] }) } }, async (pedir) => {
    assert.equal((await pedir('GET', '/estado')).d.configurada, true)
    const c = await pedir('POST', '/', { unidades: [DOC, DOC2, DOC], carpeta_url: CARPETA })
    assert.equal(c.estado, 202)
    const r = await esperar(pedir, c.d.id)
    assert.equal(r.d.estado, 'listo'); assert.equal(r.d.url, 'https://docs.google.com/spreadsheets/d/abc'); assert.equal(r.d.log.length, 2); assert.equal(r.d.avisos, 1)
    assert.equal(enviado.url, 'https://n8n.x/webhook/r'); assert.equal(enviado.op.method, 'POST')
    assert.deepEqual(JSON.parse(enviado.op.body), { unidad_url: DOC + '\n' + DOC2, carpeta_url: CARPETA }) // sin repetidas, en el formato del flujo
    assert.equal((await pedir('GET', '/' + crypto.randomUUID())).estado, 404)
    assert.equal((await pedir('GET', '/no-es-id')).estado, 404)
  })
})

test('rúbricas: un error del flujo o sin conexión se cuenta claro, sin exponer detalles', async () => {
  for (const llamar of [async () => respuesta({ message: 'La carpeta no está compartida' }, 500), async () => respuesta({ log: [] }), async () => { throw new Error('ECONNREFUSED 10.0.0.5:5678') }]) {
    await conServidor({ antes: sesion(['rubricas.generar']), direccion: async () => 'https://n8n.x/webhook/r', llamar }, async (pedir) => {
      const r = await esperar(pedir, (await pedir('POST', '/', { unidades: [DOC], carpeta_url: CARPETA })).d.id)
      assert.equal(r.d.estado, 'error'); assert.ok(r.d.error); assert.ok(!/10\.0\.0\.5|ECONNREFUSED/.test(r.d.error))
    })
  }
})

test('rúbricas: una persona solo puede tener una generación en curso y nadie ve las de otra', async () => {
  let soltar
  const lenta = () => new Promise((r) => { soltar = () => r(respuesta({ url: 'https://docs.google.com/spreadsheets/d/x', log: [] })) })
  const app = express()
  app.use(express.json())
  let quien = 'a'
  const antes = [(req, res, next) => { req.usuario = { id: quien === 'a' ? '00000000-0000-0000-0000-00000000000a' : '00000000-0000-0000-0000-00000000000b', nombre: quien, permisos: new Set(['rubricas.generar']) }; next() }]
  app.use('/api/rubricas', crearRutasRubricas({ antes, direccion: async () => 'https://n8n.x/webhook/r', llamar: lenta, auditar: async () => {} }))
  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)) })
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/rubricas'
  const pedir = async (m, ruta, cuerpo) => { const r = await fetch(base + ruta, { method: m, headers: cuerpo ? { 'content-type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined }); return { estado: r.status, d: await r.json().catch(() => null) } }
  try {
    const c = await pedir('POST', '/', { unidades: [DOC], carpeta_url: CARPETA })
    assert.equal(c.estado, 202)
    assert.equal((await pedir('POST', '/', { unidades: [DOC], carpeta_url: CARPETA })).estado, 429)
    assert.equal((await pedir('GET', '/' + c.d.id)).d.estado, 'en_curso')
    quien = 'b'
    assert.equal((await pedir('GET', '/' + c.d.id)).estado, 404) // otra persona no la ve
    quien = 'a'
    soltar()
    assert.equal((await esperar(pedir, c.d.id)).d.estado, 'listo')
    assert.equal((await pedir('POST', '/', { unidades: [DOC], carpeta_url: CARPETA })).estado, 202) // ya puede pedir otra
  } finally { srv.close() }
})
