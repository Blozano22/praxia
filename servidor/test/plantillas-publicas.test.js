// Las plantillas armadas (dist/plantillas-html) se sirven sin sesión y sin x-ova, solo para leer, y la API sigue cerrada.
// No necesita base de datos: el servidor se levanta con una dirección ficticia (el pool no se conecta hasta usarlo).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

let servidor, base, dir

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-web-'))
  fs.mkdirSync(path.join(dir, 'plantillas-html'))
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>app</title>')
  fs.writeFileSync(path.join(dir, 'plantillas-html', 'lectura.html'), '<html><title>{{TITULO}}</title><script>var c=/*CONTENIDO*/;</script></html>')
  fs.writeFileSync(path.join(dir, 'plantillas-html', 'plantillas.json'), '{"total":1}')
  process.env.DATABASE_URL = 'postgres://nadie:nada@127.0.0.1:1/ninguna'
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.CARPETA_WEB = dir
  const { crearApp } = await import('../src/app.js')
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})

after(() => {
  servidor && servidor.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('las plantillas se descargan sin sesión ni cabecera x-ova, con CORS de solo lectura', async () => {
  const r = await fetch(base + '/plantillas-html/lectura.html')
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /text\/html/)
  assert.equal(r.headers.get('access-control-allow-origin'), '*')
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin')
  assert.match(await r.text(), /\{\{TITULO\}\}/)
  assert.equal((await fetch(base + '/plantillas-html/plantillas.json')).status, 200)
  assert.equal((await fetch(base + '/plantillas-html/lectura.html', { method: 'HEAD' })).status, 200)
  const pre = await fetch(base + '/plantillas-html/lectura.html', { method: 'OPTIONS' })
  assert.equal(pre.status, 204)
  assert.match(pre.headers.get('access-control-allow-methods'), /GET/)
})

test('solo se pueden leer: no se escribe, no se sale de la carpeta y la API sigue cerrada', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await fetch(base + '/plantillas-html/lectura.html', { method: m })).status, 405, m)
  assert.equal((await fetch(base + '/plantillas-html/no-existe.html')).status, 404)
  assert.notEqual((await fetch(base + '/plantillas-html/..%2f..%2fetc%2fpasswd')).status, 200)
  // la API no se abre: sin sesión no hay datos, y una escritura sin la cabecera x-ova se rechaza
  assert.equal((await fetch(base + '/api/usuarios')).status, 401)
  assert.equal((await fetch(base + '/api/usuarios', { method: 'POST' })).status, 400)
  assert.equal((await fetch(base + '/api/usuarios', { headers: { 'x-ova': '1' } })).status, 401)
  assert.equal((await fetch(base + '/api/plantillas/revisiones', { headers: { 'x-ova': '1' } })).status, 401)
  assert.equal((await fetch(base + '/api/config/n8n', { headers: { 'x-ova': '1' } })).status, 401)
})
