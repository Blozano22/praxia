/* Utilidades compartidas por todas las plantillas */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
function h(tag,attrs,...kids){
  const e=document.createElement(tag);
  for(const k in (attrs||{})){
    const v=attrs[k];
    if(v==null||v===false)continue;
    if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),v);
    else if(k==='class')e.className=v;
    else e.setAttribute(k,v===true?'':v);
  }
  kids.flat(9).forEach(c=>{if(c==null||c===false)return;e.append(c.nodeType?c:document.createTextNode(c))});
  return e;
}
// El contenido puede venir con su ejemplo entre las dos marcas de contenido (plantilla subida y abierta suelta): se quitan las marcas para leerlo.
const CFG=JSON.parse(document.getElementById('contenido').textContent.replace(/\/\*(?:FIN-)?CONTENIDO\*\//g,''));
/* Paleta por formación: si el contenido trae "nivel" (o meta.nivel, o la dirección ?nivel=), se ajustan las variables de color de la marca.
   Sin nivel no se toca nada (queda la paleta base que armó la plataforma, la de Tecnológico). Valores: tecnologia, profesional (alias licenciatura), especializacion, doctorado. */
(function(){
  var N={tecnologia:['#00665F','#142749'],profesional:['#1C45B4','#151B3B'],licenciatura:['#1C45B4','#151B3B'],especializacion:['#08A6CB','#151B3B'],doctorado:['#22335D','#151B3B']};
  var q=null;try{q=(window.__NIVEL||new URLSearchParams(location.search).get('nivel'))}catch(e){}
  var k=String(q||CFG.nivel||(CFG.meta&&CFG.meta.nivel)||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  if(!N[k])return;
  var base=N[k][0],osc=N[k][1];
  var rgb=function(h){return[1,3,5].map(function(i){return parseInt(h.substr(i,2),16)})};
  var mix=function(a,b,t){var A=rgb(a),B=rgb(b);return'#'+A.map(function(v,i){return Math.round(v*(1-t)+B[i]*t).toString(16).padStart(2,'0')}).join('')};
  var lum=function(h){var c=rgb(h).map(function(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
  var on=(1.05/(lum(base)+.05))>=4.5?'#FFFFFF':osc; /* texto sobre el color base: blanco solo si el contraste alcanza (el cian de Especialización pide texto oscuro) */
  var v={'--brand':base,'--nav':osc,'--ink':osc,'--tit':osc,'--on-brand':on,'--tint':mix(base,'#ffffff',.9),'--prop-bg':mix(base,'#ffffff',.9),'--prop-ink':base,'--prop-tx':osc,'--accent-soft':mix(base,'#ffffff',.92),'--muted':'rgba('+rgb(osc).join(',')+',.72)'};
  for(var n in v)document.documentElement.style.setProperty(n,v[n]);
})();
const words=t=>(t||'').trim().split(/\s+/).filter(Boolean).length;
const norm=t=>(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
/* SCORM 1.2 sin pantalla: usa la API del aula si existe y una simulación en memoria si no. Registra estado, lugar,
   datos de la sesión y tiempo. No califica. Todo dentro de try/catch: en un iframe aislado no hay API ni localStorage. */
const OVA=(function(){
  let api=null,t0=Date.now(),susp={},hecho=false,tm=null;
  const busca=()=>{try{let w=window,n=0;while(!w.API&&w.parent&&w.parent!==w&&n++<20)w=w.parent;return w.API||null}catch(e){return null}};
  const lee=k=>{try{return api?String(api.LMSGetValue(k)||''):''}catch(e){return ''}};
  const pon=(k,v)=>{try{if(api)api.LMSSetValue(k,String(v))}catch(e){}};
  const p2=n=>String(n).padStart(2,'0');
  const hms=ms=>{const s=Math.floor(ms/1000);return p2(Math.floor(s/3600))+':'+p2(Math.floor(s%3600/60))+':'+p2(s%60)};
  const guarda=()=>{pon('cmi.suspend_data',JSON.stringify(susp).slice(0,4000));pon('cmi.core.session_time',hms(Date.now()-t0));try{if(api)api.LMSCommit('')}catch(e){}};
  const pronto=()=>{clearTimeout(tm);tm=setTimeout(guarda,400)};
  try{
    api=busca();
    if(api){
      api.LMSInitialize('');
      const st=lee('cmi.core.lesson_status');
      if(st===''||st==='not attempted'||st==='unknown')pon('cmi.core.lesson_status','incomplete');else hecho=(st==='completed'||st==='passed');
      try{susp=JSON.parse(lee('cmi.suspend_data')||'{}')||{}}catch(e){susp={}}
    }
  }catch(e){api=null}
  addEventListener('pagehide',()=>{guarda();try{if(api)api.LMSFinish('')}catch(e){}});
  return {
    leer:k=>susp[k],
    guardar:(k,v)=>{susp[k]=v;pronto()},
    ubicacion:l=>{pon('cmi.core.lesson_location',String(l).slice(0,255));pronto()},
    completo:()=>{if(hecho)return;hecho=true;pon('cmi.core.lesson_status','completed');guarda()},
    esCompleto:()=>hecho
  };
})();
/* Los recursos llaman a ovaCompleto() cuando el estudiante ya visitó todo el contenido y a ovaUbicacion(x) al avanzar. */
const ovaCompleto=()=>OVA.completo();
const ovaUbicacion=l=>OVA.ubicacion(l);
function store(k,v){
  const key='ova:'+CFG.id+':'+k;
  if(v===undefined){
    try{const x=localStorage.getItem(key);if(x!=null)return JSON.parse(x)}catch(e){}
    const y=OVA.leer(key);return y===undefined?null:y;
  }
  try{localStorage.setItem(key,JSON.stringify(v))}catch(e){}
  OVA.guardar(key,v);
}
function hero(){
  document.title=CFG.titulo;
  $('#hero').append(
    h('span',{class:'tag'},CFG.tipo),
    h('h1',{},CFG.titulo),
    ...(CFG.subtitulo?[h('p',{},CFG.subtitulo)]:[]),
    h('div',{class:'meta'},(CFG.meta||[]).map(m=>h('span',{},m)))
  );
  const f=$('#foot');
  if(f)f.textContent=CFG.pie||'Recurso educativo digital · plantilla reutilizable';
}
let _gid=0;
function art(icon,hue,img){
  const d=h('div',{class:'art','aria-hidden':'true'});
  if(img){d.append(h('img',{src:img,alt:''}));return d}
  const id='g'+(++_gid);
  d.innerHTML='<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--brand2)"/><stop offset="1" style="stop-color:var(--mid)"/></linearGradient><pattern id="'+id+'p" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#ffffff" stroke-opacity=".06"/></pattern></defs><rect width="400" height="200" fill="url(#'+id+')"/><rect width="400" height="200" fill="url(#'+id+'p)"/><path d="M200 36l62 20v50c0 38-27 62-62 76-35-14-62-38-62-76V56z" fill="none" style="stroke:var(--accent)" stroke-width="3"/><path d="M200 58l40 13v35c0 25-17 41-40 51-23-10-40-26-40-51V71z" style="fill:var(--accent);stroke:var(--accent)" fill-opacity=".14" stroke-opacity=".6" stroke-width="1.5"/><rect x="0" y="192" width="400" height="8" style="fill:var(--accent)"/></svg>';
  return d;
}
function modal(title,body){
  const prev=document.activeElement;
  const close=()=>{ov.remove();document.removeEventListener('keydown',esc);if(prev&&prev.focus)prev.focus()};
  const esc=ev=>{if(ev.key==='Escape')close()};
  const x=h('button',{class:'x','aria-label':'Cerrar ventana',onclick:close},'×');
  const ov=h('div',{class:'overlay',role:'dialog','aria-modal':'true','aria-label':title,onclick:ev=>{if(ev.target===ov)close()}},
    h('div',{class:'modal'},x,h('h3',{},title),body,h('div',{class:'row',style:'margin-top:14px'},h('button',{class:'btn sec',onclick:close},'Cerrar'))));
  document.body.append(ov);document.addEventListener('keydown',esc);x.focus();
  return close;
}
function fb(kind,title,text){return h('div',{class:'fb '+kind,role:'status'},h('b',{},title),text)}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function download(name,text){
  const a=h('a',{href:URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),download:name});
  document.body.append(a);a.click();a.remove();
}

/* ---- Interacción obligatoria: avisos, confeti, puntos y bloqueo de secciones ---- */
function toast(msg){
  document.querySelectorAll('.toast').forEach(x=>x.remove());
  const t=h('div',{class:'toast',role:'status'},msg);document.body.append(t);
  setTimeout(()=>t.classList.add('out'),2300);setTimeout(()=>t.remove(),2900);
}
function burst(){}
let _pts=0,_hud=null;
function addPts(n,why){
  _pts+=n;
  if(!_hud){_hud=h('div',{class:'hud','aria-live':'polite'});document.body.append(_hud)}
  _hud.textContent=''+_pts+' puntos';_hud.classList.remove('pop');void _hud.offsetWidth;_hud.classList.add('pop');
  if(why)toast('+'+n+' · '+why);
}
/* ---- Secciones principales tipo acordeón: bloqueada → abierta → completada (se puede reabrir) ---- */
const topLevel=el=>el.parentElement&&el.parentElement.matches('main.wrap')&&el.classList.contains('sec');
function accWrap(el){
  if(el._acc||el.hidden)return;
  const t=el.querySelector(':scope>h2');
  const title=t?t.textContent:'';
  if(t)t.remove();
  const ab=h('div',{class:'ab'});
  while(el.firstChild)ab.append(el.firstChild);
  const hd=h('button',{class:'ah',type:'button',id:t&&t.id||null});
  el.append(hd,ab);
  el._acc={locked:false,done:false,open:true,msg:'',title,hd,ab};
  hd.onclick=()=>{
    const a=el._acc;
    if(a.locked){toast('🔒 '+a.msg);hd.classList.add('shake');setTimeout(()=>hd.classList.remove('shake'),400);return}
    a.open?(a.open=false,accRender(el)):accOpen(el);
  };
  accRender(el);
}
function accRender(el){
  const a=el._acc;if(!a)return;
  const st=a.locked?'lock':a.open?'open':a.done?'done':'idle';
  a.hd.className='ah '+st;
  a.hd.setAttribute('aria-expanded',String(a.open));
  a.hd.replaceChildren(...(st==='open'?[h('span',{class:'tt'},a.title)]:[
    h('span',{class:'ic','aria-hidden':'true'},st==='lock'?'🔒':st==='done'?'✔':'▶'),
    h('span',{class:'tt'},a.title),
    h('span',{class:'st'},st==='lock'?a.msg:st==='done'?'Completada · toque para abrir':'En curso · toque para abrir')]));
  a.ab.hidden=!a.open;
}
function accOpen(el){
  accWrap(el);const a=el._acc;if(!a)return;
  a.locked=false;
  const all=[...el.parentElement.children].filter(x=>x._acc);
  const k=all.indexOf(el);
  all.forEach((x,j)=>{if(x===el)return;x._acc.open=false;if(j<k&&!x._acc.locked)x._acc.done=true;accRender(x)});
  a.open=true;accRender(el);
  setTimeout(()=>el.scrollIntoView({behavior:'smooth',block:'start'}),120);
}
function accAll(){$$('main.wrap>section.sec').forEach(accWrap)}
function gate(el,msg){
  if(topLevel(el)){accWrap(el);const a=el._acc;a.locked=true;a.open=false;a.msg=msg;accRender(el);return}
  el.classList.add('gated');el.setAttribute('inert','');
  const t=el.querySelector(':scope>h2');
  el._veil=h('div',{class:'veil'},h('div',{},h('div',{style:'font-size:2rem','aria-hidden':'true'},'🔒'),t?h('h3',{},t.textContent):null,h('p',{},msg)));
  el.append(el._veil);
}
function ungate(el,msg){
  if(topLevel(el)){if(!el._acc||!el._acc.locked)return;accOpen(el);toast('🔓 '+(msg||'Sección desbloqueada'));return}
  if(!el._veil)return;
  el._veil.remove();el._veil=null;el.removeAttribute('inert');el.classList.remove('gated');el.classList.add('unlocked');
  toast('🔓 '+(msg||'Sección desbloqueada'));
}
