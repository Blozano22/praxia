import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, RUTA_API } from '../lib/api.js'
import codigoEditor from '../lib/editor-campos.js?raw'
import './editor-recurso.css'

// Editor de un recurso H5P ya generado: se pinta la plantilla con el contenido (JSON) que guardó el flujo, dentro de un iframe aislado (sandbox sin
// allow-same-origin: sus scripts no pueden usar la sesión de Praxia), y con un clic en un texto se edita ese campo del JSON. Solo se cambian textos:
// el servidor rechaza cualquier cambio de estructura. «Descargar .h5p» lo arma el servidor con el servicio de plantillas (la clave no llega al navegador).
// El módulo del iframe (src/lib/editor-campos.js) viene del servicio de H5P; habla con esta pantalla por postMessage ({ fuente: 'praxia-editor', … }).

const NIVEL = { tecnologico: 'tecnologia', profesional: 'profesional', especializacion: 'especializacion', doctorado: 'doctorado' }
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const json = (o) => JSON.stringify(o).replace(/<\//g, '<\\/') // dentro de un <script>

function ponerRuta(obj, ruta, valor) {
  const ks = ruta.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let a = obj
  for (let i = 0; i < ks.length - 1; i++) { a = a == null ? a : a[ks[i]]; if (a == null) return false }
  if (a == null) return false
  a[ks[ks.length - 1]] = valor
  return true
}

// La página de la plantilla con el contenido puesto (igual que la vista de ejemplo) y el editor inyectado.
function armarPagina(esqueleto, contenido, titulo, formacion, activo) {
  const marca = NIVEL[formacion] ? '<script>window.__NIVEL=' + JSON.stringify(NIVEL[formacion]) + '</script>' : ''
  let h = esqueleto.replace('{{TITULO}}', () => esc(titulo || 'Recurso')).replace('/*CONTENIDO*/', () => json(contenido))
  if (marca) h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + marca) : marca + h
  const editor = '<script>' + codigoEditor + '</script><script>PraxiaEditor.iniciar({ contenido: ' + json(contenido) + ', activo: ' + (activo ? 'true' : 'false') + ' })</script>'
  return /<\/body>/i.test(h) ? h.replace(/<\/body>/i, () => editor + '</body>') : h + editor
}

export default function EditorRecurso({ proyecto, recurso, onCerrar }) {
  const [estado, setEstado] = useState('cargando') // cargando | listo | error
  const [error, setError] = useState('')
  const [pagina, setPagina] = useState('')
  const [campos, setCampos] = useState([])
  const [activo, setActivo] = useState(true)
  const [sucio, setSucio] = useState(false)
  const [msg, setMsg] = useState(null) // { tipo: 'ok' | 'bad' | 'warn', texto }
  const [ocupado, setOcupado] = useState('')
  const [verTodos, setVerTodos] = useState(false)
  const ref = useRef({ contenido: null, esqueleto: '', titulo: '', formacion: null, activo: true })
  const marco = useRef(null)
  const ruta = '/proyectos/' + encodeURIComponent(proyecto) + '/pipeline/recursos/' + encodeURIComponent(recurso.id) + '/contenido'

  const pintar = useCallback((activoAhora) => {
    const r = ref.current
    setPagina(armarPagina(r.esqueleto, r.contenido, r.titulo, r.formacion, activoAhora))
  }, [])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const c = await api('GET', ruta)
        if (!c.plantilla) throw new Error('Este recurso no tiene plantilla registrada.')
        const r = await fetch(RUTA_API.replace(/\/api$/, '') + '/plantillas-html/' + encodeURIComponent(c.plantilla) + '.html')
        if (!r.ok) throw new Error('No se encontró la plantilla ' + c.plantilla.toUpperCase() + '.')
        const esqueleto = await r.text()
        if (!vivo) return
        ref.current = { contenido: c.contenido, esqueleto, titulo: (c.contenido && c.contenido.titulo) || c.titulo, formacion: c.formacion || null, activo: true }
        pintar(true)
        setEstado('listo')
      } catch (e) { if (vivo) { setError(e.message || 'No se pudo abrir el editor'); setEstado('error') } }
    })()
    return () => { vivo = false }
  }, [ruta, pintar])

  // Mensajes del módulo del iframe
  useEffect(() => {
    const alMensaje = (e) => {
      if (!marco.current || e.source !== marco.current.contentWindow) return
      const d = e.data
      if (!d || d.fuente !== 'praxia-editor') return
      if (d.tipo === 'listo' || d.tipo === 'lista') setCampos(Array.isArray(d.campos) ? d.campos : [])
      else if (d.tipo === 'campo' && typeof d.ruta === 'string' && typeof d.valor === 'string') {
        if (!ponerRuta(ref.current.contenido, d.ruta, d.valor)) return
        setSucio(true); setMsg(null)
        setCampos((cs) => cs.map((c) => (c.ruta === d.ruta ? { ...c, valor: d.valor } : c)))
        if (!d.parchado) pintar(ref.current.activo) // el texto no se pudo cambiar en pantalla: se vuelve a pintar con el JSON nuevo
      } else if (d.tipo === 'sin_campo') setMsg({ tipo: 'warn', texto: 'Ese texto no viene de un campo que se pueda editar por clic. Búscalo en la lista de textos de la derecha.' })
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [pintar])

  const cambiarModo = (v) => {
    ref.current.activo = v; setActivo(v)
    try { marco.current && marco.current.contentWindow.postMessage({ fuente: 'praxia-editor', tipo: 'modo', activo: v }, '*') } catch { /* iframe aún sin cargar */ }
  }

  const editarLista = (c, valor) => {
    if (valor === c.valor) return
    if (!ponerRuta(ref.current.contenido, c.ruta, valor)) return
    setSucio(true); setMsg(null)
    setCampos((cs) => cs.map((x) => (x.ruta === c.ruta ? { ...x, valor } : x)))
    pintar(ref.current.activo)
  }

  const guardar = async () => {
    setOcupado('guardar'); setMsg(null)
    try { await api('PUT', ruta, { contenido: ref.current.contenido }); setSucio(false); setMsg({ tipo: 'ok', texto: 'Cambios guardados.' }); return true }
    catch (e) { setMsg({ tipo: 'bad', texto: e.message || 'No se pudo guardar.' }); return false }
    finally { setOcupado('') }
  }

  const descargar = async () => {
    if (sucio && !(await guardar())) return
    setOcupado('h5p'); setMsg(null)
    try {
      const r = await fetch(RUTA_API + '/proyectos/' + encodeURIComponent(proyecto) + '/pipeline/recursos/' + encodeURIComponent(recurso.id) + '/h5p', { method: 'POST', credentials: 'same-origin', headers: { 'x-ova': '1' } })
      if (!r.ok) { let d = null; try { d = await r.json() } catch { /* sin cuerpo */ } throw new Error((d && d.error) || 'No se pudo armar el H5P (' + r.status + ').') }
      const sin = r.headers.get('x-iconos-sin-resolver')
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url; a.download = ((recurso.codigo || recurso.id) + '').replace(/[^A-Za-z0-9_-]+/g, '_') + '.h5p'
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000)
      setMsg(sin ? { tipo: 'warn', texto: 'Descargado, pero no se pudieron resolver estos íconos: ' + sin } : { tipo: 'ok', texto: 'H5P descargado con los cambios.' })
    } catch (e) { setMsg({ tipo: 'bad', texto: e.message || 'No se pudo armar el H5P.' }) }
    finally { setOcupado('') }
  }

  const cerrar = () => { if (sucio && !window.confirm('Hay cambios sin guardar. ¿Cerrar sin guardarlos?')) return; onCerrar() }
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape' && !sucio) onCerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [sucio, onCerrar])

  const sinPantalla = useMemo(() => campos.filter((c) => !c.enPantalla), [campos])
  const lista = verTodos ? campos : sinPantalla

  return (
    <div className="er-fondo" role="dialog" aria-modal="true" aria-label={'Editar ' + (recurso.codigo || recurso.id)}>
      <div className="er-caja">
        <header className="er-cab">
          <div className="er-tt"><b>{recurso.codigo || recurso.id}</b><span>{recurso.titulo || 'Sin título'}</span></div>
          <label className="er-modo"><input type="checkbox" checked={activo} onChange={(e) => cambiarModo(e.target.checked)} /> Editar con clic</label>
          <button type="button" className="er-b" onClick={guardar} disabled={!sucio || !!ocupado}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar cambios'}</button>
          <button type="button" className="er-b pri" onClick={descargar} disabled={!!ocupado}>{ocupado === 'h5p' ? 'Armando el H5P…' : 'Descargar .h5p'}</button>
          <button type="button" className="er-x" onClick={cerrar} aria-label="Cerrar el editor">×</button>
        </header>
        {msg && <p className={'er-msg ' + msg.tipo} role="status">{msg.texto}</p>}
        {estado === 'cargando' && <p className="er-vacio">Abriendo el recurso…</p>}
        {estado === 'error' && <p className="er-msg bad">{error}</p>}
        {estado === 'listo' && (
          <div className="er-cuerpo">
            <iframe ref={marco} className="er-marco" title="Vista del recurso" sandbox="allow-scripts" srcDoc={pagina} />
            <aside className="er-lado">
              <div className="er-lado-cab">
                <b>{verTodos ? 'Todos los textos' : 'Textos que no se editan por clic'}</b>
                <button type="button" className="er-link" onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Ver solo los de respaldo' : 'Ver todos (' + campos.length + ')'}</button>
              </div>
              {!lista.length && <p className="er-vacio">{verTodos ? 'No hay textos.' : 'Todos los textos se pueden editar con un clic.'}</p>}
              <ul>
                {lista.map((c) => (
                  <li key={c.ruta}>
                    <label>
                      <span>{c.etiqueta}</span>
                      {c.largo
                        ? <textarea defaultValue={c.valor} key={c.ruta + '|' + c.valor} rows={4} onBlur={(e) => editarLista(c, e.target.value)} />
                        : <input type="text" defaultValue={c.valor} key={c.ruta + '|' + c.valor} onBlur={(e) => editarLista(c, e.target.value)} />}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="er-pie">Solo se cambian textos. Los íconos y valores fijos (encabezado, tipo…) no se editan aquí.</p>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
