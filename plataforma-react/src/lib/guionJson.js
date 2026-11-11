// Convierte el guion que devuelve n8n (JSON, un tema) en lo mismo que produce la lectura de un .docx,
// pasándolo por el mismo analizador: así los recursos salen igual que si se hubiera cargado el Word.
import { E } from './engine.js'
import { ubicar } from './ubicar.js'
import { presetPorNivel } from './render.js'

const lim = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
// Lista tolerante: un valor suelto pasa a lista de uno y los vacíos (null) que a veces trae el flujo se descartan.
const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => x != null)

function lineasActividad(act) {
  if (!act) return []
  if (typeof act === 'string') {
    const t = lim(act)
    if (!t) return []
    const i = t.search(/Materiales\s*:/i)
    if (i < 0) return ['Actividad: ' + t]
    return [...(i > 0 ? ['Actividad: ' + t.slice(0, i).trim()] : []), t.slice(i)]
  }
  const o = act
  const pasos = lista(o.pasos).map((p, k) => (k + 1) + ') ' + lim(p)).join(' ')
  const crit = lista(o.criterios).map(lim).filter(Boolean)
  const crits = crit.length > 1 ? crit.slice(0, -1).join(', ') + ' y ' + crit[crit.length - 1] : crit.join('')
  const partes = []
  if (lim(o.materiales)) partes.push('Materiales: ' + lim(o.materiales) + '.')
  if (pasos) partes.push('Pasos: ' + pasos + '.')
  if (lim(o.evidencia)) partes.push('Evidencia: ' + lim(o.evidencia) + '.')
  const pares = lista(o.pares).map((p) => (typeof p === 'string' ? p : lim(p.a) + ' = ' + lim(p.b))).filter(Boolean)
  if (pares.length) partes.push('Pares: ' + pares.join('; ') + '.')
  const cats = lista(o.categorias).map((c) => (typeof c === 'string' ? c : lim(c.nombre) + ' = ' + lista(c.elementos).map(lim).join(', '))).filter(Boolean)
  if (cats.length) partes.push('Categorías: ' + cats.join('; ') + '.')
  if (lim(o.criterio)) partes.push('Criterio de clasificación: ' + lim(o.criterio) + '.')
  const pregs = lista(o.preguntas).map((q) => (typeof q === 'string' ? q : [lim(q.tipo), lim(q.enunciado), lista(q.opciones).map((x) => (typeof x === 'string' ? lim(x) : lim(x.texto) + (x.correcta ? '*' : ''))).join('; '), lim(q.retro)].join(' | '))).filter(Boolean)
  if (pregs.length) partes.push('Preguntas: ' + pregs.join(' ;; ') + '.')
  if (lim(o.tipo)) partes.push('Tipo: ' + lim(o.tipo) + '.')
  if (crits) partes.push('Criterios: ' + crits + '.')
  return [...(lim(o.enunciado) ? ['Actividad: ' + lim(o.enunciado)] : []), ...(partes.length ? [partes.join(' ')] : [])]
}

const palabras = (t, n) => lim(t).split(' ').filter(Boolean).slice(0, n).join(' ')

// El analizador del Word reconoce «Nodo 1: …», «Diapositiva 2: …» o «Etiqueta corta: …». El JSON de n8n trae cada parte con
// un rótulo libre («Inicio», «Paso 2», «Si: Orden público», títulos largos con comas…), así que aquí se le da la forma que
// entiende cada tipo de recurso; si no, el diagrama de flujo queda sin nodos, el mapa sin ramas y la presentación sin diapositivas.
function contenidoALineas(r) {
  const items = lista(r.contenido).filter((c) => lim(c.texto))
  const tipo = E.inferirTipo(r.formato || '') || (/PRES/i.test(r.id || '') ? 'presentacion' : null)
  const rot = (c) => lim(c.rotulo)
  const vis = (c) => (lim(c.visual) ? '[' + lim(c.visual).replace(/[\[\]]/g, ' ') + '] ' : '')
  const sano = (t) => {
    let w = lim(t).replace(/[:.,;]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6)
    while (w.length > 1 && w.join(' ').length > 48) w.pop() // el analizador acepta rótulos de hasta ~50 caracteres
    return w.join(' ')
  }
  const sueltas = []

  if (tipo === 'flujo') {
    const out = []
    let k = 0
    items.forEach((c) => {
      const nota = /^(nota|explicaci|relaciones|prop[oó]sito)/i.exec(rot(c))
      if (nota) { sueltas.push((/^prop/i.test(nota[1]) ? 'Propósito' : 'Explicación') + ': ' + lim(c.texto)); return }
      k++
      const tv = lim(c.texto_visible) || rot(c)
      const m = /^([^:]{1,14}):\s*(.+)$/.exec(tv)
      const rama = m && /^(s[ií]|no)\b/i.test(m[1]) ? m[1].trim() : ''
      const nombre = sano(m ? m[2] : tv)
      out.push('Nodo ' + k + ': ' + vis(c) + nombre + ': ' + lim(c.texto))
      if (rama) out.push('Conexión ' + k + ': ' + rama)
    })
    return [...out, ...sueltas]
  }

  if (tipo === 'mapa') {
    const out = []
    let k = 0
    let hayCentral = false
    items.forEach((c) => {
      const r0 = rot(c)
      if (/^(pregunta|reflexi|relaci[oó]n con el tema|ejemplo|introducci)/i.test(r0)) { sueltas.push(sano(r0) + ': ' + lim(c.texto)); return }
      if (!hayCentral) {
        hayCentral = true
        // «Concepto central» no dice cuál es: se usa el título del recurso, sin dejar una palabra suelta al final al recortarlo.
        const titulo = /^(concepto\s+)?central$/i.test(r0) ? sano(r.titulo || r0).replace(/(\s+(y|e|o|de|del|la|el|los|las|en|con|por|a))+$/i, '') : sano(r0)
        out.push('Concepto central: ' + titulo + ': ' + lim(c.texto))
        return
      }
      k++
      out.push('Nodo ' + k + ': ' + sano(r0) + ': ' + lim(c.texto))
    })
    return [...out, ...sueltas]
  }

  if (tipo === 'presentacion' && !items.some((c) => /^escena\s*\d/i.test(rot(c)))) {
    return items.map((c, k) => 'Diapositiva ' + (k + 1) + ': ' + (sano(rot(c)) ? sano(rot(c)) + ': ' : '') + lim(c.texto))
  }

  const ITEM = /^(escena|nodo|conexi[oó]n|bloque|diapositiva|slide|paso|secci[oó]n|apartado|elemento)\s*\d+\s*[:.\-–—]/i
  return items.map((c) => {
    const r0 = rot(c)
    if (!r0) return lim(c.texto)
    const etiqueta = r0.split(':')[0]
    const inservible = /[.,;]/.test(etiqueta) || etiqueta.split(/\s+/).length > 8 || etiqueta.length > 70
    return (inservible && !ITEM.test(r0 + ':') ? sano(r0) : r0) + ': ' + lim(c.texto)
  })
}

export function guionAPendiente(a) {
  const i = a.info || {}
  const g = a.guion || {}
  const filas = [['Campo', 'Valor'], ['Programa', i.programa], ['Nivel de formación', i.nivel], ['Nombre de la asignatura', i.asignatura],
    ['Resultado de aprendizaje', i.resultado], ['Indicadores de logro del tema', i.indicadores], ['Horas estimadas del tema', i.horas]]
    .filter((f, k) => k === 0 || lim(f[1])).map((f) => [f[0], lim(f[1])])
  const bloques = [{ t: 'table', rows: filas }]
  const rs = [g.presentacion, ...lista(g.recursos)].filter(Boolean)
  rs.forEach((r) => {
    const clase = /OV([AI])/i.exec(r.tipo || '') || /OV([AI])/i.exec(r.id || '')
    bloques.push({ t: 'p', text: lim(r.id) + ' ' + lim(r.formato || r.titulo) + (clase ? ' (' + clase[0].toUpperCase() + ')' : ''), style: '' })
    if (lim(r.titulo)) bloques.push({ t: 'p', text: lim(r.titulo), style: 'Titulo1' })
    contenidoALineas(r).forEach((t) => bloques.push({ t: 'p', text: t, style: '' }))
    lineasActividad(r.actividad).forEach((t) => bloques.push({ t: 'p', text: t, style: '' }))
  })
  const out = E.analizar(bloques)
  out.recursos.forEach((r) => {
    const fuente = rs.find((x) => lim(x.id) === r.codigo)
    const desc = lim(fuente && fuente.descripcion)
    if (desc && !r.tecnica.texto) {
      r.tecnica.texto = desc
      const d = desc.match(/(\d+)\s*(minutos?|p[aá]ginas?)/i)
      if (d) r.tecnica.duracion = d[1] + ' ' + d[2].toLowerCase()
    }
  })
  return { nombre: a.nombre, info: out.info, recursos: out.recursos }
}

// Resultado listo para guardar en el syllabus: recursos con su unidad y tema, y la información del tema.
export function recursosDeGuion(a, unidad, uid, temaBase) {
  const p = guionAPendiente(a)
  const info = p.info
  const grado = presetPorNivel((info.programa || '') + ' ' + (info.nivel_de_formacion || ''))
  const recursos = p.recursos.map((r) => {
    const u = ubicar(r.codigo)
    const numTema = u.tema != null ? u.tema : (r.clase === 'PRES' ? null : (a.tema != null ? Number(a.tema) : null))
    return {
      id: uid(), tipo: r.tipo, codigo: r.codigo, clase: r.clase, nombre: r.nombre, unidad, numTema,
      datos: E.datosDe(r, info), tema: temaBase(grado), avisos: r.avisos, sinUbicar: r.sinUbicar, tecnica: r.tecnica.texto,
      actividadOculta: false, guionOrigen: a.nombre
    }
  })
  const tema = a.tema != null && Number.isFinite(Number(a.tema)) ? {
    numTema: Number(a.tema),
    info: {
      resultado: info.resultado_de_aprendizaje || '', indicadores: info.indicadores_de_logro_del_tema || '',
      horas: info.horas_estimadas_del_tema || '', guion: a.nombre
    }
  } : null
  return { recursos, info, tema, nombreTema: a.nombre_tema || '' }
}
