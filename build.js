// Uso: node build.js
// Une src/base.css + src/lib.js + src/contenido/NN.json dentro de cada src/tpl-NN-*.html
// y genera los recursos finales en /recursos. Cada recurso final sigue siendo una plantilla:
// el contenido vive en <script id="contenido" type="application/json"> y se puede editar sin recompilar.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, 'src'), out = path.join(__dirname, 'recursos');
const css = fs.readFileSync(path.join(src, 'base.css'), 'utf8');
const lib = fs.readFileSync(path.join(src, 'lib.js'), 'utf8');
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(src).filter(f => /^tpl-\d\d-.*\.html$/.test(f))) {
  const n = f.slice(4, 6);
  const json = JSON.parse(fs.readFileSync(path.join(src, 'contenido', n + '.json'), 'utf8'));
  let html = fs.readFileSync(path.join(src, f), 'utf8');
  html = html.replace('/*CSS*/', () => css)
    .replace('/*LIB*/', () => lib)
    .replace('/*CONTENIDO*/', () => JSON.stringify(json, null, 2).replace(/<\//g, '<\\/'))
    .replace('{{TITULO}}', () => json.titulo);
  const name = f.replace(/^tpl-/, '');
  fs.writeFileSync(path.join(out, name), html);
  console.log('OK', name);
}
