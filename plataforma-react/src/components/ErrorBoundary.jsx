import { Component } from 'react'

// Si una pantalla falla al dibujarse, en vez de dejar la página en blanco se muestra este aviso con salida.
// Lo que ya estaba guardado en el servidor no se pierde.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) { console.error('[pantalla]', error, info && info.componentStack) }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ maxWidth: 560, margin: '12vh auto', padding: '28px 26px', background: '#fff', border: '1px solid #c8d0d6', borderRadius: 18, boxShadow: '0 18px 44px rgba(19,35,91,.12)', fontFamily: 'inherit', color: '#13235b' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.4rem' }}>Algo salió mal en esta pantalla</h1>
        <p style={{ margin: '0 0 6px', lineHeight: 1.5 }}>Lo que ya estaba guardado no se perdió. Pruebe a recargar la página; si vuelve a pasar, avise a quien administra la plataforma e indique qué estaba haciendo.</p>
        <p style={{ margin: '0 0 18px', fontSize: '.85rem', opacity: 0.7, overflowWrap: 'anywhere' }}>{String((this.state.error && this.state.error.message) || this.state.error)}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>Recargar la página</button>
      </div>
    )
  }
}
