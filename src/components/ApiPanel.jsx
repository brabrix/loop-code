import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Loader2, Save, Code2, FileCode, Check } from 'lucide-react';
import { ConnectIcon } from './ui/connect.jsx';
import { HoverIcon } from './ui/hover-icon.jsx';
import CodeMirror from '@uiw/react-codemirror';
import { vscodeLight, vscodeDark } from '@uiw/codemirror-theme-vscode';
import { EditorView } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { xml } from '@codemirror/lang-xml';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs.jsx';
import { Input } from './ui/input.jsx';
import { Button } from './ui/button.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx';
import { ResizeBar } from './ui/resize-bar.jsx';
import { DragHandle } from './ui/drag-handle.jsx';
import { EmptyState } from './ui/empty-state.jsx';
import { useTheme } from '@/lib/theme.jsx';
import { cn } from '@/lib/utils';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// Alvos de "Copiar como" (target/client do httpsnippet — todos verificados).
const SNIPPETS = [
  { label: 'cURL', target: 'shell', client: 'curl' },
  { label: 'JavaScript — fetch', target: 'javascript', client: 'fetch' },
  { label: 'Node — fetch', target: 'node', client: 'fetch' },
  { label: 'Node — axios', target: 'node', client: 'axios' },
  { label: 'Python — requests', target: 'python', client: 'requests' },
  { label: 'Go', target: 'go', client: 'native' },
  { label: 'PHP', target: 'php', client: 'curl' },
];

const editorTheme = EditorView.theme({
  '&': { fontSize: '13px', height: '100%' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace',
    lineHeight: '1.6',
  },
});

function langForType(ct = '') {
  if (ct.includes('json')) return [json()];
  if (ct.includes('html')) return [html()];
  if (ct.includes('xml')) return [xml()];
  return [];
}

function statusColor(status) {
  if (status >= 200 && status < 300) return 'text-green-600 dark:text-green-400';
  if (status >= 300 && status < 400) return 'text-blue-600 dark:text-blue-400';
  if (status >= 400) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// Completa o esquema quando o usuário digita a URL sem ele (igual ao Postman).
// Local (localhost/IP) assume http; o resto assume https — que é o caso comum de API.
function normalizeUrl(u) {
  const t = (u || '').trim();
  if (!t) return t;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;        // já tem http:// https:// etc.
  if (t.startsWith('//')) return 'https:' + t;             // protocolo-relativo
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:|\/|$)/i.test(t)) return 'http://' + t;
  return 'https://' + t;
}

const emptyRow = () => ({ on: true, key: '', val: '' });

// Parseia um documento .http de volta para os campos da UI (1 request por arquivo).
function parseHttp(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || lines[i].startsWith('#') || lines[i].startsWith('//'))) i++;
  const reqLine = lines[i++] || 'GET ';
  const m = reqLine.match(/^([A-Z]+)\s+(.+)$/i);
  let method = 'GET';
  let rawUrl = reqLine.trim();
  if (m) { method = m[1].toUpperCase(); rawUrl = m[2].trim(); }

  const headers = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { i++; break; }
    const idx = l.indexOf(':');
    if (idx > 0) headers.push({ on: true, key: l.slice(0, idx).trim(), val: l.slice(idx + 1).trim() });
  }
  const body = lines.slice(i).join('\n').trim();

  let url = rawUrl;
  const params = [];
  const qi = rawUrl.indexOf('?');
  if (qi >= 0) {
    url = rawUrl.slice(0, qi);
    for (const pair of rawUrl.slice(qi + 1).split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const k = eq >= 0 ? pair.slice(0, eq) : pair;
      const v = eq >= 0 ? pair.slice(eq + 1) : '';
      try { params.push({ on: true, key: decodeURIComponent(k), val: decodeURIComponent(v) }); }
      catch { params.push({ on: true, key: k, val: v }); }
    }
  }
  return {
    method: METHODS.includes(method) ? method : 'GET',
    url,
    params: params.length ? params : [emptyRow()],
    headers: headers.length ? headers : [emptyRow()],
    body,
  };
}

// Editor de pares chave/valor (Headers e Query Params).
function KeyValueEditor({ rows, onChange, placeholderKey = 'Chave', placeholderVal = 'Valor' }) {
  const update = (i, field, value) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, emptyRow()]);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={r.on}
            onChange={(e) => update(i, 'on', e.target.checked)}
            title="Ativar/desativar"
            className="h-3.5 w-3.5 shrink-0 accent-primary"
          />
          <Input value={r.key} onChange={(e) => update(i, 'key', e.target.value)} placeholder={placeholderKey} spellCheck={false} className="h-7 font-mono text-xs" />
          <Input value={r.val} onChange={(e) => update(i, 'val', e.target.value)} placeholder={placeholderVal} spellCheck={false} className="h-7 font-mono text-xs" />
          <button type="button" onClick={() => remove(i)} title="Remover" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[14px]">
            <Trash2 />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="mt-0.5 flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[14px]">
        <Plus />Adicionar
      </button>
    </div>
  );
}

export function ApiPanel({ active }) {
  const { theme } = useTheme();
  const projectPath = active?.path || null;

  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [tab, setTab] = useState('params');
  const [params, setParams] = useState([emptyRow()]);
  const [headers, setHeaders] = useState([emptyRow()]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  // Coleção (.http salvos no projeto)
  const [saved, setSaved] = useState([]);
  const [currentName, setCurrentName] = useState(null);
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // "Copiar como"
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const snippetRef = useRef(null);

  // Layout redimensionável (persistido).
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('apiSidebarWidth')) || 200);
  const [configHeight, setConfigHeight] = useState(() => Number(localStorage.getItem('apiConfigHeight')) || 240);
  const [dragging, setDragging] = useState(null); // 'col' | 'row' | null
  const rootRef = useRef(null);
  const splitRef = useRef(null);

  const startSidebarResize = (e) => {
    e.preventDefault();
    const rect = rootRef.current.getBoundingClientRect();
    setDragging('col');
    const onMove = (ev) => setSidebarWidth(Math.max(150, Math.min(rect.right - ev.clientX, rect.width - 360)));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(null);
      setSidebarWidth((w) => { localStorage.setItem('apiSidebarWidth', String(Math.round(w))); return w; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startConfigResize = (e) => {
    e.preventDefault();
    const rect = splitRef.current.getBoundingClientRect();
    setDragging('row');
    const onMove = (ev) => setConfigHeight(Math.max(96, Math.min(ev.clientY - rect.top, rect.height - 140)));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(null);
      setConfigHeight((h) => { localStorage.setItem('apiConfigHeight', String(Math.round(h))); return h; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const hasBody = method !== 'GET' && method !== 'HEAD';

  const fullUrl = useMemo(() => {
    const base = normalizeUrl(url);
    const on = params.filter((p) => p.on && p.key.trim());
    if (!on.length) return base;
    const qs = on.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.val)}`).join('&');
    return base + (base.includes('?') ? '&' : '?') + qs;
  }, [url, params]);

  // Monta o objeto de request enviado ao main (send / snippet / save).
  const buildRequest = useCallback(() => {
    const headerObj = {};
    for (const h of headers) if (h.on && h.key.trim()) headerObj[h.key.trim()] = h.val;
    return { method, url: fullUrl, headers: headerObj, body: hasBody ? body : '' };
  }, [method, fullUrl, headers, body, hasBody]);

  const refreshSaved = useCallback(async () => {
    if (!projectPath) { setSaved([]); return; }
    const r = await window.api.httpListSaved(projectPath);
    setSaved(r.ok ? r.items : []);
  }, [projectPath]);

  useEffect(() => { refreshSaved(); }, [refreshSaved]);

  const send = async () => {
    if (!url.trim() || loading) return;
    // Mostra no campo a URL já com esquema (feedback visual; o envio usa fullUrl normalizado).
    const base = normalizeUrl(url);
    if (base !== url.trim()) setUrl(base);
    setLoading(true); setErr(null); setRes(null);
    try {
      const r = await window.api.httpSend(buildRequest(), projectPath || undefined);
      if (r.ok) setRes(r); else setErr(r.error || 'Falha desconhecida.');
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const onUrlKey = (e) => { if (e.key === 'Enter') send(); };

  const resetForm = () => {
    setMethod('GET'); setUrl(''); setParams([emptyRow()]); setHeaders([emptyRow()]);
    setBody(''); setRes(null); setErr(null); setCurrentName(null);
  };

  const loadSaved = async (name) => {
    const r = await window.api.httpReadSaved(projectPath, name);
    if (!r.ok) { setErr(r.error); return; }
    const p = parseHttp(r.text);
    setMethod(p.method); setUrl(p.url); setParams(p.params); setHeaders(p.headers);
    setBody(p.body); setTab('params'); setRes(null); setErr(null);
    setCurrentName(name);
  };

  const doSave = async (name) => {
    const r = await window.api.httpSaveRequest(projectPath, name, buildRequest());
    if (!r.ok) { setErr(r.error); return; }
    setCurrentName(r.name); setNaming(false); setNameDraft('');
    refreshSaved();
  };

  const onSaveClick = () => {
    if (!projectPath) return;
    if (currentName) doSave(currentName);            // já tem nome → sobrescreve
    else { setNameDraft(''); setNaming(true); }      // novo → pede nome
  };

  const deleteSaved = async (name, e) => {
    e.stopPropagation();
    const r = await window.api.httpDeleteSaved(projectPath, name);
    if (r.ok) {
      if (currentName === name) setCurrentName(null);
      refreshSaved();
    }
  };

  const copyAs = async (s) => {
    setSnippetOpen(false);
    if (!url.trim()) return;
    const r = await window.api.httpToSnippet(buildRequest(), s.target, s.client);
    if (!r.ok) { setErr(r.error); return; }
    try {
      await navigator.clipboard.writeText(r.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  // Fecha o menu de snippet ao clicar fora.
  useEffect(() => {
    if (!snippetOpen) return;
    const onDown = (e) => { if (snippetRef.current && !snippetRef.current.contains(e.target)) setSnippetOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [snippetOpen]);

  return (
    <div ref={rootRef} className="absolute inset-0 flex bg-background">
      {/* Área principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Linha de envio */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2.5">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="h-8 w-[104px] shrink-0 text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m} className="text-xs font-semibold">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={onUrlKey} placeholder="https://api.exemplo.com/recurso" spellCheck={false} className="h-8 flex-1 font-mono text-xs" />

          {/* Copiar como (dropdown) */}
          <div ref={snippetRef} className="relative shrink-0">
            <Button variant="secondary" size="sm" className="h-8" onClick={() => setSnippetOpen((o) => !o)} disabled={!url.trim()} title="Copiar como código">
              {copied ? <Check className="mr-1 text-green-500" /> : <Code2 className="mr-1" />}
              {copied ? 'Copiado!' : 'Copiar'}
            </Button>
            {snippetOpen && (
              <div className="absolute right-0 top-9 z-50 min-w-[180px] overflow-hidden rounded-md border bg-background py-1 shadow-md">
                {SNIPPETS.map((s) => (
                  <button key={s.label} type="button" onClick={() => copyAs(s)} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-muted">
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button variant="secondary" size="sm" className="h-8" onClick={onSaveClick} disabled={!projectPath || !url.trim()} title={currentName ? `Salvar "${currentName}"` : 'Salvar request'}>
            <Save className="mr-1" />Salvar
          </Button>

          <Button size="sm" className="h-8" onClick={send} disabled={loading || !url.trim()}>
            {loading ? <Loader2 className="mr-1 animate-spin" /> : <HoverIcon as={ConnectIcon} className="mr-1" />}Enviar
          </Button>
        </div>

        {/* Barra de nome (aparece ao salvar uma request nova) */}
        {naming && (
          <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-2.5 py-2">
            <span className="text-xs text-muted-foreground">Nome:</span>
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nameDraft.trim()) doSave(nameDraft.trim());
                else if (e.key === 'Escape') { setNaming(false); setNameDraft(''); }
              }}
              placeholder="ex: login-usuario"
              className="h-7 max-w-[260px] text-xs"
            />
            <Button size="sm" className="h-7" onClick={() => nameDraft.trim() && doSave(nameDraft.trim())} disabled={!nameDraft.trim()}>Salvar</Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => { setNaming(false); setNameDraft(''); }}>Cancelar</Button>
          </div>
        )}

        {/* Config + Resposta (divisor arrastável entre as duas) */}
        <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
          <div style={{ height: configHeight }} className="flex shrink-0 flex-col overflow-hidden">
            <div className="shrink-0 px-2.5 pt-2.5">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="h-8 gap-0.5 p-0.5">
                  <TabsTrigger value="params" className="h-7 px-2.5 text-xs">Params</TabsTrigger>
                  <TabsTrigger value="headers" className="h-7 px-2.5 text-xs">Headers</TabsTrigger>
                  {hasBody && <TabsTrigger value="body" className="h-7 px-2.5 text-xs">Body</TabsTrigger>}
                </TabsList>
              </Tabs>
            </div>
            <div className="min-h-0 flex-1 p-2.5">
              {tab === 'params' && <KeyValueEditor rows={params} onChange={setParams} placeholderKey="Parâmetro" placeholderVal="Valor" />}
              {tab === 'headers' && <KeyValueEditor rows={headers} onChange={setHeaders} placeholderKey="Header" placeholderVal="Valor" />}
              {tab === 'body' && hasBody && (
                <div className="h-full min-h-[120px] overflow-hidden rounded-md border">
                  <CodeMirror value={body} theme={theme === 'dark' ? vscodeDark : vscodeLight} height="100%" style={{ height: '100%' }} extensions={[editorTheme, json()]} placeholder='{ "exemplo": true }' onChange={setBody} />
                </div>
              )}
            </div>
          </div>

          <DragHandle onMouseDown={startConfigResize} />

          {/* Resposta */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-3 border-b px-3 text-xs">
              <span className="eyebrow">Resposta</span>
              {res && (
                <>
                  <span className={cn('font-semibold', statusColor(res.status))}>{res.status} {res.statusText}</span>
                  <span className="text-muted-foreground">{res.timeMs} ms</span>
                  <span className="text-muted-foreground">{fmtSize(res.sizeBytes)}</span>
                  {res.contentType && <span className="truncate text-muted-foreground">{res.contentType}</span>}
                </>
              )}
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {err ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-500">{err}</div>
              ) : res ? (
                <CodeMirror value={res.body || ''} theme={theme === 'dark' ? vscodeDark : vscodeLight} height="100%" style={{ height: '100%' }} editable={false} extensions={[editorTheme, ...langForType(res.contentType)]} />
              ) : (
                <EmptyState>{loading ? 'Enviando…' : 'Envie uma request para ver a resposta aqui.'}</EmptyState>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Divisor + Coleção de requests salvas (.http no projeto) — à direita */}
      <ResizeBar onMouseDown={startSidebarResize} />
      <div style={{ width: sidebarWidth }} className="flex shrink-0 flex-col bg-card">
        <div className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3">
          <FileCode className="size-3.5 text-primary" />
          <span className="eyebrow flex-1 truncate">Requests</span>
          <button type="button" onClick={resetForm} title="Nova request" className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[14px]">
            <Plus />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {!projectPath ? (
            <p className="px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">Abra um projeto para salvar requests.</p>
          ) : saved.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">Nenhuma request salva ainda.</p>
          ) : (
            saved.map((s) => (
              <div
                key={s.name}
                onClick={() => loadSaved(s.name)}
                className={cn(
                  'group flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-[13px] hover:bg-muted',
                  currentName === s.name && 'bg-accent'
                )}
                title={s.name}
              >
                <span className="flex-1 truncate">{s.name}</span>
                <button type="button" onClick={(e) => deleteSaved(s.name, e)} title="Excluir" className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-red-500 group-hover:opacity-100 [&_svg]:size-[13px]">
                  <Trash2 />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Captura o mouse durante o arraste (senão o editor/iframe engole o evento). */}
      {dragging && <div className={cn('fixed inset-0 z-50', dragging === 'col' ? 'cursor-col-resize' : 'cursor-row-resize')} />}
    </div>
  );
}
