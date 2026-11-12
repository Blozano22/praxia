import { useEffect, useState } from 'react'
import Titulo from './Titulo.jsx'
import { cargarConfigN8n, guardarWebhook, guardarWebhookGuiones, guardarWebhookH5p, guardarWebhookMatrices, leerWebhook, leerWebhookGuiones, leerWebhookH5p, leerWebhookMatrices } from '../lib/syllabus.js'

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

export default function Conexiones({ aviso }) {
  const [listo, setListo] = useState(false)
  useEffect(() => { cargarConfigN8n(true).finally(() => setListo(true)) }, []) // siempre lo último guardado en el servidor
  return (
    <div className="wrapx fade">
      <Titulo icono="conexion">
        <h1>Conexión con n8n</h1>
        <p className="lead">Las direcciones de n8n a las que la plataforma envía el trabajo.</p>
        <span className="cx-equipo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M16 5.5a3 3 0 0 1 0 5.5M18 14.5c1.8.6 3 2.2 3 4.5" /></svg>Los cambios los usa todo el equipo</span>
      </Titulo>
      {listo && (
        <>
          <div className="cx-lista2">
            <Conexion titulo="Crear las unidades" icono="capas" ayuda="Recibe el syllabus, la carpeta de destino y la bibliografía leída, y crea un documento por unidad. Solo crea la estructura."
              leer={leerWebhook} guardar={guardarWebhook} aviso={aviso} />
            <Conexion titulo="Crear los guiones de una unidad" icono="doc" ayuda="Recibe una unidad ya creada y arma sus guiones. Solo se usa al trabajar dentro de un syllabus."
              leer={leerWebhookGuiones} guardar={guardarWebhookGuiones} aviso={aviso} />
            <Conexion titulo="Generar las matrices de recursos" icono="tabla" ayuda="Recibe la orden de crear (o volver a crear) la matriz de una unidad, con su formación y sus guiones. Responde enseguida y avisa el resultado a Praxia."
              leer={leerWebhookMatrices} guardar={guardarWebhookMatrices} aviso={aviso} opcional sinDireccion="Falta la dirección: sin ella no aparece el botón «Generar matriz»." />
            <Conexion titulo="Generar los recursos H5P" icono="codigo" ayuda="Recibe la orden de generar los recursos H5P de las matrices listas, con un máximo por corrida. Responde cuando ya planificó y avisa el avance a Praxia."
              leer={leerWebhookH5p} guardar={guardarWebhookH5p} aviso={aviso} opcional sinDireccion="Falta la dirección: sin ella no aparece el botón «Generar H5P»." />
          </div>
          <p className="cx-pie">Cada dirección debe empezar por https://. El cambio se aplica a todas las personas desde su siguiente envío.</p>
        </>
      )}
    </div>
  )
}
