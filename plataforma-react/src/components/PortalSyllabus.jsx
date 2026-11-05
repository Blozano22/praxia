import { useState } from 'react'
import { generarDocumentos, mensajeDeError, RE_CARPETA, RE_DOC } from '../lib/syllabus.js'
import './portal.css'

const Icono = ({ d }) => <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>

function Resultado({ doc }) {
  const [copiado, setCopiado] = useState('')
  const copiar = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(doc.url)
      else {
        const t = document.createElement('textarea')
        t.value = doc.url; t.style.position = 'fixed'; t.style.opacity = '0'
        document.body.appendChild(t); t.select()
        const ok = document.execCommand('copy'); t.remove()
        if (!ok) throw new Error('No se pudo copiar')
      }
      setCopiado('Ruta copiada'); setTimeout(() => setCopiado(''), 1800)
    } catch (e) { setCopiado('Selecciona y copia la ruta') }
  }
  return (
    <article className="result-card">
      <div className="result-title">Unidad {doc.unidad} · {doc.nombre}</div>
      {doc.url ? (
        <>
          <a className="result-url" href={doc.url} target="_blank" rel="noopener noreferrer">{doc.url}</a>
          <div className="result-actions">
            <a className="result-action" href={doc.url} target="_blank" rel="noopener noreferrer">Abrir documento</a>
            <button className="result-action" type="button" onClick={copiar}>{copiado || 'Copiar ruta'}</button>
          </div>
        </>
      ) : <div className="result-url">n8n no devolvió la URL de este documento.</div>}
    </article>
  )
}

// Igual que el portal «syllabus-portal.html»: dos enlaces, «Generar documentos» y el resultado por unidad.
// La plataforma solo guarda el resultado (onResultado) y permite verlo después.
export default function PortalSyllabus({ inicial, modo = 'nuevo', onResultado, onNombrar, onAbrir }) {
  const [url, setUrl] = useState((inicial && inicial.syllabusUrl) || '')
  const [carpeta, setCarpeta] = useState((inicial && inicial.carpetaUrl) || '')
  const [ocupado, setOcupado] = useState(false)
  const [estado, setEstado] = useState(null) // {state,title,message}
  const [docs, setDocs] = useState([])
  const [guardado, setGuardado] = useState(null) // id del syllabus guardado
  const [nombres, setNombres] = useState({ programa: '', curso: '' })
  const [aviso, setAviso] = useState({ doc: '', carpeta: '' })

  async function enviar(ev) {
    ev.preventDefault()
    const syllabusUrl = url.trim()
    const folderUrl = carpeta.trim()
    const a = { doc: '', carpeta: '' }
    if (!RE_DOC.test(syllabusUrl)) a.doc = 'Pega un enlace válido de Google Docs.'
    if (!RE_CARPETA.test(folderUrl)) a.carpeta = 'Pega el enlace de una carpeta de Google Drive.'
    setAviso(a)
    if (a.doc || a.carpeta) return

    setOcupado(true); setDocs([]); setGuardado(null)
    setEstado({ state: 'busy', title: 'Procesando syllabus', message: 'n8n está generando los documentos. Las rutas aparecerán aquí cuando termine.' })
    try {
      const r = await generarDocumentos({ syllabusUrl, carpetaUrl: folderUrl })
      setDocs(r.documentos)
      const conEnlace = r.documentos.filter((d) => d.url).length
      if (!conEnlace) setEstado({ state: 'error', title: 'n8n terminó, pero no devolvió enlaces', message: 'Se recibieron datos de las unidades, pero no una URL válida para abrir los documentos. Revisa el campo documento_generado.url en el nodo “Responder enlaces de plantillas”.' })
      else if (conEnlace < r.documentos.length) setEstado({ state: 'error', title: 'Faltan algunos enlaces', message: `${conEnlace} de ${r.documentos.length} unidades recibieron una URL válida. Las unidades sin enlace aparecen en la lista.` })
      else setEstado({ state: 'success', title: '¡Documentos listos!', message: `${conEnlace} documento${conEnlace === 1 ? '' : 's'} generado${conEnlace === 1 ? '' : 's'}, uno por unidad. Selecciona una unidad para abrir su documento.` })
      setGuardado(onResultado({ syllabusUrl, carpetaUrl: folderUrl, documentos: r.documentos, estado: 'listo', mensaje: '', programa: r.programa, curso: r.curso }))
    } catch (e) {
      if (e.code === 'NO_DOCUMENT_LIST') {
        setEstado({ state: 'success', title: 'El flujo terminó', message: 'Revisa tu carpeta.' })
        setGuardado(onResultado({ syllabusUrl, carpetaUrl: folderUrl, documentos: [], estado: 'listo', mensaje: 'El flujo terminó. Revisa la carpeta de destino.', programa: e.programa, curso: e.curso }))
      } else {
        setEstado({ state: 'error', title: 'No se pudo generar', message: mensajeDeError(e) })
      }
    } finally { setOcupado(false) }
  }

  return (
    <div className="portal">
      <section className="card form-card" aria-labelledby="form-title">
        <div className="card-kicker">Inicio rápido</div>
        <h2 id="form-title">Envía tu syllabus</h2>
        <p className="card-copy">Usa el enlace del documento de Google Docs que contiene el syllabus.</p>
        <form onSubmit={enviar} noValidate>
          <label htmlFor="syllabus-url">URL del syllabus</label>
          <div className="input-wrap">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7M14 10.5a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.2l1.7-1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            <input id="syllabus-url" type="url" placeholder="https://docs.google.com/document/d/..." autoComplete="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={ocupado} />
          </div>
          <p className="hint">{aviso.doc ? <b style={{ color: '#b73d32' }}>{aviso.doc}</b> : 'El documento debe permitir la lectura a cualquier persona con el enlace.'}</p>
          <label htmlFor="destination-folder-url">URL de la carpeta de destino</label>
          <div className="input-wrap">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.7" /></svg>
            <input id="destination-folder-url" type="url" placeholder="https://drive.google.com/drive/folders/..." autoComplete="url" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} disabled={ocupado} />
          </div>
          <p className="hint">{aviso.carpeta ? <b style={{ color: '#b73d32' }}>{aviso.carpeta}</b> : 'Pega el enlace de la carpeta de Google Drive donde se guardarán las copias.'}</p>
          <button className="submit" type="submit" disabled={ocupado}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{ocupado ? 'Procesando…' : (modo === 'regenerar' ? 'Volver a generar documentos' : 'Generar documentos')}</span>
          </button>
        </form>
        {estado && (
          <div className={'status-box show' + (estado.state === 'error' ? ' error' : '')} role="status" aria-live="polite">
            <div className="status-top">
              {estado.state === 'busy' ? <span className="spinner" aria-hidden="true" /> : <span className="status-icon"><Icono d={estado.state === 'error' ? 'm4 4 8 8M12 4 4 12' : 'm3.5 8 3 3 6-6'} /></span>}
              <span className="status-title">{estado.title}</span>
            </div>
            <p className="status-text">{estado.message}</p>
            <div className="results">{docs.map((d, i) => <Resultado key={i} doc={d} />)}</div>
          </div>
        )}
      </section>

      {guardado && modo === 'nuevo' && (
        <section className="card form-card saved">
          <div className="card-kicker">Guardado en la plataforma</div>
          <h2>El resultado quedó guardado</h2>
          <p className="card-copy">Si quiere, póngale nombre para ordenarlo en el dashboard por programa. Es opcional.</p>
          <label htmlFor="n-prog">Programa</label>
          <input className="plain" id="n-prog" type="text" placeholder="Ej.: Licenciatura en Educación Comunitaria" value={nombres.programa} onChange={(e) => setNombres({ ...nombres, programa: e.target.value })} />
          <label htmlFor="n-curso" style={{ marginTop: 12 }}>Curso o asignatura</label>
          <input className="plain" id="n-curso" type="text" placeholder="Ej.: Didáctica" value={nombres.curso} onChange={(e) => setNombres({ ...nombres, curso: e.target.value })} />
          <button className="submit" style={{ marginTop: 16 }} type="button" onClick={() => { onNombrar(guardado, nombres.programa.trim(), nombres.curso.trim()); onAbrir(guardado) }}>
            <span>Abrir el syllabus guardado</span>
          </button>
        </section>
      )}
    </div>
  )
}
