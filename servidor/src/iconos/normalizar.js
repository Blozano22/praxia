// Normalizador de SVG del banco de íconos. Recibe el SVG que sube una persona y devuelve uno limpio y seguro, o el motivo (en español) por el que se rechaza.
//
// Reglas (ver ESTRUCTURA-ICONOS-Y-VARIANTES.md):
//  · un solo <svg> con viewBox cuadrado; sin width/height propios; sin texto;
//  · solo formas y degradados: nada de script, image, use, foreignObject, style, class, on*, ni referencias externas;
//  · sin colores fijos: el color principal es currentColor y el secundario var(--ico-2, currentColor). El relieve se hace con capas blancas o negras
//    SEMITRANSPARENTES o con degradados de currentColor;
//  · los id (degradados, recortes) se reescriben con el id del ícono como prefijo para que no choquen al ir varios íconos en la misma página.
//
// SEGURIDAD: el SVG normalizado se pinta tal cual dentro de la página (y viaja a los H5P), así que NADA que no se haya validado llega a la salida:
//  · elementos y atributos por LISTA BLANCA; cada atributo tiene además la forma de su valor (números, palabras fijas, color, url(#id)…), de modo que ningún valor puede cerrar
//    una comilla ni traer otro atributo;
//  · se escribe con comillas dobles y se escapan por si acaso.
// RENDIMIENTO: Praxia es un solo proceso. El análisis es LINEAL (sin expresiones regulares con retroceso sobre el texto completo) y rechaza lo que no entiende al primer fallo,
// para que un archivo hostil no pueda bloquear el servidor.
import crypto from 'node:crypto'

export const MAX_SVG = 50 * 1024
const MAX_ELEMENTOS = 2000
const MAX_PROFUNDIDAD = 40

// Elementos permitidos (en minúsculas) y cómo se escriben al salir.
const ELEMENTOS = { svg: 'svg', g: 'g', path: 'path', circle: 'circle', ellipse: 'ellipse', rect: 'rect', line: 'line', polyline: 'polyline', polygon: 'polygon',
  defs: 'defs', lineargradient: 'linearGradient', radialgradient: 'radialGradient', stop: 'stop', clippath: 'clipPath', mask: 'mask' }
const FORMAS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])
// Se quitan en silencio, con su contenido (no cambian el dibujo).
const IGNORABLES = new Set(['title', 'desc', 'metadata'])
// Se rechazan con motivo.
const PROHIBIDOS = new Set(['script', 'image', 'use', 'foreignobject', 'style', 'iframe', 'a', 'text', 'tspan', 'textpath', 'switch', 'animate', 'set', 'animatetransform', 'animatemotion', 'filter', 'pattern', 'symbol', 'marker', 'link', 'embed', 'object', 'audio', 'video', 'math', 'img', 'body', 'html', 'meta'])
// Atributos permitidos (minúsculas → como se escriben). Los demás se descartan, salvo los peligrosos, que rechazan el ícono.
const ATRIBUTOS = Object.fromEntries(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'transform', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'fx', 'fy', 'spreadMethod', 'clip-path', 'mask', 'id', 'maskUnits', 'maskContentUnits', 'clipPathUnits', 'viewBox']
  .map((a) => [a.toLowerCase(), a]))
// Forma que debe tener el valor de cada atributo (todo lo que no sea color, id o referencia).
const NUMERO = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?%?\s*$/i
const LISTA_NUMEROS = /^(?:none|[-+0-9.eE%\s,]*)$/
const PALABRAS = (...p) => new RegExp('^(?:' + p.join('|') + ')$')
const FORMA_VALOR = {}
for (const k of ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'fx', 'fy', 'offset', 'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity']) FORMA_VALOR[k] = NUMERO
FORMA_VALOR.points = LISTA_NUMEROS
FORMA_VALOR['stroke-dasharray'] = LISTA_NUMEROS
FORMA_VALOR.d = /^[\sMmLlHhVvCcSsQqTtAaZz0-9eE.,+-]*$/
FORMA_VALOR.transform = /^[\sA-Za-z0-9.,()+-]*$/
FORMA_VALOR.gradienttransform = FORMA_VALOR.transform
FORMA_VALOR['fill-rule'] = PALABRAS('nonzero', 'evenodd')
FORMA_VALOR['clip-rule'] = FORMA_VALOR['fill-rule']
FORMA_VALOR['stroke-linecap'] = PALABRAS('butt', 'round', 'square')
FORMA_VALOR['stroke-linejoin'] = PALABRAS('miter', 'round', 'bevel', 'arcs', 'miter-clip')
for (const k of ['gradientunits', 'maskunits', 'maskcontentunits', 'clippathunits']) FORMA_VALOR[k] = PALABRAS('userSpaceOnUse', 'objectBoundingBox')
FORMA_VALOR.spreadmethod = PALABRAS('pad', 'reflect', 'repeat')
const COLORES_NEGRO = new Set(['#000', '#000000', 'black'])
const COLORES_BLANCO = new Set(['#fff', '#ffffff', 'white'])
const RE_URL_LOCAL = /^url\(\s*#([A-Za-z][\w.-]*)\s*\)$/
const RE_ID = /^[A-Za-z][\w.-]*$/

const fallo = (error) => ({ ok: false, error })
const esEspacio = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f'
const esLetra = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
const esNombre = (c) => esLetra(c) || (c >= '0' && c <= '9') || c === '_' || c === ':' || c === '.' || c === '-'

function numeroOpacidad(v) { if (v === undefined) return 1; const n = Number(String(v).replace('%', '')) / (String(v).includes('%') ? 100 : 1); return Number.isFinite(n) ? n : 1 }

// Valida el valor de un atributo de color (fill, stroke, stop-color). Devuelve el valor normalizado o lanza un Error con el motivo.
function color(nombre, valor, el) {
  const v = valor.trim()
  const m = v.toLowerCase()
  if (m === 'none') return 'none'
  if (m === 'currentcolor') return 'currentColor'
  if (/^var\(\s*--ico-2\s*(?:,\s*currentcolor\s*)?\)$/i.test(v)) return 'var(--ico-2, currentColor)'
  if (RE_URL_LOCAL.test(v)) return v.replace(/\s+/g, '')
  const opaco = nombre === 'fill' ? 'fill-opacity' : nombre === 'stroke' ? 'stroke-opacity' : 'stop-opacity'
  if (COLORES_NEGRO.has(m) || COLORES_BLANCO.has(m)) {
    if (numeroOpacidad(el[opaco]) < 1 || numeroOpacidad(el.opacity) < 1) return COLORES_NEGRO.has(m) ? '#000' : '#fff'
    throw new Error('hay un ' + nombre + ' ' + (COLORES_NEGRO.has(m) ? 'negro' : 'blanco') + ' sin transparencia: el blanco y el negro solo se admiten como capas semitransparentes de relieve (con ' + opaco + ' u opacity menor que 1)')
  }
  throw new Error('color fijo no permitido en ' + nombre + ': «' + v.slice(0, 40).replace(/["'<>&]/g, '?') + '». Use currentColor (o var(--ico-2, currentColor) para el segundo tono)')
}

// Quita «abre … cierra» (comentarios, instrucciones <?…?>) en una sola pasada. null si alguno no se cierra.
function quitar(t, abre, cierra) {
  let salida = ''
  let i = 0
  for (;;) {
    const a = t.indexOf(abre, i)
    if (a < 0) return salida + t.slice(i)
    const b = t.indexOf(cierra, a + abre.length)
    if (b < 0) return null
    salida += t.slice(i, a) + ' '
    i = b + cierra.length
  }
}

// Lee una etiqueta que empieza en t[i] === '<'. Devuelve { fin, cierra, nombre, atr, autocierra } o null si está mal formada. Recorre una sola vez (lineal).
function leerEtiqueta(t, i) {
  const n = t.length
  let j = i + 1
  const cierra = t[j] === '/'
  if (cierra) j++
  const k0 = j
  if (j >= n || !esLetra(t[j])) return null
  while (j < n && esNombre(t[j])) j++
  const nombre = t.slice(k0, j)
  const a0 = j
  let q = null
  for (; j < n; j++) {
    const c = t[j]
    if (q) { if (c === q) q = null } else if (c === '"' || c === "'") q = c
    else if (c === '>') break
    else if (c === '<') return null
  }
  if (j >= n || q) return null
  let atr = t.slice(a0, j)
  let autocierra = false
  if (!cierra) { const f = atr.trimEnd(); if (f.endsWith('/')) { autocierra = true; atr = f.slice(0, -1) } }
  return { fin: j + 1, cierra, nombre, atr, autocierra }
}

// Lee los atributos «nombre="valor"» (o con comillas simples) de una etiqueta. null si algo no cuadra. Lineal.
function leerAtributos(s) {
  const n = s.length
  const salida = []
  let i = 0
  while (i < n) {
    while (i < n && esEspacio(s[i])) i++
    if (i >= n) break
    const a0 = i
    while (i < n && esNombre(s[i])) i++
    const nombre = s.slice(a0, i)
    if (!nombre) return null
    while (i < n && esEspacio(s[i])) i++
    if (s[i] !== '=') return null
    i++
    while (i < n && esEspacio(s[i])) i++
    const q = s[i]
    if (q !== '"' && q !== "'") return null
    const f = s.indexOf(q, i + 1)
    if (f < 0) return null
    salida.push([nombre, s.slice(i + 1, f)])
    i = f + 1
  }
  return salida
}

// Convierte el árbol en texto; con «prefijo» se reescriben los id (y sus referencias). Los valores ya están validados; igual se escapan.
function serializar(arbol, prefijo) {
  const nuevo = (id) => (prefijo === null ? id : (id.startsWith(prefijo + '-') ? id : prefijo + '-' + id))
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const salida = []
  const emitir = (n) => {
    const attrs = Object.entries(n.attrs).map(([k, v]) => {
      let valor = v
      if (k === 'id') valor = nuevo(v)
      else if (/url\(#/.test(v)) valor = v.replace(/url\(#([^)]+)\)/g, (_, id) => 'url(#' + nuevo(id) + ')')
      return ' ' + k + '="' + esc(valor) + '"'
    }).join('')
    if (!n.hijos.length) { salida.push('<' + n.nombre + attrs + '/>'); return }
    salida.push('<' + n.nombre + attrs + '>')
    n.hijos.forEach(emitir)
    salida.push('</' + n.nombre + '>')
  }
  emitir(arbol)
  return salida.join('')
}

// → { ok: true, svg, viewBox, hash } | { ok: false, error }
export function normalizarSvg(crudo, idIcono) {
  if (typeof crudo !== 'string' || !crudo.trim()) return fallo('el SVG está vacío')
  if (Buffer.byteLength(crudo, 'utf8') > MAX_SVG) return fallo('el SVG pesa más de ' + Math.round(MAX_SVG / 1024) + ' KB')
  try {
    let t = crudo.replace(/^﻿/, '')
    t = quitar(t, '<!--', '-->')
    if (t === null) return fallo('hay un comentario sin cerrar')
    t = quitar(t, '<?', '?>')
    if (t === null) return fallo('hay una instrucción <? sin cerrar')
    if (t.includes('<!')) return fallo('el SVG trae declaraciones (DOCTYPE, ENTITY o CDATA) que no se permiten')
    t = t.trim()
    if (!t.includes('<')) return fallo('el archivo no es un SVG (no se encontró ningún elemento <svg>)')
    const minusculas = t.toLowerCase()
    const raiz = []
    const pila = []
    let cuenta = 0
    let pos = 0
    for (;;) {
      const lt = t.indexOf('<', pos)
      const entre = t.slice(pos, lt < 0 ? t.length : lt)
      if (entre.trim()) return fallo('hay texto suelto dentro del SVG («' + entre.trim().slice(0, 30).replace(/["'<>&]/g, '?') + '»): los íconos no llevan texto')
      if (lt < 0) break
      const e = leerEtiqueta(t, lt)
      if (!e) return fallo('el SVG tiene una etiqueta mal formada cerca de «' + t.slice(lt, lt + 24).replace(/["'<>&\n]/g, '?') + '»')
      pos = e.fin
      const bajo = e.nombre.toLowerCase()
      if (IGNORABLES.has(bajo)) {                               // <title>, <desc>, <metadata>: se saltan con su contenido
        if (e.cierra) return fallo('las etiquetas del SVG no están bien cerradas (</' + e.nombre + '>)')
        if (!e.autocierra) {
          const c = minusculas.indexOf('</' + bajo, e.fin)
          const f = c < 0 ? -1 : t.indexOf('>', c)
          if (f < 0) return fallo('la etiqueta <' + e.nombre + '> no está cerrada')
          pos = f + 1
        }
        continue
      }
      if (e.cierra) {
        const abierto = pila.pop()
        if (!abierto || abierto.bajo !== bajo) return fallo('las etiquetas del SVG no están bien cerradas (</' + e.nombre + '>)')
        continue
      }
      if (PROHIBIDOS.has(bajo)) return fallo('el SVG trae un elemento no permitido: <' + e.nombre + '>')
      if (!ELEMENTOS[bajo]) return fallo('el SVG trae un elemento que no se admite: <' + e.nombre + '>')
      if (++cuenta > MAX_ELEMENTOS) return fallo('el SVG tiene demasiados elementos (máximo ' + MAX_ELEMENTOS + ')')
      if (pila.length >= MAX_PROFUNDIDAD) return fallo('el SVG tiene demasiados niveles anidados (máximo ' + MAX_PROFUNDIDAD + ')')
      const lista = leerAtributos(e.atr)
      if (lista === null) return fallo('el SVG tiene un atributo mal formado en <' + e.nombre + '>')
      const attrs = {}
      for (const [k, v] of lista) {
        const kb = k.toLowerCase()
        if (kb.startsWith('on')) return fallo('el SVG trae un atributo de evento (' + k + ')')
        if (kb === 'style' || kb === 'class') return fallo('el SVG trae un atributo «' + k + '» que no se permite (use atributos de presentación: fill, stroke…)')
        if (kb === 'href' || kb.endsWith(':href')) return fallo('el SVG trae una referencia externa (' + k + ')')
        if (!ATRIBUTOS[kb]) continue                            // atributo desconocido: se descarta
        if (/javascript:|data:|expression\(|[<>"'`&]/i.test(v) && kb !== 'fill' && kb !== 'stroke' && kb !== 'stop-color') return fallo('el valor de «' + k + '» trae caracteres que no se permiten')
        attrs[ATRIBUTOS[kb]] = v
      }
      // el SVG raíz: viewBox obligatorio y sin tamaño propio
      if (bajo === 'svg') {
        if (pila.length) return fallo('el SVG trae otro <svg> anidado')
        if (raiz.length) return fallo('el archivo trae más de un elemento <svg> en la raíz')
        if (!attrs.viewBox) return fallo('el SVG no tiene viewBox')
        delete attrs.width; delete attrs.height; delete attrs.x; delete attrs.y
      }
      // valores: cada atributo con la forma que le corresponde
      const minusc = {}
      for (const [k, v] of Object.entries(attrs)) minusc[k.toLowerCase()] = v
      for (const [k, v] of Object.entries(attrs)) {
        const forma = FORMA_VALOR[k.toLowerCase()]
        if (forma && !forma.test(v.trim().length === v.length ? v : (k.toLowerCase() === 'd' || k.toLowerCase() === 'transform' ? v : v.trim()))) return fallo('el valor de «' + k + '» no es válido (' + v.slice(0, 30).replace(/["'<>&]/g, '?') + ')')
      }
      for (const k of ['fill', 'stroke', 'stop-color']) if (attrs[k] !== undefined) attrs[k] = color(k, attrs[k], minusc)
      for (const k of ['clip-path', 'mask']) if (attrs[k] !== undefined && attrs[k] !== 'none' && !RE_URL_LOCAL.test(attrs[k].trim())) return fallo('«' + k + '» solo puede apuntar a un elemento del mismo SVG (url(#id))')
      if (attrs.id !== undefined && !RE_ID.test(attrs.id)) return fallo('un id del SVG no es válido (' + attrs.id.slice(0, 30).replace(/["'<>&]/g, '?') + ')')
      const nodo = { nombre: ELEMENTOS[bajo], bajo, attrs, hijos: [] }
      if (pila.length) pila[pila.length - 1].hijos.push(nodo); else raiz.push(nodo)
      if (!e.autocierra) pila.push(nodo)
    }
    if (pila.length) return fallo('el SVG tiene etiquetas sin cerrar (<' + pila[pila.length - 1].nombre + '>)')
    if (!raiz.length) return fallo('el archivo no es un SVG (no se encontró ningún elemento <svg>)')
    if (raiz.length !== 1 || raiz[0].bajo !== 'svg') return fallo('el archivo debe ser un único elemento <svg>')
    const svg = raiz[0]
    // viewBox cuadrado
    const caja = svg.attrs.viewBox.trim().split(/[\s,]+/).map(Number)
    if (caja.length !== 4 || caja.some((n) => !Number.isFinite(n)) || caja[2] <= 0 || caja[3] <= 0) return fallo('el viewBox no es válido')
    const prop = caja[2] / caja[3]
    if (prop < 0.8 || prop > 1.25) return fallo('el viewBox debe ser cuadrado (el actual es ' + caja[2] + '×' + caja[3] + ')')
    // formas y referencias
    let formas = 0
    const ids = new Map()
    const refs = []
    const recorrer = (n) => {
      if (FORMAS.has(n.bajo)) formas++
      if (n.attrs.id !== undefined) { if (ids.has(n.attrs.id)) throw new Error('el id «' + n.attrs.id + '» está repetido'); ids.set(n.attrs.id, true) }
      for (const v of Object.values(n.attrs)) for (const r of String(v).matchAll(/url\(#([^)]+)\)/g)) refs.push(r[1].trim())
      n.hijos.forEach(recorrer)
    }
    recorrer(svg)
    if (!formas) return fallo('el SVG no tiene formas dibujadas')
    for (const r of refs) if (!ids.has(r)) return fallo('el SVG apunta a un elemento que no existe (url(#' + r + '))')
    // salida: raíz con xmlns, viewBox normalizado y relleno por defecto currentColor
    svg.attrs = { xmlns: 'http://www.w3.org/2000/svg', viewBox: caja.join(' '), preserveAspectRatio: 'xMidYMid meet', fill: svg.attrs.fill !== undefined ? svg.attrs.fill : 'currentColor',
      ...(svg.attrs.stroke !== undefined ? { stroke: svg.attrs.stroke } : {}), ...Object.fromEntries(Object.entries(svg.attrs).filter(([k]) => !['viewBox', 'fill', 'stroke', 'xmlns', 'preserveAspectRatio'].includes(k))) }
    const hash = crypto.createHash('sha256').update(serializar(svg, null)).digest('hex')
    const salida = serializar(svg, idIcono || null)
    if (salida.length > MAX_SVG) return fallo('el SVG normalizado pesa demasiado')
    return { ok: true, svg: salida, viewBox: caja.join(' '), hash }
  } catch (e) {
    return fallo(e && e.message ? e.message : 'el SVG no es válido')
  }
}
