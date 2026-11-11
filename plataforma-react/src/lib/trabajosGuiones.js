// Generaciones de guiones en curso. La llamada a n8n la hace el SERVIDOR (un «trabajo» con identificador en la base de datos):
// sigue aunque se cierre la página o venza la sesión, no se puede lanzar dos veces para la misma unidad y, al volver, la página
// se entera sola de lo que está en curso, de lo que terminó (y lo guarda en el syllabus) y de lo que falló.
// Este módulo guarda ese estado fuera de los componentes y lo mantiene al día preguntando al servidor.
import { useSyncExternalStore } from 'react'
import { api } from './api.js'
import { interpretarRespuestaGuiones } from './syllabus.js'

// clave (syllabus|unidad) -> { servidorId, desde (ms), error, sinBib }. Con error: la generación falló y espera a que se vea el aviso.
const trabajos = new Map()
const oyentes = new Set()
const descartados = new Set() // trabajos con error que ya se mostraron: no se vuelven a traer mientras se borran del servidor
const aplicando = new Set() // trabajos terminados que se están guardando en el syllabus
let version = 0
let anfitrion = { obtener: () => null, guardar: () => {} } // lo fija App: da el syllabus más reciente y lo guarda
let activo = false
let temporizador = null
let sincronizando = false

const clave = (id, unidad) => id + '|' + unidad
const avisar = () => { version++; oyentes.forEach((f) => f()) }
const suscribir = (f) => { oyentes.add(f); return () => oyentes.delete(f) }
const borrarEnServidor = (id) => { if (id) api('DELETE', '/guiones/trabajos/' + id).catch(() => { /* ya no estaba */ }) }

export const fijarAnfitrion = (a) => { anfitrion = a }

// Estado de una unidad: { generando, desde, error, sinBib }
export function useTrabajoGuiones(id, unidad) {
  useSyncExternalStore(suscribir, () => version)
  const t = trabajos.get(clave(id, unidad))
  return { generando: !!t && !t.error, desde: t ? t.desde : 0, error: t && t.error ? t.error : null, sinBib: !!(t && t.sinBib) }
}
export function useUnidadesGenerando(id) {
  useSyncExternalStore(suscribir, () => version)
  return [...trabajos.entries()].filter(([k, t]) => k.startsWith(id + '|') && !t.error).map(([k]) => Number(k.split('|')[1]))
}

export function descartarError(id, unidad) {
  const k = clave(id, unidad)
  const t = trabajos.get(k)
  if (!t || !t.error) return
  trabajos.delete(k)
  if (t.servidorId) { descartados.add(t.servidorId); borrarEnServidor(t.servidorId) }
  avisar()
}

// Un trabajo terminado: se guardan sus guiones en el syllabus (aunque la persona estuviera ausente) y se borra del servidor.
async function aplicar(j) {
  if (aplicando.has(j.id)) return
  aplicando.add(j.id)
  const k = clave(j.proyecto, j.unidad)
  trabajos.set(k, { servidorId: j.id, desde: Date.parse(j.creado) || Date.now(), error: null, sinBib: false })
  try {
    const { respuesta } = await api('GET', '/guiones/trabajos/' + j.id + '/respuesta')
    const s = anfitrion.obtener(j.proyecto) // el syllabus más reciente; si ya no existe, no hay dónde guardar
    if (s) {
      const nuevos = interpretarRespuestaGuiones(respuesta)
      anfitrion.guardar({ ...s, guionesUnidad: { ...(s.guionesUnidad || {}), [j.unidad]: { fecha: Date.now(), archivos: nuevos.map((a) => ({ ...a, aprobado: false, visto: false })) } } })
    }
    borrarEnServidor(j.id)
    trabajos.delete(k)
  } catch (e) {
    if (e && e.estado === 401) { trabajos.delete(k); return } // sesión vencida: se reintenta al volver a entrar
    trabajos.set(k, { servidorId: j.id, desde: 0, error: e, sinBib: false })
  } finally { aplicando.delete(j.id) }
}

// Pregunta al servidor por los trabajos de esta persona y deja el estado local igual.
export async function sincronizar() {
  if (sincronizando) return
  sincronizando = true
  try {
    const lista = await api('GET', '/guiones/trabajos')
    const enCurso = new Set()
    for (const j of lista) {
      const k = clave(j.proyecto, j.unidad)
      const t = trabajos.get(k)
      if (j.estado === 'en_curso') {
        enCurso.add(k)
        if (!t || t.error || t.servidorId !== j.id) trabajos.set(k, { servidorId: j.id, desde: Date.parse(j.creado) || Date.now(), error: null, sinBib: false })
      } else if (j.estado === 'listo') {
        await aplicar(j)
      } else if (j.estado === 'error' && !descartados.has(j.id) && !(t && t.servidorId === j.id)) {
        trabajos.set(k, { servidorId: j.id, desde: 0, error: new Error(j.error || 'La generación de guiones falló.'), sinBib: false })
      }
    }
    // Lo que se creyó en curso pero el servidor ya no lista como tal (terminó o se borró) deja de mostrarse como «generando».
    for (const [k, t] of trabajos) if (!t.error && t.servidorId && !enCurso.has(k) && !aplicando.has(t.servidorId)) trabajos.delete(k)
    avisar()
  } catch { /* sin conexión o sin sesión: se vuelve a intentar en el siguiente ciclo */ } finally { sincronizando = false }
}

const programar = () => {
  clearTimeout(temporizador)
  if (!activo) return
  const hayEnCurso = [...trabajos.values()].some((t) => !t.error)
  temporizador = setTimeout(async () => { await sincronizar(); programar() }, hayEnCurso ? 4000 : 45000)
}
const alVolver = () => { if (document.visibilityState === 'visible' && activo) sincronizar().then(programar) }

// Se llama al iniciar sesión (con los syllabus ya cargados) y se detiene al salir.
export function arrancarSondeo() {
  if (activo) return
  activo = true
  document.addEventListener('visibilitychange', alVolver)
  sincronizar().then(programar)
}
export function detenerSondeo() {
  activo = false
  clearTimeout(temporizador)
  document.removeEventListener('visibilitychange', alVolver)
  trabajos.clear(); descartados.clear(); aplicando.clear()
  avisar()
}

// Lanza la generación en el servidor. Devuelve false si ya había una en curso para esa unidad.
export async function iniciarGuiones({ id, unidad, params }) {
  const k = clave(id, unidad)
  const previo = trabajos.get(k)
  if (previo && !previo.error) return false
  if (!params.bibliografiaId) {
    const e = new Error('Este syllabus no tiene la bibliografía leída guardada. Vuelva a generar los documentos desde el paso «Syllabus» (se lee la bibliografía y luego se crean las unidades) y después cree los guiones.')
    e.code = 'SIN_BIBLIOGRAFIA'
    trabajos.set(k, { servidorId: null, desde: 0, error: e, sinBib: true })
    avisar()
    return false
  }
  trabajos.set(k, { servidorId: null, desde: Date.now(), error: null, sinBib: false })
  avisar()
  try {
    const r = await api('POST', '/guiones/trabajos', {
      proyecto: id, unidad: Number(params.unidad), unidadUrl: params.unidadUrl, bibliografiaId: params.bibliografiaId,
      ...(params.syllabusUrl ? { syllabusUrl: params.syllabusUrl } : {})
    })
    trabajos.set(k, { servidorId: r.id, desde: Date.parse(r.creado) || Date.now(), error: null, sinBib: false })
    avisar(); programar()
    return true
  } catch (e) {
    if (e && e.estado === 409 && e.datos && e.datos.ya) { // otra pestaña o sesión ya la lanzó: se sigue esa
      trabajos.set(k, { servidorId: e.datos.id, desde: Date.parse(e.datos.creado) || Date.now(), error: null, sinBib: false })
      avisar(); programar()
      return false
    }
    trabajos.set(k, { servidorId: null, desde: 0, error: e, sinBib: false })
    avisar()
    return false
  }
}
