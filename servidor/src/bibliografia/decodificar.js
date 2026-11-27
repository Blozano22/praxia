// Del archivo descargado (bytes) al texto, respetando la codificación que declara la página. Sin dependencias.
//
// Antes todo HTML se leía como UTF-8. Las páginas de Redalyc (p. ej. Pérez Alarcón, 2022) declaran ISO-8859-1: cada tilde
// llegaba como «�» («se iniciar� en el lugar…») al texto que se envía al modelo y al selector de extractos.
const etiqueta = (cs) => {
  const c = String(cs || '').trim().toLowerCase()
  if (!c) return ''
  return /^(?:iso-?8859-?1|latin-?1|l1)$/.test(c) ? 'windows-1252' : c // los navegadores leen ISO-8859-1 como windows-1252
}

export function decodificar(datos, tipo = '') {
  const cabecera = /charset\s*=\s*["']?([\w-]+)/i.exec(String(tipo || ''))
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(datos.subarray(0, 4096).toString('latin1'))
  const declarada = etiqueta((cabecera && cabecera[1]) || (meta && meta[1]))
  if (declarada && !/^utf-?8$/.test(declarada)) {
    try { return new TextDecoder(declarada).decode(datos) } catch { /* etiqueta desconocida: se sigue como si no hubiera declaración */ }
  }
  if (declarada) return new TextDecoder('utf-8').decode(datos) // declarada UTF-8: se respeta
  try { return new TextDecoder('utf-8', { fatal: true }).decode(datos) } catch { return new TextDecoder('windows-1252').decode(datos) } // sin declaración: UTF-8 si es válido; si no, ISO-8859-1
}
