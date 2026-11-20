import './carga-recurso.css'

// Animación de «se está generando»: tres piezas que se pliegan y se vuelven a abrir (de Uiverse.io, Nawsome).
// tam: 'mini' (junto a un texto o dentro de una fila), 'medio' o 'grande' (en el centro de un panel).
export default function CargaRecurso({ tam = 'mini', etiqueta = 'Generando' }) {
  return (
    <span className={'cgr ' + tam} role="img" aria-label={etiqueta}>
      <span className="cgr-c" aria-hidden="true"><i /><i /><i /></span>
    </span>
  )
}
