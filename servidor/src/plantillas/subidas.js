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

// Devuelve { ok: true, html } con la plantilla armada, o { ok: false, error } con el motivo en español.
export function armarSubida(crudo) {
  if (typeof crudo !== 'string' || !crudo.trim()) return { ok: false, error: 'El archivo está vacío.' }
  if (Buffer.byteLength(crudo, 'utf8') > MAX_HTML) return { ok: false, error: 'El archivo pesa más de ' + (MAX_HTML / 1024 / 1024) + ' MB.' }
  if (!/<html[\s>]/i.test(crudo)) return { ok: false, error: 'No parece una página HTML completa (falta la etiqueta <html>).' }
  let css, lib
  try {
    css = leer('base.css') + '\n' + leer('plataforma/tec.css')
    lib = leer('lib.js') + '\n' + leer('plataforma/lib-extra.js')
  } catch { return { ok: false, error: 'El servidor no encontró los estilos comunes para armar la plantilla.' } }
  const html = aplicarTema(incrustar(crudo, css, lib), temaBase(), false)
  for (const marca of [MARCA_TITULO, MARCA_CONTENIDO]) {
    const n = cuenta(html, marca)
    if (n !== 1) return { ok: false, error: 'Debe tener exactamente una marca ' + marca + ' y tiene ' + n + '. Es donde n8n pone el título y el contenido del recurso.' }
  }
  for (const marca of MARCAS_INTERNAS) {
    if (html.includes(marca)) return { ok: false, error: 'Quedó sin reemplazar ' + marca + ': esa marca la arma el sistema y no puede repetirse.' }
  }
  return { ok: true, html }
}

// Cabeceras con las que se entrega una plantilla subida: aislada del resto de la plataforma.
export const CABECERAS_AISLADAS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': 'sandbox allow-scripts allow-popups allow-forms allow-modals',
  'X-Content-Type-Options': 'nosniff'
}
