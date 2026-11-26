import { useState } from 'react'
import { api } from '../lib/api.js'
import { verNombre } from '../lib/nombres.js'

const MAX_ARCHIVOS = 40
const sinExt = (n) => n.replace(/\.html?$/i, '').toLowerCase()
const resumen = (l) => (l || []).map((p) => p.split(':')[0]).join(', ')

// Ventana «Reemplazar en masa»: varias variantes de una categoría (y formación) se reemplazan TODAS a la vez o NINGUNA.
// Cada archivo se asocia a su variante por el nombre del archivo (act-e-10-tec-p-v1.html ↔ act-e-10-tec-p-v1); se puede corregir la asociación.
export default function ReemplazoMasivo({ categoria, formacion = '', cats, onCerrar, onHecho }) {
  const variantes = Object.keys(cats.subidas || {}).filter((n) => (cats.asignaciones || {})[n] === categoria && (!formacion || !cats.subidas[n].formacion || cats.subidas[n].formacion === formacion)).sort()
  const [items, setItems] = useState([]) // { id, archivo, html, variante }
  const [res, setRes] = useState(null) // resultados del servidor por variante
  const [verificado, setVerificado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState(false)

  const elegir = async (e) => {
    const fs = [...e.target.files].slice(0, MAX_ARCHIVOS)
    e.target.value = ''
    if (!fs.length) return
    const nuevos = []
    for (const f of fs) nuevos.push({ id: f.name + Math.random(), archivo: f.name, html: await f.text(), variante: variantes.includes(sinExt(f.name)) ? sinExt(f.name) : '' })
    setItems(nuevos); setRes(null); setVerificado(false); setError('')
  }
  const cambiar = (id, variante) => { setItems((l) => l.map((i) => (i.id === id ? { ...i, variante } : i))); setRes(null); setVerificado(false) }
  const repetidas = items.filter((i) => i.variante && items.filter((x) => x.variante === i.variante).length > 1).map((i) => i.variante)
  const completo = items.length > 0 && items.every((i) => i.variante) && !repetidas.length

  const enviar = async (soloVerificar) => {
    setOcupado(true); setError('')
    try {
      const r = await api('POST', '/plantillas/subidas/reemplazo-masivo', { archivos: items.map((i) => ({ nombre: i.variante, html: i.html })), soloVerificar })
      setRes(r.resultados); setVerificado(true)
      if (!soloVerificar) { setHecho(true); onHecho && onHecho(r.resultados.length) }
    } catch (e) {
      setRes(e.datos && e.datos.resultados ? e.datos.resultados : null); setVerificado(false); setError(e.message)
    } finally { setOcupado(false) }
  }
  const de = (v) => (res || []).find((r) => r.nombre === v)

  return (
    <div className="sv-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onCerrar() }}>
      <div className="sv-ventana" role="dialog" aria-modal="true" aria-label="Reemplazar en masa" style={{ maxWidth: 760 }}>
        <header className="sv-cab">
          <h2>Reemplazar en masa · {categoria}</h2>
          <button type="button" className="sv-x" aria-label="Cerrar" onClick={onCerrar} disabled={ocupado}>×</button>
        </header>
        <div className="sv-cuerpo">
          {error && <div className="msg bad" role="alert">{error}</div>}
          {hecho && <div className="msg ok" role="status">Se reemplazaron las {items.length} variantes.</div>}
          <p className="help">Se reemplazan <b>todas a la vez o ninguna</b>. Los campos se comparan entre los archivos nuevos y con las variantes de la categoría{formacion ? ' y formación' : ''} que no se reemplacen. Cada archivo se asocia a su variante por el nombre del archivo.</p>
          {!hecho && <input type="file" multiple accept=".html,.htm,text/html" onChange={elegir} disabled={ocupado} aria-label="Elegir archivos .html" />}
          {items.length > 0 && (
            <table className="tabla">
              <thead><tr><th>Archivo</th><th>Variante</th><th>Verificación</th></tr></thead>
              <tbody>
                {items.map((i) => {
                  const r = i.variante ? de(i.variante) : null
                  return (
                    <tr key={i.id}>
                      <td>{i.archivo}</td>
                      <td>
                        <select value={i.variante} disabled={ocupado || hecho} onChange={(e) => cambiar(i.id, e.target.value)} aria-label={'Variante de ' + i.archivo} style={i.variante ? undefined : { color: '#b42318', borderColor: '#b42318' }}>
                          <option value="">sin variante</option>
                          {variantes.map((v) => <option key={v} value={v}>{verNombre(v)}</option>)}
                        </select>
                        {!i.variante && <small style={{ color: '#b42318', display: 'block' }}>sin variante</small>}
                        {i.variante && repetidas.includes(i.variante) && <small style={{ color: '#b42318', display: 'block' }}>repetida</small>}
                      </td>
                      <td>
                        {r ? (r.ok ? <span style={{ color: '#1a7f37' }}>✔ Correcto</span> : <span style={{ color: '#b42318' }}>✖ {r.error || 'No cumple'}{r.faltan && r.faltan.length ? ' · faltan: ' + resumen(r.faltan) : ''}{r.sobran && r.sobran.length ? ' · sobran: ' + resumen(r.sobran) : ''}{r.referencia ? ' (contra ' + r.referencia + ')' : ''}</span>) : <small>—</small>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <footer className="sv-pie">
          <button type="button" className="btn sec" onClick={onCerrar} disabled={ocupado}>{hecho ? 'Cerrar' : 'Cancelar'}</button>
          {!hecho && <button type="button" className="btn sec" disabled={ocupado || !completo} onClick={() => enviar(true)}>{ocupado ? 'Verificando…' : 'Verificar'}</button>}
          {!hecho && <button type="button" className="btn" disabled={ocupado || !completo || !verificado} onClick={() => enviar(false)}>Reemplazar todas</button>}
        </footer>
      </div>
    </div>
  )
}
