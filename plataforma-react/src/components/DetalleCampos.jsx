// Detalle de lo que no coincide entre una plantilla y las demás de su categoría. Las rutas llegan como «bloques[].titulo:texto»:
// se les quita el tipo («:texto», «:[]»…) para que se lean bien.
export const campoLegible = (ruta) => String(ruta || '').replace(/:[^:.\]]*$/, '')

export default function DetalleCampos({ faltan = [], sobran = [], referencia = '', abierto = false }) {
  if (!faltan.length && !sobran.length) return null
  return (
    <details className="dc-detalle" open={abierto}>
      <summary>Ver qué campos cambian{referencia ? ' (comparada con ' + referencia.toUpperCase() + ')' : ''}</summary>
      {faltan.length > 0 && <p><b>Le faltan:</b> {faltan.map(campoLegible).join(', ')}</p>}
      {sobran.length > 0 && <p><b>Le sobran:</b> {sobran.map(campoLegible).join(', ')}</p>}
    </details>
  )
}
