// Plantillas HTML subidas desde la pantalla «Plantillas HTML → Categorías para n8n».
// Se arman y se validan con las MISMAS reglas que las plantillas del build (plataforma-react/scripts/armar-plantillas.mjs): estilos y código
// comunes incrustados, tema DIEPO, y exactamente una marca {{TITULO}} y una /*CONTENIDO*/. Se guardan armadas (listas para que n8n las descargue).
// Como las sube una persona y se sirven desde el mismo dominio que la plataforma, se entregan AISLADAS (CSP sandbox sin allow-same-origin): sus scripts
// funcionan, pero no pueden leer la sesión ni llamar a la API de Praxia en nombre de quien las abra.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { aplicarTema, incrustar, MARCA_CONTENIDO, MARCA_TITULO, MARCAS_INTERNAS, temaBase } from '../../../plataforma-react/src/lib/armado.js'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..') // raíz del repositorio
const leer = (rel) => fs.readFileSync(path.join(raiz, 'src', rel), 'utf8')
const cuenta = (texto, marca) => texto.split(marca).length - 1

export const MAX_HTML = 1536 * 1024 // 1,5 MB de HTML sin armar
export const NOMBRES_RESERVADOS = ['plantillas', 'index']

// Contenido de ejemplo opcional dentro de la propia plantilla: /*CONTENIDO*/ { …JSON… } /*FIN-CONTENIDO*/.
// Al subirla se separa: n8n recibe la plantilla con la marca sola (sin el ejemplo) y la vista previa usa el HTML con el ejemplo puesto.
export const MARCA_FIN = '/*FIN-CONTENIDO*/'
const RE_EJEMPLO = /\/\*CONTENIDO\*\/([\s\S]*?)\/\*FIN-CONTENIDO\*\//

// Devuelve { ok: true, html, ejemplo } con la plantilla armada (y, si traía contenido de ejemplo, el HTML de la vista previa; si no, null),
// o { ok: false, error } con el motivo en español.
export function armarSubida(crudo) {
  if (typeof crudo !== 'string' || !crudo.trim()) return { ok: false, error: 'El archivo está vacío.' }
  if (Buffer.byteLength(crudo, 'utf8') > MAX_HTML) return { ok: false, error: 'El archivo pesa más de ' + (MAX_HTML / 1024 / 1024) + ' MB.' }
  if (!/<html[\s>]/i.test(crudo)) return { ok: false, error: 'No parece una página HTML completa (falta la etiqueta <html>).' }
  let css, lib
  try {
    css = leer('base.css') + '\n' + leer('plataforma/tec.css')
    lib = leer('lib.js') + '\n' + leer('plataforma/lib-extra.js')
  } catch { return { ok: false, error: 'El servidor no encontró los estilos comunes para armar la plantilla.' } }
  const armar = (t) => aplicarTema(incrustar(t, css, lib), temaBase(), false)

  let plantilla = crudo
  let ejemplo = null
  let esquema = null
  const m = RE_EJEMPLO.exec(crudo)
  if (m) {
    const cuerpo = m[1].trim()
    let datos
    try { datos = JSON.parse(cuerpo) } catch (e) { return { ok: false, error: 'El contenido de ejemplo (entre /*CONTENIDO*/ y ' + MARCA_FIN + ') no es un JSON válido: ' + e.message } }
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return { ok: false, error: 'El contenido de ejemplo debe ser un objeto JSON ({ … }).' }
    esquema = esquemaDe(datos)
    plantilla = crudo.replace(RE_EJEMPLO, () => MARCA_CONTENIDO) // n8n recibe la plantilla sin el ejemplo
    const titulo = typeof datos.titulo === 'string' && datos.titulo.trim() ? datos.titulo.trim() : 'Ejemplo'
    ejemplo = armar(crudo.replace(RE_EJEMPLO, () => cuerpo.replace(/<\//g, '<\\/')))
      .replace(MARCA_TITULO, () => titulo.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])))
  }
  const html = armar(plantilla)
  for (const marca of [MARCA_TITULO, MARCA_CONTENIDO]) {
    const n = cuenta(html, marca)
    if (n !== 1) return { ok: false, error: 'Debe tener exactamente una marca ' + marca + ' y tiene ' + n + '. Es donde n8n pone el título y el contenido del recurso.' }
  }
  if (html.includes(MARCA_FIN)) return { ok: false, error: 'Hay una marca ' + MARCA_FIN + ' sin su /*CONTENIDO*/ de apertura delante (o repetida). El contenido de ejemplo va entre las dos.' }
  for (const marca of MARCAS_INTERNAS) {
    if (html.includes(marca)) return { ok: false, error: 'Quedó sin reemplazar ' + marca + ': esa marca la arma el sistema y no puede repetirse.' }
  }
  return { ok: true, html, ejemplo, esquema: ejemplo ? esquema : null, ficha: leerFicha(crudo) }
}

// Lo que la ficha (comentario HTML al inicio) dice de la plantilla: «Categoría Praxia: G-12» y «Formación: especializacion».
const ALIAS_FORMACION = { tecnologico: 'tecnologico', tecnologia: 'tecnologico', profesional: 'profesional', licenciatura: 'profesional', especializacion: 'especializacion', doctorado: 'doctorado' }
export function leerFicha(crudo) {
  const comentarios = [...String(crudo).matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]).join(String.fromCharCode(10))
  const c = /Categor[ií]a\s+Praxia\s*:\s*([A-Za-z]{1,4}-\d{2,3})/i.exec(comentarios)
  const f = /Formaci[oó]n\s*:\s*([A-Za-zÁÉÍÓÚáéíóúñÑ]+)/i.exec(comentarios)
  const forma = f ? ALIAS_FORMACION[f[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()] : null
  return { categoria: c ? c[1].toUpperCase() : null, formacion: forma || null }
}

// Campos del contenido de ejemplo: lista ordenada de rutas con su tipo («bloques[].titulo:texto»). Dos variantes de la misma categoría deben tener la misma.
// «nivel» y «meta.nivel» no cuentan: la formación es opcional en cualquier plantilla.
const IGNORAR_CAMPOS = new Set(['nivel', 'meta.nivel'])
export function esquemaDe(datos) {
  const out = new Set()
  const visitar = (v, ruta) => {
    if (v === null || v === undefined) return
    if (Array.isArray(v)) { out.add(ruta + ':[]'); for (const x of v) visitar(x, ruta + '[]'); return }
    if (typeof v === 'object') { if (ruta) out.add(ruta + ':{}'); for (const k of Object.keys(v)) visitar(v[k], ruta ? ruta + '.' + k : k); return }
    out.add(ruta + ':' + (typeof v === 'number' ? 'numero' : typeof v === 'boolean' ? 'booleano' : 'texto'))
  }
  visitar(datos, '')
  return [...out].filter((p) => !IGNORAR_CAMPOS.has(p.split(':')[0])).sort()
}
export function compararEsquemas(referencia, nuevo) {
  const r = new Set(referencia), n = new Set(nuevo)
  const faltan = referencia.filter((p) => !n.has(p)), sobran = nuevo.filter((p) => !r.has(p))
  return { coincide: !faltan.length && !sobran.length, faltan, sobran }
}

// Cabeceras con las que se entrega una plantilla subida: aislada del resto de la plataforma.
export const CABECERAS_AISLADAS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': 'sandbox allow-scripts allow-popups allow-forms allow-modals',
  'X-Content-Type-Options': 'nosniff'
}
