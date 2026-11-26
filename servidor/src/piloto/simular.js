// «Curso piloto»: simulación de «qué variantes recibiría este curso si fuera un curso nuevo». Estado de uso vacío: NO lee ni escribe asignacion_variantes ni ninguna otra
// tabla (solo SELECT del catálogo de plantillas). Reutiliza elegibles() del sistema real sin cambiarla.
import { elegibles } from '../pipeline/asignaciones.js'

// Lee de la base, una sola vez por análisis, lo necesario para simular (solo SELECT).
export async function cargarPlantillas(categoriasNecesarias) {
  const { sinUsuario } = await import('../db.js')
  const { Q } = await import('../consultas.js')
  const tipoDe = new Map((await sinUsuario(Q.categoriasListar)).rows.map((k) => [k.id, k.tipo]))
  const formDe = {}
  for (const x of (await sinUsuario(Q.formacionesListar)).rows) (formDe[x.categoria] ||= []).push(x.formacion)
  const variantesDe = {}
  for (const cat of new Set(categoriasNecesarias)) {
    if (!tipoDe.has(cat)) continue
    variantesDe[cat] = (await sinUsuario(Q.asignElegibles, [cat])).rows.map((v) => ({ nombre: v.nombre, formacion: v.formacion || null, calificable: typeof v.calificable === 'boolean' ? v.calificable : null, ultimo: v.ultimo, creado: v.creado }))
  }
  return { tipoDe, formDe, variantesDe }
}

const avisoRepetida = (categoria) => 'Variante repetida: ya se usaron todas las de ese tipo en ' + categoria + ' dentro de esta unidad.' // mismo texto que avisoRepetida de asignaciones.js
const esHtml = (t) => !t || /^html\b/i.test(String(t).trim())

// Pura. items en el orden de la unidad: presentación, recursos (tema, posición), actividades (tema, posición). Devuelve copias con { variante, estado, motivo, aviso }.
export function simularUnidad(items, { formacion, pruebas = false, tipoDe, formDe, variantesDe }) {
  const uso = new Map() // categoría → { usadas: Set, veces: Map }
  const usoDe = (cat) => { if (!uso.has(cat)) uso.set(cat, { usadas: new Set(), veces: new Map() }); return uso.get(cat) }
  return items.map((original) => {
    const item = { ...original }
    if (item.estado) return item // ya resuelto antes (motivo previo)
    if (!esHtml(item.tipo_produccion)) { item.estado = 'no_html'; return item }
    const cat = item.categoria
    if (!cat) { item.estado = 'sin_asignar'; item.motivo = item.clase === 'actividad' ? 'actividad_fuera_de_catalogo' : 'formato_fuera_de_catalogo'; return item }
    if (!tipoDe.has(cat)) { item.estado = 'sin_asignar'; item.motivo = 'categoria_inexistente'; return item }
    const esAct = tipoDe.get(cat) === 'actividad'
    if (esAct && typeof item.calificable !== 'boolean') { item.estado = 'sin_asignar'; item.motivo = 'falta_calificable'; return item }
    const todas = (variantesDe && variantesDe[cat]) || []
    const delTipo = esAct ? todas.filter((v) => v.calificable === item.calificable) : todas
    let { lista, motivo } = elegibles(delTipo, formacion, (formDe && formDe[cat]) || [], true, pruebas)
    if (esAct && todas.length && !delTipo.length) motivo = item.calificable ? 'categoria_sin_calificables' : 'categoria_sin_practicas'
    const u = usoDe(cat)
    const libres = lista.filter((v) => !u.usadas.has(v.nombre))
    let elegida
    let repetida = false
    let regla = 'primera_libre'
    let candidatas = libres.length
    if (!esAct) elegida = libres[0] // igual que el sistema real (lista.find)
    else {
      // DIFERENCIA con el sistema real (al azar): aquí la primera en el orden de elegibles(), para que el resultado sea reproducible
      const pref = pruebas ? libres.filter((v) => v.formacion === formacion) : []
      elegida = (pref.length ? pref : libres)[0]
      regla = 'primera_libre_determinista'
      if (!elegida && lista.length) {
        const min = Math.min(...lista.map((v) => u.veces.get(v.nombre) || 0))
        const menos = lista.filter((v) => (u.veces.get(v.nombre) || 0) === min)
        elegida = menos[0]; repetida = true; regla = 'menos_usada_determinista'; candidatas = menos.length
      }
    }
    if (elegida) {
      if (!repetida) u.usadas.add(elegida.nombre)
      u.veces.set(elegida.nombre, (u.veces.get(elegida.nombre) || 0) + 1)
      item.estado = repetida ? 'repetida' : 'asignada'
      item.motivo = repetida ? (item.calificable === true ? 'calificable_repetida' : 'variante_repetida') : null
      item.aviso = repetida && item.calificable !== true ? avisoRepetida(cat) : item.aviso || null
      item.variante = { plantilla: elegida.nombre, formacion: elegida.formacion || null, revision: elegida.ultimo || null, url_ver: '/plantillas-html/ver/' + elegida.nombre, regla, candidatas }
    } else { item.estado = 'sin_asignar'; item.motivo = motivo || 'variantes_agotadas' }
    return item
  })
}
