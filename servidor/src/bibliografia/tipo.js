// Qué tipo de archivo es lo descargado. Sin dependencias (se prueba sin instalar nada).
//
// Un PDF puede traer espacios o saltos de línea ANTES de «%PDF-» (la especificación admite la marca dentro de los primeros
// 1024 bytes). Los PDF oficiales de la Ley 906 de 2004 y la Ley 2477 de 2025 en funcionpublica.gov.co empiezan con «\t\n%PDF»:
// al exigir la marca en los 5 primeros bytes se rechazaban como «formato no admitido» y esas fuentes nunca se leían.
export const esPdf = (datos) => Boolean(datos && datos.length > 4 && datos.subarray(0, 1024).toString('latin1').includes('%PDF-'))

export const tipoDeContenido = (tipo, url, datos) => {
  if (esPdf(datos)) return 'pdf'
  if (/pdf/.test(tipo) || /\.pdf(?:[?#]|$)/i.test(url)) return null
  if (/officedocument\.wordprocessingml/.test(tipo) || /\.docx(?:[?#]|$)/i.test(url)) return 'docx'
  if (/html|xml/.test(tipo) || !tipo) return 'html'
  return null
}
