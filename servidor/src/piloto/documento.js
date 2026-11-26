// «Curso piloto»: modelo neutro de bloques a partir del HTML que exporta Google Docs (export?format=html).
// Bloque = { tipo: 'parrafo', texto } | { tipo: 'tabla', filas: string[][] }
// Imita lo que entrega la API de Docs a los flujos de n8n (párrafos y tablas en orden de documento) para que el código portado no cambie.
import * as cheerio from 'cheerio'

export const aplanar = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim()

const ENCABEZADOS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
const TEXTO = new Set(['p', 'li', ...ENCABEZADOS])
const etiqueta = (el) => String(el.tagName || el.name || '').toLowerCase()

// Texto de una celda: cada <p>/<li> aplanado y unidos con salto de línea; una tabla anidada añade su texto a la celda que la contiene.
function textoCelda($, celda) {
  const partes = []
  const recorrer = (nodo) => {
    $(nodo).children().each((_, h) => {
      const t = etiqueta(h)
      if (t === 'table') {
        const filas = filasDe($, h).map((f) => f.join(' | ')).filter((x) => aplanar(x.replace(/\|/g, '')))
        if (filas.length) partes.push(filas.join('\n'))
      } else if (t === 'li' && $(h).children('p').length) recorrer(h)
      else if (TEXTO.has(t)) { const x = aplanar($(h).text()); if (x) partes.push(x) } else if (t === 'br') { /* sin texto */ } else if ($(h).children().length) recorrer(h)
      else { const x = aplanar($(h).text()); if (x) partes.push(x) }
    })
  }
  recorrer(celda)
  return partes.length ? partes.join('\n') : aplanar($(celda).text())
}

function filasDe($, tabla) {
  const filas = []
  const pendientes = [] // columna → filas que aún cubre una celda combinada hacia abajo (rowspan)
  $(tabla).find('tr').filter((_, tr) => $(tr).closest('table')[0] === tabla).each((_, tr) => {
    const fila = []
    const hastaLibre = () => { while (pendientes[fila.length] > 0) { pendientes[fila.length]--; fila.push('') } } // continuación de una celda combinada: vacía, como en la API de Docs
    $(tr).children('td, th').each((__, td) => {
      hastaLibre()
      let txt = textoCelda($, td)
      // Un enlace a una plantilla (…/plantillas/ver/<nombre>) cuyo texto visible no es la dirección: se añade la dirección al texto de la celda.
      $(td).find('a[href]').each((___, a) => {
        let h = String($(a).attr('href') || '')
        const q = /[?&]q=([^&]+)/.exec(h)
        if (q) { try { h = decodeURIComponent(q[1]) } catch { /* se deja tal cual */ } }
        if (/\/plantillas(?:-html)?\/ver\//i.test(h) && !txt.includes(h)) txt += ' ' + h
      })
      fila.push(txt)
      const n = Math.min(50, Math.max(1, parseInt($(td).attr('colspan') || '1', 10) || 1))
      const alto = Math.min(100, Math.max(1, parseInt($(td).attr('rowspan') || '1', 10) || 1))
      if (alto > 1) pendientes[fila.length - 1] = alto - 1
      for (let i = 1; i < n; i++) { fila.push(''); if (alto > 1) pendientes[fila.length - 1] = alto - 1 } // celda combinada: se conservan los índices de columna
    })
    hastaLibre()
    filas.push(fila)
  })
  return filas
}

export function bloquesDeHtml(html) {
  const $ = cheerio.load(String(html ?? ''))
  const bloques = []
  const recorrer = (nodo) => {
    $(nodo).children().each((_, h) => {
      const t = etiqueta(h)
      if (t === 'table') { bloques.push({ tipo: 'tabla', filas: filasDe($, h) }); return }
      if (t === 'script' || t === 'style') return
      if (t === 'li' && $(h).children('p, table').length) { recorrer(h); return }
      if (TEXTO.has(t)) { const x = aplanar($(h).text()); if (x) bloques.push({ tipo: 'parrafo', texto: x }); return }
      if ($(h).children().length) recorrer(h)
    })
  }
  recorrer($('body')[0])
  return bloques
}

// Párrafos con salto de línea; cada fila de tabla en una línea con « | » entre celdas.
export function textoDeBloques(bloques) {
  return bloques.map((b) => (b.tipo === 'parrafo' ? b.texto : b.filas.map((f) => f.map(aplanar).join(' | ')).join('\n'))).join('\n')
}
