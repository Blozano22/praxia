// «Auditor de guiones»: permiso, validación de archivos/enlaces/correo, reenvío multipart al flujo de n8n (simulado), proxy del estado y propiedad del trabajo. Sin base ni red real.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { crearRutasAuditor, urlEstado } from '../src/auditor/rutas.js'

const DOC = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit'
const WEBHOOK = 'https://n8n.x/webhook/auditor-guion'
const sesion = (permisos, id = '00000000-0000-0000-0000-000000000001') => [
  (req, res, next) => { req.usuario = { id, nombre: 'Ana', permisos: new Set(permisos) }; next() },
  (req, res, next) => (req.usuario.permisos.has('guiones.auditar') ? next() : res.status(403).json({ error: 'No tienes permiso para esto' }))
]
const pdf = (t = 'x') => new Blob([Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(t)])], { type: 'application/pdf' })
const zip = () => new Blob([Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3])], { type: 'application/octet-stream' })
const json = (cuerpo, estado = 200) => ({ ok: estado < 300, status: estado, text: async () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) })

async function conServidor(opciones, prueba) {
  const app = express()
  app.use(express.json())
  app.use('/api/auditor', crearRutasAuditor({ auditar: async () => {}, direccion: async () => WEBHOOK, ...opciones }))
  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)) })
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/auditor'
  const enviar = async (f) => { const r = await fetch(base, { method: 'POST', body: f }); return { estado: r.status, d: await r.json().catch(() => null) } }
  const leer = async (ruta) => { const r = await fetch(base + ruta); return { estado: r.status, d: await r.json().catch(() => null) } }
  try { await prueba({ enviar, leer }) } finally { srv.close() }
}

test('auditor: sin el permiso guiones.auditar no se entra a ninguna ruta', async () => {
  let llamadas = 0
  await conServidor({ antes: sesion(['rubricas.generar']), llamar: async () => { llamadas++; return json({}) } }, async ({ enviar, leer }) => {
    assert.equal((await leer('/configuracion')).estado, 403)
    const f = new FormData(); f.append('guion_url', DOC)
    assert.equal((await enviar(f)).estado, 403)
    assert.equal((await leer('/trabajo/abc')).estado, 403)
  })
  assert.equal(llamadas, 0)
})

test('auditor: sin dirección de n8n guardada responde 503 y /configuracion lo dice', async () => {
  await conServidor({ antes: sesion(['guiones.auditar']), direccion: async () => '', llamar: async () => json({}) }, async ({ enviar, leer }) => {
    assert.equal((await leer('/configuracion')).d.configurada, false)
    const f = new FormData(); f.append('guion_url', DOC)
    assert.equal((await enviar(f)).estado, 503)
  })
})

test('auditor: valida el formulario y no llama a n8n si algo está mal', async () => {
  let llamadas = 0
  await conServidor({ antes: sesion(['guiones.auditar']), llamar: async () => { llamadas++; return json({}) } }, async ({ enviar }) => {
    const casos = {
      'sin guion': (f) => f.append('nombre', 'x'),
      'archivo y enlace a la vez': (f) => { f.append('guion_file', pdf(), 'g.pdf'); f.append('guion_url', DOC) },
      'extensión no permitida': (f) => f.append('guion_file', pdf(), 'g.exe'),
      'contenido que no es pdf': (f) => f.append('guion_file', new Blob(['hola']), 'g.pdf'),
      'docx que no es zip': (f) => f.append('guion_file', new Blob(['hola']), 'g.docx'),
      'txt binario': (f) => f.append('guion_file', new Blob([Buffer.from([65, 0, 66])]), 'g.txt'),
      'enlace que no es de Google': (f) => f.append('guion_url', 'https://ejemplo.com/doc'),
      'enlace http': (f) => f.append('guion_url', DOC.replace('https', 'http')),
      'syllabus con enlace malo': (f) => { f.append('guion_url', DOC); f.append('syllabus_url', 'https://ejemplo.com/s') },
      'correo malo': (f) => { f.append('guion_url', DOC); f.append('correo', 'no-es-correo') }
    }
    for (const [nombre, armar] of Object.entries(casos)) {
      const f = new FormData(); armar(f)
      const r = await enviar(f)
      assert.equal(r.estado, 400, nombre)
      assert.equal(r.d.ok, false, nombre); assert.ok(r.d.errores.length, nombre)
    }
  })
  await conServidor({ antes: sesion(['guiones.auditar']), llamar: async () => { llamadas++; return json({}) } }, async ({ enviar }) => {
    const f = new FormData(); f.append('guion_file', new Blob([Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(15 * 1024 * 1024)])]), 'g.pdf')
    const r = await enviar(f); assert.equal(r.estado, 400); assert.match(r.d.errores[0], /15 MB/)
    const grande = new FormData(); grande.append('guion_file', new Blob([Buffer.alloc(41 * 1024 * 1024)]), 'g.txt')
    assert.equal((await enviar(grande)).estado, 413)
  })
  assert.equal(llamadas, 0)
})

test('auditor: reenvía a n8n el multipart con solo los campos llenos y devuelve el job_id', async () => {
  let recibido = null
  const llamar = async (url, op) => { recibido = { url, op, campos: [...op.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : { nombre: v.name, tam: v.size }]) }; return json({ ok: true, job_id: 'job-123' }) }
  await conServidor({ antes: sesion(['guiones.auditar']), llamar }, async ({ enviar }) => {
    const f = new FormData()
    f.append('guion_file', pdf('contenido del guion'), 'Guion U1.pdf')
    f.append('syllabus_url', DOC)
    f.append('estructura_file', zip(), 'estructura.docx')
    f.append('nombre', '  Unidad 1  ')
    f.append('correo', 'ana@americana.edu.co')
    f.append('campo_raro', 'no pasa')
    const r = await enviar(f)
    assert.equal(r.estado, 202); assert.deepEqual(r.d, { ok: true, job_id: 'job-123' })
  })
  assert.equal(recibido.url, WEBHOOK); assert.equal(recibido.op.method, 'POST')
  const claves = recibido.campos.map((c) => c[0]).sort()
  assert.deepEqual(claves, ['correo', 'estructura_file', 'guion_file', 'nombre', 'syllabus_url']) // sin syllabus_file, guion_url, estructura_url ni extras
  const c = Object.fromEntries(recibido.campos)
  assert.equal(c.guion_file.nombre, 'Guion U1.pdf'); assert.ok(c.guion_file.tam > 10)
  assert.equal(c.nombre, 'Unidad 1'); assert.equal(c.syllabus_url, DOC)
})

test('auditor: errores del flujo o falta de conexión se cuentan sin exponer detalles', async () => {
  const casos = [async () => json({ ok: false, errores: ['El guion está vacío'] }, 400), async () => json({ ok: true }), async () => json('<html>', 500), async () => { throw new Error('ECONNREFUSED 10.0.0.5:5678') }]
  for (const llamar of casos) {
    await conServidor({ antes: sesion(['guiones.auditar']), llamar }, async ({ enviar }) => {
      const f = new FormData(); f.append('guion_url', DOC)
      const r = await enviar(f)
      assert.equal(r.estado, 502); assert.equal(r.d.ok, false); assert.ok(r.d.errores.length)
      assert.ok(!/10\.0\.0\.5|ECONNREFUSED/.test(JSON.stringify(r.d)))
    })
  }
})

test('auditor: el estado se consulta en «<webhook>-estado?job=» y se sanea la respuesta', async () => {
  assert.equal(urlEstado(WEBHOOK + '?x=1', 'job-1'), 'https://n8n.x/webhook/auditor-guion-estado?job=job-1')
  const consultas = []
  let estado = { estado: 'procesando', mensaje: 'Evaluando criterio 12 de 46' }
  const llamar = async (url, op) => {
    if (op.method === 'POST') return json({ ok: true, job_id: 'job-9' })
    consultas.push(url); return json(estado)
  }
  await conServidor({ antes: sesion(['guiones.auditar']), llamar }, async ({ enviar, leer }) => {
    const f = new FormData(); f.append('guion_url', DOC)
    assert.equal((await enviar(f)).d.job_id, 'job-9')
    assert.deepEqual((await leer('/trabajo/job-9')).d, { estado: 'en_curso', mensaje: 'Evaluando criterio 12 de 46' })
    estado = { estado: 'listo', concepto: 'Aprobado con ajustes', doc_url: 'https://docs.google.com/document/d/abc', resumen: 'Cumple 40 de 46.' }
    assert.deepEqual((await leer('/trabajo/job-9')).d, { estado: 'listo', concepto: 'Aprobado con ajustes', doc_url: 'https://docs.google.com/document/d/abc', resumen: 'Cumple 40 de 46.' })
    estado = { estado: 'listo', concepto: 'x', doc_url: 'javascript:alert(1)', resumen: { cumple: 40 } }
    const l = (await leer('/trabajo/job-9')).d
    assert.equal(l.doc_url, ''); assert.deepEqual(l.resumen, { cumple: 40 }) // enlace que no es https se descarta
    estado = { estado: 'error', mensaje: 'Fallo la lectura del PDF' }
    assert.deepEqual((await leer('/trabajo/job-9')).d, { estado: 'error', mensaje: 'Fallo la lectura del PDF' })
  })
  assert.ok(consultas.length === 4 && consultas.every((u) => u === 'https://n8n.x/webhook/auditor-guion-estado?job=job-9'))
})

test('auditor: un fallo momentáneo al consultar no cancela la revisión; nadie ve las de otra persona', async () => {
  let quien = 'a', fallar = false
  const llamar = async (url, op) => { if (op.method === 'POST') return json({ ok: true, job_id: 'job-7' }); if (fallar) throw new Error('caído'); return json({ estado: 'en_curso' }) }
  const antes = [(req, res, next) => { req.usuario = { id: quien === 'a' ? '00000000-0000-0000-0000-00000000000a' : '00000000-0000-0000-0000-00000000000b', nombre: quien, permisos: new Set(['guiones.auditar']) }; next() }]
  await conServidor({ antes, llamar }, async ({ enviar, leer }) => {
    const f = new FormData(); f.append('guion_url', DOC)
    await enviar(f)
    fallar = true
    assert.equal((await leer('/trabajo/job-7')).d.estado, 'en_curso')
    quien = 'b'
    assert.equal((await leer('/trabajo/job-7')).estado, 404)
    assert.equal((await leer('/trabajo/no-existe')).estado, 404)
  })
})

test('auditor: la protección global acepta el formulario multipart solo en POST /api/auditor y con x-ova', async () => {
  const { exigirCabecera } = await import('../src/seguridad.js')
  const app = express()
  app.use('/api', exigirCabecera, (req, res) => res.json({ ok: true }))
  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)) })
  const base = 'http://127.0.0.1:' + srv.address().port + '/api'
  const form = () => { const f = new FormData(); f.append('guion_url', DOC); return f }
  try {
    assert.equal((await fetch(base + '/auditor', { method: 'POST', headers: { 'x-ova': '1' }, body: form() })).status, 200)
    assert.equal((await fetch(base + '/auditor', { method: 'POST', body: form() })).status, 400, 'sin x-ova')
    assert.equal((await fetch(base + '/usuarios', { method: 'POST', headers: { 'x-ova': '1' }, body: form() })).status, 400, 'otra ruta con multipart')
    assert.equal((await fetch(base + '/auditor', { method: 'PUT', headers: { 'x-ova': '1' }, body: form() })).status, 400, 'otro método')
  } finally { srv.close() }
})
