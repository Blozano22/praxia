import { useRef, useState } from 'react'
import Bibliografia from './Bibliografia.jsx'
import { api } from '../lib/api.js'
import { bibliografiaDeSyllabus, mensajeDeError, RE_CARPETA, RE_DOC } from '../lib/syllabus.js'
import { iniciarUnidades, olvidarTerminado, useTrabajoUnidades } from '../lib/trabajosUnidades.js'
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

// Mensaje según lo que devolvió n8n (la plataforma ya guardó el syllabus con ese resultado).
function estadoDeResultado(t, modo) {
  if (t.sinLista) return { state: 'success', title: 'El flujo terminó', message: 'Revisa tu carpeta.' }
  const conEnlace = t.documentos.filter((d) => d.url).length
  if (!conEnlace) return { state: 'error', title: 'n8n terminó, pero no devolvió enlaces', message: 'Se recibieron datos de las unidades, pero no una URL válida para abrir los documentos. Revisa el campo documento_generado.url en el nodo “Responder enlaces de plantillas”.' }
  if (conEnlace < t.documentos.length) return { state: 'error', title: 'Faltan algunos enlaces', message: `${conEnlace} de ${t.documentos.length} unidades recibieron una URL válida. Las unidades sin enlace aparecen en la lista.` }
  return { state: 'success', title: '¡Documentos listos!', message: `${conEnlace} documento${conEnlace === 1 ? '' : 's'} generado${conEnlace === 1 ? '' : 's'}, uno por unidad. ${modo === 'nuevo' ? 'Abriendo el syllabus…' : 'Selecciona una unidad para abrir su documento.'}` }
}

// Igual que el portal «syllabus-portal.html»: dos enlaces, «Generar documentos» y el resultado por unidad.
// El servidor crea las unidades con n8n; la plataforma guarda el resultado en el syllabus y permite verlo después.
export default function PortalSyllabus({ inicial, modo = 'nuevo', proyectoId = null, onAbrir }) {
  const [url, setUrl] = useState((inicial && inicial.syllabusUrl) || '')
  const [carpeta, setCarpeta] = useState((inicial && inicial.carpetaUrl) || '')
  const [lanzando, setLanzando] = useState(false) // enviando la orden al servidor
  const [local, setLocal] = useState(null) // aviso propio de este formulario {state,title,message} (p. ej. falta leer la bibliografía)
  const nombreDoc = useRef('') // nombre del documento de Google: es el nombre del syllabus
  const [aviso, setAviso] = useState({ doc: '', carpeta: '' })
  const [biblio, setBiblio] = useState(null) // {syllabusUrl, folderUrl, vez}: lectura de la bibliografía en curso
  const [biblioOk, setBiblioOk] = useState(false)

  async function enviar(ev) {
    ev.preventDefault()
    const syllabusUrl = url.trim()
    const folderUrl = carpeta.trim()
    const a = { doc: '', carpeta: '' }
    if (!RE_DOC.test(syllabusUrl)) a.doc = 'Pega un enlace válido de Google Docs.'
    if (!RE_CARPETA.test(folderUrl)) a.carpeta = 'Pega el enlace de una carpeta de Google Drive.'
    setAviso(a)
    if (a.doc || a.carpeta) return

    nombreDoc.current = ''
    api('GET', '/bibliografia/documento?url=' + encodeURIComponent(syllabusUrl)).then((r) => { nombreDoc.current = (r && r.nombre) || '' }).catch(() => { /* sin nombre: se usa el de respaldo */ })
    // Paso previo al envío: se lee TODA la bibliografía del syllabus. Hasta que todo esté leído no se avanza.
    setBiblio((b) => ({ syllabusUrl, folderUrl, vez: (b ? b.vez : 0) + 1 }))
    setBiblioOk(false)
  }

  // Creación de las unidades: solo se habilita cuando la bibliografía está completa (botón «Crear las unidades»).
  // La llamada a n8n la hace el servidor: sigue aunque se cierre la página y no se puede lanzar dos veces.
  async function generar(syllabusUrl, folderUrl) {
    setLanzando(true); setLocal(null)
    try {
      const bibliografiaId = await bibliografiaDeSyllabus(syllabusUrl) // la lectura completa de este syllabus, guardada en el servidor
      if (!bibliografiaId) throw new Error('Primero hay que leer la bibliografía del syllabus.')
      await iniciarUnidades({ syllabusUrl, carpetaUrl: folderUrl, bibliografiaId, curso: nombreDoc.current, proyecto: proyectoId })
    } catch (e) {
      setLocal({ state: 'error', title: 'No se pudo generar', message: mensajeDeError(e) })
    } finally { setLanzando(false) }
  }

  // El servidor es quien crea las unidades (lib/trabajosUnidades.js): aquí solo se muestra su estado, también al volver a entrar.
  const trabajo = useTrabajoUnidades(biblio ? biblio.syllabusUrl : '')
  const terminado = trabajo.terminado
  const ocupado = lanzando || trabajo.generando
  const docs = terminado ? terminado.documentos : []
  const guardado = terminado ? terminado.proyectoId || null : null // id del syllabus guardado
  const estado = local || (trabajo.generando
    ? { state: 'busy', title: 'Procesando syllabus', message: 'n8n está generando los documentos. Puede salir de esta pantalla: sigue en segundo plano y el curso aparecerá solo entre sus cursos.' }
    : trabajo.error ? { state: 'error', title: 'No se pudo generar', message: mensajeDeError(trabajo.error) }
    : terminado ? estadoDeResultado(terminado, modo) : null)

  // Estado de los tres pasos: 1 enlaces · 2 bibliografía · 3 crear las unidades.
  const p1ok = !!biblio
  const p2ok = !!biblio && biblioOk
  const p3ok = !!guardado
  const exito = estado && estado.state === 'success'
  const siguiente = !biblio ? 'Pegue los dos enlaces y pulse «' + (modo === 'regenerar' ? 'Volver a leer la bibliografía' : 'Leer la bibliografía') + '».'
    : !biblioOk ? 'Descargue y suba los documentos que faltan para completar la bibliografía.'
    : ocupado ? 'Estamos creando las unidades. Un momento.'
    : p3ok ? 'Listo. Póngale nombre y ábralo.'
    : exito ? 'Las unidades están listas. Revise los enlaces de cada documento.'
    : 'Todo está completo. Pulse «Crear las unidades».'
  const bola = (ok, act, n) => <span className={'ps-bola' + (ok ? ' ok' : act ? ' act' : '')}>{ok ? '✓' : n}</span>
  const items = [['Enlaces indicados', p1ok, !p1ok], ['Bibliografía completa', p2ok, p1ok && !p2ok], ['Unidades creadas', exito || p3ok, p2ok && !(exito || p3ok)]]

  return (
    <div className="portal ps-portal">
      <div className="ps-col">

        <section className={'card ps-paso' + (p1ok ? ' hecho' : ' activo')} aria-labelledby="form-title">
          <div className="ps-cab">
            {bola(p1ok, !p1ok, 1)}
            <div className="ps-tit">
              <h2 id="form-title">Enlaces del syllabus</h2>
              {p1ok && <small>Syllabus y carpeta de destino indicados</small>}
            </div>
            {p1ok && <button className="btn sec sm" type="button" disabled={ocupado} onClick={() => { setBiblio(null); setBiblioOk(false); setLocal(null); if (biblio) olvidarTerminado(biblio.syllabusUrl) }}>Cambiar</button>}
          </div>
          {!p1ok && (
            <form onSubmit={enviar} noValidate>
              <p className="card-copy">Usa el enlace del documento de Google Docs que contiene el syllabus.</p>
              <div className="ps-campos">
                <div>
                  <label htmlFor="syllabus-url">URL del syllabus</label>
                  <div className="input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7M14 10.5a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.2l1.7-1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                    <input id="syllabus-url" type="url" placeholder="https://docs.google.com/document/d/..." autoComplete="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={ocupado} />
                  </div>
                  <p className="hint">{aviso.doc ? <b style={{ color: '#b73d32' }}>{aviso.doc}</b> : 'El documento debe permitir la lectura a cualquier persona con el enlace.'}</p>
                </div>
                <div>
                  <label htmlFor="destination-folder-url">URL de la carpeta de destino</label>
                  <div className="input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.7" /></svg>
                    <input id="destination-folder-url" type="url" placeholder="https://drive.google.com/drive/folders/..." autoComplete="url" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} disabled={ocupado} />
                  </div>
                  <p className="hint">{aviso.carpeta ? <b style={{ color: '#b73d32' }}>{aviso.carpeta}</b> : 'Pega el enlace de la carpeta de Google Drive donde se guardarán las copias.'}</p>
                </div>
              </div>
              <button className="submit" type="submit" disabled={ocupado}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>{ocupado ? 'Procesando…' : (modo === 'regenerar' ? 'Volver a leer la bibliografía' : 'Leer la bibliografía')}</span>
              </button>
            </form>
          )}
        </section>

        <section className={'card ps-paso' + (p2ok ? ' hecho' : p1ok ? ' activo' : ' espera')} aria-label="Lectura de la bibliografía">
          <div className="ps-cab">
            {bola(p2ok, p1ok && !p2ok, 2)}
            <div className="ps-tit">
              <h2>Bibliografía</h2>
              <small>{!p1ok ? 'Se lee sola cuando termine el paso 1.' : p2ok ? 'Todas las referencias leídas' : 'Descargue y suba lo que falte'}</small>
            </div>
          </div>
          {biblio && <Bibliografia key={biblio.vez} fijo={{ syllabusUrl: biblio.syllabusUrl }} onEstado={setBiblioOk} />}
        </section>

        <section className={'card ps-paso' + (p3ok || exito ? ' hecho' : p2ok ? ' activo' : ' espera')} aria-label="Crear las unidades">
          <div className="ps-cab">
            {bola(p3ok || exito, p2ok && !(p3ok || exito), 3)}
            <div className="ps-tit">
              <h2>Crear las unidades</h2>
              <small>{p3ok || exito ? 'Un documento por unidad' : p2ok ? 'Todo listo para crearlas' : 'Se activa cuando la bibliografía esté completa'}</small>
            </div>
            {p2ok && !exito && !p3ok && <button className="btn gold" type="button" disabled={ocupado} onClick={() => generar(biblio.syllabusUrl, biblio.folderUrl)}>{ocupado ? 'Creando las unidades…' : 'Crear las unidades'}</button>}
          </div>
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
          {guardado && modo === 'nuevo' && (
            <div className="ps-guardado">
              <div className="card-kicker">Guardado en la plataforma</div>
              <h3>El resultado quedó guardado</h3>
              <p className="card-copy">El syllabus se guardó con el nombre de su documento de Google.</p>
              <button className="submit" style={{ marginTop: 16 }} type="button" onClick={() => onAbrir(guardado, 'docs')}>
                <span>Abrir el syllabus guardado</span>
              </button>
            </div>
          )}
        </section>
      </div>

      <aside className="ps-lado" aria-label="Qué sigue">
        <small>Qué sigue</small>
        <p>{siguiente}</p>
        <ul>
          {items.map(([t, ok, act]) => <li key={t} className={ok ? 'ok' : act ? 'act' : ''}><span>{ok ? '✓' : ''}</span>{t}</li>)}
        </ul>
        <em>Se envía el syllabus, la carpeta de destino y la bibliografía leída; n8n crea un documento por unidad.</em>
      </aside>
    </div>
  )
}
