// Consumo de IA que n8n avisa por recurso: { texto: {modelo, entrada, salida, llamadas}, imagenes: [{…}], costo_estimado_usd, costo_parcial }.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
export const tokensDe = (c) => (c && c.texto ? num(c.texto.entrada) + num(c.texto.salida) : 0)
export const imagenesDe = (c) => (c && Array.isArray(c.imagenes) ? c.imagenes.length : 0)
export const costoDe = (c) => (c ? num(c.costo_estimado_usd) : 0)
export const usd = (v) => 'US$ ' + (v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2))
export const miles = (n) => Math.round(n).toLocaleString('es-CO')

// Total del curso. «parcial»: algún costo es parcial o hay recursos generados sin consumo avisado.
export function resumenConsumo(recursos) {
  let tokens = 0, imagenes = 0, costo = 0, conConsumo = 0, parcial = false
  for (const r of recursos) {
    if (r.consumo) {
      conConsumo++; tokens += tokensDe(r.consumo); imagenes += imagenesDe(r.consumo); costo += costoDe(r.consumo)
      if (r.consumo.costo_parcial) parcial = true
    } else if (['GENERADO', 'POR_REVISAR'].includes(r.estado)) parcial = true
  }
  return { tokens, imagenes, costo, conConsumo, parcial }
}

// Enlace https de una imagen (misma regla que el servidor).
export const esUrlImagen = (v) => typeof v === 'string' && v.length <= 500 && /^https:\/\/[^\s"'<>]+$/.test(v)
