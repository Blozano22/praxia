// Verificación de las citas de un recurso contra el texto REAL de las fuentes que la plataforma envió.
//
// Problema que corrige (ejecución 372267 de producción): el modelo justificaba cada fuente por su TÍTULO
// («El título de U2-B2 aborda el plan estratégico institucional…») y el nodo «Armar guion» aceptaba la cita solo
// porque el ID existía. Una fuente del Syllabus correcto quedaba citada en recursos que no respalda.
//
// Regla: una fuente queda citada en un recurso SOLO si el sustento trae, para ese ID, una página y una cita textual
// («…») que aparece literalmente en el extracto de esa página que la plataforma entregó para la unidad. No se usa
// parecido de palabras ni el título. Lo que no se pueda comprobar no se asigna: queda como PENDIENTE.
//
// Límite que conviene tener presente: el código comprueba que la cita existe en la fuente y que la fuente es de
// ESTA unidad; que el pasaje respalde de verdad la idea del recurso lo confirma una persona (el guion lo dice).
//
// Sin dependencias: se pega tal cual dentro de un nodo Code de n8n y también se importa en las pruebas.

const MIN_FRAGMENTO = 20 // caracteres (normalizados) que debe tener cada trozo literal de una cita
const MIN_CITA = 40 // caracteres (normalizados) que debe sumar toda la cita

// Une las palabras cortadas con guion al final de línea («custo-\ndia»), descompone ligaduras (NFKD) y quita tildes y signos.
const normalizarTexto = (s) => String(s || '').replace(/(\p{L})[-­]\s*\n\s*(\p{L})/gu, '$1$2').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim()

const RE_ID = /\bU\d{1,2}-[BC]\d{1,3}\b/g
// «u2 - b01» → «U2-B1»: el modelo a veces escribe el ID con espacios, minúsculas o ceros.
const idCanonico = (t) => String(t || '').replace(/\bU\s*(\d{1,2})\s*[-–]\s*([BCbc])\s*0*(\d{1,3})\b/gi, (m, u, c, n) => 'U' + u + '-' + c.toUpperCase() + n)
const RE_PAGINA = /\b(?:pp?|p[áa]gs?|p[áa]gina)\.?\s*(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?/gi
const RE_CITA = /«([^»]{1,3000})»|“([^”]{1,3000})”|"([^"]{1,3000})"|‘([^’]{1,3000})’/g
const RE_CORTE = /\[\s*(?:…|\.\.\.)\s*\]|…|\.\.\./

// Trozos del sustento que hablan de cada ID: desde su mención hasta la siguiente mención de otro ID.
function segmentosPorId(sustento) {
  const s = String(sustento || '')
  const marcas = [...s.matchAll(RE_ID)].map((m) => ({ id: m[0], i: m.index }))
  const porId = {}
  const trozos = marcas.map((m, k) => s.slice(m.i + m.id.length, k + 1 < marcas.length ? marcas[k + 1].i : s.length))
  // «U2-B1 y U2-C3, p. 14: «…»»: el ID que solo trae separadores comparte el sustento del siguiente.
  for (let k = trozos.length - 2; k >= 0; k--) if (/^[\s,;&/]*(?:(?:y|e|and)[\s,;&/]*)?$/i.test(trozos[k])) trozos[k] += ' ' + trozos[k + 1]
  marcas.forEach((m, k) => { porId[m.id] = (porId[m.id] || '') + ' ' + trozos[k] })
  return porId
}

function paginasDe(segmento) {
  const salida = []
  for (const m of segmento.matchAll(RE_PAGINA)) {
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    for (let p = a; p <= b && p - a < 20; p++) salida.push(p)
  }
  return [...new Set(salida)]
}

const citasDe = (segmento) => [...segmento.matchAll(RE_CITA)].map((m) => (m[1] || m[2] || m[3] || m[4] || '').trim()).filter(Boolean)

// ¿La cita aparece literal (sin tildes, mayúsculas ni signos) en alguno de los textos? Una cita con «[…]» se comprueba trozo a trozo.
function citaEnTextos(cita, textos) {
  const trozos = cita.split(RE_CORTE).map(normalizarTexto).filter(Boolean)
  const total = trozos.reduce((a, t) => a + t.length, 0)
  if (!trozos.length || total < MIN_CITA || trozos.some((t) => t.length < MIN_FRAGMENTO)) return 'cita_corta'
  const hay = textos.some((t) => trozos.every((z) => t.includes(z)))
  return hay ? 'ok' : 'cita_no_encontrada'
}

// ---- Correspondencia temática ----
// Que la cita exista en la fuente NO prueba que la fuente respalde el recurso (el modelo puede copiar un pasaje real pero de
// otro asunto: p. ej. la cadena de custodia de la prueba DIGITAL para un recurso sobre evidencia FÍSICA). Por eso, cuando se
// conocen los subtemas que el recurso declara cubrir (vienen del Syllabus/unidad, no del modelo), la cita debe contener un
// concepto de ESE subtema: una frase suya (2 o más palabras de contenido seguidas, p. ej. «cadena de custodia», «evidencia
// física») o, si el subtema es una enumeración de palabras sueltas, al menos TRES de ellas.
// Es una condición NECESARIA para asignar, no una prueba de pertinencia: lo que la cumple queda «por_confirmar» por una persona.
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'para', 'con', 'sobre', 'al', 'a', 'por', 'un', 'una', 'su', 'sus', 'como', 'entre', 'que', 'se', 'lo'])
const MIN_SUELTAS = 3
const raizToken = (t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t)
const tokensDe = (t) => normalizarTexto(t).split(' ').filter(Boolean).map(raizToken)
const esContenido = (t) => !VACIAS.has(t) && t.length > 2

function anclasDeSubtemas(subtemas) {
  const frases = new Set()
  const sueltas = new Set()
  for (const sub of subtemas || []) {
    const limpio = String(sub || '').replace(/^\s*\d+\s*[.)]\s*/, '') // «1. Registro de…» → «Registro de…»
    for (const seg of limpio.split(/[,;:()/]|\s[yeo]\s/i)) {
      const tk = tokensDe(seg)
      const contenido = tk.filter(esContenido)
      if (contenido.length === 1) sueltas.add(contenido[0])
      else if (contenido.length >= 2) {
        for (let i = 0; i < tk.length; i++) {
          if (!esContenido(tk[i])) continue
          let n = 0
          for (let j = i; j < tk.length; j++) { if (esContenido(tk[j])) n++; if (esContenido(tk[j]) && n >= 2) frases.add(tk.slice(i, j + 1).join(' ')) }
        }
      }
    }
  }
  return { frases: [...frases], sueltas: [...sueltas] }
}

function correspondeAlSubtema(cita, anclas) {
  const q = ' ' + tokensDe(cita).join(' ') + ' '
  const frase = anclas.frases.filter((f) => q.includes(' ' + f + ' ')).sort((a, b) => b.length - a.length)[0]
  if (frase) return { ok: true, ancla: frase }
  const sueltas = anclas.sueltas.filter((w) => q.includes(' ' + w + ' '))
  if (sueltas.length >= MIN_SUELTAS) return { ok: true, ancla: sueltas.join(', ') }
  return { ok: false }
}

// ids: IDs que el modelo declaró para el recurso. sustento: su texto. entradas: bibliografia.entradas de ESTE tema
// (cada una con id y extractos [{pagina, texto}]). unidad: número de la unidad que se está escribiendo.
// subtemas (opcional pero recomendado): subtemas que el recurso cubre; activa la exigencia de correspondencia temática.
function verificarCitas({ ids, sustento, entradas, unidad, subtemas }) {
  const anclas = Array.isArray(subtemas) && subtemas.length ? anclasDeSubtemas(subtemas) : null
  const porId = Object.fromEntries((entradas || []).map((e) => [e.id, e]))
  sustento = idCanonico(sustento)
  ids = (ids || []).map(idCanonico)
  const segmentos = segmentosPorId(sustento)
  const aceptadas = []
  const descartadas = []
  const descarta = (id, motivo, detalle) => descartadas.push({ id, motivo, detalle: detalle || null })

  for (const id of [...new Set((ids || []).map((x) => String(x).trim()).filter(Boolean))]) {
    const delaUnidad = /^U(\d{1,2})-/.exec(id)
    if (delaUnidad && unidad !== undefined && unidad !== null && Number(delaUnidad[1]) !== Number(unidad)) { descarta(id, 'otra_unidad', 'El ID es de la unidad ' + delaUnidad[1] + ' y se está escribiendo la ' + unidad + '.'); continue }
    const entrada = porId[id]
    if (!entrada) { descarta(id, 'id_inexistente', 'No está en la bibliografía enviada para esta unidad.'); continue }
    const extractos = Array.isArray(entrada.extractos) ? entrada.extractos : []
    if (!extractos.length) { descarta(id, 'fuente_sin_texto', 'La plataforma no entregó texto de esta fuente para el tema: no hay con qué comprobar la cita.'); continue }
    const seg = segmentos[id]
    if (!seg) { descarta(id, 'sin_sustento', 'El sustento no menciona esta fuente.'); continue }
    const citas = citasDe(seg)
    if (!citas.length) { descarta(id, 'sin_cita_textual', /t[ií]tulo/i.test(String(sustento || '')) ?'Se respaldó por el título de la fuente, no por su contenido.' : 'El sustento no trae una cita textual de la fuente.'); continue }
    const paginas = paginasDe(seg)
    if (!paginas.length) { descarta(id, 'sin_pagina', 'La cita no indica la página del extracto.'); continue }
    const delasPaginas = extractos.filter((x) => paginas.includes(Number(x.pagina)))
    if (!delasPaginas.length) { descarta(id, 'pagina_no_entregada', 'La página citada (' + paginas.join(', ') + ') no está entre los extractos entregados.'); continue }
    const textos = delasPaginas.map((x) => normalizarTexto(x.texto))
    if (delasPaginas.length > 1) textos.push(normalizarTexto(delasPaginas.map((x) => x.texto).join(' '))) // una cita puede cruzar de una página citada a otra
    let motivo = 'cita_no_encontrada'
    let hallada = null
    let ancla = null
    for (const c of citas) {
      const r = citaEnTextos(c, textos)
      if (r === 'cita_corta') { if (motivo === 'cita_no_encontrada') motivo = 'cita_corta'; continue }
      if (r !== 'ok') continue
      if (anclas) {
        const t = correspondeAlSubtema(c, anclas)
        if (!t.ok) { motivo = 'sin_correspondencia_tematica'; continue }
        ancla = t.ancla
      }
      hallada = c
      break
    }
    if (!hallada) {
      const detalles = {
        cita_corta: 'La cita es demasiado corta para comprobarse (mínimo ' + MIN_CITA + ' caracteres).',
        cita_no_encontrada: 'La cita no aparece en el extracto de esa página.',
        sin_correspondencia_tematica: 'El pasaje existe en la fuente, pero no trata ningún concepto del subtema que cubre el recurso («' + (subtemas || []).join('»; «') + '»): no se asigna.'
      }
      descarta(id, motivo, detalles[motivo]); continue
    }
    // La página es la del extracto donde se encontró la cita (no necesariamente la primera que el modelo nombró).
    const nc = normalizarTexto(hallada.split(RE_CORTE)[0])
    const dondeEsta = delasPaginas.find((x) => normalizarTexto(x.texto).includes(nc)) || delasPaginas[0]
    // «por_confirmar»: el código comprobó la cita y la correspondencia con el subtema; que respalde la idea del recurso lo confirma una persona.
    aceptadas.push({ id, pagina: dondeEsta.pagina, cita: hallada, ancla, estado: 'por_confirmar' })
  }
  return { ids: aceptadas.map((a) => a.id), aceptadas, descartadas, pendiente: aceptadas.length === 0, confirmacion_humana: aceptadas.length > 0 }
}
