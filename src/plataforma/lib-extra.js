/* ---- Utilidades de las plantillas de la plataforma ---- */
const FREE=!!window.__LIBRE;                    // vista libre del editor: sin bloqueos
const THEME=window.__TEMA||{};
const LAY=THEME.layout||{};
const LOCK=!FREE&&THEME.bloqueo!==false;          // «obligar a avanzar en orden»

function hero2(){
  document.title=CFG.titulo;
  const r=$('#hero');
  r.append(h('span',{class:'tag'},CFG.tag||''),h('h1',{},CFG.titulo),
    h('div',{class:'meta'},(CFG.chips||[]).filter(Boolean).map(m=>h('span',{},m))));
  const f=$('#foot');if(f)f.textContent=CFG.pie||'';
}
/* Tarjeta con el resultado de aprendizaje (texto tomado del guion) */
function infoCard(){
  const i=CFG.info||{};
  if(!i.resultado)return null;
  return h('div',{class:'card info'},h('b',{},'Resultado de aprendizaje'),h('p',{style:'margin:.3rem 0 0'},i.resultado));
}
const secs2=(n)=>Math.max(4,Math.round(words(n)/5));

/* Actividad de autoaprendizaje: muestra exactamente lo que dice el guion.
   No inventa preguntas ni respuestas: solo ofrece dónde registrar pasos, evidencia y autoevaluación. */
function actividadUI(host,A,opt){
  if(A&&A.tipo==='laboratorio'&&(A.configs||[]).length>0)return actividadLaboratorio(host,A);
  if(A&&A.tipo==='tarea')return actividadTarea(host,A);
  if(A&&A.tipo==='cuestionario'&&(A.preguntas||[]).length>0)return actividadCuestionario(host,A);
  if(A&&A.tipo==='clasificacion'&&(A.categorias||[]).length>1)return actividadClasificacion(host,A);
  if(A&&A.tipo==='emparejamiento'&&(A.pares||[]).filter(p=>p.a&&p.b).length>1)return actividadEmparejamiento(host,A);
  opt=opt||{};
  const key='act';
  const saved=store(key)||{pasos:[],crit:[],ev:''};
  const sv=()=>store(key,saved);
  const prog=h('div',{class:'bar','aria-hidden':'true'},h('i'));
  const total=(A.pasos||[]).length+(A.criterios||[]).length;
  const upd=()=>{
    const n=(saved.pasos||[]).filter(Boolean).length+(saved.crit||[]).filter(Boolean).length;
    $('i',prog).style.width=(total?n/total*100:0)+'%';
    res.textContent=(A.criterios||[]).length?('Criterios cumplidos: '+(saved.crit||[]).filter(Boolean).length+' de '+A.criterios.length):'';
  };
  const res=h('p',{class:'muted',style:'font-weight:600'});
  const card=h('div',{class:'card act'});
  card.append(h('h3',{style:'margin-top:0'},'Actividad de autoaprendizaje'));
  if(A.enunciado)card.append(h('p',{},A.enunciado));
  if(A.materiales)card.append(h('p',{},h('b',{},'Materiales: '),A.materiales));
  if(total)card.append(prog);
  if((A.pasos||[]).length){
    card.append(h('h4',{class:'ah4'},'Pasos'),h('p',{class:'hint'},LOCK?'Marque cada paso al terminarlo: se habilita el siguiente.':'Marque cada paso al terminarlo.'));
    const boxes=[];
    const list=h('ol',{class:'pasos2'},A.pasos.map((p,i)=>{
      const cb=h('input',{type:'checkbox',id:'ps'+i});cb.checked=!!saved.pasos[i];
      cb.onchange=()=>{saved.pasos[i]=cb.checked;sv();lock();upd();if(cb.checked)addPts2(1)};
      boxes.push(cb);
      return h('li',{},h('label',{for:'ps'+i,class:'cl'},cb,h('span',{},p)));
    }));
    const lock=()=>{if(!LOCK)return;boxes.forEach((b,i)=>{b.disabled=i>0&&!boxes[i-1].checked&&!b.checked})};
    lock();card.append(list);
  }
  if(A.evidencia){
    card.append(h('h4',{class:'ah4'},'Producto esperado'),h('p',{},A.evidencia));
  }
  if((A.criterios||[]).length){
    card.append(h('h4',{class:'ah4'},'Criterios de evaluación'),h('p',{class:'hint'},'Autoevalúese: marque los criterios que cumple.'),
      h('div',{},A.criterios.map((t,i)=>{
        const cb=h('input',{type:'checkbox',id:'cr'+i});cb.checked=!!saved.crit[i];
        cb.onchange=()=>{saved.crit[i]=cb.checked;sv();upd()};
        return h('label',{for:'cr'+i,class:'cl'},cb,h('span',{},t));
      })),res);
  }
  upd();host.append(card);
}
function addPts2(n){/* sin puntaje visible en esta plataforma */}
/* Bloqueo de una sección hasta que se cumpla una condición (si «bloqueo» está activo) */
function bloquear(el,msg){
  if(!LOCK){return {abrir(){}}}
  el.classList.add('gated');el.setAttribute('inert','');
  const v=h('div',{class:'veil'},h('div',{},h('div',{style:'font-size:1.8rem','aria-hidden':'true'},'🔒'),h('p',{},msg)));
  el.append(v);
  return {abrir(){if(!v.parentNode)return;v.remove();el.removeAttribute('inert');el.classList.remove('gated');el.classList.add('unlocked');toast('🔓 Sección desbloqueada');setTimeout(()=>el.scrollIntoView({behavior:'smooth',block:'start'}),200)}};
}

/* ---------- Actividades como «paso final aparte» ----------
   El recurso se completa primero; la actividad se abre en una vista propia (hoja completa) y se puede volver al recurso. */
const ACT_ROT={cuestionario:'Evaluación de aprendizaje',emparejamiento:'Actividad de emparejamiento',clasificacion:'Actividad de clasificación',tarea:'Tarea evaluativa',laboratorio:'Laboratorio virtual'};
function vistaActividad(titulo,rotulo,instruccion,cuerpo,alReiniciar){
  const MANO='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-4-2L4.5 15a1.6 1.6 0 0 1 2.4-2L9 15"/></svg>';
  const REINI='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
  const ins=h('p',{class:'ins'});ins.innerHTML=MANO;ins.append(h('span',{},instruccion));
  const rei=h('button',{class:'btn',type:'button',onclick:alReiniciar},'');rei.innerHTML=REINI+' Reiniciar actividad';
  const volver=h('button',{class:'btn sec',type:'button',onclick:()=>cierra()},'← Volver al recurso');
  const h1=h('h1',{},titulo);
  const ov=h('div',{class:'vact',role:'dialog','aria-modal':'true','aria-label':titulo},
    h('div',{class:'hoja'},
      h('div',{class:'cabv'},h('span',{class:'rot'},rotulo),h1,ins),
      h('div',{class:'cuerpov'},cuerpo),
      h('div',{class:'pieact'},rei,h('span',{},'Explora los elementos señalados y consulta la retroalimentación.'),h('span',{class:'sp'}),volver)));
  const esc=e=>{if(e.key==='Escape')cierra()};
  function abre(){document.body.append(ov);document.body.style.overflow='hidden';document.addEventListener('keydown',esc);ov.scrollTop=0}
  function cierra(){ov.remove();document.body.style.overflow='';document.removeEventListener('keydown',esc)}
  return {abre,cierra,h1};
}
function lanzadorActividad(host,A,titulo,vista){
  const tipo=ACT_ROT[A.tipo]||'Actividad';
  host.append(h('div',{class:'card act lanz'},
    h('span',{class:'tagl'},tipo),h('h3',{style:'margin:.3rem 0'},titulo),
    A.enunciado?h('p',{style:'margin:0 0 10px'},A.enunciado):null,
    h('button',{class:'btn',type:'button',onclick:()=>vista.abre()},'Ir a la actividad →')));
}
function actividadEmparejamiento(host,A){
  const P=(A.pares||[]).filter(p=>p.a&&p.b);
  const N=P.length;
  const titulo=A.nombre||'Actividad de emparejamiento';
  // Columna B mezclada de forma fija (igual para todos) y sin quedar en el orden correcto.
  let s=N*7919+13;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296};
  let orden=P.map((_,i)=>i);for(let i=N-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[orden[i],orden[j]]=[orden[j],orden[i]]}
  if(N>1&&orden.every((v,i)=>v===i))orden.push(orden.shift());
  let selA=null;const par={};            // par[iA]=iB (índices de P)
  let comprobado=false;
  const color=i=>'hsl('+((i*47)%360)+',62%,44%)';
  const colA=h('div',{class:'colx'}),colB=h('div',{class:'colx'});
  const res=h('p',{class:'resx'});
  let btn=null;
  function pinta(){
    colA.replaceChildren(h('h3',{},'Columna A · Conceptos'));colB.replaceChildren(h('h3',{},'Columna B · Aplicaciones'));
    P.forEach((p,i)=>{
      const k=par[i]!==undefined;
      const bien=comprobado&&k&&Number(par[i])===i;const mal=comprobado&&k&&Number(par[i])!==i;
      const c=h('button',{type:'button',class:'fila'+(selA===i?' sel':'')+(k?' unida':'')+(bien?' ok':'')+(mal?' mal':''),onclick:()=>{
        if(comprobado)return;
        if(k){delete par[i];selA=null}else selA=(selA===i?null:i);pinta();
      }},h('span',{class:'num'},String(i+1).padStart(2,'0')),h('span',{class:'tx'},p.a),
        h('span',{class:'pto',style:k?'background:'+color(i)+';border-color:'+color(i):''},k?String(i+1):''));
      colA.append(c);
    });
    orden.forEach((iB,pos)=>{
      const dueno=Object.keys(par).find(a=>Number(par[a])===iB);
      const k=dueno!==undefined;
      const bien=comprobado&&k&&Number(dueno)===iB;const mal=comprobado&&k&&Number(dueno)!==iB;
      const c=h('button',{type:'button',class:'fila b'+(k?' unida':'')+(bien?' ok':'')+(mal?' mal':''),onclick:()=>{
        if(comprobado)return;
        if(k){delete par[dueno];selA=Number(dueno);pinta();return}
        if(selA==null){toast('Primero elija un ítem de la columna A.');return}
        par[selA]=iB;selA=null;pinta();
      }},h('span',{class:'pto',style:k?'background:'+color(Number(dueno))+';border-color:'+color(Number(dueno)):''},k?String(Number(dueno)+1):''),
        h('span',{class:'num'},String.fromCharCode(65+pos)),h('span',{class:'tx'},P[iB].b));
      colB.append(c);
    });
    const n=Object.keys(par).length;
    res.textContent=comprobado?res.dataset.t:'Pares formados: '+n+' de '+N;
    if(btn)btn.disabled=comprobado||n<N;
  }
  btn=h('button',{class:'btn sec',type:'button',onclick:()=>{
    comprobado=true;const bien=Object.keys(par).filter(a=>Number(par[a])===Number(a)).length;
    res.dataset.t=bien===N?'¡Excelente! Los '+N+' pares son correctos.':'Pares correctos: '+bien+' de '+N+'. Revise los marcados en rojo y reinicie para intentarlo de nuevo.';
    pinta();toast(bien===N?'¡Actividad completada!':bien+' de '+N+' correctos');
  }},'Comprobar respuestas');
  const reiniciar=()=>{for(const k in par)delete par[k];selA=null;comprobado=false;delete res.dataset.t;pinta()};
  const cuerpo=h('div',{},
    h('h2',{class:'tit2'},'Relacione los elementos'),
    A.enunciado?h('p',{class:'sub2'},A.enunciado):null,
    h('div',{class:'dos'},colA,colB),h('div',{class:'row',style:'margin-top:12px'},btn,res));
  const vista=vistaActividad(titulo,ACT_ROT.emparejamiento,'Seleccione un ítem de la columna A y después un ítem de la columna B para emparejarlos.',cuerpo,reiniciar);
  pinta();
  lanzadorActividad(host,A,titulo,vista);
}

function actividadClasificacion(host,A){
  const C=(A.categorias||[]).map(c=>({nombre:c.nombre||'',descripcion:c.descripcion||'',els:String(c.elementos||'').split(/\n+/).map(x=>x.trim()).filter(Boolean)})).filter(c=>c.nombre&&c.els.length);
  const titulo=A.nombre||'Actividad de clasificación';
  // Todos los elementos, mezclados de forma fija; cada uno recuerda su categoría correcta.
  const T=[];C.forEach((c,ci)=>c.els.forEach(t=>T.push({t,ok:ci})));
  let s=T.length*7919+29;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296};
  for(let i=T.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[T[i],T[j]]=[T[j],T[i]]}
  const pos=T.map(()=>-1);                 // pos[i] = zona asignada (-1 = banco)
  let sel=null,comprobado=false;
  const banco=h('div',{class:'banco'}),zonas=h('div',{class:'zonas'}),res=h('p',{class:'resx'});
  let btn=null;
  const mover=(i,z)=>{if(comprobado)return;pos[i]=z;sel=null;pinta()};
  // Arrastrar y soltar con el puntero: funciona con ratón y con el dedo. Un toque corto sigue siendo «seleccionar».
  let recienArrastrado=false;
  function arrastra(e,i,c){
    if(comprobado||(e.pointerType==='mouse'&&e.button!==0))return;
    const x0=e.clientX,y0=e.clientY;let fan=null,sobre=null;
    const destino=(x,y)=>{const el=document.elementFromPoint(x,y);return el&&el.closest('.vact .drop,.vact .banco')};
    const mueve=ev=>{
      if(!fan){if(Math.hypot(ev.clientX-x0,ev.clientY-y0)<6)return;
        const r=c.getBoundingClientRect();fan=c.cloneNode(true);fan.classList.add('fantasma');
        fan.style.cssText='position:fixed;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;margin:0;pointer-events:none;z-index:9999';
        fan.dataset.dx=x0-r.left;fan.dataset.dy=y0-r.top;document.body.append(fan);c.classList.add('origen')}
      ev.preventDefault();
      fan.style.left=(ev.clientX-fan.dataset.dx)+'px';fan.style.top=(ev.clientY-fan.dataset.dy)+'px';
      const d=destino(ev.clientX,ev.clientY);if(d!==sobre){sobre&&sobre.classList.remove('sobre');sobre=d;sobre&&sobre.classList.add('sobre')}
    };
    const fin=ev=>{
      removeEventListener('pointermove',mueve);removeEventListener('pointerup',fin);removeEventListener('pointercancel',fin);
      if(!fan)return;
      fan.remove();c.classList.remove('origen');sobre&&sobre.classList.remove('sobre');
      recienArrastrado=true;setTimeout(()=>{recienArrastrado=false},0);
      const d=ev.type==='pointerup'?destino(ev.clientX,ev.clientY):null;
      if(d)mover(i,d.classList.contains('banco')?-1:Number(d.dataset.z));
    };
    addEventListener('pointermove',mueve,{passive:false});addEventListener('pointerup',fin);addEventListener('pointercancel',fin);
  }
  function chip(i){
    const bien=comprobado&&pos[i]===T[i].ok,mal=comprobado&&pos[i]!==T[i].ok;
    const c=h('button',{type:'button',class:'chip'+(sel===i?' sel':'')+(bien?' ok':'')+(mal?' mal':''),'aria-label':T[i].t,
      onclick:ev=>{ev.stopPropagation();if(comprobado||recienArrastrado)return;if(pos[i]>=0){mover(i,-1);return}sel=(sel===i?null:i);pinta()}},T[i].t);
    c.addEventListener('pointerdown',e=>arrastra(e,i,c));
    return c;
  }
  function pinta(){
    banco.replaceChildren(h('h3',{},'Banco de elementos'));
    const enBanco=T.map((_,i)=>i).filter(i=>pos[i]===-1);
    if(!enBanco.length)banco.append(h('p',{class:'vacio'},'Ya clasificó todos los elementos.'));
    enBanco.forEach(i=>banco.append(chip(i)));
    zonas.replaceChildren(...C.map((c,zi)=>{
      const dentro=T.map((_,i)=>i).filter(i=>pos[i]===zi);
      const drop=h('div',{class:'drop'+(sel!=null?' lista':''),'data-z':zi,onclick:()=>{if(sel!=null)mover(sel,zi)}},
        dentro.length?dentro.map(chip):h('span',{},sel!=null?'Toque aquí para colocar el elemento seleccionado':'Suelte aquí los elementos de esta categoría'));
      return h('div',{class:'zona'},h('b',{},'Zona '+(zi+1)+' · '+c.nombre),c.descripcion?h('p',{},c.descripcion):null,drop);
    }));
    const colocados=pos.filter(p=>p>=0).length;
    res.textContent=comprobado?res.dataset.t:'Elementos clasificados: '+colocados+' de '+T.length;
    if(btn)btn.disabled=comprobado||colocados<T.length;
  }
  btn=h('button',{class:'btn sec',type:'button',onclick:()=>{
    comprobado=true;const bien=T.filter((x,i)=>pos[i]===x.ok).length;
    res.dataset.t=bien===T.length?'¡Excelente! Clasificó correctamente los '+T.length+' elementos.':'Correctos: '+bien+' de '+T.length+'. Los marcados en rojo están en otra zona; reinicie para intentarlo de nuevo.';
    pinta();toast(bien===T.length?'¡Actividad completada!':bien+' de '+T.length+' correctos');
  }},'Comprobar respuestas');
  const reiniciar=()=>{pos.fill(-1);sel=null;comprobado=false;delete res.dataset.t;pinta()};
  const cuerpo=h('div',{},
    h('h2',{class:'tit2'},titulo),
    A.criterio?h('div',{class:'crit'},h('b',{},'Criterio de clasificación'),h('p',{},A.criterio)):null,
    A.enunciado?h('p',{class:'sub2'},A.enunciado):h('p',{class:'sub2'},'Seleccione una tarjeta y elija una zona de destino, o arrástrela. Puede reubicarla si cambia de decisión.'),
    h('div',{class:'cls'},banco,zonas),h('div',{class:'row',style:'margin-top:12px'},btn,res));
  const vista=vistaActividad(CFG.titulo||titulo,ACT_ROT.clasificacion,'Seleccione un elemento y asígnelo a la zona de clasificación. Reubique si es necesario.',cuerpo,reiniciar);
  pinta();
  lanzadorActividad(host,A,titulo,vista);
}

function actividadCuestionario(host,A){
  const Q=(A.preguntas||[]).map(q=>{
    const ops=String(q.opciones||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).map(t=>({t:t.replace(/\*\s*$/,'').trim(),ok:/\*\s*$/.test(t)}));
    const tipo=/mult/i.test(q.tipo||'')?'multiple':(/^(vf|verdadero|falso)/i.test(q.tipo||'')?'vf':'unica');
    return {tipo,enunciado:q.enunciado||'',ops,retro:q.retro||''};
  }).filter(q=>q.enunciado&&q.ops.length>1);
  const N=Q.length;
  const titulo=A.nombre||'Cuestionario con retroalimentación';
  const ETQ={unica:'Única respuesta',multiple:'Múltiple respuesta',vf:'Verdadero / falso'};
  const resp=Q.map(()=>new Set());const hecha=Q.map(()=>false);
  let cur=0,fin=false;
  const cuerpo=h('div',{});
  function esOk(i){const q=Q[i];const sel=resp[i];return q.ops.every((o,k)=>o.ok===sel.has(k))}
  function pinta(){
    cuerpo.replaceChildren();
    if(fin){
      const bien=Q.filter((_,i)=>esOk(i)).length;
      cuerpo.append(h('h2',{class:'tit2'},'Resultado de la actividad'),
        h('div',{class:'crit'},h('b',{},bien+' de '+N+' respuestas correctas'),h('p',{},bien===N?'¡Excelente! Respondió correctamente todas las preguntas.':'Revise las preguntas marcadas y vuelva a intentarlo para fortalecer su aprendizaje.')),
        h('div',{class:'nv'},...Q.map((q,i)=>h('div',{class:'fila '+(esOk(i)?'ok':'mal')},h('span',{class:'num'},String(i+1).padStart(2,'0')),h('span',{class:'tx'},q.enunciado)))),
        h('div',{class:'row',style:'margin-top:14px'},h('button',{class:'btn',type:'button',onclick:()=>{reiniciar()}},'Volver al inicio')));
      return;
    }
    const q=Q[cur];const ya=hecha[cur];
    cuerpo.append(h('h2',{class:'tit2'},'Pregunta '+(cur+1)+' · '+ETQ[q.tipo]),
      h('div',{class:'crit'},h('b',{},q.enunciado),h('p',{},q.tipo==='multiple'?'Seleccione todas las respuestas que considere correctas.':'Seleccione una respuesta y consulte la explicación antes de continuar.')));
    const lista=h('div',{class:'opc'});
    q.ops.forEach((o,k)=>{
      const sel=resp[cur].has(k);
      const bien=ya&&o.ok,mal=ya&&sel&&!o.ok;
      const b=h('button',{type:'button',class:'fila op'+(sel?' sel':'')+(bien?' ok':'')+(mal?' mal':''),onclick:()=>{
        if(ya)return;
        if(q.tipo==='multiple'){sel?resp[cur].delete(k):resp[cur].add(k)}else{resp[cur].clear();resp[cur].add(k)}
        pinta();
      }},h('span',{class:'num'},String.fromCharCode(65+k)+'.'),h('span',{class:'tx'},o.t),h('span',{class:'pto'+(q.tipo==='multiple'?' cuad':''),style:sel?'background:var(--brand);border-color:var(--brand)':''},sel?'✓':''));
      lista.append(b);
    });
    cuerpo.append(lista);
    if(ya){
      const ok=esOk(cur);
      cuerpo.append(h('div',{class:'fbq '+(ok?'ok':'mal')},h('b',{},ok?'¡Correcto!':'Revise su respuesta'),h('p',{},q.retro||(ok?'Su respuesta coincide con la del guion.':'Las respuestas correctas están marcadas en verde.'))));
    }
    const ant=h('button',{class:'btn sec',type:'button',disabled:cur===0,onclick:()=>{cur--;pinta()}},'← Anterior');
    const comp=h('button',{class:'btn sec',type:'button',disabled:ya||!resp[cur].size,onclick:()=>{hecha[cur]=true;pinta()}},'Comprobar respuesta');
    const ult=cur===N-1;
    const sig=h('button',{class:'btn',type:'button',disabled:!ya,onclick:()=>{if(ult){fin=true}else cur++;pinta()}},ult?'Ver resultado':'Siguiente →');
    cuerpo.append(h('div',{class:'row nav',style:'margin-top:12px'},ant,comp,h('span',{class:'cnt'},(cur+1)+'/'+N),h('span',{class:'sp'}),sig));
  }
  const reiniciar=()=>{resp.forEach(s=>s.clear());hecha.fill(false);cur=0;fin=false;pinta()};
  const vista=vistaActividad(CFG.titulo?titulo+' · '+(CFG.titulo):titulo,ACT_ROT.cuestionario,'Seleccione una respuesta y consulte la explicación antes de continuar.',cuerpo,reiniciar);
  pinta();
  lanzadorActividad(host,A,titulo,vista);
}

function actividadTarea(host,A){
  const titulo=A.nombre||'Tarea evaluativa';
  const par=s=>{const a=String(s||'').split('|').map(x=>x.trim());return {t:a[0]||'',d:a.slice(1).join(' | ')}};
  const PASOS=(A.pasos||[]).map(par).filter(p=>p.t);
  const CRIT=(A.criterios||[]).map(par).filter(p=>p.t);
  const GUIAS=String(A.guias||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const campos=GUIAS.length?GUIAS:['Su respuesta'];
  const ETAPAS=['Analiza el caso','Organiza tu respuesta','Revisa la entrega'];
  const TIT=['Objetivo y producto','Organiza y redacta tu respuesta','Revisa la entrega'];
  const clave='tarea';
  const mem=store(clave)||{};            // en memoria; se guarda en el navegador cuando es posible
  const guardado=()=>mem;
  let pg=0;
  const cuerpo=h('div',{});
  let vista=null;
  const palabras=()=>{const g=guardado();return campos.reduce((n,_,i)=>n+words(g['r'+i]||''),0)};
  function tarjeta(t,txt){return h('div',{class:'crit'},h('b',{},t),h('p',{},txt))}
  function p1(){
    const w=h('div',{});
    w.append(tarjeta('Objetivo del reto',A.objetivo||'Complete la tarea siguiendo los pasos de la actividad.'));
    if(A.enunciado)w.append(tarjeta('Descripción de la actividad',A.enunciado));
    if(A.materiales)w.append(tarjeta('Materiales',A.materiales));
    w.append(tarjeta('Producto esperado',A.evidencia||'Un documento con su respuesta argumentada.'));
    return w;
  }
  function p2(){
    const g=guardado();
    const izq=h('div',{},h('h3',{class:'sub3'},'Siga estos pasos'),h('div',{class:'pasosv'},PASOS.map((p,i)=>h('div',{class:'pasov'},h('b',{},(i+1)+'. '+p.t),p.d?h('span',{},p.d):null))));
    const der=h('div',{},h('h3',{class:'sub3'},'Prepare su producto'),
      A.estructura?h('p',{class:'sub2'},A.estructura):null,
      GUIAS.length?h('div',{class:'pasosv'},GUIAS.map(c=>h('div',{class:'pasov'},h('span',{},c)))):null,
      A.antes?h('div',{class:'crit'},h('b',{},'Antes de continuar'),h('p',{},A.antes)):null);
    return h('div',{class:'dosv'},izq,der);
  }
  function p3(){
    const w=h('div',{});
    w.append(tarjeta('Estructura y formato de entrega',A.estructura||'Entregue un documento organizado, con introducción, desarrollo y conclusión.'));
    if(CRIT.length){w.append(h('h3',{class:'sub3'},'Criterios de evaluación'));CRIT.forEach((c,i)=>w.append(h('div',{class:'crit'},h('b',{},'Criterio '+(i+1)+' · '+c.t),c.d?h('p',{},c.d):null)))}
    return w;
  }
  let navEl=null;
  function nav(){
    if(!navEl)return;
    const ult=pg===2,falta=false;
    const ant=h('button',{class:'btn sec',type:'button',disabled:pg===0,onclick:()=>{pg--;pinta()}},'← Anterior');
    const sig=h('button',{class:'btn',type:'button',disabled:falta,title:falta?'Escriba al menos 20 palabras para continuar':'',onclick:()=>{if(ult){reiniciar()}else{pg++;pinta()}}},ult?'Volver al inicio':'Siguiente →');
    navEl.replaceChildren(h('span',{class:'cnt'},(pg+1)+'/3 · '+ETAPAS[pg]+(falta?' · escriba al menos 20 palabras':'')),h('span',{class:'sp'}),ant,sig);
  }
  function pinta(){
    cuerpo.replaceChildren(pg===0?p1():pg===1?p2():p3());
    navEl=h('div',{class:'row nav',style:'margin-top:14px'});cuerpo.append(navEl);nav();
    if(vista)vista.h1.textContent=pg===0?titulo+' · '+TIT[0]:TIT[pg];
  }
  const reiniciar=()=>{pg=0;Object.keys(mem).forEach(k=>delete mem[k]);try{localStorage.removeItem('ova:'+CFG.id+':'+clave)}catch(e){}pinta()};
  vista=vistaActividad(titulo+' · '+TIT[0],ACT_ROT.tarea,'Consulte el objetivo y el producto y avance con Anterior o Siguiente.',cuerpo,reiniciar);
  pinta();
  lanzadorActividad(host,A,titulo,vista);
}

function actividadLaboratorio(host,A){
  const titulo=A.nombre||'Laboratorio virtual';
  const lin=s=>String(s||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const ops=s=>lin(s).map(t=>({t:t.replace(/\*\s*$/,'').trim(),ok:/\*\s*$/.test(t)}));
  const DG=ops(A.diagOpciones),IV=ops(A.intervOpciones);
  const CF=(A.configs||[]).map(c=>({n:c.nombre||'Configuración',ind:lin(c.indicadores).map(l=>{const a=l.split('|').map(x=>x.trim());const v=parseFloat(a[1]);return {t:a[0],v:Number.isFinite(v)?Math.max(0,Math.min(100,v)):0}})})).filter(c=>c.ind.length);
  const TIT=['Paso 1 · Diagnóstico de la situación','Paso 2 · Comparación de resultados','Paso 3 · Validación de la intervención','Reporte final de la experiencia'];
  const ETA=['Explora el entorno','Descubre los conceptos','Aplica lo aprendido','Resuelve el reto'];
  const clave='lab';const mem=store(clave)||{};
  const E={dg:null,dgOk:false,cfVistas:new Set(),cfSel:0,comparado:false,iv:null,ivOk:false};
  let pg=0,vista=null;
  const cuerpo=h('div',{});
  const sub=t=>h('h3',{class:'sub3'},t);
  const opcion=(lista,sel,hecho,onSel)=>h('div',{class:'opc'},lista.map((o,k)=>h('button',{type:'button',class:'fila op'+(sel===k?' sel':'')+(hecho&&o.ok?' ok':'')+(hecho&&sel===k&&!o.ok?' mal':''),onclick:()=>{if(!hecho)onSel(k)}},h('span',{class:'num'},String.fromCharCode(65+k)+'.'),h('span',{class:'tx'},o.t),h('span',{class:'pto',style:sel===k?'background:var(--brand);border-color:var(--brand)':''},sel===k?'✓':''))));
  const fb=(ok,txt)=>h('div',{class:'fbq '+(ok?'ok':'mal')},h('b',{},ok?'¡Correcto!':'Revise su elección'),h('p',{},txt));
  function p1(){
    const im=h('div',{class:'imgl'});if(A.img)im.append(h('img',{src:A.img,alt:''}));
    const w=h('div',{class:'dosv lab1'},h('div',{},im,h('div',{class:'crit',style:'margin-top:8px'},h('b',{},'Situación de práctica'),h('p',{},A.situacion||A.enunciado||'Observe la situación y reúna los datos para el diagnóstico.'))),
      h('div',{},sub('Paso 1 · Reconoce y configura'),h('p',{class:'sub2'},A.diagPregunta||'Seleccione el diagnóstico que mejor explica la situación.'),
        opcion(DG,E.dg,E.dgOk,k=>{E.dg=k;pinta()}),
        E.dgOk?fb(DG[E.dg]&&DG[E.dg].ok,A.diagRetro||''):h('button',{class:'btn sec',type:'button',style:'margin-top:8px',disabled:E.dg==null,onclick:()=>{E.dgOk=true;pinta()}},'Comprobar diagnóstico')));
    return w;
  }
  function p2(){
    const c=CF[E.cfSel]||CF[0];
    const bars=ind=>ind.map(i=>h('div',{class:'barv'},h('span',{},i.t),h('div',{class:'bar'},h('i',{style:'width:'+i.v+'%'})),h('b',{},i.v+'%')));
    const sel=h('div',{class:'cfsel'},CF.map((x,k)=>h('button',{type:'button',class:'fila'+(k===E.cfSel?' sel':''),onclick:()=>{E.cfSel=k;E.cfVistas.add(k);pinta()}},x.n,E.cfVistas.has(k)?h('span',{class:'pto',style:'background:var(--brand);border-color:var(--brand)'},'✓'):null)));
    const w=h('div',{class:'dosv'},h('div',{},sub('Paso 2 · Manipula y compara'),h('p',{class:'sub2'},'Elija cada configuración y observe sus resultados.'),sel,
        A.criterioComp?h('div',{class:'crit'},h('b',{},'Criterio de comparación'),h('p',{},A.criterioComp)):null),
      h('div',{},sub('Resultados de la configuración'),h('div',{class:'resv'},h('b',{},c.n),bars(c.ind)),
        E.comparado?h('div',{class:'crit',style:'margin-top:10px'},h('b',{},'Comparación'),h('div',{class:'tabv'},CF.map(x=>h('div',{},h('b',{},x.n),h('span',{},x.ind.map(i=>i.t+': '+i.v+'%').join(' · ')))))):
        h('button',{class:'btn sec',type:'button',style:'margin-top:8px',disabled:E.cfVistas.size<CF.length,onclick:()=>{E.comparado=true;pinta()}},'Comparar configuraciones')));
    if(!E.cfVistas.has(E.cfSel)){E.cfVistas.add(E.cfSel)}
    return w;
  }
  function p3(){
    const flujo=h('div',{class:'flv'},['1 · Preparar','2 · Aplicar','3 · Verificar'].map((t,i)=>[h('span',{class:'chv'},t),i<2?h('span',{class:'arv'},'→'):null]));
    return h('div',{},flujo,sub('Paso 3 · Diseña y verifica una acción'),h('p',{class:'sub2'},A.intervPregunta||'Elija la intervención más adecuada.'),
      opcion(IV,E.iv,E.ivOk,k=>{E.iv=k;pinta()}),
      E.ivOk?fb(IV[E.iv]&&IV[E.iv].ok,A.intervRetro||''):h('button',{class:'btn sec',type:'button',style:'margin-top:8px',disabled:E.iv==null,onclick:()=>{E.ivOk=true;pinta()}},'Comprobar intervención'));
  }
  const textoReg=()=>[
    ['Paso 1','Diagnóstico',E.dg!=null&&DG[E.dg]?DG[E.dg].t:'—',DG[E.dg]&&DG[E.dg].ok?'Acertado':'Por revisar'],
    ['Paso 2','Comparación',[...E.cfVistas].map(k=>CF[k]&&CF[k].n).filter(Boolean).join(', ')||'—',E.comparado?'Comparadas':'Pendiente'],
    ['Paso 3','Intervención',E.iv!=null&&IV[E.iv]?IV[E.iv].t:'—',IV[E.iv]&&IV[E.iv].ok?'Adecuada':'Por revisar']];
  function p4(){
    const filas=textoReg();
    const t=h('table',{class:'tabreg'},h('thead',{},h('tr',{},['Paso','Etapa','Su elección','Resultado'].map(x=>h('th',{},x)))),h('tbody',{},filas.map(f=>h('tr',{},f.map(x=>h('td',{},x))))));
    return h('div',{},sub('Registro de la experiencia'),t,A.reporte?h('p',{class:'sub2'},A.reporte):null);
  }
  const listo=()=>pg===0?E.dgOk:pg===1?E.comparado:pg===2?E.ivOk:true;
  function pinta(){
    cuerpo.replaceChildren(pg===0?p1():pg===1?p2():pg===2?p3():p4());
    const ult=pg===3,falta=LOCK&&!listo();
    cuerpo.append(h('div',{class:'row nav',style:'margin-top:14px'},h('span',{class:'cnt'},(pg+1)+'/4 · '+ETA[pg]+(falta?' · complete el paso para continuar':'')),h('span',{class:'sp'}),
      h('button',{class:'btn sec',type:'button',disabled:pg===0,onclick:()=>{pg--;pinta()}},'← Anterior'),
      h('button',{class:'btn',type:'button',disabled:falta,onclick:()=>{if(ult)reiniciar();else{pg++;pinta()}}},ult?'Volver al inicio':'Siguiente →')));
    if(vista)vista.h1.textContent=TIT[pg];
  }
  const reiniciar=()=>{Object.assign(E,{dg:null,dgOk:false,cfVistas:new Set(),cfSel:0,comparado:false,iv:null,ivOk:false});Object.keys(mem).forEach(k=>delete mem[k]);try{localStorage.removeItem('ova:'+CFG.id+':'+clave)}catch(e){}pg=0;pinta()};
  vista=vistaActividad(TIT[0],ACT_ROT.laboratorio,'Observe la situación y complete cada paso del laboratorio.',cuerpo,reiniciar);
  pinta();
  lanzadorActividad(host,A,titulo,vista);
}
