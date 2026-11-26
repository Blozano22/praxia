// «Curso piloto»: catálogo de IDs (hojas de Google) y reglas de nombres. Las funciones marcadas «Copia de n8n» se copiaron TAL CUAL de los flujos
// (no se importan ni se modifican los flujos): no cambiar sin cambiar también el flujo.

// Copia de n8n «Preparar relleno del guion1» (guiones-vivo.json, 12-11-2026): no cambiar sin cambiar también el flujo
export const normCat = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// Copia de n8n «Preparar relleno del guion1» (guiones-vivo.json, 12-11-2026): no cambiar sin cambiar también el flujo
export const claveCat = (s) => normCat(s).split(' ').filter(Boolean).map((w) => w.replace(/(es|s)$/, '')).join(' ')

// Copia de n8n «Preparar relleno del guion1» (guiones-vivo.json, 12-11-2026): respaldo cuando la hoja del catálogo no se puede leer. No cambiar sin cambiar también el flujo
export const baseIdPorPalabras = (nombre) => {
  const n = String(nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!n) return null
  if (/presentacion de la asignatura/.test(n)) return 'G-00'
  if (/infograf/.test(n)) return /interactiv/.test(n) ? 'G-02' : 'G-01'
  if (/diagrama.*flujo/.test(n)) return 'G-03'
  if (/mapa.*conceptual/.test(n)) return 'G-04'
  if (/micro ?lecci/.test(n)) return 'POS-05'
  if (/micro/.test(n)) return 'G-06'
  if (/video/.test(n)) return 'G-05'
  if (/podcast/.test(n)) return 'G-07'
  if (/presentacion|multimedia/.test(n)) return 'G-08'
  if (/acordeon/.test(n)) return 'G-09'
  if (/galeria/.test(n)) return 'G-10'
  if (/lectura/.test(n)) return 'G-11'
  if (/linea.*tiempo/.test(n)) return 'G-12'
  if (/ficha.*tecnica/.test(n)) return 'PRE-01'
  if (/simulador.*proceso/.test(n)) return 'PRE-02'
  if (/boletin/.test(n)) return 'PRE-03'
  if (/paso a paso|procedimiento/.test(n)) return 'PRE-04'
  if (/cuadro comparativo/.test(n)) return 'PRE-05'
  if (/caso.*interactivo|diagnostico/.test(n)) return 'PRE-06'
  if (/simulador.*gestion|gestion.*rol/.test(n)) return 'PRE-07'
  if (/libro de texto/.test(n)) return 'PRE-08'
  if (/tarjeta/.test(n)) return 'PRE-09'
  if (/matriz comparativa/.test(n)) return 'POS-01'
  if (/esquema grafico/.test(n)) return 'POS-02'
  if (/porque/.test(n)) return 'POS-03'
  if (/escenario.*decision/.test(n)) return 'POS-04'
  if (/arbol.*decision/.test(n)) return 'POS-06'
  if (/expediente/.test(n)) return 'POS-07'
  if (/manual|protocolo/.test(n)) return 'POS-08'
  if (/caso.*estudio/.test(n)) return 'POS-09'
  if (/cuaderno interactivo/.test(n)) return 'POS-10'
  if (/poster/.test(n)) return 'POS-11'
  if (/secuencia.*ilustrada/.test(n)) return 'POS-12'
  if (/matriz.*revision/.test(n)) return 'POS-13'
  if (/resumen.*grafico/.test(n)) return 'POS-14'
  return null
}

export const SIGLA = { tecnologico: 'tec', profesional: 'pro', especializacion: 'esp', doctorado: 'doc' }

// Presentación de la unidad: infografía → G-14, pantalla interactiva → G-15, cualquier otra → G-13 (regla del flujo «Preparar el curso», versión con G-13/14/15).
export const categoriaPresentacion = (txt) => {
  const n = normCat(txt)
  if (/infograf/.test(n)) return 'G-14'
  if (/pantalla interactiv/.test(n)) return 'G-15'
  return 'G-13'
}

// CSV (RFC 4180 mínimo): comillas dobles, comas y saltos de línea dentro de comillas, «""» como comilla.
export function leerCsv(texto) {
  const t = String(texto ?? '').replace(/^﻿/, '')
  const filas = []
  let fila = []
  let celda = ''
  let comillas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (comillas) {
      if (c === '"') { if (t[i + 1] === '"') { celda += '"'; i++ } else comillas = false } else celda += c
    } else if (c === '"') comillas = true
    else if (c === ',') { fila.push(celda); celda = '' } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      fila.push(celda); celda = ''
      filas.push(fila); fila = []
    } else celda += c
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila) }
  return filas
}

// Busca la fila cuyo encabezado (normalizado) es «encabezadoBuscado» en alguna celda; las siguientes son datos. Devuelve objetos por nombre de columna.
export function filasConEncabezado(matriz, encabezadoBuscado) {
  const buscado = normCat(encabezadoBuscado)
  const i = matriz.findIndex((f) => f.some((c) => normCat(c) === buscado))
  if (i < 0) return []
  const cab = matriz[i].map((c) => String(c ?? '').trim())
  return matriz.slice(i + 1).filter((f) => f.some((c) => String(c ?? '').trim())).map((f) => {
    const o = {}
    cab.forEach((k, j) => { if (k && !(k in o)) o[k] = f[j] ?? '' })
    return o
  })
}

// Índice de recursos: misma construcción que INDICE_CATALOGO de n8n «Preparar relleno del guion1» (columnas «Nombre …» y «Alias …» separadas por ; | o salto de línea).
export function indiceRecursos(filas) {
  const indice = new Map()
  const tipos = new Map()
  filas.forEach((f) => {
    const base = String(f['ID base'] || '').trim().toUpperCase()
    if (!/^(?:G|PRE|POS)-\d{2}$/.test(base)) return
    Object.keys(f).filter((k) => /^(nombre|alias)/i.test(k)).forEach((k) => {
      String(f[k] || '').split(/[;|\n]/).forEach((n) => { const c = claveCat(n); if (c && !indice.has(c)) indice.set(c, base) })
    })
    const kt = Object.keys(f).find((k) => /^tipo de producci/.test(normCat(k)))
    if (kt && !tipos.has(base)) tipos.set(base, String(f[kt] || '').trim() || null)
  })
  return {
    tamano: indice.size,
    fuente: 'hoja',
    tipoProduccion: (base) => tipos.get(base) ?? null,
    baseId(nombre) {
      const k = claveCat(nombre)
      if (!k) return null
      if (indice.has(k)) return indice.get(k)
      const candidatos = new Set() // nombre que contiene al del catálogo (o al revés), solo si apunta a un único ID
      indice.forEach((id, ck) => { if (ck.length >= 12 && (k.includes(ck) || ck.includes(k))) candidatos.add(id) })
      return candidatos.size === 1 ? [...candidatos][0] : null
    }
  }
}

// Índice de actividades (hoja ACTIVIDADES_AUTOAPRENDIZAJE): nombre → IDs, en la columna «Nombre en TEC/PRO/ESP/DOC» del nivel del curso; respaldo: «Nombre de la actividad»,
// donde solo valen las generales (ACT-G-…) y las específicas de ese nivel (ACT-E-…-TEC). Un nombre con más de un ID se devuelve con todos (la regla del flujo: no adivinar).
export function indiceActividades(filas, formacion) {
  const sigla = SIGLA[formacion]
  const porNivel = new Map()
  const porNombre = new Map()
  const poner = (m, nombre, id) => { const c = claveCat(nombre); if (!c) return; if (!m.has(c)) m.set(c, new Set()); m.get(c).add(id) }
  filas.forEach((f) => {
    const id = String(f['ID de la actividad'] || '').trim().toUpperCase()
    if (!id) return
    const kNivel = Object.keys(f).find((k) => normCat(k) === 'nombre en ' + sigla)
    if (kNivel) String(f[kNivel] || '').split(/[;|\n]/).forEach((n) => poner(porNivel, n, id))
    const kNom = Object.keys(f).find((k) => normCat(k) === 'nombre de la actividad')
    const delNivel = /^ACT-G-/.test(id) || id.endsWith('-' + String(sigla).toUpperCase())
    if (kNom && delNivel) poner(porNombre, f[kNom], id)
  })
  return {
    tamano: filas.length,
    idsDe(texto) {
      const c = claveCat(texto)
      if (!c) return null
      const ids = porNivel.get(c) || porNombre.get(c)
      return ids && ids.size ? { ids: new Set(ids), general: [...ids].every((x) => /^ACT-G-/.test(x)) } : null
    }
  }
}
