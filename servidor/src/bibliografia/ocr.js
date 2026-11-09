// Lectura de PDF escaneados por OCR (reconocimiento de texto en imágenes), en español e inglés, sin servicios externos:
// el idioma viaja en las dependencias (@tesseract.js-data) y todo corre en este servidor. Cada página sin texto se dibuja
// con pdf.js y se lee con Tesseract. Es lento (unos segundos por página), por eso hay un tope de páginas.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.join(aqui, '..', '..')
const datosIdioma = path.join(raiz, 'data', 'ocr')
const MAX_PAGINAS = Number(process.env.OCR_MAX_PAGINAS) || 60
const ESCALA = Number(process.env.OCR_ESCALA) || 2

export const ocrActivo = () => process.env.OCR !== '0'

// Copia los archivos de idioma a una carpeta única (Tesseract los busca todos en la misma).
function prepararIdiomas() {
  fs.mkdirSync(datosIdioma, { recursive: true })
  for (const l of ['spa', 'eng']) {
    const destino = path.join(datosIdioma, l + '.traineddata.gz')
    if (fs.existsSync(destino)) continue
    const origen = path.join(raiz, 'node_modules', '@tesseract.js-data', l, '4.0.0_best_int', l + '.traineddata.gz')
    if (!fs.existsSync(origen)) throw new Error('Falta el idioma «' + l + '» del OCR: ejecute npm install')
    fs.copyFileSync(origen, destino)
  }
}

// Lee con OCR las páginas indicadas de un documento pdf.js ya abierto. Devuelve { numero: texto } y cuántas leyó.
export async function leerPaginasConOcr(doc, numeros) {
  const lista = numeros.slice(0, MAX_PAGINAS)
  if (!lista.length) return { textos: new Map(), leidas: 0, omitidas: numeros.length }
  prepararIdiomas()
  const { createWorker } = await import('tesseract.js')
  const { createCanvas } = await import('@napi-rs/canvas')
  const worker = await createWorker(['spa', 'eng'], 1, { langPath: datosIdioma, cachePath: datosIdioma, gzip: true, logger: () => {} })
  const textos = new Map()
  try {
    for (const n of lista) {
      const pg = await doc.getPage(n)
      const vp = pg.getViewport({ scale: ESCALA })
      const lienzo = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
      const ctx = lienzo.getContext('2d')
      await pg.render({ canvasContext: ctx, viewport: vp }).promise
      const r = await worker.recognize(lienzo.toBuffer('image/png'))
      textos.set(n, r.data.text || '')
      pg.cleanup()
    }
  } finally { await worker.terminate().catch(() => {}) }
  return { textos, leidas: lista.length, omitidas: numeros.length - lista.length }
}
