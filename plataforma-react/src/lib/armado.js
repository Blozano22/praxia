// Armado de las plantillas HTML de los recursos. Módulo sin dependencias del navegador ni de Vite:
// lo usan render.js (dentro de la plataforma) y scripts/armar-plantillas.mjs (build de las plantillas públicas),
// así el tema, la paleta y el orden de los reemplazos son los mismos en los dos sitios.

export const FUENTE_DIEPO = "'Century Gothic','CenturyGothic','Apple Gothic','Futura','Avenir Next','Trebuchet MS','Segoe UI',system-ui,sans-serif"
export const LINK_FUENTE = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">'

// Marcas que quedan en una plantilla pública: lo único que hay que reemplazar para producir un recurso.
export const MARCA_TITULO = '{{TITULO}}'
export const MARCA_CONTENIDO = '/*CONTENIDO*/'
// Marcas que arma el build y que no pueden quedar en una plantilla pública.
export const MARCAS_INTERNAS = ['/*CSS*/', '/*LIB*/', '/*TEMA*/', '/*TEMAJS*/']

// Un solo diseño para todos los recursos: paleta DIEPO fija. Por defecto, sin personalización.
export const temaBase = () => ({
  brand: '#00665F', accent: '#CBFF01', bg: '#FFFFFF', nav: '#142749', preset: 'diepo',
  fuente: 'diepo', tam: 'n', esq: 'suave', hero: 'lisa', logo: '', bloqueo: true,
  layout: { imgLado: 'izq', orientacion: 'horizontal' }
})

const rgb = (c) => {
  c = c.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16))
}
export const mix = (a, b, t) => {
  const A = rgb(a), B = rgb(b)
  return '#' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, '0')).join('')
}

// Variables que usan todas las plantillas. Nombres históricos (--nav, --brand…) apuntan a la paleta DIEPO:
//  --nav azul noche #142749 · --brand verde azulado #00665F · --brand2 azul marino #22335D · --mid azul #1C45B4
//  --cyan cian #08A6CB (texto encima: #151B3B) · --lime lima #CBFF01 (solo detalles pequeños, texto encima: #142749)
export function cssTema() {
  const v = {
    '--nav': '#142749', '--ink': '#142749', '--brand': '#00665F', '--brand2': '#22335D', '--mid': '#1C45B4',
    '--cyan': '#08A6CB', '--cyan-ink': '#151B3B', '--cyan2': '#14A4C9', '--black': '#161616',
    '--tint': mix('#00665F', '#ffffff', 0.9), '--tint2': mix('#08A6CB', '#ffffff', 0.9),
    '--line': '#C8C8C8', '--line2': '#C8C8C8', '--bg': '#FFFFFF', '--muted': 'rgba(20,39,73,.72)',
    '--tit': '#142749', '--prop-bg': mix('#00665F', '#ffffff', 0.9), '--prop-ink': '#00665F', '--prop-tx': '#142749',
    '--lime': '#CBFF01', '--ins': '#CBFF01', '--accent': '#CBFF01', '--accent-light': '#CBFF01', '--accent-dark': '#CBFF01', '--accent-soft': mix('#00665F', '#ffffff', 0.92),
    '--radius': '14px', '--fs': '17px', '--font': FUENTE_DIEPO, '--ease': 'cubic-bezier(.22,.9,.3,1)'
  }
  return ':root{' + Object.keys(v).map((k) => k + ':' + v[k]).join(';') + '}'
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
export const safe = (s) => s.replace(/<\//g, '<\\/')

// Paso 1: incrusta los estilos y el código común en la plantilla cruda.
export const incrustar = (tpl, css, lib) => tpl.replace('/*CSS*/', () => css).replace('/*LIB*/', () => lib)

// Paso 2: tema, modo (libre o con bloqueo), fuente y encabezado. Deja intactos {{TITULO}} y /*CONTENIDO*/ si siguen en la plantilla.
export function aplicarTema(tpl, tema, libre) {
  return tpl
    .replace('/*TEMAJS*/', () => 'window.__LIBRE=' + (libre ? 'true' : 'false') + ';window.__TEMA=' + safe(JSON.stringify(tema)) + ';')
    .replace('/*TEMA*/', () => cssTema(tema))
    .replace('</head>', () => LINK_FUENTE + '</head>')
    .replace('<header class="hero">', '<header class="hero' + (tema.hero === 'lisa' ? ' lisa' : '') + '">')
}
