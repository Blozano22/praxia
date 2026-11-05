import { useState } from 'react'
import { api } from '../lib/api.js'
import { Praxia, XMark } from './Marca.jsx'

export default function Login({ onEntro }) {
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const enviar = async (e) => {
    e.preventDefault()
    setError('')
    setEnviando(true)
    try {
      await api('POST', '/auth/login', { correo: correo.trim(), clave })
      onEntro()
    } catch (err) {
      setError(err.estado === 429 ? 'Demasiados intentos. Espera unos minutos.' : err.estado === 400 ? 'Escribe un correo válido y tu clave.' : 'Correo o clave incorrectos.')
      setClave('')
    } finally { setEnviando(false) }
  }

  return (
    <div className="px-login fade">
      <aside className="px-lado">
        <Praxia claro lema />
        <XMark className="px-lado-x" size={520} claro />
      </aside>
      <main className="px-form">
        <form className="card login-card" onSubmit={enviar} autoComplete="on">
          <div className="px-insignia"><XMark claro size={26} title="Praxia" /></div>
          <h1>Bienvenido</h1>
          <p className="lead">Del syllabus al recurso de aprendizaje. Inicia sesión para continuar: verás únicamente los syllabus que tú creaste.</p>
          <label className="l" htmlFor="lg-correo">Correo institucional</label>
          <input id="lg-correo" type="text" inputMode="email" autoComplete="username" value={correo} onChange={(e) => setCorreo(e.target.value)} autoFocus />
          <label className="l" htmlFor="lg-clave">Clave</label>
          <input id="lg-clave" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
          {error && <div className="msg bad" role="alert" style={{ marginTop: 14 }}>{error}</div>}
          <button className="btn" type="submit" disabled={enviando || !correo || !clave} style={{ width: '100%', marginTop: 18 }}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </main>
    </div>
  )
}
