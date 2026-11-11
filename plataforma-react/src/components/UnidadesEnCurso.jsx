import { useEffect, useState } from 'react'
import { descartarErrorUnidades, useUnidadesEnCurso } from '../lib/trabajosUnidades.js'
import { mensajeDeError } from '../lib/syllabus.js'

// Segundos transcurridos desde que empezó la creación (para que se vea que sigue trabajando, también al volver a entrar).
function Tiempo({ desde }) {
  const [, tic] = useState(0)
  useEffect(() => { const i = setInterval(() => tic((n) => n + 1), 1000); return () => clearInterval(i) }, [])
  const t = desde ? Math.max(0, Math.floor((Date.now() - desde) / 1000)) : 0
  return <>{Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0')}</>
}

// Aviso general: qué cursos tienen sus unidades en proceso (o fallaron). Se ve en cualquier pantalla donde se coloque,
// aunque la persona haya cerrado la página o iniciado sesión de nuevo.
export default function UnidadesEnCurso() {
  const lista = useUnidadesEnCurso()
  if (!lista.length) return null
  return (
    <div className="ud-curso-lista" role="status" aria-live="polite">
      {lista.map((t) => t.error ? (
        <div className="msg warn ud-curso" key={t.doc}>
          <div><b>No se pudieron crear las unidades{t.curso ? ' de «' + t.curso + '»' : ''}.</b> {mensajeDeError(t.error)}</div>
          <button className="btn sec sm" onClick={() => descartarErrorUnidades(t.doc)}>Entendido</button>
        </div>
      ) : (
        <div className="msg info gv-generando ud-curso" key={t.doc}>
          <span className="gv-spin" aria-hidden="true" />
          <div><b>Creando las unidades{t.curso ? ' de «' + t.curso + '»' : ''}… (<Tiempo desde={t.desde} />) </b>n8n está generando un documento por unidad. Puede salir de esta pantalla o cerrar la página: sigue en segundo plano y el curso aparecerá solo entre sus cursos.</div>
        </div>
      ))}
    </div>
  )
}
