import { useEffect, useRef, useState } from 'react'
import { RUTA_API, api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import './auditor.css'

// «Auditor de guiones»: se pega el enlace de la carpeta de Drive con los guiones (y, si se quiere, el syllabus, la estructura y un correo); Praxia los envía al flujo
// de n8n, que evalúa cada guion contra los 46 criterios del Instrumento de validación y guarda un instrumento diligenciado por guion en la carpeta del curso.
// El servidor valida y reenvía; esta pantalla pregunta cómo va cada 8 s (hasta 6 h). El job se guarda en la dirección (#/auditor-guiones?job=…) y en localStorage.

const ESPERA_MS = 8000
const TOPE_MS = 6 * 60 * 60 * 1000
const LLAVE = 'praxia.auditor.job'
const esCarpeta = (u) => /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[\w-]{10,}(?:[?#].*)?$/.test(u)
const esDocumento = (u) => /^https:\/\/docs\.google\.com\/(?:document|file)\/d\/[\w-]{20,}/.test(u) || /^https:\/\/drive\.google\.com\/(?:file\/d\/[\w-]{20,}|.*[?&]id=[\w-]{20,})/.test(u)
const esCorreo = (c) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(c)

// Trabajo guardado para poder cerrar la página y volver más tarde (el almacenamiento puede no estar disponible).
const leerGuardado = () => {
  let id = ''
  try { const m = /[?&]job=([^&]+)/.exec(location.hash); if (m) id = decodeURIComponent(m[1]) } catch { /* sin dirección */ }
  let g = null
  try { g = JSON.parse(localStorage.getItem(LLAVE) || 'null') } catch { /* sin almacenamiento */ }
  if (id) return { id, inicio: g && g.id === id && Number(g.inicio) ? Number(g.inicio) : Date.now() }
  return g && typeof g.id === 'string' && Number(g.inicio) ? { id: g.id, inicio: Number(g.inicio) } : null
}
const guardar = (t) => {
  try { history.replaceState(null, '', '#/auditor-guiones' + (t ? '?job=' + encodeURIComponent(t.id) : '')) } catch { /* sin historial */ }
  try { if (t) localStorage.setItem(LLAVE, JSON.stringify({ id: t.id, inicio: t.inicio })); else localStorage.removeItem(LLAVE) } catch { /* sin almacenamiento */ }
}

// Texto del resumen sin HTML: solo las direcciones https se vuelven enlace («Abrir instrumento»).
function Resumen({ r }) {
  if (!r) return null
  const texto = typeof r === 'string' ? r : JSON.stringify(r, null, 2)
  const partes = texto.split(/(https:\/\/[^\s<>"')]+)/g)
  return <div className="au-resumen">{partes.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">Abrir instrumento</a> : p))}</div>
}

export default function AuditorGuiones() {
  const [carpeta, setCarpeta] = useState('')
  const [syllabus, setSyllabus] = useState('')
  const [estructura, setEstructura] = useState('')
  const [correo, setCorreo] = useState('')
  const [tocado, setTocado] = useState(false)
  const [configurada, setConfigurada] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [errores, setErrores] = useState([])
  const [trabajo, setTrabajo] = useState(() => { const g = leerGuardado(); return g ? { ...g, estado: 'en_curso', mensaje: 'Consultando el estado de la evaluación…', concepto: '', doc_url: '', resumen: '', retomado: true } : null })
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  useEffect(() => { api('GET', '/auditor/configuracion').then((d) => { if (vivo.current) setConfigurada(!!d.configurada) }).catch(() => { if (vivo.current) setConfigurada(true) }) }, [])
  useEffect(() => { if (trabajo && trabajo.retomado) guardar(trabajo) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const enCurso = !!trabajo && trabajo.estado === 'en_curso'
  const errCarpeta = !carpeta.trim() ? 'Pegue el enlace de la carpeta de guiones.' : !esCarpeta(carpeta.trim()) ? 'Debe ser el enlace de una carpeta de Drive (drive.google.com/drive/folders/…).' : ''
  const errSyllabus = syllabus.trim() && !esDocumento(syllabus.trim()) ? 'Debe ser un enlace de Google Docs o Drive.' : ''
  const errEstructura = estructura.trim() && !esDocumento(estructura.trim()) ? 'Debe ser un enlace de Google Docs o Drive.' : ''
  const errCorreo = correo.trim() && !esCorreo(correo.trim()) ? 'Escriba un correo válido.' : ''
  const invalido = !!(errCarpeta || errSyllabus || errEstructura || errCorreo)

  // mientras corre, se pregunta cada 8 s (hasta 6 h)
  useEffect(() => {
    if (!enCurso) return undefined
    const id = trabajo.id
    const inicio = trabajo.inicio
    const t = setInterval(() => {
      if (Date.now() - inicio > TOPE_MS) { if (vivo.current) setTrabajo((x) => (x && x.id === id ? { ...x, estado: 'error', mensaje: 'La evaluación está tardando más de lo esperado. Revise las ejecuciones en n8n.' } : x)); return }
      api('GET', '/auditor/trabajo/' + encodeURIComponent(id)).then((d) => { if (vivo.current) setTrabajo((x) => (x && x.id === id ? { ...x, ...d, mensaje: d.mensaje || (d.estado === 'en_curso' ? x.mensaje : '') } : x)) })
        .catch((e) => { if (vivo.current && e.estado === 404) setTrabajo((x) => (x && x.id === id ? { ...x, estado: 'error', mensaje: e.message } : x)) })
    }, ESPERA_MS)
    return () => clearInterval(t)
  }, [enCurso, trabajo && trabajo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = async (e) => {
    e.preventDefault()
    setTocado(true); setErrores([])
    if (invalido || enviando || enCurso) return
    setEnviando(true)
    try {
      const r = await fetch(RUTA_API + '/auditor', { method: 'POST', credentials: 'same-origin', headers: { 'x-ova': '1', 'content-type': 'application/json' }, body: JSON.stringify({ carpeta_url: carpeta.trim(), syllabus_url: syllabus.trim(), estructura_url: estructura.trim(), correo: correo.trim() }) })
      let d = null
      try { d = await r.json() } catch { /* sin cuerpo */ }
      if (!r.ok || !d || !d.ok) setErrores(d && Array.isArray(d.errores) && d.errores.length ? d.errores : [d && d.error ? d.error : r.status === 429 ? 'Demasiadas peticiones seguidas: espere un minuto.' : 'No se pudo enviar (error ' + r.status + ').'])
      else {
        const t = { id: d.job_id, inicio: Date.now(), estado: 'en_curso', mensaje: 'Carpeta recibida. Buscando los guiones… Cada guion tarda entre 2 y 6 minutos; puede dejar esta página abierta o volver a ella más tarde.', concepto: '', doc_url: '', resumen: '' }
        guardar(t); setTrabajo(t)
      }
    } catch { setErrores(['No hubo conexión con Praxia. Revise su internet e intente de nuevo.']) }
    setEnviando(false)
  }

  const nueva = () => { guardar(null); setTrabajo(null); setErrores([]); setTocado(false); setCarpeta(''); setSyllabus(''); setEstructura(''); setCorreo('') }
  const bloqueado = enCurso || enviando

  return (
    <div className="wrapx fade au">
      <Titulo icono="revision">
        <h1>Auditor de guiones</h1>
        <p className="lead">Evalúe todos los guiones de una carpeta de Drive contra los 46 criterios del Instrumento de validación; se guarda un instrumento diligenciado por guion en la carpeta del curso.</p>
      </Titulo>

      {configurada === false && <div className="msg warn" role="status">El auditor todavía no está conectado: la administración debe guardar la dirección del flujo en «Conexión con n8n».</div>}

      <div className="au-cuerpo">
        <form className="card au-form" onSubmit={enviar} noValidate>
          <fieldset className="au-grupo" disabled={bloqueado}>
            <div className="au-doc">
              <div className="au-doc-cab"><span className="pl2-n">1</span><b>Carpeta de guiones</b><em className="au-req">obligatorio</em></div>
              <small className="au-ayuda">Enlace de la carpeta de Google Drive donde están los guiones (Google Docs, Word o PDF). La carpeta de guiones y la carpeta del curso deben estar compartidas con la cuenta de automatización como editora.</small>
              <input type="url" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} aria-label="Enlace de la carpeta de guiones" aria-invalid={tocado && !!errCarpeta} autoComplete="off" placeholder="https://drive.google.com/drive/folders/…" />
              {tocado && errCarpeta && <small className="au-err">{errCarpeta}</small>}
              <small className="au-ayuda">Se evalúan todos los guiones que estén directamente en esa carpeta. Los instrumentos se guardan en la carpeta superior (la del curso); si no hay permiso allí, quedan en la misma carpeta de los guiones.</small>
            </div>

            <div className="au-doc">
              <div className="au-doc-cab"><span className="pl2-n">2</span><b>Documentos de referencia</b><em className="au-opc">opcional</em></div>
              <small className="au-ayuda">Si en la carpeta hay un archivo cuyo nombre incluya «syllabus» o «estructura metodológica», se usa automáticamente para todos los guiones. Si pega un enlace aquí, ese tiene prioridad.</small>
              <div className="au-dos">
                <div className="au-campo"><label htmlFor="au-syllabus">Syllabus</label>
                  <input id="au-syllabus" type="url" value={syllabus} onChange={(e) => setSyllabus(e.target.value)} aria-invalid={tocado && !!errSyllabus} autoComplete="off" placeholder="https://docs.google.com/document/d/…" />
                  {tocado && errSyllabus && <small className="au-err">{errSyllabus}</small>}</div>
                <div className="au-campo"><label htmlFor="au-estructura">Estructura metodológica aprobada</label>
                  <input id="au-estructura" type="url" value={estructura} onChange={(e) => setEstructura(e.target.value)} aria-invalid={tocado && !!errEstructura} autoComplete="off" placeholder="https://docs.google.com/document/d/…" />
                  {tocado && errEstructura && <small className="au-err">{errEstructura}</small>}</div>
              </div>
              <small className="au-ayuda">El syllabus permite verificar los criterios 2 y 4; la estructura, los criterios 3, 5–7, 11, 27 y 34–39.</small>
            </div>

            <div className="au-doc">
              <div className="au-doc-cab"><span className="pl2-n">3</span><b>Compartir resultados</b><em className="au-opc">opcional</em></div>
              <div className="au-campo"><label htmlFor="au-correo">Correo</label>
                <input id="au-correo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} aria-invalid={tocado && !!errCorreo} autoComplete="off" placeholder="usuario@americana.edu.co" />
                {tocado && errCorreo && <small className="au-err">{errCorreo}</small>}</div>
              <small className="au-ayuda">Todos los instrumentos quedan visibles para cualquiera con el enlace. Si indica un correo, además se comparten con esa persona como editora (recibe un aviso por cada guion).</small>
            </div>
          </fieldset>

          {errores.length > 0 && <div className="msg bad" role="alert">{errores.length === 1 ? errores[0] : <ul>{errores.map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>}
          <div className="au-acciones">
            <button type="submit" className="btn" disabled={bloqueado || configurada === false}>{enCurso ? 'Procesando…' : enviando ? 'Enviando…' : 'Evaluar carpeta'}</button>
            {enCurso && <span className="au-estado" role="status" aria-live="polite"><i className="au-spin" aria-hidden="true" />{trabajo.mensaje || 'Evaluando los guiones…'}</span>}
          </div>
        </form>

        <aside className="au-lado">
          <div className="card au-pasos">
            <h4>Cómo funciona</h4>
            <ol>
              <li><span className="pl2-n">1</span><span><b>Pegue la carpeta</b><small>Con todos los guiones del curso, compartida con la cuenta de automatización.</small></span></li>
              <li><span className="pl2-n">2</span><span><b>Se evalúa con IA</b><small>Cada guion tarda entre 2 y 6 minutos. Puede cerrar la página y volver más tarde.</small></span></li>
              <li><span className="pl2-n">3</span><span><b>Reciba los instrumentos</b><small>Uno por guion, en la carpeta del curso.</small></span></li>
            </ol>
          </div>
        </aside>
      </div>

      {trabajo && trabajo.estado === 'listo' && (
        <section className="card au-res ok" aria-live="polite">
          <h4>Evaluación terminada</h4>
          <h2><span className="au-rotulo">Resultado:</span> {trabajo.concepto || 'Evaluación terminada'}</h2>
          {trabajo.doc_url && <a className="btn" href={trabajo.doc_url} target="_blank" rel="noopener noreferrer">Abrir carpeta del curso</a>}
          <Resumen r={trabajo.resumen} />
          <p className="help">Resultados generados por IA: revísalos antes de emitir el concepto oficial.</p>
          <button type="button" className="btn ghost" onClick={nueva}>Evaluar otra carpeta</button>
        </section>
      )}
      {trabajo && trabajo.estado === 'error' && (
        <section className="card au-res bad" role="alert">
          <h2>Ocurrió un error</h2>
          <p>{trabajo.mensaje || 'El flujo terminó con un error.'}</p>
          <p className="help">Si el problema continúa, avise a la administración para revisar la ejecución en n8n.</p>
          <button type="button" className="btn ghost" onClick={nueva}>Evaluar otra carpeta</button>
        </section>
      )}
    </div>
  )
}
