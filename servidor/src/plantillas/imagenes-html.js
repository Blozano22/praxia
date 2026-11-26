// «Plantillas con imágenes»: localiza las imágenes de una plantilla HTML y cambia SOLO sus URL (sin tocar nada más del archivo). Módulo puro: sin red ni base de datos.
// Se analiza el HTML crudo tal como lo escribió la persona (no el armado, que trae los estilos comunes de la plataforma). No se miran los <script> ni los comentarios
// (ni el contenido de ejemplo /*CONTENIDO*/…/*FIN-CONTENIDO*/, que vive dentro de un script): lo que se edita es el marcado de la plantilla.
// Lugares que se reconocen: <img src|data-src|srcset|data-srcset>, <source src|srcset>, style="background-image|background: url(…)" y bloques <style> con esas mismas propiedades.
// Las imágenes incrustadas (data:) no se listan: no tienen URL que editar.
import crypto from 'node:crypto'
import net from 'node:net'
import { esIpPrivada } from '../bibliografia/red.js'

export const MAX_URL = 2000
export const MAX_CAMBIOS = 300
const PUERTOS = new Set(['', '80', '443', '8080', '8443'])

const RE_ETIQUETA = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g
const RE_ATRIBUTO = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const RE_URL_CSS = /url\(\s*(?:"([^"]*)"|'([^']*)'|&quot;(.*?)&quot;|&#0*39;(.*?)&#0*39;|([^)\s"']*))\s*\)/gi
const RE_STYLE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi

export const huellaHtml = (html) => crypto.createHash('sha256').update(html).digest('hex').slice(0, 20)

const BLANCOS = (t) => ' '.repeat(t.length)
// Misma longitud que el original, para que las posiciones coincidan: lo que no se analiza (comentarios, scripts) queda en blanco.
function enmascarar(crudo) {
  return crudo
    .replace(/<!--[\s\S]*?-->/g, BLANCOS)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, BLANCOS)
}

const ENTIDADES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>' }
export const decodificar = (t) => t.replace(/&(?:amp|quot|lt|gt|#39|#x27);/gi, (m) => ENTIDADES[m.toLowerCase()] || m)
const escaparAtributo = (t) => t.replace(/&/g, '&amp;')
// Dentro de un literal de JavaScript: se escapan la barra invertida, la comilla que lo rodea y ${ (en plantillas con comilla invertida).
const escaparJs = (t, comilla) => t.replace(/\\/g, '\\\\').split(comilla).join('\\' + comilla).replace(/\$\{/g, '\\${')

// Candidatos de un srcset: [{ inicio, fin }] relativos al valor, sin los descriptores (1x, 480w).
function candidatosSrcset(v) {
  const res = []
  let i = 0
  while (i < v.length) {
    while (i < v.length && /[\s,]/.test(v[i])) i++
    if (i >= v.length) break
    let j = i
    while (j < v.length && !/\s/.test(v[j])) j++
    let url = v.slice(i, j)
    const coma = url.endsWith(',')
    if (coma) url = url.replace(/,+$/, '')
    if (url) res.push({ inicio: i, fin: i + url.length })
    i = j
    if (!coma) {
      while (i < v.length && /\s/.test(v[i])) i++
      let k = i
      while (k < v.length && !/[\s,]/.test(v[k])) k++
      if (/^\d+(\.\d+)?[wx]$/i.test(v.slice(i, k))) i = k
    }
  }
  return res
}

// url(...) dentro de una propiedad background o background-image. `base` es la posición del texto dentro del HTML; `escape` dice cómo se escribe un valor nuevo.
function urlsDeFondo(texto, base, escape) {
  const fuera = []
  // para decidir la propiedad se tapa el interior de cada url(): una URL data:…;base64 trae «;» y rompería el recorte de la declaración
  const tapado = texto.replace(RE_URL_CSS, (m) => 'url(' + 'x'.repeat(Math.max(0, m.length - 5)) + ')')
  RE_URL_CSS.lastIndex = 0
  let m
  while ((m = RE_URL_CSS.exec(texto))) {
    const valor = [m[1], m[2], m[3], m[4], m[5]].find((x) => x !== undefined) ?? ''
    const ini = m.index + m[0].indexOf(valor, 4)
    const desde = Math.max(tapado.lastIndexOf(';', m.index), tapado.lastIndexOf('{', m.index), tapado.lastIndexOf('}', m.index)) + 1
    const prop = /^\s*([a-z-]+)\s*:/i.exec(tapado.slice(desde, m.index))
    if (!prop || !['background', 'background-image'].includes(prop[1].toLowerCase())) continue
    fuera.push({ inicio: base + ini, fin: base + ini + valor.length, bruto: valor, escape })
  }
  return fuera
}

const RE_EJEMPLO = /\/\*CONTENIDO\*\/[\s\S]*?\/\*FIN-CONTENIDO\*\//
const RE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const RE_EXT_IMAGEN = /\.(?:png|jpe?g|gif|svg|webp|avif)$/i
const RE_IMAGEN_GOOGLE = /^https?:\/\/(?:drive\.google\.com\/(?:thumbnail\?|uc\?)|lh\d*\.googleusercontent\.com\/)/i

// Literales de texto de un script que son URL de imagen: terminan en extensión de imagen, son de Drive/Google, se asignan a .src / setAttribute('src') o
// su variable se usa así en el mismo script. Sin plantillas con ${…}. Se saltan comentarios; una comilla sin cerrar en su línea no arrastra al resto.
function urlsDeScript(js, base) {
  const fuera = []
  const enSrc = new Set()
  for (const x of js.matchAll(/\.src\s*=\s*([A-Za-z_$][\w$]*)\s*(?=[;,)}\n]|$)|setAttribute\(\s*['"]src['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) enSrc.add(x[1] || x[2])
  const n = js.length
  let i = 0
  while (i < n) {
    const c = js[i]
    if (c === '/' && js[i + 1] === '/') { const f = js.indexOf('\n', i); if (f < 0) break; i = f; continue }
    if (c === '/' && js[i + 1] === '*') { const f = js.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; continue }
    if (c !== "'" && c !== '"' && c !== '`') { i++; continue }
    let j = i + 1
    let cerrada = false
    while (j < n) {
      const d = js[j]
      if (d === '\\') { j += 2; continue }
      if (d === c) { cerrada = true; break }
      if (d === '\n' && c !== '`') break
      j++
    }
    if (!cerrada) { i++; continue }
    const lit = js.slice(i + 1, j)
    const ini = i
    i = j + 1
    if (lit.includes('${') || /\\[^'"`\\/$]/.test(lit)) continue
    const val = lit.replace(/\\(['"`\\/$])/g, '$1')
    if (!/^https?:\/\/\S+$/i.test(val)) continue
    const pre = js.slice(Math.max(0, ini - 120), ini)
    const vm = /([A-Za-z_$][\w$]*)\s*[:=]\s*$/.exec(pre)
    const directa = /\.src\s*=\s*$|setAttribute\(\s*['"]src['"]\s*,\s*$/.test(pre)
    let ruta = val
    try { ruta = new URL(val).pathname } catch { /* se queda como está */ }
    if (!(directa || (vm && enSrc.has(vm[1])) || RE_EXT_IMAGEN.test(ruta) || RE_IMAGEN_GOOGLE.test(val))) continue
    const ini0 = js.lastIndexOf('\n', ini) + 1
    const fin0 = js.indexOf('\n', j)
    const linea = (js.slice(ini0, ini + 1) + '…' + js.slice(j, fin0 < 0 ? n : fin0)).trim()
    fuera.push({ inicio: base + ini + 1, fin: base + j, bruto: val, escape: 'js', comilla: c, variable: vm && !directa ? vm[1] : null, ctx: linea.length > 140 ? linea.slice(0, 140) + '…' : linea })
  }
  return fuera
}

const textoCerca = (masc, pos) => {
  const antes = masc.slice(Math.max(0, pos - 400), pos).replace(/<[^>]*>?/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return antes.length > 90 ? '…' + antes.slice(-90) : antes
}

// Todas las imágenes del HTML, en el orden en que aparecen: [{ indice, lugar, url, alt, ancho, alto, contexto, inicio, fin, escape }].
export function escanearImagenes(crudo) {
  if (typeof crudo !== 'string') return []
  const masc = enmascarar(crudo)
  const hallazgos = []
  let m
  RE_ETIQUETA.lastIndex = 0
  while ((m = RE_ETIQUETA.exec(masc))) {
    const etiqueta = m[1].toLowerCase()
    const baseAtributos = m.index + 1 + m[1].length
    const attrs = {}
    const lista = []
    RE_ATRIBUTO.lastIndex = 0
    let a
    while ((a = RE_ATRIBUTO.exec(m[2]))) {
      const nombre = a[1].toLowerCase()
      const v = a[2] ?? a[3] ?? a[4]
      if (v === undefined) continue
      const fin = a.index + a[0].length - (a[2] !== undefined || a[3] !== undefined ? 1 : 0)
      const inicio = baseAtributos + fin - v.length
      attrs[nombre] = decodificar(v)
      lista.push({ nombre, v, inicio })
    }
    const comunes = { etiqueta, attrs, pos: m.index }
    for (const at of lista) {
      if ((etiqueta === 'img' && (at.nombre === 'src' || at.nombre === 'data-src')) || (etiqueta === 'source' && at.nombre === 'src')) {
        hallazgos.push({ ...comunes, lugar: etiqueta + ' ' + at.nombre, inicio: at.inicio, fin: at.inicio + at.v.length, bruto: at.v, escape: 'atributo' })
      } else if ((etiqueta === 'img' || etiqueta === 'source') && (at.nombre === 'srcset' || at.nombre === 'data-srcset')) {
        for (const c of candidatosSrcset(at.v)) hallazgos.push({ ...comunes, lugar: etiqueta + ' ' + at.nombre, inicio: at.inicio + c.inicio, fin: at.inicio + c.fin, bruto: at.v.slice(c.inicio, c.fin), escape: 'atributo' })
      } else if (at.nombre === 'style') {
        for (const h of urlsDeFondo(at.v, at.inicio, 'atributo')) hallazgos.push({ ...comunes, lugar: 'fondo (style)', ...h })
      }
    }
  }
  RE_STYLE.lastIndex = 0
  while ((m = RE_STYLE.exec(masc))) {
    const base = m.index + m[0].indexOf('>') + 1
    for (const h of urlsDeFondo(m[1], base, 'css')) hallazgos.push({ etiqueta: 'style', attrs: {}, pos: base, lugar: 'fondo (CSS)', ...h })
  }
  // URL de imagen escritas en literales de JavaScript dentro de <script> (p. ej. var IMAGEN = '…'; img.src = IMAGEN). No se miran los scripts JSON ni el contenido de ejemplo.
  const sinEjemplo = crudo.replace(/<!--[\s\S]*?-->/g, BLANCOS).replace(RE_EJEMPLO, BLANCOS)
  RE_SCRIPT.lastIndex = 0
  while ((m = RE_SCRIPT.exec(sinEjemplo))) {
    if (/\bsrc\s*=|\btype\s*=\s*["']?[^"'>\s]*json/i.test(m[1])) continue
    const base = m.index + m[0].indexOf('>') + 1
    for (const h of urlsDeScript(m[2], base)) hallazgos.push({ etiqueta: 'script', attrs: {}, pos: base, lugar: 'script', ...h })
  }
  return hallazgos
    .map((h) => ({ ...h, url: h.escape === 'js' ? h.bruto : decodificar(h.bruto) }))
    .filter((h) => h.url.trim() && !/^data:/i.test(h.url.trim()))
    .sort((p, q) => p.inicio - q.inicio)
    .map((h, indice) => ({
      indice, lugar: h.lugar, url: h.url, alt: h.attrs.alt ?? null,
      ancho: h.attrs.width ?? null, alto: h.attrs.height ?? null, variable: h.variable ?? null,
      contexto: h.ctx ?? textoCerca(masc, h.pos), inicio: h.inicio, fin: h.fin, escape: h.escape, comilla: h.comilla
    }))
}

// Resumen para mostrar (sin posiciones).
export const publicas = (imagenes) => imagenes.map(({ inicio, fin, escape, comilla, ...resto }) => resto)

// Comprobación de FORMATO de una URL de imagen que escribe una persona (sin red): http/https, sin usuario ni clave, puerto normal, nada interno.
// Devuelve el motivo en español o null si está bien. La comprobación con DNS la hace validarDestino (red.js) en el servidor.
export function revisarUrlImagen(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return 'La dirección está vacía.'
  if (texto !== texto.trim() || /[\s\u0000-\u001f"'`<>\\()]/.test(texto)) return 'La dirección no puede llevar espacios, comillas, paréntesis ni caracteres raros.'
  if (texto.length > MAX_URL) return 'La dirección es demasiado larga (máximo ' + MAX_URL + ' caracteres).'
  let u
  try { u = new URL(texto) } catch { return 'No es una dirección válida (debe empezar por http:// o https://).' }
  if (!/^https?:$/.test(u.protocol)) return 'Solo se permiten direcciones http o https.'
  if (u.username || u.password) return 'La dirección no puede llevar usuario ni clave.'
  if (!PUERTOS.has(u.port)) return 'Puerto no permitido.'
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'Dirección interna no permitida.'
  if (net.isIP(host) && esIpPrivada(host)) return 'Dirección interna no permitida.'
  return null
}

const sinValores = (crudo, imagenes) => {
  let r = ''
  let desde = 0
  for (const i of imagenes) { r += crudo.slice(desde, i.inicio) + '\u0000'; desde = i.fin }
  return r + crudo.slice(desde)
}

// Cambia las URL indicadas ({ indice: urlNueva }) y NADA más: se reemplaza únicamente el texto de cada URL, de atrás hacia delante.
// Antes de devolver se vuelve a analizar el resultado y se comprueba que el resto del archivo quedó idéntico y que solo cambiaron esas URL.
// Devuelve { ok: true, html, cambios: [{ indice, lugar, antes, despues }] } o { ok: false, error }.
export function aplicarCambios(crudo, cambios) {
  const imagenes = escanearImagenes(crudo)
  const porIndice = new Map(imagenes.map((i) => [i.indice, i]))
  const reales = []
  for (const [k, nueva] of Object.entries(cambios)) {
    const i = porIndice.get(Number(k))
    if (!i) return { ok: false, error: 'La imagen ' + k + ' ya no está en la plantilla: recargue la pantalla.' }
    const motivo = revisarUrlImagen(nueva)
    if (motivo) return { ok: false, error: 'Imagen ' + (i.indice + 1) + ': ' + motivo }
    if (nueva !== i.url) reales.push({ i, nueva })
  }
  let html = crudo
  for (const { i, nueva } of [...reales].sort((p, q) => q.i.inicio - p.i.inicio)) {
    html = html.slice(0, i.inicio) + (i.escape === 'atributo' ? escaparAtributo(nueva) : i.escape === 'js' ? escaparJs(nueva, i.comilla) : nueva) + html.slice(i.fin)
  }
  const despues = escanearImagenes(html)
  const nuevos = new Map(reales.map((r) => [r.i.indice, r.nueva]))
  const intacto = despues.length === imagenes.length &&
    sinValores(crudo, imagenes) === sinValores(html, despues) &&
    imagenes.every((i, n) => despues[n].url === (nuevos.has(i.indice) ? nuevos.get(i.indice) : i.url))
  if (!intacto) return { ok: false, error: 'No se pudo cambiar la URL sin alterar el resto de la plantilla; no se guardó nada. Si la imagen está definida en el código de la plantilla, la URL nueva debe terminar en .png, .jpg, .gif, .svg, .webp o .avif, o ser de Drive/Google.' }
  return { ok: true, html, cambios: reales.map(({ i, nueva }) => ({ indice: i.indice, lugar: i.lugar, antes: i.url, despues: nueva })) }
}

// ¿Los primeros bytes son una imagen? (el servidor remoto puede mentir en el tipo): PNG, JPEG, GIF, WebP, BMP, ICO, AVIF/HEIC o SVG.
export function tipoDeImagen(datos) {
  const b = Buffer.isBuffer(datos) ? datos : Buffer.from(datos || '')
  if (b.length < 4) return null
  const hex = (n) => b.subarray(0, n).toString('hex')
  if (hex(8) === '89504e470d0a1a0a') return 'PNG'
  if (hex(3) === 'ffd8ff') return 'JPEG'
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'GIF'
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'WebP'
  if (b.subarray(0, 2).toString('latin1') === 'BM' && b.length > 14) return 'BMP'
  if (hex(4) === '00000100') return 'ICO'
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(avif|avis|heic|heix|mif1)/.test(b.subarray(8, 12).toString('latin1'))) return 'AVIF'
  const ini = b.subarray(0, 600).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase()
  if (ini.startsWith('<svg') || (/^<\?xml/.test(ini) && ini.includes('<svg')) || (ini.startsWith('<!doctype svg'))) return 'SVG'
  return null
}
