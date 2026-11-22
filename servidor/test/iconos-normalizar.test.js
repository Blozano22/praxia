// Normalizador de SVG del banco de íconos: qué deja pasar, qué rechaza (con su motivo) y cómo deja el SVG.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarSvg, MAX_SVG } from '../src/iconos/normalizar.js'

const svg = (dentro, raiz = 'viewBox="0 0 24 24"') => '<svg ' + raiz + '>' + dentro + '</svg>'
const P = '<path d="M2 2h20v20H2z"/>'
const motivo = (s) => { const r = normalizarSvg(s, 'icono'); assert.equal(r.ok, false, 'debía rechazarse: ' + s.slice(0, 80)); return r.error }

test('un SVG válido sale limpio: xmlns, viewBox, currentColor por defecto y sin width/height', () => {
  const r = normalizarSvg('<?xml version="1.0"?><!-- hecho a mano --><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" version="1.1"><title>Cuadro</title>' + P + '</svg>', 'cuadro')
  assert.equal(r.ok, true)
  assert.equal(r.svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="currentColor"><path d="M2 2h20v20H2z"/></svg>')
  assert.equal(r.viewBox, '0 0 24 24'); assert.match(r.hash, /^[0-9a-f]{64}$/)
})

test('colores: solo currentColor, var(--ico-2) y capas blancas o negras semitransparentes', () => {
  const ok = (dentro) => assert.equal(normalizarSvg(svg(dentro), 'a').ok, true, dentro)
  ok('<path d="M0 0h5v5z" fill="currentColor"/>')
  ok('<path d="M0 0h5v5z" fill="none" stroke="currentColor" stroke-width="2"/>')
  ok('<path d="M0 0h5v5z" fill="var(--ico-2)"/>')
  ok('<path d="M0 0h5v5z" fill="#fff" fill-opacity=".4"/>')
  ok('<path d="M0 0h5v5z" fill="black" opacity=".2"/>')
  assert.match(motivo(svg('<path d="M0 0h5v5z" fill="#1a9e4b"/>')), /color fijo no permitido en fill/)
  assert.match(motivo(svg('<path d="M0 0h5v5z" stroke="green"/>')), /color fijo no permitido en stroke/)
  assert.match(motivo(svg('<path d="M0 0h5v5z" fill="rgb(1,2,3)"/>')), /color fijo no permitido/)
  assert.match(motivo(svg('<path d="M0 0h5v5z" fill="#fff"/>')), /blanco sin transparencia/)
  assert.match(motivo(svg('<path d="M0 0h5v5z" fill="#000" fill-opacity="1"/>')), /negro sin transparencia/)
})

test('degradados de currentColor: se aceptan y sus id llevan el id del ícono como prefijo (también en las referencias)', () => {
  const g = '<defs><linearGradient id="g1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity=".4"/></linearGradient></defs><path d="M0 0h5v5z" fill="url(#g1)"/>'
  const r = normalizarSvg(svg(g), 'candado')
  assert.equal(r.ok, true)
  assert.match(r.svg, /<linearGradient id="candado-g1">/); assert.match(r.svg, /fill="url\(#candado-g1\)"/)
  // el mismo dibujo con otro id de ícono tiene el mismo hash (así se detectan duplicados)
  assert.equal(normalizarSvg(svg(g), 'otro').hash, r.hash)
  assert.match(motivo(svg('<path d="M0 0h5v5z" fill="url(#no-existe)"/>')), /no existe/)
  assert.match(motivo(svg('<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>' + P)), /color fijo/)
})

test('se rechazan los elementos y atributos peligrosos, con su motivo', () => {
  assert.match(motivo(svg('<script>alert(1)</script>' + P)), /<script>/)
  assert.match(motivo(svg('<image href="x.png"/>' + P)), /<image>/)
  assert.match(motivo(svg('<use href="#a"/>' + P)), /<use>/)
  assert.match(motivo(svg('<foreignObject><div/></foreignObject>' + P)), /<foreignObject>/)
  assert.match(motivo(svg('<style>.a{fill:red}</style>' + P)), /<style>/)
  assert.match(motivo(svg('<text>hola</text>' + P)), /<text>/)
  assert.match(motivo(svg('<path d="M0 0h5v5z" onclick="x()"/>')), /evento/)
  assert.match(motivo(svg('<path d="M0 0h5v5z" class="a"/>')), /class/)
  assert.match(motivo(svg('<path d="M0 0h5v5z" style="fill:red"/>')), /style/)
  assert.match(motivo(svg('<path d="M0 0h5v5z" xlink:href="http://x"/>')), /referencia externa/)
  assert.match(motivo(svg('<path d="M0 0h5v5z" fill="url(http://x/a.svg#b)"/>')), /color fijo|no permitido/)
  assert.match(motivo('<!DOCTYPE svg [<!ENTITY a "b">]><svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>'), /declaraciones/)
  assert.match(motivo(svg('<path d="M0 0h5v5z"/><circle cx="1" cy="1" r="1" fill=currentColor/>')), /mal formado/)
})

test('forma del archivo: un solo svg con viewBox cuadrado, formas, bien cerrado y de tamaño razonable', () => {
  assert.match(motivo(''), /vacío/)
  assert.match(motivo('no es un svg'), /no es un SVG/)
  assert.match(motivo('<svg><path d="M0 0h5v5z"/></svg>'), /sin viewBox|no tiene viewBox/)
  assert.match(motivo(svg(P, 'viewBox="0 0 24 10"')), /cuadrado/)
  assert.match(motivo(svg('<g/>')), /sin formas|no tiene formas/)
  assert.match(motivo(svg('<path d="M0 0h5v5z"')), /sin cerrar|bien cerradas|formad|texto|contenido/)
  assert.match(motivo(svg(P) + svg(P)), /más de un|contenido suelto/)
  assert.match(motivo(svg('<svg viewBox="0 0 1 1"/>' + P)), /anidado/)
  assert.match(motivo(svg(P.replace('M2 2', 'M2 2 <b>'))), /no se admite|texto suelto|no están bien|caracteres que no se permiten/)
  assert.match(motivo(svg('<path d="' + 'M0 0h1'.repeat(MAX_SVG) + '"/>')), /pesa más/)
  assert.match(motivo(svg('<path d="M0 0h5v5z"/><path id="a" d="M0 0"/><path id="a" d="M1 1"/>')), /repetido/)
})

test('sin width/height ni tamaños en el raíz; el relleno del raíz se respeta si lo trae', () => {
  const r = normalizarSvg(svg('<path d="M1 1h4" stroke="currentColor"/>', 'viewBox="0 0 100 100" width="10" height="10" fill="none"'), 'a')
  assert.equal(r.ok, true)
  assert.match(r.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" fill="none">/)
  assert.doesNotMatch(r.svg, /width="10"/)
})

test('ataques: ningún valor puede cerrar una comilla ni traer otro atributo (comillas simples), ni pasar nada que no esté en la lista', () => {
  const casos = [
    ['x', `<svg viewBox="0 0 24 24"><path d="M0 0h5v5z" x='1" onmouseover="alert(1)'/></svg>`],
    ['points', `<svg viewBox="0 0 24 24"><polygon points='0,0 1,1" onmouseover="alert(1)'/></svg>`],
    ['fill-rule', `<svg viewBox="0 0 24 24"><path d="M0 0h5v5z" fill-rule='evenodd" onclick="alert(1)'/></svg>`],
    ['offset', `<svg viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset='0" onmouseover="alert(1)' stop-color="currentColor"/></linearGradient></defs>${P}</svg>`],
    ['transform', `<svg viewBox="0 0 24 24"><path d="M0 0h5v5z" transform='rotate(1)" onclick="alert(1)'/></svg>`],
    ['gradientTransform', `<svg viewBox="0 0 24 24"><defs><linearGradient id="g" gradientTransform='rotate(1)" onclick="alert(1)'><stop offset="0" stop-color="currentColor"/></linearGradient></defs>${P}</svg>`],
    ['viewBox', `<svg viewBox='0 0 24 24" onload="alert(1)'>${P}</svg>`],
    ['id', `<svg viewBox="0 0 24 24"><defs><linearGradient id='g" onclick="alert(1)'/></defs>${P}</svg>`],
    ['stroke-linecap', `<svg viewBox="0 0 24 24"><path d="M0 0h5v5z" stroke-linecap="round;fill:red"/></svg>`],
    ['stroke-dasharray', `<svg viewBox="0 0 24 24"><path d="M0 0h5v5z" stroke-dasharray="1;2"/></svg>`],
    ['gradientUnits', `<svg viewBox="0 0 24 24"><defs><linearGradient id="g" gradientUnits="otra"/></defs>${P}</svg>`]
  ]
  for (const [nombre, svg] of casos) assert.equal(normalizarSvg(svg, 'x').ok, false, 'debía rechazarse: ' + nombre)
  // lo que sale nunca trae atributos de evento, javascript:, href ni style, aunque se mezclen mayúsculas y minúsculas
  for (const bueno of [svg('<path d="M0 0h5v5z" fill="currentColor" stroke="var(--ico-2)" stroke-width="2" stroke-linecap="round"/><circle cx="1" cy="1" r="1" fill="#fff" fill-opacity=".3"/>')]) {
    const r = normalizarSvg(bueno, 'ok')
    assert.equal(r.ok, true)
    assert.doesNotMatch(r.svg, /\son\w+\s*=|javascript:|href|style=/i)
  }
})

test('rendimiento: un archivo hostil se rechaza enseguida (Praxia es un solo proceso: no puede quedarse analizando)', () => {
  const hostiles = [
    '<svg viewBox="0 0 24 24"><path ' + ' '.repeat(50000) + '</svg>',
    '<svg viewBox="0 0 24 24"><path d="' + 'x'.repeat(50000),
    '<svg viewBox="0 0 24 24">' + '<'.repeat(50000) + '</svg>',
    '<svg viewBox="0 0 24 24">' + '<title>'.repeat(6000) + '</svg>',
    '<svg viewBox="0 0 24 24">' + '<!--'.repeat(12000) + '</svg>',
    '<svg viewBox="0 0 24 24">' + '<?x'.repeat(16000) + '</svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0" ' + ' a="1"'.repeat(8000),
    '<svg viewBox="0 0 24 24">' + '<g>'.repeat(5000) + '</svg>',
    '<svg viewBox="0 0 24 24">' + '<g/>'.repeat(10000) + '</svg>',
    '<svg viewBox="0 0 24 24"><defs>' + '<linearGradient id="a"><stop offset="0" stop-color="currentColor"/>'.repeat(1500) + '</defs></svg>'
  ]
  const t0 = performance.now()
  for (const h of hostiles) assert.equal(normalizarSvg(h, 'x').ok, false)
  const ms = performance.now() - t0
  assert.ok(ms < 1500, 'los 10 archivos hostiles tardaron ' + Math.round(ms) + ' ms')
})
