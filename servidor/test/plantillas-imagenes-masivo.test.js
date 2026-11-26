// «Plantillas con imágenes» · cambio masivo: agrupar por URL, reemplazar en varias plantillas a la vez (etiqueta, srcset, CSS y script), exclusiones, ediciones
// ajenas entre tanto, URL no válidas, todo-o-nada y rastro en historial y auditoría. Base y red simuladas (sin PostgreSQL ni internet).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { escanearImagenes } from '../src/plantillas/imagenes-html.js'
import { crearRutasImagenes } from '../src/plantillas/imagenes.js'
import { armarSubida } from '../src/plantillas/subidas.js'

const U = 'https://cdn.ejemplo.co/logo.png'
const plantilla = (extra, url = U) => '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{{TITULO}}</title><style>.h{background-image:url("' + url + '")}</style></head><body>' +
  '<img src="' + url + '" alt="Logo"><img srcset="' + url + ' 1x, https://cdn.ejemplo.co/logo@2x.png 2x" alt="Logo 2x">' + extra +
  '<script>var IMG = \'' + url + '\'; var f = document.getElementById("f"); f.src = IMG;</script><div>/*CONTENIDO*/</div></body></html>'
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

function baseFalsa({ fallaEn = null } = {}) {
  const est = {
    plantillas: new Map([
      ['d-01-v01', { crudo: plantilla('<p>D</p>'), html: null, actualizado: new Date('2026-01-01T10:00:00.000Z'), categoria: { id: 'D-01', nombre: 'Uno', tipo: 'recurso' } }],
      ['e-01-v01', { crudo: plantilla('<p>E</p>'), html: null, actualizado: new Date('2026-01-02T10:00:00.000Z'), categoria: { id: 'E-01', nombre: 'Dos', tipo: 'recurso' } }],
      ['f-01-v01', { crudo: plantilla('<p>F</p>', 'https://cdn.ejemplo.co/otra.png'), html: null, actualizado: new Date('2026-01-03T10:00:00.000Z'), categoria: null }]
    ]),
    historial: [], validaciones: new Map(), auditoria: []
  }
  const copia = () => ({ plantillas: new Map([...est.plantillas].map(([k, v]) => [k, { ...v }])), historial: est.historial.map((x) => ({ ...x })), validaciones: new Map(est.validaciones), auditoria: est.auditoria.slice() })
  const sql = async (t, v = []) => {
    if (/auditoria/.test(t)) { est.auditoria.push(v); return { rows: [] } }
    if (/AS revision/.test(t)) return { rows: [...est.plantillas].map(([nombre, p]) => ({ nombre, actualizado: p.actualizado, formacion: null, categoria: p.categoria && p.categoria.id, categoria_nombre: p.categoria && p.categoria.nombre, categoria_tipo: p.categoria && p.categoria.tipo, ejemplo: false, revision: null })) }
    if (/SELECT nombre, html_crudo FROM plantilla_subidas/.test(t)) return { rows: v[0].map((n) => ({ nombre: n, html_crudo: est.plantillas.get(n).crudo })) }
    if (/DISTINCT ON \(url\)/.test(t)) return { rows: [] }
    if (/INSERT INTO plantilla_imagenes_validacion/.test(t)) { est.validaciones.set(v[0] + '\n' + v[1], v[2]); return { rows: [] } }
    throw new Error('consulta no prevista: ' + t.slice(0, 80))
  }
  const transaccion = async (trabajo) => {
    const antes = copia()
    const c = {
      query: async (t, v = []) => {
        if (/FOR UPDATE/.test(t)) return { rows: v[0].filter((n) => est.plantillas.has(n)).map((n) => ({ nombre: n, html_crudo: est.plantillas.get(n).crudo, actualizado: est.plantillas.get(n).actualizado })) }
        if (/UPDATE plantilla_subidas/.test(t)) {
          if (v[0] === fallaEn) throw new Error('fallo simulado a la mitad')
          Object.assign(est.plantillas.get(v[0]), { crudo: v[1], html: v[2], actualizado: new Date(est.plantillas.get(v[0]).actualizado.getTime() + 1000) }); return { rows: [] }
        }
        if (/INSERT INTO plantilla_imagenes_historial/.test(t)) { est.historial.push({ plantilla: v[0], usuario: v[2], cambios: JSON.parse(v[3]) }); return { rows: [] } }
        if (/DELETE FROM plantilla_imagenes_validacion/.test(t)) return { rows: [] }
        if (/INSERT INTO plantilla_imagenes_validacion/.test(t)) { est.validaciones.set(v[0] + '\n' + v[1], v[2]); return { rows: [] } }
        throw new Error('consulta no prevista: ' + t.slice(0, 80))
      }
    }
    try { return await trabajo(c) } catch (e) { est.plantillas = antes.plantillas; est.historial = antes.historial; est.validaciones = antes.validaciones; throw e }
  }
  return { est, sql, transaccion }
}

async function conServidor(opciones, prueba) {
  const app = express()
  app.use(express.json())
  app.use('/api/plantillas-imagenes', crearRutasImagenes(opciones))
  app.use((e, req, res, next) => res.status(500).json({ error: 'Error interno' })) // como el de la app real: sin detalles
  const srv = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)) })
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/plantillas-imagenes'
  const pedir = async (m, ruta, cuerpo) => {
    const r = await fetch(base + ruta, { method: m, headers: cuerpo ? { 'content-type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
    let d = null
    try { d = await r.json() } catch { /* sin cuerpo */ }
    return { estado: r.status, d }
  }
  try { await prueba(pedir) } finally { srv.close() }
}
const sesion = (permisos) => [
  (req, res, next) => { req.usuario = { id: '00000000-0000-0000-0000-000000000001', nombre: 'Ela Editora', permisos: new Set(permisos) }; next() },
  (req, res, next) => (req.usuario.permisos.has('plantillas.imagenes') ? next() : res.status(403).json({ error: 'No tienes permiso para esto' }))
]
const bajarBien = async (u) => (u.includes('muerta') ? { estado: 404, tipo: 'text/html', datos: Buffer.from('no') } : { estado: 200, tipo: 'image/png', datos: PNG })
const opc = (b, extra = {}) => ({ antes: sesion(['plantillas.imagenes']), sql: b.sql, transaccion: b.transaccion, bajar: bajarBien, destino: async () => {}, ...extra })
const iso = (b, n) => b.est.plantillas.get(n).actualizado.toISOString()
const urlsDe = (b, n) => escanearImagenes(b.est.plantillas.get(n).crudo).map((i) => i.url)

test('masivo: sin el permiso no se entra a ninguna de las rutas nuevas', async () => {
  const b = baseFalsa()
  await conServidor(opc(b, { antes: sesion(['plantillas.ver', 'plantillas.revisar']) }), async (pedir) => {
    for (const [m, ruta, cuerpo] of [['GET', '/masivo'], ['POST', '/masivo/validar', { urls: [U] }], ['POST', '/masivo/aplicar', { reemplazos: [{ anterior: U, nueva: 'https://x.co/n.png', plantillas: [{ nombre: 'd-01-v01', actualizado: iso(b, 'd-01-v01') }] }] }]]) assert.equal((await pedir(m, ruta, cuerpo)).estado, 403, ruta)
  })
  assert.equal(b.est.plantillas.get('d-01-v01').crudo, plantilla('<p>D</p>'))
})

test('masivo: agrupa por URL con las plantillas que la usan y dónde (etiqueta, srcset, fondo, script)', async () => {
  const b = baseFalsa()
  await conServidor(opc(b), async (pedir) => {
    const d = (await pedir('GET', '/masivo')).d
    assert.deepEqual(d.plantillas.map((p) => p.nombre), ['d-01-v01', 'e-01-v01', 'f-01-v01'])
    const logo = d.urls.find((u) => u.url === U)
    assert.deepEqual(logo.plantillas.map((p) => p.nombre), ['d-01-v01', 'e-01-v01']) // la misma imagen en dos plantillas = una sola fila
    assert.deepEqual(logo.plantillas[0].lugares.sort(), ['fondo (CSS)', 'img src', 'img srcset', 'script']); assert.equal(logo.plantillas[0].veces, 4)
    assert.equal(logo.plantillas[0].categoria.id, 'D-01'); assert.equal(logo.estado, 'sin_validar')
    assert.deepEqual(d.urls.find((u) => u.url === 'https://cdn.ejemplo.co/otra.png').plantillas.map((p) => p.nombre), ['f-01-v01'])
    assert.ok(d.plantillas[0].urls.includes(U) && d.plantillas[0].actualizado) // relación en el otro sentido: plantilla → sus URL
  })
})

test('masivo: reemplaza en etiqueta, srcset, CSS y script a la vez; una plantilla excluida no cambia; queda historial y auditoría', async () => {
  const b = baseFalsa()
  await conServidor(opc(b), async (pedir) => {
    const orig = b.est.plantillas.get('e-01-v01').crudo
    const r = await pedir('POST', '/masivo/aplicar', { reemplazos: [{ anterior: U, nueva: 'https://nuevo.co/n.png?a=1&b=2', plantillas: [{ nombre: 'd-01-v01', actualizado: iso(b, 'd-01-v01') }] }] })
    assert.equal(r.estado, 200, JSON.stringify(r.d))
    assert.deepEqual(r.d.cambiadas, [{ nombre: 'd-01-v01', imagenes: 4 }]); assert.deepEqual(r.d.saltadas, [])
    const d = b.est.plantillas.get('d-01-v01')
    assert.equal(urlsDe(b, 'd-01-v01').filter((u) => u === U).length, 0)
    assert.equal(urlsDe(b, 'd-01-v01').filter((u) => u === 'https://nuevo.co/n.png?a=1&b=2').length, 4)
    assert.ok(d.crudo.includes('https://nuevo.co/n.png?a=1&amp;b=2 1x, https://cdn.ejemplo.co/logo@2x.png 2x')) // srcset con su descriptor y la otra imagen intacta
    assert.ok(d.crudo.includes("var IMG = 'https://nuevo.co/n.png?a=1&b=2';")) // en el script el & va tal cual
    assert.equal(d.html, armarSubida(d.crudo).html) // las dos versiones coherentes
    assert.equal(b.est.plantillas.get('e-01-v01').crudo, orig) // la excluida, intacta
    assert.equal(b.est.historial.length, 1); assert.equal(b.est.historial[0].plantilla, 'd-01-v01'); assert.equal(b.est.historial[0].usuario, 'Ela Editora')
    assert.equal(b.est.historial[0].cambios.length, 4); assert.equal(b.est.historial[0].cambios[0].antes, U); assert.equal(b.est.historial[0].cambios[0].masivo, true)
    assert.equal(b.est.auditoria.filter((a) => a[1] === 'plantilla_imagenes_masivo').length, 1)
  })
})

test('masivo: varias imágenes a la vez, en varias plantillas, en una sola acción', async () => {
  const b = baseFalsa()
  await conServidor(opc(b), async (pedir) => {
    const todas = (n) => ({ nombre: n, actualizado: iso(b, n) })
    const r = await pedir('POST', '/masivo/aplicar', { reemplazos: [
      { anterior: U, nueva: 'https://nuevo.co/a.png', plantillas: [todas('d-01-v01'), todas('e-01-v01')] },
      { anterior: 'https://cdn.ejemplo.co/logo@2x.png', nueva: 'https://nuevo.co/a2.png', plantillas: [todas('d-01-v01'), todas('e-01-v01')] }
    ] })
    assert.equal(r.estado, 200, JSON.stringify(r.d)); assert.equal(r.d.cambiadas.length, 2)
    for (const n of ['d-01-v01', 'e-01-v01']) { assert.ok(urlsDe(b, n).every((u) => u.startsWith('https://nuevo.co/'))); assert.equal(urlsDe(b, n).length, 5) }
    assert.equal(b.est.historial.length, 2) // una entrada por plantilla
    assert.equal(b.est.auditoria.filter((a) => a[1] === 'plantilla_imagenes_masivo').length, 1) // y una auditoría resumen
    assert.equal((await pedir('POST', '/masivo/aplicar', { reemplazos: [{ anterior: U, nueva: 'https://nuevo.co/b.png', plantillas: [todas('d-01-v01')] }, { anterior: U, nueva: 'https://nuevo.co/c.png', plantillas: [todas('d-01-v01')] }] })).estado, 400) // la misma URL dos veces
  })
})

test('masivo: la plantilla que otra persona editó mientras tanto se salta, sin pisar su cambio', async () => {
  const b = baseFalsa()
  await conServidor(opc(b), async (pedir) => {
    const viejaE = iso(b, 'e-01-v01')
    const e = b.est.plantillas.get('e-01-v01'); e.crudo = e.crudo.replace('<p>E</p>', '<p>E editada por otra persona</p>'); e.actualizado = new Date('2026-02-01T00:00:00.000Z')
    const r = await pedir('POST', '/masivo/aplicar', { reemplazos: [{ anterior: U, nueva: 'https://nuevo.co/n.png', plantillas: [{ nombre: 'd-01-v01', actualizado: iso(b, 'd-01-v01') }, { nombre: 'e-01-v01', actualizado: viejaE }] }] })
    assert.equal(r.estado, 200)
    assert.deepEqual(r.d.cambiadas.map((x) => x.nombre), ['d-01-v01']); assert.deepEqual(r.d.saltadas, [{ nombre: 'e-01-v01', motivo: 'modificada' }])
    assert.ok(e.crudo.includes('E editada por otra persona') && urlsDe(b, 'e-01-v01').includes(U))
  })
})

test('masivo: URL nueva bloqueada o que no responde no se aplica (salvo confirmación expresa); lo bloqueado nunca', async () => {
  const b = baseFalsa()
  await conServidor(opc(b), async (pedir) => {
    const cuerpo = (nueva, extra = {}) => ({ reemplazos: [{ anterior: U, nueva, plantillas: [{ nombre: 'd-01-v01', actualizado: iso(b, 'd-01-v01') }] }], ...extra })
    const orig = b.est.plantillas.get('d-01-v01').crudo
    for (const mala of ['http://127.0.0.1/a.png', 'http://localhost:3002/a.png', 'http://169.254.169.254/x', 'javascript:alert(1)', 'https://x.co/a b.png', String.raw`https://x.co/a\.png`]) {
      assert.equal((await pedir('POST', '/masivo/aplicar', cuerpo(mala, { confirmarInvalida: true }))).estado, 400, mala) // ni confirmando
    }
    const muerta = await pedir('POST', '/masivo/aplicar', cuerpo('https://nuevo.co/muerta.png'))
    assert.equal(muerta.estado, 422); assert.equal(muerta.d.requiereConfirmacion, true); assert.equal(muerta.d.invalidas[0].estado, 'no_responde')
    assert.equal(b.est.plantillas.get('d-01-v01').crudo, orig); assert.equal(b.est.historial.length, 0)
    const conf = await pedir('POST', '/masivo/aplicar', cuerpo('https://nuevo.co/muerta.png', { confirmarInvalida: true }))
    assert.equal(conf.estado, 200); assert.ok(urlsDe(b, 'd-01-v01').includes('https://nuevo.co/muerta.png'))
    // DNS: el nombre resuelve a una IP interna
    const b2 = baseFalsa()
    await conServidor(opc(b2, { destino: async () => { throw new Error('Dirección interna no permitida') } }), async (p2) => {
      assert.equal((await p2('POST', '/masivo/aplicar', { reemplazos: [{ anterior: U, nueva: 'https://trampa.co/a.png', plantillas: [{ nombre: 'd-01-v01', actualizado: iso(b2, 'd-01-v01') }] }] })).estado, 400)
    })
  })
})

test('masivo: si algo falla a la mitad no queda ningún cambio parcial (todo o nada)', async () => {
  const b = baseFalsa({ fallaEn: 'e-01-v01' })
  await conServidor(opc(b), async (pedir) => {
    const origD = b.est.plantillas.get('d-01-v01').crudo; const origE = b.est.plantillas.get('e-01-v01').crudo
    const r = await pedir('POST', '/masivo/aplicar', { reemplazos: [{ anterior: U, nueva: 'https://nuevo.co/n.png', plantillas: ['d-01-v01', 'e-01-v01'].map((n) => ({ nombre: n, actualizado: iso(b, n) })) }] })
    assert.equal(r.estado, 500)
    assert.equal(b.est.plantillas.get('d-01-v01').crudo, origD); assert.equal(b.est.plantillas.get('e-01-v01').crudo, origE)
    assert.equal(b.est.historial.length, 0); assert.equal(b.est.auditoria.filter((a) => a[1] === 'plantilla_imagenes_masivo').length, 0)
  })
})

test('masivo: validar devuelve el estado de cada URL (red simulada) y bloquea las internas', async () => {
  const b = baseFalsa()
  await conServidor(opc(b), async (pedir) => {
    const v = (await pedir('POST', '/masivo/validar', { urls: [U, 'https://nuevo.co/muerta.png', 'http://127.0.0.1/a.png'] })).d.resultados
    assert.deepEqual([v[U].estado, v['https://nuevo.co/muerta.png'].estado, v['http://127.0.0.1/a.png'].estado], ['valida', 'no_responde', 'bloqueada'])
    assert.equal(b.est.validaciones.get('d-01-v01\n' + U), 'valida') // se guarda para las plantillas que ya la usan
  })
})
