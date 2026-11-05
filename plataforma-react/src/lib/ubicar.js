// Los códigos de recurso del guion indican dónde van: U2-T1-OVA1 → unidad 2, tema 1; U2-PRES → unidad 2 (introducción).
export function ubicar(codigo) {
  const m = /(?:^|[^A-Za-z])U[N]?(\d+)(?:-T(\d+))?/i.exec(codigo || '')
  return { unidad: m ? Number(m[1]) : null, tema: m && m[2] ? Number(m[2]) : null }
}

export const etiquetaTema = (t) => (t == null ? 'Introducción de la unidad' : 'Tema ' + t)
