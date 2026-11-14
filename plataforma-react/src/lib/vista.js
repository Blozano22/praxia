// Las vistas previas dibujan la plantilla a su tamaño real (1280 × 720) y la reducen al ancho disponible.
// Con transform: scale() el navegador rasteriza a tamaño completo y luego remuestrea: el texto sale borroso, sobre todo con escalas fraccionarias.
// Con zoom el contenido se vuelve a dibujar al tamaño final y queda nítido; si el navegador no lo admite, se usa transform como antes.
export const soportaZoom = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('zoom', '1')

// Estilo de reducción para un iframe cuyo tamaño ya viene fijado (por CSS o por width/height).
export const reducir = (escala) => (soportaZoom ? { zoom: escala } : { transform: `scale(${escala})` })

// Estilo completo para un iframe de plantilla a 1280 × 720.
export const marcoPlantilla = (escala) => ({ width: 1280, height: 720, ...reducir(escala) })
