import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'
import fs from 'node:fs'
import { escribirPlantillas } from './scripts/armar-plantillas.mjs'

// Evita que el texto "</script" dentro de las plantillas cierre el script del archivo único.
const escapaScript = {
  name: 'escapa-script-en-raw',
  enforce: 'post',
  transform(code, id) {
    if (id.includes('?raw')) return { code: code.replace(/<\/script/gi, '<\\/script'), map: null }
  }
}

// Publica las plantillas de los recursos ya armadas (dist/plantillas-html/*.html y plantillas.json) para que las descargue n8n.
// Vite vacía dist/ en cada build, por eso se escriben al terminar; aparece sola cada plantilla nueva de src/plataforma/plantillas/.
const plantillasPublicas = () => {
  let salida = ''
  return {
    name: 'plantillas-publicas',
    apply: 'build',
    configResolved(c) { salida = path.resolve(c.root, c.build.outDir, 'plantillas-html') },
    closeBundle() { console.log('[plantillas-publicas] ' + escribirPlantillas(salida) + ' plantillas → ' + salida) }
  }
}

// Identificador único de este build: lo lleva la página (__VERSION_BUILD__) y se escribe en dist/version.json para que el servidor lo informe en GET /api/version.
const VERSION_BUILD = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const versionPublica = () => {
  let salida = ''
  return {
    name: 'version-publica',
    apply: 'build',
    configResolved(c) { salida = path.resolve(c.root, c.build.outDir, 'version.json') },
    closeBundle() { fs.writeFileSync(salida, JSON.stringify({ version: VERSION_BUILD, construido: new Date().toISOString() }) + '\n'); console.log('[version] ' + VERSION_BUILD) }
  }
}

// Genera dist/index.html: un solo archivo que se abre con doble clic (sin servidor).
export default defineConfig({
  base: './',
  plugins: [react(), escapaScript, viteSingleFile(), plantillasPublicas(), versionPublica()],
  define: { __VERSION_BUILD__: JSON.stringify(VERSION_BUILD) },
  // En desarrollo, /api se reenvía al servidor Node para que la cookie de sesión sea del mismo origen.
  server: { fs: { allow: ['..'] }, proxy: { '/api': { target: 'http://127.0.0.1:3002', changeOrigin: false }, '/plantillas-html': { target: 'http://127.0.0.1:3002', changeOrigin: false }, '/plantillas/ver': { target: 'http://127.0.0.1:3002', changeOrigin: false, rewrite: (r) => r.replace(/^\/plantillas\/ver/, '/plantillas-html/ver') } } },
  build: { target: 'es2020' }
})
