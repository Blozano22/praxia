(function(){
const E=OVA.engine;
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
function h(tag,attrs,...kids){
  const e=document.createElement(tag);
  for(const k in (attrs||{})){const v=attrs[k];if(v==null||v===false)continue;
    if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),v);else if(k==='class')e.className=v;else if(k==='value')e.value=v;else e.setAttribute(k,v===true?'':v)}
  kids.flat(9).forEach(c=>{if(c==null||c===false)return;e.append(c.nodeType?c:document.createTextNode(c))});
  return e;
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const uid=()=>'x'+Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-3);
const slug=s=>E.norm(s).replace(/ /g,'-').slice(0,50)||'recurso';
const clone=o=>JSON.parse(JSON.stringify(o));
const PLANTILLAS=window.__PLANTILLAS;
const NOMBRES={presentacion:'Presentación',flujo:'Diagrama de flujo',video:'Video explicativo',microvideo:'Micro-video',podcast:'Podcast',lectura:'Lectura diagramada'};
const PLANT={microvideo:'video'};

/* ---------- Almacenamiento (IndexedDB) ---------- */
const dbp=new Promise((res,rej)=>{
  try{const r=indexedDB.open('ova-plataforma',1);r.onupgradeneeded=()=>r.result.createObjectStore('proyectos',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}
});
const tx=async(mode,fn)=>{const d=await dbp;return new Promise((res,rej)=>{const t=d.transaction('proyectos',mode),s=t.objectStore('proyectos'),q=fn(s);t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error)})};
const dbAll=()=>tx('readonly',s=>s.getAll());
const dbPut=p=>tx('readwrite',s=>s.put(p));
const dbDel=id=>tx('readwrite',s=>s.delete(id));

/* ---------- Tema visual ---------- */
const PRESETS=[
  {id:'inst',n:'Verde institucional',brand:'#0f4d3a',accent:'#c9a227',bg:'#f2f5f3'},
  {id:'azul',n:'Azul marino',brand:'#1b3a6b',accent:'#d9a21b',bg:'#f1f4f9'},
  {id:'guinda',n:'Guinda',brand:'#6b1f3a',accent:'#c9a227',bg:'#f8f3f4'},
  {id:'carbon',n:'Gris carbón',brand:'#2f3a45',accent:'#d99a1e',bg:'#f3f4f6'},
  {id:'turq',n:'Turquesa',brand:'#0e6b73',accent:'#e69a2e',bg:'#f0f6f6'}
];
const FUENTES={moderna:'"Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif',clasica:'Georgia,"Times New Roman",serif',redonda:'"Trebuchet MS","Segoe UI",Verdana,sans-serif'};
const TAMS={p:'15px',n:'17px',g:'19px',xg:'21px'};
const ESQ={recta:'4px',suave:'12px',redonda:'22px'};
const temaBase=()=>({brand:PRESETS[0].brand,accent:PRESETS[0].accent,bg:PRESETS[0].bg,preset:'inst',fuente:'moderna',tam:'n',esq:'suave',hero:'trama',logo:'',bloqueo:true,layout:{imgLado:'izq',orientacion:'horizontal'}});
const hex2=c=>{c=c.replace('#','');if(c.length===3)c=c.split('').map(x=>x+x).join('');return [0,2,4].map(i=>parseInt(c.slice(i,i+2),16))};
const mix=(a,b,t)=>{const A=hex2(a),B=hex2(b);return '#'+A.map((v,i)=>Math.round(v*(1-t)+B[i]*t).toString(16).padStart(2,'0')).join('')};
function cssTema(t){
  const b=t.brand,a=t.accent;
  const v={'--brand':b,'--brand2':mix(b,'#000000',.35),'--mid':mix(b,'#ffffff',.12),'--tint':mix(b,'#ffffff',.91),'--tint2':mix(b,'#ffffff',.94),'--line':mix(b,'#ffffff',.84),'--line2':mix(b,'#ffffff',.72),
    '--accent':a,'--accent-light':mix(a,'#ffffff',.55),'--accent-dark':mix(a,'#000000',.18),'--accent-soft':mix(a,'#ffffff',.88),'--bg':t.bg,
    '--radius':ESQ[t.esq]||'12px','--fs':TAMS[t.tam]||'17px','--font':FUENTES[t.fuente]||FUENTES.moderna};
  return ':root{'+Object.keys(v).map(k=>k+':'+v[k]).join(';')+'}.hero .logo{max-width:220px;object-fit:contain}';
}
function armar(r,p){
  const d=r.datos,i=d.info||{};
  const cfg=Object.assign({},d,{id:r.id,tipo:r.tipo,tag:(NOMBRES[r.tipo]||'Recurso')+(d.codigo?' · '+d.codigo:''),
    chips:[i.asignatura,d.duracion?'Duración aprox.: '+d.duracion:'',d.clase?('Tipo: '+d.clase):''].filter(Boolean),
    pie:[i.programa,i.asignatura,d.codigo].filter(Boolean).join(' · '),actividad:r.actividadOculta?null:d.actividad});
  return cfg;
}
function construirHtml(r,p,libre){
  const tpl=PLANTILLAS[PLANT[r.tipo]||r.tipo]||PLANTILLAS.lectura;
  const tema=Object.assign(temaBase(),r.tema||{});
  const safe=s=>s.replace(/<\//g,'<\\/');
  return tpl.replace('{{TITULO}}',()=>esc(r.datos.titulo||'Recurso'))
    .replace('/*CONTENIDO*/',()=>safe(JSON.stringify(armar(r,p))))
    .replace('/*TEMAJS*/',()=>'window.__LIBRE='+(libre?'true':'false')+';window.__TEMA='+safe(JSON.stringify(tema))+';')
    .replace('/*TEMA*/',()=>cssTema(tema)).replace('<header class="hero">','<header class="hero'+(tema.hero==='lisa'?' lisa':'')+'">');
}
function descargar(r,p){
  const blob=new Blob([construirHtml(r,p,false)],{type:'text/html;charset=utf-8'});
  const a=h('a',{href:URL.createObjectURL(blob),download:(r.datos.codigo||'recurso')+'-'+slug(r.datos.titulo)+'.html'});
  document.body.append(a);a.click();a.remove();
}

/* ---------- Estado y vistas ---------- */
const S={vista:'inicio',proyectos:[],proyecto:null,pend:null,rec:null,tab:'contenido',cel:false,libre:true};
const root=$('#app'),topEl=$('#top');
function toast(t,kind){const el=h('div',{class:'toast',style:'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#0a3328;color:#fff;border-left:5px solid #c9a227;border-radius:8px;padding:10px 18px;z-index:99;box-shadow:0 6px 20px rgba(0,0,0,.3);font-weight:600'},t);document.body.append(el);setTimeout(()=>el.remove(),2600)}
function renderTop(){
  topEl.replaceChildren(h('div',{class:'brand',onclick:()=>ir('inicio')},'Plataforma de recursos educativos',h('small',{},'Del guion al recurso, sin inventar nada')),h('div',{class:'sp'}),
    S.proyecto?h('button',{class:'btn sec sm',onclick:()=>ir('galeria')},'Mis recursos: '+S.proyecto.nombre.slice(0,28)):null,
    h('button',{class:'btn sec sm',onclick:()=>ir('inicio')},'Inicio'));
}
function ir(v,extra){
  S.vista=v;Object.assign(S,extra||{});renderTop();
  const f={inicio:vInicio,revision:vRevision,galeria:vGaleria,editor:vEditor}[v];
  root.replaceChildren();root.className='';const r=f();if(r)root.append(r);
  if(v!=='editor')window.scrollTo(0,0);
}

/* --- Inicio --- */
function vInicio(){
  const msg=h('div');
  const area=h('textarea',{placeholder:'Pegue aquí el texto del guion…',style:'min-height:140px;display:none;margin-top:10px'});
  const fi=h('input',{type:'file',accept:'.docx,.txt,.md',style:'display:none',onchange:e=>{const f=e.target.files[0];if(f)cargar(f)}});
  const drop=h('div',{class:'drop',ondragover:e=>{e.preventDefault();drop.classList.add('over')},ondragleave:()=>drop.classList.remove('over'),ondrop:e=>{e.preventDefault();drop.classList.remove('over');const f=e.dataTransfer.files[0];if(f)cargar(f)}},
    h('h2',{},'Cargue su guion'),
    h('p',{},'Arrastre aquí el archivo del guion (Word .docx, .txt o .md) o búsquelo en su computador.'),
    h('div',{class:'row center',style:'margin-top:10px'},h('button',{class:'btn',onclick:()=>fi.click()},'Seleccionar archivo'),h('button',{class:'btn sec',onclick:()=>{area.style.display=area.style.display==='none'?'block':'none';btnP.style.display=area.style.display}},'Pegar texto del guion')),
    fi);
  const btnP=h('button',{class:'btn',style:'display:none;margin-top:8px',onclick:()=>analizarTexto(area.value,'Texto pegado')},'Leer este texto');
  async function cargar(f){
    msg.replaceChildren(h('div',{class:'msg info'},'Leyendo «'+f.name+'»…'));
    try{
      let blocks;
      if(/\.docx$/i.test(f.name))blocks=await E.leerDocx(await f.arrayBuffer());
      else if(/\.(txt|md)$/i.test(f.name))blocks=E.textoBlocks(await f.text());
      else throw new Error('Por ahora la plataforma lee guiones en Word (.docx), .txt o .md. Si su guion está en otro formato, guárdelo como .docx desde Word.');
      terminar(blocks,f.name);
    }catch(e){msg.replaceChildren(h('div',{class:'msg bad'},e.message||String(e)))}
  }
  function analizarTexto(t,n){if(!t.trim()){msg.replaceChildren(h('div',{class:'msg bad'},'Pegue primero el texto del guion.'));return}terminar(E.textoBlocks(t),n)}
  function terminar(blocks,nombre){
    const an=E.analizar(blocks);
    if(!an.recursos.length){
      msg.replaceChildren(h('div',{class:'msg bad'},h('b',{},'No encontramos recursos en este guion. '),'La plataforma busca una línea con el código del recurso y su nombre, por ejemplo «U2-T1-OVA1 Videos explicativos con audio», seguida de su contenido (escenas, nodos, bloques o secciones). Revise que el guion tenga ese formato.'));
      return;
    }
    S.pend={nombre,info:an.info,recursos:an.recursos};ir('revision');
  }
  const lista=h('div');
  dbAll().then(ps=>{
    S.proyectos=ps.sort((a,b)=>b.creado-a.creado);
    if(!ps.length)return;
    lista.append(h('h2',{},'Sus proyectos'),h('div',{class:'grid'},ps.map(p=>h('div',{class:'card'},h('h3',{style:'margin:0 0 4px'},p.nombre),h('p',{class:'help'},p.recursos.length+' recursos · '+new Date(p.creado).toLocaleDateString()),
      h('div',{class:'row',style:'margin-top:8px'},h('button',{class:'btn sm',onclick:()=>ir('galeria',{proyecto:p})},'Abrir'),h('button',{class:'btn danger sm',onclick:async()=>{if(confirm('¿Eliminar el proyecto «'+p.nombre+'» y todos sus recursos?')){await dbDel(p.id);ir('inicio')}}},'Eliminar'))))));
  }).catch(()=>lista.append(h('div',{class:'msg warn'},'Este navegador no permite guardar proyectos. Puede usar la plataforma, pero lo que cree no se guardará al cerrar.')));
  return h('div',{class:'wrapx fade'},
    h('h1',{},'Convierta su guion en recursos educativos'),
    h('p',{class:'lead'},'Suba el guion y la plataforma arma cada recurso con el texto que ya está escrito en él. No agrega contenido propio: lo que el guion no diga, no aparece. Después puede cambiar textos, colores y orden con un editor sencillo.'),
    h('div',{class:'pasos'},[['1','Cargue el guion','Archivo Word o texto pegado.'],['2','Revise lo encontrado','Verá qué recursos se detectaron y qué falta.'],['3','Edite y descargue','Cambie lo que quiera y descargue cada recurso.']].map(x=>h('div',{class:'p'},h('b',{},x[0]),h('div',{},h('b',{style:'background:none;color:inherit;display:block;width:auto;height:auto;justify-content:flex-start'},x[1]),h('span',{class:'help'},x[2]))))),
    drop,area,btnP,msg,lista);
}

/* --- Revisión del guion --- */
function vRevision(){
  const P=S.pend;const sel=P.recursos.map(()=>true);
  const info=P.info;
  const kv=Object.keys(info).filter(k=>k!=='titulo_guion').map(k=>[k.replace(/_/g,' '),info[k]]);
  const cards=P.recursos.map((r,i)=>{
    const meta=()=>{const d=E.datosDe(r,info);return d};
    const sum=()=>{
      const d=meta();
      const n=d.diapositivas||d.nodos||d.escenas||d.bloques||d.secciones||[];
      return n.length+' '+({presentacion:'diapositivas',flujo:'nodos',video:'escenas',microvideo:'escenas',podcast:'bloques',lectura:'secciones'}[r.tipo])+(r.actividad?' · con actividad':'');
    };
    const cnt=h('span',{class:'pill'},sum());
    const sel2=h('select',{style:'width:auto;display:inline-block',onchange:e=>{r.tipo=e.target.value;cnt.textContent=sum()}},Object.keys(NOMBRES).map(k=>h('option',{value:k,selected:k===r.tipo},NOMBRES[k])));
    return h('div',{class:'card rv'},
      h('input',{type:'checkbox',checked:true,'aria-label':'Crear este recurso',onchange:e=>{sel[i]=e.target.checked;btn.disabled=!sel.some(Boolean);btn.textContent='Crear '+sel.filter(Boolean).length+' recursos'}}),
      h('div',{},h('div',{class:'row'},h('span',{class:'tipo'},r.codigo),h('span',{class:'pill'},r.clase||'—'),cnt),
        h('h3',{style:'margin-top:6px'},r.titulo||r.nombre),h('p',{class:'help',style:'margin:2px 0'},r.nombre),
        h('div',{class:'row',style:'margin:6px 0'},h('span',{class:'help'},'Se armará como:'),sel2),
        ...r.avisos.map(a=>h('div',{class:'msg warn',style:'margin:6px 0;padding:8px 12px'},a)),
        r.sinUbicar.length?h('details',{class:'dt'},h('summary',{},'Texto del guion que no se pudo ubicar ('+r.sinUbicar.length+')'),r.sinUbicar.map(t=>h('p',{class:'help'},t))):null,
        r.avisos.length===0&&!r.sinUbicar.length?h('span',{class:'pill ok'},'Todo el texto de este recurso fue ubicado'):null));
  });
  const btn=h('button',{class:'btn gold',onclick:crear},'Crear '+P.recursos.length+' recursos');
  async function crear(){
    const resto=(info.titulo_guion||'').split(/[–—-]/).pop().trim()||P.nombre.replace(/\.[a-z0-9]+$/i,'').replace(/_+/g,' ').trim();
    const proyecto={id:uid(),nombre:((info.nombre_de_la_asignatura?info.nombre_de_la_asignatura+' · ':'')+resto).slice(0,70),creado:Date.now(),info,
      recursos:P.recursos.filter((_,i)=>sel[i]).map(r=>({id:uid(),tipo:r.tipo,codigo:r.codigo,clase:r.clase,nombre:r.nombre,datos:E.datosDe(r,info),tema:temaBase(),avisos:r.avisos,sinUbicar:r.sinUbicar,tecnica:r.tecnica.texto,actividadOculta:false}))};
    try{await dbPut(proyecto)}catch(e){toast('No se pudo guardar en este navegador')}
    ir('galeria',{proyecto,pend:null});toast('Recursos creados');
  }
  return h('div',{class:'wrapx fade'},h('h1',{},'Esto fue lo que encontramos en el guion'),
    h('div',{class:'msg info'},'La plataforma solo usa texto que está en el guion. Revise cada recurso: si algo no se pudo ubicar, aparece aquí abajo y podrá agregarlo a mano en el editor.'),
    h('div',{class:'card'},h('h3',{style:'margin-top:0'},'Información general del guion'),kv.length?h('div',{class:'kv'},kv.map(x=>[h('b',{},x[0]),h('span',{},x[1])])):h('p',{class:'help'},'El guion no trae una tabla de información general.')),
    h('h2',{},P.recursos.length+' recursos detectados'),h('div',{class:'rev'},cards),
    h('div',{class:'row',style:'margin-top:18px'},btn,h('button',{class:'btn sec',onclick:()=>ir('inicio')},'Cancelar')));
}

/* --- Galería de recursos (tarjetas) --- */
function vGaleria(){
  const p=S.proyecto;
  const cards=p.recursos.map(r=>{
    const fr=h('iframe',{sandbox:'allow-scripts',tabindex:'-1','aria-hidden':'true',srcdoc:construirHtml(r,p,true),title:'Vista previa'});
    const pv=h('div',{class:'pvw',onclick:()=>ir('editor',{rec:r,tab:'contenido'})},fr,h('div',{class:'ov'}));
    const fit=()=>{const w=pv.clientWidth;if(!w)return;fr.style.transform='scale('+(w/1100)+')';pv.style.height=Math.round(w*680/1100)+'px'};
    if(window.ResizeObserver)new ResizeObserver(fit).observe(pv);
    setTimeout(fit,0);
    return h('div',{class:'card rc fade'},pv,h('div',{class:'bd'},
      h('div',{class:'row'},h('span',{class:'tipo'},NOMBRES[r.tipo]),h('span',{class:'pill'},r.datos.clase||'')),
      h('h3',{},r.datos.titulo||r.nombre),h('p',{class:'help',style:'margin:0'},r.datos.codigo+' · '+r.nombre),
      r.avisos.length||r.sinUbicar.length?h('span',{class:'pill warn'},'Hay avisos del guion'):h('span',{class:'pill ok'},'Completo según el guion'),
      h('div',{class:'acts'},h('button',{class:'btn sm',onclick:()=>ir('editor',{rec:r,tab:'contenido'})},'Abrir y editar'),
        h('button',{class:'btn sec sm',onclick:()=>{descargar(r,p);toast('Descargando…')}},'Descargar'),
        h('button',{class:'btn sec sm',onclick:async()=>{const c=clone(r);c.id=uid();c.datos.titulo+=' (copia)';p.recursos.splice(p.recursos.indexOf(r)+1,0,c);await dbPut(p);ir('galeria')}},'Duplicar'),
        h('button',{class:'btn danger sm',onclick:async()=>{if(confirm('¿Eliminar este recurso?')){p.recursos.splice(p.recursos.indexOf(r),1);await dbPut(p);ir('galeria')}}},'Eliminar'))));
  });
  const nombre=h('input',{type:'text',value:p.nombre,'aria-label':'Nombre del proyecto',style:'font-size:1.4rem;font-weight:700;border-color:transparent;background:transparent;padding:2px 6px',onchange:async e=>{p.nombre=e.target.value||p.nombre;await dbPut(p);renderTop()}});
  return h('div',{class:'wrapx fade'},
    h('div',{class:'pj'},h('div',{style:'flex:1;min-width:260px'},nombre,h('p',{class:'help',style:'margin-left:6px'},p.recursos.length+' recursos creados desde el guion. Toque una tarjeta para verla y editarla.')),
      h('div',{class:'row'},h('button',{class:'btn',onclick:()=>{p.recursos.forEach((r,i)=>setTimeout(()=>descargar(r,p),i*400));toast('Descargando todos…')}},'Descargar todos'),h('button',{class:'btn sec',onclick:()=>ir('inicio')},'Cargar otro guion'))),
    p.info&&p.info.resultado_de_aprendizaje?h('div',{class:'msg info'},h('b',{},'Resultado de aprendizaje (del guion): '),p.info.resultado_de_aprendizaje):null,
    h('div',{class:'grid',style:'margin-top:14px'},cards));
}

/* --- Editor --- */
let hist=[],hi=-1,saveT=null,prevT=null,ifr=null,statEl=null;
const snap=()=>JSON.stringify({d:S.rec.datos,t:S.rec.tema,o:S.rec.actividadOculta});
function pushHist(){const s=snap();if(hist[hi]===s)return;hist=hist.slice(0,hi+1);hist.push(s);if(hist.length>60)hist.shift();hi=hist.length-1}
function cambio(estructura){
  clearTimeout(prevT);
  prevT=setTimeout(()=>{preview();pushHist()},320);
  if(statEl)statEl.textContent='Guardando…';
  clearTimeout(saveT);saveT=setTimeout(async()=>{try{await dbPut(S.proyecto)}catch(e){}if(statEl)statEl.textContent='Guardado automáticamente ✔'},700);
  if(estructura)renderPanel();
}
function preview(){
  if(!ifr)return;
  let y=0;try{y=ifr.contentWindow.scrollY}catch(e){}
  ifr.onload=()=>{try{ifr.contentWindow.scrollTo(0,y)}catch(e){}};
  ifr.srcdoc=construirHtml(S.rec,S.proyecto,S.libre);
}
let panelEl,wrapEl;
function vEditor(){
  const r=S.rec;r.tema=Object.assign(temaBase(),r.tema||{});r.tema.layout=Object.assign({imgLado:'izq',orientacion:'horizontal'},r.tema.layout||{});
  hist=[];hi=-1;pushHist();
  const tabs=[['contenido','Contenido'],['diseno','Colores y letra'],['orden','Orden y opciones'],['ayuda','Ayuda']];
  const tbar=h('div',{class:'tabs',role:'tablist'},tabs.map(t=>h('button',{role:'tab','data-t':t[0],class:S.tab===t[0]?'on':'',onclick:()=>{S.tab=t[0];$$('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t[0]));renderPanel()}},t[1])));
  panelEl=h('div',{class:'pn'});
  statEl=h('span',{class:'stat'},'Guardado automáticamente ✔');
  const undo=h('button',{class:'btn sec sm',title:'Deshacer el último cambio',onclick:()=>mover(-1)},'↶ Deshacer'),redo=h('button',{class:'btn sec sm',title:'Rehacer',onclick:()=>mover(1)},'↷ Rehacer');
  function mover(d){const n=hi+d;if(n<0||n>=hist.length)return;hi=n;const s=JSON.parse(hist[hi]);r.datos=s.d;r.tema=s.t;r.actividadOculta=s.o;renderPanel();preview();dbPut(S.proyecto)}
  const vistaBtns=h('div',{class:'seg',style:'margin:0'},
    h('button',{class:S.libre?'on':'',title:'Muestra todo el recurso sin bloqueos para que pueda revisarlo y editarlo',onclick:e=>{S.libre=true;seg(e)}},'Ver todo'),
    h('button',{class:S.libre?'':'on',title:'Muestra el recurso como lo verá el estudiante, con los bloqueos',onclick:e=>{S.libre=false;seg(e)}},'Como estudiante'));
  const devBtns=h('div',{class:'seg',style:'margin:0'},
    h('button',{class:S.cel?'':'on',onclick:e=>{S.cel=false;wrapEl.classList.remove('cel');seg(e)}},'Computador'),
    h('button',{class:S.cel?'on':'',onclick:e=>{S.cel=true;wrapEl.classList.add('cel');seg(e)}},'Celular'));
  function seg(e){$$('button',e.target.parentNode).forEach(b=>b.classList.toggle('on',b===e.target));preview()}
  ifr=h('iframe',{title:'Vista previa del recurso'});
  wrapEl=h('div',{class:'pvWrap'+(S.cel?' cel':'')},ifr);
  const L=h('div',{class:'edL'},
    h('div',{class:'edBar'},h('button',{class:'btn sec sm',onclick:()=>{ifr=null;ir('galeria')}},'← Mis recursos'),h('b',{style:'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'},NOMBRES[r.tipo]+' · '+(r.datos.codigo||'')),undo,redo),
    tbar,panelEl);
  const R=h('div',{class:'edR'},h('div',{class:'edBar'},h('span',{class:'stat'},'Vista:'),vistaBtns,h('span',{class:'stat'},'Ver en:'),devBtns,h('span',{class:'sp'}),statEl,h('button',{class:'btn gold sm',onclick:()=>{descargar(r,S.proyecto);toast('Descargando…')}},'Descargar recurso')),wrapEl);
  renderPanel();preview();
  return h('div',{class:'ed'},L,R);
}
function renderPanel(){
  const sc=panelEl.scrollTop;
  panelEl.replaceChildren(S.tab==='contenido'?pContenido():S.tab==='diseno'?pDiseno():S.tab==='orden'?pOrden():pAyuda());
  panelEl.scrollTop=sc;
}
/* constructores de campos */
function fTexto(label,obj,key,o){
  o=o||{};
  const el=o.long?h('textarea',{rows:o.rows||4,placeholder:o.ph||''}):h('input',{type:'text',placeholder:o.ph||''});
  el.value=obj[key]||'';
  el.oninput=()=>{obj[key]=el.value;cambio();if(o.long)cnt.textContent=E.words(el.value)+' palabras'};
  const cnt=h('span',{class:'help'},o.long?E.words(el.value)+' palabras':'');
  if(o.long)autoh(el);
  return h('div',{},h('label',{class:'l'},label),el,o.help?h('p',{class:'help'},o.help):null,o.long?cnt:null);
}
function autoh(t){const f=()=>{t.style.height='auto';t.style.height=Math.min(420,t.scrollHeight+4)+'px'};t.addEventListener('input',f);setTimeout(f,0)}
function fLista(label,obj,key,o){
  o=o||{};obj[key]=obj[key]||[];
  const box=h('div');
  const draw=()=>{
    box.replaceChildren(...obj[key].map((v,i)=>{
      const t=h('textarea',{rows:2,style:'min-height:44px'});t.value=v;t.oninput=()=>{obj[key][i]=t.value;cambio()};autoh(t);
      return h('div',{class:'listrow'},h('span',{class:'help',style:'width:18px'},(i+1)+'.'),t,
        h('button',{class:'ic',title:'Subir',onclick:()=>{if(i>0){[obj[key][i-1],obj[key][i]]=[obj[key][i],obj[key][i-1]];draw();cambio()}}},'▲'),
        h('button',{class:'ic',title:'Bajar',onclick:()=>{if(i<obj[key].length-1){[obj[key][i+1],obj[key][i]]=[obj[key][i],obj[key][i+1]];draw();cambio()}}},'▼'),
        h('button',{class:'ic d',title:'Quitar',onclick:()=>{obj[key].splice(i,1);draw();cambio()}},'✕'));
    }),h('button',{class:'btn sec sm',onclick:()=>{obj[key].push('');draw();cambio()}},'＋ '+(o.add||'Agregar')));
  };
  draw();
  return h('div',{},h('label',{class:'l'},label),o.help?h('p',{class:'help'},o.help):null,box);
}
function leerImg(file,max,cb){
  const fr=new FileReader();
  fr.onload=()=>{const im=new Image();im.onload=()=>{
    const k=Math.min(1,max/Math.max(im.width,im.height));const c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);
    const x=c.getContext('2d');if(!/png/i.test(file.type)){x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height)}x.drawImage(im,0,0,c.width,c.height);
    cb(c.toDataURL(/png/i.test(file.type)?'image/png':'image/jpeg',.82));
  };im.src=fr.result};fr.readAsDataURL(file);
}
function fImagen(label,obj,key,max){
  const fi=h('input',{type:'file',accept:'image/*',style:'display:none',onchange:e=>{const f=e.target.files[0];if(f)leerImg(f,max||1000,u=>{obj[key]=u;cambio(true)})}});
  return h('div',{class:'imgp'},obj[key]?h('img',{src:obj[key],alt:''}):null,h('button',{class:'btn sec sm',onclick:()=>fi.click()},obj[key]?'Cambiar imagen':label),obj[key]?h('button',{class:'btn danger sm',onclick:()=>{obj[key]='';cambio(true)}},'Quitar'):null,fi);
}
const EDIT={
  presentacion:{arr:'diapositivas',item:'Diapositiva',nuevo:()=>({titulo:'Nueva diapositiva',texto:'',img:''}),campos:[['titulo','Título de la diapositiva'],['texto','Texto de la diapositiva',1]],img:'Agregar imagen a esta diapositiva',tit:'titulo'},
  flujo:{arr:'nodos',item:'Nodo',nuevo:()=>({nombre:'Nuevo nodo',descripcion:'',conexion:'',img:''}),campos:[['nombre','Nombre del nodo'],['descripcion','Descripción del nodo',1],['conexion','Cómo se conecta con el siguiente nodo',1]],img:'Agregar imagen a este nodo',tit:'nombre'},
  video:{arr:'escenas',item:'Escena',nuevo:()=>({titulo:'Nueva escena',visual:'',narracion:'',img:''}),campos:[['titulo','Nombre de la escena'],['visual','Qué se ve en pantalla (descripción visual)',1],['narracion','Texto que se narra (aparece como subtítulo)',1]],img:'Agregar imagen de fondo a esta escena',tit:'titulo'},
  podcast:{arr:'bloques',item:'Bloque',nuevo:()=>({etiqueta:'Nuevo bloque',texto:''}),campos:[['etiqueta','Nombre del bloque'],['texto','Texto del locutor',1]],tit:'etiqueta'},
  lectura:{arr:'secciones',item:'Sección',nuevo:()=>({titulo:'Nueva sección',texto:'',estilo:'normal',img:''}),campos:[['titulo','Título de la sección'],['texto','Texto de la sección',1],['estilo','Tipo de sección','sel',[['normal','Normal'],['ejemplo','Ejemplo destacado'],['sintesis','Síntesis']]]],img:'Agregar imagen a esta sección',tit:'titulo'}
};
EDIT.microvideo=EDIT.video;
const abiertos={};
function fArray(r){
  const cfg=EDIT[r.tipo]||EDIT.lectura,arr=r.datos[cfg.arr]=r.datos[cfg.arr]||[];
  const box=h('div');
  arr.forEach((it,i)=>{
    const key=r.id+cfg.arr+i;
    const body=h('div',{class:'ib'},cfg.campos.map(c=>{
      if(c[2]==='sel'){const s=h('select',{onchange:e=>{it[c[0]]=e.target.value;cambio()}},c[3].map(o=>h('option',{value:o[0],selected:(it[c[0]]||'normal')===o[0]},o[1])));return h('div',{},h('label',{class:'l'},c[1]),s)}
      return fTexto(c[1],it,c[0],{long:c[2]===1,rows:c[2]===1?4:1});
    }),cfg.img?fImagen(cfg.img,it,'img'):null);
    const item=h('div',{class:'item'+(abiertos[key]===false?' closed':'')},
      h('div',{class:'ih',onclick:e=>{if(e.target.closest('.ic'))return;item.classList.toggle('closed');abiertos[key]=!item.classList.contains('closed')}},
        h('b',{},cfg.item+' '+(i+1)+(it[cfg.tit]?' · '+it[cfg.tit]:'')),
        h('button',{class:'ic',title:'Subir',onclick:()=>{if(i>0){[arr[i-1],arr[i]]=[arr[i],arr[i-1]];cambio(true)}}},'▲'),
        h('button',{class:'ic',title:'Bajar',onclick:()=>{if(i<arr.length-1){[arr[i+1],arr[i]]=[arr[i],arr[i+1]];cambio(true)}}},'▼'),
        h('button',{class:'ic',title:'Duplicar',onclick:()=>{arr.splice(i+1,0,clone(it));cambio(true)}},'⧉'),
        h('button',{class:'ic d',title:'Eliminar',onclick:()=>{if(confirm('¿Eliminar '+cfg.item.toLowerCase()+' '+(i+1)+'?')){arr.splice(i,1);cambio(true)}}},'✕')),body);
    box.append(item);
  });
  box.append(h('button',{class:'btn sm',onclick:()=>{arr.push(cfg.nuevo());cambio(true)}},'＋ Agregar '+cfg.item.toLowerCase()));
  return box;
}
function pContenido(){
  const r=S.rec,d=r.datos;d.info=d.info||{};
  const out=h('div');
  out.append(h('div',{class:'tour'},'Cambie cualquier texto: el resultado se ve a la derecha al instante y se guarda solo. Use ▲ ▼ para mover, ⧉ para duplicar y ✕ para eliminar.'),
    fTexto('Título del recurso',d,'titulo'),
    fTexto('Resultado de aprendizaje (aparece al inicio del recurso)',d.info,'resultado',{long:true,rows:3,help:'Viene de la tabla de información del guion.'}));
  const cfg=EDIT[r.tipo]||EDIT.lectura;
  out.append(h('h2',{style:'font-size:1.05rem;margin:18px 0 4px'},({diapositivas:'Diapositivas',nodos:'Nodos del diagrama',escenas:'Escenas',bloques:'Bloques del podcast',secciones:'Secciones de la lectura'})[cfg.arr]),fArray(r));
  out.append(h('h2',{style:'font-size:1.05rem;margin:22px 0 4px'},'Actividad de autoaprendizaje'));
  if(d.actividad&&!r.actividadOculta){
    const a=d.actividad;
    out.append(fTexto('Enunciado de la actividad',a,'enunciado',{long:true,rows:3}),fTexto('Materiales',a,'materiales',{long:true,rows:2}),fLista('Pasos',a,'pasos',{add:'Agregar paso'}),fTexto('Evidencia que se debe entregar',a,'evidencia',{long:true,rows:2}),fLista('Criterios de evaluación',a,'criterios',{add:'Agregar criterio'}),
      h('button',{class:'btn danger sm',style:'margin-top:12px',onclick:()=>{if(confirm('¿Quitar la actividad de este recurso?')){r.actividadOculta=true;cambio(true)}}},'Quitar la actividad'));
  }else{
    out.append(h('p',{class:'help'},d.actividad?'La actividad está oculta en este recurso.':'El guion no trae una actividad para este recurso.'),
      h('button',{class:'btn sec sm',onclick:()=>{if(!d.actividad)d.actividad={enunciado:'',materiales:'',pasos:[],evidencia:'',criterios:[]};r.actividadOculta=false;cambio(true)}},d.actividad?'Mostrar la actividad':'＋ Agregar una actividad'));
  }
  if(r.avisos.length||r.sinUbicar.length||r.tecnica){
    out.append(h('details',{class:'item',style:'padding:10px 12px;margin-top:22px'},h('summary',{style:'cursor:pointer;font-weight:600'},'Notas del guion para este recurso'),
      ...r.avisos.map(a=>h('div',{class:'msg warn',style:'padding:8px 12px'},a)),
      r.sinUbicar.length?h('div',{},h('p',{class:'help'},'Texto que no se pudo ubicar (puede copiarlo a donde corresponda):'),r.sinUbicar.map(t=>h('p',{style:'font-size:.9rem'},t))):null,
      r.tecnica?h('div',{},h('p',{class:'help'},'Indicaciones técnicas del guion (no se muestran a los estudiantes):'),h('p',{style:'font-size:.9rem'},r.tecnica)):null));
  }
  return out;
}
function pDiseno(){
  const r=S.rec,t=r.tema;const out=h('div');
  out.append(h('div',{class:'tour'},'Elija una combinación de colores o personalice cada color. Los cambios se ven al instante.'),
    h('label',{class:'l'},'Combinaciones de colores'),
    h('div',{class:'sw'},PRESETS.map(p=>h('button',{class:t.preset===p.id?'on':'',onclick:()=>{Object.assign(t,{brand:p.brand,accent:p.accent,bg:p.bg,preset:p.id});cambio(true)}},h('i',{style:'background:linear-gradient(90deg,'+p.brand+' 70%,'+p.accent+' 70%)'}),p.n))),
    h('label',{class:'l'},'O elija sus propios colores'),
    h('div',{class:'colors'},[['brand','Principal'],['accent','Detalles'],['bg','Fondo']].map(c=>h('div',{},h('span',{class:'help'},c[1]),h('input',{type:'color',value:t[c[0]],oninput:e=>{t[c[0]]=e.target.value;t.preset='';cambio()},onchange:()=>renderPanel()})))),
    h('label',{class:'l'},'Tipo de letra'),
    h('div',{class:'seg'},[['moderna','Moderna'],['clasica','Clásica'],['redonda','Redonda']].map(f=>h('button',{class:t.fuente===f[0]?'on':'',style:'font-family:'+FUENTES[f[0]],onclick:()=>{t.fuente=f[0];cambio(true)}},f[1]))),
    h('label',{class:'l'},'Tamaño de la letra'),
    h('div',{class:'seg'},[['p','Pequeña'],['n','Normal'],['g','Grande'],['xg','Muy grande']].map(f=>h('button',{class:t.tam===f[0]?'on':'',onclick:()=>{t.tam=f[0];cambio(true)}},f[1]))),
    h('label',{class:'l'},'Esquinas de las tarjetas y botones'),
    h('div',{class:'seg'},[['recta','Rectas'],['suave','Suaves'],['redonda','Redondeadas']].map(f=>h('button',{class:t.esq===f[0]?'on':'',onclick:()=>{t.esq=f[0];cambio(true)}},f[1]))),
    h('label',{class:'l'},'Cabecera'),
    h('div',{class:'seg'},[['trama','Con trama sutil'],['lisa','Lisa']].map(f=>h('button',{class:t.hero===f[0]?'on':'',onclick:()=>{t.hero=f[0];cambio(true)}},f[1]))),
    h('label',{class:'l'},'Logo o escudo de la institución'),
    h('p',{class:'help'},'Aparece en la cabecera del recurso.'),fImagen('Subir logo',t,'logo',320),
    h('div',{style:'margin-top:20px'},h('button',{class:'btn sec sm',onclick:()=>{r.tema=temaBase();cambio(true)}},'Restablecer diseño original')));
  return out;
}
function pOrden(){
  const r=S.rec,t=r.tema,d=r.datos,out=h('div');
  const cfg=EDIT[r.tipo]||EDIT.lectura,arr=d[cfg.arr]||[];
  out.append(h('div',{class:'tour'},'Aquí cambia el orden de los elementos y cómo se comporta el recurso.'),
    h('label',{class:'l'},'Orden de '+({diapositivas:'las diapositivas',nodos:'los nodos',escenas:'las escenas',bloques:'los bloques',secciones:'las secciones'})[cfg.arr]),
    h('p',{class:'help'},'Use las flechas para subir o bajar. El resultado se ve a la derecha.'),
    h('div',{},arr.map((it,i)=>h('div',{class:'listrow',style:'border:1.5px solid var(--line);border-radius:8px;padding:6px 8px;background:#fff'},h('span',{class:'pill'},i+1),h('span',{style:'flex:1;font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'},it[cfg.tit]||cfg.item),
      h('button',{class:'ic',title:'Subir',onclick:()=>{if(i>0){[arr[i-1],arr[i]]=[arr[i],arr[i-1]];cambio(true)}}},'▲'),h('button',{class:'ic',title:'Bajar',onclick:()=>{if(i<arr.length-1){[arr[i+1],arr[i]]=[arr[i],arr[i+1]];cambio(true)}}},'▼')))),
    h('label',{class:'l',style:'margin-top:22px'},'Comportamiento'),
    h('label',{class:'tg'},h('input',{type:'checkbox',checked:t.bloqueo!==false,onchange:e=>{t.bloqueo=e.target.checked;cambio()}}),h('div',{},h('b',{},'Obligar a avanzar en orden'),h('span',{},'El estudiante debe leer o explorar cada parte para desbloquear la siguiente.'))));
  if(r.tipo==='presentacion')out.append(h('label',{class:'l'},'Posición de la imagen en cada diapositiva'),h('div',{class:'seg'},[['izq','A la izquierda'],['der','A la derecha']].map(f=>h('button',{class:t.layout.imgLado===f[0]?'on':'',onclick:()=>{t.layout.imgLado=f[0];cambio(true)}},f[1]))));
  if(r.tipo==='flujo')out.append(h('label',{class:'l'},'Dirección del diagrama'),h('div',{class:'seg'},[['horizontal','Horizontal (de izquierda a derecha)'],['vertical','Vertical (de arriba hacia abajo)']].map(f=>h('button',{class:t.layout.orientacion===f[0]?'on':'',onclick:()=>{t.layout.orientacion=f[0];cambio(true)}},f[1]))));
  if(d.actividad)out.append(h('label',{class:'tg'},h('input',{type:'checkbox',checked:!r.actividadOculta,onchange:e=>{r.actividadOculta=!e.target.checked;cambio()}}),h('div',{},h('b',{},'Mostrar la actividad de autoaprendizaje'),h('span',{},'Si la desactiva, el recurso termina sin actividad.'))));
  return out;
}
function pAyuda(){
  return h('div',{class:'ayuda'},h('h2',{style:'font-size:1.1rem'},'¿Cómo usar el editor?'),
    h('ol',{},
      h('li',{},h('b',{},'Contenido: '),'cambie los textos. Cada escena, nodo, bloque o sección es una tarjeta que puede abrir y cerrar tocando su título.'),
      h('li',{},h('b',{},'Colores y letra: '),'elija una combinación de colores o sus propios colores, el tipo y tamaño de letra y suba el logo de la institución.'),
      h('li',{},h('b',{},'Orden y opciones: '),'cambie el orden de los elementos y decida si el estudiante debe avanzar en orden.'),
      h('li',{},h('b',{},'Vista previa: '),'«Ver todo» muestra el recurso completo para que lo revise. «Como estudiante» muestra los bloqueos tal como los verá quien lo use.'),
      h('li',{},h('b',{},'Si se equivoca: '),'use «Deshacer» (arriba a la izquierda) para volver atrás.'),
      h('li',{},h('b',{},'Descargar: '),'el botón dorado descarga un archivo .html que funciona solo, sin internet. Puede subirlo a su aula virtual o abrirlo con doble clic.')),
    h('div',{class:'msg info'},'Todo el contenido sale del guion. Si algo falta, escríbalo en la tarjeta correspondiente.'));
}

/* ---------- Arranque ---------- */
ir('inicio');
})();
