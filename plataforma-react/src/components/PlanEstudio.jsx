import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import { buscarEnPlan, cifras, PAGINAS_POR_RECURSO } from '../lib/planEstudio.js'

const num = (n) => Number(n).toLocaleString('es-CO')

// Plan de estudios global: por cada curso que hay en Praxia, cuántas estructuras (unidades),
// cuántos guiones por estructura y cuántas páginas se estima que tiene cada guion.
export default function PlanEstudio() {
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState('')
  const [buscar, setBuscar] = useState('')

  useEffect(() => {
    api('GET', '/seguimiento').then(setFilas).catch((e) => setError(e.message || 'No se pudo cargar el plan de estudios.'))
  }, [])

  const cursos = useMemo(() => (filas || []).map((f) => {
    const p = buscarEnPlan(f.curso)[0]
    return { ...f, c: p ? cifras(p, PAGINAS_POR_RECURSO) : null }
  }), [filas])
  const visibles = cursos.filter((f) => !buscar.trim() || (f.curso + ' ' + f.programa).toLowerCase().includes(buscar.trim().toLowerCase()))
  const conPlan = visibles.filter((f) => f.c)
  const suma = (k) => conPlan.reduce((a, f) => a + f.c[k], 0)

  // Excel sin dependencias: hoja en formato «XML Spreadsheet 2003», que Excel abre directamente.
  const descargar = () => {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const celda = (v) => typeof v === 'number' ? '<Cell><Data ss:Type="Number">' + v + '</Data></Cell>' : '<Cell><Data ss:Type="String">' + esc(v) + '</Data></Cell>'
    const fila = (a, b) => '<Row>' + a.map((v) => b ? '<Cell ss:StyleID="h"><Data ss:Type="String">' + esc(v) + '</Data></Cell>' : celda(v)).join('') + '</Row>'
    const cab = ['Curso', 'Programa', 'Estructuras', 'Guiones por estructura', 'Guiones', 'Recursos por guion', 'Páginas por guion (aprox.)', 'Páginas del curso (aprox.)']
    const datos = conPlan.map((f) => [f.curso, f.programa, f.c.estructuras, f.c.guionesPorEstructura, f.c.guiones, f.c.recursosPorGuion, f.c.paginasPorGuion, f.c.paginas])
    const total = ['Total', '', suma('estructuras'), '', suma('guiones'), '', '', suma('paginas')]
    const xml = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles><Worksheet ss:Name="Plan de estudios"><Table>' +
      fila(cab, true) + datos.map((d) => fila(d)).join('') + fila(total) + '</Table></Worksheet></Workbook>'
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'plan-de-estudios.xls' })
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  return (
    <div className="wrapx fade">
      <Titulo icono="seguimiento">
        <h1>Plan de estudios</h1>
        <p className="lead">Estructuras, guiones y páginas de cada curso que hay en Praxia, según el plan de asignaturas. Las páginas son aproximadas.</p>
      </Titulo>
      {error && <div className="msg bad" role="alert">{error}</div>}
      {!filas && !error && <p className="help">Cargando…</p>}
      {filas && (
        <>
          <section className="sg2-resumen" aria-label="Totales del plan">
            <div className="sg2-total"><b>{conPlan.length}</b><span>Cursos</span></div>
            <div className="sg2-leyenda">
              <span className="sg2-f"><b>{num(suma('estructuras'))}</b><span>Estructuras</span></span>
              <span className="sg2-f"><b>{num(suma('guiones'))}</b><span>Guiones</span></span>
              <span className="sg2-f"><b>≈ {num(suma('paginas'))}</b><span>Páginas</span></span>
            </div>
          </section>
          <div className="sg2-filtros">
            <label className="pl2-busca">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <input aria-label="Buscar curso o programa" placeholder="Buscar curso o programa" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            </label>
            <button className="btn sec sm" onClick={descargar} disabled={conPlan.length === 0}>Descargar Excel</button>
          </div>
          {visibles.length === 0 ? (
            <div className="drop"><p>No hay cursos para mostrar.</p></div>
          ) : (
            <div className="card sg2-caja">
              <table className="sg-tabla sg2-tabla">
                <thead><tr><th>Curso</th><th>Estructuras</th><th>Guiones por estructura</th><th>Guiones</th><th>Recursos por guion</th><th>Páginas por guion</th><th>Páginas del curso</th></tr></thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.propietario_id + f.id}>
                      <td><b>{f.curso}</b><small>{f.programa}</small></td>
                      {f.c ? (
                        <>
                          <td>{f.c.estructuras}</td>
                          <td>{f.c.guionesPorEstructura}</td>
                          <td>{f.c.guiones}</td>
                          <td>{f.c.recursosPorGuion}</td>
                          <td>≈ {f.c.paginasPorGuion}</td>
                          <td>≈ {num(f.c.paginas)}</td>
                        </>
                      ) : <td colSpan={6}><span className="sg2-no">Este curso no aparece en el plan de asignaturas</span></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
