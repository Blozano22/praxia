// Encabezado de pantalla con la línea gráfica de Praxia: icono en un recuadro verde claro, título y texto de apoyo.
const ICONOS = {
  inicio: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  seguimiento: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  libro: <path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4zM5 17a3 3 0 013-3h11" />,
  codigo: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  conexion: <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0V7zM12 16v5" />,
  nuevo: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path d="M14 3v5h5M12 11v6M9 14h6" /></>,
  revision: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path d="M14 3v5h5M9 14l2 2 4-4" /></>,
  curso: <><path d="M2 9l10-5 10 5-10 5L2 9z" /><path d="M6 11.5V16c0 1.2 2.7 3 6 3s6-1.8 6-3v-4.5" /></>
}

export default function Titulo({ icono = 'inicio', children, className = '' }) {
  return (
    <div className={'tit ' + className}>
      <span className="tit-ico" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONOS[icono] || ICONOS.inicio}</svg>
      </span>
      <div className="tit-tx">{children}</div>
    </div>
  )
}
