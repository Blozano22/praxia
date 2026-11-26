import { useEffect, useRef, useState } from 'react'
import { RUTA_API, api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import './auditor.css'

// «Auditor de guiones»: se sube (o se enlaza) el guion, y opcionalmente el syllabus y la estructura metodológica; Praxia los envía al flujo de n8n, que los evalúa
// contra los 46 criterios del Instrumento de validación y entrega un Google Doc diligenciado. El servidor valida y reenvía; esta pantalla pregunta cómo va cada 6 s (máx. 20 min).

const EXT = ['docx', 'doc', 'pdf', 'odt', 'txt']
const MAX_ARCHIVO = 15 * 1024 * 1024
const ESPERA_MS = 6000
const TOPE_MS = 20 * 60 * 1000
const esEnlace = (u) => /^https:\/\/docs\.google\.com\/(?:document|file)\/d\/[\w-]{20,}/.test(u) || /^https:\/\/drive\.google\.com\/(?:file\/d\/[\w-]{20,}|.*[?&]id=[\w-]{20,})/.test(u)
const esCorreo = (c) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(c)
const peso = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB')

const BLOQUES = [
  { k: 'guion', n: 1, titulo: 'Guion a evaluar', req: true, ayuda: 'El guion instruccional que se va a revisar.' },
  { k: 'syllabus', n: 2, titulo: 'Syllabus', req: false, ayuda: 'Permite verificar la coherencia del guion con el syllabus.' },
  { k: 'estructura', n: 3, titulo: 'Estructura metodológica aprobada', req: false, ayuda: 'La estructura aprobada de la unidad o la asignatura.' }
]
const vacio = () => ({ modo: 'archivo', archivo: null, url: '' })

function errorBloque(b, req) {
  if (b.modo === 'archivo') {
    if (!b.archivo) return req ? 'Suba el archivo del guion o cambie a «Pegar enlace».' : ''
    const ext = (b.archivo.name.split('.').pop() || '').toLowerCase()
    if (!EXT.includes(ext)) return 'Formato no permitido: use .docx, .doc, .pdf, .odt o .txt.'
    if (b.archivo.size > MAX_ARCHIVO) return 'El archivo pesa más de 15 MB.'
    return ''
  }
  const u = b.url.trim()
  if (!u) return req ? 'Pegue el enlace del guion o cambie a «Subir archivo».' : ''
  return esEnlace(u) ? '' : 'Debe ser un enlace de Google Docs o Drive (docs.google.com/document/d/…).'
}

function Documento({ def, valor, cambiar, tocado }) {
  const [arrastra, setArrastra] = useState(false)
  const entrada = useRef(null)
  const err = errorBloque(valor, def.req)
  const poner = (archivo) => cambiar({ ...valor, archivo: archivo || null })
  return (
    <div className="au-doc">
      <div className="au-doc-cab">
        <span className="pl2-n">{def.n}</span>
        <b>{def.titulo}</b>
        {def.req ? <em className="au-req">obligatorio</em> : <em className="au-opc">opcional</em>}
      </div>
      <small className="au-ayuda">{def.ayuda}</small>
      <div className="au-modos" role="group" aria-label={'Origen de ' + def.titulo}>
        {[['archivo', 'Subir archivo'], ['enlace', 'Pegar enlace']].map(([m, t]) => (
          <button key={m} type="button" aria-pressed={valor.modo === m} className={valor.modo === m ? 'on' : ''} onClick={() => cambiar({ ...valor, modo: m })}>{t}</button>
        ))}
      </div>
      {valor.modo === 'archivo' ? (
        <div className={'au-drop' + (arrastra ? ' arrastra' : '') + (valor.archivo ? ' con' : '')}
          onDragOver={(e) => { e.preventDefault(); setArrastra(true) }} onDragLeave={() => setArrastra(false)}
          onDrop={(e) => { e.preventDefault(); setArrastra(false); if (e.dataTransfer.files[0]) poner(e.dataTransfer.files[0]) }}>
          <input ref={entrada} type="file" accept=".docx,.doc,.pdf,.odt,.txt" className="au-oculto" tabIndex={-1} aria-hidden="true" onChange={(e) => { poner(e.target.files[0]); e.target.value = '' }} />
          {valor.archivo ? (
            <div className="au-arch"><b>{valor.archivo.name}</b><span>{peso(valor.archivo.size)}</span>
              <button type="button" className="btn ghost sm" onClick={() => poner(null)}>Quitar</button></div>
          ) : (
            <button type="button" className="au-elegir" onClick={() => entrada.current && entrada.current.click()}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></svg>
              <span><b>Haga clic para elegir</b> o arrastre el archivo aquí</span>
              <small>.docx, .doc, .pdf, .odt o .txt · máx. 15 MB</small>
            </button>
          )}
        </div>
      ) : (
        <input type="url" value={valor.url} onChange={(e) => cambiar({ ...valor, url: e.target.value })} aria-label={'Enlace de ' + def.titulo} aria-invalid={tocado && !!err} autoComplete="off" placeholder="https://docs.google.com/document/d/…" />
      )}
      {tocado && err && <small className="au-err">{err}</small>}
    </div>
  )
}

function Resumen({ r }) {
  if (r === null || r === undefined || r === '') return null
  if (typeof r === 'string') return <div className="au-resumen">{r.split(/\n+/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div>
  if (Array.isArray(r)) return <ul className="au-resumen">{r.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul>
  return <dl className="au-resumen">{Object.entries(r).map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v)}</dd></div>)}</dl>
}

const tono = (c) => (/no\s+(aprob|cumpl|valid)|rechaz|no\s+apto/i.test(c) ? 'bad' : /aprob|cumple|apto|valid/i.test(c) ? 'ok' : 'warn')

export default function AuditorGuiones() {
  const [docs, setDocs] = useState({ guion: vacio(), syllabus: vacio(), estructura: vacio() })
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [tocado, setTocado] = useState(false)
  const [configurada, setConfigurada] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [errores, setErrores] = useState([])
  const [trabajo, setTrabajo] = useState(null) // { id, inicio, segundos, mensaje, estado, concepto, doc_url, resumen }
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  useEffect(() => { api('GET', '/auditor/configuracion').then((d) => { if (vivo.current) setConfigurada(!!d.configurada) }).catch(() => { if (vivo.current) setConfigurada(true) }) }, [])

  const enCurso = !!trabajo && trabajo.estado === 'en_curso'
  const errCorreo = correo.trim() && !esCorreo(correo.trim()) ? 'Escriba un correo válido.' : ''
  const invalido = BLOQUES.some((b) => errorBloque(docs[b.k], b.req)) || !!errCorreo

  // mientras corre, se pregunta cada 6 s (máx. 20 min) y el reloj avanza cada segundo
  useEffect(() => {
    if (!enCurso) return undefined
    const id = trabajo.id
    const inicio = trabajo.inicio
    const t = setInterval(() => {
      if (Date.now() - inicio > TOPE_MS) { if (vivo.current) setTrabajo((x) => (x && x.id === id ? { ...x, estado: 'error', mensaje: 'La revisión tardó más de 20 minutos. Revise la ejecución en n8n o intente de nuevo.' } : x)); return }
      api('GET', '/auditor/trabajo/' + encodeURIComponent(id)).then((d) => { if (vivo.current) setTrabajo((x) => (x && x.id === id ? { ...x, ...d } : x)) })
        .catch((e) => { if (vivo.current && e.estado === 404) setTrabajo((x) => (x && x.id === id ? { ...x, estado: 'error', mensaje: e.message } : x)) })
    }, ESPERA_MS)
    const r = setInterval(() => setTrabajo((x) => (x && x.id === id && x.estado === 'en_curso' ? { ...x, segundos: Math.round((Date.now() - inicio) / 1000) } : x)), 1000)
    return () => { clearInterval(t); clearInterval(r) }
  }, [enCurso, trabajo && trabajo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = async (e) => {
    e.preventDefault()
    setTocado(true); setErrores([])
    if (invalido || enviando || enCurso) return
    const f = new FormData()
    for (const b of BLOQUES) {
      const v = docs[b.k]
      if (v.modo === 'archivo' && v.archivo) f.append(b.k + '_file', v.archivo, v.archivo.name)
      else if (v.modo === 'enlace' && v.url.trim()) f.append(b.k + '_url', v.url.trim())
    }
    if (nombre.trim()) f.append('nombre', nombre.trim())
    if (correo.trim()) f.append('correo', correo.trim())
    setEnviando(true)
    try {
      const r = await fetch(RUTA_API + '/auditor', { method: 'POST', credentials: 'same-origin', headers: { 'x-ova': '1' }, body: f })
      let d = null
      try { d = await r.json() } catch { /* sin cuerpo */ }
      if (!r.ok || !d || !d.ok) setErrores(d && Array.isArray(d.errores) && d.errores.length ? d.errores : [d && d.error ? d.error : r.status === 429 ? 'Demasiadas peticiones seguidas: espere un minuto.' : 'No se pudo enviar (error ' + r.status + ').'])
      else setTrabajo({ id: d.job_id, inicio: Date.now(), segundos: 0, mensaje: '', estado: 'en_curso', concepto: '', doc_url: '', resumen: '' })
    } catch { setErrores(['No hubo conexión con Praxia. Revise su internet e intente de nuevo.']) }
    setEnviando(false)
  }

  const nueva = () => { setTrabajo(null); setErrores([]); setTocado(false); setDocs({ guion: vacio(), syllabus: vacio(), estructura: vacio() }); setNombre(''); setCorreo('') }
  const bloqueado = enCurso || enviando

  return (
    <div className="wrapx fade au">
      <Titulo icono="revision">
        <h1>Auditor de guiones</h1>
        <p className="lead">Evalúe un guion contra los 46 criterios del Instrumento de validación y reciba el instrumento diligenciado en un Google Doc.</p>
      </Titulo>

      {configurada === false && <div className="msg warn" role="status">El auditor todavía no está conectado: la administración debe guardar la dirección del flujo en «Conexión con n8n».</div>}

      <div className="au-cuerpo">
        <form className="card au-form" onSubmit={enviar} noValidate>
          <fieldset className="au-grupo" disabled={bloqueado}>
            {BLOQUES.map((b) => <Documento key={b.k} def={b} valor={docs[b.k]} cambiar={(v) => setDocs((d) => ({ ...d, [b.k]: v }))} tocado={tocado} />)}

            <div className="au-doc">
              <div className="au-doc-cab"><span className="pl2-n">4</span><b>Datos de la revisión</b><em className="au-opc">opcional</em></div>
              <div className="au-dos">
                <div className="au-campo"><label htmlFor="au-nombre">Nombre de la revisión</label>
                  <input id="au-nombre" type="text" maxLength={150} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Unidad 2 — Fundamentos de pedagogía" /></div>
                <div className="au-campo"><label htmlFor="au-correo">Correo para compartir el resultado</label>
                  <input id="au-correo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} aria-invalid={tocado && !!errCorreo} autoComplete="off" placeholder="nombre@americana.edu.co" />
                  <small className="au-ayuda">El Google Doc resultante se comparte como editor con esa persona.</small>
                  {tocado && errCorreo && <small className="au-err">{errCorreo}</small>}</div>
              </div>
            </div>
          </fieldset>

          {errores.length > 0 && <div className="msg bad" role="alert">{errores.length === 1 ? errores[0] : <ul>{errores.map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>}
          <div className="au-acciones">
            <button type="submit" className="btn" disabled={bloqueado || configurada === false}>{enCurso ? 'Auditando…' : enviando ? 'Enviando…' : 'Auditar guion'}</button>
            {enCurso && <span className="au-estado" role="status" aria-live="polite"><i className="au-spin" aria-hidden="true" />{trabajo.mensaje || 'Evaluando el guion…'} · {Math.floor(trabajo.segundos / 60)}:{String(trabajo.segundos % 60).padStart(2, '0')}</span>}
          </div>
          {enCurso && <small className="au-ayuda">Suele tardar entre 2 y 6 minutos. Puede dejar esta pantalla abierta; no la actualice.</small>}
        </form>

        <aside className="au-lado">
          <div className="card au-pasos">
            <h4>Cómo funciona</h4>
            <ol>
              <li><span className="pl2-n">1</span><span><b>Cargue los documentos</b><small>El guion es obligatorio; el syllabus y la estructura ayudan a evaluar la coherencia.</small></span></li>
              <li><span className="pl2-n">2</span><span><b>Se evalúa con IA</b><small>46 criterios del Instrumento de validación.</small></span></li>
              <li><span className="pl2-n">3</span><span><b>Reciba el resultado</b><small>Un concepto, el instrumento diligenciado y un resumen.</small></span></li>
            </ol>
          </div>
        </aside>
      </div>

      {trabajo && trabajo.estado === 'listo' && (
        <section className={'card au-res ' + tono(trabajo.concepto)} aria-live="polite">
          <h4>Concepto final</h4>
          <h2>{trabajo.concepto || 'Revisión terminada'}</h2>
          {trabajo.doc_url && <a className="btn" href={trabajo.doc_url} target="_blank" rel="noopener noreferrer">Abrir instrumento diligenciado</a>}
          <Resumen r={trabajo.resumen} />
          <p className="help">Resultado generado por IA: revísalo antes de emitir el concepto oficial.</p>
          <button type="button" className="btn ghost" onClick={nueva}>Auditar otro guion</button>
        </section>
      )}
      {trabajo && trabajo.estado === 'error' && (
        <section className="card au-res bad" role="alert">
          <h2>No se pudo completar la revisión</h2>
          <p>{trabajo.mensaje || 'El flujo terminó con un error.'}</p>
          <p className="help">Si el problema continúa, avise a la administración para revisar la ejecución en n8n.</p>
          <button type="button" className="btn ghost" onClick={nueva}>Intentar de nuevo</button>
        </section>
      )}
    </div>
  )
}
