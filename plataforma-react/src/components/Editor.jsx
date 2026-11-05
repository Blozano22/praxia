import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorCtx } from './Fields.jsx'
import { PanelContenido, PanelDiseno, PanelOrden, PanelAyuda } from './Paneles.jsx'
import { construirHtml, descargar, NOMBRES, temaBase } from '../lib/render.js'
import { setIn } from '../lib/util.js'

const TABS = [['contenido', 'Contenido'], ['diseno', 'Colores y letra'], ['orden', 'Orden y opciones'], ['ayuda', 'Ayuda']]

export default function Editor({ recurso, proyecto, onGuardar, onVolver, aviso }) {
  const [draft, setDraft] = useState(() => ({
    ...recurso,
    tema: { ...temaBase(), ...(recurso.tema || {}), layout: { ...temaBase().layout, ...((recurso.tema || {}).layout || {}) } }
  }))
  const [tab, setTab] = useState('contenido')
  const [libre, setLibre] = useState(true)
  const [celular, setCelular] = useState(false)
  const [estado, setEstado] = useState('Guardado automáticamente ✔')
  const [html, setHtml] = useState(() => construirHtml(draft, true))
  const ifr = useRef(null)
  const yRef = useRef(0)

  // ----- Historial (deshacer / rehacer) -----
  const hist = useRef({ pila: [draft], i: 0 })
  const [, forzar] = useState(0)
  const saltar = useRef(false)
  useEffect(() => {
    if (saltar.current) { saltar.current = false; return }
    const t = setTimeout(() => {
      const h = hist.current
      if (h.pila[h.i] === draft) return
      h.pila = h.pila.slice(0, h.i + 1).concat([draft]).slice(-60)
      h.i = h.pila.length - 1
      forzar((n) => n + 1)
    }, 500)
    return () => clearTimeout(t)
  }, [draft])
  const mover = (d) => {
    const h = hist.current
    const n = h.i + d
    if (n < 0 || n >= h.pila.length) return
    h.i = n
    saltar.current = true
    setDraft(h.pila[n])
    forzar((x) => x + 1)
  }

  // ----- Cambios -----
  const set = useCallback((path, valor) => setDraft((d) => setIn(d, path, valor)), [])

  // ----- Vista previa (con retraso para no parpadear al escribir) -----
  const primera = useRef(true)
  useEffect(() => {
    if (primera.current) { primera.current = false; return }
    const t = setTimeout(() => {
      try { yRef.current = ifr.current.contentWindow.scrollY } catch (e) { /* sin acceso */ }
      setHtml(construirHtml(draft, libre))
    }, 320)
    return () => clearTimeout(t)
  }, [draft, libre])

  // ----- Guardado automático -----
  const guardada = useRef(draft)
  useEffect(() => {
    if (guardada.current === draft) return
    setEstado('Guardando…')
    const t = setTimeout(() => { guardada.current = draft; onGuardar(draft); setEstado('Guardado automáticamente ✔') }, 700)
    return () => clearTimeout(t)
  }, [draft, onGuardar])
  const salir = () => { if (guardada.current !== draft) onGuardar(draft); onVolver() }

  const ctx = useMemo(() => ({ draft, set }), [draft, set])
  const h = hist.current

  return (
    <EditorCtx.Provider value={ctx}>
      <div className="ed">
        <div className="edL">
          <div className="edBar">
            <button className="btn sec sm" onClick={salir}>← Mis recursos</button>
            <b style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{NOMBRES[draft.tipo]} · {draft.datos.codigo || ''}</b>
            <button className="btn sec sm" disabled={h.i === 0} title="Deshacer el último cambio" onClick={() => mover(-1)}>↶ Deshacer</button>
            <button className="btn sec sm" disabled={h.i >= h.pila.length - 1} title="Rehacer" onClick={() => mover(1)}>↷ Rehacer</button>
          </div>
          <div className="tabs" role="tablist">
            {TABS.map(([k, n]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}
          </div>
          <div className="pn">
            {tab === 'contenido' && <PanelContenido />}
            {tab === 'diseno' && <PanelDiseno />}
            {tab === 'orden' && <PanelOrden />}
            {tab === 'ayuda' && <PanelAyuda />}
          </div>
        </div>
        <div className="edR">
          <div className="edBar">
            <span className="stat">Vista:</span>
            <div className="seg" style={{ margin: 0 }}>
              <button className={libre ? 'on' : ''} title="Muestra todo el recurso sin bloqueos para revisarlo y editarlo" onClick={() => setLibre(true)}>Ver todo</button>
              <button className={libre ? '' : 'on'} title="Muestra el recurso como lo verá el estudiante, con los bloqueos" onClick={() => setLibre(false)}>Como estudiante</button>
            </div>
            <span className="stat">Ver en:</span>
            <div className="seg" style={{ margin: 0 }}>
              <button className={celular ? '' : 'on'} onClick={() => setCelular(false)}>Computador</button>
              <button className={celular ? 'on' : ''} onClick={() => setCelular(true)}>Celular</button>
            </div>
            <span className="sp" />
            <span className="stat">{estado}</span>
            <button className="btn gold sm" onClick={() => { descargar(draft); aviso('Descargando…') }}>Descargar recurso</button>
          </div>
          <div className={'pvWrap' + (celular ? ' cel' : '')}>
            <iframe ref={ifr} title="Vista previa del recurso" srcDoc={html}
              onLoad={() => { try { ifr.current.contentWindow.scrollTo(0, yRef.current) } catch (e) { /* sin acceso */ } }} />
          </div>
        </div>
      </div>
    </EditorCtx.Provider>
  )
}
