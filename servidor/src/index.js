import { config } from './config.js'
import { crearApp } from './app.js'
import { recuperarTrabajos } from './guiones/rutas.js'

// Lo que estaba generándose cuando el servidor se detuvo ya no tiene quien espere la respuesta: se marca como fallido para poder reintentarlo.
recuperarTrabajos().catch((e) => console.error('[guiones]', e && e.message))
crearApp().listen(config.puerto, () => console.log('Servidor listo en el puerto ' + config.puerto))
