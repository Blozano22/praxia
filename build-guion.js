// Genera los HTML de los recursos de UN guion (.docx) para verlos fuera de la plataforma.
// Uso: node build-guion.js "C:\ruta\Guion_U2_T1.docx" [tec|lic|esp|doc]
// Crea la carpeta ejemplos/guion-<nombre>/ con un HTML por recurso.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const R = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
const E = require('./src/plataforma/engine.js')

const ruta = process.argv[2]
if (!ruta) { console.log('Uso: node build-guion.js "ruta\\Guion.docx" [tec|lic|esp|doc]'); process.exit(1) }

// --- leer el .docx ---
function leerDocx(buf) {
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const total = buf.readUInt16LE(fin + 10)
  let off = buf.readUInt32LE(fin + 16)
  for (let i = 0; i < total; i++) {
    const nl = buf.readUInt16LE(off + 28), el = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32)
    const nombre = buf.slice(off + 46, off + 46 + nl).toString('utf8')
    const metodo = buf.readUInt16LE(off + 10), tc = buf.readUInt32LE(off + 20), lo = buf.readUInt32LE(off + 42)
    if (nombre === 'word/document.xml') {
      const nlo = buf.readUInt16LE(lo + 26), elo = buf.readUInt16LE(lo + 28)
      const datos = buf.slice(lo + 30 + nlo + elo, lo + 30 + nlo + elo + tc)
      return (metodo === 8 ? zlib.inflateRawSync(datos) : datos).toString('utf8')
    }
    off += 46 + nl + el + cl
  }
  throw new Error('El archivo no es un .docx válido.')
}

const css = R('src/base.css') + '\n' + R('src/plataforma/tec.css')
const lib = R('src/lib.js') + '\n' + R('src/plataforma/lib-extra.js')
const PRESETS = {
  tec: { nav: '#13235b', brand: '#0a6b5c', accent: '#d7ff1e', bg: '#eef2f1' },
  lic: { nav: '#0f2f9e', brand: '#1d57e0', accent: '#d7ff1e', bg: '#eef2fb' },
  esp: { nav: '#0b2a5b', brand: '#0a86b0', accent: '#d7ff1e', bg: '#eef3f6' },
  doc: { nav: '#0a1230', brand: '#1b2c66', accent: '#d7ff1e', bg: '#eef0f6' }
}
const rgb = (c) => { c = c.replace('#', ''); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) }
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, '0')).join('') }
function cssTema(id) {
  const p = PRESETS[id], b = p.brand, a = p.accent, dark = id === 'doc'
  const v = {
    '--brand': b, '--brand2': mix(b, '#000000', 0.35), '--mid': mix(b, '#ffffff', 0.12), '--tint': mix(b, '#ffffff', 0.91), '--tint2': mix(b, '#ffffff', 0.94),
    '--line': mix(b, '#ffffff', 0.84), '--line2': mix(b, '#ffffff', 0.72), '--nav': p.nav, '--tit': dark ? p.nav : b, '--prop-bg': dark ? p.nav : mix(b, '#ffffff', 0.92),
    '--prop-ink': dark ? '#ffffff' : b, '--prop-tx': dark ? 'rgba(255,255,255,.88)' : '#2b3a50', '--lime': a, '--ins': dark ? '#ffffff' : a, '--accent': a,
    '--accent-light': mix(a, '#ffffff', 0.55), '--accent-dark': mix(a, '#000000', 0.18), '--accent-soft': mix(a, '#ffffff', 0.88), '--bg': p.bg, '--radius': '12px', '--fs': '17px',
    '--font': '"Montserrat","Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif'
  }
  return ':root{' + Object.keys(v).map((k) => k + ':' + v[k]).join(';') + '}'
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const safe = (s) => s.replace(/<\//g, '<\\/')
const FUENTE = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">'
const NOMBRES = { presentacion: 'Presentación', flujo: 'Diagrama de flujo', video: 'Video explicativo', microvideo: 'Micro-video', podcast: 'Podcast', lectura: 'Lectura diagramada', acordeon: 'Acordeón', infografia: 'Infografía', portada: 'Portada', crucigrama: 'Crucigrama', lineatiempo: 'Línea de tiempo', mapa: 'Mapa conceptual', casos: 'Estudio de casos' }
const ROTULOS = { acordeon: 'Exploración por secciones', lineatiempo: 'Secuencia progresiva', flujo: 'Ruta de decisión', mapa: 'Exploración entre conceptos', casos: 'Observación y análisis', presentacion: 'Presentación multimedia' }
const PLANT = { microvideo: 'video' }
const plantillaDe = (r, d) => r.tipo === 'infografia' ? 'infografia' + ({ hex: '-hex', radial: '-radial', pines: '-pines' }[d.variante] || '') : (PLANT[r.tipo] || r.tipo)

const xml = leerDocx(fs.readFileSync(ruta))
const bloques = E.docxBlocks(xml)
const a = E.analizar(bloques)
if (!a.recursos.length) { console.log('No se encontraron recursos en el guion.' + (a.diagnostico ? ' ' + a.diagnostico : '')); process.exit(1) }
const nivel = E.norm((a.info.programa || '') + ' ' + (a.info.nivel_de_formacion || ''))
const grado = process.argv[3] || (/doctor/.test(nivel) ? 'doc' : /especializ/.test(nivel) ? 'esp' : /licenciatura|profesional|pregrado/.test(nivel) ? 'lic' : 'tec')
const nombre = path.basename(ruta, path.extname(ruta)).replace(/[^A-Za-z0-9_-]+/g, '-')
const salida = path.join(__dirname, 'ejemplos', 'guion-' + nombre)
fs.mkdirSync(salida, { recursive: true })
const unidad = (/^unidad\s*(\d+)/i.exec(a.info.titulo_tema || '') || [])[1]

console.log('Grado de color:', grado, '· Recursos:', a.recursos.length)
a.recursos.forEach((r) => {
  const d = E.datosDe(r, a.info)
  const i = d.info || {}
  const u = unidad ? Number(unidad) : undefined
  const conf = Object.assign({}, d, {
    id: 'guion-' + r.codigo, tipo: r.tipo, unidadNum: u,
    tag: ROTULOS[r.tipo] ? ROTULOS[r.tipo] + ' / Unidad ' + (u || '') : (NOMBRES[r.tipo] || 'Recurso') + (d.codigo ? ' · ' + d.codigo : ''),
    chips: [i.asignatura, d.duracion ? 'Duración aprox.: ' + d.duracion : '', d.clase ? 'Tipo: ' + d.clase : ''].filter(Boolean),
    pie: [i.programa, i.asignatura, d.codigo].filter(Boolean).join(' · ')
  })
  const clave = plantillaDe(r, d)
  const tpl = R('src/plataforma/plantillas/' + clave + '.html').replace('/*CSS*/', () => css).replace('/*LIB*/', () => lib)
  const tema = { layout: { imgLado: 'izq', orientacion: 'horizontal' }, bloqueo: true }
  const html = tpl
    .replace('{{TITULO}}', () => esc(conf.titulo || 'Recurso'))
    .replace('/*CONTENIDO*/', () => safe(JSON.stringify(conf)))
    .replace('/*TEMAJS*/', () => 'window.__LIBRE=false;window.__TEMA=' + safe(JSON.stringify(tema)) + ';')
    .replace('/*TEMA*/', () => cssTema(grado))
    .replace('</head>', () => FUENTE + '</head>')
  const f = path.join(salida, r.codigo + '-' + r.tipo + '.html')
  fs.writeFileSync(f, html)
  console.log(f + (r.avisos.length ? '\n   avisos: ' + r.avisos.join(' | ') : ''))
})
