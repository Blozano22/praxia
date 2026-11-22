// Normalizador de SVG del banco de íconos. Recibe el SVG que sube una persona y devuelve uno limpio y seguro, o el motivo (en español) por el que se rechaza.
//
// Reglas (ver ESTRUCTURA-ICONOS-Y-VARIANTES.md):
//  · un solo <svg> con viewBox cuadrado; sin width/height propios; sin texto;
//  · solo formas y degradados: nada de script, image, use, foreignObject, style, class, on*, ni referencias externas;
//  · sin colores fijos: el color principal es currentColor y el secundario var(--ico-2, currentColor). El relieve se hace con capas blancas o negras
//    SEMITRANSPARENTES o con degradados de currentColor;
//  · los id (degradados, recortes) se reescriben con el id del ícono como prefijo para que no choquen al ir varios íconos en la misma página.
// No usa un analizador XML: recorre las etiquetas con expresiones regulares estrictas y rechaza lo que no entiende (mejor rechazar que dejar pasar).
import crypto from 'node:crypto'

export const MAX_SVG = 50 * 1024
const MAX_ELEMENTOS = 2000

// Elementos permitidos (en minúsculas) y cómo se escriben al salir.
const ELEMENTOS = { svg: 'svg', g: 'g', path: 'path', circle: 'circle', ellipse: 'ellipse', rect: 'rect', line: 'line', polyline: 'polyline', polygon: 'polygon',
  defs: 'defs', lineargradient: 'linearGradient', radialgradient: 'radialGradient', stop: 'stop', clippath: 'clipPath', mask: 'mask' }
const FORMAS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])
// Se quitan en silencio (no cambian el dibujo).
const IGNORABLES = /<(title|desc|metadata)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/gi
// Se rechazan con motivo.
const PROHIBIDOS = new Set(['script', 'image', 'use', 'foreignobject', 'style', 'iframe', 'a', 'text', 'tspan', 'textpath', 'switch', 'animate', 'set', 'animatetransform', 'animatemotion', 'filter', 'pattern', 'symbol', 'marker', 'link', 'embed', 'object', 'audio', 'video'])
// Atributos permitidos (minúsculas → como se escriben). Los demás se descartan, salvo los peligrosos, que rechazan el ícono.
const ATRIBUTOS = Object.fromEntries(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'transform', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'fx', 'fy', 'spreadMethod', 'clip-path', 'mask', 'id', 'maskUnits', 'maskContentUnits', 'clipPathUnits', 'viewBox']
  .map((a) => [a.toLowerCase(), a]))
const COLORES_NEGRO = new Set(['#000', '#000000', 'black'])
const COLORES_BLANCO = new Set(['#fff', '#ffffff', 'white'])
const RE_URL_LOCAL = /^url\(\s*#([A-Za-z][\w.-]*)\s*\)$/
const RE_NUM = /^-?\d*\.?\d+(?:e[+-]?\d+)?$/i

const fallo = (error) => ({ ok: false, error })

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
  throw new Error('color fijo no permitido en ' + nombre + ': «' + v.slice(0, 40) + '». Use currentColor (o var(--ico-2, currentColor) para el segundo tono)')
}

// Convierte el SVG sin sus id en una cadena estable; con «prefijo» se reescriben los id (y sus referencias). Devuelve el SVG de salida.
function serializar(arbol, prefijo) {
  const nuevo = (id) => (prefijo === null ? id : (id.startsWith(prefijo + '-') ? id : prefijo + '-' + id))
  const salida = []
  const emitir = (n) => {
    const attrs = Object.entries(n.attrs).map(([k, v]) => {
      let valor = v
      if (k === 'id') valor = nuevo(v)
      else if (/url\(#/.test(v)) valor = v.replace(/url\(#([^)]+)\)/g, (_, id) => 'url(#' + nuevo(id) + ')')
      return ' ' + k + '="' + valor + '"'
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
    let t = crudo.replace(/^﻿/, '').replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(IGNORABLES, '')
    if (/<!|<\?/.test(t)) return fallo('el SVG trae declaraciones (DOCTYPE, ENTITY o CDATA) que no se permiten')
    t = t.trim()
    const raiz = []
    const pila = []
    let cuenta = 0
    let pos = 0
    const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s[^<>]*?)?)\s*(\/?)>/g
    let m
    while ((m = re.exec(t))) {
      const entre = t.slice(pos, m.index)
      if (entre.trim()) return fallo('hay texto suelto dentro del SVG («' + entre.trim().slice(0, 30) + '»): los íconos no llevan texto')
      pos = re.lastIndex
      const [, cierra, nombreCrudo, atrCrudo, autocierra] = m
      const bajo = nombreCrudo.toLowerCase()
      if (cierra) {
        const abierto = pila.pop()
        if (!abierto || abierto.bajo !== bajo) return fallo('las etiquetas del SVG no están bien cerradas (</' + nombreCrudo + '>)')
        continue
      }
      if (PROHIBIDOS.has(bajo)) return fallo('el SVG trae un elemento no permitido: <' + nombreCrudo + '>')
      if (!ELEMENTOS[bajo]) return fallo('el SVG trae un elemento que no se admite: <' + nombreCrudo + '>')
      if (++cuenta > MAX_ELEMENTOS) return fallo('el SVG tiene demasiados elementos (máximo ' + MAX_ELEMENTOS + ')')
      // atributos: se leen todos los «nombre="valor"»; lo que sobre es un atributo mal formado
      const crudos = {}
      const reA = /\s*([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      for (const a of atrCrudo.matchAll(reA)) crudos[a[1]] = a[2] !== undefined ? a[2] : a[3]
      if (atrCrudo.replace(reA, '').trim()) return fallo('el SVG tiene un atributo mal formado en <' + nombreCrudo + '>')
      const attrs = {}
      for (const [k, v] of Object.entries(crudos)) {
        const kb = k.toLowerCase()
        if (/^on/.test(kb)) return fallo('el SVG trae un atributo de evento (' + k + ')')
        if (kb === 'style' || kb === 'class') return fallo('el SVG trae un atributo «' + k + '» que no se permite (use atributos de presentación: fill, stroke…)')
        if (kb === 'href' || kb === 'xlink:href' || kb.endsWith(':href')) return fallo('el SVG trae una referencia externa (' + k + ')')
        if (/javascript:|data:|expression\(/i.test(v)) return fallo('el SVG trae un valor no permitido en «' + k + '»')
        if (v.includes('&')) return fallo('el atributo «' + k + '» trae entidades (&) que no se admiten')
        if (!ATRIBUTOS[kb]) continue                                  // atributo desconocido: se descarta
        attrs[ATRIBUTOS[kb]] = v
      }
      // el SVG raíz: viewBox obligatorio y sin tamaño propio
      if (bajo === 'svg') {
        if (pila.length) return fallo('el SVG trae otro <svg> anidado')
        if (raiz.length) return fallo('el archivo trae más de un elemento <svg> en la raíz')
        if (!attrs.viewBox) return fallo('el SVG no tiene viewBox')
        delete attrs.width; delete attrs.height; delete attrs.x; delete attrs.y
      }
      // valores
      const minusc = {}
      for (const [k, v] of Object.entries(attrs)) minusc[k.toLowerCase()] = v
      for (const k of ['fill', 'stroke', 'stop-color']) if (attrs[k] !== undefined) attrs[k] = color(k, attrs[k], minusc)
      for (const k of ['clip-path', 'mask']) if (attrs[k] !== undefined && attrs[k] !== 'none' && !RE_URL_LOCAL.test(attrs[k].trim())) return fallo('«' + k + '» solo puede apuntar a un elemento del mismo SVG (url(#id))')
      for (const k of ['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity']) if (attrs[k] !== undefined && !RE_NUM.test(attrs[k].trim().replace('%', ''))) return fallo('«' + k + '» no es un número')
      if (attrs.d !== undefined && !/^[\sMmLlHhVvCcSsQqTtAaZz0-9eE.,+-]*$/.test(attrs.d)) return fallo('un trazo (d) trae caracteres no válidos')
      if (attrs.transform !== undefined && !/^[\sA-Za-z0-9.,()+\-]*$/.test(attrs.transform)) return fallo('un transform trae caracteres no válidos')
      if (attrs.id !== undefined && !/^[A-Za-z][\w.-]*$/.test(attrs.id)) return fallo('un id del SVG no es válido (' + attrs.id.slice(0, 30) + ')')
      const nodo = { nombre: ELEMENTOS[bajo], bajo, attrs, hijos: [] }
      if (pila.length) pila[pila.length - 1].hijos.push(nodo); else raiz.push(nodo)
      if (!autocierra) pila.push(nodo)
    }
    if (!raiz.length && !pila.length) return fallo('el archivo no es un SVG (no se encontró ningún elemento <svg>)')
    if (t.slice(pos).trim()) return fallo('hay contenido suelto después del SVG')
    if (pila.length) return fallo('el SVG tiene etiquetas sin cerrar (<' + pila[pila.length - 1].nombre + '>)')
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
