// Citas y referencias en APA 7.ª edición (en español; en inglés se usa «&» en lugar de «y»). Funciones puras: sin red ni base de datos.
// La cursiva se marca con *asteriscos*; aHtml() la convierte en <i>.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const esIngles = (f) => /^en/i.test(f.idioma || '')
const conjuncion = (f) => (esIngles(f) ? '&' : 'y')
const fin = (s) => (/[.?!…]$/.test(s) ? s : s + '.')
const txt = (s) => String(s || '').replace(/\s+/g, ' ').trim()

export function iniciales(nombres) {
  return txt(nombres).split(/[\s]+/).filter(Boolean)
    .map((p) => p.split('-').map((x) => x[0].toUpperCase() + '.').join('-')).join(' ')
}
const autorRef = (a) => (a.institucional || !a.nombres ? txt(a.apellido) : txt(a.apellido) + ', ' + iniciales(a.nombres))

export function autoresReferencia(f) {
  const A = (f.autores || []).filter((a) => a.apellido)
  if (!A.length) return ''
  const lista = A.length > 20 ? [...A.slice(0, 19).map(autorRef), '. . . ' + autorRef(A[A.length - 1])] : A.map(autorRef)
  if (lista.length === 1) return lista[0]
  if (A.length > 20) return lista.slice(0, -1).join(', ') + ' ' + lista[lista.length - 1]
  return lista.slice(0, -1).join(', ') + (lista.length > 2 ? ',' : '') + ' ' + conjuncion(f) + ' ' + lista[lista.length - 1]
}
const conRol = (f, t) => (f.rol ? t + ' (' + f.rol + ')' : t)

export function fechaConsulta(d = new Date()) {
  return d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear()
}
const fechaLocal = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v instanceof Date ? v.toISOString() : v)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date() }
const anioTxt = (f) => (txt(f.anio) || 's. f.') + (f.letra || '')
const enlace = (f) => (f.doi ? 'https://doi.org/' + String(f.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : txt(f.url_final || f.url))
const paginasTxt = (p) => txt(p).replace(/-+/g, '–')

export function referencia(f) {
  const autor = conRol(f, autoresReferencia(f))
  const titulo = txt(f.titulo) || 'Sin título'
  const cabeza = (autor ? fin(autor) + ' ' : '') + '(' + anioTxt(f) + '). '
  const url = enlace(f)
  const nota = !f.doi && !f.anio && f.fecha_consulta && url ? 'Recuperado el ' + fechaConsulta(fechaLocal(f.fecha_consulta)) + ', de ' + url : url
  let r
  if (f.tipo === 'articulo') {
    const num = (f.volumen ? ', *' + txt(f.volumen) + '*' : '') + (f.numero ? '(' + txt(f.numero) + ')' : '') + (f.paginas ? ', ' + paginasTxt(f.paginas) : '')
    r = cabeza + fin(titulo) + ' ' + (f.publicacion ? '*' + txt(f.publicacion) + '*' + num + '.' : '') + ' ' + nota
  } else if (f.tipo === 'capitulo') {
    r = cabeza + fin(titulo) + ' ' + (f.publicacion ? 'En *' + txt(f.publicacion) + '*' + (f.paginas ? ' (pp. ' + paginasTxt(f.paginas) + ')' : '') + '. ' : '') + (f.editorial ? fin(txt(f.editorial)) + ' ' : '') + nota
  } else if (f.tipo === 'libro' || f.tipo === 'tesis' || f.tipo === 'informe') {
    const extra = f.edicion ? ' (' + txt(f.edicion) + ' ed.)' : (f.tipo === 'tesis' ? ' [Tesis]' : '')
    const edit = f.editorial && txt(f.editorial) !== autor ? fin(txt(f.editorial)) + ' ' : ''
    r = cabeza + '*' + txt(titulo).replace(/[.]$/, '') + '*' + extra + '. ' + edit + nota
  } else {
    const sitio = f.publicacion && txt(f.publicacion) !== autor ? fin(txt(f.publicacion)) + ' ' : ''
    r = cabeza + '*' + txt(titulo).replace(/[.]$/, '') + '*. ' + sitio + nota
  }
  return txt(r)
}

// Cita en el texto: (Apellido, 2020) · (Apellido y Otro, 2020, p. 5) · (Apellido et al., 2020, pp. 5–7)
export function citaEnTexto(f, pagina) {
  const A = (f.autores || []).filter((a) => a.apellido)
  let quien
  if (!A.length) quien = '*' + (txt(f.titulo).split(/\s+/).slice(0, 4).join(' ') || 'Sin título') + '*'
  else if (A.length === 1) quien = txt(A[0].apellido)
  else if (A.length === 2) quien = txt(A[0].apellido) + ' ' + conjuncion(f) + ' ' + txt(A[1].apellido)
  else quien = txt(A[0].apellido) + ' et al.'
  const pg = pagina == null || pagina === '' ? '' : (/[–-]/.test(String(pagina)) ? ', pp. ' : ', p. ') + String(pagina).replace(/-+/g, '–')
  return '(' + quien + ', ' + anioTxt(f) + pg + ')'
}

// Mismo autor y mismo año → 2020a, 2020b (orden alfabético por título), como pide APA.
export function asignarLetras(fuentes) {
  const grupos = new Map()
  fuentes.forEach((f) => {
    const k = ((f.autores || [])[0] || {}).apellido + '|' + (f.anio || 's. f.')
    ;(grupos.get(k) || grupos.set(k, []).get(k)).push(f)
  })
  for (const g of grupos.values()) {
    g.forEach((f) => { f.letra = '' })
    if (g.length > 1 && g[0].autores && g[0].autores.length) [...g].sort((a, b) => txt(a.titulo).localeCompare(txt(b.titulo), 'es')).forEach((f, i) => { f.letra = String.fromCharCode(97 + i) })
  }
  return fuentes
}

export const claveOrden = (f) => (txt(((f.autores || [])[0] || {}).apellido || f.titulo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '|' + (f.anio || '') + (f.letra || ''))
export function listaDeReferencias(fuentes) {
  asignarLetras(fuentes)
  return [...fuentes].sort((a, b) => claveOrden(a).localeCompare(claveOrden(b), 'es')).map((f) => ({ id: f.id, referencia: referencia(f), cita: citaEnTexto(f) }))
}
export const aHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*([^*]+)\*/g, '<i>$1</i>')
