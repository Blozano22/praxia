// OpenAlex (gratuito, sin clave): encuentra la versión de acceso abierto de una obra y, si el syllabus no trae DOI ni
// enlace, busca la obra por título, autor y año. Solo se acepta una coincidencia cuando el título es casi idéntico.
const BASE = 'https://api.openalex.org/works'
const CAMPOS = 'id,doi,title,publication_year,best_oa_location,open_access,locations'
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function similitud(a, b) {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 2))
  const B = new Set(norm(b).split(' ').filter((w) => w.length > 2))
  if (!A.size || !B.size) return 0
  let comunes = 0
  for (const w of A) if (B.has(w)) comunes++
  return comunes / Math.max(A.size, B.size)
}

async function pedir(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'PraxiaBibliografia/1.0' } })
  if (!r.ok) return null
  return r.json()
}

function resumen(w) {
  const pdfs = new Set()
  for (const l of [w.best_oa_location, ...(w.locations || [])]) if (l && l.pdf_url) pdfs.add(l.pdf_url)
  const oa = (w.open_access && w.open_access.oa_url) || ''
  if (oa && !pdfs.size) pdfs.add(oa)
  return { doi: String(w.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase(), titulo: w.title || '', anio: w.publication_year ? String(w.publication_year) : '', pdfs: [...pdfs].slice(0, 4) }
}

export async function porDoi(doi) {
  const w = await pedir(BASE + '/https://doi.org/' + encodeURIComponent(doi).replace(/%2F/g, '/') + '?select=' + CAMPOS)
  return w ? resumen(w) : null
}

export async function porTitulo(titulo, anio, apellido) {
  if (!titulo || norm(titulo).length < 12) return null
  const q = encodeURIComponent(String(titulo).slice(0, 200))
  const j = await pedir(BASE + '?search=' + q + '&per-page=5&select=' + CAMPOS)
  const mejor = ((j && j.results) || []).map((w) => ({ w, s: similitud(titulo, w.title) })).filter((x) => x.s >= 0.85 && (!anio || !x.w.publication_year || Math.abs(x.w.publication_year - Number(anio)) <= 1)).sort((a, b) => b.s - a.s)[0]
  void apellido
  return mejor ? resumen(mejor.w) : null
}
