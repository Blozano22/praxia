// Creación de las unidades en curso. La llamada a n8n la hace el SERVIDOR (un «trabajo» con identificador en la base de datos):
// sigue aunque se cierre la página o venza la sesión y no se puede lanzar dos veces para el mismo syllabus. Al volver, la página se
// entera sola de lo que está en curso, de lo que terminó (y crea o actualiza el syllabus con las unidades) y de lo que falló.
// Mismo esquema que trabajosGuiones.js.
import { useSyncExternalStore } from 'react'
import { api } from './api.js'
import { idDocumento, interpretarRespuestaDocumentos } from './syllabus.js'

// documento del syllabus -> { servidorId, desde (ms), error, curso, syllabusUrl, proyecto }. Con error: falló y espera a que se vea el aviso.
const trabajos = new Map()
// documento del syllabus -> resultado ya guardado, para que la pantalla que esperaba lo muestre: { documentos, programa, curso, sinLista, proyectoId }
const terminados = new Map()
const oyentes = new Set()
const descartados = new Set()
const aplicando = new Set()
let version = 0
let anfitrion = { crearDeUnidades: async () => ({ ok: false }) } // lo fija App: crea o actualiza el syllabus con el resultado
let activo = false
let temporizador = null
let sincronizando = false

const avisar = () => { version++; oyentes.forEach((f) => f()) }
const suscribir = (f) => { oyentes.add(f); return () => oyentes.delete(f) }
const borrarEnServidor = (id) => { if (id) api('DELETE', '/unidades/trabajos/' + id).catch(() => { /* ya no estaba */ }) }

export const fijarAnfitrionUnidades = (a) => { anfitrion = a }

// Estado de un syllabus (por su enlace): { generando, desde, error, terminado }
export function useTrabajoUnidades(syllabusUrl) {
  useSyncExternalStore(suscribir, () => version)
  const doc = idDocumento(syllabusUrl)
  const t = doc ? trabajos.get(doc) : null
  return { generando: !!t && !t.error, desde: t ? t.desde : 0, error: t && t.error ? t.error : null, terminado: (doc && terminados.get(doc)) || null }
}
// Todas las creaciones en curso o con error de esta persona (para el aviso general).
export function useUnidadesEnCurso() {
  useSyncExternalStore(suscribir, () => version)
  return [...trabajos.entries()].map(([doc, t]) => ({ doc, ...t }))
}

export function olvidarTerminado(syllabusUrl) {
  const doc = idDocumento(syllabusUrl)
  if (doc && terminados.delete(doc)) avisar()
}
export function descartarErrorUnidades(doc) {
  const t = trabajos.get(doc)
  if (!t || !t.error) return
  trabajos.delete(doc)
  if (t.servidorId) { descartados.add(t.servidorId); borrarEnServidor(t.servidorId) }
  avisar()
}

// Un trabajo terminado: se crea o actualiza el syllabus (aunque la persona estuviera ausente) y se borra del servidor.
async function aplicar(j) {
  if (aplicando.has(j.id)) return
  aplicando.add(j.id)
  const doc = j.syllabusDoc
  trabajos.set(doc, { servidorId: j.id, desde: Date.parse(j.creado) || Date.now(), error: null, curso: j.curso, syllabusUrl: j.syllabusUrl, proyecto: j.proyecto })
  try {
    const { respuesta } = await api('GET', '/unidades/trabajos/' + j.id + '/respuesta')
    let r
    try { r = interpretarRespuestaDocumentos(respuesta) } catch (e) {
      if (e.code !== 'NO_DOCUMENT_LIST') throw e
      r = { documentos: [], programa: e.programa, curso: e.curso, sinLista: true } // el flujo terminó sin lista de enlaces: «revise su carpeta»
    }
    const res = await anfitrion.crearDeUnidades(j, r)
    // Solo se borra el trabajo del servidor cuando el guardado quedó confirmado: si falló, la respuesta de n8n sigue allí y se reintenta.
    if (res && res.ok === false) { trabajos.delete(doc); return }
    terminados.set(doc, { ...r, proyectoId: res && res.id })
    borrarEnServidor(j.id)
    trabajos.delete(doc)
  } catch (e) {
    if (e && e.estado === 401) { trabajos.delete(doc); return } // sesión vencida: se reintenta al volver a entrar
    trabajos.set(doc, { servidorId: j.id, desde: 0, error: e, curso: j.curso, syllabusUrl: j.syllabusUrl, proyecto: j.proyecto })
  } finally { aplicando.delete(j.id) }
}

export async function sincronizarUnidades() {
  if (sincronizando) return
  sincronizando = true
  try {
    const lista = await api('GET', '/unidades/trabajos')
    const enCurso = new Set()
    for (const j of lista) {
      const t = trabajos.get(j.syllabusDoc)
      if (j.estado === 'en_curso') {
        enCurso.add(j.syllabusDoc)
        if (!t || t.error || t.servidorId !== j.id) trabajos.set(j.syllabusDoc, { servidorId: j.id, desde: Date.parse(j.creado) || Date.now(), error: null, curso: j.curso, syllabusUrl: j.syllabusUrl, proyecto: j.proyecto })
      } else if (j.estado === 'listo') {
        await aplicar(j)
      } else if (j.estado === 'error' && !descartados.has(j.id) && !(t && t.servidorId === j.id)) {
        trabajos.set(j.syllabusDoc, { servidorId: j.id, desde: 0, error: new Error(j.error || 'La creación de las unidades falló.'), curso: j.curso, syllabusUrl: j.syllabusUrl, proyecto: j.proyecto })
      }
    }
    for (const [doc, t] of trabajos) if (!t.error && t.servidorId && !enCurso.has(doc) && !aplicando.has(t.servidorId)) trabajos.delete(doc)
    avisar()
  } catch { /* sin conexión o sin sesión: se vuelve a intentar en el siguiente ciclo */ } finally { sincronizando = false }
}

const programar = () => {
  clearTimeout(temporizador)
  if (!activo) return
  const hayEnCurso = [...trabajos.values()].some((t) => !t.error)
  temporizador = setTimeout(async () => { await sincronizarUnidades(); programar() }, hayEnCurso ? 4000 : 45000)
}
const alVolver = () => { if (document.visibilityState === 'visible' && activo) sincronizarUnidades().then(programar) }

export function arrancarSondeoUnidades() {
  if (activo) return
  activo = true
  document.addEventListener('visibilitychange', alVolver)
  sincronizarUnidades().then(programar)
}
export function detenerSondeoUnidades() {
  activo = false
  clearTimeout(temporizador)
  document.removeEventListener('visibilitychange', alVolver)
  trabajos.clear(); terminados.clear(); descartados.clear(); aplicando.clear()
  avisar()
}

// Lanza la creación de las unidades en el servidor. Devuelve true si se lanzó (o ya estaba en curso); lanza el error si no se pudo.
export async function iniciarUnidades({ syllabusUrl, carpetaUrl, bibliografiaId, curso, proyecto }) {
  const doc = idDocumento(syllabusUrl)
  const previo = trabajos.get(doc)
  if (previo && !previo.error) return false
  terminados.delete(doc)
  trabajos.set(doc, { servidorId: null, desde: Date.now(), error: null, curso: curso || '', syllabusUrl, proyecto: proyecto || null })
  avisar()
  try {
    const r = await api('POST', '/unidades/trabajos', { syllabusUrl, carpetaUrl, bibliografiaId, ...(curso ? { curso } : {}), ...(proyecto ? { proyecto } : {}) })
    trabajos.set(doc, { servidorId: r.id, desde: Date.parse(r.creado) || Date.now(), error: null, curso: curso || '', syllabusUrl, proyecto: proyecto || null })
    avisar(); programar()
    return true
  } catch (e) {
    if (e && e.estado === 409 && e.datos && e.datos.ya) { // otra pestaña o sesión ya la lanzó: se sigue esa
      trabajos.set(doc, { servidorId: e.datos.id, desde: Date.parse(e.datos.creado) || Date.now(), error: null, curso: curso || '', syllabusUrl, proyecto: proyecto || null })
      avisar(); programar()
      return false
    }
    trabajos.delete(doc)
    avisar()
    throw e
  }
}
