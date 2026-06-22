import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Plus, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '@/lib/theme.jsx';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable.jsx';
import {
  isPane, firstPane, allPanes, paneCount,
  applyDrop, addSessionToPane, setActiveInPane, closeSessionInTree, reconcile,
} from '@/lib/paneLayout.js';

const TERM_THEMES = {
  light: {
    background: '#ffffff',
    foreground: '#1f2430',
    cursor: '#2563eb',
    selectionBackground: '#cfe0ff',
    black: '#1f2430', brightBlack: '#6b7280',
    red: '#d12d36', brightRed: '#e5484d',
    green: '#15803d', brightGreen: '#1a9d4d',
    yellow: '#b45309', brightYellow: '#c2710c',
    blue: '#2563eb', brightBlue: '#3b82f6',
    magenta: '#7c3aed', brightMagenta: '#9333ea',
    cyan: '#0e7490', brightCyan: '#0891b2',
    white: '#1f2430', brightWhite: '#0b0e14',
  },
  dark: {
    background: '#0b0f17',
    foreground: '#e6e8ee',
    cursor: '#7c5cff',
    selectionBackground: '#33405e',
    black: '#1b1f28', brightBlack: '#5c6473',
    red: '#ff7a7a', brightRed: '#ff9a9a',
    green: '#34d399', brightGreen: '#52e0ad',
    yellow: '#ffce6b', brightYellow: '#ffd98a',
    blue: '#6ea8fe', brightBlue: '#8fc0ff',
    magenta: '#c7a6ff', brightMagenta: '#d6bcff',
    cyan: '#6be0d6', brightCyan: '#8aeae1',
    white: '#e6e8ee', brightWhite: '#ffffff',
  },
};

// Refaz o fit e só avisa o PTY quando a grade de caracteres realmente mudou.
// Resizes redundantes fazem o conpty reemitir a tela e duplicar conteúdo.
function syncSize(t, sessionId, resizeFn) {
  try {
    t.fit.fit();
    if (t.term.cols !== t.lastCols || t.term.rows !== t.lastRows) {
      t.lastCols = t.term.cols;
      t.lastRows = t.term.rows;
      resizeFn(sessionId, t.term.cols, t.term.rows);
    }
  } catch {}
}

// Layout salvo por projeto (só no renderer; estrutura + tamanhos das divisórias).
const LKEY = (p) => `paneLayout:v1:${p}`;
function loadLayout(projectPath) {
  try { const s = localStorage.getItem(LKEY(projectPath)); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveLayout(projectPath, tree) {
  try { localStorage.setItem(LKEY(projectPath), JSON.stringify(tree)); } catch {}
}

// Em que metade/canto o cursor está, a partir de coords relativas (0..1).
function computeZone(x, y) {
  const margin = 0.28;
  const d = { left: x, right: 1 - x, top: y, bottom: 1 - y };
  const min = Math.min(d.left, d.right, d.top, d.bottom);
  if (min > margin) return 'center';
  if (min === d.left) return 'left';
  if (min === d.right) return 'right';
  if (min === d.top) return 'top';
  return 'bottom';
}

const ZONE_STYLE = {
  center: { inset: 0 },
  left: { left: 0, top: 0, bottom: 0, width: '50%' },
  right: { right: 0, top: 0, bottom: 0, width: '50%' },
  top: { left: 0, right: 0, top: 0, height: '50%' },
  bottom: { left: 0, right: 0, bottom: 0, height: '50%' },
};

export function ChatPanel({ activeProject }) {
  const { terminalTheme } = useTheme();
  const themeRef = useRef(terminalTheme);
  const hostRef = useRef(null);
  const termsRef = useRef(new Map());      // sessionId -> { term, fit, el, lastCols, lastRows }
  const paneRefs = useRef(new Map());      // paneId -> elemento de conteúdo do pane

  const [sessions, setSessions] = useState([]); // todas as sessões do projeto: [{ id, name }]
  const [layout, setLayout] = useState(null);   // árvore de painéis do projeto ativo
  const layoutRef = useRef(null);
  const [focusedPane, setFocusedPane] = useState(null);

  // Estado do arrastar de abas.
  const [dragSid, setDragSid] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { paneId, zone }
  const dragRef = useRef(null);

  const projectRef = useRef(activeProject);
  projectRef.current = activeProject;

  const sessionNames = new Map(sessions.map((s) => [s.id, s.name]));
  const canClose = sessions.length > 1;

  const saveTimer = useRef(0);
  const scheduleSave = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (projectRef.current && layoutRef.current) saveLayout(projectRef.current, layoutRef.current);
    }, 300);
  };

  const commitLayout = (next) => {
    layoutRef.current = next;
    setLayout(next);
    if (projectRef.current) saveLayout(projectRef.current, next);
  };

  const refitTimer = useRef(0);
  const refitAll = () => {
    for (const [sid, te] of termsRef.current) {
      if (te.el.isConnected && te.el.style.display !== 'none') syncSize(te, sid, window.api.termResize);
    }
  };
  const scheduleRefit = () => {
    cancelAnimationFrame(refitTimer.current);
    refitTimer.current = requestAnimationFrame(refitAll);
  };

  // Troca o tema de todos os terminais já abertos quando muda claro/escuro.
  useEffect(() => {
    themeRef.current = terminalTheme;
    for (const [, t] of termsRef.current) t.term.options.theme = TERM_THEMES[terminalTheme];
    window.api.applyClaudeTheme(terminalTheme);
  }, [terminalTheme]);

  // Listeners de IPC (uma vez só) — roteados por sessionId.
  useEffect(() => {
    window.api.on('term:data', ({ sessionId, data }) => {
      const t = termsRef.current.get(sessionId);
      if (t) t.term.write(data);
    });
    window.api.on('term:exit', ({ sessionId }) => {
      const t = termsRef.current.get(sessionId);
      if (t) t.term.write('\r\n\x1b[90m[sessão encerrada]\x1b[0m\r\n');
    });
  }, []);

  // Ao trocar de projeto: carrega sessões + restaura/reconcilia o layout salvo.
  useEffect(() => {
    if (!activeProject) { setSessions([]); setLayout(null); layoutRef.current = null; setFocusedPane(null); return; }
    let cancelled = false;
    (async () => {
      let list = await window.api.sessionsList(activeProject);
      if (!list || list.length === 0) {
        const s = await window.api.sessionsCreate(activeProject);
        list = [s];
      }
      if (cancelled) return;
      setSessions(list);
      const ids = list.map((s) => s.id);
      const tree = reconcile(loadLayout(activeProject), ids, ids[0]);
      layoutRef.current = tree;
      setLayout(tree);
      saveLayout(activeProject, tree);
      setFocusedPane(firstPane(tree)?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [activeProject]);

  // Cria o terminal (xterm) de uma sessão dentro de um container de pane.
  const createTerm = (sessionId, container) => {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.padding = '8px 4px 8px 10px';
    container.appendChild(el);

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
      theme: TERM_THEMES[themeRef.current],
      cursorBlink: true,
      scrollback: 5000,
      // Texto "esmaecido" (faint/dim) que a CLI usa some no fundo branco — o xterm
      // mistura a cor com o fundo. Isto força um contraste mínimo legível sempre.
      minimumContrastRatio: 4.5,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Copiar/colar na sessão do Claude. Ctrl/Cmd+C copia a seleção quando há
    // texto selecionado; sem seleção, deixa virar SIGINT (a CLI trata). Ctrl+Shift+C
    // sempre copia e Ctrl/Cmd+V cola. Usa o clipboard do Electron via IPC.
    const paste = () => window.api.readText().then((r) => {
      if (r && r.text) window.api.termInput(sessionId, r.text);
    });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return true;
      const k = e.key.toLowerCase();
      if (k === 'c') {
        const sel = term.getSelection();
        if (sel && !e.shiftKey) { window.api.copyText(sel); term.clearSelection(); return false; }
        if (sel && e.shiftKey) { window.api.copyText(sel); return false; }
        return true; // sem seleção: Ctrl+C normal (SIGINT)
      }
      if (k === 'v') { paste(); return false; }
      return true;
    });

    term.open(el);
    // Renderizador WebGL: pinta o terminal num único canvas de GPU e repinta a
    // cada frame ao rolar, eliminando os glitches de "tinta velha". Se o contexto
    // WebGL cair, descarta o addon e volta pro DOM sozinho.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => { try { webgl.dispose(); } catch {} });
      term.loadAddon(webgl);
    } catch {}
    term.onData((d) => window.api.termInput(sessionId, d));

    const t = { term, fit, el, lastCols: 0, lastRows: 0 };
    termsRef.current.set(sessionId, t);

    // Mede só depois do layout assentar e SÓ então cria o PTY no tamanho final.
    requestAnimationFrame(() => {
      fit.fit();
      t.lastCols = term.cols;
      t.lastRows = term.rows;
      window.api.termEnsure(sessionId, projectRef.current, term.cols, term.rows, themeRef.current).then((res) => {
        if (res && res.error) term.write('\r\n\x1b[31m[' + res.error + ']\x1b[0m\r\n');
        else if (res && res.buffer) term.write(res.buffer);
      });
      term.focus();
    });
    return t;
  };

  // Posiciona cada terminal no container do seu pane e mostra só a aba ativa.
  // Reparentear (appendChild) move o nó sem destruir o xterm — a sessão segue viva.
  useEffect(() => {
    if (!activeProject || !layout) return;
    for (const p of allPanes(layout)) {
      const container = paneRefs.current.get(p.id);
      if (!container) continue;
      for (const sid of p.tabs) {
        const isActive = sid === p.active;
        let te = termsRef.current.get(sid);
        if (!te && isActive) te = createTerm(sid, container);
        if (!te) continue;
        if (te.el.parentNode !== container) container.appendChild(te.el);
        te.el.style.display = isActive ? 'block' : 'none';
      }
    }
    scheduleRefit();
  }, [layout, activeProject]);

  // Reajusta os terminais visíveis quando o painel inteiro muda de tamanho.
  useEffect(() => {
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(refitAll);
    });
    if (hostRef.current) ro.observe(hostRef.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const focusSession = (sid) => {
    const te = termsRef.current.get(sid);
    if (te) requestAnimationFrame(() => { try { te.term.focus(); } catch {} });
  };

  const addSession = async (paneId) => {
    if (!activeProject) return;
    const s = await window.api.sessionsCreate(activeProject);
    setSessions((cur) => [...cur, s]);
    commitLayout(addSessionToPane(layoutRef.current, paneId, s.id));
    setFocusedPane(paneId);
    focusSession(s.id);
  };

  const onTabClick = (paneId, sid) => {
    commitLayout(setActiveInPane(layoutRef.current, paneId, sid));
    setFocusedPane(paneId);
    focusSession(sid);
  };

  const closeSession = async (e, sessionId) => {
    e.stopPropagation();
    if (!activeProject || sessions.length <= 1) return;
    await window.api.sessionsClose(activeProject, sessionId);
    const t = termsRef.current.get(sessionId);
    if (t) { try { t.term.dispose(); } catch {} t.el.remove(); termsRef.current.delete(sessionId); }
    setSessions((cur) => cur.filter((s) => s.id !== sessionId));
    commitLayout(closeSessionInTree(layoutRef.current, sessionId));
  };

  // --- Arrastar e soltar abas ---
  const onTabDragStart = (paneId, sid, e) => {
    dragRef.current = { sid, from: paneId };
    setDragSid(sid);
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sid); } catch {}
  };
  const endDrag = () => { dragRef.current = null; setDragSid(null); setDropTarget(null); };

  const onZoneDragOver = (paneId, e) => {
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    const r = e.currentTarget.getBoundingClientRect();
    const zone = computeZone((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    setDropTarget((prev) => (prev && prev.paneId === paneId && prev.zone === zone ? prev : { paneId, zone }));
  };

  const onDrop = (paneId, zone, e) => {
    e.preventDefault();
    const d = dragRef.current;
    endDrag();
    if (!d) return;
    commitLayout(applyDrop(layoutRef.current, paneId, zone, d.sid));
    setFocusedPane(paneId);
    focusSession(d.sid);
  };

  const onSplitLayout = (node, sizes) => {
    node.sizes = sizes; // mutação direta: tamanho é "não controlado", não precisa re-render
    scheduleSave();
    scheduleRefit();
  };

  // Callback ref: registra/limpa o container de cada pane.
  const setPaneRef = (id) => (el) => {
    if (el) paneRefs.current.set(id, el);
    else paneRefs.current.delete(id);
  };

  const multi = layout ? paneCount(layout) > 1 : false;

  const renderPane = (p) => {
    const isFocused = multi && p.id === focusedPane;
    return (
      <div
        key={p.id}
        onMouseDown={() => setFocusedPane(p.id)}
        className={'flex h-full flex-col overflow-hidden ' + (isFocused ? 'ring-1 ring-inset ring-primary/40' : '')}
      >
        <div
          className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-1.5"
          onDragOver={dragSid ? (e) => { e.preventDefault(); setDropTarget({ paneId: p.id, zone: 'center' }); } : undefined}
          onDrop={dragSid ? (e) => onDrop(p.id, 'center', e) : undefined}
        >
          {p.tabs.map((sid) => {
            const isActive = sid === p.active;
            return (
              <div
                key={sid}
                draggable
                onDragStart={(e) => onTabDragStart(p.id, sid, e)}
                onDragEnd={endDrag}
                onClick={() => onTabClick(p.id, sid)}
                className={
                  'group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded px-2.5 text-[13px] transition-colors ' +
                  (isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60')
                }
              >
                <span>{sessionNames.get(sid) || 'Sessão'}</span>
                {canClose && (
                  <button
                    type="button"
                    onClick={(e) => closeSession(e, sid)}
                    title="Fechar sessão"
                    className="grid size-4 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100 [&_svg]:size-3"
                  >
                    <X />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => addSession(p.id)}
            title="Nova sessão do Claude Code"
            className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-[15px]"
          >
            <Plus />
          </button>
        </div>

        <div ref={setPaneRef(p.id)} className="relative flex-1 overflow-hidden">
          {dragSid && (
            <div
              className="absolute inset-0 z-20"
              onDragOver={(e) => onZoneDragOver(p.id, e)}
              onDrop={(e) => onDrop(p.id, dropTarget?.paneId === p.id ? dropTarget.zone : 'center', e)}
            >
              {dropTarget?.paneId === p.id && (
                <div
                  className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/20 transition-all duration-100"
                  style={ZONE_STYLE[dropTarget.zone]}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderNode = (node) => {
    if (isPane(node)) return renderPane(node);
    return (
      <ResizablePanelGroup
        key={node.id}
        direction={node.dir === 'row' ? 'horizontal' : 'vertical'}
        onLayout={(sizes) => onSplitLayout(node, sizes)}
      >
        <ResizablePanel defaultSize={node.sizes?.[0] ?? 50} minSize={15}>
          {renderNode(node.children[0])}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={node.sizes?.[1] ?? 50} minSize={15}>
          {renderNode(node.children[1])}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: terminalTheme === 'dark' ? '#0b0f17' : '#ffffff' }}>
      <div ref={hostRef} className="relative flex-1 overflow-hidden">
        {!activeProject && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-muted-foreground">
            Clique num projeto pra abrir o Claude Code aqui.
          </div>
        )}
        {activeProject && layout && renderNode(layout)}
      </div>
    </div>
  );
}
