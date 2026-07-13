// Script injetado no webview do preview pra "pegar" um elemento (estilo react-grab).
// Roda DENTRO da página (via webview.executeJavaScript). Destaca no hover, captura no
// clique, monta um pacote markdown enxuto e emite via sentinela no console; o host
// (PreviewPanel) escuta `console-message`, copia pro clipboard e mostra o toast.
// Sem preload/nodeIntegration — a ponte é só o console.
//
// Filosofia (roubada do react-grab, do Aiden Bai): NÃO despejar o DOM. Apontar pra fonte.
// Em vez de outerHTML + estilos computados, reconstrói uma tag mínima + um STACK de
// componentes (`in X (at arquivo:linha:col)`) + a rota atual. O agente lê o source de lá.

export const GRAB_SENTINEL = '__LOOPCODE_GRAB__';
export const GRAB_CANCEL = '__LOOPCODE_GRAB_CANCEL__';

export const INJECT = `(() => {
  if (window.__loopcodeGrab) return;
  var ACCENT = '#f2792b';

  // Vinheta: glow inset nas bordas do viewport, na cor da seleção (igual react-grab,
  // mas brasa em vez de roxo). Sinaliza claramente que o modo "selecionar" está ligado.
  var vig = document.createElement('div');
  vig.className = '__loopcode-grab-vignette';
  vig.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;opacity:0;transition:opacity .18s ease;'
    + 'background:radial-gradient(ellipse at center, transparent 55%, '+ACCENT+'1f 100%);'
    + 'box-shadow:inset 0 0 0 2px '+ACCENT+', inset 0 0 28px 0 '+ACCENT+'66;';
  document.documentElement.appendChild(vig);
  requestAnimationFrame(function(){ vig.style.opacity = '1'; });
  // Respiração sutil pra "pulsar" e chamar atenção sem distrair.
  try {
    vig.animate([
      { boxShadow: 'inset 0 0 0 2px '+ACCENT+', inset 0 0 24px 0 '+ACCENT+'59' },
      { boxShadow: 'inset 0 0 0 2px '+ACCENT+', inset 0 0 44px 2px '+ACCENT+'b3' },
      { boxShadow: 'inset 0 0 0 2px '+ACCENT+', inset 0 0 24px 0 '+ACCENT+'59' }
    ], { duration: 2200, iterations: Infinity, easing: 'ease-in-out' });
  } catch (e) {}

  var box = document.createElement('div');
  box.className = '__loopcode-grab-box';
  box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid '+ACCENT+';background:'+ACCENT+'22;border-radius:3px;transition:all .04s ease;display:none;';
  var tag = document.createElement('div');
  tag.className = '__loopcode-grab-tag';
  tag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;font:600 11px ui-monospace,monospace;color:#fff;background:'+ACCENT+';padding:2px 6px;border-radius:4px;white-space:nowrap;display:none;';
  document.documentElement.appendChild(box);
  document.documentElement.appendChild(tag);
  var prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';

  var current = null;
  function isOurs(el){ return el && el.className && typeof el.className==='string' && el.className.indexOf('__loopcode-grab')===0; }

  // ---- helpers de texto (sem regex pra não brigar com o template literal) ----
  function squish(s){
    s = String(s==null ? '' : s);
    var o = '', sp = false, i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c===32 || c===9 || c===10 || c===13) { if (!sp && o) o += ' '; sp = true; }
      else { o += s.charAt(i); sp = false; }
    }
    return o.replace ? trimStr(o) : o;
  }
  function trimStr(s){ var a = 0, b = s.length; while (a < b && s.charCodeAt(a)===32) a++; while (b > a && s.charCodeAt(b-1)===32) b--; return s.slice(a, b); }
  function trunc(s, n){ s = String(s==null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function digits(s){ var n = 0, i, c; for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); if (c>=48 && c<=57) n++; } return n; }

  // Classe "lixo" = hash de CSS-module / styled / emotion. Conservador: só corta quando é
  // claramente gerada (mantém 'btn', 'hero', 'ml-auto', 'text-sm', 'card-header').
  function isHashy(c){
    if (!c) return true;
    if (c.indexOf('__loopcode')===0) return true;
    var low = c.toLowerCase();
    if (low.indexOf('css-')===0 || low.indexOf('sc-')===0 || low.indexOf('emotion-')===0) return true;
    if (c.length >= 6 && c.indexOf('-') < 0 && digits(c) > 0 && low === c) return true; // atomic tipo x1n2oezh
    if (digits(c) >= 4) return true;
    return false;
  }
  function goodClasses(el){
    if (!el.classList || !el.classList.length) return [];
    return [].slice.call(el.classList).filter(function(c){ return c && !isHashy(c); });
  }

  function label(el){
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else { var c = goodClasses(el)[0]; if (c) s += '.' + c; }
    return s;
  }

  function move(e){
    var el = e.target;
    if (!el || el.nodeType !== 1 || isOurs(el)) return;
    current = el;
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    tag.style.display = 'block';
    tag.textContent = label(el) + '  ' + Math.round(r.width) + 'x' + Math.round(r.height);
    var ty = r.top - 22; if (ty < 2) ty = r.top + 4;
    tag.style.left = r.left + 'px'; tag.style.top = ty + 'px';
  }

  // ---- seletor CSS (fallback, quando não tem React/source) ----
  function cssPath(el){
    var parts = [], node = el;
    for (var d = 0; node && node.nodeType === 1 && d < 5; d++) {
      var part = node.tagName.toLowerCase();
      if (node.id) { part += '#' + node.id; parts.unshift(part); break; }
      var cls = goodClasses(node).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      var parent = node.parentElement;
      if (parent) {
        var sames = [].slice.call(parent.children).filter(function(c){ return c.tagName === node.tagName; });
        if (sames.length > 1) part += ':nth-of-type(' + (sames.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // ---- tag reconstruída e mínima (só atributos úteis; class truncada; sem style; texto curto) ----
  var KEEP = ['href','src','role','name','type','value','placeholder','alt','title','for','aria-label'];
  function keepAttr(n){
    if (KEEP.indexOf(n) >= 0) return true;
    if (n.indexOf('aria-')===0) return true;
    if (n.indexOf('data-testid')===0 || n.indexOf('data-test')===0 || n.indexOf('data-cy')===0) return true;
    return false;
  }
  function directText(el){
    var s = '', i, n;
    for (i = 0; i < el.childNodes.length; i++) { n = el.childNodes[i]; if (n.nodeType === 3) s += n.textContent || ''; }
    s = squish(s);
    if (!s) s = squish(el.textContent || '');
    return trunc(s, 80);
  }
  function buildTag(el){
    var name = el.tagName.toLowerCase();
    var s = '<' + name;
    var cls = goodClasses(el);
    if (cls.length) s += ' class="' + trunc(cls.join(' '), 60) + '"';
    var attrs = el.attributes, i, a, an;
    for (i = 0; i < attrs.length; i++) {
      a = attrs[i]; an = a.name;
      if (an === 'class' || an === 'style' || an.indexOf('__loopcode')===0) continue;
      if (!keepAttr(an)) continue;
      s += a.value ? (' ' + an + '="' + trunc(a.value, 40) + '"') : (' ' + an);
    }
    var txt = directText(el);
    if (txt) return s + '>' + txt + '</' + name + '>';
    return s + ' />';
  }

  // ---- caminho do arquivo: tira prefixos de dev (webpack-internal://, rsc://React/...) e encurta ----
  function cleanFile(p){
    if (!p) return null;
    p = String(p).split('\\\\').join('/');
    var k = p.indexOf('://');
    if (k >= 0) { var rest = p.slice(k + 3); var sl = rest.indexOf('/'); p = sl >= 0 ? rest.slice(sl + 1) : rest; }
    var low = p.toLowerCase(), si = low.indexOf('/src/');
    if (si >= 0) return p.slice(si + 1);
    if (low.indexOf('src/') === 0) return p;
    var seg = p.split('/').filter(function(x){ return x; });
    return seg.length > 2 ? seg.slice(seg.length - 2).join('/') : seg.join('/');
  }

  // ---- stack de componentes via fiber (sobe o return chain, pula wrappers, dedupa) ----
  var SKIP = ['Fragment','Anonymous','Unknown','Provider','Consumer','Context','ForwardRef','Memo','Suspense','SuspenseList','StrictMode','Profiler','Router','Routes','Route','Outlet','Switch'];
  function skipName(n){
    if (!n) return true;
    if (n.charAt(0) === '_' || n.charAt(0) === '$') return true;
    if (n.indexOf('.') >= 0) return true; // motion.div, styled.button, Primitive.Slot
    return SKIP.indexOf(n) >= 0;
  }
  function fiberName(f){
    var t = f.type, n = null;
    if (typeof t === 'function') n = t.displayName || t.name;
    else if (t && typeof t === 'object') {
      n = t.displayName
        || (t.render && (t.render.displayName || t.render.name))
        || (t.type && (t.type.displayName || t.type.name));
    }
    return n || null;
  }
  function componentStack(el){
    var key = Object.keys(el).find(function(k){ return k.indexOf('__reactFiber$')===0 || k.indexOf('__reactInternalInstance$')===0; });
    if (!key) return [];
    var f = el[key], out = [], seen = '';
    for (var i = 0; i < 60 && f && out.length < 6; i++) {
      var t = f.type;
      if (typeof t === 'function' || (t && typeof t === 'object')) {
        var nm = fiberName(f);
        if (nm && !skipName(nm) && nm !== seen) {
          var src = f._debugSource || null;
          out.push({
            name: nm,
            file: src ? cleanFile(src.fileName) : null,
            line: src ? src.lineNumber : null,
            col: src ? (src.columnNumber || null) : null
          });
          seen = nm;
        }
      }
      f = f.return;
    }
    return out;
  }

  function capture(el){
    var lines = [];
    lines.push('Elemento selecionado (preview):');
    lines.push(buildTag(el));
    var stack = componentStack(el), i, c, loc;
    for (i = 0; i < stack.length; i++) {
      c = stack[i];
      loc = c.file ? (c.file + (c.line ? (':' + c.line + (c.col ? ':' + c.col : '')) : '')) : null;
      lines.push('  in ' + c.name + (loc ? (' (at ' + loc + ')') : ''));
    }
    lines.push('');
    var route = location.pathname + (location.search || '') + (location.hash || '');
    var title = squish(document.title || '');
    lines.push('Rota: ' + route + (title ? (' · "' + trunc(title, 60) + '"') : ''));
    var sel = cssPath(el);
    if (sel) lines.push('Seletor: ' + sel);
    var NL = String.fromCharCode(10);
    console.log('${GRAB_SENTINEL}' + JSON.stringify({ md: lines.join(NL) }));
  }

  // Bloqueia qualquer ação da página (navegar/clicar/submeter) enquanto o modo está ativo.
  var BLOCK = ['pointerdown','pointerup','mousedown','mouseup','dblclick','auxclick','contextmenu','submit'];
  function block(e){ if (isOurs(e.target)) return; e.preventDefault(); e.stopImmediatePropagation(); }

  // A captura acontece no clique (último evento do gesto), já com tudo bloqueado.
  function pick(e){
    if (isOurs(e.target)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var el = current || e.target;
    try { capture(el); } catch (err) { console.log('${GRAB_CANCEL}'); }
    teardown();
  }

  function onKey(e){
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); console.log('${GRAB_CANCEL}'); teardown(); }
  }

  function teardown(){
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', pick, true);
    document.removeEventListener('keydown', onKey, true);
    BLOCK.forEach(function(t){ document.removeEventListener(t, block, true); });
    document.documentElement.style.cursor = prevCursor;
    try { box.remove(); tag.remove(); vig.remove(); } catch (e) {}
    window.__loopcodeGrab = null;
  }

  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', pick, true);
  document.addEventListener('keydown', onKey, true);
  BLOCK.forEach(function(t){ document.addEventListener(t, block, true); });
  window.__loopcodeGrab = { teardown: teardown };
})();`;

export const CLEANUP = `(() => { if (window.__loopcodeGrab && window.__loopcodeGrab.teardown) window.__loopcodeGrab.teardown(); })();`;
