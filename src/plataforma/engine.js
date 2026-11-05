/* Motor de lectura de guiones: .docx / texto → recursos.
   Regla de oro: solo se usa texto que está en el guion. Lo que no se puede ubicar se reporta, nunca se inventa. */
(function(g){
const OVA=g.OVA=g.OVA||{};
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const words=t=>(t||'').trim().split(/\s+/).filter(Boolean).length;
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');

/* ---------- Lectura de .docx (zip + XML, sin librerías) ---------- */
async function unzip(buf){
  const u8=new Uint8Array(buf),dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  let e=u8.length-22;while(e>=0&&dv.getUint32(e,true)!==0x06054b50)e--;
  if(e<0)throw new Error('El archivo no parece un .docx válido.');
  const n=dv.getUint16(e+10,true);let p=dv.getUint32(e+16,true);const files={};
  for(let i=0;i<n;i++){
    const method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true),nlen=dv.getUint16(p+28,true),elen=dv.getUint16(p+30,true),clen=dv.getUint16(p+32,true),lho=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nlen));
    files[name]={method,csize,lho};p+=46+nlen+elen+clen;
  }
  return {files,u8,dv};
}
async function entry(z,name,asBytes){
  const f=z.files[name];if(!f)return null;
  const nlen=z.dv.getUint16(f.lho+26,true),elen=z.dv.getUint16(f.lho+28,true),st=f.lho+30+nlen+elen;
  const data=z.u8.subarray(st,st+f.csize);
  let out;
  if(f.method===0)out=data;
  else out=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  return asBytes?out:new TextDecoder().decode(out);
}
const pText=p=>dec([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map(m=>m[1]!==undefined?m[1]:(m[0]==='<w:tab/>'?'\t':'\n')).join(''));
function docxBlocks(xml){
  const body=xml.slice(Math.max(0,xml.indexOf('<w:body>')));
  const blocks=[];
  for(const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)){
    const s=m[0];
    if(s.startsWith('<w:tbl>')){
      const rows=(s.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)||[]).map(r=>(r.match(/<w:tc>[\s\S]*?<\/w:tc>/g)||[]).map(c=>(c.match(/<w:p[ >][\s\S]*?<\/w:p>/g)||[]).map(pText).join('\n').trim()));
      blocks.push({t:'table',rows});
    }else{
      const style=(s.match(/<w:pStyle w:val="([^"]+)"/)||[])[1]||'';
      pText(s).split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(x=>x&&/[\p{L}\p{N}]/u.test(x)).forEach(x=>blocks.push({t:'p',text:x,style}));
    }
  }
  return blocks;
}
async function leerDocx(buf){
  const z=await unzip(buf);
  const xml=await entry(z,'word/document.xml');
  if(!xml)throw new Error('No se encontró el contenido del documento.');
  return docxBlocks(xml);
}
function textoBlocks(txt){
  const blocks=[];
  const lines=txt.replace(/\r/g,'').split('\n');
  let pairs=[];
  const flush=()=>{pairs=pairs.filter(p=>norm(p[0])!=='campo');if(pairs.length){blocks.push({t:'table',rows:[['Campo','Contenido'],...pairs]});pairs=[]}};
  for(const raw of lines){
    const l=raw.trim();if(!l){continue}
    if(raw.includes('\t')&&raw.split('\t').filter(Boolean).length===2){pairs.push(raw.split('\t').map(x=>x.trim()));continue}
    flush();
    const h=l.match(/^#{1,2}\s+(.*)$/);
    blocks.push({t:'p',text:(h?h[1]:l.replace(/^[-*•]\s+/,'')),style:h?'Titulo1':''});
  }
  flush();return blocks;
}

/* ---------- Análisis del guion ---------- */
const RE_CODE=/^([A-Za-z]{1,4}\d+(?:-[A-Za-z0-9]+)+)\s+(.{3,})$/;
const RE_ITEM=/^(escena|nodo|conexi[oó]n|bloque|diapositiva|slide|paso|secci[oó]n|apartado|elemento)\s*(\d+)\s*[:.\-–—]\s*(.*)$/i;
const RE_ACT=/^actividad(?:\s+de\s+autoaprendizaje)?\s*:\s*(.+)$/i;
const RE_SEC=/^([^:.,;]{2,70}?)\s*:\s*(.+)$/;
const RE_TEC=/(duraci[oó]n|minutos?|p[aá]ginas?|accesibilidad|estilo visual|interacci[oó]n)/i;
const TIPOS={
  presentacion:{nombre:'Presentación',kw:['presentaci']},
  flujo:{nombre:'Diagrama de flujo',kw:['diagrama','flujo']},
  microvideo:{nombre:'Micro-video',kw:['micro']},
  video:{nombre:'Video explicativo',kw:['video']},
  podcast:{nombre:'Podcast',kw:['podcast','audio']},
  lectura:{nombre:'Lectura diagramada',kw:['lectura','texto','documento']},
  acordeon:{nombre:'Acordeón',kw:['acordeon']},
  infografia:{nombre:'Infografía',kw:['infografia']},
  portada:{nombre:'Portada',kw:['portada','galeria']},
  crucigrama:{nombre:'Crucigrama',kw:['crucigrama']},
  lineatiempo:{nombre:'Línea de tiempo',kw:['linea de tiempo','cronolog']},
  mapa:{nombre:'Mapa conceptual',kw:['mapa conceptual','mapa']},
  casos:{nombre:'Estudio de casos',kw:['estudio de caso','estudios de caso']}
};
function inferirTipo(nombre){
  const n=norm(nombre);
  if(n.includes('presentaci'))return'presentacion';
  if(n.includes('podcast'))return'podcast';
  if(n.includes('micro')&&n.includes('video'))return'microvideo';
  if(n.includes('video'))return'video';
  if(n.includes('crucigrama'))return'crucigrama';
  if(n.includes('mapa'))return'mapa';
  if(n.includes('estudio de caso')||n.includes('estudios de caso'))return'casos';
  if(n.includes('linea de tiempo')||n.includes('cronolog'))return'lineatiempo';
  if(n.includes('acordeon'))return'acordeon';
  if(n.includes('infografia'))return'infografia';
  if(n.includes('portada')||n.includes('galeria'))return'portada';
  if(n.includes('lectura'))return'lectura';
  if(n.includes('diagrama')||n.includes('flujo'))return'flujo';
  return null;
}
function limpiaPaso(s){return s.replace(/^\s*[-•*]\s*/,'').trim()}
function parseActividadInline(t){
  const out={};
  const re=/(Materiales|Pasos|Evidencias?|Criterio de clasificaci[oó]n|Criterios|Pares|Tipo|Nombre|Categor[ií]as|Preguntas gu[ií]a|Pregunta gu[ií]a|Antes de continuar|Objetivo|Estructura|Situaci[oó]n|Diagn[oó]stico|Configuraciones|Criterio de comparaci[oó]n|Intervenci[oó]n|Reporte|Preguntas)\s*:/gi;
  const marks=[...t.matchAll(re)];
  marks.forEach((m,i)=>{
    const k=norm(m[1]).replace(/s$/,'').replace('materiale','material');
    const v=t.slice(m.index+m[0].length,i+1<marks.length?marks[i+1].index:t.length).trim().replace(/[.;]\s*$/,'');
    out[k]=v;
  });
  const r={materiales:out.material||'',evidencia:out.evidencia||'',pasos:[],criterios:[],pares:[],preguntas:[],tipo:'',nombre:out.nombre||'',categorias:[],criterio:out['criterio de clasificacion']||''};
  r.objetivo=out.objetivo||'';r.estructura=out.estructura||'';r.antes=out['antes de continuar']||'';
  r.guias=(out['preguntas guia']||out['pregunta guia']||'').split(/\s*;\s*|\n+/).map(s=>s.trim()).filter(Boolean).join('\n');
  r.situacion=out.situacion||'';r.criterioComp=out['criterio de comparacion']||'';r.reporte=out.reporte||'';
  const pOp=t=>{const a=String(t||'').split(/\s*\|\s*/);return {p:a[0]||'',o:(a[1]||'').split(/\s*;\s*/).join('\n'),r:a.slice(2).join(' | ')}};
  {const d=pOp(out.diagnostico);r.diagPregunta=d.p;r.diagOpciones=d.o;r.diagRetro=d.r;const v=pOp(out.intervencion);r.intervPregunta=v.p;r.intervOpciones=v.o;r.intervRetro=v.r}
  r.configs=(out.configuracione||'').split(/\s*;;\s*/).map(x=>{const i=x.indexOf('=');if(i<0)return null;return {nombre:x.slice(0,i).trim(),indicadores:x.slice(i+1).split(/\s*,\s*/).map(s=>{const k=s.lastIndexOf(':');return k<0?'':s.slice(0,k).trim()+' | '+s.slice(k+1).trim()}).filter(Boolean).join('\n')}}).filter(c=>c&&c.nombre&&c.indicadores);
  if(out.pregunta){
    r.preguntas=out.pregunta.split(/\s*;;\s*/).map(x=>{const a=x.split(/\s*\|\s*/);return a.length>=3?{tipo:a[0],enunciado:a[1],opciones:a[2].split(/\s*;\s*/).join('\n'),retro:a.slice(3).join(' | ')}:null}).filter(Boolean);
  }
  if(out.categoria){
    r.categorias=out.categoria.split(/\s*;\s*|\n+/).map(x=>{const i=x.indexOf('=');return i<0?null:{nombre:x.slice(0,i).trim(),descripcion:'',elementos:x.slice(i+1).split(/\s*,\s*|\s*\|\s*/).map(s=>s.trim()).filter(Boolean).join('\n')}}).filter(c=>c&&c.nombre&&c.elementos);
  }
  if(out.pare){
    r.pares=out.pare.split(/\s*;\s*|\n+/).map(x=>x.split(/\s*(?:=|\||→|->|—|–)\s*/).map(s=>s.trim())).filter(a=>a.length>=2&&a[0]&&a[1]).map(a=>({a:a[0],b:a.slice(1).join(' ')}));
  }
  if(out.tipo){const n=norm(out.tipo);r.tipo=/empar/.test(n)?'emparejamiento':/cuestion/.test(n)?'cuestionario':/tarea/.test(n)?'tarea':/laborat/.test(n)?'laboratorio':/clasif/.test(n)?'clasificacion':/tarea/.test(n)?'tarea':/laborat/.test(n)?'laboratorio':'';}
  if(out.paso){
    const parts=out.paso.split(/\s*\d+\s*[).]\s+/).map(x=>x.trim().replace(/[.;]\s*$/,'')).filter(Boolean);
    r.pasos=parts.length?parts:[out.paso];
  }
  if(out.criterio){
    const c=out.criterio.split(/\s*,\s*/);
    if(c.length){const last=c.pop();const y=last.split(/\s+y\s+/);c.push(...y)}
    r.criterios=c.map(x=>x.trim()).filter(Boolean);
  }
  return r;
}
function construirRecurso(c,info){
  const lineas=c.lineas;
  const R={id:'r'+Math.random().toString(36).slice(2,9),codigo:c.codigo,clase:c.clase,nombre:c.nombre,tipo:c.tipo,titulo:'',partes:[],actividad:null,tecnica:{texto:'',duracion:''},avisos:[],sinUbicar:[]};
  let i=0;
  const esItem=t=>RE_ITEM.test(t)||/^(apertura|cierre)\s*:/i.test(t)||/^materiales\s*:/i.test(t)||RE_ACT.test(t);
  const t0=lineas.findIndex(l=>/t.?tulo\s*1|heading\s*1/i.test(l.style));
  if(t0>=0){R.titulo=lineas[t0].text.replace(/^[:\s]+|[:\s]+$/g,'');lineas.splice(t0,1)}
  else if(lineas[0]&&!esItem(lineas[0].text)){R.titulo=lineas[0].text;lineas.shift()}
  const pend=[];let act=null;
  lineas.forEach((l,idx)=>{
    const t=l.text;let m;
    if(/^materiales\s*:/i.test(t)){
      act=Object.assign(act||{},parseActividadInline(t));
      const prev=pend[pend.length-1];
      if(prev&&prev.idx===idx-1&&!act.enunciado){act.enunciado=prev.text;pend.pop()}
    }else if((m=RE_ACT.exec(t))){
      act=Object.assign(act||{},{enunciado:m[1].trim()});
    }else if((m=RE_ITEM.exec(t))){
      const grupo=norm(m[1]).replace('conexion','conexion'),n=+m[2];let txt=m[3].trim();let visual='';
      const v=txt.match(/^\[([^\]]*)\]\s*(.*)$/);if(v){visual=v[1].trim();txt=v[2].trim()}
      R.partes.push({clave:grupo,n,etiqueta:m[1][0].toUpperCase()+m[1].slice(1).toLowerCase()+' '+n,texto:txt,visual});
    }else if((m=/^(apertura|cierre)\s*:\s*(.*)$/i.exec(t))){
      R.partes.push({clave:norm(m[1]),n:0,etiqueta:m[1][0].toUpperCase()+m[1].slice(1).toLowerCase(),texto:m[2].trim(),visual:''});
    }else if((m=RE_SEC.exec(t))&&words(m[1])<=8){
      R.partes.push({clave:'seccion',n:0,etiqueta:m[1].trim(),texto:m[2].trim(),visual:''});
    }else pend.push({text:t,idx});
  });
  // ficha técnica: último párrafo suelto con indicaciones de producción
  for(let k=pend.length-1;k>=0;k--){
    if(RE_TEC.test(pend[k].text)&&pend[k].text.length>40){R.tecnica.texto=pend[k].text;pend.splice(k,1);break}
  }
  const d=R.tecnica.texto.match(/(\d+)\s*(minutos?|p[aá]ginas?)/i);
  if(d)R.tecnica.duracion=d[1]+' '+d[2].toLowerCase();
  R.sinUbicar=pend.map(p=>p.text);
  if(act&&(act.pasos||act.materiales||act.evidencia||act.criterios||act.enunciado)){
    // El enunciado puede traer en la misma línea «Pares: …», «Pasos: …», etc.
    const MK=/(Pares|Pasos|Evidencias?|Criterio de clasificaci[oó]n|Criterios|Materiales|Tipo|Nombre|Categor[ií]as|Preguntas gu[ií]a|Pregunta gu[ií]a|Antes de continuar|Objetivo|Estructura|Situaci[oó]n|Diagn[oó]stico|Configuraciones|Criterio de comparaci[oó]n|Intervenci[oó]n|Reporte|Preguntas)\s*:/i;
    if(act.enunciado&&MK.test(act.enunciado)){
      const i=act.enunciado.search(MK);
      const rest=parseActividadInline(act.enunciado.slice(i));
      act={enunciado:act.enunciado.slice(0,i).trim().replace(/[.;]\s*$/,''),materiales:act.materiales||rest.materiales,pasos:(act.pasos&&act.pasos.length)?act.pasos:rest.pasos,evidencia:act.evidencia||rest.evidencia,criterios:(act.criterios&&act.criterios.length)?act.criterios:rest.criterios,pares:rest.pares,tipo:rest.tipo,nombre:rest.nombre,categorias:rest.categorias,criterio:rest.criterio,preguntas:rest.preguntas,objetivo:rest.objetivo,estructura:rest.estructura,antes:rest.antes,guias:rest.guias,situacion:rest.situacion,criterioComp:rest.criterioComp,reporte:rest.reporte,diagPregunta:rest.diagPregunta,diagOpciones:rest.diagOpciones,diagRetro:rest.diagRetro,intervPregunta:rest.intervPregunta,intervOpciones:rest.intervOpciones,intervRetro:rest.intervRetro,configs:rest.configs};
    }
    const tipo=act.tipo||((act.pares&&act.pares.length)?'emparejamiento':((act.categorias&&act.categorias.length)?'clasificacion':((act.preguntas&&act.preguntas.length)?'cuestionario':'')));
    R.actividad={enunciado:act.enunciado||'',materiales:act.materiales||'',pasos:act.pasos||[],evidencia:act.evidencia||'',criterios:act.criterios||[],tipo,pares:act.pares||[],nombre:act.nombre||'',categorias:act.categorias||[],criterio:act.criterio||'',preguntas:act.preguntas||[],objetivo:act.objetivo||'',estructura:act.estructura||'',antes:act.antes||'',guias:act.guias||'',situacion:act.situacion||'',criterioComp:act.criterioComp||'',reporte:act.reporte||'',diagPregunta:act.diagPregunta||'',diagOpciones:act.diagOpciones||'',diagRetro:act.diagRetro||'',intervPregunta:act.intervPregunta||'',intervOpciones:act.intervOpciones||'',intervRetro:act.intervRetro||'',configs:act.configs||[]};
  }
  return R;
}
/* ---------- Guion con tablas: «Recurso educativo N» + Dato/Detalle + Guion estructurado + Actividad ---------- */
function actividadVacia(){return {enunciado:'',materiales:'',pasos:[],evidencia:'',criterios:[],tipo:'',pares:[],nombre:'',categorias:[],criterio:'',preguntas:[],objetivo:'',estructura:'',antes:'',guias:'',situacion:'',criterioComp:'',reporte:'',diagPregunta:'',diagOpciones:'',diagRetro:'',intervPregunta:'',intervOpciones:'',intervRetro:'',configs:[]}}
function desdeTablas(blocks){
  const info={},recursos=[];let evaluacion=false,cur=null,modo='';
  const cierra=()=>{
    if(!cur)return;
    const lineas=[{text:cur.titulo||cur.formato,style:'Heading1'}];
    cur.guion.forEach(([a,c])=>{if(a&&c)lineas.push({text:a+': '+c,style:''})});
    const R=construirRecurso({codigo:cur.codigo,nombre:cur.formato,clase:'',tipo:inferirTipo(cur.formato),lineas},info);
    if(cur.titulo)R.titulo=cur.titulo;
    if(cur.act){
      const A=actividadVacia();
      cur.act.forEach(([a,c])=>{
        const k=norm(a);
        if(k==='consigna')A.enunciado=c;
        else if(k==='materiales')A.materiales=c;
        else if(k==='pasos')A.pasos=c.split(/\s*\d+\s*[.)]\s+/).map(x=>x.trim().replace(/[.;]\s*$/,'')).filter(Boolean);
        else if(k==='evidencia')A.evidencia=c;
        else if(k==='criterios')A.criterios=c.split(/\s*;\s*/).map(x=>x.replace(/^\s*[a-z]\)\s*/i,'').trim().replace(/[.;]\s*$/,'')).filter(Boolean);
      });
      const BAS=['apartado','consigna','materiales','pasos','evidencia','criterios'];
      const extra=cur.act.filter(([a])=>a&&!BAS.includes(norm(a))).map(([a,c])=>a+': '+c).join(' ');
      if(extra){
        const X=parseActividadInline(extra);
        Object.keys(X).forEach(k=>{if(['materiales','evidencia','pasos','criterios'].includes(k))return;const v=X[k];if((Array.isArray(v)&&v.length)||(typeof v==='string'&&v))A[k]=v});
        if(!A.tipo)A.tipo=(A.pares&&A.pares.length)?'emparejamiento':(A.categorias&&A.categorias.length)?'clasificacion':(A.preguntas&&A.preguntas.length)?'cuestionario':(A.configs&&A.configs.length)?'laboratorio':'';
      }
      R.actividad=A;
    }
    if(cur.visual.length){
      R.tecnica.texto=cur.visual.join(' ');
      const d=R.tecnica.texto.match(/(\d+)\s*(minutos?|p[aá]ginas?)/i);if(d)R.tecnica.duracion=d[1]+' '+d[2].toLowerCase();
    }
    R.clase=cur.pres?'PRES':(R.actividad?'OVA':'OVI');
    R.subtemas=cur.subtemas;
    recursos.push(R);cur=null;
  };
  for(const b of blocks){
    if(b.t==='table'){
      const rows=b.rows;
      if(!cur&&rows.length>=2&&norm(rows[0][0])==='campo'){rows.slice(1).forEach(r=>{if(r[0])info[norm(r[0]).replace(/ /g,'_')]=(r[1]||'').trim()});continue}
      if(!cur)continue;
      const cuerpo=rows.slice(1);
      if(modo==='datos'){cuerpo.forEach(r=>{const k=norm(r[0]);const v=(r[1]||'').trim();if(k==='codigo')cur.codigo=v;else if(k==='formato')cur.formato=v;else if(k==='titulo')cur.titulo=v;else if(k==='subtemas')cur.subtemas=v})}
      else if(modo==='guion'){let visual=false;cuerpo.forEach(r=>{if(norm(r[0])==='produccion'){visual=true;return}if(visual){if(r[1])cur.visual.push(r[1].trim())}else cur.guion.push([(r[0]||'').trim(),(r[1]||'').trim()])})}
      else if(modo==='act')cur.act=cuerpo.map(r=>[(r[0]||'').trim(),(r[1]||'').trim()]);
      else if(modo==='visual')cuerpo.forEach(r=>{if(r[1])cur.visual.push(r[1].trim())});
      continue;
    }
    const t=(b.text||'').trim();if(!t)continue;
    if(/^recurso de presentaci[oó]n/i.test(t)){cierra();cur={pres:true,codigo:'',formato:'',titulo:'',subtemas:'',guion:[],act:null,visual:[]};modo='datos';continue}
    if(/^recurso educativo\s*\d+/i.test(t)){cierra();cur={pres:false,codigo:'',formato:'',titulo:'',subtemas:'',guion:[],act:null,visual:[]};modo='datos';continue}
    if(/^evaluaci[oó]n/i.test(t)&&!cur){evaluacion=true;continue}
    if(/^evaluaci[oó]n/i.test(t)){cierra();evaluacion=true;cur=null;continue}
    if(cur&&/^guion (estructurado|por escenas)/i.test(t)){modo='guion';continue}
    if(cur&&/^actividad de autoaprendizaje/i.test(t)){modo='act';continue}
    if(cur&&/^c[oó]mo se visualiza/i.test(t)){modo='visual';continue}
    if(!cur&&b.style&&/t.?tulo\s*1|heading\s*1/i.test(b.style)&&!info.titulo_guion)info.titulo_guion=t;
    if(!cur&&/^unidad\s*\d+/i.test(t)&&!info.titulo_tema)info.titulo_tema=t;
  }
  cierra();
  return {info,recursos,evaluacion};
}

function analizar(blocks){
  const info={},recursos=[],avisos=[];let cur=null,evaluacion=false;
  const cierra=()=>{if(cur){recursos.push(construirRecurso(cur,info));cur=null}};
  const esT=blocks.some(b=>b.t==='p'&&/^recurso (educativo\s*\d+|de presentaci[oó]n)\s*$/i.test((b.text||'').trim()));
  if(esT){const o=desdeTablas(blocks);Object.assign(info,o.info);recursos.push(...o.recursos);evaluacion=o.evaluacion}
  for(const b of (esT?[]:blocks)){
    if(b.t==='table'){
      const rows=b.rows;
      if(!cur&&rows.length>=2&&rows[0].length>=2&&norm(rows[0][0])==='campo'){
        rows.slice(1).forEach(r=>{if(r[0])info[norm(r[0]).replace(/ /g,'_')]=(r[1]||'').trim()});
      }
      continue;
    }
    const t=b.text;if(!t)continue;
    if(/^evaluaci[oó]n\s*:?$/i.test(t)){cierra();evaluacion=true;continue}
    const m=RE_CODE.exec(t);
    if(m&&!evaluacion){
      cierra();
      const cl=(m[2].match(/\((OVA|OVI)\)/i)||[])[1];
      const nombre=m[2].replace(/\s*\((OVA|OVI)\)\s*/i,' ').trim();
      const code=m[1];
      const clase=(cl||(/PRES/i.test(code)?'PRES':(/OV([AI])/i.exec(code)||[])[0]||'')).toUpperCase();
      cur={codigo:code,nombre,clase,tipo:inferirTipo(nombre),lineas:[]};
      continue;
    }
    if(cur)cur.lineas.push({text:t,style:b.style});
    else if(!evaluacion&&b.style&&/t.?tulo\s*1|heading\s*1/i.test(b.style)&&!info.titulo_guion)info.titulo_guion=t;
  }
  cierra();
  let diagnostico='';
  if(!recursos.length){
    const todo=blocks.map(b=>b.t==='table'?b.rows.map(r=>r.join(' ')).join(' '):b.text).join('\n');
    if(/<<[^>]*>>|<ID_RECURSO>/i.test(todo))diagnostico='Este documento es la plantilla del guion y todavía está sin llenar (tiene marcas como «<<TÍTULO_DEL_RECURSO>>»). Llénela con el contenido de cada recurso y vuelva a cargarla.';
    else if(blocks.some(b=>b.t==='table'&&b.rows[0]&&b.rows[0].some(c=>/recurso educativo digital|actividad de autoaprendizaje/i.test(c))))diagnostico='Este documento describe qué recursos tendrá la unidad (su estructura), pero no trae el contenido de cada uno: faltan las escenas, nodos, bloques o secciones. Cargue el guion de recursos, donde cada recurso tiene su código, por ejemplo «U2-T1-OVA1».';
  }
  recursos.forEach(r=>{
    if(!r.tipo){r.tipo='lectura';r.avisos.push('No se reconoció el tipo de recurso por su nombre («'+r.nombre+'»). Se armó como lectura diagramada; puede cambiarlo.')}
    if(!r.titulo)r.avisos.push('No se encontró un título para este recurso en el guion.');
    if(!r.partes.length)r.avisos.push('No se encontraron partes (escenas, nodos, bloques o secciones) en este recurso.');
    if(r.tipo==='infografia'&&!versionInf(r))r.avisos.push('El guion no indica la versión de la infografía (vertical, hexagonal, radial o de puntos). Se muestra la vertical; indíquela en el guion o cámbiela en el editor.');
    if(r.actividad&&!r.actividad.tipo){
      const tx=norm((r.actividad.enunciado||'')+' '+(r.actividad.materiales||''));
      const K=[[/cuestionario/,'cuestionario','las preguntas con sus opciones y la respuesta correcta'],[/clasific/,'clasificación','las categorías y los elementos de cada una'],[/emparej|relacione/,'emparejamiento','los pares correctos'],[/laborator|simulac/,'laboratorio virtual','la situación, las configuraciones y las opciones de cada paso'],[/tarea evaluativa|reto/,'tarea evaluativa','el objetivo, las preguntas guía y la estructura de entrega']];
      const k=K.find(x=>x[0].test(tx));
      if(k)r.avisos.push('El guion pide una actividad de '+k[1]+' pero no trae '+k[2]+'. Se muestra como actividad general (consigna, pasos, evidencia y criterios).');
    }
    if(r.clase==='OVA'&&!r.actividad)r.avisos.push('Es un recurso OVA, pero el guion no describe una actividad de autoaprendizaje.');
    if(r.clase==='OVI'&&r.actividad)r.avisos.push('Es un recurso OVI y el guion incluye una actividad: se mostrará.');
  });
  return {info,recursos,evaluacion,diagnostico};
}

/* ---------- Del guion a los datos que usa cada plantilla ---------- */
function versionInf(r){
  const n=norm((r.nombre||'')+' '+(r.partes||[]).filter(p=>/^(version|tipo|diseno)/.test(norm(p.etiqueta))).map(p=>p.texto).join(' '));
  return /hexag/.test(n)?'hex':/radial|circular|rueda/.test(n)?'radial':/punto|pines|ilustracion|hotspot/.test(n)?'pines':/vertical|\bred\b|estatic/.test(n)?'red':'';
}
function datosDe(r,info){
  const base={codigo:r.codigo,clase:r.clase,nombre:r.nombre,titulo:r.titulo||r.nombre,duracion:r.tecnica.duracion||'',tecnica:r.tecnica.texto||'',actividad:r.actividad?JSON.parse(JSON.stringify(r.actividad)):null};
  const P=r.partes;
  const pick=re=>P.filter(p=>re.test(p.clave));
  let d={};
  if(r.tipo==='presentacion'){
    const es=pick(/escena|diapositiva|slide|bloque|seccion/);
    const LAYS=['texto','radial','puntos','tarjetas','acordeon','galeria','pregunta','sintesis'];
    const infer=t=>/sintesis|cierre|conclusi/.test(norm(t))?'sintesis':'texto';
    d.diapositivas=(es.length?es:P).map(p=>{
      let t=String(p.texto||'');let layout='';let titulo=p.etiqueta;const m=/^\[(\w+)\]\s*/.exec(t);
      if(m&&LAYS.includes(m[1].toLowerCase())){layout=m[1].toLowerCase();t=t.slice(m[0].length)}
      if(!layout&&LAYS.includes(String(p.visual||'').toLowerCase()))layout=String(p.visual).toLowerCase();
      const m2=/^([^:|]{1,60}?)\s*:\s*(.+)$/.exec(t);if(/^diapositiva\s*\d*$/i.test(p.etiqueta)&&m2&&words(m2[1])<=6){titulo=m2[1].trim();t=m2[2]}
      const partes=t.split(/\s*\|\|\s*/);const items=partes.slice(1).join(' || ').split(/\s*;;\s*/).map(s=>s.trim()).filter(Boolean).join('\n');
      return {titulo,layout:layout||'texto',subtitulo:'',texto:partes[0],items,extra:'',img:''};
    });
  }else if(r.tipo==='flujo'){
    const ns=pick(/^nodo/),cs=pick(/^conexion/);
    d.nodos=ns.map(n=>{
      const m=/^([^:]{1,60}?)\s*:\s*(.+)$/.exec(n.texto);
      const cx=cs.find(c=>c.n===n.n);
      return {nombre:m&&words(m[1])<=6?m[1].trim():n.etiqueta,descripcion:m&&words(m[1])<=6?m[2].trim():n.texto,conexion:cx?cx.texto:'',forma:'',img:''};
    });
    d.proposito=(P.find(p=>/^proposito/.test(norm(p.etiqueta)))||{}).texto||'';d.explicacion=(P.find(p=>/^(explicacion|relaciones)/.test(norm(p.etiqueta)))||{}).texto||'';
  }else if(r.tipo==='video'||r.tipo==='microvideo'){
    const es=pick(/escena/);
    d.escenas=(es.length?es:P).map(p=>({titulo:p.etiqueta,visual:p.visual,narracion:p.texto,img:''}));
  }else if(r.tipo==='acordeon'){
    const esp=/introduccion|sintesis|referencias|fuentes|proposito/;
    const una=re=>(P.find(p=>re.test(norm(p.etiqueta)))||{}).texto||'';
    d.apartados=P.filter(p=>!esp.test(norm(p.etiqueta))).map(p=>({titulo:p.etiqueta,texto:p.texto,idea:'',img:''}));
    d.introduccion=una(/introduccion/);d.sintesis=una(/sintesis/);d.referencias=una(/referencias|fuentes/);d.img='';
  }else if(r.tipo==='infografia'){
    const una=re=>(P.find(p=>re.test(norm(p.etiqueta)))||{}).texto||'';
    d.bloques=P.filter(p=>!/fuentes|referencias|^(version|tipo|diseno)/.test(norm(p.etiqueta))).map(p=>({titulo:/^(bloque|seccion|apartado|elemento)\s*\d*$/.test(norm(p.etiqueta))?'':p.etiqueta,subtitulo:'',texto:p.texto,idea:'',fuente:'',x:'',y:'',img:''}));
    d.fuentes=una(/fuentes|referencias/);
    d.variante=versionInf(r)||'red';
    d.centro='';d.kicker='';d.descripcion='';d.dato='';d.img='';
  }else if(r.tipo==='portada'){
    const una=re=>(P.find(p=>re.test(norm(p.etiqueta)))||{}).texto||'';
    d.descripcion=una(/descripcion|resumen|presentacion|introduccion/)||(P[0]?P[0].texto:'');
    d.etiquetas=una(/etiquetas?/).split(/[,;|]/).map(t=>t.trim()).filter(Boolean).map(texto=>({texto}));
    d.boton=una(/boton/)||'Regresar al inicio';d.img='';
  }else if(r.tipo==='casos'){
    const una=re=>(P.find(p=>re.test(norm(p.etiqueta)))||{}).texto||'';
    const trozos=t=>String(t||'').split(/\s*\|\s*/);
    d.tituloReto=una(/^(titulo del reto|reto)/);d.contexto=una(/^(contexto|situacion|caso)/);d.objetivo=una(/^objetivo/);
    d.tituloExploracion=una(/^(titulo de la exploracion|exploracion)/);d.subExploracion='';
    d.evidencias=P.filter(p=>/^evidencia/.test(norm(p.etiqueta))).map(p=>{const a=trozos(p.texto);return a.length>=2?{titulo:a[0],texto:a[1],dato:a.slice(2).join(' | '),x:'',y:''}:{titulo:p.etiqueta,texto:p.texto,dato:'',x:'',y:''}});
    d.preguntas=una(/^preguntas/).split(/\s*;\s*|\s*\|\s*/).map(s=>s.trim()).filter(Boolean).join('\n');
    d.pasos=una(/^pasos/).split(/\s*;\s*|\s*\|\s*/).map(s=>s.trim()).filter(Boolean).join('\n');
    d.apartados=P.filter(p=>/^apartado/.test(norm(p.etiqueta))||p.clave==='apartado').map(p=>{const a=trozos(p.texto);return a.length>=2?{titulo:a[0],guia:a[1],clave:a.slice(2).join(' | ')}:{titulo:p.etiqueta,guia:p.texto,clave:''}});
    d.defienda=una(/^(defienda|reflexione)/);d.estructura=una(/^estructura/);
    d.criterios=una(/^criterios/).split(/\s*;\s*|\s*\|\s*/).map(s=>s.trim()).filter(Boolean).join('\n');d.img='';d.img2='';
  }else if(r.tipo==='mapa'){
    const parseN=t=>{
      t=String(t||'');let ti='';const mt=/^([^:|]{1,50}?)\s*:\s*(.+)$/.exec(t);
      if(mt&&words(mt[1])<=6){ti=mt[1].trim();t=mt[2].trim()}
      const a=t.split(/\s*\|\s*/);
      if(ti)return a.length>=2?{titulo:ti,relacion:a[0],texto:a.slice(1).join(' | ')}:{titulo:ti,relacion:'',texto:t};
      if(a.length>=3)return {titulo:a[0],relacion:a[1],texto:a.slice(2).join(' | ')};
      if(a.length===2)return {titulo:a[0],relacion:'',texto:a[1]};
      return {titulo:words(t)>6?t.split(/\s+/).slice(0,6).join(' '):t,relacion:'',texto:t};
    };
    const una=re=>(P.find(p=>re.test(norm(p.etiqueta)))||{}).texto||'';
    d.ramas=[];let ult=null;d.central='';d.centralTexto='';
    P.forEach(p=>{
      const e=norm(p.etiqueta);
      if(/^(concepto central|central)/.test(e)){const n=parseN(p.texto);d.central=n.titulo;d.centralTexto=n.texto===n.titulo?'':n.texto}
      else if(p.clave==='nodo'){const n=parseN(p.texto);ult={titulo:n.titulo,relacion:n.relacion,texto:n.texto,hijosTxt:''};d.ramas.push(ult)}
      else if(/^(hijo|subnodo|subconcepto)/.test(e)&&ult){const n=parseN(p.texto);ult.hijosTxt+=(ult.hijosTxt?'\n':'')+[n.titulo,n.relacion,n.texto].join(' | ')}
    });
    d.relacionTema=una(/^relacion con el tema/);d.reflexion=una(/^reflexion|^reflexione/);d.ejemplo=una(/^ejemplo/);d.intro=una(/^introduccion/);d.tituloMapa='';
  }else if(r.tipo==='lineatiempo'){
    const esExtra=p=>/^(introduccion|compara|comparacion|reflexion|analiza|secuencia)/.test(norm(p.etiqueta));
    const una=re=>(P.find(p=>re.test(norm(p.etiqueta)))||{}).texto||'';
    d.eventos=P.filter(p=>!esExtra(p)).map(p=>({fecha:p.etiqueta,titulo:'',texto:p.texto,cambio:'',img:''}));
    d.intro=una(/^introduccion/);d.comparar=una(/^(compara|comparacion|reflexion|analiza)/);d.tituloSecuencia='';
  }else if(r.tipo==='crucigrama'){
    d.palabras=P.filter(p=>!/^(nota|instruccion)/.test(norm(p.etiqueta))).map(p=>{
      const m=/^(.+?)\s*[|—–]\s*(.+)$/.exec(p.texto);
      return /^(palabra|pista|termino)\s*\d*$/.test(norm(p.etiqueta))&&m?{palabra:m[1].trim(),pista:m[2].trim()}:{palabra:p.etiqueta,pista:p.texto};
    });
    d.tituloCrucigrama='';d.nota=(P.find(p=>/^nota/.test(norm(p.etiqueta)))||{}).texto||'';
  }else if(r.tipo==='podcast'){
    d.bloques=P.map(p=>({etiqueta:p.etiqueta,texto:p.texto}));
  }else{
    const es=re=>p=>re.test(norm(p.etiqueta));
    const esGl=es(/^(glosario|termino|concepto clave)/),esRes=es(/^resumen$/),esReg=es(/^registro/),esRef=es(/^(referencias|fuentes)/),esPaso=p=>p.clave==='paso';
    const estilo=p=>esRef(p)?'referencias':/^caso/.test(norm(p.etiqueta))?'caso':/ejemplo/.test(norm(p.etiqueta))?'ejemplo':/sintesis|conclusi|cierre/.test(norm(p.etiqueta))?'sintesis':'normal';
    d.secciones=P.filter(p=>!esGl(p)&&!esRes(p)&&!esReg(p)&&!esPaso(p)).map(p=>({titulo:p.etiqueta,texto:p.texto,estilo:estilo(p),img:''}));
    d.glosario=P.filter(esGl).map(p=>({termino:p.etiqueta.replace(/^(glosario|t[eé]rmino|concepto clave)\s*\d*\s*[:\-–.]?\s*/i,'').trim()||p.etiqueta,definicion:p.texto}));
    d.pasos=P.filter(esPaso).map(p=>{const m=/^(.{1,40}?)\s*[:—–]\s*(.+)$/.exec(p.texto);return m?{titulo:m[1].trim(),texto:m[2].trim()}:{titulo:p.etiqueta,texto:p.texto}});
    d.registro=P.filter(esReg).flatMap(p=>p.texto.split(/\s*;\s*/).map(x=>x.split('|').map(s=>s.trim())).filter(a=>a.length>=2).map(a=>({observa:a[0],registra:a[1]})));
    d.resumen=(P.find(esRes)||{}).texto||'';d.kicker='';d.subtitulo='';d.centro='';
  }
  const resumen={programa:info.programa||'',asignatura:info.nombre_de_la_asignatura||info.asignatura||'',resultado:info.resultado_de_aprendizaje||'',nivel:info.nivel_de_formacion||''};
  return Object.assign(base,d,{info:resumen});
}
OVA.engine={norm,words,leerDocx,textoBlocks,analizar,datosDe,TIPOS,inferirTipo,docxBlocks};
if(typeof module!=='undefined')module.exports=OVA.engine;
})(typeof globalThis!=='undefined'?globalThis:window);
