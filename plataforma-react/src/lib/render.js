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
import { aplicarTema, cssTema, esc, FUENTE_DIEPO, incrustar, temaBase } from './armado.js'

// El tema, la paleta y los reemplazos viven en armado.js (también los usa el build de las plantillas públicas).
export { cssTema, temaBase }

const css = baseCss + '\n' + tecCss
const lib = libJs + '\n' + libExtra
const arma = (t) => incrustar(t, css, lib)

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
  diepo: FUENTE_DIEPO
}

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
  return aplicarTema(tpl, tema, libre)
    .replace('{{TITULO}}', () => esc(r.datos.titulo || 'Recurso'))
    .replace('/*CONTENIDO*/', () => safe(JSON.stringify(armar(r))))
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
