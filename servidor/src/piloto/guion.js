// «Curso piloto»: lectura de un guion. Los crea el flujo de guiones: un Google Doc por tema llamado «Guion_U{u}_T{t}» dentro de la carpeta «Guiones U{u} - …»;
// cada recurso lleva la fila «Código del recurso» con «U1-T2-R3 · G-09-A».
import { aplanar, textoDeBloques } from './documento.js'
import { normCat } from './catalogo.js'

export const RE_NOMBRE_GUION = /^guion[\s_-]*u\s*(\d{1,3})[\s_-]*t\s*(\d{1,2})(?!\d)/ // sobre normCat sin espacios del nombre
export const RE_CODIGO_GUION = /\bU(\d{1,3})-T(\d{1,2})-R(\d{1,3})\b(?:\s*[·•\-–]\s*((?:G|PRE|POS)-\d{2}(?:-[AC])?))?/g

export const nombreDeGuion = (nombre) => {
  const m = RE_NOMBRE_GUION.exec(normCat(nombre).replace(/\s+/g, ''))
  return m ? { unidad: Number(m[1]), tema: Number(m[2]) } : null
}

function codigosEn(texto, salida) {
  const re = new RegExp(RE_CODIGO_GUION.source, 'g')
  let m
  while ((m = re.exec(texto))) {
    const codigo = 'U' + Number(m[1]) + '-T' + Number(m[2]) + '-R' + Number(m[3])
    if (!salida.has(codigo)) salida.set(codigo, { codigo, id_en_guion: m[4] || null })
    else if (!salida.get(codigo).id_en_guion && m[4]) salida.get(codigo).id_en_guion = m[4]
  }
}

export function leerGuion(bloques, nombre = '') {
  const codigos = new Map()
  let enFilas = false
  let tienePresentacion = false
  const filasCodigo = []
  for (const b of bloques) {
    if (b.tipo !== 'tabla') continue
    for (const f of b.filas) if (normCat(f[0]).startsWith('codigo')) filasCodigo.push(f.slice(1).map(aplanar).join(' '))
  }
  for (const t of filasCodigo) { codigosEn(t, codigos) }
  if (codigos.size) enFilas = true
  else codigosEn(textoDeBloques(bloques), codigos)
  for (const t of filasCodigo) {
    if (!new RegExp(RE_CODIGO_GUION.source).test(t) && /\b(?:G-00|G-1[345])\b/.test(t)) tienePresentacion = true
  }
  const texto = textoDeBloques(bloques)
  if (/recurso de presentaci[oó]n/i.test(texto)) tienePresentacion = true
  const actividades = texto.split('\n').filter((l) => normCat(l).startsWith('actividad de autoaprendizaje')).length

  const delNombre = nombreDeGuion(nombre)
  const lista = [...codigos.values()]
  const unidades = new Set(lista.map((c) => Number(/^U(\d+)-/.exec(c.codigo)[1])))
  const temas = new Set(lista.map((c) => Number(/-T(\d+)-/.exec(c.codigo)[1])))
  const discrepancias = []
  let unidad = delNombre ? delNombre.unidad : null
  let tema = delNombre ? delNombre.tema : null
  if (unidades.size > 1) discrepancias.push('Los códigos del guion son de varias unidades (' + [...unidades].join(', ') + ').')
  if (temas.size > 1) discrepancias.push('Los códigos del guion son de varios temas (' + [...temas].join(', ') + ').')
  if (delNombre && unidades.size === 1 && !unidades.has(delNombre.unidad)) discrepancias.push('El nombre dice la unidad ' + delNombre.unidad + ' y los códigos son de la ' + [...unidades][0] + '.')
  if (delNombre && temas.size === 1 && !temas.has(delNombre.tema)) discrepancias.push('El nombre dice el tema ' + delNombre.tema + ' y los códigos son del ' + [...temas][0] + '.')
  if (!delNombre) { unidad = unidades.size === 1 ? [...unidades][0] : null; tema = temas.size === 1 ? [...temas][0] : null }
  return { unidad, tema, codigos: lista, codigos_en_filas: enFilas, tiene_presentacion: tienePresentacion, actividades, discrepancias, estructurado: guionEstructurado(bloques) }
}

// Estructura que entiende la pantalla de Guiones de Praxia (la misma que devuelve el flujo de n8n al generar): { info, presentacion, recursos[] }.
// Lee el formato de los guiones del flujo: un párrafo con el nombre del formato, la tabla «Código del recurso · ID» con el título, el subtema y el
// contenido por filas (rótulo | texto), y, si la lleva, la tabla «Actividad de autoaprendizaje» que sigue. El código se deja tal cual está en el documento.
// Nombre de la plantilla que el guion trae en la fila «Enlace de visualización» (…/plantillas/ver/<nombre>).
// Los nombres terminan en «-v01», «-v1»…; el texto puede venir pegado a lo que sigue («…-c-v1Nota»), así que se corta en el número de versión.
const RE_PLANTILLA = /\/plantillas(?:-html)?\/ver\/([A-Za-z0-9][A-Za-z0-9._-]*?-v\d+)(?!\d)/i
const RE_PLANTILLA_SUELTA = /\/plantillas(?:-html)?\/ver\/([A-Za-z0-9][A-Za-z0-9._-]*)/i
export const plantillaDeTexto = (t) => {
  const s = String(t ?? '')
  const m = RE_PLANTILLA.exec(s) || RE_PLANTILLA_SUELTA.exec(s)
  return m ? m[1].toLowerCase().replace(/[.]+$/, '') : null
}
const celdaTxt = (c) => String(c ?? '').replace(/\r/g, '').trim()
export function guionEstructurado(bloques) {
  const info = {}
  const recursos = []
  let presentacion = null
  let formato = ''
  let ultimo = null
  for (const b of bloques) {
    if (b.tipo === 'parrafo') {
      const t = aplanar(b.texto)
      if (t && normCat(t) !== 'informacion general') formato = t
      continue
    }
    if (b.tipo !== 'tabla' || !b.filas.length) continue
    const clave = (f) => normCat(f[0])
    const primera = clave(b.filas[0])
    if (b.filas.some((f) => clave(f) === 'nivel de formacion') && b.filas.some((f) => clave(f) === 'programa')) {
      for (const f of b.filas) {
        const k = clave(f); const v = aplanar(f[1])
        if (k === 'programa') info.programa = v
        else if (k === 'nivel de formacion') info.nivel = v
        else if (k === 'asignatura') info.asignatura = v
      }
      continue
    }
    if (primera.startsWith('codigo del recurso')) {
      const m = /\b(U\d{1,3}(?:-T\d{1,2}-R\d{1,3}|-PRES))\b(?:\s*[·•\-–]\s*((?:G|PRE|POS)-\d{2}(?:-[AC])?))?/.exec(aplanar(b.filas[0].slice(1).join(' ')))
      if (!m) { ultimo = null; continue }
      const contenido = []
      let titulo = ''
      for (const f of b.filas.slice(1)) {
        const rotulo = aplanar(f[0]); const texto = celdaTxt(f.slice(1).filter(Boolean).join('\n'))
        if (!rotulo && !texto) continue
        if (normCat(rotulo) === 'titulo del recurso') { titulo = aplanar(texto); continue }
        contenido.push({ rotulo, texto })
      }
      // El enlace puede estar en su propia fila («Enlace de visualización») o dentro del texto de otra celda («… Enlace de la visualización: https://…»): se busca en toda la tabla.
      const plantilla = plantillaDeTexto(b.filas.slice(1).map((f) => f.join(' ')).join(' '))
      const r = { id: m[1], formato, titulo: titulo || formato, contenido, actividad: null, plantilla, actividad_plantilla: null }
      if (m[1].endsWith('-PRES')) { presentacion = r; ultimo = null } else { recursos.push(r); ultimo = r }
      continue
    }
    if (primera.startsWith('actividad de autoaprendizaje') && ultimo) {
      const lineas = b.filas.slice(1).map((f) => [aplanar(f[0]), celdaTxt(f.slice(1).filter(Boolean).join('\n'))]).filter(([k, v]) => (k || v) && normCat(k) !== 'elemento')
      ultimo.actividad = lineas.map(([k, v]) => (k ? k + ': ' : '') + v).join('\n')
      ultimo.actividad_plantilla = plantillaDeTexto(b.filas.slice(1).map((f) => f.join(' ')).join(' '))
    }
  }
  return { info, presentacion, recursos }
}
