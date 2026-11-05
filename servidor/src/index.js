import { config } from './config.js'
import { crearApp } from './app.js'

crearApp().listen(config.puerto, () => console.log('Servidor listo en el puerto ' + config.puerto))
