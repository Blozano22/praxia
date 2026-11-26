// «Auditor de guiones»: permiso, validación de enlaces/correo, reenvío multipart al flujo de n8n (simulado), proxy del estado y propiedad del trabajo. Sin base ni red real.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { crearRutasAuditor, urlEstado } from '../src/auditor/rutas.js'

const CARPETA = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt'
const DOC = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit'
const WEBHOOK = 'https://n8n.x/webhook/auditor-guion'
const sesion = (permisos, id = '00000000-0000-0000-0000-000000000001') => [
  (req, res, next) => { req.usuario = { id, nombre: 'Ana', permisos: new Set(permisos) }; next() },
  (req, res, next) => (req.usuario.permisos.has('guiones.auditar') ? next() : res.status(403).json({ error: 'No tienes permiso para esto' }))
]
const json = (cuerpo, estado = 200) => ({ ok: estado < 300, status: estado, text: async () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) })

async function conServidor(opciones, prueba) {
  const app = express()
  app.use(express.json())
  app.use('/api/auditor', crearRutasAuditor({ auditar: async () => {}, direccion: async () => WEBHOOK, ...opciones }))
  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)) })
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/auditor'
  const enviar = async (cuerpo) => { const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }); return { estado: r.status, d: await r.json().catch(() => null) } }
  const leer = async (ruta) => { const r = await fetch(base + ruta); return { estado: r.status, d: await r.json().catch(() => null) } }
  try { await prueba({ enviar, leer }) } finally { srv.close() }
}

test('auditor: sin el permiso guiones.auditar no se entra a ninguna ruta', async () => {
  let llamadas = 0
  await conServidor({ antes: sesion(['rubricas.generar']), llamar: async () => { llamadas++; return json({}) } }, async ({ enviar, leer }) => {
    assert.equal((await leer('/configuracion')).estado, 403)
    assert.equal((await enviar({ carpeta_url: CARPETA })).estado, 403)
    assert.equal((await leer('/trabajo/abc')).estado, 403)
  })
  assert.equal(llamadas, 0)
})

test('auditor: sin dirección de n8n guardada responde 503 y /configuracion lo dice', async () => {
  await conServidor({ antes: sesion(['guiones.auditar']), direccion: async () => '', llamar: async () => json({}) }, async ({ enviar, leer }) => {
    assert.equal((await leer('/configuracion')).d.configurada, false)
    assert.equal((await enviar({ carpeta_url: CARPETA })).estado, 503)
  })
})

test('auditor: valida la carpeta, los enlaces y el correo, y no llama a n8n si algo está mal', async () => {
  let llamadas = 0
  await conServidor({ antes: sesion(['guiones.auditar']), llamar: async () => { llamadas++; return json({}) } }, async ({ enviar }) => {
    const malos = {
      'sin carpeta': {},
      'carpeta vacía': { carpeta_url: '  ' },
      'carpeta que es un Doc': { carpeta_url: DOC },
      'carpeta de otro sitio': { carpeta_url: 'https://ejemplo.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt' },
      'carpeta http': { carpeta_url: CARPETA.replace('https', 'http') },
      'carpeta no es texto': { carpeta_url: ['x'] },
      'syllabus malo': { carpeta_url: CARPETA, syllabus_url: 'https://ejemplo.com/s' },
      'estructura mala': { carpeta_url: CARPETA, estructura_url: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt' },
      'correo malo': { carpeta_url: CARPETA, correo: 'no-es-correo' }
    }
    for (const [nombre, cuerpo] of Object.entries(malos)) {
      const r = await enviar(cuerpo)
      assert.equal(r.estado, 400, nombre); assert.equal(r.d.ok, false, nombre); assert.ok(r.d.errores.length, nombre)
    }
  })
  assert.equal(llamadas, 0)
})

test('auditor: acepta las variantes del enlace de carpeta de Drive', async () => {
  const llamar = async () => json({ ok: true, job_id: 'j' })
  await conServidor({ antes: sesion(['guiones.auditar']), llamar }, async ({ enviar }) => {
    for (const c of [CARPETA, CARPETA + '?usp=sharing', 'https://drive.google.com/drive/u/2/folders/1AbCdEfGhIjKlMnOpQrSt']) assert.equal((await enviar({ carpeta_url: c })).estado, 202, c)
  })
})

test('auditor: reenvía a n8n el multipart con los 4 campos y devuelve el job_id', async () => {
  let recibido = null
  const llamar = async (url, op) => { recibido = { url, op, campos: Object.fromEntries(op.body.entries()) }; return json({ ok: true, job_id: 'job-123' }) }
  await conServidor({ antes: sesion(['guiones.auditar']), llamar }, async ({ enviar }) => {
    const r = await enviar({ carpeta_url: ' ' + CARPETA + ' ', syllabus_url: DOC, correo: 'ana@americana.edu.co', extra: 'no pasa' })
    assert.equal(r.estado, 202); assert.deepEqual(r.d, { ok: true, job_id: 'job-123' })
  })
  assert.equal(recibido.url, WEBHOOK); assert.equal(recibido.op.method, 'POST')
  assert.ok(recibido.op.body instanceof FormData)
  assert.deepEqual(recibido.campos, { carpeta_url: CARPETA, syllabus_url: DOC, estructura_url: '', correo: 'ana@americana.edu.co' })
})

test('auditor: errores del flujo o falta de conexión se cuentan sin exponer detalles', async () => {
  const casos = [async () => json({ ok: false, errores: ['La carpeta está vacía'] }, 400), async () => json({ ok: true }), async () => json('<html>', 500), async () => { throw new Error('ECONNREFUSED 10.0.0.5:5678') }]
  for (const llamar of casos) {
    await conServidor({ antes: sesion(['guiones.auditar']), llamar }, async ({ enviar }) => {
      const r = await enviar({ carpeta_url: CARPETA })
      assert.equal(r.estado, 502); assert.equal(r.d.ok, false); assert.ok(r.d.errores.length)
      assert.ok(!/10\.0\.0\.5|ECONNREFUSED/.test(JSON.stringify(r.d)))
    })
  }
})

test('auditor: el estado se consulta en «<webhook>-estado?job=» y se sanea la respuesta', async () => {
  assert.equal(urlEstado(WEBHOOK + '?x=1', 'job-1'), 'https://n8n.x/webhook/auditor-guion-estado?job=job-1')
  const consultas = []
  let estado = { estado: 'procesando', mensaje: 'Evaluando guion 2 de 5' }
  const llamar = async (url, op) => {
    if (op.method === 'POST') return json({ ok: true, job_id: 'job-9' })
    consultas.push(url); return json(estado)
  }
  await conServidor({ antes: sesion(['guiones.auditar']), llamar }, async ({ enviar, leer }) => {
    assert.equal((await enviar({ carpeta_url: CARPETA })).d.job_id, 'job-9')
    assert.deepEqual((await leer('/trabajo/job-9')).d, { estado: 'en_curso', mensaje: 'Evaluando guion 2 de 5' })
    estado = { estado: 'listo', concepto: '5 guiones evaluados', doc_url: 'https://drive.google.com/drive/folders/abc', resumen: 'G1: https://docs.google.com/document/d/x' }
    assert.deepEqual((await leer('/trabajo/job-9')).d, { estado: 'listo', concepto: '5 guiones evaluados', doc_url: 'https://drive.google.com/drive/folders/abc', resumen: 'G1: https://docs.google.com/document/d/x' })
    estado = { estado: 'listo', concepto: 'x', doc_url: 'javascript:alert(1)', resumen: '' }
    assert.equal((await leer('/trabajo/job-9')).d.doc_url, '') // enlace que no es https se descarta
    estado = { estado: 'error', mensaje: 'Falló la lectura' }
    assert.deepEqual((await leer('/trabajo/job-9')).d, { estado: 'error', mensaje: 'Falló la lectura' })
  })
  assert.ok(consultas.length === 4 && consultas.every((u) => u === 'https://n8n.x/webhook/auditor-guion-estado?job=job-9'))
})

test('auditor: un fallo momentáneo al consultar no cancela la evaluación; nadie ve las de otra persona', async () => {
  let quien = 'a', fallar = false
  const llamar = async (url, op) => { if (op.method === 'POST') return json({ ok: true, job_id: 'job-7' }); if (fallar) throw new Error('caído'); return json({ estado: 'en_curso' }) }
  const antes = [(req, res, next) => { req.usuario = { id: quien === 'a' ? '00000000-0000-0000-0000-00000000000a' : '00000000-0000-0000-0000-00000000000b', nombre: quien, permisos: new Set(['guiones.auditar']) }; next() }]
  await conServidor({ antes, llamar }, async ({ enviar, leer }) => {
    await enviar({ carpeta_url: CARPETA })
    fallar = true
    assert.equal((await leer('/trabajo/job-7')).d.estado, 'en_curso')
    quien = 'b'
    assert.equal((await leer('/trabajo/job-7')).estado, 404)
    assert.equal((await leer('/trabajo/no-existe')).estado, 404)
  })
})
