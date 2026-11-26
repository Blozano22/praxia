// «Curso piloto»: lectura del Syllabus (unidades y nivel de formación) sobre el modelo neutro de bloques.
import { formacionDeCurso } from '../pipeline/preparacion.js'
import { aplanar, textoDeBloques } from './documento.js'

// Copia de n8n/syllabus-a-plantilla.json (nodo de lectura del Syllabus, 25-11-2026): no cambiar sin cambiar también el flujo
export const RE_UNIDAD = /^Unidad\s*(?:Nro\.?|N[°ºo]\.?|N[uú]mero)\s*(\d+)|^Unidad\s+(\d+)\s*$/i

// Misma expresión que formacionDeSyllabus (src/pipeline/preparacion.js) sobre el texto del documento.
export const RE_FORMACION = /nivel\s+de\s+formaci[oó]n[\s|:*]*([^\r\n|]{3,60})/i

export function formacionDeBloques(bloques) {
  const m = RE_FORMACION.exec(textoDeBloques(bloques).slice(0, 400000))
  const texto = m ? aplanar(m[1]) : null
  return { texto, formacion: texto ? formacionDeCurso({ info: { nivel: texto } }) : null }
}

// Unidades: en TODAS las filas de TODAS las tablas, la primera celda que cumple RE_UNIDAD (Word une tablas pegadas: se corta por fila, igual que n8n);
// el nombre es la celda 2; los números repetidos se ignoran (gana el primero).
export function leerSyllabus(bloques, nombreDoc = '') {
  const unidades = []
  const vistos = new Set()
  for (const b of bloques) {
    if (b.tipo !== 'tabla') continue
    for (const f of b.filas) {
      const m = RE_UNIDAD.exec(aplanar(f[0]))
      if (!m) continue
      const numero = Number(m[1] ?? m[2])
      if (vistos.has(numero)) continue
      vistos.add(numero)
      unidades.push({ numero, nombre: aplanar(f[1]) })
    }
  }
  const { texto, formacion } = formacionDeBloques(bloques)
  const curso = aplanar(String(nombreDoc || '').replace(/^\s*s[ií]labo?\s*[-–:_]?\s*/i, '').replace(/^\s*syllabus\s*[-–:_]?\s*/i, ''))
  return { unidades, formacionTexto: texto, formacion, curso }
}
