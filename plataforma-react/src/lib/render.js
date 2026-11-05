// Convierte un recurso (datos + tema) en un archivo HTML independiente usando las plantillas.
import baseCss from '../../../src/base.css?raw'
import tecCss from '../../../src/plataforma/tec.css?raw'
import libJs from '../../../src/lib.js?raw'
import libExtra from '../../../src/plataforma/lib-extra.js?raw'
import presentacion from '../../../src/plataforma/plantillas/presentacion.html?raw'
import flujo from '../../../src/plataforma/plantillas/flujo.html?raw'
import video from '../../../src/plataforma/plantillas/video.html?raw'
import podcast from '../../../src/plataforma/plantillas/podcast.html?raw'
import lectura from '../../../src/plataforma/plantillas/lectura.html?raw'
import acordeon from '../../../src/plataforma/plantillas/acordeon.html?raw'
import infografia from '../../../src/plataforma/plantillas/infografia.html?raw'
import infografiahex from '../../../src/plataforma/plantillas/infografia-hex.html?raw'
import infografiaradial from '../../../src/plataforma/plantillas/infografia-radial.html?raw'
import infografiapines from '../../../src/plataforma/plantillas/infografia-pines.html?raw'
import portada from '../../../src/plataforma/plantillas/portada.html?raw'
import crucigrama from '../../../src/plataforma/plantillas/crucigrama.html?raw'
import lineatiempo from '../../../src/plataforma/plantillas/lineatiempo.html?raw'
import mapa from '../../../src/plataforma/plantillas/mapa.html?raw'
import casos from '../../../src/plataforma/plantillas/casos.html?raw'
import lineatiempo2 from '../../../src/plataforma/plantillas/lineatiempo-2.html?raw'
import lineatiempo3 from '../../../src/plataforma/plantillas/lineatiempo-3.html?raw'
import crucigrama2 from '../../../src/plataforma/plantillas/crucigrama-2.html?raw'
import crucigrama3 from '../../../src/plataforma/plantillas/crucigrama-3.html?raw'
import acordeon2 from '../../../src/plataforma/plantillas/acordeon-2.html?raw'
import acordeon3 from '../../../src/plataforma/plantillas/acordeon-3.html?raw'
import { E } from './engine.js'

const css = baseCss + '\n' + tecCss
const lib = libJs + '\n' + libExtra
const arma = (t) => t.replace('/*CSS*/', () => css).replace('/*LIB*/', () => lib)

export const PLANTILLAS = {
  presentacion: arma(presentacion),
  flujo: arma(flujo),
  video: arma(video),
  podcast: arma(podcast),
  lectura: arma(lectura),
  acordeon: arma(acordeon),
  infografia: arma(infografia),
  infografiahex: arma(infografiahex),
  infografiaradial: arma(infografiaradial),
  infografiapines: arma(infografiapines),
  portada: arma(portada),
  crucigrama: arma(crucigrama),
  lineatiempo: arma(lineatiempo),
  mapa: arma(mapa),
  casos: arma(casos),
  'lineatiempo-2': arma(lineatiempo2),
  'lineatiempo-3': arma(lineatiempo3),
  'crucigrama-2': arma(crucigrama2),
  'crucigrama-3': arma(crucigrama3),
  'acordeon-2': arma(acordeon2),
  'acordeon-3': arma(acordeon3)
}
export const PLANT = { microvideo: 'video' }
export const NOMBRES = {
  presentacion: 'Presentación',
  flujo: 'Diagrama de flujo',
  video: 'Video explicativo',
  microvideo: 'Micro-video',
  podcast: 'Podcast',
  lectura: 'Lectura diagramada',
  acordeon: 'Acordeón',
  infografia: 'Infografía',
  portada: 'Portada',
  crucigrama: 'Crucigrama',
  lineatiempo: 'Línea de tiempo',
  mapa: 'Mapa conceptual',
  casos: 'Estudio de casos'
}
export const UNIDAD = { presentacion: 'diapositivas', flujo: 'nodos', video: 'escenas', microvideo: 'escenas', podcast: 'bloques', lectura: 'secciones', acordeon: 'apartados', infografia: 'bloques', portada: 'elementos', crucigrama: 'palabras', lineatiempo: 'momentos', mapa: 'ramas', casos: 'evidencias' }

// Un solo diseño para todos los recursos: paleta DIEPO fija. No cambia según la formación.
export const PRESETS = [
  { id: 'diepo', n: 'DIEPO', nav: '#142749', brand: '#00665F', accent: '#CBFF01', bg: '#FFFFFF' }
]
export function presetPorNivel() { return 'diepo' }
export const FUENTES = {
  diepo: "'Century Gothic','CenturyGothic','Apple Gothic','Futura','Avenir Next','Trebuchet MS','Segoe UI',system-ui,sans-serif"
}

export const temaBase = () => ({
  brand: '#00665F', accent: '#CBFF01', bg: '#FFFFFF', nav: '#142749', preset: 'diepo',
  fuente: 'diepo', tam: 'n', esq: 'suave', hero: 'lisa', logo: '', bloqueo: true,
  layout: { imgLado: 'izq', orientacion: 'horizontal' }
})

const rgb = (c) => {
  c = c.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16))
}
const mix = (a, b, t) => {
  const A = rgb(a), B = rgb(b)
  return '#' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, '0')).join('')
}
// Variables que usan todas las plantillas. Nombres históricos (--nav, --brand…) apuntan a la paleta DIEPO:
//  --nav azul noche #142749 · --brand verde azulado #00665F · --brand2 azul marino #22335D · --mid azul #1C45B4
//  --cyan cian #08A6CB (texto encima: #151B3B) · --lime lima #CBFF01 (solo detalles pequeños, texto encima: #142749)
export function cssTema() {
  const v = {
    '--nav': '#142749', '--ink': '#142749', '--brand': '#00665F', '--brand2': '#22335D', '--mid': '#1C45B4',
    '--cyan': '#08A6CB', '--cyan-ink': '#151B3B', '--cyan2': '#14A4C9', '--black': '#161616',
    '--tint': mix('#00665F', '#ffffff', 0.9), '--tint2': mix('#08A6CB', '#ffffff', 0.9),
    '--line': '#C8C8C8', '--line2': '#C8C8C8', '--bg': '#FFFFFF', '--muted': 'rgba(20,39,73,.72)',
    '--tit': '#142749', '--prop-bg': mix('#00665F', '#ffffff', 0.9), '--prop-ink': '#00665F', '--prop-tx': '#142749',
    '--lime': '#CBFF01', '--ins': '#CBFF01', '--accent': '#CBFF01', '--accent-light': '#CBFF01', '--accent-dark': '#CBFF01', '--accent-soft': mix('#00665F', '#ffffff', 0.92),
    '--radius': '14px', '--fs': '17px', '--font': FUENTES.diepo, '--ease': 'cubic-bezier(.22,.9,.3,1)'
  }
  return ':root{' + Object.keys(v).map((k) => k + ':' + v[k]).join(';') + '}'
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const ROTULOS = { acordeon: 'Exploración por secciones', lineatiempo: 'Secuencia progresiva', flujo: 'Ruta de decisión', mapa: 'Exploración entre conceptos', casos: 'Observación y análisis', presentacion: 'Presentación multimedia' }

export function armar(r) {
  const d = r.datos
  const i = d.info || {}
  return Object.assign({}, d, {
    id: r.id,
    tipo: r.tipo,
    unidadNum: r.unidad,
    tag: ROTULOS[r.tipo] || NOMBRES[r.tipo] || 'Recurso',
    chips: [d.duracion ? 'Duración aprox.: ' + d.duracion : ''].filter(Boolean),
    pie: '',
    actividad: r.actividadOculta ? null : d.actividad
  })
}

export function construirHtml(r, libre) {
  const clave = r.tipo === 'infografia' ? 'infografia' + ({ hex: 'hex', radial: 'radial', pines: 'pines' }[r.datos.variante] || '')
    : ['lineatiempo', 'crucigrama', 'acordeon'].includes(r.tipo) && PLANTILLAS[r.tipo + '-' + r.datos.variante] ? r.tipo + '-' + r.datos.variante
    : (PLANT[r.tipo] || r.tipo)
  const tpl = PLANTILLAS[clave] || PLANTILLAS.lectura
  const tema = Object.assign(temaBase(), r.tema || {})
  const safe = (s) => s.replace(/<\//g, '<\\/')
  return tpl
    .replace('{{TITULO}}', () => esc(r.datos.titulo || 'Recurso'))
    .replace('/*CONTENIDO*/', () => safe(JSON.stringify(armar(r))))
    .replace('/*TEMAJS*/', () => 'window.__LIBRE=' + (libre ? 'true' : 'false') + ';window.__TEMA=' + safe(JSON.stringify(tema)) + ';')
    .replace('/*TEMA*/', () => cssTema(tema))
    .replace('</head>', () => '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet"></head>')
    .replace('<header class="hero">', '<header class="hero' + (tema.hero === 'lisa' ? ' lisa' : '') + '">')
}

export const slug = (s) => E.norm(s).replace(/ /g, '-').slice(0, 50) || 'recurso'

export function descargar(r) {
  const blob = new Blob([construirHtml(r, false)], { type: 'text/html;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (r.datos.codigo || 'recurso') + '-' + slug(r.datos.titulo) + '.html'
  document.body.append(a)
  a.click()
  a.remove()
}
