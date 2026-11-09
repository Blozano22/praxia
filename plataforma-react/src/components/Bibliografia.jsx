import { useCallback, useEffect, useRef, useState } from 'react'
import { api, RUTA_API } from '../lib/api.js'

const ESTADO = {
  resuelta: ['ok', 'Leída completa'],
  parcial: ['warn', 'Solo la cita'],
  sin_acceso: ['bad', 'Sin acceso'],
  error: ['bad', 'Error'],
  pendiente: ['', 'Pendiente']
}
const TIPO = { articulo: 'Artículo', libro: 'Libro', capitulo: 'Capítulo', web: 'Página web', informe: 'Informe', tesis: 'Tesis', otro: 'Otro' }
const RE_DOC = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]{10,100}/

// Cursiva de APA: *texto* → <i>texto</i>
const Apa = ({ t }) => String(t || '').split(/(\*[^*]+\*)/).map((p, i) => (p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i> : p))

const POR_VEZ = 10

// Lector del texto completo de un documento, con el número de página y la cita lista para copiar.
function Lector({ doc, fuente, onCerrar, onAviso }) {
  const [desde, setDesde] = useState(1)
  const [paginas, setPaginas] = useState(null)
  const [error, setError] = useState('')
  const total = doc.num_paginas || 1
  const rotulo = doc.formato === 'pdf' ? 'Página' : 'Bloque'
  useEffect(() => {
    let vivo = true
    setPaginas(null); setError('')
    api('GET', '/bibliografia/documentos/' + doc.id + '/paginas?desde=' + desde + '&hasta=' + (desde + POR_VEZ - 1)).then((r) => vivo && setPaginas(r)).catch((e) => vivo && setError(e.message))
    return () => { vivo = false }
  }, [doc.id, desde])
  const ir = (n) => setDesde(Math.max(1, Math.min(Math.max(1, total - POR_VEZ + 1), n)))
  const citar = async (n) => {
    const c = String(fuente.cita_apa || '').slice(0, -1) + ', ' + (doc.formato === 'pdf' ? 'p. ' : 'bloque ') + n + ')'
    try { await navigator.clipboard.writeText(c); onAviso('Cita copiada: ' + c) } catch { /* sin portapapeles */ }
  }
  return (
    <div className="bib-lector" role="dialog" aria-modal="true" aria-label="Texto completo">
      <div className="bib-lector-in">
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <b><Apa t={fuente.referencia_apa || fuente.entrada_cruda} /></b>
            <p className="help" style={{ margin: '2px 0 0' }}>{doc.formato.toUpperCase()} · {rotulo.toLowerCase()}s {desde} a {Math.min(total, desde + POR_VEZ - 1)} de {total}</p>
          </div>
          <button className="btn sec sm" onClick={onCerrar}>Cerrar</button>
        </div>
        <div className="row" style={{ margin: '10px 0', alignItems: 'center' }}>
          <button className="btn sec sm" disabled={desde <= 1} onClick={() => ir(desde - POR_VEZ)}>← Anteriores</button>
          <button className="btn sec sm" disabled={desde + POR_VEZ > total} onClick={() => ir(desde + POR_VEZ)}>Siguientes →</button>
          <label className="help" style={{ margin: 0 }}>Ir a la {rotulo.toLowerCase()} <input type="number" min={1} max={total} style={{ width: 80 }} onKeyDown={(e) => { if (e.key === 'Enter') ir(Number(e.target.value) || 1) }} /></label>
        </div>
        {error && <div className="msg bad">{error}</div>}
        {!paginas && !error && <p className="help">Cargando…</p>}
        <div className="bib-paginas">
          {(paginas || []).map((p) => (
            <article key={p.numero} className="bib-pagina">
              <header><b>{rotulo} {p.numero}</b><button className="lnk" onClick={() => citar(p.numero)}>copiar cita con esta {rotulo.toLowerCase()}</button></header>
              <pre>{p.texto}</pre>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Bibliografia({ lista = [], fijo = null, onEstado }) {
  const conUrl = lista.filter((s) => s.syllabusUrl)
  const [url, setUrl] = useState(conUrl[0] ? conUrl[0].syllabusUrl : '')
  const [proyecto, setProyecto] = useState(conUrl[0] ? conUrl[0].id : '')
  const [trabajos, setTrabajos] = useState([])
  const [resumen, setResumen] = useState(null) // todas las lecturas con su responsable y el syllabus vinculado (administración)
  const [qLect, setQLect] = useState('')
  const [persona, setPersona] = useState('todas')
  const [activo, setActivo] = useState(null)
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [creando, setCreando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [filtro, setFiltro] = useState('todas')
  const [abierta, setAbierta] = useState(null)
  const [lector, setLector] = useState(null)
  const reloj = useRef(null)

  // En el flujo del syllabus la lectura arranca sola; si ya había una de este mismo enlace en esta sesión, se retoma.
  useEffect(() => {
    if (!fijo) return undefined
    let vivo = true
    const clave = 'bib:' + fijo.syllabusUrl
    ;(async () => {
      let id = null
      try { id = sessionStorage.getItem(clave) } catch { /* sin almacenamiento */ }
      if (id) { try { await api('GET', '/bibliografia/trabajos/' + id) } catch { id = null } }
      if (!id) {
        try { id = (await api('POST', '/bibliografia/trabajos', { syllabusUrl: fijo.syllabusUrl, ...(fijo.proyectoId ? { proyectoId: fijo.proyectoId } : {}) })).id } catch (e) { if (vivo) setError(e.message); return }
        try { sessionStorage.setItem(clave, id) } catch { /* sin almacenamiento */ }
      }
      if (vivo) setActivo(id)
    })()
    return () => { vivo = false }
  }, [fijo && fijo.syllabusUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  const releer = async () => {
    setError(''); setAviso(''); setD(null)
    try {
      const id = (await api('POST', '/bibliografia/trabajos', { syllabusUrl: fijo.syllabusUrl, ...(fijo.proyectoId ? { proyectoId: fijo.proyectoId } : {}) })).id
      try { sessionStorage.setItem('bib:' + fijo.syllabusUrl, id) } catch { /* sin almacenamiento */ }
      setActivo(id)
    } catch (e) { setError(e.message) }
  }

  const cargarLista = useCallback(() => {
    if (!fijo) api('GET', '/bibliografia/resumen').then(setResumen).catch(() => setResumen([]))
    return api('GET', '/bibliografia/trabajos').then(setTrabajos).catch((e) => setError(e.message))
  }, [fijo])
  useEffect(() => { cargarLista() }, [cargarLista])

  // Mientras el trabajo corre se consulta su avance cada 2 s.
  useEffect(() => {
    clearTimeout(reloj.current)
    if (!activo) { setD(null); return undefined }
    let vivo = true
    const pedir = () => api('GET', '/bibliografia/trabajos/' + activo).then((x) => {
      if (!vivo) return
      setD(x)
      if (x.estado === 'pendiente' || x.estado === 'procesando') reloj.current = setTimeout(pedir, 2000)
      else cargarLista()
    }).catch((e) => vivo && setError(e.message))
    pedir()
    return () => { vivo = false; clearTimeout(reloj.current) }
  }, [activo, cargarLista])

  const crear = async () => {
    setError(''); setAviso('')
    if (!RE_DOC.test(url.trim())) { setError('Pegue el enlace del syllabus (Google Docs).'); return }
    setCreando(true)
    try {
      const r = await api('POST', '/bibliografia/trabajos', { syllabusUrl: url.trim(), ...(proyecto ? { proyectoId: proyecto } : {}) })
      setRes(null); setQ(''); setActivo(r.id); cargarLista()
    } catch (e) { setError(e.message) }
    setCreando(false)
  }

  const copiar = async () => {
    try {
      const r = await api('GET', '/bibliografia/trabajos/' + activo + '/referencias')
      await navigator.clipboard.writeText(r.texto)
      setAviso('Bibliografía APA 7 copiada (' + r.total + ' referencias).')
    } catch (e) { setError(e.message || 'No se pudo copiar') }
  }
  const copiarCita = async (f) => {
    try { await navigator.clipboard.writeText(f.cita_apa || ''); setAviso('Cita copiada: ' + f.cita_apa) } catch { setError('No se pudo copiar') }
  }
  // El documento lo descargó la persona (sitios que no atienden a programas): se sube y se lee igual que los demás.
  const [subiendo, setSubiendo] = useState(null)
  const subir = async (f, archivo) => {
    if (!archivo) return
    setError(''); setAviso(''); setSubiendo(f.id)
    try {
      const r = await fetch(RUTA_API + '/bibliografia/fuentes/' + f.id + '/archivo', { method: 'POST', credentials: 'same-origin', headers: { 'x-ova': '1', 'x-nombre': encodeURIComponent(archivo.name), 'content-type': 'application/octet-stream' }, body: archivo })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo leer el archivo')
      setAviso('Leído: ' + j.paginas + (j.formato === 'pdf' ? ' páginas' : ' bloques') + ' de «' + archivo.name + '».')
      setD(await api('GET', '/bibliografia/trabajos/' + activo))
    } catch (e) { setError(e.message) }
    setSubiendo(null)
  }
  // Omitir a mano una referencia que no se puede descargar (o volver a incluirla).
  const omitir = async (f, valor) => {
    setError(''); setAviso('')
    try {
      await api('PUT', '/bibliografia/fuentes/' + f.id + '/omitir', { omitir: valor })
      setAviso(valor ? 'Referencia omitida: no se usará para crear las unidades.' : 'Referencia incluida de nuevo: falta descargarla y subirla.')
      setD(await api('GET', '/bibliografia/trabajos/' + activo))
    } catch (e) { setError(e.message || 'No se pudo cambiar') }
  }
  const buscar = async (e) => {
    e.preventDefault()
    if (q.trim().length < 2) return
    try { setRes(await api('GET', '/bibliografia/trabajos/' + activo + '/buscar?q=' + encodeURIComponent(q.trim()))) } catch (x) { setError(x.message) }
  }

  const fuentes = d ? d.fuentes.filter((f) => filtro === 'todas' || (filtro === 'leidas' ? f.estado === 'resuelta' : f.estado !== 'resuelta')) : []
  const leidas = d ? d.fuentes.filter((f) => f.estado === 'resuelta').length : 0
  const hecho = d ? d.resueltas + d.fallidas : 0
  const Envoltura = fijo ? 'details' : 'div'
  const enlaceDe = (f) => f.url_final || f.url || (f.doi ? 'https://doi.org/' + f.doi : '')
  // Sin lectura y sin enlace: no hay nada que descargar ni subir. Esa referencia se omite y no bloquea el paso siguiente.
  // También se omite a mano lo que no se puede descargar (sitios de pago o con inicio de sesión): marca guardada en el servidor.
  const esManual = (f) => Boolean(f.estado_detalle && f.estado_detalle.startsWith('Omitida a mano'))
  const sinLeer = d ? d.fuentes.filter((f) => f.estado !== 'resuelta') : []
  const omitidas = sinLeer.filter((f) => esManual(f) || !enlaceDe(f))
  const porCargar = sinLeer.filter((f) => !esManual(f) && enlaceDe(f))
  const aUsar = d ? d.fuentes.length - omitidas.length : 0
  const todoOk = Boolean(d && d.estado === 'listo' && aUsar > 0 && porCargar.length === 0)
  useEffect(() => { if (onEstado) onEstado(todoOk) }, [todoOk]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={fijo ? 'bib-fijo' : 'wrapx fade'}>
      {!fijo && <div className="bib-cab">
        <h1>Bibliografía del syllabus</h1>
        <p className="lead">Encuentra las referencias del syllabus, lee cada fuente completa (PDF o página web) y arma la cita y la bibliografía en APA 7. No usa inteligencia artificial: solo lectura de los archivos y sus metadatos.</p>
      </div>}

      {!fijo && <section className="card bib-form">
        <label className="l" htmlFor="bib-url" style={{ marginTop: 0 }}>Enlace del syllabus (Google Docs)</label>
        <div className="bib-fila">
          {conUrl.length > 0 && (
            <select aria-label="Syllabus de la plataforma" value={proyecto}
              onChange={(e) => { setProyecto(e.target.value); const s = conUrl.find((x) => x.id === e.target.value); if (s) setUrl(s.syllabusUrl) }}>
              <option value="">Otro enlace…</option>
              {conUrl.map((s) => <option key={s.id} value={s.id}>{s.curso}</option>)}
            </select>
          )}
          <input id="bib-url" type="text" value={url} onChange={(e) => { setUrl(e.target.value); setProyecto('') }} placeholder="https://docs.google.com/document/d/…" />
          <button className="btn" disabled={creando} onClick={crear}>{creando ? 'Enviando…' : 'Leer la bibliografía'}</button>
        </div>
        <p className="help">El documento debe permitir la lectura a cualquier persona con el enlace. Tarda unos minutos: puede dejar esta pantalla abierta.</p>
        {(!resumen || !resumen.length) && trabajos.length > 0 && (
          <div className="bib-hist">
            <span>Lecturas anteriores</span>
            <div>
              {trabajos.slice(0, 6).map((t) => (
                <button key={t.id} className={t.id === activo ? 'on' : ''} aria-pressed={t.id === activo} onClick={() => { setActivo(t.id); setRes(null); setAviso('') }}>
                  <b>{new Date(t.creado).toLocaleDateString()}</b><small>{t.total} fuentes</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>}

      {!fijo && resumen && resumen.length > 0 && (() => {
        const personas = [...new Set(resumen.map((r) => r.responsable))].sort((a, b) => a.localeCompare(b))
        const qq = qLect.trim().toLowerCase()
        const filas = resumen.filter((r) => (persona === 'todas' || r.responsable === persona) && (!qq || ((r.curso || 'sin syllabus vinculado') + ' ' + r.responsable + ' ' + (r.programa || '')).toLowerCase().includes(qq)))
        const ini = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('')
        const ESTADO = { listo: ['ok', 'Completa'], procesando: ['warn', 'Leyendo…'], pendiente: ['warn', 'En cola'], error: ['bad', 'Con error'] }
        return (
          <section className="card bib-lecturas" aria-label="Lecturas por syllabus">
            <div className="bib-lec-cab">
              <div><h2>Lecturas por syllabus</h2><p className="help">Cada lectura de bibliografía, con quién la montó y el syllabus al que quedó vinculada. Pulse una fila para ver sus referencias.</p></div>
              <label className="pl2-busca"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
                <input aria-label="Buscar una lectura" placeholder="Buscar syllabus o persona" value={qLect} onChange={(e) => setQLect(e.target.value)} /></label>
              <select aria-label="Persona" value={persona} onChange={(e) => setPersona(e.target.value)}>
                <option value="todas">Todas las personas</option>
                {personas.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="bib-lec-tabla">
              <div className="bib-lec-min">
                <div className="bib-lec-fila bib-lec-th"><span>Syllabus</span><span>Montado por</span><span>Referencias</span><span>Estado</span></div>
                {filas.map((r) => {
                  const [cls, txt] = ESTADO[r.estado] || ['', r.estado]
                  return (
                    <button key={r.id} className={'bib-lec-fila' + (r.id === activo ? ' on' : '')} aria-pressed={r.id === activo}
                      onClick={() => { setActivo(r.id); setRes(null); setAviso(''); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }) }}>
                      <span className="bib-lec-nom"><b>{r.curso || 'Sin syllabus vinculado'}</b><small>{r.programa && r.programa !== 'Sin programa' ? r.programa + ' · ' : ''}{new Date(r.creado).toLocaleString()}</small></span>
                      <span className="sg2-resp"><span className="sg2-av" aria-hidden="true">{ini(r.responsable)}</span><span><b>{r.responsable}</b><small>{r.correo}</small></span></span>
                      <span className="bib-lec-cifras">
                        <em title="Leídas completas" className="c-ok">{r.leidas} leídas</em>
                        {r.parciales > 0 && <em title="Solo la cita" className="c-par">{r.parciales} solo cita</em>}
                        {r.sin_acceso > 0 && <em title="Sin acceso" className="c-mal">{r.sin_acceso} sin acceso</em>}
                        {r.omitidas > 0 && <em title="Omitidas" className="c-omi">{r.omitidas} omitidas</em>}
                        <small>de {r.total}</small>
                      </span>
                      <span><span className={'pill ' + cls}>{txt}</span></span>
                    </button>
                  )
                })}
                {filas.length === 0 && <div className="db2-vacio">No hay lecturas con ese filtro.</div>}
              </div>
            </div>
          </section>
        )
      })()}

      {error && <div className="msg bad" role="alert">{error}</div>}
      {aviso && <div className="msg info" role="status">{aviso}</div>}

      {d && (
        <>
          <div className="stats" style={fijo ? { display: 'none' } : undefined}>
            <div className="card st"><b>{d.total}</b><span>Referencias</span></div>
            <div className="card st"><b>{leidas}</b><span>Leídas completas</span></div>
            <div className="card st"><b>{d.fuentes.filter((f) => f.estado === 'parcial').length}</b><span>Solo la cita</span></div>
            <div className="card st"><b>{d.fuentes.filter((f) => f.estado === 'sin_acceso' || f.estado === 'error').length}</b><span>Sin acceso</span></div>
          </div>
          {(d.estado === 'pendiente' || d.estado === 'procesando') && (
            <div className="card" style={{ margin: '14px 0' }}>
              <b>Leyendo… {hecho} de {d.total}</b>
              <div className="bar" style={{ marginTop: 8 }}><i style={{ width: (d.total ? hecho / d.total * 100 : 0) + '%' }} /></div>
            </div>
          )}
          {d.estado === 'error' && <div className="msg bad">El trabajo se detuvo: {d.detalle || 'error inesperado'}. Puede volver a leer la bibliografía.</div>}

          {d.estado === 'listo' && fijo && (porCargar.length > 0 ? (
            <section className="bib-faltan" style={{ margin: '6px 0 14px' }}>
              <div className="bib-resumen">
                <div><b>{aUsar}</b><span>referencias</span></div>
                <div><b>{aUsar - porCargar.length}</b><span>ya leídas</span></div>
                <div className="pend"><b>{porCargar.length}</b><span>por cargar</span></div>
              </div>
              <h3 style={{ margin: '14px 0 2px' }}>Descargue y suba {porCargar.length === 1 ? 'este documento' : 'estos ' + porCargar.length + ' documentos'}</h3>
              <p className="help" style={{ marginTop: 0 }}>El programa no pudo leerlos solo. Para cada uno: abra el enlace, descargue el archivo (PDF, Word o página guardada) y súbalo. Cuando no quede ninguno, podrá continuar.</p>
              {porCargar.map((f) => (
                <article key={f.id} className="bib-tarjeta">
                  <div className="bib-num">{f.orden}</div>
                  <div className="bib-cuerpo">
                    <p className="bib-ref">{f.referencia_apa ? <Apa t={f.referencia_apa} /> : f.entrada_cruda}</p>
                    <p className="bib-meta">{f.unidad ? 'Unidad ' + f.unidad : ''}{f.categoria ? (f.unidad ? ' · ' : '') + (f.categoria === 'basica' ? 'Bibliografía básica' : 'Bibliografía complementaria') : ''}</p>
                    <div className="bib-pasos">
                      <div className="bib-paso"><i>1</i>{enlaceDe(f) ? <a className="btn sec sm" href={enlaceDe(f)} target="_blank" rel="noopener noreferrer">Abrir y descargar</a> : <span className="help" style={{ margin: 0 }}>Sin enlace en el syllabus: consiga el documento por otro medio</span>}</div>
                      <div className="bib-paso"><i>2</i>
                        <label className="btn sm" style={{ cursor: 'pointer' }}>{subiendo === f.id ? 'Leyendo…' : 'Subir archivo'}
                          <input type="file" accept=".pdf,.docx,.html,.htm,application/pdf" hidden disabled={subiendo === f.id} onChange={(e) => { subir(f, e.target.files[0]); e.target.value = '' }} />
                        </label>
                      </div>
                    </div>
                    <div className="bib-omitir">
                      <span>¿No se puede descargar? Por ejemplo, si pide pago o inicio de sesión.</span>
                      <button className="btn sec sm" type="button" onClick={() => omitir(f, true)}>Omitir esta referencia</button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <div className="msg ok" role="status" style={{ margin: '14px 0' }}><b>Bibliografía completa.</b> Las {aUsar} referencias con documento están leídas y citadas. Todo está listo para enviar a n8n; el envío se activa en el siguiente paso.</div>
          ))}
          {d.estado === 'listo' && fijo && omitidas.length > 0 && (
            <section className="bib-omitidas" aria-label="Referencias omitidas">
              <h3>{omitidas.length === 1 ? 'Se omitirá 1 referencia' : 'Se omitirán ' + omitidas.length + ' referencias'}</h3>
              <p className="help">Sin documento o sin ruta para conseguirlo (no traen enlace, o usted marcó que no se pueden descargar): se dejan fuera de la creación de unidades.</p>
              <ul>
                {omitidas.map((f) => (
                  <li key={f.id}>
                    <span className="bib-num">{f.orden}</span>
                    <div><p className="bib-ref">{f.referencia_apa ? <Apa t={f.referencia_apa} /> : f.entrada_cruda}</p>
                      <small>{f.unidad ? 'Unidad ' + f.unidad : ''}{f.categoria ? (f.unidad ? ' · ' : '') + (f.categoria === 'basica' ? 'Bibliografía básica' : 'Bibliografía complementaria') : ''}</small></div>
                    {esManual(f)
                      ? <button className="btn sec sm" type="button" onClick={() => omitir(f, false)}>Incluir de nuevo</button>
                      : <span className="pill">Omitida · sin enlace</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {d.estado === 'listo' && fijo && <div className="row" style={{ margin: '0 0 8px' }}><button className="btn sec sm" onClick={releer}>Volver a leer toda la bibliografía</button></div>}
          <Envoltura className={fijo ? 'bib-todo' : undefined}>
          {fijo && <summary>Ver todo lo extraído y lo que decía el syllabus ({d.fuentes.length} referencias)</summary>}
          <div className="row" style={{ margin: '14px 0', alignItems: 'center' }}>
            <button className="btn" disabled={d.estado !== 'listo'} onClick={copiar}>Copiar bibliografía (APA 7)</button>
            <div className="seg" role="tablist" aria-label="Filtro">
              {[['todas', 'Todas'], ['leidas', 'Leídas'], ['otras', 'Sin texto']].map(([k, n]) => <button key={k} role="tab" aria-selected={filtro === k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{n}</button>)}
            </div>
            <form className="row" onSubmit={buscar} style={{ marginLeft: 'auto', alignItems: 'center' }}>
              <input type="text" aria-label="Buscar en el texto de todas las fuentes" placeholder="Buscar en el texto leído…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
              <button className="btn sec sm" type="submit">Buscar</button>
            </form>
          </div>

          {res && (
            <section className="card" style={{ marginBottom: 14 }}>
              <h2 style={{ marginTop: 0 }}>{res.length ? res.length + ' resultados para «' + q + '»' : 'Sin resultados para «' + q + '»'}</h2>
              {res.map((x, i) => (
                <div key={i} className="bib-res">
                  <p dangerouslySetInnerHTML={{ __html: String(x.fragmento || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/&lt;b>/g, '<b>').replace(/&lt;\/b>/g, '</b>') }} />
                  <small><b>{x.cita}</b> · {x.formato === 'pdf' ? 'página' : 'bloque'} {x.pagina}</small>
                </div>
              ))}
              <button className="btn sec sm" onClick={() => setRes(null)}>Cerrar resultados</button>
            </section>
          )}

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="sg-tabla bib-tabla"><colgroup><col style={{ width: 84 }} /><col /><col style={{ width: 104 }} /><col style={{ width: 128 }} /><col style={{ width: 168 }} /></colgroup>
              <thead><tr><th>#</th><th>Referencia (APA 7)</th><th>Tipo</th><th>Estado</th><th>Texto leído</th></tr></thead>
              <tbody>
                {fuentes.map((f) => {
                  const [cl, tx] = ESTADO[f.estado] || ESTADO.pendiente
                  const pag = f.documentos.filter((x) => x.estado === 'extraido').reduce((a, x) => a + (x.num_paginas || 0), 0)
                  return (
                    <tr key={f.id}>
                      <td>{f.orden}<br /><small>{f.unidad ? 'U' + f.unidad : ''}{f.categoria ? (f.categoria === 'basica' ? ' · básica' : ' · compl.') : ''}</small></td>
                      <td>
                        {f.referencia_apa ? <Apa t={f.referencia_apa} /> : <span className="help">{f.entrada_cruda}</span>}
                        <br />
                        <small>{f.cita_apa}{' '}
                          {f.cita_apa && <button className="lnk" onClick={() => copiarCita(f)}>copiar cita</button>}
                          {' · '}<button className="lnk" onClick={() => setAbierta(abierta === f.id ? null : f.id)}>{abierta === f.id ? 'ocultar detalle' : 'ver detalle'}</button>
                        </small>
                        {abierta === f.id && (
                          <div className="bib-det">
                            <div className="bib-comp">
                              <div><h4>Lo que decía el syllabus</h4><p>{f.entrada_cruda}</p></div>
                              <div>
                                <h4>Lo que se extrajo</h4>
                                <dl>
                                  <dt>Título</dt><dd>{f.titulo || '—'}</dd>
                                  <dt>Autores</dt><dd>{(f.autores || []).map((a) => (a.nombres ? a.apellido + ', ' + a.nombres : a.apellido)).join('; ') || '—'}</dd>
                                  <dt>Año</dt><dd>{f.anio || 's. f.'}</dd>
                                  <dt>Tipo</dt><dd>{TIPO[f.tipo] || f.tipo}</dd>
                                  <dt>Publicación</dt><dd>{[f.publicacion, f.volumen && 'vol. ' + f.volumen, f.numero && 'n.º ' + f.numero, f.paginas && 'págs. ' + f.paginas].filter(Boolean).join(', ') || f.editorial || '—'}</dd>
                                  <dt>DOI / enlace</dt><dd>{f.doi ? 'https://doi.org/' + f.doi : (enlaceDe(f) || '—')}</dd>
                                  <dt>Idioma</dt><dd>{f.idioma || '—'}</dd>
                                </dl>
                              </div>
                            </div>
                            {f.estado_detalle && <p><b>Notas de la lectura:</b> {f.estado_detalle}</p>}
                            <p><b>Metadatos de:</b> {f.fuente_datos || '—'}</p>
                            {f.documentos.map((x) => (
                              <p key={x.id}><b>{x.formato.toUpperCase()}</b> · {x.estado === 'extraido' ? (x.num_paginas || 0) + (x.formato === 'pdf' ? ' páginas' : ' bloques') + ' · ' + Math.round((x.num_caracteres || 0) / 1000) + ' mil caracteres' : 'error: ' + (x.error || '')} · <a href={x.url} target="_blank" rel="noopener noreferrer">abrir origen</a>{x.estado === 'extraido' && x.num_caracteres > 0 && <> · <button className="lnk" onClick={() => setLector({ doc: x, fuente: f })}>leer el texto</button></>}</p>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{TIPO[f.tipo] || f.tipo}</td>
                      <td><span className={'pill ' + cl}>{tx}</span></td>
                      <td>{pag ? <>{pag} págs./bloques<br /><button className="btn sm" onClick={() => { const dd = f.documentos.filter((x) => x.estado === 'extraido' && x.num_caracteres > 0).sort((a, b) => (b.formato === 'pdf') - (a.formato === 'pdf') || b.num_caracteres - a.num_caracteres)[0]; if (dd) setLector({ doc: dd, fuente: f }) }}>Leer el texto</button></> : '—'}
                        {f.estado !== 'resuelta' && (
                          <div style={{ marginTop: 6 }}>
                            <label className="btn sec sm" style={{ cursor: 'pointer' }}>{subiendo === f.id ? 'Leyendo…' : 'Subir archivo'}
                              <input type="file" accept=".pdf,.docx,.html,.htm,application/pdf" hidden disabled={subiendo === f.id} onChange={(e) => { subir(f, e.target.files[0]); e.target.value = '' }} />
                            </label>
                          </div>
                        )}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </Envoltura>
        </>
      )}
      {lector && <Lector doc={lector.doc} fuente={lector.fuente} onCerrar={() => setLector(null)} onAviso={setAviso} />}
      {!d && !error && !fijo && (
        <ol className="bib-pasos3">
          <li><i>1</i><b>Pegue el enlace</b><span>Del syllabus en Google Docs, con lectura para cualquiera que tenga el enlace.</span></li>
          <li><i>2</i><b>Leemos cada fuente</b><span>Se descarga el PDF o la página y se guarda el texto completo, página por página.</span></li>
          <li><i>3</i><b>Revise y copie</b><span>Verá cada referencia con su cita y la bibliografía completa en APA 7.</span></li>
        </ol>
      )}
    </div>
  )
}
