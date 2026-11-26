/* Editor de textos por clic para las plantillas HTML de Praxia (módulo autónomo, sin dependencias).
 *
 * Se inyecta DENTRO de la página de la plantilla ya pintada (iframe srcdoc propio de Praxia). Con el modo de edición activo, al hacer clic en un texto
 * que viene del JSON de contenido se abre un cuadro para editarlo; al guardar avisa a la página padre por postMessage. No modifica la plantilla:
 * solo asocia lo que se ve con el campo del JSON comparando textos (igualdad y contención, sin tildes ni mayúsculas ni signos).
 *
 * Uso (dentro del iframe, después de pintar la plantilla):
 *   PraxiaEditor.iniciar({ contenido: <objeto JSON final>, activo: false });   // activo: modo de edición al arrancar
 *
 * Mensajes del iframe al padre (event.data), todos con fuente: 'praxia-editor':
 *   { tipo: 'listo', campos: [...] }                                   al iniciar (lista de respaldo, ver listaCampos)
 *   { tipo: 'campo', ruta, valor, anterior, parchado, ambiguo }        el usuario guardó un texto (parchado: ya se cambió en pantalla; si es false, recargar con el JSON nuevo)
 *   { tipo: 'sin_campo', texto }                                       clic en un texto que no se pudo asociar a un campo
 *   { tipo: 'lista', campos: [...] }                                   respuesta a { tipo: 'lista' }
 * Mensajes del padre al iframe (event.source debe ser window.parent):
 *   { fuente: 'praxia-editor', tipo: 'modo', activo: true|false }
 *   { fuente: 'praxia-editor', tipo: 'actualizar', ruta, valor }       cambia un campo (por ejemplo desde un formulario de respaldo)
 *   { fuente: 'praxia-editor', tipo: 'lista' }                         pide la lista de campos
 */
(function (global) {
  'use strict';
  var FUENTE = 'praxia-editor';
  // Campos que no son texto editable (valores cerrados, nombres de ícono, datos internos).
  var NO_EDITABLES = /(^|\.)(icono|encabezado|tipo|id|codigo|variante|plantilla|nombre_plantilla|altura|nivel)$/;
  var est = { imagenes: [], contenido: {}, hojas: [], activo: false, elemento: null, hoja: null, resalte: null, caja: null, listo: false };

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function plano(s) { return norm(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function palabras(s) { return norm(s).split(' ').filter(Boolean).length; }

  // ---------- hojas de texto del JSON ----------
  function recoger(v, ruta, salida) {
    if (typeof v === 'string') {
      if (!NO_EDITABLES.test(ruta) && !/^np_[0-9]+$/.test(v) && norm(v).length >= 2) salida.push({ ruta: ruta, valor: v, plano: plano(v) });
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
  function resolver(el) {
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
    var parchado = elemento ? parchar(elemento, anterior, valor) : false;
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
    var visibles = coberturaDom();
    return est.hojas.map(function (h) {
      return { ruta: h.ruta, etiqueta: etiqueta(h.ruta), valor: leer(h.ruta), largo: palabras(h.valor) > 25, enPantalla: !!visibles[h.ruta] };
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
  function imagenEn(e) {
    var pila = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [e.target];
    for (var i = 0; i < pila.length; i++) {
      if (pila[i].closest && pila[i].closest('#praxia-editor-caja')) return null;
      var u = esImagen(pila[i]); if (u) return { el: pila[i], url: u };
    }
    return null;
  }
  function alMover(e) {
    if (!est.activo || est.elemento) return;
    var im = imagenEn(e);
    if (im) { resaltar(im.el); im.el.title = 'Clic para cambiar el enlace de la imagen'; document.documentElement.style.cursor = 'pointer'; return; }
    document.documentElement.style.cursor = 'text';
    var r = resolver(e.target); resaltar(r ? r.elemento : null);
  }
  function alClic(e) {
    if (!est.activo || (est.caja && est.caja.contains(e.target))) return;
    var im = imagenEn(e);
    if (im) { e.preventDefault(); e.stopPropagation(); emitir({ tipo: 'imagen_clic', url: im.url }); return; }
    var r = resolver(e.target);
    if (!r) { var t = norm(e.target && e.target.textContent).slice(0, 120); if (t) emitir({ tipo: 'sin_campo', texto: t }); return; }
    e.preventDefault(); e.stopPropagation(); abrir(r);
  }
  function alMensaje(e) {
    if (e.source !== global.parent && e.source !== global) return;
    var d = e.data; if (!d || d.fuente !== FUENTE) return;
    if (d.tipo === 'modo') modo(!!d.activo);
    else if (d.tipo === 'actualizar') { if (typeof d.ruta === 'string' && typeof d.valor === 'string') aplicar(d.ruta, d.valor, null, false); }
    else if (d.tipo === 'lista') emitir({ tipo: 'lista', campos: listaCampos() });
  }
  function modo(activo) { est.activo = !!activo; if (!est.activo) cerrar(); document.documentElement.style.cursor = est.activo ? 'text' : ''; }

  function iniciar(op) {
    op = op || {};
    var c = op.contenido;
    if (!c) { try { var t = document.getElementById('contenido').textContent; c = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) { c = {}; } }
    est.contenido = JSON.parse(JSON.stringify(c)); indexar();
    est.imagenes = (op.imagenes || []).filter(function (u) { return typeof u === 'string' && u; });
    if (!est.listo) {
      crearUI();
      document.addEventListener('mousemove', alMover, true);
      document.addEventListener('click', alClic, true);
      global.addEventListener('scroll', alDesplazar, true);
      global.addEventListener('resize', alDesplazar);
      global.addEventListener('message', alMensaje);
      est.listo = true;
    }
    modo(op.activo === true);
    emitir({ tipo: 'listo', campos: listaCampos() });
  }

  global.PraxiaEditor = {
    iniciar: iniciar, modo: modo, listaCampos: listaCampos, aplicar: function (r, v) { return aplicar(r, v, null, false); },
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
