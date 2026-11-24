import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { promptGenerar, promptModificar } from '../lib/promptIconos.js'
import './banco-iconos.css'

// Banco de íconos: SVG reemplazables que el flujo de H5P coloca en los campos «icono» de las plantillas. Se suben en un paquete .json (o uno a uno), se ven con el color de cada
// formación (los íconos no traen colores fijos: usan currentColor y, el segundo tono, --ico-2), y se pueden editar, archivar y restaurar. El servidor valida y normaliza cada SVG.

const FORMACIONES = [['tecnologico', 'Tecnológico', '#00665F'], ['profesional', 'Profesional', '#1C45B4'], ['especializacion', 'Especialización', '#08A6CB'], ['doctorado', 'Doctorado', '#22335D']]
const POR_PAGINA = 60
const TIPOS = [['', 'Todos'], ['recurso', 'Recursos'], ['actividad', 'Actividades']]
const ESTADOS = [['activos', 'Activos'], ['archivados', 'Archivados'], ['todos', 'Todos']]
const comas = (t) => String(t || '').split(',').map((x) => x.trim()).filter(Boolean)
const aForm = (i) => ({ id: i.id, tipo: i.tipo, nombre_es: i.nombre_es, nombre_en: i.nombre_en, etiquetas_es: (i.etiquetas_es || []).join(', '), etiquetas_en: (i.etiquetas_en || []).join(', '), descripcion: i.descripcion,
  prompt: i.prompt, estilo: i.estilo, tonos: String(i.tonos), conjunto: i.conjunto || '', categoria: i.categoria || '', subcategoria: i.subcategoria || '', svg: '' })
const aCuerpo = (f, conSvg) => ({ ...(conSvg ? { id: f.id.trim() } : {}), tipo: f.tipo, nombre_es: f.nombre_es, nombre_en: f.nombre_en, etiquetas_es: comas(f.etiquetas_es), etiquetas_en: comas(f.etiquetas_en),
  descripcion: f.descripcion, prompt: f.prompt, estilo: f.estilo.trim(), tonos: Number(f.tonos), conjunto: f.conjunto, categoria: f.categoria, subcategoria: f.subcategoria, ...(f.svg.trim() ? { svg: f.svg } : {}) })

function Campos({ f, set, nuevo, leerSvg }) {
  const c = (k, ayuda) => ({ value: f[k], onChange: (e) => set({ ...f, [k]: e.target.value }), ...(ayuda ? { placeholder: ayuda } : {}) })
  return (
    <div className="bi-form">
      <label>Id{nuevo ? '' : ' (no se cambia)'}<input {...c('id', 'candado-seguridad')} disabled={!nuevo} maxLength={80} /></label>
      <label>Tipo<select {...c('tipo')}><option value="recurso">Recurso</option><option value="actividad">Actividad</option></select></label>
      <label>Nombre en español<input {...c('nombre_es', 'Candado')} maxLength={80} /></label>
      <label>Nombre en inglés<input {...c('nombre_en', 'Padlock')} maxLength={80} /></label>
      <label className="ancho">Etiquetas en español (separadas por comas; de 3 a 12)<input {...c('etiquetas_es', 'candado, seguridad, privacidad')} /></label>
      <label className="ancho">Etiquetas en inglés<input {...c('etiquetas_en', 'padlock, security, privacy')} /></label>
      <label className="ancho">Descripción: qué representa y cuándo usarlo<textarea rows={2} {...c('descripcion')} maxLength={400} /></label>
      <label className="ancho">Prompt con el que se generó<textarea rows={2} {...c('prompt')} maxLength={2000} /></label>
      <label>Estilo<input {...c('estilo', 'relieve')} maxLength={40} /></label>
      <label>Tonos<select {...c('tonos')}><option value="1">1 (un color)</option><option value="2">2 (principal y secundario)</option></select></label>
      <label>Conjunto (opcional)<input {...c('conjunto', 'serie-1')} maxLength={60} /></label>
      <label>Categoría (opcional, informativa)<input {...c('categoria')} maxLength={80} /></label>
      <label>Subcategoría (opcional, informativa)<input {...c('subcategoria')} maxLength={80} /></label>
      <label className="ancho">{nuevo ? 'SVG' : 'Reemplazar el SVG (opcional)'}
        <textarea rows={4} {...c('svg', '<svg viewBox="0 0 24 24">…</svg>')} spellCheck={false} />
        <input type="file" accept=".svg,image/svg+xml" onChange={async (e) => { const t = await leerSvg(e.target.files && e.target.files[0]); if (t !== null) set({ ...f, svg: t }); e.target.value = '' }} />
      </label>
    </div>
  )
}

export default function BancoIconos({ puedeGestionar = false, aviso }) {
  const [tipo, setTipo] = useState('')
  const [estado, setEstado] = useState('activos')
  const [estilo, setEstilo] = useState('')
  const [q, setQ] = useState('')
  const [qFiltro, setQFiltro] = useState('')
  const [datos, setDatos] = useState({ total: 0, iconos: [] })
  const [estilos, setEstilos] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [color, setColor] = useState(0)
  const [resultado, setResultado] = useState(null)
  const [ia, setIa] = useState(null) // panel «generar con IA»: { estilo, tonos, relieve, pedido, categoria }
  const [copiado, setCopiado] = useState('')
  const [edit, setEdit] = useState(null)
  const entrada = useRef(null)

  useEffect(() => { const t = setTimeout(() => setQFiltro(q.trim()), 300); return () => clearTimeout(t) }, [q])
  const consulta = useCallback((desde) => '/iconos?estado=' + estado + (tipo ? '&tipo=' + tipo : '') + (estilo ? '&estilo=' + encodeURIComponent(estilo) : '') + (qFiltro ? '&q=' + encodeURIComponent(qFiltro) : '') + '&limite=' + POR_PAGINA + '&desde=' + desde, [estado, tipo, estilo, qFiltro])
  const cargar = useCallback(async () => {
    setCargando(true)
    try { setDatos(await api('GET', consulta(0))); setError('') } catch (e) { setError(e.message || 'No se pudo cargar el banco.') }
    setCargando(false)
  }, [consulta])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { api('GET', '/iconos/estilos').then((r) => setEstilos([...new Set((r.estilos || []).map((x) => x.estilo))])).catch(() => {}) }, [datos.total])
  const masCargar = async () => {
    setCargando(true)
    try { const r = await api('GET', consulta(datos.iconos.length)); setDatos((d) => ({ total: r.total, iconos: [...d.iconos, ...r.iconos] })) } catch (e) { setError(e.message || 'No se pudo cargar más.') }
    setCargando(false)
  }
  const hacer = async (fn, ok) => {
    setOcupado(true); setError('')
    try { await fn(); await cargar(); if (ok && aviso) aviso(ok) } catch (e) { setError(e.message || 'No se pudo completar.') }
    setOcupado(false)
  }
  const leerArchivo = async (f, max = 12 * 1024 * 1024) => {
    if (!f) return null
    if (f.size > max) { setError('El archivo pesa demasiado (máximo ' + Math.round(max / 1024 / 1024) + ' MB).'); return null }
    try { return await f.text() } catch { setError('No se pudo leer el archivo.'); return null }
  }
  const subirPaquete = async (f) => {
    const texto = await leerArchivo(f)
    if (texto === null) return
    let obj
    try { obj = JSON.parse(texto) } catch { setError('El archivo no es un JSON válido.'); return }
    setOcupado(true); setError(''); setResultado(null)
    try { setResultado(await api('POST', '/iconos/paquete', obj)); await cargar() } catch (e) { setError(e.message || 'No se pudo subir el paquete.') }
    setOcupado(false)
  }
  const leerSvg = (f) => leerArchivo(f, 200 * 1024)
  const copiar = async (texto, clave) => {
    try { await navigator.clipboard.writeText(texto) } catch {
      const t = document.createElement('textarea'); t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select()
      try { document.execCommand('copy') } catch { setError('No se pudo copiar. Seleccione el texto y cópielo con Ctrl+C.'); t.remove(); return }
      t.remove()
    }
    setCopiado(clave); setTimeout(() => setCopiado((c) => (c === clave ? '' : c)), 2500)
  }
  const guardar = () => hacer(async () => { await api('PUT', '/iconos/' + encodeURIComponent(edit.id), aCuerpo(edit, false)); setEdit(null) }, 'Ícono guardado')
  const archivar = (i, v) => hacer(() => api('PUT', '/iconos/' + encodeURIComponent(i.id) + '/archivo', { archivado: v }), v ? 'Ícono archivado' : 'Ícono restaurado')
  const vista = { color: FORMACIONES[color][2], '--ico-2': '#142749' }

  return (
    <div className="bi">
      <p className="lead">Íconos <b>reemplazables</b> para los recursos y las actividades. No traen colores fijos: toman el de la formación (se ven abajo con la que elijas). El flujo de H5P los pide por su descripción y etiquetas, <b>del tipo de la variante</b> (recurso o actividad).</p>
      {error && <div className="msg bad" role="alert">{error}</div>}

      {puedeGestionar && (
        <div className="bi-acciones">
          <input ref={entrada} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; subirPaquete(f) }} />
          <button type="button" className="btn" disabled={ocupado} onClick={() => entrada.current && entrada.current.click()}>Subir un paquete (.json)</button>
          <button type="button" className="btn sec" disabled={ocupado} onClick={() => setIa(ia ? null : { estilo: '', tonos: '1', relieve: false, pedido: '', categoria: '' })}>{ia ? 'Cerrar' : 'Generar íconos con IA'}</button>
          <span className="help">Para crear íconos nuevos, use «Generar íconos con IA».</span>
        </div>
      )}

      {resultado && (
        <div className={'bi-res' + (resultado.rechazados.length ? ' con-errores' : '')} role="status">
          <b>{resultado.creados} nuevos · {resultado.actualizados} actualizados · {resultado.rechazados.length} rechazados</b> <span>de {resultado.total} del paquete</span>
          <button type="button" className="lnk" onClick={() => setResultado(null)}>Cerrar</button>
          {(resultado.renombrados || []).length > 0 && <p className="bi-arch-aviso">{resultado.renombrados.length === 1 ? 'Un ícono traía un id que ya usa otro dibujo' : resultado.renombrados.length + ' íconos traían un id que ya usa otro dibujo'}: se guardaron los dos, el nuevo con otro id ({resultado.renombrados.slice(0, 6).map((x) => x.id + ' → ' + x.como).join(', ')}{resultado.renombrados.length > 6 ? '…' : ''}).</p>}
          {(resultado.siguenArchivados || []).length > 0 && <p className="bi-arch-aviso">{resultado.siguenArchivados.length === 1 ? 'Un ícono actualizado sigue archivado' : resultado.siguenArchivados.length + ' íconos actualizados siguen archivados'} (no se ofrecen al flujo de H5P hasta que los restaures): {resultado.siguenArchivados.slice(0, 8).join(', ')}{resultado.siguenArchivados.length > 8 ? '…' : ''}</p>}
          {resultado.rechazados.length > 0 && <ul>{resultado.rechazados.map((r, i) => <li key={r.id + i}><b>{r.id}</b>: {r.motivo}</li>)}</ul>}
        </div>
      )}

      {puedeGestionar && ia && (
        <div className="bi-panel">
          <h3>Generar íconos con IA</h3>
          <ol className="help">
            <li>Escriba qué íconos necesita.</li>
            <li>Copie el prompt y péguelo en ChatGPT u otra IA.</li>
            <li>Guarde la respuesta como archivo .json.</li>
            <li>Súbalo con «Subir un paquete (.json)».</li>
          </ol>
          <div className="bi-form">
            <label className="ancho">Íconos que necesita<textarea rows={3} value={ia.pedido} onChange={(e) => setIa({ ...ia, pedido: e.target.value })} placeholder="candado, escudo, lupa, bombilla, gráfico de barras…" /></label>
            <label>Categoría (opcional)<input value={ia.categoria} maxLength={80} onChange={(e) => setIa({ ...ia, categoria: e.target.value })} /></label>
          </div>
          <textarea className="bi-prompt" readOnly rows={8} value={promptGenerar({ ...ia, tonos: Number(ia.tonos) })} onFocus={(e) => e.target.select()} aria-label="Prompt para generar los íconos" />
          <div className="bi-btns"><button type="button" className="btn" onClick={() => copiar(promptGenerar({ ...ia, tonos: Number(ia.tonos) }), 'generar')}>{copiado === 'generar' ? 'Copiado ✓' : 'Copiar prompt'}</button></div>
        </div>
      )}

      <div className="bi-filtros">
        <div className="bi-seg" role="group" aria-label="Tipo">{TIPOS.map(([k, t]) => <button key={k} type="button" className={tipo === k ? 'on' : ''} aria-pressed={tipo === k} onClick={() => setTipo(k)}>{t}</button>)}</div>
        <div className="bi-seg" role="group" aria-label="Estado">{ESTADOS.map(([k, t]) => <button key={k} type="button" className={estado === k ? 'on' : ''} aria-pressed={estado === k} onClick={() => setEstado(k)}>{t}</button>)}</div>
        {estilos.length > 0 && <select value={estilo} onChange={(e) => setEstilo(e.target.value)} aria-label="Estilo"><option value="">Todos los estilos</option>{estilos.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
        <input type="search" className="bi-buscar" placeholder="Buscar por nombre, etiqueta o descripción…" aria-label="Buscar íconos" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="bi-colores" role="group" aria-label="Color de la vista previa">
          {FORMACIONES.map(([k, t, c], i) => <button key={k} type="button" className={color === i ? 'on' : ''} style={{ '--c': c }} title={'Ver con el color de ' + t} aria-label={'Ver con el color de ' + t} aria-pressed={color === i} onClick={() => setColor(i)} />)}
        </div>
      </div>

      <p className="help bi-cuenta">{cargando && !datos.iconos.length ? 'Cargando…' : datos.total + (datos.total === 1 ? ' ícono' : ' íconos')}</p>
      {!cargando && !datos.iconos.length && !error && <p className="bi-vacio">{qFiltro || tipo || estilo ? 'No hay íconos con esos filtros.' : 'Todavía no hay íconos en el banco.' + (puedeGestionar ? ' Sube un paquete para empezar.' : '')}</p>}

      <ul className="bi-grid">
        {datos.iconos.map((i) => (
          <li key={i.id} className={'bi-card' + (i.archivado ? ' arch' : '')}>
            <div className="bi-prev" style={vista} dangerouslySetInnerHTML={{ __html: i.svg }} />
            <b title={i.nombre_es}>{i.nombre_es}</b>
            <span className="bi-en">{i.nombre_en}</span>
            <span className="bi-id" title={i.id}>{i.id}</span>
            <div className="bi-ins"><em className={'bi-tipo ' + i.tipo}>{i.tipo === 'recurso' ? 'Recurso' : 'Actividad'}</em><em>{i.estilo}</em><em>{i.tonos === 2 ? '2 tonos' : '1 tono'}</em>{i.archivado && <em className="bi-a">Archivado</em>}</div>
            <p className="bi-desc" title={i.descripcion}>{i.descripcion}</p>
            <p className="bi-tags">{(i.etiquetas_es || []).slice(0, 4).join(' · ')}</p>
            {puedeGestionar && (
              <div className="bi-btns">
                <button type="button" className="lnk" disabled={ocupado} onClick={() => setEdit(aForm(i))}>Editar</button>
                <button type="button" className="lnk" disabled={ocupado} onClick={() => archivar(i, !i.archivado)}>{i.archivado ? 'Restaurar' : 'Archivar'}</button>
                <button type="button" className="lnk" title="Copia un prompt con los datos y el SVG de este ícono para pedirle a una IA que lo modifique. Pegue el SVG que le devuelva en Editar → Reemplazar el SVG" onClick={() => copiar(promptModificar(i), i.id)}>{copiado === i.id ? 'Copiado ✓ (luego Editar → pegar el SVG)' : 'Copiar para modificar con IA'}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {datos.iconos.length < datos.total && <p className="bi-mas"><button type="button" className="btn sec" disabled={cargando} onClick={masCargar}>{cargando ? 'Cargando…' : 'Ver más (' + (datos.total - datos.iconos.length) + ')'}</button></p>}

      {edit && (
        <div className="bi-fondo" role="dialog" aria-modal="true" aria-label={'Editar ' + edit.id}>
          <div className="bi-modal">
            <h3>Editar «{edit.id}»</h3>
            <Campos f={edit} set={setEdit} nuevo={false} leerSvg={leerSvg} />
            <div className="bi-btns"><button type="button" className="btn" disabled={ocupado} onClick={guardar}>Guardar</button><button type="button" className="btn sec" onClick={() => setEdit(null)}>Cancelar</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
