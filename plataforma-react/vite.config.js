import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Evita que el texto "</script" dentro de las plantillas cierre el script del archivo único.
const escapaScript = {
  name: 'escapa-script-en-raw',
  enforce: 'post',
  transform(code, id) {
    if (id.includes('?raw')) return { code: code.replace(/<\/script/gi, '<\\/script'), map: null }
  }
}

// Genera dist/index.html: un solo archivo que se abre con doble clic (sin servidor).
export default defineConfig({
  base: './',
  plugins: [react(), escapaScript, viteSingleFile()],
  // En desarrollo, /api se reenvía al servidor Node para que la cookie de sesión sea del mismo origen.
  server: { fs: { allow: ['..'] }, proxy: { '/api': { target: 'http://127.0.0.1:3002', changeOrigin: false } } },
  build: { target: 'es2020' }
})
