/* Editor de textos por clic para las plantillas HTML de Praxia (módulo autónomo, sin dependencias).
 *
 * Se inyecta DENTRO de la página de la plantilla ya pintada (iframe srcdoc propio de Praxia). Con el modo de edición activo, al hacer clic en un texto
 * que viene del JSON de contenido se abre un cuadro para editarlo; al guardar avisa a la página padre por postMessage. No modifica la plantilla:
 * asocia lo que se ve con el campo del JSON de dos maneras: (1) MAPA EXACTO por marcas: la pantalla padre pinta una vez la plantilla en un iframe oculto con
 * el contenido «marcado» (cada texto editable lleva delante un centinela invisible de caracteres de ancho cero que codifica su índice; ver marcar y mapear),
 * recorre el DOM y envía el mapa { ruta, camino DOM, nodo de texto o atributo }; (2) respaldo: comparar textos (igualdad y contención, sin tildes ni
 * mayúsculas ni signos) para lo que el mapa no cubre o cuando el mapa ya no coincide con el DOM (plantillas que repintan pestañas/diapositivas).
 *
 * Uso (dentro del iframe, después de pintar la plantilla):
 *   PraxiaEditor.iniciar({ contenido: <objeto JSON final>, activo: false });   // activo: modo de edición al arrancar
 *
 * Mensajes del iframe al padre (event.data), todos con fuente: 'praxia-editor':
 *   { tipo: 'listo', campos: [...] }                                   al iniciar (lista de respaldo, ver listaCampos)
 *   { tipo: 'campo', ruta, valor, anterior, parchado, ambiguo }        el usuario guardó un texto (parchado: ya se cambió en pantalla; si es false, recargar con el JSON nuevo)
 *   { tipo: 'sin_campo', texto }                                       clic en un texto que no se pudo asociar a un campo
 *   { tipo: 'lista', campos: [...] }                                   respuesta a { tipo: 'lista' } (y se reenvía sola cuando llega el mapa)
 *        cada campo: { ruta, etiqueta (legible), seccion (primer nivel de la ruta), valor, largo, enPantalla, mapeado }
 *        enPantalla: hay un elemento visible con ese texto (por mapa o, si no hay, por comparación de textos); mapeado: tiene entrada exacta en el mapa
 *   { tipo: 'resaltado', ruta, encontrado }                            respuesta a { tipo: 'resaltar' }
 *   { tipo: 'mapa', entradas: [...], error }                           (solo del iframe oculto de marcas; el padre lo reenvía al visible)
 * Mensajes del padre al iframe (event.source debe ser window.parent):
 *   { fuente: 'praxia-editor', tipo: 'modo', activo: true|false }
 *   { fuente: 'praxia-editor', tipo: 'actualizar', ruta, valor }       cambia un campo (por ejemplo desde un formulario de respaldo)
 *   { fuente: 'praxia-editor', tipo: 'lista' }                         pide la lista de campos
 *   { fuente: 'praxia-editor', tipo: 'resaltar', ruta }                hace scroll y resalta en la vista el elemento de ese campo si está visible
 *   { fuente: 'praxia-editor', tipo: 'mapa', entradas: [...] }         mapa exacto calculado por el iframe oculto (lo envía el padre)
 * Iframe oculto de marcas: PraxiaEditor.marcar(contenido) → { contenido: copia marcada, rutas: [...] } (se usa en el padre) y
 *   PraxiaEditor.mapear({ rutas }) dentro de la página marcada (espera a que la plantilla termine de pintar y envía { tipo: 'mapa' }).
 * Panel «Todos los textos» (padre): usar 'lista' para pintar los campos, 'actualizar' para editar, 'resaltar' al pasar el cursor o enfocar un campo.
 */
(function (global) {
  'use strict';
  var FUENTE = 'praxia-editor';
  // Datos internos que nunca son texto del guion (por nombre de clave), y claves que a veces son un valor cerrado y a veces texto (se decide por contenido).
  var INTERNOS = /^(icono|id|codigo|variante|plantilla|nombre_plantilla|altura|nivel|imagen_url|url|enlace|color|colores)$/;
  var SEGUN_CONTENIDO = /^(encabezado|nombre|tipo)$/;
  var RE_ENLACE = /^(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|data:|mailto:)/i, RE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(.*\))$/i;
  function esEditable(ruta, v) {
    var m = /([^.\[\]]+)(?:\[\d+\])*$/.exec(ruta), clave = m ? m[1] : '', t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (t.length < 2 || /^np_[0-9]+$/.test(t) || INTERNOS.test(clave) || RE_ENLACE.test(t) || RE_COLOR.test(t)) return false;
    if (SEGUN_CONTENIDO.test(clave)) return t.split(' ').length >= 2 && /\p{L}{2}/u.test(t);   // valor cerrado («tipo»: «reto») no; texto del guion (≥2 palabras) sí
    return true;
  }
  var est = { mapa: [], imagenes: [], contenido: {}, hojas: [], activo: false, elemento: null, hoja: null, resalte: null, caja: null, listo: false };

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function plano(s) { return norm(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function palabras(s) { return norm(s).split(' ').filter(Boolean).length; }

  // ---------- hojas de texto del JSON ----------
  function recoger(v, ruta, salida) {
    if (typeof v === 'string') {
      if (esEditable(ruta, v)) salida.push({ ruta: ruta, valor: v, plano: plano(v) });
    } else if (Array.isArray(v)) { v.forEach(function (x, i) { recoger(x, ruta + '[' + i + ']', salida); }); }
    else if (v && typeof v === 'object') { Object.keys(v).forEach(function (k) { recoger(v[k], ruta ? ruta + '.' + k : k, salida); }); }
    return salida;
  }
  function indexar() { est.hojas = recoger(est.contenido, '', []); }
  function leer(ruta) { return ruta.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce(function (a, k) { return a == null ? a : a[k]; }, est.contenido); }
  function poner(ruta, valor) {
    var ks = ruta.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean), a = est.contenido;
    for (var i = 0; i < ks.length - 1; i++) { a = a[ks[i]]; if (a == null) return false; }
    a[ks[ks.length - 1]] = valor; return true;
  }

  // ---------- asociar un texto visible con su campo ----------
  function buscarCampo(texto) {
    var p = plano(texto);
    if (p.length < 2) return null;
    var iguales = est.hojas.filter(function (h) { return h.plano === p; });
    if (iguales.length) return { hoja: iguales[0], tipo: 'exacto', ambiguo: iguales.length > 1, iguales: iguales };
    var dentro = est.hojas.filter(function (h) { return h.plano.length >= 10 && p.indexOf(h.plano) >= 0 && h.plano.length >= p.length * 0.6; });   // el texto de la página envuelve al valor (y el valor es la mayor parte de él: un grupo grande con muchos textos no es el campo)
    if (dentro.length) { dentro.sort(function (a, b) { return b.plano.length - a.plano.length; }); return { hoja: dentro[0], tipo: 'contiene', ambiguo: false }; }
    return null;
  }
  function buscarExacto(texto) {
    var p = plano(texto); if (p.length < 2 || p.length > 20000) return null;
    var iguales = est.hojas.filter(function (h) { return h.plano === p; });
    return iguales.length ? { hoja: iguales[0], tipo: 'exacto', ambiguo: iguales.length > 1 } : null;
  }
  function textoPropio(el) { return norm(Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; }).map(function (n) { return n.textContent; }).join(' ')); }
  // ---------- mapa exacto (marcas) ----------
  var DIG = ['\u200B', '\u200C', '\u200D'], RE_MARCA = /\u2060([\u200B\u200C\u200D]+)\u2060/g, ATRIBUTOS = ['alt', 'title', 'aria-label', 'placeholder', 'value'];
  function centinela(i) { var d = ''; do { d = DIG[i % 3] + d; i = Math.floor(i / 3); } while (i > 0); return '\u2060' + d + '\u2060'; }
  function decodificar(d) { var n = 0; for (var i = 0; i < d.length; i++) n = n * 3 + DIG.indexOf(d.charAt(i)); return n; }
  // Copia del contenido con un centinela invisible delante de cada texto editable. rutas[i] es la ruta del centinela i.
  function marcar(contenido) {
    var rutas = [];
    function ir(v, ruta) {
      if (typeof v === 'string') { if (esEditable(ruta, v)) { rutas.push(ruta); return centinela(rutas.length - 1) + v; } return v; }
      if (Array.isArray(v)) return v.map(function (x, i) { return ir(x, ruta + '[' + i + ']'); });
      if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = ir(v[k], ruta ? ruta + '.' + k : k); }); return o; }
      return v;
    }
    return { contenido: ir(contenido, ''), rutas: rutas };
  }
  function caminoDe(el) { var c = []; for (var a = el; a && a !== document.body; a = a.parentElement) { if (!a.parentElement) return null; c.unshift(Array.prototype.indexOf.call(a.parentElement.children, a)); } return c; }
  // En la página marcada: recorre el DOM ya pintado y envía el mapa. Si la plantilla dio error de JS no hay mapa (el visible usa el respaldo por texto).
  function mapear(op) {
    var rutas = (op && op.rutas) || [], hecho = false;
    function recorrer() {
      var ent = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
      for (var n = w.nextNode(); n; n = w.nextNode()) {
        var host = n.nodeType === 3 ? n.parentElement : n;
        if (!host || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(host.tagName)) continue;
        var camino = caminoDe(host); if (!camino) continue;
        if (n.nodeType === 3) {
          var t = n.nodeValue, m, quitado = 0, nodo = Array.prototype.indexOf.call(host.childNodes, n); RE_MARCA.lastIndex = 0;
          while ((m = RE_MARCA.exec(t))) { var r = rutas[decodificar(m[1])]; if (r) ent.push({ ruta: r, camino: camino, nodo: nodo, attr: null, desde: m.index - quitado }); quitado += m[0].length; }
        } else {
          for (var i = 0; i < ATRIBUTOS.length; i++) {
            var v = n.getAttribute(ATRIBUTOS[i]); RE_MARCA.lastIndex = 0; var m2 = v ? RE_MARCA.exec(v) : null;
            if (m2 && rutas[decodificar(m2[1])]) ent.push({ ruta: rutas[decodificar(m2[1])], camino: camino, nodo: -1, attr: ATRIBUTOS[i], desde: 0 });
          }
        }
      }
      return ent;
    }
    function fin() {
      if (hecho) return; hecho = true;
      var error = !!(global.__praxiaErr > 0), ent = [];
      if (!error) { try { ent = recorrer(); } catch (e) { error = true; } }
      emitir({ tipo: 'mapa', error: error, entradas: ent.slice(0, 5000) });
    }
    function esperar() {                       // espera a que la plantilla termine de pintar: DOM quieto 350 ms (máximo 4 s)
      var t = setTimeout(fin, 600), mo = global.MutationObserver ? new MutationObserver(function () { clearTimeout(t); t = setTimeout(fin, 350); }) : null;
      if (mo) mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
      setTimeout(fin, 4000);
    }
    if (document.readyState === 'complete') esperar(); else global.addEventListener('load', esperar);
  }
  function hojaDe(ruta) { for (var i = 0; i < est.hojas.length; i++) if (est.hojas[i].ruta === ruta) return est.hojas[i]; return null; }
  function enlazar(en) {                         // resuelve el elemento/nodo de la entrada en el DOM actual y comprueba que sigue siendo ese texto
    var a = document.body, h = hojaDe(en.ruta);
    en.ok = false; en.el = null; en.nd = null;
    for (var i = 0; a && i < en.camino.length; i++) a = a.children[en.camino[i]];
    if (!a || !h) return false;
    en.el = a;
    var p = plano(h.valor).slice(0, 12), actual;
    if (en.attr) actual = a.getAttribute(en.attr); else { en.nd = a.childNodes[en.nodo]; actual = en.nd && en.nd.nodeType === 3 ? en.nd.nodeValue : null; }
    if (actual == null) return false;
    en.ok = p.length < 2 || plano(actual).indexOf(p) >= 0;
    return en.ok;
  }
  function resolverMapa(target, ev) {
    if (!est.mapa.length) return null;
    est.mapa.forEach(enlazar);
    for (var a = target; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (a.closest && a.closest('#praxia-editor-caja')) return null;
      var aqui = est.mapa.filter(function (en) { return en.ok && en.el === a; });
      if (!aqui.length) continue;
      aqui.sort(function (x, y) { return (x.attr ? 1 : 0) - (y.attr ? 1 : 0); });
      var en = aqui[0];
      if (ev && aqui.length > 1 && document.caretRangeFromPoint) {      // varios campos en el mismo nodo de texto: el más cercano al clic
        var rg = document.caretRangeFromPoint(ev.clientX, ev.clientY);
        if (rg) { var mismos = aqui.filter(function (x) { return x.nd === rg.startContainer; }); mismos.forEach(function (x) { if (x.desde <= rg.startOffset) en = x; }); if (mismos.length && mismos.indexOf(en) < 0) en = mismos[0]; }
      }
      return { elemento: a, hoja: hojaDe(en.ruta), tipo: 'mapa', ambiguo: false, entrada: en };
    }
    return null;
  }
  function parcharEntrada(en, anterior, nuevo) {   // cambia solo la parte del valor dentro del nodo (conserva numeración/etiquetas que agregó la plantilla)
    try {
      if (!enlazar(en)) return false;
      var texto = String(nuevo).split(/\n{2,}/).join(' ');
      if (en.attr) { en.el.setAttribute(en.attr, texto); return true; }
      var t = en.nd.nodeValue, i = t.indexOf(anterior);
      if (i < 0) { if (norm(t) !== norm(anterior)) return false; en.nd.nodeValue = texto; return true; }
      en.nd.nodeValue = t.slice(0, i) + texto + t.slice(i + anterior.length);
      var delta = texto.length - anterior.length;
      est.mapa.forEach(function (x) { if (x !== en && x.camino.join() === en.camino.join() && x.nodo === en.nodo && x.desde > en.desde) x.desde += delta; });
      return true;
    } catch (e) { return false; }
  }
  function recibirMapa(entradas) {
    est.mapa = (Array.isArray(entradas) ? entradas : []).filter(function (x) { return x && typeof x.ruta === 'string' && Array.isArray(x.camino); })
      .map(function (x) { return { ruta: x.ruta, camino: x.camino.map(Number), nodo: Number(x.nodo), attr: typeof x.attr === 'string' ? x.attr : null, desde: Number(x.desde) || 0 }; });
    emitir({ tipo: 'lista', campos: listaCampos() });
  }
  function visible(el) {
    try { return !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); } catch (e) { return false; }
  }
  function elementoDe(ruta) {                      // elemento visible del campo: por mapa y, si no, por comparación de textos
    est.mapa.forEach(enlazar);
    var cand = est.mapa.filter(function (x) { return x.ok && x.ruta === ruta; }).map(function (x) { return x.el; });
    if (!cand.length) {
      var h = hojaDe(ruta), todos = document.body.querySelectorAll('*');
      for (var i = 0; h && i < todos.length; i++) {
        var e = todos[i]; if (/^(SCRIPT|STYLE)$/.test(e.tagName) || e.closest('#praxia-editor-caja')) continue;
        var pr = textoPropio(e), r = pr ? buscarCampo(pr) : null;
        if (r && r.hoja.ruta === ruta) cand.push(e);
      }
    }
    for (var j = 0; j < cand.length; j++) if (visible(cand[j])) return cand[j];
    return null;
  }
  function resaltarRuta(ruta) {
    var el = elementoDe(ruta);
    if (el) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); } if (!est.elemento) { resaltar(el); clearTimeout(est.tResalte); est.tResalte = setTimeout(function () { if (!est.elemento) resaltar(null); }, 2500); } }
    emitir({ tipo: 'resaltado', ruta: ruta, encontrado: !!el });
  }

  function resolver(el, ev) {
    var viaMapa = resolverMapa(el, ev); if (viaMapa) return viaMapa;
    for (var i = 0, a = el; a && a !== document.body && i < 6; i++, a = a.parentElement) {
      if (a.closest && a.closest('#praxia-editor-caja')) return null;
      var r = null, propio = textoPropio(a);
      if (propio) r = buscarCampo(propio);
      if (!r) r = buscarExacto(a.textContent);   // contenedor: solo si su texto completo ES el campo (nunca un grupo que contiene varios textos)
      if (r && r.ambiguo && r.iguales) {      // el mismo texto está en varios campos: se elige por el orden de aparición en la página (el JSON y la página suelen seguir el mismo orden)
        var mismos = Array.prototype.filter.call(document.body.querySelectorAll('*'), function (e) { return plano(textoPropio(e)) === plano(propio); });
        var k = mismos.indexOf(a); if (k >= 0 && k < r.iguales.length) r = { hoja: r.iguales[k], tipo: 'exacto', ambiguo: mismos.length !== r.iguales.length };
      }
      if (r) return { elemento: a, hoja: r.hoja, tipo: r.tipo, ambiguo: r.ambiguo };
    }
    return null;
  }

  // ---------- resalte y cuadro de edición ----------
  function css() {
    if (document.getElementById('praxia-editor-estilo')) return;
    var s = document.createElement('style'); s.id = 'praxia-editor-estilo';
    s.textContent = '#praxia-editor-resalte{position:fixed;z-index:2147483646;pointer-events:none;border:2px dashed #00A6A0;border-radius:4px;background:rgba(0,166,160,.08);display:none}' +
      '#praxia-editor-caja{position:fixed;z-index:2147483647;background:#fff;color:#142749;border:1px solid #C8C8C8;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.25);padding:10px;font:14px/1.4 system-ui,sans-serif;display:none}' +
      '#praxia-editor-caja small{display:block;color:#5b6b85;margin-bottom:6px;word-break:break-all}' +
      '#praxia-editor-caja textarea{width:100%;box-sizing:border-box;min-height:90px;font:inherit;border:1px solid #9fb0c8;border-radius:6px;padding:8px;resize:vertical;outline:none;box-shadow:none}' +
      '#praxia-editor-caja textarea:focus{outline:none;box-shadow:none;border-color:#00665F}' +
      '#praxia-editor-caja .acciones{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}' +
      '#praxia-editor-caja button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid #00665F;background:#fff;color:#00665F;cursor:pointer}' +
      '#praxia-editor-caja button.guardar{background:#00665F;color:#fff}';
    document.head.appendChild(s);
  }
  function crearUI() {
    css();
    est.resalte = document.createElement('div'); est.resalte.id = 'praxia-editor-resalte'; document.body.appendChild(est.resalte);
    var c = document.createElement('div'); c.id = 'praxia-editor-caja'; c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Editar texto');
    c.innerHTML = '<small></small><textarea aria-label="Texto"></textarea><div class="acciones"><button type="button" class="cancelar">Cancelar</button><button type="button" class="guardar">Guardar</button></div>';
    document.body.appendChild(c); est.caja = c;
    c.querySelector('.cancelar').addEventListener('click', cerrar);
    c.querySelector('.guardar').addEventListener('click', guardar);
    c.querySelector('textarea').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardar(); }
    });
  }
  function resaltar(el) {
    if (!el) { est.resalte.style.display = 'none'; est.resalteEl = null; return; }
    est.resalteEl = el;
    var r = el.getBoundingClientRect();
    est.resalte.style.cssText = 'display:block;left:' + (r.left - 3) + 'px;top:' + (r.top - 3) + 'px;width:' + (r.width + 6) + 'px;height:' + (r.height + 6) + 'px';
  }
  function colocarCaja() {                        // el cuadro va junto al elemento elegido; se recalcula al desplazar la página
    var c = est.caja, el = est.elemento; if (!c || !el) return;
    var r = el.getBoundingClientRect(), ancho = Math.min(Math.max(r.width, 320), window.innerWidth - 16);
    c.style.width = ancho + 'px';
    c.style.left = Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)) + 'px';
    var alto = c.offsetHeight, top = r.bottom + 8; if (top + alto > window.innerHeight - 8) top = Math.max(8, r.top - alto - 8);
    c.style.top = top + 'px';
  }
  function abrir(res) {
    est.elemento = res.elemento; est.hoja = res; resaltar(res.elemento);
    var c = est.caja;
    c.querySelector('small').textContent = etiqueta(res.hoja.ruta) + (res.ambiguo ? ' (el mismo texto aparece en más de un campo)' : '');
    var ta = c.querySelector('textarea'); ta.value = leer(res.hoja.ruta);
    c.style.display = 'block'; colocarCaja(); ta.focus(); ta.select();
  }
  function alDesplazar() { if (est.elemento) { resaltar(est.elemento); colocarCaja(); } else if (est.resalteEl) resaltar(est.resalteEl); }
  function cerrar() { if (est.caja) est.caja.style.display = 'none'; est.elemento = null; est.hoja = null; resaltar(null); }

  // ---------- aplicar el cambio ----------
  function parchar(el, viejo, nuevo) {            // cambia el texto en pantalla sin recargar, solo si es seguro (un elemento con solo texto)
    try {
      if (!el || el.children.length) return false;
      if (plano(el.textContent) !== plano(viejo)) return false;
      el.textContent = String(nuevo).split(/\n{2,}/).join(' ');
      return true;
    } catch (e) { return false; }
  }
  function aplicar(ruta, valor, elemento, ambiguo) {
    var anterior = leer(ruta);
    if (typeof anterior !== 'string' || !poner(ruta, valor)) return false;
    var ents = est.mapa.filter(function (x) { return x.ruta === ruta; }), parchado = false;
    if (ents.length) { est.mapa.forEach(enlazar); parchado = ents.every(function (x) { return x.ok && parcharEntrada(x, anterior, valor); }); }
    if (!parchado && elemento && !ents.length) parchado = parchar(elemento, anterior, valor);
    var tag = document.getElementById('contenido'); if (tag) { try { tag.textContent = JSON.stringify(est.contenido); } catch (e) { /* sin etiqueta de contenido */ } }
    indexar();
    emitir({ tipo: 'campo', ruta: ruta, valor: valor, anterior: anterior, parchado: parchado, ambiguo: !!ambiguo });
    return true;
  }
  function guardar() {
    if (!est.hoja) return;
    var nuevo = est.caja.querySelector('textarea').value;
    var el = est.elemento, h = est.hoja;
    cerrar();
    if (nuevo !== leer(h.hoja.ruta)) aplicar(h.hoja.ruta, nuevo, el, h.ambiguo);
  }
  function emitir(m) { try { global.parent.postMessage(Object.assign({ fuente: FUENTE }, m), '*'); } catch (e) { /* sin padre */ } }

  // ---------- lista de campos de respaldo y cobertura ----------
  function etiqueta(ruta) {
    return ruta.replace(/\[(\d+)\]/g, function (_, n) { return ' ' + (Number(n) + 1); }).replace(/\./g, ' · ').replace(/_/g, ' ');
  }
  function listaCampos() {
    est.mapa.forEach(enlazar);
    var visibles = coberturaDom();
    return est.hojas.map(function (h) {
      var mapeado = est.mapa.some(function (x) { return x.ruta === h.ruta && x.ok; });
      return { ruta: h.ruta, etiqueta: etiqueta(h.ruta), seccion: h.ruta.split(/[.\[]/)[0], valor: leer(h.ruta), largo: palabras(h.valor) > 25, enPantalla: mapeado ? !!elementoDe(h.ruta) : !!visibles[h.ruta], mapeado: mapeado };
    });
  }
  function coberturaDom() {                      // qué campos tienen un texto equivalente en algún lugar de la página (visible u oculto)
    var vistos = {}, w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    for (var el = w.nextNode(); el; el = w.nextNode()) {
      if (el.closest('#praxia-editor-caja') || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
      var propio = textoPropio(el), r = propio ? buscarCampo(propio) : null;
      if (!r && el.children.length >= 2) r = buscarExacto(el.textContent);                       // campo de varios párrafos dentro de un contenedor
      if (r) vistos[r.hoja.ruta] = true;
    }
    return vistos;
  }

  // ---------- eventos ----------
  // Imagen principal: un <img> o un elemento con fondo cuya URL sea una de las dadas en iniciar({ imagenes: [...] }) (la guardada o la IMAGEN_EJEMPLO de la plantilla).
  function sinEsc(u) { return String(u).replace(/&amp;/g, '&'); }
  function esImagen(el) {
    if (!est.imagenes.length || !el || el.nodeType !== 1) return null;
    var u = '';
    if (el.tagName === 'IMG') u = el.currentSrc || el.src || '';
    else { try { u = getComputedStyle(el).backgroundImage || ''; } catch (e) { u = ''; } }
    if (!u || u === 'none') return null;
    for (var i = 0; i < est.imagenes.length; i++) if (u.indexOf(est.imagenes[i]) >= 0 || u.indexOf(sinEsc(est.imagenes[i])) >= 0) return est.imagenes[i];
    return null;
  }
  // Contenedor de imagen de la plantilla (aunque su <img> esté oculto por un error de carga): el clic sigue valiendo.
  function esFigura(el) {
    if (!est.imagenes.length || !el || el.nodeType !== 1 || !el.closest) return null;
    return el.closest('figure[data-imagen-ejemplo], figure.sin-imagen, figure.figura, .figura-vacia, .figura-marca') ? (el.closest('figure') || el.closest('.figura-vacia, .figura-marca')) : null;
  }
  function imagenEn(e) {
    var pila = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [e.target];
    for (var i = 0; i < pila.length; i++) {
      if (pila[i].closest && pila[i].closest('#praxia-editor-caja')) return null;
      var u = esImagen(pila[i]); if (u) return { el: pila[i], url: u };
      var f = esFigura(pila[i]); if (f) return { el: f, url: est.imagenes[0] };
    }
    return null;
  }
  // Reemplazo a nivel DOM de la imagen de ejemplo por la de la parte (independiente de cómo la plantilla arme su <img>).
  function empiezaPor(s, o) { return !!(o && s && (s.indexOf(o) === 0 || s.indexOf(sinEsc(o)) === 0)); }
  function reemplazarImagenes() {
    var n = est.imagenNueva, o = est.imagenOriginal; if (!n || !o) return;
    try {
      var ims = document.querySelectorAll('img');
      for (var i = 0; i < ims.length; i++) {
        var im = ims[i], s = im.currentSrc || im.src || im.getAttribute('src') || '';
        if (im.src === n || !(empiezaPor(s, o) || empiezaPor(im.getAttribute('src') || '', o))) continue;
        im.removeAttribute('srcset'); im.src = n; im.style.display = '';
        var f = im.closest && im.closest('figure'); if (f) { f.classList.remove('sin-imagen'); f.style.display = ''; }
      }
      var todos = document.body ? document.body.querySelectorAll('[style*="background"]') : [];
      for (var j = 0; j < todos.length; j++) {
        var b = todos[j].style.backgroundImage || '';
        if (b && (b.indexOf(o) >= 0 || b.indexOf(sinEsc(o)) >= 0)) todos[j].style.backgroundImage = 'url("' + n.replace(/"/g, '%22') + '")';
      }
      if (!document.getElementById('praxia-ocultar-marca')) { var st = document.createElement('style'); st.id = 'praxia-ocultar-marca'; st.textContent = '.figura-marca{display:none !important}'; (document.head || document.documentElement).appendChild(st); }
    } catch (e) { /* sin efecto */ }
  }
  function vigilarImagenes() {
    var correr = function () { reemplazarImagenes(); };
    correr(); [500, 2000, 6000].forEach(function (t) { setTimeout(correr, t); });
    if (global.MutationObserver && document.body) {
      var mo = new MutationObserver(correr);
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      setTimeout(function () { mo.disconnect(); }, 30000);
    }
  }
  // Oculta el rótulo «Imagen de ejemplo» de las figuras cuya imagen cargada ya no es la de ejemplo.
  function ocultarMarcas() {
    try {
      var o = est.imagenOriginal, COMUN = 'id=1oqZTfJsT6CfNgBByHyRh05cUuJKtCErR';
      var figs = document.querySelectorAll('figure');
      for (var i = 0; i < figs.length; i++) {
        var im = figs[i].querySelector('img'); if (!im) continue;
        var s = String(im.currentSrc || im.src || im.getAttribute('src') || '');
        if (!(im.complete && im.naturalWidth > 0)) continue;
        var esEj = o ? empiezaPor(s, o) : s.indexOf(COMUN) >= 0;
        if (esEj) continue;
        var ms = figs[i].querySelectorAll('.figura-marca');
        for (var j = 0; j < ms.length; j++) ms[j].style.display = 'none';
      }
    } catch (e) { /* sin efecto */ }
  }
  function vigilarMarcas() {
    var correr = function () { ocultarMarcas(); };
    correr(); [500, 2000, 6000].forEach(function (t) { setTimeout(correr, t); });
    global.addEventListener('load', correr);
    if (global.MutationObserver && document.body) {
      var mo = new MutationObserver(correr);
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      setTimeout(function () { mo.disconnect(); }, 30000);
    }
  }
  // Diagnóstico: qué imágenes de la plantilla cargaron (items vacío = la plantilla no muestra imagen).
  function reportarImagenes() {
    try {
      var items = [], vistos = [];
      var lista = document.querySelectorAll('figure img, [data-imagen-ejemplo] img');
      for (var i = 0; i < lista.length; i++) {
        var im = lista[i]; if (vistos.indexOf(im) >= 0) continue; vistos.push(im);
        var fig = im.closest && im.closest('figure');
        var ok = !!(im.complete && im.naturalWidth > 0);
        var error = !!((fig && fig.classList.contains('sin-imagen')) || (im.complete && im.naturalWidth === 0));
        var s = String(im.currentSrc || im.src || im.getAttribute('src') || '');
        items.push({ src: s.slice(0, 1000), ok: ok, error: error && !ok, esEjemplo: empiezaPor(s, est.imagenOriginal), figuras: document.querySelectorAll('figure').length });
      }
      emitir({ tipo: 'imagenes_estado', items: items, hayNueva: !!est.imagenNueva });
    } catch (e) { emitir({ tipo: 'imagenes_estado', items: [] }); }
  }
  function alMover(e) {
    if (!est.activo || est.elemento) return;
    var im = imagenEn(e);
    if (im) { resaltar(im.el); im.el.title = 'Clic para cambiar el enlace de la imagen'; document.documentElement.style.cursor = 'pointer'; return; }
    document.documentElement.style.cursor = 'text';
    var r = resolver(e.target, e); resaltar(r ? r.elemento : null);
  }
  function alClic(e) {
    if (!est.activo || (est.caja && est.caja.contains(e.target))) return;
    var im = imagenEn(e);
    if (im) { e.preventDefault(); e.stopPropagation(); emitir({ tipo: 'imagen_clic', url: im.url }); return; }
    var r = resolver(e.target, e);
    if (!r) { var t = norm(e.target && e.target.textContent).slice(0, 120); if (t) emitir({ tipo: 'sin_campo', texto: t }); return; }
    e.preventDefault(); e.stopPropagation(); abrir(r);
  }
  function alMensaje(e) {
    if (e.source !== global.parent && e.source !== global) return;
    var d = e.data; if (!d || d.fuente !== FUENTE) return;
    if (d.tipo === 'modo') modo(!!d.activo);
    else if (d.tipo === 'actualizar') { if (typeof d.ruta === 'string' && typeof d.valor === 'string') aplicar(d.ruta, d.valor, null, false); }
    else if (d.tipo === 'mapa') recibirMapa(d.entradas);
    else if (d.tipo === 'resaltar') { if (typeof d.ruta === 'string') resaltarRuta(d.ruta); }
    else if (d.tipo === 'lista') emitir({ tipo: 'lista', campos: listaCampos() });
  }
  function modo(activo) { est.activo = !!activo; if (!est.activo) cerrar(); document.documentElement.style.cursor = est.activo ? 'text' : ''; }

  function iniciar(op) {
    op = op || {};
    var c = op.contenido;
    if (!c) { try { var t = document.getElementById('contenido').textContent; c = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) { c = {}; } }
    est.contenido = JSON.parse(JSON.stringify(c)); indexar();
    est.imagenes = (op.imagenes || []).filter(function (u) { return typeof u === 'string' && u; });
    est.imagenNueva = typeof op.imagenNueva === 'string' && /^https:\/\//i.test(op.imagenNueva) ? op.imagenNueva : '';
    est.imagenOriginal = typeof op.imagenOriginal === 'string' ? op.imagenOriginal : '';
    if (!est.listo) {
      crearUI();
      if (est.imagenNueva && est.imagenOriginal) { vigilarImagenes(); if (document.readyState !== 'complete') global.addEventListener('load', reemplazarImagenes); }
      vigilarMarcas();
      document.addEventListener('mousemove', alMover, true);
      document.addEventListener('click', alClic, true);
      global.addEventListener('scroll', alDesplazar, true);
      global.addEventListener('resize', alDesplazar);
      global.addEventListener('message', alMensaje);
      est.listo = true;
      var rep = function () { reportarImagenes(); setTimeout(reportarImagenes, 2000); setTimeout(reportarImagenes, 6000); };
      if (document.readyState === 'complete') rep(); else global.addEventListener('load', rep);
    }
    modo(op.activo === true);
    emitir({ tipo: 'listo', campos: listaCampos() });
  }

  global.PraxiaEditor = {
    iniciar: iniciar, marcar: marcar, mapear: mapear, esEditable: esEditable, resaltarRuta: resaltarRuta, modo: modo, listaCampos: listaCampos, aplicar: function (r, v) { return aplicar(r, v, null, false); },
    contenido: function () { return JSON.parse(JSON.stringify(est.contenido)); },
    _cobertura: function () {
      var v = coberturaDom(), cuerpo = plano(document.body.textContent), cubiertos = {};
      est.hojas.forEach(function (h) { if (v[h.ruta]) cubiertos[h.plano] = true; });
      est.hojas.forEach(function (h) { if (!v[h.ruta] && cubiertos[h.plano]) v[h.ruta] = true; });     // texto repetido en varios campos: cuenta como cubierto
      return { total: est.hojas.length, enPantalla: est.hojas.filter(function (h) { return v[h.ruta]; }).length,
        sinAsociar: est.hojas.filter(function (h) { return !v[h.ruta]; }).map(function (h) { return h.ruta; }),
        enTextoDeLaPagina: est.hojas.filter(function (h) { return cuerpo.indexOf(h.plano) >= 0; }).length };
    },
    _resolver: resolver
  };
})(window);
