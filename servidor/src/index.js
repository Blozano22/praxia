import { config } from './config.js'
import { crearApp } from './app.js'
import { recuperarTrabajos } from './guiones/rutas.js'
import { recuperarUnidades } from './unidades/rutas.js'
import { limpiarPipeline } from './pipeline/eventos.js'

// Un error no capturado no debe tumbar el servidor sin dejar rastro. Una promesa rechazada se registra y se sigue; una excepción
// no controlada deja el proceso en estado dudoso: se registra y se sale (un servicio de systemd lo vuelve a levantar).
process.on('unhandledRejection', (e) => console.error('[promesa sin capturar]', e && e.stack ? e.stack : e))
process.on('uncaughtException', (e) => { console.error('[excepción sin capturar]', e && e.stack ? e.stack : e); process.exit(1) })

// Lo que estaba generándose cuando el servidor se detuvo ya no tiene quien espere la respuesta: se marca como fallido para poder reintentarlo.
recuperarTrabajos().catch((e) => console.error('[guiones]', e && e.message))
recuperarUnidades().catch((e) => console.error('[unidades]', e && e.message))
// Los avisos viejos y la correspondencia de trabajos antiguos se borran solos (al arrancar y una vez al día).
limpiarPipeline().catch((e) => console.error('[pipeline]', e && e.message))
setInterval(() => limpiarPipeline().catch((e) => console.error('[pipeline]', e && e.message)), 24 * 3600 * 1000).unref()
crearApp().listen(config.puerto, () => console.log('Servidor listo en el puerto ' + config.puerto))
