import { useEffect, useState } from 'react'
import Titulo from './Titulo.jsx'
import { cargarConfigN8n, guardarWebhook, guardarWebhookGuiones, guardarWebhookH5p, guardarWebhookMatrices, leerWebhook, leerWebhookGuiones, leerWebhookH5p, leerWebhookMatrices } from '../lib/syllabus.js'

// Direcciones (webhooks) de n8n que usa la plataforma. Se guardan en el servidor: el cambio vale para todas las personas.
const RE_URL = /^https:\/\/\S+$/

function Conexion({ titulo, ayuda, leer, guardar, aviso, opcional = false }) {
  const [valor, setValor] = useState(leer())
  const [guardado, setGuardado] = useState(leer())
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const limpio = valor.trim()
  const valida = RE_URL.test(limpio) || (opcional && !limpio) // las opcionales se pueden vaciar: la función queda desactivada
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

  return (
    <section className="card cx-card">
      <div className="cx-cab">
        <div>
          <h2>{titulo}</h2>
          <p className="help">{ayuda}</p>
        </div>
      </div>
      <label className="l" htmlFor={'cx-' + titulo}>Dirección (webhook) de n8n</label>
      <input id={'cx-' + titulo} type="url" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="https://n8n.ejemplo.edu.co/webhook/..." aria-invalid={!valida}
        onKeyDown={(e) => { if (e.key === 'Enter') guardarCambio() }} />
      <p className="help" style={{ color: valida || !limpio ? undefined : '#b73d32' }}>{valida || !limpio ? 'Debe empezar por https://. El cambio lo usan todas las personas desde su siguiente envío.' + (opcional ? ' Si la deja vacía, esa función queda desactivada.' : '') : 'Escriba una dirección completa que empiece por https://.'}</p>
      {error && <div className="msg bad" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="cx-acc">
        <button className="btn" disabled={!cambio || !valida || ocupado} onClick={guardarCambio}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
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
        <p className="lead">Aquí se cambian las direcciones de n8n a las que la plataforma envía el trabajo. Lo que guarde aquí lo usan todas las personas. En «Crear unidades» solo se crea la estructura: un documento por unidad.</p>
      </Titulo>
      {listo && (
        <div className="cx-lista">
          <Conexion titulo="Crear las unidades" ayuda="Recibe el syllabus, la carpeta de destino y la bibliografía leída, y crea un documento por unidad."
            leer={leerWebhook} guardar={guardarWebhook} aviso={aviso} />
          <Conexion titulo="Crear los guiones de una unidad" ayuda="Recibe una unidad ya creada y arma sus guiones. Solo se usa al trabajar dentro de un syllabus."
            leer={leerWebhookGuiones} guardar={guardarWebhookGuiones} aviso={aviso} />
          <Conexion titulo="Generar las matrices de recursos" ayuda="Recibe la orden de crear (o volver a crear) la matriz de una unidad, con su formación y sus guiones. Responde enseguida y avisa el resultado a Praxia. Vacía: el botón «Generar matriz» no aparece."
            leer={leerWebhookMatrices} guardar={guardarWebhookMatrices} aviso={aviso} opcional />
          <Conexion titulo="Generar los recursos H5P" ayuda="Recibe la orden de generar los recursos H5P de las matrices listas, con un máximo por corrida. Responde cuando ya planificó y avisa el avance a Praxia. Vacía: el botón «Generar H5P» no aparece."
            leer={leerWebhookH5p} guardar={guardarWebhookH5p} aviso={aviso} opcional />
        </div>
      )}
    </div>
  )
}
