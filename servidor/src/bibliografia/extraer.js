// Lee el contenido completo de un archivo o página: texto por página (PDF), por bloques (HTML) o por bloques (DOCX),
// y los metadatos que el propio archivo trae. Sin IA: solo lectura y reglas.
import * as cheerio from 'cheerio'
import mammoth from 'mammoth'
import crypto from 'node:crypto'
import { leerPaginasConOcr, ocrActivo } from './ocr.js'

export const huella = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const limpiaTexto = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

export const tipoDeContenido = (tipo, url, datos) => {
  if (datos && datos.length > 4 && datos.subarray(0, 5).toString() === '%PDF-') return 'pdf'
  if (/pdf/.test(tipo) || /\.pdf(?:[?#]|$)/i.test(url)) return datos && datos.subarray(0, 5).toString() === '%PDF-' ? 'pdf' : null
  if (/officedocument\.wordprocessingml/.test(tipo) || /\.docx(?:[?#]|$)/i.test(url)) return 'docx'
  if (/html|xml/.test(tipo) || !tipo) return 'html'
  return null
}

// ---------------------------------------------------------------- PDF
export async function leerPdf(datos) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(datos), useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise
  const paginas = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n)
      const c = await pg.getTextContent()
      let t = ''
      for (const it of c.items) { t += it.str; t += it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : '') }
      paginas.push({ numero: n, texto: limpiaTexto(t) })
      pg.cleanup()
    }
    // Páginas sin texto seleccionable (escaneadas): se leen por OCR. Si el PDF entero es escaneado, todas; si solo algunas, solo esas.
    const vacias = paginas.filter((p) => p.texto.length < 20).map((p) => p.numero)
    let ocr = 0
    let sinOcr = 0
    if (vacias.length && ocrActivo()) {
      try {
        const r = await leerPaginasConOcr(doc, vacias)
        for (const p of paginas) { const t = r.textos.get(p.numero); if (t !== undefined) p.texto = limpiaTexto(t) }
        ocr = r.leidas
        sinOcr = r.omitidas
      } catch (e) { sinOcr = vacias.length; console.error('OCR no disponible:', e.message) }
    } else sinOcr = vacias.length
    let info = {}
    try { info = (await doc.getMetadata()).info || {} } catch { /* sin metadatos */ }
    const anio = /^D:(\d{4})/.exec(info.CreationDate || '')
    const meta = { titulo: limpiaTexto(info.Title), autoresTexto: limpiaTexto(info.Author), anio: anio ? anio[1] : '' }
    return { formato: 'pdf', paginas, meta, ocr, sinOcr, escaneado: paginas.length > 0 && paginas.every((p) => p.texto.length < 20) }
  } finally { await doc.destroy().catch(() => {}) }
}

// ---------------------------------------------------------------- DOCX
export async function leerDocx(datos) {
  const r = await mammoth.extractRawText({ buffer: datos })
  return { formato: 'docx', paginas: porBloques(limpiaTexto(r.value).split(/\n{2,}|\n/)), meta: {} }
}

// ---------------------------------------------------------------- HTML
// Agrupa los párrafos en «páginas» de ~3000 caracteres para poder citar «bloque N» de una página web.
export function porBloques(parrafos, max = 3000) {
  const paginas = []
  let actual = ''
  for (const p of parrafos.map((x) => x.trim()).filter(Boolean)) {
    if (actual && actual.length + p.length > max) { paginas.push(actual); actual = '' }
    actual += (actual ? '\n' : '') + p
  }
  if (actual) paginas.push(actual)
  return paginas.map((texto, i) => ({ numero: i + 1, texto }))
}

const meta = ($, ...nombres) => {
  for (const n of nombres) {
    const v = $(`meta[name="${n}"], meta[property="${n}"], meta[name="${n.toLowerCase()}"]`).first().attr('content')
    if (v && v.trim()) return v.trim()
  }
  return ''
}
const anioDe = (s) => { const m = /(\d{4})/.exec(String(s || '')); return m ? m[1] : '' }

export function leerHtml(texto, urlBase) {
  const $ = cheerio.load(texto)
  const jsonld = []
  $('script[type="application/ld+json"]').each((_, e) => { try { const j = JSON.parse($(e).contents().text()); jsonld.push(...(Array.isArray(j) ? j : j['@graph'] || [j])) } catch { /* JSON-LD roto */ } })
  const ld = jsonld.find((x) => x && /Article|WebPage|Report|Book|ScholarlyArticle|NewsArticle/i.test([].concat(x['@type'] || []).join(' '))) || {}
  const autoresMeta = $('meta[name="citation_author"], meta[name="DC.creator"], meta[name="dc.creator"]').map((_, e) => $(e).attr('content')).get().filter(Boolean)
  const ldAutores = [].concat(ld.author || []).map((a) => (typeof a === 'string' ? a : a && a.name)).filter(Boolean)
  const pdfs = new Set()
  const pdfMeta = meta($, 'citation_pdf_url')
  if (pdfMeta) pdfs.add(new URL(pdfMeta, urlBase).href)
  $('link[type="application/pdf"]').each((_, e) => pdfs.add(new URL($(e).attr('href'), urlBase).href))
  $('a[href]').each((_, e) => { const h = $(e).attr('href'); if (/\.pdf(?:[?#]|$)/i.test(h)) { try { pdfs.add(new URL(h, urlBase).href) } catch { /* enlace roto */ } } })
  const primer = meta($, 'citation_firstpage'), ultima = meta($, 'citation_lastpage')
  const datos = {
    titulo: meta($, 'citation_title', 'DC.title', 'og:title') || (ld.headline || '') || $('title').first().text().trim(),
    autores: (autoresMeta.length ? autoresMeta : ldAutores).map((n) => n.trim()),
    anio: anioDe(meta($, 'citation_publication_date', 'citation_date', 'DC.date', 'article:published_time') || ld.datePublished || ld.dateCreated),
    publicacion: meta($, 'citation_journal_title', 'citation_conference_title', 'og:site_name') || (ld.publisher && (typeof ld.publisher === 'string' ? ld.publisher : ld.publisher.name)) || '',
    editorial: meta($, 'citation_publisher', 'DC.publisher'),
    volumen: meta($, 'citation_volume'), numero: meta($, 'citation_issue'),
    paginas: primer ? primer + (ultima ? '-' + ultima : '') : '',
    doi: meta($, 'citation_doi', 'DC.identifier.doi').replace(/^doi:\s*/i, ''),
    idioma: meta($, 'citation_language', 'DC.language') || $('html').attr('lang') || '',
    pdf: [...pdfs]
  }
  $('script, style, noscript, nav, footer, header, aside, form, iframe, svg, [role="navigation"], .cookie, .menu').remove()
  const raiz = $('article').first().length ? $('article').first() : ($('main').first().length ? $('main').first() : $('body'))
  const parrafos = []
  raiz.find('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,figcaption').each((_, e) => { const t = limpiaTexto($(e).text()); if (t.length > 1) parrafos.push(t) })
  return { formato: 'html', paginas: porBloques(parrafos.length ? parrafos : [limpiaTexto(raiz.text())]), meta: datos }
}
