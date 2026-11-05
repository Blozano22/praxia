// Saca de un syllabus todos los enlaces generados, con las mismas reglas que usa la interfaz:
// solo https y con un largo razonable. Lo demás se ignora (nunca se guarda tal cual llegó).
const MAX = 600

function limpiarUrl(valor) {
  if (typeof valor !== 'string' || valor.length > 2000) return null
  try {
    const u = new URL(valor.trim())
    return u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}
const texto = (v) => (typeof v === 'string' ? v.slice(0, 300) : null)
const entero = (v) => (Number.isInteger(v) && v >= 0 && v < 1000 ? v : null)

export function extraerEnlaces(p) {
  const salida = []
  const poner = (tipo, url, unidad, nombre) => {
    const u = limpiarUrl(url)
    if (u && salida.length < MAX) salida.push({ tipo, unidad: entero(unidad), nombre: texto(nombre), url: u })
  }
  poner('syllabus', p.syllabusUrl, null, p.curso)
  poner('carpeta', p.carpetaUrl, null, 'Carpeta de destino')

  const docs = p.syllabus && Array.isArray(p.syllabus.documentos) ? p.syllabus.documentos : []
  for (const d of docs) if (d && typeof d === 'object') poner('documento_unidad', d.url, Number(d.unidad), d.nombre)

  const gu = p.guionesUnidad && typeof p.guionesUnidad === 'object' ? p.guionesUnidad : {}
  for (const [unidad, g] of Object.entries(gu)) {
    const archivos = g && Array.isArray(g.archivos) ? g.archivos : []
    for (const a of archivos) if (a && typeof a === 'object') poner('guion', a.url, Number(unidad), a.nombre)
  }
  return salida
}
