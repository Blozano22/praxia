// Uso: node build-plataforma.js  → genera plataforma/index.html (un solo archivo, funciona sin internet)
const fs=require('fs'),path=require('path');
const S=path.join(__dirname,'src'),P=path.join(S,'plataforma');
const css=fs.readFileSync(path.join(S,'base.css'),'utf8');
const lib=fs.readFileSync(path.join(S,'lib.js'),'utf8')+'\n'+fs.readFileSync(path.join(P,'lib-extra.js'),'utf8');
const tpls={};
for(const f of fs.readdirSync(path.join(P,'plantillas'))){
  const k=f.replace('.html','');
  tpls[k]=fs.readFileSync(path.join(P,'plantillas',f),'utf8').replace('/*CSS*/',()=>css).replace('/*LIB*/',()=>lib);
}
const BS=String.fromCharCode(92);
const safe=s=>s.replace(/<\/script/gi,'<'+BS+'/script');
let html=fs.readFileSync(path.join(P,'app.html'),'utf8')
  .replace('/*APPCSS*/',()=>fs.readFileSync(path.join(P,'app.css'),'utf8'))
  .replace('/*ENGINE*/',()=>safe(fs.readFileSync(path.join(P,'engine.js'),'utf8')))
  .replace('/*PLANTILLAS*/',()=>safe(JSON.stringify(tpls)))
  .replace('/*APPJS*/',()=>safe(fs.readFileSync(path.join(P,'app.js'),'utf8')));
fs.mkdirSync(path.join(__dirname,'plataforma'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'plataforma','index.html'),html);
console.log('OK plataforma/index.html',(html.length/1024).toFixed(0)+' KB, plantillas:',Object.keys(tpls).join(', '));
