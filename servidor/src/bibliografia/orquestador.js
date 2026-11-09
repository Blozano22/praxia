// Orquesta el proceso de cada fuente de la bibliografía, en este orden:
//   1) lo que dice el texto del syllabus  →  2) Crossref (si hay DOI)  →  3) la página o el archivo (HTML, PDF, DOCX)
//   4) los PDF que enlaza esa página  →  5) todo el texto por página a la base  →  6) cita y referencia APA 7.
// Los metadatos se funden por prioridad: Crossref > página web > metadatos del PDF > lo escrito en el syllabus.
import { conUsuario } from '../db.js'
import { Q } from '../consultas.js'
import { descargar } from './red.js'
import { metadatosPorDoi } from './crossref.js'
import { huella, leerDocx, leerHtml, leerPdf, tipoDeContenido } from './extraer.js'
import { limpiarDoi } from './entrada.js'
import * as openalex from './openalex.js'
import { similitud } from './openalex.js'
import { asignarLetras, citaEnTexto, referencia } from './apa.js'

const MAX_PDF_POR_PAGINA = 3
const MAX_DESCARGAS_POR_FUENTE = 12

// Mejor intento de leer «Apellido, N. (2020). Título (5.ª ed.). Revista, 12(3), 45-67.» tal como se escribe en un syllabus.
const ROL = /\((comp|ed|eds|coord|dir)s?\.\)/i
export function desdeTexto(crudo) {
  const t = String(crudo || '').replace(/https?:\/\/\S+/g, '').replace(/\bdoi\s*:?\s*10\.\S+/gi, '').replace(/\s+/g, ' ').trim()
  const m = /^(.+?)\s*\(\s*((?:19|20)\d{2}[a-z]?|s\.?\s?f\.?|n\.?\s?d\.?)\s*(?:,[^)]*)?\)\s*\.?\s*(.+)$/i.exec(t)
  if (!m) return { titulo: t.slice(0, 300), autores: [], anio: '' }
  const [, quienes, anio, resto] = m
  const rol = (ROL.exec(quienes) || [])[1]
  const lista = quienes.replace(ROL, '').replace(/,?\s+(y|&|and)\s+/gi, ', ').replace(/\.\s*$/, '.')
  const autores = lista.split(/\s*;\s*|(?<=\.),\s+(?=[A-ZÁÉÍÓÚÑ])/).map((x) => x.trim()).filter(Boolean).map((a) => {
    const p = a.split(',').map((x) => x.trim())
    return p.length >= 2 && p[1].length <= 30
      ? { apellido: p[0], nombres: p.slice(1).join(' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim() }
      : { apellido: a.replace(/[.,]+$/, ''), institucional: true }
  })
  if (rol && autores.length) autores[autores.length - 1].rol = rol.charAt(0).toUpperCase() + rol.slice(1).toLowerCase() + '.'
  let partes = resto.split(/\.\s+/)
  let titulo = (partes[0] || '').replace(/[.]+$/, '').trim()
  let edicion = ''
  const ed = /\s*\((\d+\s?(?:st|nd|rd|th|\.?ª|\.?°)?)\s*ed\.?\)/i.exec(titulo)
  if (ed) { edicion = ed[1].trim(); titulo = titulo.replace(ed[0], '').trim() }
  if (!ed && partes[1] && /^\(?\d+\s?(?:st|nd|rd|th|\.?ª|\.?°)?\s*ed\.?\)?$/i.test(partes[1].trim())) { edicion = partes[1].replace(/[^\dA-Za-zª°.]/g, '').replace(/ed\.?$/i, ''); partes = [partes[0], ...partes.slice(2)] }
  const cola = partes.slice(1).join('. ').trim()
  const r = { titulo, autores, anio: /\d/.test(anio) ? anio.slice(0, 4) : '', edicion }
  const rev = /^(.*?),\s*(\d+)(?:\(([^)]+)\))?,\s*(?:Article\s+)?([\dA-Za-z–-]+)\.?$/.exec(cola) || /^(.*?),\s*\(([^)]+)\),\s*([\dA-Za-z–-]+)\.?$/.exec(cola)
  if (rev && rev.length === 5) Object.assign(r, { publicacion: rev[1].trim(), volumen: rev[2], numero: rev[3] || '', paginas: rev[4] })
  else if (rev) Object.assign(r, { publicacion: rev[1].trim(), numero: rev[2], paginas: rev[3] })
  else if (cola) r.editorial = cola.replace(/[.]+$/, '')
  return r
}

const autoresDeTexto = (lista) => (lista || []).map((n) => {
  const p = String(n).split(',').map((x) => x.trim())
  return p.length >= 2 ? { apellido: p[0], nombres: p.slice(1).join(' ') } : { apellido: String(n).trim(), institucional: true }
}).filter((a) => a.apellido)

// Funde metadatos: la primera capa que traiga un campo lo fija (Crossref > syllabus > página web > PDF).
// Excepción: el año y el título los fija el syllabus, porque es lo que se cita (si coincide con Crossref, se usa la versión del syllabus).
export function fundir(...capas) {
  const r = { autores: [] }
  for (const [, c] of capas) {
    if (!c) continue
    for (const k of ['tipo', 'titulo', 'anio', 'editorial', 'publicacion', 'volumen', 'numero', 'paginas', 'edicion', 'idioma', 'doi', 'url']) {
      if (!r[k] && c[k]) r[k] = c[k]
    }
    if (!r.autores.length && c.autores && c.autores.length) { r.autores = c.autores; r.rol = c.autores[c.autores.length - 1].rol }
  }
  const cr = (capas.find(([n]) => n === 'crossref') || [])[1]
  const sy = (capas.find(([n]) => n === 'syllabus') || [])[1]
  if (sy && sy.anio) r.anio = sy.anio
  if (sy && sy.titulo && (!cr || !cr.titulo || similitud(sy.titulo, cr.titulo) >= 0.7)) r.titulo = sy.titulo
  if (sy && sy.edicion) r.edicion = sy.edicion
  if (sy && sy.paginas && (!r.paginas || (/[–-]/.test(sy.paginas) && !/[–-]/.test(r.paginas)))) r.paginas = sy.paginas
  // Idioma por el título cuando nadie lo informa: decide «y» o «&» entre autores.
  if (!r.idioma && r.titulo) r.idioma = /\b(the|of|and|for|in|on|with|to|an)\b/i.test(r.titulo) && !/\b(el|la|los|las|de|del|y|para|en|con|una?)\b/i.test(r.titulo) ? 'en' : 'es'
  r.fuentes = [...new Set(capas.filter(([, c]) => c).map(([n]) => n))]
  return r
}

async function guardarDocumento(cx, uid, fuenteId, { url, formato, rol, resultado, bytes, sha, error }) {
  const paginas = resultado ? resultado.paginas : []
  const chars = paginas.reduce((a, p) => a + p.texto.length, 0)
  const d = (await cx.query(Q.bibDocumentoGuardar, [fuenteId, uid, url, formato, rol, error ? 'error' : 'extraido', error ? String(error).slice(0, 500) : null, bytes || null, sha || null, paginas.length || null, chars || null])).rows[0]
  await cx.query(Q.bibPaginasBorrar, [d.id, uid])
  const utiles = paginas.filter((p) => p.texto)
  for (let i = 0; i < utiles.length; i += 200) {
    const lote = utiles.slice(i, i + 200)
    await cx.query(Q.bibPaginasGuardar, [d.id, uid, lote.map((p) => p.numero), lote.map((p) => p.texto.replace(/\u0000/g, ''))])
  }
  return { id: d.id, chars }
}

// Procesa UNA fuente. Los fallos de red o de lectura no la tumban: quedan anotados en la propia fuente.
export async function procesarFuente(usuario, fuente, ctx = {}) {
  const descargarFn = ctx.descargar || descargar
  const crossrefFn = ctx.crossref || metadatosPorDoi
  const uid = usuario.id
  const texto = desdeTexto(fuente.entrada_cruda)
  const capaTexto = { titulo: texto.titulo, autores: texto.autores, anio: texto.anio, edicion: texto.edicion, publicacion: texto.publicacion, volumen: texto.volumen, numero: texto.numero, paginas: texto.paginas, editorial: texto.editorial }
  let doi = limpiarDoi(fuente.doi)
  let capaCrossref = null
  let capaWeb = null
  let capaPdf = null
  let urlFinal = fuente.url || ''
  const documentos = []
  const notas = []

  if (doi) {
    try { capaCrossref = await crossrefFn(doi) } catch (e) { notas.push('Crossref: ' + e.message) }
  }
  const inicio = fuente.url || (doi ? 'https://doi.org/' + doi : '')
  const pendientes = []
  if (inicio) pendientes.push(inicio)
  if (capaCrossref && capaCrossref.pdf) pendientes.push(capaCrossref.pdf)
  const vistos = new Set()
  const recorrer = async () => {
  while (pendientes.length && vistos.size < MAX_DESCARGAS_POR_FUENTE) {
    const url = pendientes.shift()
    if (vistos.has(url)) continue
    vistos.add(url)
    try {
      const r = await descargarFn(url, { aceptar: 'text/html,application/pdf,*/*;q=0.8' })
      if (r.estado >= 400) { notas.push('HTTP ' + r.estado + ' en ' + url); continue }
      const formato = tipoDeContenido(r.tipo, r.url, r.datos)
      if (!formato) { notas.push('Formato no admitido (' + (r.tipo || 'desconocido') + ')'); continue }
      if (url === inicio) urlFinal = r.url
      const resultado = formato === 'pdf' ? await leerPdf(r.datos) : formato === 'docx' ? await leerDocx(r.datos) : leerHtml(r.datos.toString('utf8'), r.url)
      if (formato === 'pdf') {
        capaPdf = capaPdf || { titulo: resultado.meta.titulo, autores: autoresDeTexto((resultado.meta.autoresTexto || '').split(/;| y | and /)), anio: resultado.meta.anio }
        if (resultado.ocr) notas.push('Leído por OCR (PDF escaneado, ' + resultado.ocr + ' páginas): puede traer errores de lectura')
        if (resultado.sinOcr) notas.push(resultado.sinOcr + ' páginas sin texto no se pudieron leer por OCR')
        if (resultado.escaneado) notas.push('El PDF parece escaneado (sin texto seleccionable)')
      }
      if (formato === 'html') {
        const m = resultado.meta
        capaWeb = capaWeb || { titulo: m.titulo, autores: autoresDeTexto(m.autores), anio: m.anio, publicacion: m.publicacion, editorial: m.editorial, volumen: m.volumen, numero: m.numero, paginas: m.paginas, idioma: m.idioma, doi: limpiarDoi(m.doi) }
        if (!doi && capaWeb.doi) {
          doi = capaWeb.doi
          try { capaCrossref = await crossrefFn(doi) } catch { /* sigue sin Crossref */ }
        }
        for (const p of m.pdf.slice(0, MAX_PDF_POR_PAGINA)) pendientes.push(p)
      }
      const sustancial = resultado.paginas.reduce((a, p) => a + p.texto.length, 0) > 600
      const rol = formato === 'html' && !sustancial ? 'pagina_de_acceso' : 'texto'
      documentos.push(await conUsuario(usuario, (cx) => guardarDocumento(cx, uid, fuente.id, { url: r.url, formato, rol, resultado, bytes: r.datos.length, sha: huella(r.datos) })))
    } catch (e) {
      notas.push((url.length > 80 ? url.slice(0, 80) + '…' : url) + ': ' + e.message)
      await conUsuario(usuario, (cx) => guardarDocumento(cx, uid, fuente.id, { url, formato: /\.pdf/i.test(url) ? 'pdf' : 'html', rol: 'texto', error: e.message })).catch(() => {})
    }
  }
  }
  await recorrer()
  // Sin texto todavía: busca la versión de acceso abierto en OpenAlex y, si el syllabus no trae DOI ni enlace, la obra por su título.
  if (!documentos.some((d) => d.chars > 0) && (ctx.openalex || process.env.BIB_SIN_RED !== '1')) {
    const oaFn = ctx.openalex || openalex
    try {
      let oa = null
      if (doi) oa = await oaFn.porDoi(doi)
      else if (!fuente.url) {
        oa = await oaFn.porTitulo(texto.titulo, texto.anio, (texto.autores[0] || {}).apellido)
        if (oa && oa.doi) {
          doi = oa.doi
          try { capaCrossref = await crossrefFn(doi) } catch { /* sigue con lo que trajo OpenAlex */ }
          notas.push('Obra encontrada por título en OpenAlex (DOI ' + doi + ')')
        }
      }
      if (oa && oa.pdfs.length) {
        notas.push('Texto abierto buscado en OpenAlex')
        pendientes.push(...oa.pdfs)
        await recorrer()
      }
    } catch (e) { notas.push('OpenAlex: ' + e.message) }
  }

  const m = fundir(['crossref', capaCrossref], ['syllabus', capaTexto], ['pagina web', capaWeb], ['pdf', capaPdf])
  const conTexto = documentos.some((d) => d.chars > 0)
  const tipo = m.tipo || (m.publicacion && (m.volumen || m.numero || m.doi) ? 'articulo' : (urlFinal ? 'web' : (m.editorial ? 'libro' : 'otro')))
  let estado = 'parcial'
  if (conTexto) estado = 'resuelta'
  else if (!capaCrossref && !capaWeb && !capaPdf && (urlFinal || doi)) estado = 'sin_acceso'
  const g = {
    id: fuente.id, tipo, estado, detalle: notas.join(' · ').slice(0, 500) || null, doi: m.doi || doi || null, url_final: urlFinal || null,
    titulo: (m.titulo || '').slice(0, 1000), anio: (m.anio || '').slice(0, 20), editorial: (m.editorial || '').slice(0, 300), publicacion: (m.publicacion || '').slice(0, 500),
    volumen: (m.volumen || '').slice(0, 40), numero: (m.numero || '').slice(0, 40), paginas: (m.paginas || '').slice(0, 40), edicion: (m.edicion || '').slice(0, 40), idioma: (m.idioma || '').slice(0, 20),
    fuente_datos: m.fuentes.join(' + ').slice(0, 60), autores: m.autores, rol: m.rol, url: fuente.url
  }
  await conUsuario(usuario, async (cx) => {
    await cx.query(Q.bibFuenteGuardar, [g.id, uid, g.tipo, g.estado, g.detalle, g.titulo, g.anio, g.editorial, g.publicacion, g.volumen, g.numero, g.paginas, g.edicion, g.idioma, g.url_final, g.fuente_datos, g.doi])
    await cx.query(Q.bibAutoresBorrar, [g.id, uid])
    for (const [i, a] of g.autores.slice(0, 60).entries()) {
      await cx.query(Q.bibAutorInsertar, [g.id, uid, i + 1, String(a.apellido).slice(0, 200), a.nombres ? String(a.nombres).slice(0, 200) : null, Boolean(a.institucional)])
    }
  })
  return g
}

// La persona descargó el documento por su cuenta (p. ej. de un sitio que no atiende a programas) y lo sube a la fuente:
// se lee igual que los demás (texto completo por página, con su huella) y la fuente pasa a «resuelta».
export async function leerArchivoSubido(usuario, fuenteId, datos, nombre) {
  const uid = usuario.id
  const ext = (/\.([A-Za-z0-9]{2,5})$/.exec(nombre || '') || [])[1] || ''
  let formato = null
  if (datos.subarray(0, 5).toString() === '%PDF-') formato = 'pdf'
  else if (/^docx$/i.test(ext) && datos.subarray(0, 2).toString() === 'PK') formato = 'docx'
  else if (/^html?$/i.test(ext)) formato = 'html'
  if (!formato) throw Object.assign(new Error('Formato no admitido: sube un PDF, un Word (.docx) o una página guardada (.html).'), { estado: 415 })
  const resultado = formato === 'pdf' ? await leerPdf(datos) : formato === 'docx' ? await leerDocx(datos) : leerHtml(datos.toString('utf8'), 'https://archivo.local/')
  const chars = resultado.paginas.reduce((a, p) => a + p.texto.length, 0)
  if (!chars) throw Object.assign(new Error('No se pudo sacar texto del archivo, ni siquiera por OCR (¿imagen borrosa o muy girada?).'), { estado: 422 })
  const sha = huella(datos)
  const url = 'archivo-subido:' + sha.slice(0, 16) + ':' + String(nombre || 'documento').replace(/[^\w.\- ]+/g, '').slice(0, 120)
  return conUsuario(usuario, async (cx) => {
    const g = await guardarDocumento(cx, uid, fuenteId, { url, formato, rol: 'texto', resultado, bytes: datos.length, sha })
    await cx.query(Q.bibFuenteEstado, [fuenteId, uid, 'resuelta', 'Texto leído de un archivo subido por la persona'])
    return { documentoId: g.id, formato, paginas: resultado.paginas.length, caracteres: chars }
  })
}

// Corre un trabajo completo: cada fuente en su turno (de una en una, con respeto al servidor remoto) y al final
// fija las citas de todas juntas (así «2020a» y «2020b» salen bien).
export async function correrTrabajo(usuario, trabajoId, ctx = {}) {
  const uid = usuario.id
  let resueltas = 0
  let fallidas = 0
  const marcar = (estado, detalle) => conUsuario(usuario, (cx) => cx.query(Q.bibTrabajoActualizar, [trabajoId, uid, estado, resueltas, fallidas, detalle || null])).catch(() => {})
  try {
    const fuentes = (await conUsuario(usuario, (cx) => cx.query(Q.bibFuentesDelTrabajo, [trabajoId]))).rows
    const hechas = []
    await marcar('procesando')
    for (const f of fuentes) {
      try {
        const g = await procesarFuente(usuario, f, ctx)
        hechas.push({ ...g, fecha_consulta: new Date() })
        if (g.estado === 'resuelta' || g.estado === 'parcial') resueltas++; else fallidas++
      } catch (e) { fallidas++ }
      await marcar('procesando')
    }
    asignarLetras(hechas)
    await conUsuario(usuario, async (cx) => { for (const g of hechas) await cx.query(Q.bibFuenteCitas, [g.id, uid, referencia(g), citaEnTexto(g)]) })
    await marcar('listo')
  } catch (e) {
    await marcar('error', String(e.message).slice(0, 400))
  }
}
