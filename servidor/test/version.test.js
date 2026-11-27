// GET /api/version y cabeceras de caché del front. No necesita base de datos.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const web = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-web-'))
let servidor, base

before(async () => {
  fs.mkdirSync(path.join(web, 'assets'))
  fs.writeFileSync(path.join(web, 'index.html'), '<html></html>')
  fs.writeFileSync(path.join(web, 'assets', 'app-AbCd1234.js'), '1')
  fs.writeFileSync(path.join(web, 'version.json'), JSON.stringify({ version: 'v1' }))
  process.env.CARPETA_WEB = web
  process.env.DATABASE_URL = 'postgres://x:x@127.0.0.1:1/x'
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  const { crearApp } = await import('../src/app.js')
  servidor = crearApp().listen(0)
  base = 'http://127.0.0.1:' + servidor.address().port
})
after(() => { servidor && servidor.close(); fs.rmSync(web, { recursive: true, force: true }) })

test('/api/version responde sin sesión, sin caché, y cambia al cambiar el build', async () => {
  let r = await fetch(base + '/api/version')
  assert.equal(r.status, 200)
  assert.match(r.headers.get('cache-control'), /no-store/)
  assert.equal((await r.json()).version, 'v1')
  fs.writeFileSync(path.join(web, 'version.json'), JSON.stringify({ version: 'v2' }))
  r = await fetch(base + '/api/version')
  assert.equal((await r.json()).version, 'v2')
})

test('index.html se revalida siempre y los assets con hash se guardan', async () => {
  assert.equal((await fetch(base + '/')).headers.get('cache-control'), 'no-cache')
  assert.equal((await fetch(base + '/index.html')).headers.get('cache-control'), 'no-cache')
  assert.match((await fetch(base + '/assets/app-AbCd1234.js')).headers.get('cache-control'), /immutable/)
})
