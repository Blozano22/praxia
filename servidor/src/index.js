import { config } from './config.js'
import { crearApp } from './app.js'
import { recuperarTrabajos } from './guiones/rutas.js'

// Un error no capturado no debe tumbar el servidor sin dejar rastro. Una promesa rechazada se registra y se sigue; una excepción
// no controlada deja el proceso en estado dudoso: se registra y se sale (un servicio de systemd lo vuelve a levantar).
process.on('unhandledRejection', (e) => console.error('[promesa sin capturar]', e && e.stack ? e.stack : e))
process.on('uncaughtException', (e) => { console.error('[excepción sin capturar]', e && e.stack ? e.stack : e); process.exit(1) })

// Lo que estaba generándose cuando el servidor se detuvo ya no tiene quien espere la respuesta: se marca como fallido para poder reintentarlo.
recuperarTrabajos().catch((e) => console.error('[guiones]', e && e.message))
crearApp().listen(config.puerto, () => console.log('Servidor listo en el puerto ' + config.puerto))
