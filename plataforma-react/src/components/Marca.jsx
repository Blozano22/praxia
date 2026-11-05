// Identidad Praxia. Las formas son las de los archivos entregados (praxia-x.svg y praxia-logo-horizontal.svg),
// sin modificar; solo cambian los colores, que son los del tablero de Figma (--nav, --brand, --lime).
export const LEMA = 'Crea experiencias. Activa el aprendizaje.'

// Trazos de praxia-x.svg (viewBox 0 0 180 180): la cinta curva (antes coral) y el trazo recto (antes azul).
const CURVA = 'M24 145c15-2 31-15 48-34 17-19 33-39 45-62 11-21 20-37 34-37 14 0 20 11 17 26-3 16-19 30-36 41l-12 8c11-19 26-40 27-51 1-6-4-8-8-5-5 4-9 16-14 25-13 22-26 40-42 57-20 21-40 33-59 32z'
const RECTO = 'M35 44h28l75 92h-32z'

const FUENTE = 'Inter, Aptos, "Segoe UI", Arial, sans-serif'

// Colores por fondo. oscuro = sobre azul marino; claro = sobre fondo claro (la lima lleva borde azul marino para verse).
const paleta = (oscuro) => ({
  letras: oscuro ? '#fff' : 'var(--nav)',
  curva: 'var(--lime)',
  recto: oscuro ? 'var(--brand-luz)' : 'var(--brand)',
  borde: oscuro ? 'none' : 'var(--nav)'
})

function Trazos({ p }) {
  return (
    <>
      <path d={CURVA} fill={p.curva} stroke={p.borde} strokeWidth={p.borde === 'none' ? 0 : 4} paintOrder="stroke" strokeLinejoin="round" />
      <path d={RECTO} fill={p.recto} />
    </>
  )
}

// Símbolo solo (favicon, usos pequeños). claro=true se mantiene por compatibilidad: significa «para fondo oscuro».
export function XMark({ size = 32, claro = false, className = '', title }) {
  const p = paleta(claro)
  return (
    <svg className={'px-x ' + className} width={size * 0.95} height={size} viewBox="22 8 152 150"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <Trazos p={p} />
    </svg>
  )
}

// Logotipo horizontal. lema=true agrega la línea «Crea experiencias. Activa el aprendizaje.» (como en el archivo original).
export function Praxia({ claro = false, className = '', lema = false }) {
  const p = paleta(claro)
  return (
    <svg className={'px-logo ' + (lema ? 'con-lema ' : '') + className} viewBox={lema ? '14 24 612 206' : '14 24 468 140'}
      role="img" aria-label={lema ? 'Praxia — ' + LEMA : 'Praxia'} focusable="false">
      <g fill={p.letras} fontFamily={FUENTE} fontWeight="800">
        <text x="26" y="154" fontSize="122" letterSpacing="-7" textLength="207" lengthAdjust="spacingAndGlyphs">Pra</text>
        <text x="365" y="154" fontSize="122" letterSpacing="-7" textLength="94" lengthAdjust="spacingAndGlyphs">ia</text>
      </g>
      <g transform="translate(228 27) scale(.79)"><Trazos p={p} /></g>
      {lema && <text x="30" y="213" fill={p.letras} fontFamily={FUENTE} fontSize="29" fontWeight="500">{LEMA}</text>}
    </svg>
  )
}
