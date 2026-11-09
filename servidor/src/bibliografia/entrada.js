// Del texto del syllabus a la lista de fuentes: encuentra TODAS las secciones de bibliografía (básica, complementaria,
// por unidad…) y separa cada referencia con su dirección web y su DOI.
const TITULO = /^\s*(?:\d+[.)]?\s*)?(bibliograf[ií]a(?:\s+(?:b[aá]sica|complementaria|recomendada|general|de\s+consulta))?|referencias(?:\s+bibliogr[aá]ficas)?|fuentes(?:\s+de\s+consulta)?|lecturas\s+(?:obligatorias|recomendadas)|recursos\s+bibliogr[aá]ficos|webgraf[ií]a|cibergraf[ií]a)\b(.{0,60})$/i
const UNIDAD = /unidad\s*(?:nro\.?|n[uú]mero|n\.?[º°o]|no\.?)?\s*(\d{1,2})/i
// Un título de otra sección (unidad, numeral en mayúsculas…) cierra la bibliografía abierta.
const FIN_SECCION = /^\s*(?:unidad\s*(?:nro\.?|n[uú]mero)?\s*\d{1,2}\b.{0,80}|\d{1,2}\.\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{6,}|(?:evaluaci[oó]n|cronograma|metodolog[ií]a|competencias|resultados\s+de\s+aprendizaje|anexos?)\s*:?)\s*$/i
const RE_URL = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:]/gi
const RE_DOI = /\b(?:doi\s*:?\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s"<>]+[^\s"<>.,;)])/i
const VINETA = /^([-•*·▪●]|\d{1,3}[.)])\s+/

export const limpiarDoi = (s) => String(s || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi\s*:?\s*/i, '').trim().toLowerCase()

export function parseEntrada(texto) {
  const crudo = String(texto || '').replace(/\s+/g, ' ').trim()
  const doiM = RE_DOI.exec(crudo)
  const urls = (crudo.match(RE_URL) || []).map((u) => u.replace(/[.,;]+$/, ''))
  const doi = doiM ? limpiarDoi(doiM[1]) : ''
  const url = urls.find((u) => !/doi\.org/i.test(u)) || urls[0] || ''
  return { entrada_cruda: crudo.slice(0, 2000), url: url.slice(0, 2000), doi: doi.slice(0, 200) }
}

const categoriaDe = (t) => (/complementaria|recomendada/i.test(t) ? 'complementaria' : (/b[aá]sica|obligatoria/i.test(t) ? 'basica' : null))
const parece = (t) => /\((?:19|20)\d{2}[a-z]?\)|\(s\.?\s?f\.?\)/i.test(t) || /https?:\/\//i.test(t) || /\b10\.\d{4,9}\//.test(t)

// Devuelve [{ entrada_cruda, url, doi, unidad, categoria }]. Cada referencia es un párrafo; las líneas con sangría
// (por ejemplo la dirección bajo la referencia) continúan la anterior. Sin título de bibliografía, solo cuentan las
// líneas que parecen una referencia (año entre paréntesis, dirección web o DOI).
export function extraerEntradas(textoSyllabus) {
  const lineas = String(textoSyllabus || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n')
  const salida = []
  let abierta = false
  let unidad = null
  let categoria = null
  let actual = ''
  const cierra = () => { if (actual.trim().length >= 12) salida.push({ texto: actual.trim(), unidad, categoria }); actual = '' }
  const hayTitulos = lineas.some((l) => l.trim() && l.trim().length < 100 && TITULO.test(l.trim()))
  for (const bruta of lineas) {
    const l = bruta.trim()
    if (!l) { if (!/^ {2,}\S/.test(bruta)) cierra(); continue }
    if (l.length < 100 && TITULO.test(l)) {
      cierra()
      abierta = true
      const u = UNIDAD.exec(l)
      if (u) unidad = Number(u[1])
      categoria = categoriaDe(l)
      continue
    }
    if (hayTitulos && !abierta) continue
    if (hayTitulos && l.length < 100 && FIN_SECCION.test(l)) {
      cierra()
      abierta = false
      const u = UNIDAD.exec(l)
      if (u) unidad = Number(u[1])
      continue
    }
    const continuacion = /^ {2,}\S/.test(bruta) && actual !== ''
    if (!continuacion && VINETA.test(l)) cierra()
    else if (!continuacion && actual && !/^\t/.test(bruta)) cierra()
    actual += (actual ? ' ' : '') + l.replace(VINETA, '')
  }
  cierra()
  const vistos = new Set()
  return salida
    .filter((e) => parece(e.texto))
    .map((e) => ({ ...parseEntrada(e.texto), unidad: e.unidad, categoria: e.categoria }))
    .filter((e) => { const k = e.doi || e.url || e.entrada_cruda.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true })
}
