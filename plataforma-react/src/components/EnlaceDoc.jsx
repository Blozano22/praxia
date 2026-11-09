import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Reconoce el tipo de enlace de Google y arma la dirección de vista previa (solo docs.google.com y drive.google.com).
export function analizar(url) {
  let u
  try { u = new URL(String(url || '').trim()) } catch { return null }
  if (u.protocol !== 'https:') return null
  const id = (re) => { const m = re.exec(u.pathname); return m ? m[1] : '' }
  if (u.hostname === 'docs.google.com') {
    const tipos = [['document', 'Documento de Google Docs', 'Abrir en Google Docs'], ['spreadsheets', 'Hoja de Google Sheets', 'Abrir en Google Sheets'], ['presentation', 'Presentación de Google Slides', 'Abrir en Google Slides']]
    for (const [seg, nombre, boton] of tipos) {
      const i = id(new RegExp('/' + seg + '/d/([A-Za-z0-9_-]+)'))
      if (i) return { clase: 'archivo', nombre, boton, host: u.hostname, href: u.href, vista: 'https://docs.google.com/' + seg + '/d/' + i + '/preview' }
    }
  }
  if (u.hostname === 'drive.google.com') {
    const i = id(/\/folders\/([A-Za-z0-9_-]+)/)
    if (i) return { clase: 'carpeta', nombre: 'Carpeta de Google Drive', boton: 'Abrir en Drive', host: u.hostname, href: u.href, vista: 'https://drive.google.com/embeddedfolderview?id=' + i + '#list' }
    const f = id(/\/file\/d\/([A-Za-z0-9_-]+)/)
    if (f) return { clase: 'archivo', nombre: 'Archivo de Google Drive', boton: 'Abrir en Drive', host: u.hostname, href: u.href, vista: 'https://drive.google.com/file/d/' + f + '/preview' }
  }
  return { clase: 'enlace', nombre: 'Enlace', boton: 'Abrir enlace', host: u.hostname, href: u.href, vista: '' }
}

const Icono = ({ clase }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {clase === 'carpeta'
      ? <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />
      : clase === 'enlace' ? <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7M14 10.5a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.2l1.7-1.7" />
      : <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>}
  </svg>
)

// Vista previa en ventana: un clic sobre la tarjeta la abre; dentro hay un botón para ir al sitio.
function Vista({ info, titulo, onCerrar, onAbrir }) {
  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onCerrar])
  // Se dibuja en <body>, fuera de la tarjeta: así ninguna unidad ni otro bloque de la página puede taparla.
  return createPortal(
    <div className="ed-fondo" role="dialog" aria-modal="true" aria-label={'Vista previa: ' + titulo} onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <div className="ed-vista">
        <div className="ed-barra">
          <div className="ed-tit"><small>{info.nombre}</small><b>{titulo}</b></div>
          <a className="btn" href={info.href} target="_blank" rel="noopener noreferrer" onClick={onAbrir}>{info.boton} ↗</a>
          <button className="btn sec" onClick={onCerrar}>Cerrar</button>
        </div>
        <div className="ed-marco">
          <iframe title={'Vista previa de ' + titulo} src={info.vista} sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" />
        </div>
        <p className="help ed-pie">Si la vista previa aparece en blanco, es que el documento pide iniciar sesión en Google. Use «{info.boton}».</p>
      </div>
    </div>,
    document.body
  )
}

// Tarjeta de un enlace: muestra si es documento o carpeta; clic = vista previa; botón = abrir en Google.
export default function EnlaceDoc({ url, titulo, vacio = 'Sin enlace', onVisto, compacto = false }) {
  const [ver, setVer] = useState(false)
  const info = analizar(url)
  if (!url || !info) {
    return <div className="ed-card vacia"><span className="ed-ico"><Icono clase="enlace" /></span><div className="ed-txt"><b>{titulo}</b><small>{url ? 'El enlace no es válido' : vacio}</small></div></div>
  }
  const abrirVista = () => { setVer(true); if (onVisto) onVisto() }
  return (
    <div className={'ed-card ' + info.clase + (compacto ? ' compacto' : '')}>
      <button type="button" className="ed-main" onClick={info.vista ? abrirVista : () => window.open(info.href, '_blank', 'noopener')} aria-label={(info.vista ? 'Ver vista previa de ' : 'Abrir ') + titulo}>
        <span className="ed-ico"><Icono clase={info.clase} /></span>
        <span className="ed-txt"><b>{titulo}</b><small>{info.nombre} · {info.host}</small></span>
        {info.vista && <span className="ed-ver">Vista previa</span>}
      </button>
      <a className="btn sec sm ed-abrir" href={info.href} target="_blank" rel="noopener noreferrer" onClick={onVisto}>{info.boton} ↗</a>
      {ver && <Vista info={info} titulo={titulo} onCerrar={() => setVer(false)} onAbrir={onVisto} />}
    </div>
  )
}
