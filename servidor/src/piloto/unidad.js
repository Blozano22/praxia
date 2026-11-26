// «Curso piloto»: lectura del documento de la unidad («ESTRUCTURA METODOLÓGICA – UNIDAD N») y extracción de recursos, actividades y presentación.
// Es un port aislado de las reglas del flujo vivo (nodo «Extraer unidad1» de guiones-vivo.json para la lectura del documento y «Extraer recursos» del flujo
// «DIEPO - Preparar el curso» para los códigos y categorías); solo cambian la ENTRADA (bloques en vez del JSON de la API de Docs) y la SALIDA (estructuras del piloto).
// Copia de n8n «Extraer unidad1» / «Extraer recursos» (25-11-2026): no cambiar sin cambiar también el flujo.
import { aplanar } from './documento.js'
import { categoriaPresentacion, claveCat, normCat } from './catalogo.js'
import { formacionDeBloques } from './syllabus.js'

const RE_TEMA = /^(?:Tema\s*)?\d+\s*[.:\-–]\s*(?:\d+\s*[.)]\s*)?[A-Za-zÁÉÍÓÚÑáéíóúñ¿]/i
const RE_TEMA_G = /^(?:Tema\s*)?(\d+)\s*[.:\-–]\s*(?:\d+\s*[.)]\s*)?(.+)$/i
const SIN_ACTIVIDAD = new Set(['', 'n a', 'no aplica', 'na', 'ninguna', 'ninguno', 'no'])

export function leerUnidad(bloques) {
  let numero = null
  let nombre = null
  let presentacion = null
  let temaPendiente = null
  const temas = []
  const evalFilas = []
  const avisos = []
  for (const b of bloques) {
    if (b.tipo === 'parrafo') {
      const t = b.texto
      let m
      if (/^ESTRUCTURA METODOL/i.test(t)) {
        m = /UNIDAD\s+(\d+)/i.exec(t)
        if (m) numero = Number(m[1])
      } else if (/^Unidad\s*:/i.test(t)) {
        const completo = t.replace(/^Unidad\s*:\s*/i, '')
        m = /Unidad\s+Nro\.?\s*(\d+)\s*[—–-]\s*(.+)$/i.exec(completo)
        if (m) { if (numero === null) numero = Number(m[1]); nombre = m[2].trim() } else nombre = completo
      } else if (RE_TEMA.test(t)) {
        const g = RE_TEMA_G.exec(t)
        temaPendiente = { numero: Number(g[1]), nombre: g[1] + '. ' + g[2].trim() }
      }
      continue
    }
    const filas = b.filas
    if (!filas.length) continue
    const cab = normCat(filas[0][0])
    if (cab === 'tipo de recurso') {
      const f = filas.find((x) => normCat(x[0]).startsWith('recurso de presentacion'))
      presentacion = f ? { formato: aplanar(f[1]) } : null
    } else if (cab === 'subtemas') {
      if (!temaPendiente) { avisos.push('Una tabla de recursos no tiene un título de tema justo encima.'); continue }
      const cabecera = filas[0].map(normCat)
      const col = (re) => cabecera.findIndex((c) => re.test(c))
      const iRed = col(/recurso educativo digital|^red$/)
      const iAct = col(/actividad/)
      const iNom = col(/contenido del recurso|nombre del recurso|titulo del recurso/)
      const recursos = filas.slice(1).map((f) => ({
        formato: aplanar(f[iRed >= 0 ? iRed : 1]),
        actividad: aplanar(f[iAct >= 0 ? iAct : 2]),
        titulo: iNom >= 0 ? aplanar(f[iNom]) : ''
      }))
      temas.push({ ...temaPendiente, recursos })
      temaPendiente = null
    } else if (cab === 'tipo de evaluacion') {
      const cabEv = filas[0].map(normCat)
      const colEv = (re) => cabEv.findIndex((x) => re.test(x))
      const iEst = colEv(/^estrategia/); const iMec = colEv(/^mecanismo/); const iUbi = colEv(/ubicacion|momento/)
      for (const f of filas.slice(1)) {
        if (!aplanar(f[0])) continue
        evalFilas.push({ tipo: aplanar(f[0]), estrategia: iEst >= 0 ? aplanar(f[iEst]) : '', mecanismo: iMec >= 0 ? aplanar(f[iMec]) : '', ubicacion_texto: aplanar(f[iUbi >= 0 ? iUbi : 2]) })
      }
    }
  }
  const evaluacion = evalFilas.find((f) => /autoaprendizaje/.test(normCat(f.tipo))) || null
  return { numero, nombre, temas, presentacion, evaluacion, evalFilas, avisos, formacionTexto: formacionDeBloques(bloques).texto }
}

// Nombre de la actividad: el texto antes del primer «:» («Nombre de la actividad: descripción…»).
const nombreDeActividad = (txt) => { const s = String(txt || ''); const i = s.indexOf(':'); return aplanar(i >= 0 ? s.slice(0, i) : s) }
const tieneActividad = (txt) => !SIN_ACTIVIDAD.has(normCat(txt))
const mismoNombre = (a, b) => { const x = claveCat(a); return !!x && x === claveCat(b) }

// «Mecanismo: <nombre>. Descripción: …» o, si falta, «<nombre>. Indicadores: …» de la fila de EVALUACIONES.
function nombreEnEvaluacion(ev) {
  const quitar = (s) => aplanar(s).replace(/^mecanismo\s*:\s*/i, '')
  const corte = (s) => { const t = quitar(s); const c = t.search(/\.\s*(?:descripci[oó]n|indicadores?)\s*:|\.\s|\.$/i); return aplanar(c >= 0 ? t.slice(0, c) : t) }
  return corte(ev.mecanismo) || corte(ev.estrategia)
}
// Tema en que se aplica: el que nombra «Momento de aplicación» (se compara con los títulos de tema, «<<Tema_N>>» o «tema: N»); si cubre varios, el último.
function temaDeEvaluacion(ev, temas) {
  const n = normCat(ev.ubicacion_texto)
  const encontrados = new Set()
  for (const t of temas) if (n.includes(normCat(t.nombre))) encontrados.add(t.numero)
  for (const m of ev.ubicacion_texto.matchAll(/<<Tema_(\d+)>>/g)) encontrados.add(Number(m[1]))
  if (!encontrados.size) { const m = /tema\s*:?\s*(\d+)/i.exec(ev.ubicacion_texto); if (m) encontrados.add(Number(m[1])) }
  const v = [...encontrados].sort((a, b) => a - b)
  return v.length ? v[v.length - 1] : null
}

const itemBase = (o) => ({
  codigo: null, clase: null, tema: null, posicion: null, formato: null, nombre: null, titulo: null, con_actividad: null, calificable: null,
  categoria: null, id_base: null, id_catalogo: null, fuente_categoria: null, tipo_produccion: null, id_en_guion: null, guion_id: null,
  detectado_en: 'unidad', estado: null, motivo: null, aviso: null, variante: null, ...o
})
const sinAsignar = (it, motivo, aviso = null) => { it.estado = 'sin_asignar'; it.motivo = motivo; if (aviso) it.aviso = aviso }

// Para UNA unidad. indiceRec: { baseId(nombre), tipoProduccion(base), fuente }; indiceAct: indiceActividades() o null (hoja no disponible); formacion puede ser null
// (entonces no hay categoría de actividad: la hoja depende del nivel). Diferencias con el flujo vivo (documentadas en el diseño, §4.4):
//   - presentación sin texto en el documento: no se pide G-13 por defecto, queda sin_asignar «presentacion_no_indicada»;
//   - lo que el flujo deja «fuera» (actividad fuera de hoja, ambigua, calificable indeterminada) se conserva con estado sin_asignar y su motivo.
export function extraerRecursos(u, numero, { indiceRec, indiceAct, formacion }) {
  const recursos = []
  const actividades = []
  const problemas = []
  const avisos = [...(u.avisos || [])]
  const repetidos = new Set()
  const vistosTema = new Set()
  for (const t of u.temas) { if (vistosTema.has(t.numero)) repetidos.add(t.numero); vistosTema.add(t.numero) }
  for (const t of repetidos) problemas.push({ tipo: 'ambiguo', unidad: numero, codigo: null, mensaje: 'El documento de la unidad tiene dos tablas con el número de tema ' + t + ': sus códigos se repetirían y no se asigna ninguna variante de ese tema.', candidatos: [] })

  // La calificable: la actividad del tema indicado en EVALUACIONES cuyo nombre coincide; las demás false. Si EVALUACIONES no la identifica, ninguna actividad se asigna.
  let calificableDe = null // codigo -> boolean; null = indeterminada
  const todas = []
  u.temas.forEach((t) => t.recursos.forEach((r, i) => { if (tieneActividad(r.actividad)) todas.push({ tema: t, pos: i + 1, nombre: nombreDeActividad(r.actividad) }) }))
  let motivoIndeterminada = null
  if (todas.length) {
    const ev = u.evaluacion
    if (!ev) motivoIndeterminada = 'La tabla EVALUACIONES no trae una fila «Actividad de autoaprendizaje».'
    else {
      const nom = nombreEnEvaluacion(ev)
      const tn = temaDeEvaluacion(ev, u.temas)
      const delTema = todas.filter((a) => a.tema.numero === tn && mismoNombre(a.nombre, nom))
      if (!nom) motivoIndeterminada = 'EVALUACIONES no dice el nombre de la actividad calificable.'
      else if (tn === null) motivoIndeterminada = 'EVALUACIONES no dice en qué tema se aplica la actividad calificable.'
      else if (delTema.length !== 1) motivoIndeterminada = delTema.length ? 'La actividad calificable «' + nom + '» aparece más de una vez en el tema ' + tn + '.' : 'La actividad calificable «' + nom + '» no está en la tabla del tema ' + tn + '.'
      else {
        calificableDe = new Map(todas.map((a) => [a.tema.numero + ':' + a.pos, a === delTema[0]]))
        const primera = todas.find((a) => a.tema.numero === tn)
        if (primera !== delTema[0]) avisos.push('La actividad calificable no es la primera actividad del tema ' + tn + ' (la regla del plan es que lo sea): revise EVALUACIONES.')
      }
    }
    if (motivoIndeterminada) problemas.push({ tipo: 'ambiguo', unidad: numero, codigo: null, mensaje: motivoIndeterminada + ' No se asigna ninguna actividad de la unidad.', candidatos: [] })
  }

  for (const t of u.temas) {
    t.recursos.forEach((r, i) => {
      const pos = i + 1
      if (!r.formato && !tieneActividad(r.actividad)) return // fila vacía
      const conAct = tieneActividad(r.actividad)
      const rc = 'U' + numero + '-T' + t.numero + '-R' + pos
      const base = r.formato ? indiceRec.baseId(r.formato) : null
      const it = itemBase({ codigo: rc, clase: 'recurso', tema: t.numero, posicion: pos, formato: r.formato, titulo: r.titulo, con_actividad: conAct })
      if (!r.formato) sinAsignar(it, 'fila_sin_recurso')
      else if (!base) sinAsignar(it, 'formato_fuera_de_catalogo')
      else {
        it.categoria = base; it.id_base = base; it.id_catalogo = base === 'G-00' ? base : base + (conAct ? '-A' : '-C')
        it.fuente_categoria = indiceRec.fuente || 'hoja'; it.tipo_produccion = indiceRec.tipoProduccion ? indiceRec.tipoProduccion(base) : null
      }
      if (repetidos.has(t.numero)) sinAsignar(it, 'codigo_repetido')
      recursos.push(it)
      if (conAct) {
        const nombre = nombreDeActividad(r.actividad)
        const a = itemBase({ codigo: 'U' + numero + '-T' + t.numero + '-A' + pos, clase: 'actividad', tema: t.numero, posicion: pos, recurso_codigo: rc, nombre, titulo: nombre })
        a.calificable = calificableDe ? calificableDe.get(t.numero + ':' + pos) : null
        if (repetidos.has(t.numero)) sinAsignar(a, 'codigo_repetido')
        else if (!formacion) sinAsignar(a, 'formacion_desconocida')
        else if (!indiceAct) sinAsignar(a, 'catalogo_actividades_no_disponible')
        else {
          const f = indiceAct.idsDe(nombre)
          if (!f) sinAsignar(a, 'actividad_fuera_de_catalogo')
          else if (f.ids.size > 1) { a.candidatos = [...f.ids].sort(); sinAsignar(a, 'actividad_ambigua', 'El nombre aparece en varias categorías: ' + a.candidatos.join(', ')) } else {
            const id = [...f.ids][0]
            a.categoria = id; a.id_base = id; a.id_catalogo = id; a.fuente_categoria = 'hoja'
          }
        }
        if (!a.estado && !calificableDe) sinAsignar(a, 'calificable_indeterminada')
        actividades.push(a)
      }
    })
  }

  // Presentación de la unidad: «U{u}-PRES», categoría según el texto de la fila «Recurso de presentación».
  const texto = u.presentacion && u.presentacion.formato ? u.presentacion.formato : ''
  const pres = itemBase({ codigo: 'U' + numero + '-PRES', clase: 'presentacion', formato: texto || null })
  if (!texto) sinAsignar(pres, 'presentacion_no_indicada')
  else { pres.categoria = categoriaPresentacion(texto); pres.id_base = pres.categoria; pres.id_catalogo = pres.categoria + '-C' }
  return { recursos, actividades, presentacion: pres, problemas, avisos }
}

