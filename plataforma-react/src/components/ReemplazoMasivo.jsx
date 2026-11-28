import { useEffect, useRef, useState } from 'react'
import { api, RUTA_API } from '../lib/api.js'
import { verNombre } from '../lib/nombres.js'

const MAX_ARCHIVOS = 40
const BASE = RUTA_API.replace(/\/api$/, '')
const sinExt = (n) => n.replace(/\.html?$/i, '').toLowerCase()
const resumen = (l) => (l || []).map((p) => p.split(':')[0]).join(', ')

// Miniatura a escala (1280x720) de un HTML no confiable: sin allow-same-origin. Se monta solo al hacerse visible.
function Mini({ etiqueta, html, cargar, nombre, onAmpliar }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  const [doc, setDoc] = useState(null)
  const [fallo, setFallo] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined }
    const o = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setVisible(true); o.disconnect() } }, { rootMargin: '120px' })
    o.observe(el)
    return () => o.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || html != null || !cargar) return undefined
    let vivo = true
    cargar().then((t) => { if (vivo) setDoc(t) }).catch(() => { if (vivo) setFallo(true) })
    return () => { vivo = false }
  }, [visible, html, cargar])
  const d = html != null ? html : doc
  return (
    <figure className="rm-fig">
      <figcaption>{etiqueta}</figcaption>
      <button type="button" className="rm-mini" ref={ref} onClick={() => d && onAmpliar({ etiqueta, nombre, html: d })} aria-label={'Ampliar vista ' + etiqueta.toLowerCase() + ' de ' + nombre} disabled={!d}>
        {d && visible ? <iframe title={etiqueta + ' ' + nombre} srcDoc={d} sandbox="allow-scripts" tabIndex={-1} /> : <span className="rm-mini-vacio">{fallo ? 'Sin vista previa' : 'Cargando…'}</span>}
      </button>
    </figure>
  )
}

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
  const [grande, setGrande] = useState(null)
  const [sobre, setSobre] = useState(false)
  const entrada = useRef(null)

  const actual = (v) => async () => {
    const sub = (cats.subidas || {})[v]
    if (sub && sub.ejemplo) { const d = await api('GET', '/plantillas/subidas/' + encodeURIComponent(v) + '/ejemplo'); if (d && d.html) return d.html; throw new Error('x') }
    const r = await fetch(BASE + '/plantillas-html/' + v + '.html'); if (!r.ok) throw new Error('x')
    return (await r.text()).replace('{{TITULO}}', () => v).replace('/*CONTENIDO*/', () => '{}')
  }
  const cargarArchivos = async (todos) => {
    const fs = todos.slice(0, MAX_ARCHIVOS)
    if (!fs.length) return
    const nuevos = []
    for (const f of fs) nuevos.push({ id: f.name + Math.random(), archivo: f.name, html: await f.text(), variante: variantes.includes(sinExt(f.name)) ? sinExt(f.name) : '' })
    setItems(nuevos); setRes(null); setVerificado(false); setError('')
  }
  const elegir = (e) => { const fs = [...e.target.files]; e.target.value = ''; return cargarArchivos(fs) }
  const soltar = (e) => { e.preventDefault(); setSobre(false); if (!ocupado && !hecho) cargarArchivos([...e.dataTransfer.files].filter((f) => /\.html?$/i.test(f.name))) }
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
      <div className="sv-ventana rm-ventana" role="dialog" aria-modal="true" aria-label="Reemplazar en masa">
        <header className="sv-cab">
          <h2>Reemplazar en masa · {categoria}</h2>
          <button type="button" className="sv-x" aria-label="Cerrar" onClick={onCerrar} disabled={ocupado}>×</button>
        </header>
        <div className="sv-cuerpo rm-cuerpo">
          {error && <div className="msg bad" role="alert">{error}</div>}
          {hecho && <div className="msg ok" role="status">Se reemplazaron las {items.length} variantes.</div>}
          <p className="help">Se reemplazan <b>todas a la vez o ninguna</b>. Los campos se comparan entre los archivos nuevos y con las variantes de la categoría{formacion ? ' y formación' : ''} que no se reemplacen. Cada archivo se asocia a su variante por el nombre del archivo.</p>
          {!hecho && (
            <div className={'rm-zona' + (sobre ? ' sobre' : '')} onDragOver={(e) => { e.preventDefault(); setSobre(true) }} onDragLeave={() => setSobre(false)} onDrop={soltar}>
              <input ref={entrada} type="file" multiple accept=".html,.htm,text/html" onChange={elegir} disabled={ocupado} hidden />
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
              <span>Arrastra aquí los archivos .html o</span>
              <button type="button" className="btn sec" onClick={() => entrada.current && entrada.current.click()} disabled={ocupado}>Elegir archivos .html</button>
              <small>{items.length ? items.length + (items.length === 1 ? ' archivo elegido' : ' archivos elegidos') : 'Ningún archivo elegido'} · máximo {MAX_ARCHIVOS}</small>
            </div>
          )}
          {items.length > 0 && (
            <ul className="rm-lista">
              {items.map((i) => {
                const r = i.variante ? de(i.variante) : null
                const rep = i.variante && repetidas.includes(i.variante)
                return (
                  <li key={i.id} className={'rm-item' + (r ? (r.ok ? ' ok' : ' mal') : '') + (!i.variante ? ' sin' : '')}>
                    <div className="rm-info">
                      <b className="rm-arch">{i.archivo}</b>
                      <label className="rm-sel">
                        <span>Variante</span>
                        <select value={i.variante} disabled={ocupado || hecho} onChange={(e) => cambiar(i.id, e.target.value)} aria-label={'Variante de ' + i.archivo}>
                          <option value="">Sin variante con ese nombre</option>
                          {variantes.map((v) => <option key={v} value={v}>{verNombre(v)}</option>)}
                        </select>
                      </label>
                      {!i.variante && <span className="rm-chip mal">Sin variante con ese nombre</span>}
                      {rep && <span className="rm-chip mal">Variante repetida</span>}
                      {r && (r.ok
                        ? <span className="rm-chip ok">Correcto</span>
                        : <span className="rm-chip mal">{r.error || 'No cumple'}{r.faltan && r.faltan.length ? ' · faltan: ' + resumen(r.faltan) : ''}{r.sobran && r.sobran.length ? ' · sobran: ' + resumen(r.sobran) : ''}{r.referencia ? ' (contra ' + r.referencia + ')' : ''}</span>)}
                    </div>
                    <div className="rm-minis">
                      {i.variante
                        ? <Mini key={i.variante} etiqueta="Actual" nombre={i.variante} cargar={actual(i.variante)} onAmpliar={setGrande} />
                        : <figure className="rm-fig"><figcaption>Actual</figcaption><div className="rm-mini"><span className="rm-mini-vacio">Sin variante</span></div></figure>}
                      <span className="rm-flecha" aria-hidden="true">→</span>
                      <Mini etiqueta="Nueva" nombre={i.archivo} html={i.html} onAmpliar={setGrande} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <footer className="sv-pie">
          <button type="button" className="btn sec" onClick={onCerrar} disabled={ocupado}>{hecho ? 'Cerrar' : 'Cancelar'}</button>
          {!hecho && <button type="button" className="btn sec" disabled={ocupado || !completo} onClick={() => enviar(true)}>{ocupado ? 'Verificando…' : 'Verificar'}</button>}
          {!hecho && <button type="button" className="btn" disabled={ocupado || !completo || !verificado} onClick={() => enviar(false)}>Reemplazar todas</button>}
        </footer>
      </div>
      {grande && (
        <div className="rm-grande" role="dialog" aria-modal="true" aria-label="Vista ampliada" onMouseDown={(e) => { if (e.target === e.currentTarget) setGrande(null) }}>
          <div className="rm-grande-c">
            <header><b>{grande.etiqueta} · {grande.nombre}</b><button type="button" className="sv-x" aria-label="Cerrar vista ampliada" onClick={() => setGrande(null)}>×</button></header>
            <div className="rm-grande-m"><iframe title="Vista ampliada" srcDoc={grande.html} sandbox="allow-scripts" /></div>
          </div>
        </div>
      )}
    </div>
  )
}
