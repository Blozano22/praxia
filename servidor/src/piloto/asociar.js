// «Curso piloto»: asociación carpeta raíz → Syllabus → unidades → documento de unidad ↔ guiones. Puro (sin red ni base de datos).
// Reglas determinísticas por número de unidad; todo lo que no sea único se reporta como ambiguo y NO se asigna. Nunca se elige al azar.
import { normCat } from './catalogo.js'
import { leerUnidad } from './unidad.js'
import { leerGuion, nombreDeGuion } from './guion.js'
import { leerSyllabus, RE_FORMACION } from './syllabus.js'
import { textoDeBloques } from './documento.js'

export const RE_CARPETA_UNIDAD = /^guiones u ?(\d{1,3})\b/
const RE_NOMBRE_SYLLABUS = /syllabus|silabo|syllabo/
const urlDoc = (id) => 'https://docs.google.com/document/d/' + id + '/edit'

export const carpetaDe = (e) => ({ id: e.id, nombre: e.nombre, url: e.url || 'https://drive.google.com/drive/folders/' + e.id })
export function docDe(e, estado = 'leido', motivo = null) {
  return { id: e.id, nombre: e.nombre, url: e.tipo === 'doc' ? urlDoc(e.id) : e.url || null, tipo: e.tipo === 'doc' ? 'doc' : e.tipo === 'docx' ? 'docx' : 'otro', estado, motivo }
}

// ---- Raíz --------------------------------------------------------------------------------------------------------------------
export function clasificarRaiz(entradas) {
  const r = { syllabus: [], carpetasUnidad: new Map(), otrasCarpetas: [], docs: [], otros: [] }
  for (const e of entradas) {
    if (e.tipo === 'carpeta') {
      const m = RE_CARPETA_UNIDAD.exec(normCat(e.nombre))
      if (m) { const n = Number(m[1]); if (!r.carpetasUnidad.has(n)) r.carpetasUnidad.set(n, []); r.carpetasUnidad.get(n).push(e) } else r.otrasCarpetas.push(e)
    } else if (e.tipo === 'doc') {
      if (RE_NOMBRE_SYLLABUS.test(normCat(e.nombre))) r.syllabus.push(e)
      else r.docs.push(e)
    } else r.otros.push(e)
  }
  return r
}

// ---- Documento ---------------------------------------------------------------------------------------------------------------
// Clasifica POR CONTENIDO (el nombre solo desempata): unidad = leerUnidad da número y ≥1 tabla de tema; guion = nombre Guion_U#_T# o ≥1 código U#-T#-R# en una fila «Código…»
// y no es unidad; cumple ambos o ninguno → no_reconocido (salvo un Syllabus: unidades «Unidad Nro. N» y la frase «nivel de formación»).
export function clasificarDocumento(entrada, bloques) {
  const unidad = leerUnidad(bloques)
  const guion = leerGuion(bloques, entrada.nombre)
  const syllabus = leerSyllabus(bloques, entrada.nombre)
  const esUnidad = unidad.numero !== null && unidad.temas.length >= 1
  const esGuion = !!nombreDeGuion(entrada.nombre) || guion.codigos_en_filas
  let tipo = 'no_reconocido'
  let motivo = 'No es un documento de unidad, ni un guion, ni el Syllabus.'
  if (esUnidad && esGuion) motivo = 'Parece a la vez documento de unidad y guion.'
  else if (esUnidad) { tipo = 'unidad'; motivo = null } else if (esGuion) { tipo = 'guion'; motivo = null } else if (syllabus.unidades.length >= 1 && RE_FORMACION.test(textoDeBloques(bloques))) { tipo = 'syllabus'; motivo = null }
  return { tipo, unidad, guion, syllabus, motivo }
}

// Lectura de una entrada: lo leído y su clasificación, o el motivo por el que no se pudo leer.
export function crearLectura(entrada, bloques, error = null) {
  if (entrada.tipo !== 'doc') {
    const motivo = 'formato_no_soportado'
    return { entrada, doc: docDe(entrada, 'ilegible', motivo), clase: null, unidad: null, guion: null, syllabus: null, motivoClase: entrada.tipo === 'docx' ? 'Archivo .docx subido: conviértalo a Google Docs.' : 'No es un Google Doc.' }
  }
  if (error) return { entrada, doc: docDe(entrada, 'ilegible', error), clase: null, unidad: null, guion: null, syllabus: null, motivoClase: MOTIVO_LECTURA[error] || 'No se pudo leer el documento.' }
  const c = clasificarDocumento(entrada, bloques)
  return { entrada, doc: docDe(entrada), clase: c.tipo, unidad: c.unidad, guion: c.guion, syllabus: c.syllabus, motivoClase: c.motivo }
}
export const MOTIVO_LECTURA = {
  no_publico: 'El documento no está compartido con «Cualquier persona con el enlace».',
  demasiado_grande: 'El documento es demasiado grande.',
  tiempo: 'El documento tardó demasiado en descargarse.',
  tope_documentos: 'Se alcanzó el tope de documentos por análisis.',
  formato_no_soportado: 'Formato no soportado.',
  error: 'No se pudo descargar el documento.'
}

// ---- Syllabus ----------------------------------------------------------------------------------------------------------------
// lecturasRaiz: Map id → Lectura de los Google Docs de la raíz (los candidatos por nombre y los demás).
export function resolverSyllabus(raiz, lecturasRaiz) {
  let candidatas = raiz.syllabus.map((e) => lecturasRaiz.get(e.id)).filter(Boolean)
  if (!candidatas.length) candidatas = raiz.docs.map((e) => lecturasRaiz.get(e.id)).filter((l) => l && l.clase === 'syllabus')
  const problemas = []
  const base = { documento: null, candidatos: candidatas.map((l) => l.doc), unidades: [], lectura: null }
  if (!candidatas.length) {
    problemas.push({ tipo: 'falta', unidad: null, codigo: null, mensaje: 'No se encontró el Syllabus en la carpeta raíz (un Google Doc con «Syllabus» en el nombre).', candidatos: [] })
    return { ...base, estado: 'falta', candidatos: [], problemas }
  }
  if (candidatas.length > 1) {
    problemas.push({ tipo: 'ambiguo', unidad: null, codigo: null, mensaje: 'Hay más de un posible Syllabus en la carpeta raíz: no se usa ninguno. Deje uno solo.', candidatos: candidatas.map((l) => l.doc) })
    return { ...base, estado: 'ambiguo', problemas }
  }
  const l = candidatas[0]
  if (l.doc.estado === 'ilegible') {
    problemas.push({ tipo: 'ilegible', unidad: null, codigo: null, mensaje: 'No se pudo leer el Syllabus: ' + (MOTIVO_LECTURA[l.doc.motivo] || ''), candidatos: [l.doc] })
    return { ...base, estado: 'ilegible', documento: l.doc, candidatos: [], problemas }
  }
  return { ...base, estado: 'encontrado', documento: l.doc, candidatos: [], unidades: l.syllabus.unidades, lectura: l, problemas }
}

// ---- Unidades ----------------------------------------------------------------------------------------------------------------
const PROBLEMA = (tipo, unidad, mensaje, candidatos = [], codigo = null) => ({ tipo, unidad, codigo, mensaje, candidatos })
const BLOQUEANTES = new Set(['falta', 'ambiguo', 'discrepancia', 'ilegible'])
const unidadVacia = (numero, nombre, enSyllabus) => ({
  numero, nombre, en_syllabus: enSyllabus, estado: 'sin_carpeta', carpeta: null, carpetas_candidatas: [], documento_unidad: null, documento_unidad_candidatos: [],
  guiones: [], no_reconocidos: [], temas: [], presentacion: null, recursos: [], actividades: [], conteo: null, problemas: []
})

// raiz: clasificarRaiz(); syllabus: resolverSyllabus(); docsPorCarpeta: Map número → Lectura[] (solo carpetas únicas); docsRaizLeidos: Lectura[] de los Docs de la raíz.
export function asociar({ raiz, syllabus, docsPorCarpeta, docsRaizLeidos }) {
  const problemas = [...syllabus.problemas]
  const raizUnidad = new Map() // número → Lectura[] de documentos de unidad en la raíz
  for (const l of docsRaizLeidos) if (l.clase === 'unidad' && l.unidad.numero !== null) { const n = l.unidad.numero; if (!raizUnidad.has(n)) raizUnidad.set(n, []); raizUnidad.get(n).push(l) }
  const enSyllabus = new Map(syllabus.unidades.map((x) => [x.numero, x.nombre]))
  const numeros = [...new Set([...enSyllabus.keys(), ...raiz.carpetasUnidad.keys(), ...raizUnidad.keys()])].sort((a, b) => a - b)
  const internos = new Map()
  const unidades = []
  const carpetas_sobrantes = []
  for (const n of numeros) {
    const u = unidadVacia(n, enSyllabus.get(n) || null, enSyllabus.has(n))
    const interno = { lecturaUnidad: null, guiones: [] }
    internos.set(n, interno)
    unidades.push(u)
    const carpetas = raiz.carpetasUnidad.get(n) || []
    if (syllabus.estado === 'encontrado' && !enSyllabus.has(n)) {
      if (carpetas.length) carpetas.forEach((c) => carpetas_sobrantes.push({ ...carpetaDe(c), numero: n }))
      u.problemas.push(PROBLEMA('discrepancia', n, 'La unidad ' + n + ' no está en el Syllabus' + (carpetas.length ? ' (hay una carpeta «Guiones U' + n + '»).' : ' (hay un documento de unidad en la raíz).'), carpetas.map(carpetaDe)))
    }
    if (carpetas.length > 1) {
      u.estado = 'ambigua'; u.carpetas_candidatas = carpetas.map(carpetaDe)
      u.problemas.push(PROBLEMA('ambiguo', n, 'Hay ' + carpetas.length + ' carpetas «Guiones U' + n + '»: no se asigna nada en esta unidad. Mueva las antiguas a otra carpeta y vuelva a analizar.', u.carpetas_candidatas))
      continue
    }
    const lecturas = carpetas.length ? (docsPorCarpeta.get(n) || []) : []
    if (carpetas.length) u.carpeta = carpetaDe(carpetas[0])
    // documentos de la carpeta
    const deUnidad = []
    const deGuion = []
    for (const l of lecturas) {
      if (l.doc.estado === 'ilegible') {
        u.no_reconocidos.push({ ...l.doc, motivo: l.motivoClase })
        u.problemas.push(PROBLEMA(l.entrada.tipo === 'doc' ? 'ilegible' : 'no_reconocido', n, '«' + l.doc.nombre + '»: ' + l.motivoClase, [l.doc]))
      } else if (l.clase === 'unidad') deUnidad.push(l)
      else if (l.clase === 'guion') deGuion.push(l)
      else { u.no_reconocidos.push({ ...l.doc, motivo: l.motivoClase }); u.problemas.push(PROBLEMA('no_reconocido', n, '«' + l.doc.nombre + '» no se reconoció: ' + l.motivoClase, [l.doc])) }
    }
    // documento de unidad
    const iguales = deUnidad.filter((l) => l.unidad.numero === n)
    for (const l of deUnidad.filter((x) => x.unidad.numero !== n)) {
      u.no_reconocidos.push({ ...l.doc, motivo: 'Dice UNIDAD ' + l.unidad.numero + ' pero está en la carpeta de la unidad ' + n + '.' })
      u.problemas.push(PROBLEMA('discrepancia', n, 'La carpeta es «Guiones U' + n + '» pero el documento «' + l.doc.nombre + '» dice UNIDAD ' + l.unidad.numero + '.', [l.doc]))
    }
    let elegida = null
    let origen = null
    if (iguales.length > 1) {
      u.estado = 'ambigua'; u.documento_unidad_candidatos = iguales.map((l) => l.doc)
      u.problemas.push(PROBLEMA('ambiguo', n, 'Hay ' + iguales.length + ' documentos de la unidad ' + n + ' en la carpeta: no se asigna nada en esta unidad.', u.documento_unidad_candidatos))
    } else if (iguales.length === 1) { elegida = iguales[0]; origen = 'carpeta' } else {
      const enRaiz = raizUnidad.get(n) || []
      if (enRaiz.length === 1) { elegida = enRaiz[0]; origen = 'raiz' } else if (enRaiz.length > 1) {
        u.estado = 'ambigua'; u.documento_unidad_candidatos = enRaiz.map((l) => l.doc)
        u.problemas.push(PROBLEMA('ambiguo', n, 'Hay ' + enRaiz.length + ' documentos de la unidad ' + n + ' en la raíz: no se asigna nada en esta unidad.', u.documento_unidad_candidatos))
      } else if (carpetas.length) u.problemas.push(PROBLEMA('falta', n, 'No se encontró el documento de la unidad ' + n + ' (ni en la carpeta ni en la raíz).'))
      else u.problemas.push(PROBLEMA('falta', n, 'No hay carpeta «Guiones U' + n + '» ni documento de la unidad ' + n + ' en la raíz.'))
    }
    // guiones por tema
    const porTema = new Map()
    for (const l of deGuion) {
      const g = l.guion
      const doc = { ...l.doc, tema: g.tema, codigos: g.codigos.map((c) => c.codigo), ids_en_guion: Object.fromEntries(g.codigos.filter((c) => c.id_en_guion).map((c) => [c.codigo, c.id_en_guion])), actividades: g.actividades, estructurado: g.estructurado }
      for (const d of g.discrepancias) u.problemas.push(PROBLEMA('discrepancia', n, '«' + l.doc.nombre + '»: ' + d, [l.doc]))
      if (g.unidad !== null && g.unidad !== n) { u.problemas.push(PROBLEMA('discrepancia', n, 'El guion «' + l.doc.nombre + '» es de la unidad ' + g.unidad + ' y está en la carpeta de la unidad ' + n + ': no se asocia.', [l.doc])); u.no_reconocidos.push({ ...l.doc, motivo: 'Es de la unidad ' + g.unidad + '.' }); continue }
      if (g.tema === null) { u.no_reconocidos.push({ ...l.doc, motivo: 'No se pudo saber el tema del guion.' }); u.problemas.push(PROBLEMA('no_reconocido', n, 'No se pudo saber el tema del guion «' + l.doc.nombre + '».', [l.doc])); continue }
      if (!porTema.has(g.tema)) porTema.set(g.tema, [])
      porTema.get(g.tema).push({ lectura: l, doc, tema: g.tema, codigos: g.codigos })
    }
    const unicos = new Map()
    for (const [t, lista] of [...porTema].sort((a, b) => a[0] - b[0])) {
      if (lista.length > 1) u.problemas.push(PROBLEMA('ambiguo', n, 'Hay ' + lista.length + ' guiones para el tema ' + t + ': el tema queda sin guion asociado.', lista.map((x) => x.doc)))
      else unicos.set(t, lista[0])
      lista.forEach((x) => u.guiones.push(x.doc))
    }
    interno.guiones = [...unicos.values()]
    if (u.estado === 'ambigua') continue
    if (!elegida) { u.estado = carpetas.length ? 'sin_documento_unidad' : 'sin_carpeta'; interno.guiones = [...unicos.values()]; continue }
    interno.lecturaUnidad = elegida
    u.documento_unidad = { ...elegida.doc, origen }
    if (!u.nombre && elegida.unidad.nombre) u.nombre = elegida.unidad.nombre
    u.temas = elegida.unidad.temas.map((t) => ({ numero: t.numero, nombre: t.nombre, guion_id: unicos.has(t.numero) ? unicos.get(t.numero).doc.id : null }))
    if (carpetas.length) for (const t of u.temas) if (!t.guion_id && !porTema.has(t.numero)) u.problemas.push(PROBLEMA('falta', n, 'El tema ' + t.numero + ' no tiene guion en la carpeta (no bloquea la asignación).'))
    if (!carpetas.length) u.problemas.push(PROBLEMA('falta', n, 'Sin carpeta «Guiones U' + n + '»: la unidad se analiza solo con el documento de la raíz.'))
    u.estado = 'incompleta'
  }
  const raiz_no_reconocidos = []
  for (const l of docsRaizLeidos) {
    if (l.clase === 'unidad' || l.clase === 'syllabus') continue
    raiz_no_reconocidos.push({ ...l.doc, motivo: l.doc.motivo || l.motivoClase })
  }
  for (const e of raiz.otros) raiz_no_reconocidos.push({ ...docDe(e, 'ilegible', 'formato_no_soportado'), motivo: e.tipo === 'docx' ? 'Archivo .docx subido: conviértalo a Google Docs.' : 'No es un Google Doc.' })
  return { unidades, problemas, carpetas_sobrantes, raiz_no_reconocidos, internos }
}

// Unidad con documento y sin problemas bloqueantes (y con su carpeta) → «completa»; con algún problema → «incompleta». Las demás conservan su estado.
export function estadoFinal(u) {
  if (!u.documento_unidad || u.estado === 'ambigua') return u.estado
  return u.carpeta && !u.problemas.some((p) => BLOQUEANTES.has(p.tipo)) ? 'completa' : 'incompleta'
}

// Cruza los recursos del documento de unidad con los guiones ya asociados (uno por tema). Solo el ID puede bloquear: si la base del ID del guion (G-09 de G-09-A)
// difiere de la categoría calculada del documento, no se sabe cuál es el correcto y el recurso NO se asigna; si solo difiere el sufijo -A/-C, es un aviso.
export function cruzarGuiones(u, guiones) {
  const porTema = new Map(guiones.map((g) => [g.tema, g]))
  const codigosDoc = new Set(u.recursos.map((r) => r.codigo))
  for (const r of [...u.recursos, ...u.actividades]) { const g = porTema.get(r.tema); r.guion_id = g ? g.doc.id : null }
  for (const r of u.recursos) {
    const g = porTema.get(r.tema)
    const c = g && g.codigos.find((x) => x.codigo === r.codigo)
    if (!c || !c.id_en_guion) continue
    r.id_en_guion = c.id_en_guion
    const base = /^((?:G|PRE|POS)-\d{2})/.exec(c.id_en_guion)
    if (!r.categoria || !base) continue
    if (base[1] !== r.id_base) {
      if (!r.estado) { r.estado = 'sin_asignar'; r.motivo = 'id_discrepante' }
      r.aviso = 'El documento de la unidad da ' + r.id_catalogo + ' y el guion dice ' + c.id_en_guion + ': no se sabe cuál es el correcto.'
      u.problemas.push(PROBLEMA('discrepancia', u.numero, r.codigo + ': ' + r.aviso, [], r.codigo))
    } else if (c.id_en_guion !== r.id_catalogo) r.aviso = 'El guion dice ' + c.id_en_guion + ' y el documento de la unidad ' + r.id_catalogo + ' (solo cambia -A/-C); se usa la categoría del documento.'
  }
  for (const g of guiones) for (const c of g.codigos) if (!codigosDoc.has(c.codigo)) u.problemas.push(PROBLEMA('discrepancia', u.numero, 'El guion «' + g.doc.nombre + '» trae ' + c.codigo + ' y el documento de la unidad no tiene ese recurso.', [g.doc], c.codigo))
}

// Unidad sin documento de unidad: se listan los recursos que traen los guiones, todos sin asignar (sin el documento no se conocen EVALUACIONES, actividades ni formato).
export function recursosDeGuiones(numero, guiones) {
  const salida = []
  for (const g of guiones) for (const c of g.codigos) {
    const m = /^U\d+-T(\d+)-R(\d+)$/.exec(c.codigo)
    salida.push({
      codigo: c.codigo, clase: 'recurso', tema: Number(m[1]), posicion: Number(m[2]), formato: null, nombre: null, titulo: null, con_actividad: null, calificable: null,
      categoria: null, id_base: null, id_catalogo: null, fuente_categoria: null, tipo_produccion: null, id_en_guion: c.id_en_guion, guion_id: g.doc.id,
      detectado_en: 'guion', estado: 'sin_asignar', motivo: 'falta_documento_unidad', aviso: null, variante: null
    })
  }
  return salida.sort((a, b) => a.tema - b.tema || a.posicion - b.posicion)
}
