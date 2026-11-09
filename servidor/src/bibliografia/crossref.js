// Metadatos de un DOI en Crossref (gratuito y sin clave). Devuelve un objeto de metadatos normalizado o null.
const TIPOS = { 'journal-article': 'articulo', book: 'libro', 'edited-book': 'libro', monograph: 'libro', 'book-chapter': 'capitulo', 'reference-entry': 'capitulo',
  report: 'informe', dissertation: 'tesis', 'posted-content': 'articulo', 'proceedings-article': 'articulo' }
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }
const limpiar = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (e) => ENT[e]).replace(/\s+/g, ' ').trim()

export async function metadatosPorDoi(doi) {
  const r = await fetch('https://api.crossref.org/works/' + encodeURIComponent(doi), {
    signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'PraxiaBibliografia/1.0 (mailto:soporte@praxia.local)' }
  })
  if (!r.ok) return null
  const m = (await r.json()).message
  if (!m) return null
  const fecha = (m.issued && m.issued['date-parts'] && m.issued['date-parts'][0]) || (m.published && m.published['date-parts'] && m.published['date-parts'][0]) || []
  return {
    tipo: TIPOS[m.type] || 'otro',
    titulo: limpiar((m.title || [])[0]) + (m.subtitle && m.subtitle[0] ? ': ' + limpiar(m.subtitle[0]) : ''),
    autores: (m.author || []).map((a) => a.name ? { apellido: limpiar(a.name), institucional: true } : { apellido: limpiar(a.family), nombres: limpiar(a.given) }).filter((a) => a.apellido),
    anio: fecha[0] ? String(fecha[0]) : '',
    publicacion: limpiar((m['container-title'] || [])[0]),
    editorial: limpiar(m.publisher),
    volumen: limpiar(m.volume), numero: limpiar(m.issue), paginas: limpiar(m.page),
    idioma: limpiar(m.language),
    doi: limpiar(m.DOI).toLowerCase(),
    url: m.URL || ('https://doi.org/' + m.DOI),
    pdf: ((m.link || []).find((l) => /pdf/i.test(l['content-type'] || '')) || {}).URL || ''
  }
}
