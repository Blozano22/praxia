import { useEffect, useState } from 'react'
import Titulo from './Titulo.jsx'
import { api } from '../lib/api.js'
import { cargarConfigN8n, guardarWebhook, guardarWebhookGuiones, guardarWebhookH5p, guardarWebhookMatrices, guardarWebhookPublicar, guardarPruebasPlantillas, guardarWebhookPreparacion, guardarWebhookRubricas, leerWebhookRubricas, leerPruebasPlantillas, leerWebhook, leerWebhookGuiones, leerWebhookH5p, leerWebhookPublicar, leerWebhookMatrices, leerWebhookPreparacion } from '../lib/syllabus.js'

// Direcciones (webhooks) de n8n que usa la plataforma. Se guardan en el servidor: el cambio vale para todas las personas.
const RE_URL = /^https:\/\/\S+$/

const ICONOS = {
  capas: 'M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  tabla: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M9 4v16',
  codigo: 'M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14'
}

// Una conexión por fila: qué hace a la izquierda; a la derecha, la dirección y «Guardar».
function Conexion({ titulo, ayuda, icono, leer, guardar, aviso, opcional = false, sinDireccion }) {
  const [valor, setValor] = useState(leer())
  const [guardado, setGuardado] = useState(leer())
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const limpio = valor.trim()
  const valida = RE_URL.test(limpio) || (opcional && !limpio) // las que se pueden vaciar dejan esa función desactivada
  const cambio = limpio !== guardado

  const guardarCambio = async () => {
    if (!valida || ocupado) return
    setOcupado(true); setError('')
    try {
      await guardar(limpio)
      setGuardado(limpio)
      aviso && aviso('Conexión guardada para todos')
    } catch (e) { setError(e.message || 'No se pudo guardar.') }
    setOcupado(false)
  }

  const estado = !valida && limpio ? ['mal', 'Escriba una dirección completa que empiece por https://'] : cambio ? ['cambio', 'Cambios sin guardar'] : !guardado ? ['falta', sinDireccion || 'Falta la dirección'] : ['ok', 'Guardada']
  return (
    <section className={'cx-fila' + (cambio ? ' cambio' : '')}>
      <div className="cx-que">
        <span className="cx-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONOS[icono]} /></svg></span>
        <div><h2>{titulo}</h2><p>{ayuda}</p></div>
      </div>
      <div className="cx-dir">
        <label htmlFor={'cx-' + titulo}>Dirección (webhook)</label>
        <div className="cx-campo">
          <input id={'cx-' + titulo} type="url" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="https://n8n.ejemplo.edu.co/webhook/..." aria-invalid={!valida}
            onKeyDown={(e) => { if (e.key === 'Enter') guardarCambio() }} />
          <button className="btn" disabled={!cambio || !valida || ocupado} onClick={guardarCambio}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
          {cambio && !ocupado && <button className="btn sec" onClick={() => { setValor(guardado); setError('') }}>Descartar</button>}
        </div>
        <span className={'cx-est ' + estado[0]} aria-live="polite"><i aria-hidden="true" />{estado[1]}</span>
        {error && <div className="msg bad" role="alert">{error}</div>}
      </div>
    </section>
  )
}

// Interruptor de la administración: mientras no estén aprobadas las plantillas, al preparar un curso se asigna cualquier plantilla subida.
function ModoPruebas({ aviso }) {
  const [on, setOn] = useState(leerPruebasPlantillas())
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const cambiar = async () => {
    if (ocupado) return
    setOcupado(true); setError('')
    try {
      await guardarPruebasPlantillas(!on)
      setOn(!on)
      aviso && aviso(!on ? 'Modo de pruebas encendido' : 'Modo de pruebas apagado')
    } catch (e) { setError(e.message || 'No se pudo guardar.') }
    setOcupado(false)
  }
  return (
    <section className={'cx-fila cx-pruebas' + (on ? ' activo' : '')}>
      <div className="cx-que">
        <span className="cx-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONOS.codigo} /></svg></span>
        <div>
          <h2>Modo de pruebas de plantillas</h2>
          <p>Mientras no estén aprobadas todas las plantillas, al pedir «Generar guiones» Praxia asigna <b>cualquier plantilla subida</b>, aprobada o no y de cualquier formación (las de la formación del curso van primero), y no se detiene si el curso no dice su formación. Vale para <b>todas las personas</b>, no solo para la administración, y <b>viene encendido</b> hasta que alguien lo apague aquí. <b>Apáguelo cuando las plantillas ya estén aprobadas.</b></p>
        </div>
      </div>
      <div className="cx-dir">
        <label htmlFor="cx-pruebas">Estado</label>
        <div className="cx-campo">
          <button id="cx-pruebas" type="button" role="switch" aria-checked={on} className={'cx-switch' + (on ? ' on' : '')} disabled={ocupado} onClick={cambiar}>
            <i aria-hidden="true" /><span>{on ? 'Encendido' : 'Apagado'}</span>
          </button>
        </div>
        <span className={'cx-est ' + (on ? 'cambio' : 'ok')} aria-live="polite"><i aria-hidden="true" />{on ? 'Encendido: se usan plantillas sin aprobar. Apáguelo cuando ya estén aprobadas.' : 'Apagado: solo se asignan plantillas aprobadas de la formación del curso.'}</span>
        {error && <div className="msg bad" role="alert">{error}</div>}
      </div>
    </section>
  )
}

// Tabla de la administración: texto del «Tipo de actividad» del guion → categoría de actividad (ACT-E-01, ACT-G-08…).
function TiposActividad({ aviso }) {
  const [filas, setFilas] = useState(null)
  const [guardado, setGuardado] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api('GET', '/actividad-tipos').then((r) => { setFilas(r.tipos); setGuardado(JSON.stringify(r.tipos)) }).catch((e) => setError(e.message || 'No se pudo leer la tabla.')) }, [])
  const cambiar = (i, campo, v) => setFilas((f) => f.map((x, j) => (j === i ? { ...x, [campo]: v } : x)))
  const valida = filas && filas.every((f) => f.tipo.trim() && /^ACT-[A-Z]-d{2}$/.test(f.categoria.trim().toUpperCase()))
  const cambio = filas && JSON.stringify(filas) !== guardado
  const guardar = async () => {
    if (!valida || ocupado) return
    setOcupado(true); setError('')
    try {
      const r = await api('PUT', '/actividad-tipos', { reemplazar: true, filas: filas.map((f) => ({ tipo: f.tipo.trim(), categoria: f.categoria.trim().toUpperCase() })) })
      setFilas(r.tipos); setGuardado(JSON.stringify(r.tipos))
      aviso && aviso('Tipos de actividad guardados')
    } catch (e) { setError(e.message || 'No se pudo guardar.') }
    setOcupado(false)
  }
  return (
    <section className={'cx-fila' + (cambio ? ' cambio' : '')}>
      <div className="cx-que">
        <span className="cx-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONOS.tabla} /></svg></span>
        <div><h2>Tipos de actividad</h2><p>Traduce el «Tipo de actividad» del guion a la categoría de actividad. <b>Solo coincide el nombre exacto (sin importar mayúsculas ni tildes)</b>; si no coincide, la actividad no se asigna y se avisa en el recurso.</p></div>
      </div>
      <div className="cx-dir">
        {filas && (
          <table className="cx-tabla">
            <thead><tr><th>Tipo de actividad (texto del guion)</th><th>Categoría</th><th /></tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}>
                  <td><input aria-label="Tipo de actividad" value={f.tipo} maxLength={150} onChange={(e) => cambiar(i, 'tipo', e.target.value)} /></td>
                  <td><input aria-label="Categoría" value={f.categoria} maxLength={8} placeholder="ACT-G-08" onChange={(e) => cambiar(i, 'categoria', e.target.value)} /></td>
                  <td><button type="button" className="btn sec" onClick={() => setFilas((l) => l.filter((_, j) => j !== i))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="cx-campo">
          <button type="button" className="btn sec" disabled={!filas} onClick={() => setFilas((l) => [...l, { tipo: '', categoria: '' }])}>Añadir fila</button>
          <button type="button" className="btn" disabled={!cambio || !valida || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        </div>
        {filas && !valida && <span className="cx-est mal" aria-live="polite"><i aria-hidden="true" />Cada fila necesita un tipo y una categoría con la forma ACT-G-08.</span>}
        {error && <div className="msg bad" role="alert">{error}</div>}
      </div>
    </section>
  )
}

export default function Conexiones({ aviso }) {
  const [listo, setListo] = useState(false)
  const [enCurso, setEnCurso] = useState(0)
  useEffect(() => { api('GET', '/admin/trabajos-en-curso').then((r) => setEnCurso((r && r.total) || 0)).catch(() => {}) }, []) // aviso opcional: si falla, no se muestra
  useEffect(() => { cargarConfigN8n(true).finally(() => setListo(true)) }, []) // siempre lo último guardado en el servidor
  return (
    <div className="wrapx fade">
      <Titulo icono="conexion">
        <h1>Conexión con n8n</h1>
        <p className="lead">Las direcciones de n8n a las que la plataforma envía el trabajo.</p>
        <span className="cx-equipo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M16 5.5a3 3 0 0 1 0 5.5M18 14.5c1.8.6 3 2.2 3 4.5" /></svg>Los cambios los usa todo el equipo</span>
      </Titulo>
      {enCurso > 0 && <p className="cx-pie" role="status">Hay {enCurso} {enCurso === 1 ? 'generación' : 'generaciones'} en curso: no reinicie el servidor.</p>}
      {listo && (
        <>
          <div className="cx-lista2">
            <Conexion titulo="Crear las unidades" icono="capas" ayuda="Recibe el syllabus, la carpeta de destino y la bibliografía leída, y crea un documento por unidad. Solo crea la estructura."
              leer={leerWebhook} guardar={guardarWebhook} aviso={aviso} />
            <Conexion titulo="Preparar el curso (variantes de plantillas)" icono="capas" ayuda="Se llama al pedir «Generar guiones»: lee las estructuras del curso y pide a Praxia la variante de plantilla de cada recurso. Praxia espera su respuesta (200 al terminar) antes de generar los guiones."
              leer={leerWebhookPreparacion} guardar={guardarWebhookPreparacion} aviso={aviso} opcional sinDireccion="Falta la dirección: sin ella la preparación del curso queda desactivada." />
            <ModoPruebas aviso={aviso} />
            <TiposActividad aviso={aviso} />
            <Conexion titulo="Crear los guiones de una unidad" icono="doc" ayuda="Recibe una unidad ya creada y arma sus guiones. Solo se usa al trabajar dentro de un syllabus."
              leer={leerWebhookGuiones} guardar={guardarWebhookGuiones} aviso={aviso} />
            <Conexion titulo="Generar las matrices de recursos" icono="tabla" ayuda="Recibe la orden de crear (o volver a crear) la matriz de una unidad, con su formación y sus guiones. Responde enseguida y avisa el resultado a Praxia."
              leer={leerWebhookMatrices} guardar={guardarWebhookMatrices} aviso={aviso} opcional sinDireccion="Falta la dirección: sin ella no aparece el botón «Generar matriz»." />
            <Conexion titulo="Generar los recursos H5P" icono="codigo" ayuda="Recibe la orden de generar los recursos H5P de las matrices listas, con un máximo por corrida. Responde cuando ya planificó y avisa el avance a Praxia."
              leer={leerWebhookH5p} guardar={guardarWebhookH5p} aviso={aviso} opcional sinDireccion="Falta la dirección: sin ella no aparece el botón «Generar H5P»." />
            <Conexion titulo="Publicar un recurso H5P aprobado" icono="codigo" ayuda="Recibe la orden de armar el .h5p de un recurso que la persona aprobó y subirlo a Drive (si ya existía, reemplaza el contenido del mismo archivo). Responde enseguida y avisa el resultado a Praxia."
              leer={leerWebhookPublicar} guardar={guardarWebhookPublicar} aviso={aviso} opcional sinDireccion="Falta la dirección: sin ella no aparece «Aprobar y publicar»." />
            <Conexion titulo="Generar rúbricas de evaluación" icono="tabla" ayuda="Recibe los enlaces de las unidades de una asignatura (unidad_url, uno por línea) y la carpeta de Drive (carpeta_url), crea la rúbrica en Google Sheets y responde con su enlace (url) y un detalle (log). Praxia espera su respuesta hasta 6 minutos."
              leer={leerWebhookRubricas} guardar={guardarWebhookRubricas} aviso={aviso} opcional sinDireccion="Falta la dirección: sin ella la pantalla «Generar rúbrica» no puede generar." />
          </div>
          <p className="cx-pie">Cada dirección debe empezar por https://. El cambio se aplica a todas las personas desde su siguiente envío.</p>
        </>
      )}
    </div>
  )
}
