import { useRef, useState } from 'react'
import { E } from '../lib/engine.js'
import { apiArchivo } from '../lib/api.js'

// Zona para cargar el guion de recursos (Word, texto o texto pegado) de un syllabus.
export default function CargarGuion({ onAnalizado, onCancelar }) {
  const [msg, setMsg] = useState(null)
  const [pegar, setPegar] = useState(false)
  const [texto, setTexto] = useState('')
  const [enlace, setEnlace] = useState('')
  const [over, setOver] = useState(false)
  const fi = useRef(null)

  function terminar(blocks, nombre) {
    const an = E.analizar(blocks)
    if (!an.recursos.length) {
      if (an.diagnostico) { setMsg({ t: 'bad', c: <><b>No hay recursos para crear. </b>{an.diagnostico}</> }); return }
      setMsg({ t: 'bad', c: <><b>No encontramos recursos en este guion. </b>La plataforma busca una línea con el código del recurso y su nombre, por ejemplo «U2-T1-OVA1 Videos explicativos con audio», seguida de su contenido (escenas, nodos, bloques o secciones). Revise que el guion tenga ese formato.</> })
      return
    }
    onAnalizado({ nombre, info: an.info, recursos: an.recursos })
  }
  async function cargar(f) {
    setMsg({ t: 'info', c: 'Leyendo «' + f.name + '»…' })
    try {
      let blocks
      if (/\.docx$/i.test(f.name)) blocks = await E.leerDocx(await f.arrayBuffer())
      else if (/\.(txt|md)$/i.test(f.name)) blocks = E.textoBlocks(await f.text())
      else throw new Error('Por ahora la plataforma lee guiones en Word (.docx), .txt o .md. Si su guion está en otro formato, guárdelo como .docx desde Word.')
      terminar(blocks, f.name)
    } catch (e) { setMsg({ t: 'bad', c: e.message || String(e) }) }
  }
  async function cargarEnlace() {
    if (!enlace.trim()) { setMsg({ t: 'bad', c: 'Pegue primero el enlace del guion en Google Docs.' }); return }
    setMsg({ t: 'info', c: 'Descargando el guion desde Google Docs…' })
    try {
      terminar(await E.leerDocx(await apiArchivo('/guion-url', { url: enlace.trim() })), 'Google Docs')
    } catch (e) { setMsg({ t: 'bad', c: e.message || String(e) }) }
  }
  const leerTexto = () => {
    if (!texto.trim()) { setMsg({ t: 'bad', c: 'Pegue primero el texto del guion.' }); return }
    terminar(E.textoBlocks(texto), 'Texto pegado')
  }

  return (
    <div>
      <div className={'drop' + (over ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) cargar(f) }}>
        <h2>Cargue el guion de recursos</h2>
        <p>Arrastre aquí el archivo del guion (Word .docx, .txt o .md) o búsquelo en su computador.</p>
        <div className="row center" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => fi.current.click()}>Seleccionar archivo</button>
          <button className="btn sec" onClick={() => setPegar(!pegar)}>Pegar texto del guion</button>
          {onCancelar && <button className="btn sec" onClick={onCancelar}>Cancelar</button>}
        </div>
        <input ref={fi} type="file" accept=".docx,.txt,.md" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; if (f) cargar(f); e.target.value = '' }} />
      </div>
      <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
        <input type="text" aria-label="Enlace del guion en Google Docs" style={{ flex: 1, minWidth: 260 }} placeholder="…o pegue el enlace del guion en Google Docs" value={enlace} onChange={(e) => setEnlace(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') cargarEnlace() }} />
        <button className="btn" onClick={cargarEnlace}>Leer enlace</button>
      </div>
      {pegar && (
        <div>
          <textarea style={{ minHeight: 140, marginTop: 10 }} placeholder="Pegue aquí el texto del guion…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <button className="btn" style={{ marginTop: 8 }} onClick={leerTexto}>Leer este texto</button>
        </div>
      )}
      {msg && <div className={'msg ' + msg.t}>{msg.c}</div>}
    </div>
  )
}
