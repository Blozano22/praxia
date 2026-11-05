import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { E } from '../lib/engine.js'
import { getIn, leerImagen } from '../lib/util.js'

// Contexto del editor: el recurso que se está editando y cómo cambiarlo.
export const EditorCtx = createContext(null)
export const useEd = () => useContext(EditorCtx)

function AutoTextarea({ value, onChange, rows = 3, ...rest }) {
  const ref = useRef(null)
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = Math.min(420, t.scrollHeight + 4) + 'px'
  }, [value])
  return <textarea ref={ref} rows={rows} value={value} onChange={onChange} {...rest} />
}

// Campo de texto (corto o largo) ligado a una ruta del recurso.
export function Campo({ label, path, long, rows, ph, help }) {
  const { draft, set } = useEd()
  const v = getIn(draft, path) || ''
  return (
    <div>
      <label className="l">{label}</label>
      {long ? (
        <AutoTextarea value={v} rows={rows || 4} placeholder={ph || ''} onChange={(e) => set(path, e.target.value)} />
      ) : (
        <input type="text" value={v} placeholder={ph || ''} onChange={(e) => set(path, e.target.value)} />
      )}
      {help && <p className="help">{help}</p>}
      {long && <span className="help">{E.words(v)} palabras</span>}
    </div>
  )
}

// Lista de textos (pasos, criterios…) con mover, quitar y agregar.
export function Lista({ label, path, add = 'Agregar', help }) {
  const { draft, set } = useEd()
  const arr = getIn(draft, path) || []
  const mover = (i, d) => {
    const j = i + d
    if (j < 0 || j >= arr.length) return
    const n = arr.slice();
    [n[i], n[j]] = [n[j], n[i]]
    set(path, n)
  }
  return (
    <div>
      <label className="l">{label}</label>
      {help && <p className="help">{help}</p>}
      {arr.map((v, i) => (
        <div className="listrow" key={i}>
          <span className="help" style={{ width: 18 }}>{i + 1}.</span>
          <AutoTextarea rows={2} style={{ minHeight: 44 }} value={v} onChange={(e) => set([...path, i], e.target.value)} />
          <button className="ic" title="Subir" onClick={() => mover(i, -1)}>▲</button>
          <button className="ic" title="Bajar" onClick={() => mover(i, 1)}>▼</button>
          <button className="ic d" title="Quitar" onClick={() => set(path, arr.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <button className="btn sec sm" onClick={() => set(path, [...arr, ''])}>＋ {add}</button>
    </div>
  )
}

// Imagen opcional (se reduce para no pesar demasiado).
export function Imagen({ label, path, max = 1000 }) {
  const { draft, set } = useEd()
  const v = getIn(draft, path)
  const fi = useRef(null)
  return (
    <div className="imgp">
      {v && <img src={v} alt="" />}
      <button className="btn sec sm" onClick={() => fi.current.click()}>{v ? 'Cambiar imagen' : label}</button>
      {v && <button className="btn danger sm" onClick={() => set(path, '')}>Quitar</button>}
      <input ref={fi} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files[0]; if (f) leerImagen(f, max, (u) => set(path, u)); e.target.value = '' }} />
    </div>
  )
}

export function Interruptor({ checked, onChange, titulo, texto }) {
  return (
    <label className="tg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div><b>{titulo}</b><span>{texto}</span></div>
    </label>
  )
}

export function Opciones({ valor, opciones, onChange, estilo }) {
  return (
    <div className="seg">
      {opciones.map(([k, n]) => (
        <button key={k} className={valor === k ? 'on' : ''} style={estilo ? estilo(k) : undefined} onClick={() => onChange(k)}>{n}</button>
      ))}
    </div>
  )
}

export function Aviso({ tipo = 'info', children }) {
  return <div className={'msg ' + tipo}>{children}</div>
}

export function useAbiertos() {
  const [a, setA] = useState({})
  return [a, (k) => setA((x) => ({ ...x, [k]: x[k] === false })) ]
}
