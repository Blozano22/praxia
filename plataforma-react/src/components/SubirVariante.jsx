import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { ListaCategorias, kb, MAX_BYTES } from './CategoriasPlantillas.jsx'

// Ventana «Subir variante»: una plantilla HTML nueva en una categoría. El nombre lo genera el servidor (ID de la categoría + orden: g-08-v01…).
// Se abre desde la galería de diseños; al subir, la galería recarga las categorías y muestra el nombre que se le dio.
export default function SubirVariante({ cats, categoriaInicial = '', onCerrar, onSubida }) {
  const [categoria, setCategoria] = useState(categoriaInicial)
  const [archivo, setArchivo] = useState({ nombre: '', bytes: 0, html: '' })
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [arrastrando, setArrastrando] = useState(false)
  const entrada = useRef(null)

  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape' && !ocupado) onCerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ocupado, onCerrar])

  const leer = async (f) => {
    if (!f) return
    if (f.size > MAX_BYTES) { setError('El archivo pesa ' + kb(f.size) + ' y el máximo es 1,5 MB.'); return }
    let html = ''
    try { html = await f.text() } catch { setError('No se pudo leer el archivo.'); return }
    setError('')
    setArchivo({ nombre: f.name, bytes: f.size, html })
  }
  const subir = async (e) => {
    e.preventDefault()
    if (!categoria || !archivo.html || ocupado) return
    setOcupado(true); setError('')
    try {
      const r = await api('POST', '/plantillas/subidas', { html: archivo.html, categoria })
      await onSubida(r && r.nombre)
      onCerrar()
    } catch (err) { setError(err.message || 'No se pudo subir la plantilla.'); setOcupado(false) }
  }

  return (
    <div className="sv-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onCerrar() }}>
      <form className="sv-ventana" role="dialog" aria-modal="true" aria-label="Subir variante" onSubmit={subir}>
        <header className="sv-cab">
          <span className="sv-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg></span>
          <h2>Subir variante</h2>
          <button type="button" className="sv-x" aria-label="Cerrar" onClick={onCerrar} disabled={ocupado}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </header>
        <div className="sv-cuerpo">
          {error && <div className="msg bad" role="alert">{error}</div>}
          <div className="sv-campo">
            <span className="sv-lbl">Categoría</span>
            <ListaCategorias valor={categoria} categorias={cats.categorias} ocupado={ocupado} onChange={setCategoria} etiqueta="Categoría" vacio="Elegir categoría…" />
            <small>{categoria ? 'El nombre se genera solo: ' + categoria.toLowerCase() + '-v01, -v02… según el orden de subida.' : 'El nombre se genera solo con el ID de la categoría: G-08-V01…'}</small>
          </div>
          <input ref={entrada} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; leer(f) }} />
          <button type="button" className={'sv-zona' + (arrastrando ? ' sobre' : '') + (archivo.html ? ' lleno' : '')} onClick={() => entrada.current.click()}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }} onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); leer(e.dataTransfer.files[0]) }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
            {archivo.html
              ? <><b>{archivo.nombre}</b><span>{kb(archivo.bytes)} · pulse para cambiar el archivo</span></>
              : <><b>Elegir archivo HTML</b><span>o arrástrelo aquí · hasta 1,5 MB</span></>}
          </button>
          <details className="sv-reglas">
            <summary>Reglas del archivo</summary>
            <p>Página HTML completa con <b>una sola</b> marca <code>{'{{TITULO}}'}</code> y <b>una sola</b> <code>{'/*CONTENIDO*/'}</code>: ahí pone n8n el título y el contenido. Hasta 1,5 MB. Si usa <code>{'/*CSS*/'}</code> o <code>{'/*LIB*/'}</code>, el sistema incrusta los estilos y el código comunes, igual que en las demás plantillas.</p>
          </details>
        </div>
        <footer className="sv-pie">
          <button type="button" className="btn sec" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
          <button type="submit" className="btn" disabled={ocupado || !categoria || !archivo.html}>{ocupado ? 'Subiendo…' : 'Subir variante'}</button>
        </footer>
      </form>
    </div>
  )
}
