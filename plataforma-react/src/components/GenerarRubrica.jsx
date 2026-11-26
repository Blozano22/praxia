import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import './rubricas.css'

// «Generar rúbrica»: se pegan los enlaces de las unidades de una asignatura y la carpeta de Drive donde guardar; Praxia pide a n8n que cree la rúbrica en Google Sheets
// (una copia de la plantilla, con la hoja que corresponde a sus créditos). El servidor llama a n8n en segundo plano (30 s a 2 min) y esta pantalla pregunta cómo va.

const esDoc = (u) => /^https:\/\/docs\.google\.com\/document\/d\/[\w-]{20,}/.test(u) || /^https:\/\/drive\.google\.com\/.*[?&]id=[\w-]{20,}/.test(u)
const esCarpeta = (u) => /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[\w-]{10,}/.test(u)
const MAX_UNIDADES = 12

const PASOS = [
  ['Pegue las unidades', 'El enlace del documento de cada unidad de la asignatura, uno por línea.'],
  ['Indique la carpeta', 'Una carpeta de Drive compartida como Editor con la cuenta de automatización.'],
  ['Genere', 'Se crea una copia de la plantilla y se llena la hoja que corresponde a los créditos.']
]

export default function GenerarRubrica() {
  const [unidades, setUnidades] = useState('')
  const [carpeta, setCarpeta] = useState('')
  const [tocado, setTocado] = useState(false)
  const [configurada, setConfigurada] = useState(null)
  const [trabajo, setTrabajo] = useState(null) // { id, estado, segundos, url, log, avisos, error }
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState('')
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  useEffect(() => { api('GET', '/rubricas/estado').then((d) => { if (vivo.current) setConfigurada(!!d.configurada) }).catch(() => { if (vivo.current) setConfigurada(true) }) }, [])

  const lista = [...new Set(unidades.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean))]
  const malasUnidades = lista.filter((u) => !esDoc(u))
  const errUnidades = !lista.length ? 'Pegue al menos un enlace.' : lista.length > MAX_UNIDADES ? 'Máximo ' + MAX_UNIDADES + ' unidades.' : malasUnidades.length ? 'Cada línea debe ser el enlace de un Google Doc (docs.google.com/document/d/…). Revise: ' + malasUnidades[0].slice(0, 60) + (malasUnidades[0].length > 60 ? '…' : '') : ''
  const errCarpeta = !carpeta.trim() ? 'Pegue el enlace de la carpeta.' : !esCarpeta(carpeta.trim()) ? 'Debe ser el enlace de una carpeta de Drive (drive.google.com/drive/folders/…).' : ''
  const enCurso = !!trabajo && trabajo.estado === 'en_curso'

  // mientras se genera, se pregunta cada 2 s
  useEffect(() => {
    if (!enCurso) return undefined
    const t = setInterval(() => {
      api('GET', '/rubricas/' + trabajo.id).then((d) => { if (vivo.current) setTrabajo((x) => (x && x.id === trabajo.id ? { ...x, ...d } : x)) })
        .catch((e) => { if (vivo.current && e.estado === 404) setTrabajo((x) => (x ? { ...x, estado: 'error', error: 'Se perdió el seguimiento (el servidor se reinició). Revise la carpeta: puede que la rúbrica sí se haya creado.' } : x)) })
    }, 2000)
    return () => clearInterval(t)
  }, [enCurso, trabajo && trabajo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const generar = async (e) => {
    e.preventDefault()
    setTocado(true); setErrorEnvio('')
    if (errUnidades || errCarpeta || enviando || enCurso) return
    setEnviando(true)
    try {
      const d = await api('POST', '/rubricas', { unidades: lista, carpeta_url: carpeta.trim() })
      setTrabajo({ id: d.id, estado: 'en_curso', segundos: 0, url: '', log: [], avisos: 0, error: '' })
    } catch (er) { setErrorEnvio(er.message || 'No se pudo iniciar.') }
    setEnviando(false)
  }

  return (
    <div className="wrapx fade rb">
      <Titulo icono="revision">
        <h1>Generar rúbrica</h1>
        <p className="lead">Cree la rúbrica de evaluación de una asignatura en Google Sheets a partir de los documentos de sus unidades.</p>
      </Titulo>

      {configurada === false && <div className="msg warn" role="status">La generación de rúbricas todavía no está conectada: la administración debe guardar la dirección del flujo en «Conexión con n8n».</div>}

      <div className="rb-cuerpo">
        <form className="card rb-form" onSubmit={generar} noValidate>
          <div className="rb-campo">
            <label htmlFor="rb-unidades">Documentos de las unidades {lista.length > 0 && <span className="rb-cuenta">{lista.length} {lista.length === 1 ? 'unidad' : 'unidades'}</span>}</label>
            <textarea id="rb-unidades" rows={5} value={unidades} onChange={(e) => setUnidades(e.target.value)} aria-invalid={tocado && !!errUnidades} disabled={enCurso}
              placeholder={'https://docs.google.com/document/d/… (Unidad 1)\nhttps://docs.google.com/document/d/… (Unidad 2)\nhttps://docs.google.com/document/d/… (Unidad 3)'} />
            <small className="rb-ayuda">Un enlace por línea. Pegue todas las unidades de la asignatura para llenar todos los cortes en la misma rúbrica.</small>
            {tocado && errUnidades && <small className="rb-err">{errUnidades}</small>}
          </div>
          <div className="rb-campo">
            <label htmlFor="rb-carpeta">Carpeta donde se guarda</label>
            <input id="rb-carpeta" type="url" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} aria-invalid={tocado && !!errCarpeta} disabled={enCurso} autoComplete="off" placeholder="https://drive.google.com/drive/folders/…" />
            <small className="rb-ayuda">La carpeta debe estar compartida como Editor con la cuenta de automatización.</small>
            {tocado && errCarpeta && <small className="rb-err">{errCarpeta}</small>}
          </div>
          {errorEnvio && <div className="msg bad" role="alert">{errorEnvio}</div>}
          <div className="rb-acciones">
            <button type="submit" className="btn" disabled={enviando || enCurso || configurada === false}>{enCurso ? 'Generando…' : enviando ? 'Enviando…' : 'Generar rúbrica'}</button>
            {enCurso && <span className="rb-estado" role="status" aria-live="polite"><i className="rb-spin" aria-hidden="true" />Generando… {trabajo.segundos} s. Suele tardar entre 30 segundos y 2 minutos; puede dejar esta pantalla abierta.</span>}
          </div>
        </form>

        <aside className="rb-lado">
          <div className="card rb-pasos">
            <h4>Cómo funciona</h4>
            <ol>
              {PASOS.map(([t, d], i) => <li key={t}><span className="pl2-n">{i + 1}</span><span><b>{t}</b><small>{d}</small></span></li>)}
            </ol>
          </div>
        </aside>
      </div>

      {trabajo && trabajo.estado === 'listo' && (
        <section className="card rb-res ok" aria-live="polite">
          <h2>Rúbrica generada</h2>
          <p>Se guardó en la carpeta indicada{trabajo.avisos ? ', con ' + trabajo.avisos + (trabajo.avisos === 1 ? ' aviso' : ' avisos') + ' para revisar' : ''}.</p>
          <a className="btn" href={trabajo.url} target="_blank" rel="noopener noreferrer">Abrir rúbrica en Google Sheets</a>
          {trabajo.log.length > 0 && (
            <details>
              <summary>Ver detalle ({trabajo.log.length})</summary>
              <ul>{trabajo.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </details>
          )}
        </section>
      )}
      {trabajo && trabajo.estado === 'error' && (
        <section className="card rb-res bad" role="alert">
          <h2>No se generó la rúbrica</h2>
          <p>{trabajo.error}</p>
          <p className="help">Si el problema continúa, avise a la administración para revisar la ejecución en n8n.</p>
        </section>
      )}
    </div>
  )
}
