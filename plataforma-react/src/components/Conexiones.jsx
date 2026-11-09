import { useState } from 'react'
import { guardarWebhook, guardarWebhookGuiones, leerWebhook, leerWebhookGuiones, WEBHOOK_GUIONES_POR_DEFECTO, WEBHOOK_POR_DEFECTO } from '../lib/syllabus.js'

// Direcciones (webhooks) de n8n que usa la plataforma. Se guardan en este navegador; vacío = la dirección original.
const RE_URL = /^https:\/\/\S+$/

function Conexion({ titulo, ayuda, defecto, leer, guardar, aviso }) {
  const [valor, setValor] = useState(leer())
  const [guardado, setGuardado] = useState(leer())
  const limpio = valor.trim()
  const valida = RE_URL.test(limpio)
  const cambio = limpio !== guardado
  const personalizada = guardado !== defecto

  const guardarCambio = () => {
    if (!valida) return
    guardar(limpio === defecto ? '' : limpio)
    setGuardado(limpio)
    aviso && aviso('Conexión guardada')
  }
  const restablecer = () => {
    guardar('')
    setValor(defecto); setGuardado(defecto)
    aviso && aviso('Se restableció la dirección original')
  }

  return (
    <section className="card cx-card">
      <div className="cx-cab">
        <div>
          <h2>{titulo}</h2>
          <p className="help">{ayuda}</p>
        </div>
        <span className={'pill ' + (personalizada ? 'warn' : 'ok')}>{personalizada ? 'Dirección personalizada' : 'Dirección original'}</span>
      </div>
      <label className="l" htmlFor={'cx-' + titulo}>Dirección (webhook) de n8n</label>
      <input id={'cx-' + titulo} type="url" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="https://n8n.ejemplo.edu.co/webhook/..." aria-invalid={!valida}
        onKeyDown={(e) => { if (e.key === 'Enter') guardarCambio() }} />
      <p className="help" style={{ color: valida || !limpio ? undefined : '#b73d32' }}>{valida || !limpio ? 'Debe empezar por https://. Se usa en el siguiente envío.' : 'Escriba una dirección completa que empiece por https://.'}</p>
      <div className="cx-acc">
        <button className="btn" disabled={!cambio || !valida} onClick={guardarCambio}>Guardar</button>
        <button className="btn sec" disabled={valor === defecto && !personalizada} onClick={restablecer}>Restablecer la original</button>
      </div>
      <p className="cx-orig">Original: <code>{defecto}</code></p>
    </section>
  )
}

export default function Conexiones({ aviso }) {
  return (
    <div className="wrapx fade">
      <h1>Conexión con n8n</h1>
      <p className="lead">Aquí se cambian las direcciones de n8n a las que la plataforma envía el trabajo. En «Crear unidades» solo se crea la estructura: un documento por unidad.</p>
      <div className="cx-lista">
        <Conexion titulo="Crear las unidades" ayuda="Recibe el syllabus, la carpeta de destino y la bibliografía leída, y crea un documento por unidad."
          defecto={WEBHOOK_POR_DEFECTO} leer={leerWebhook} guardar={guardarWebhook} aviso={aviso} />
        <Conexion titulo="Crear los guiones de una unidad" ayuda="Recibe una unidad ya creada y arma sus guiones. Solo se usa al trabajar dentro de un syllabus."
          defecto={WEBHOOK_GUIONES_POR_DEFECTO} leer={leerWebhookGuiones} guardar={guardarWebhookGuiones} aviso={aviso} />
      </div>
    </div>
  )
}
