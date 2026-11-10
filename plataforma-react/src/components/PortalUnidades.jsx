import { useRef, useState } from 'react'
import Bibliografia from './Bibliografia.jsx'
import { api } from '../lib/api.js'
import { RE_CARPETA, RE_DOC } from '../lib/syllabus.js'
import './portal.css'

const VACIA = { nombre: '', url: '' }
const ICONO_LINK = 'M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7M14 10.5a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.2l1.7-1.7'
const ICONO_CARPETA = 'M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10Z'

const IconoCampo = ({ d }) => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>

// Curso cuyas unidades ya están creadas: se indican los enlaces y la plataforma monta el curso sin pasar por n8n.
// Mismo recorrido visual que «Crear unidades desde el syllabus»: 1 datos del curso · 2 bibliografía · 3 unidades.
export default function PortalUnidades({ onCrear }) {
  const nombreDoc = useRef('') // nombre del documento de Google: es el nombre del curso, igual que al crear desde el syllabus
  const [url, setUrl] = useState('')
  const [carpeta, setCarpeta] = useState('')
  const [unidades, setUnidades] = useState([VACIA, VACIA, VACIA, VACIA])
  const [aviso, setAviso] = useState({})
  const [biblio, setBiblio] = useState(null) // {syllabusUrl, vez}
  const [biblioOk, setBiblioOk] = useState(false)
  const [error, setError] = useState('')

  const cambiar = (i, c) => setUnidades((l) => l.map((u, k) => (k === i ? { ...u, ...c } : u)))
  const quitar = (i) => setUnidades((l) => (l.length > 1 ? l.filter((_, k) => k !== i) : l))

  function leerBibliografia(ev) {
    ev.preventDefault()
    const syllabusUrl = url.trim()
    const a = {}
    if (!RE_DOC.test(syllabusUrl)) a.doc = 'Pega un enlace válido de Google Docs.'
    if (carpeta.trim() && !RE_CARPETA.test(carpeta.trim())) a.carpeta = 'Pega el enlace de una carpeta de Google Drive.'
    setAviso(a)
    if (a.doc || a.carpeta) return
    nombreDoc.current = ''
    api('GET', '/bibliografia/documento?url=' + encodeURIComponent(syllabusUrl)).then((r) => { nombreDoc.current = (r && r.nombre) || '' }).catch(() => { /* sin nombre: se usa el de respaldo */ })
    setBiblio((b) => ({ syllabusUrl, vez: (b ? b.vez : 0) + 1 }))
    setBiblioOk(false)
  }

  function montar() {
    setError('')
    const docs = []
    for (let i = 0; i < unidades.length; i++) {
      const u = unidades[i]
      if (!u.nombre.trim() && !u.url.trim()) continue
      if (!u.url.trim()) return setError('Falta el enlace del documento de la unidad ' + (i + 1) + '.')
      if (!RE_DOC.test(u.url.trim())) return setError('El enlace de la unidad ' + (i + 1) + ' debe ser de Google Docs.')
      docs.push({ unidad: docs.length + 1, nombre: u.nombre.trim() || 'Unidad ' + (docs.length + 1), url: u.url.trim(), aprobado: true, visto: true })
    }
    if (!docs.length) return setError('Agregue al menos una unidad con el enlace de su documento.')
    let bibliografiaId = ''
    try { bibliografiaId = sessionStorage.getItem('bib:' + biblio.syllabusUrl) || '' } catch { /* sin almacenamiento */ }
    onCrear({ programa: '', curso: nombreDoc.current || 'Curso sin nombre (' + new Date().toLocaleDateString() + ')', syllabusUrl: biblio.syllabusUrl, carpetaUrl: carpeta.trim(), documentos: docs, bibliografiaId }, 'unidades')
  }

  const conUnidades = unidades.some((u) => u.url.trim())
  const p1ok = !!biblio
  const p2ok = p1ok && biblioOk
  const bola = (ok, act, n) => <span className={'ps-bola' + (ok ? ' ok' : act ? ' act' : '')}>{ok ? '✓' : n}</span>
  const siguiente = !p1ok ? 'Pegue el enlace del syllabus y pulse «Leer la bibliografía».'
    : !p2ok ? 'Descargue y suba los documentos que faltan para completar la bibliografía.'
    : !conUnidades ? 'Pegue el enlace del documento de cada unidad.'
    : 'Todo está listo. Pulse «Montar el curso».'
  const items = [['Enlaces indicados', p1ok, !p1ok], ['Bibliografía completa', p2ok, p1ok && !p2ok], ['Unidades con su enlace', p2ok && conUnidades, p2ok && !conUnidades]]

  return (
    <div className="portal ps-portal">
      <div className="ps-col">

        <section className={'card ps-paso' + (p1ok ? ' hecho' : ' activo')} aria-labelledby="pu-t1">
          <div className="ps-cab">
            {bola(p1ok, !p1ok, 1)}
            <div className="ps-tit">
              <h2 id="pu-t1">Enlaces del syllabus</h2>
              {p1ok && <small>Syllabus indicado</small>}
            </div>
            {p1ok && <button className="btn sec sm" type="button" onClick={() => { setBiblio(null); setBiblioOk(false) }}>Cambiar</button>}
          </div>
          {!p1ok && (
            <form onSubmit={leerBibliografia} noValidate>
              <p className="card-copy">Las unidades del curso ya están creadas en Google Docs. Use el enlace del syllabus: de ahí se lee la bibliografía que respalda los guiones.</p>
              <div className="ps-campos">
                <div>
                  <label htmlFor="pu-syl">URL del syllabus</label>
                  <div className="input-wrap">
                    <IconoCampo d={ICONO_LINK} />
                    <input id="pu-syl" type="url" placeholder="https://docs.google.com/document/d/..." autoComplete="url" value={url} onChange={(e) => setUrl(e.target.value)} />
                  </div>
                  <p className="hint">{aviso.doc ? <b style={{ color: '#b73d32' }}>{aviso.doc}</b> : 'El documento debe permitir la lectura a cualquier persona con el enlace.'}</p>
                </div>
                <div>
                  <label htmlFor="pu-car">URL de la carpeta de Drive <span className="hint" style={{ margin: 0 }}>(opcional)</span></label>
                  <div className="input-wrap">
                    <IconoCampo d={ICONO_CARPETA} />
                    <input id="pu-car" type="url" placeholder="https://drive.google.com/drive/folders/..." autoComplete="url" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} />
                  </div>
                  <p className="hint">{aviso.carpeta ? <b style={{ color: '#b73d32' }}>{aviso.carpeta}</b> : 'La carpeta donde están los documentos de las unidades.'}</p>
                </div>
              </div>
              <button className="submit" type="submit">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>Leer la bibliografía</span>
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

        <section className={'card ps-paso' + (p2ok ? ' activo' : ' espera')} aria-label="Unidades ya creadas">
          <div className="ps-cab">
            {bola(false, p2ok, 3)}
            <div className="ps-tit">
              <h2>Unidades ya creadas</h2>
              <small>{p2ok ? 'Pegue el enlace del documento de cada unidad' : 'Se activa cuando la bibliografía esté completa'}</small>
            </div>
          </div>
          {p2ok && (
            <>
              <div className="pu-lista">
                {unidades.map((u, i) => (
                  <div className="pu-fila" key={i}>
                    <span className="pu-n">{i + 1}</span>
                    <input className="plain" type="text" aria-label={'Nombre de la unidad ' + (i + 1)} placeholder="Nombre de la unidad" value={u.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} />
                    <div className="input-wrap">
                      <IconoCampo d={ICONO_LINK} />
                      <input type="url" aria-label={'Documento de la unidad ' + (i + 1)} placeholder="Enlace del documento de la unidad" value={u.url} onChange={(e) => cambiar(i, { url: e.target.value })} />
                    </div>
                    <button type="button" className="pu-quitar" aria-label={'Quitar la unidad ' + (i + 1)} title="Quitar" disabled={unidades.length === 1} onClick={() => quitar(i)}>
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                ))}
              </div>
              <button className="btn sec sm" type="button" onClick={() => setUnidades((l) => [...l, VACIA])}>＋ Otra unidad</button>
              {error && <div className="msg bad" role="alert" style={{ marginTop: 14 }}>{error}</div>}
              <button className="submit" style={{ marginTop: 16 }} type="button" disabled={!conUnidades} onClick={montar}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>Montar el curso</span>
              </button>
            </>
          )}
        </section>
      </div>

      <aside className="ps-lado" aria-label="Qué sigue">
        <small>Qué sigue</small>
        <p>{siguiente}</p>
        <ul>
          {items.map(([t, ok, act]) => <li key={t} className={ok ? 'ok' : act ? 'act' : ''}><span>{ok ? '✓' : ''}</span>{t}</li>)}
        </ul>
        <em>No se envía nada a n8n: la plataforma guarda los enlaces y el curso queda listo para crear los guiones.</em>
      </aside>
    </div>
  )
}
