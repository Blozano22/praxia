// Bibliografía: lectura de fuentes, citas APA 7, base de datos con seguridad por fila y protección contra SSRF.
// Corre contra un PostgreSQL real y temporal; la red se simula (ninguna prueba sale a internet).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { esIpPrivada, validarDestino } from '../src/bibliografia/red.js'
import { citaEnTexto, listaDeReferencias, referencia } from '../src/bibliografia/apa.js'
import { extraerEntradas } from '../src/bibliografia/entrada.js'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const PUERTO_PG = 54331
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-bib-'))
const servidorPg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
const CLAVE = 'ClaveSegura123'
let servidor, base, pool, Q, conUsuario, orq, usuarios

before(async () => {
  await servidorPg.initialise()
  await servidorPg.start()
  await servidorPg.createDatabase('ova')
  const duenio = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
  await duenio.connect()
  await duenio.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
  for (const f of ['001_esquema.sql', '002_bibliografia.sql']) await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
  await duenio.end()
  process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  process.env.LIMITE_LOGIN = '1000'
  process.env.BIB_SIN_RED = '1' // las pruebas no salen a internet
  const { crearApp } = await import('../src/app.js')
  const db = await import('../src/db.js')
  const { hashClave } = await import('../src/seguridad.js')
  Q = (await import('../src/consultas.js')).Q
  orq = await import('../src/bibliografia/orquestador.js')
  pool = db.pool
  conUsuario = db.conUsuario
  usuarios = {}
  for (const [nombre, correo] of [['Ana', 'ana@u.co'], ['Beto', 'beto@u.co']]) {
    await pool.query(Q.usuarioCrear, [nombre, correo, await hashClave(CLAVE), ['docente']])
    const u = (await pool.query(Q.usuarioParaLogin, [correo])).rows[0]
    usuarios[nombre] = { id: u.id, permisos: new Set(['proyectos.crear', 'proyectos.ver_propios']) }
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

async function entrar(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  return (metodo, ruta, cuerpo) => fetch(base + '/api/bibliografia' + ruta, {
    method: metodo, headers: { cookie, 'x-ova': '1', ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}) }, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
  })
}

// PDF mínimo de 2 páginas con texto real, escrito a mano.
function pdfDePrueba(textos) {
  const obj = []
  obj[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  obj[2] = '<< /Type /Pages /Kids [' + textos.map((_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] /Count ' + textos.length + ' >>'
  obj[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  textos.forEach((t, i) => {
    const c = 'BT /F1 14 Tf 50 700 Td (' + t + ') Tj ET'
    obj[4 + i * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ' + (5 + i * 2) + ' 0 R /Resources << /Font << /F1 3 0 R >> >> >>'
    obj[5 + i * 2] = '<< /Length ' + c.length + ' >>\nstream\n' + c + '\nendstream'
  })
  let s = '%PDF-1.4\n'
  const pos = []
  for (let i = 1; i < obj.length; i++) { pos[i] = s.length; s += i + ' 0 obj\n' + obj[i] + '\nendobj\n' }
  const xref = s.length
  s += 'xref\n0 ' + obj.length + '\n0000000000 65535 f \n' + pos.slice(1).map((p) => String(p).padStart(10, '0') + ' 00000 n \n').join('')
  s += 'trailer\n<< /Size ' + obj.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF'
  return Buffer.from(s, 'latin1')
}

test('red: nunca se descargan direcciones internas, locales o con puertos raros (SSRF)', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.9', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.equal(esIpPrivada(ip), true, ip)
  assert.equal(esIpPrivada('8.8.8.8'), false)
  for (const u of ['http://localhost/x', 'http://127.0.0.1/x', 'http://[::1]/x', 'http://10.1.1.1/x', 'file:///etc/passwd', 'ftp://x.org/a', 'http://usuario:clave@ejemplo.org/', 'http://ejemplo.org:9000/x', 'http://intranet.local/x', 'no es una dirección']) {
    await assert.rejects(() => validarDestino(u), undefined, u)
  }
})

test('apa: referencia y cita en el texto de artículo, web y autor institucional (APA 7)', () => {
  const art = { tipo: 'articulo', titulo: 'Teorías criminológicas: etapas y fines', anio: '2020', publicacion: 'Revista de Criminología', volumen: '12', numero: '3', paginas: '45-67', doi: '10.1234/abc', idioma: 'es', autores: [{ apellido: 'Pérez', nombres: 'Juan Carlos' }, { apellido: 'Gómez', nombres: 'Ana' }] }
  assert.equal(referencia(art), 'Pérez, J. C. y Gómez, A. (2020). Teorías criminológicas: etapas y fines. *Revista de Criminología*, *12*(3), 45–67. https://doi.org/10.1234/abc')
  assert.equal(citaEnTexto(art), '(Pérez y Gómez, 2020)')
  assert.equal(citaEnTexto(art, '46-48'), '(Pérez y Gómez, 2020, pp. 46–48)')
  assert.equal(citaEnTexto({ ...art, autores: [...art.autores, { apellido: 'Ríos', nombres: 'Luis' }] }, 5), '(Pérez et al., 2020, p. 5)')
  const web = { tipo: 'web', titulo: 'Guía de estudio', publicacion: 'Ministerio de Educación', url: 'https://x.gov.co/g', fecha_consulta: '2026-11-05', autores: [{ apellido: 'Ministerio de Educación', institucional: true }] }
  assert.equal(referencia(web), 'Ministerio de Educación. (s. f.). *Guía de estudio*. Recuperado el 5 de noviembre de 2026, de https://x.gov.co/g')
  // mismo autor y año: 2020a y 2020b; lista en orden alfabético
  const dos = [{ id: 'b', tipo: 'libro', titulo: 'Zeta', anio: '2020', editorial: 'Norma', autores: [{ apellido: 'Ruiz', nombres: 'M' }] }, { id: 'a', tipo: 'libro', titulo: 'Alfa', anio: '2020', editorial: 'Norma', autores: [{ apellido: 'Ruiz', nombres: 'M' }] }]
  const lista = listaDeReferencias([...dos, art])
  assert.deepEqual(lista.map((x) => x.cita), ['(Pérez y Gómez, 2020)', '(Ruiz, 2020a)', '(Ruiz, 2020b)'])
})

test('entrada: separa las referencias de la sección de bibliografía del syllabus', () => {
  const syllabus = 'Programa\nEvaluación\nBibliografía básica\n- Pérez, J. (2020). Teorías. Revista X. https://doi.org/10.1234/abc\n- Ministerio. (2019). Guía. https://www.mineducacion.gov.co/guia.pdf\n\nLópez, M. (2018). Delito y sociedad. Norma.\nCronograma\nSemana 1: introducción'
  const e = extraerEntradas(syllabus)
  assert.equal(e.length, 3)
  assert.equal(e[0].doi, '10.1234/abc')
  assert.equal(e[1].url, 'https://www.mineducacion.gov.co/guia.pdf')
  assert.equal(e[2].url, '')
})

test('orquestador: página web → PDF enlazado → texto completo por página, metadatos de Crossref y cita', async () => {
  const pdf = pdfDePrueba(['Primera pagina del libro sobre criminologia', 'Segunda pagina con teorias'])
  const html = '<html lang="es"><head><title>Artículo</title><meta name="citation_title" content="Teorías criminológicas"><meta name="citation_pdf_url" content="/doc.pdf"></head><body><article><p>' + 'Texto de la página de acceso. '.repeat(40) + '</p></article></body></html>'
  const llamadas = []
  const ctx = {
    descargar: async (url) => {
      llamadas.push(url)
      if (/doc\.pdf/.test(url)) return { url, estado: 200, tipo: 'application/pdf', datos: pdf }
      return { url, estado: 200, tipo: 'text/html', datos: Buffer.from(html) }
    },
    crossref: async () => ({ tipo: 'articulo', titulo: 'Teorías criminológicas', anio: '2020', publicacion: 'Revista de Criminología', volumen: '12', numero: '3', paginas: '45-67', doi: '10.1234/abc', autores: [{ apellido: 'Pérez', nombres: 'Juan' }], pdf: '' })
  }
  const ana = usuarios.Ana
  const trabajo = await conUsuario(ana, async (cx) => {
    const t = (await cx.query(Q.bibTrabajoCrear, [ana.id, 'p1', 1])).rows[0].id
    await cx.query(Q.bibFuenteInsertar, [t, ana.id, 1, 'Pérez, J. (2020). Teorías criminológicas. Revista de Criminología. https://ejemplo.org/articulo', 'https://ejemplo.org/articulo', '10.1234/abc', 1, 'basica'])
    return t
  })
  await orq.correrTrabajo(ana, trabajo, ctx)
  const r = await conUsuario(ana, async (cx) => ({
    t: (await cx.query(Q.bibTrabajoObtener, [trabajo])).rows[0],
    f: (await cx.query(Q.bibFuentesDelTrabajo, [trabajo])).rows[0],
    docs: (await cx.query(Q.bibDocumentosDeFuente, [(await cx.query(Q.bibFuentesDelTrabajo, [trabajo])).rows[0].id])).rows
  }))
  assert.equal(r.t.estado, 'listo')
  assert.equal(r.f.estado, 'resuelta')
  assert.equal(r.f.tipo, 'articulo')
  assert.equal(r.f.fuente_datos.startsWith('crossref'), true)
  assert.equal(r.f.cita_apa, '(Pérez, 2020)')
  assert.match(r.f.referencia_apa, /^Pérez, J\. \(2020\)\. Teorías criminológicas\. \*Revista de Criminología\*, \*12\*\(3\), 45–67\. https:\/\/doi\.org\/10\.1234\/abc$/)
  const pdfDoc = r.docs.find((d) => d.formato === 'pdf')
  assert.ok(pdfDoc && r.docs.find((d) => d.formato === 'html'), 'se guardaron la página y el PDF')
  assert.equal(pdfDoc.num_paginas, 2)
  assert.equal(pdfDoc.sha256.length, 64)
  const pag = await conUsuario(ana, (cx) => cx.query(Q.bibPaginasDeDocumento, [pdfDoc.id, 1, 10]))
  assert.equal(pag.rows.length, 2)
  assert.match(pag.rows[1].texto, /Segunda pagina con teorias/)
  const busq = await conUsuario(ana, (cx) => cx.query(Q.bibBuscar, [trabajo, 'teorias']))
  assert.equal(busq.rows[0].numero, 2)
})

test('API: sin sesión 401, datos mal formados 400, y nadie ve la bibliografía de otra persona', async () => {
  assert.equal((await fetch(base + '/api/bibliografia/trabajos', { headers: { 'x-ova': '1' } })).status, 401)
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  assert.equal((await ana('POST', '/trabajos', { texto: 'x', entradas: ['abc'] })).status, 400)
  assert.equal((await ana('POST', '/trabajos', { syllabusUrl: 'https://evil.com/document/d/abc' })).status, 400)
  assert.equal((await ana('POST', '/trabajos', { texto: 'Sin bibliografía aquí' })).status, 422)
  // una referencia que apunta a una dirección interna se registra, pero nunca se descarga
  const c = await ana('POST', '/trabajos', { entradas: ['Interno, X. (2020). Intranet. http://127.0.0.1/secreto', 'López, M. (2018). Delito y sociedad. Norma.'] })
  assert.equal(c.status, 202)
  const { id } = await c.json()
  let t
  for (let i = 0; i < 40; i++) { t = await (await ana('GET', '/trabajos/' + id)).json(); if (t.estado === 'listo' || t.estado === 'error') break; await new Promise((r) => setTimeout(r, 150)) }
  assert.equal(t.estado, 'listo')
  assert.equal(t.fuentes.length, 2)
  assert.equal(t.fuentes[0].estado, 'sin_acceso')
  assert.match(t.fuentes[0].estado_detalle, /interna no permitida/i)
  assert.equal(t.fuentes[1].estado, 'parcial')
  assert.equal(t.fuentes[1].cita_apa, '(López, 2018)')
  const ref = await (await ana('GET', '/trabajos/' + id + '/referencias')).json()
  assert.equal(ref.norma, 'APA 7.ª edición')
  assert.equal(ref.referencias.length, 2)
  assert.equal((await beto('GET', '/trabajos/' + id)).status, 404)
  assert.equal((await beto('GET', '/trabajos/' + id + '/referencias')).status, 404)
  assert.deepEqual(await (await beto('GET', '/trabajos')).json(), [])
})

test('API: una persona sube el documento de una fuente, se lee por página, y nadie más puede subirlo', async () => {
  const ana = await entrar('ana@u.co')
  const beto = await entrar('beto@u.co')
  const c = await ana('POST', '/trabajos', { entradas: ['Ministerio. (2019). Ley de prueba. http://127.0.0.1/ley'] })
  const { id } = await c.json()
  let t
  for (let i = 0; i < 40; i++) { t = await (await ana('GET', '/trabajos/' + id)).json(); if (t.estado === 'listo') break; await new Promise((r) => setTimeout(r, 150)) }
  const fuente = t.fuentes[0]
  assert.equal(fuente.estado, 'sin_acceso')
  const subir = (cliente, cuerpo, nombre) => fetch(base + '/api/bibliografia/fuentes/' + fuente.id + '/archivo', { method: 'POST', headers: { cookie: cliente.cookie, 'x-ova': '1', 'x-nombre': encodeURIComponent(nombre), 'content-type': 'application/octet-stream' }, body: cuerpo })
  const anaC = await entrarCookie('ana@u.co'), betoC = await entrarCookie('beto@u.co')
  const pdf = pdfDePrueba(['Articulo primero de la ley', 'Articulo segundo de la ley'])
  const rb = await subir(betoC, pdf, 'ley.pdf'); assert.equal(rb.status, 404, await rb.text())
  assert.equal((await subir(anaC, Buffer.from('no es un documento'), 'x.txt')).status, 415)
  const ok = await subir(anaC, pdf, 'Ley 1801 de 2016.pdf')
  assert.equal(ok.status, 200)
  const j = await ok.json()
  assert.equal(j.paginas, 2)
  const t2 = await (await ana('GET', '/trabajos/' + id)).json()
  assert.equal(t2.fuentes[0].estado, 'resuelta')
  const doc = t2.fuentes[0].documentos.find((d) => d.formato === 'pdf')
  const pag = await (await ana('GET', '/documentos/' + doc.id + '/paginas?desde=2&hasta=2')).json()
  assert.match(pag[0].texto, /Articulo segundo/)
  void beto
})

async function entrarCookie(correo) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ova': '1' }, body: JSON.stringify({ correo, clave: CLAVE }) })
  return { cookie: (r.headers.get('set-cookie') || '').split(';')[0] }
}
