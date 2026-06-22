# MCP Connector Implementation Plan

> **For agentic workers:** Implemente tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra tracking.
> **Adaptação deste projeto:** NÃO é repositório git e NÃO tem test runner. Em vez de TDD com framework, cada tarefa fecha com **verificação real**: script de smoke em Node (`node scripts/<x>.cjs`) pra lógica do main, ou `npm run build` + teste manual no app pra UI. Os "checkpoints" substituem commits (não há git). Se quiser versionar, rode `git init` antes.

**Goal:** Adicionar uma aba "MCP" que conecta a qualquer servidor MCP (stdio ou HTTP), lista tools/resources/prompts e permite invocar tools de teste.

**Architecture:** Cliente MCP roda no main process (Node) via `@modelcontextprotocol/sdk`, com conexões stateful guardadas num `Map`; o renderer (`MCPPanel.jsx`, lazy) fala por IPC, no mesmo trilho do REST connector.

**Tech Stack:** Electron 33 (Node 20), React 19, Vite, Tailwind, `@modelcontextprotocol/sdk`.

## Global Constraints

- Padrão de IPC do app: `ipcMain.handle('canal', (evt, args) => …)` no `main.js`, exposto via `contextBridge` no `preload.js`, consumido por `window.api.*`.
- Handlers retornam `{ ok: true, ... }` ou `{ ok: false, error }` (nunca lançam pro renderer).
- `@modelcontextprotocol/sdk` é **ESM-only**; `main.js` é CommonJS → usar **`await import()` dinâmico** (nunca `require()`). Isso também mantém o SDK fora do caminho de boot.
- Painéis pesados são **lazy** no `PreviewPanel.jsx` (`React.lazy(() => import('./X.jsx').then(m => ({ default: m.X })))`). Nunca importar coisa pesada no caminho do boot. Ver [[startup-performance]].
- Identidade visual: usar `Select`, `Input`, `Button`, classe `.eyebrow`, divisores (`ResizeBar`/`DragHandle`), CodeMirror (json) — tudo já existente. Acento "brasa" via tokens (`text-primary`, etc.). Ver [[visual-identity]].
- Uma conexão MCP ativa por vez (conectar fecha a anterior).
- Servidor de teste padrão pros smokes: `npx -y @modelcontextprotocol/server-everything` (tem tools/resources/prompts).
- NÃO derrubar/relançar o app rodando sem o usuário confirmar. Ver [[dont-kill-running-app]].

---

## File Structure

- `main.js` — nova seção "MCP connector": `mcpConns` Map, helpers de conexão, handlers IPC (connect/list*/call/read/getPrompt/disconnect), handlers de persistência, integração no `cleanup()`.
- `preload.js` — expõe `window.api.mcp*` e o listener de eventos (já existe `on`).
- `src/components/McpToolForm.jsx` — **Create**: gerador de formulário a partir do `inputSchema` (unidade pura/focada).
- `src/components/MCPPanel.jsx` — **Create**: o painel (barra de conexão, abas Tools/Resources/Prompts, resultado, sidebar de servidores salvos).
- `src/components/PreviewPanel.jsx` — **Modify**: registrar a aba "MCP" lazy.
- `scripts/mcp-smoke.cjs` — **Create**: smoke test de linha de comando do ciclo MCP no main (sem Electron).

---

### Task 1: Instalar SDK + ciclo de conexão no main (stdio + HTTP)

**Files:**
- Modify: `main.js` (nova seção antes de `// ---------- Preview`)
- Create: `scripts/mcp-smoke.cjs`
- Modify: `package.json` (dependência)

**Interfaces:**
- Produces (no `main.js`, escopo de módulo):
  - `mcpConns: Map<string, { client, transport, child, info }>`
  - `async function mcpConnect({ transport, command, args, env, url, headers }) -> { connId, serverInfo, capabilities }`
  - `async function mcpDisconnect(connId) -> void`
- Consumes: nada.

- [ ] **Step 1: Instalar a dependência**

Run: `npm i @modelcontextprotocol/sdk`
Expected: adiciona ao `dependencies`. (Vai pedir autorização de segurança — é o SDK oficial: github.com/modelcontextprotocol/typescript-sdk.)

- [ ] **Step 2: Escrever o smoke test (vai falhar — funções ainda não existem)**

Create `scripts/mcp-smoke.cjs`:

```js
// Smoke do ciclo MCP fora do Electron. Usa o mesmo código de conexão do main.
// Uso: node scripts/mcp-smoke.cjs            (stdio: server-everything)
//      node scripts/mcp-smoke.cjs <url>      (HTTP)
const { mcpConnect, mcpDisconnect, mcpClient } = require('../mcp-core.cjs');

async function run() {
  const url = process.argv[2];
  const cfg = url
    ? { transport: 'http', url }
    : { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] };
  const { connId, serverInfo, capabilities } = await mcpConnect(cfg);
  console.log('conectado:', serverInfo, 'caps:', Object.keys(capabilities || {}));
  const c = mcpClient(connId);
  const tools = await c.listTools();
  console.log('tools:', tools.tools.map((t) => t.name).slice(0, 8));
  await mcpDisconnect(connId);
  console.log('desconectado ok');
}
run().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
```

> Nota de design: pra o smoke reusar exatamente o código do main sem subir o Electron, extraia a lógica de conexão num módulo CommonJS puro `mcp-core.cjs` na raiz, e o `main.js` passa a requerê-lo. Isso mantém a lógica testável e fora do `main.js` (que é grande).

- [ ] **Step 3: Criar `mcp-core.cjs` (lógica de conexão, sem Electron)**

Create `mcp-core.cjs` (raiz):

```js
// Núcleo do cliente MCP — sem dependência de Electron, pra ser testável via Node.
// O SDK é ESM-only; aqui (CommonJS) usamos import() dinâmico.
const crypto = require('crypto');

const mcpConns = new Map(); // connId -> { client, transport, child, info }

function mcpClient(connId) {
  const c = mcpConns.get(connId);
  if (!c) throw new Error('Conexão MCP não encontrada: ' + connId);
  return c.client;
}

async function mcpConnect({ transport, command, args, env, url, headers }, hooks = {}) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const client = new Client({ name: 'carcara-code', version: '0.1.0' }, { capabilities: {} });

  let tp;
  if (transport === 'stdio') {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    tp = new StdioClientTransport({
      command,
      args: Array.isArray(args) ? args : [],
      env: { ...process.env, ...(env || {}) },
      stderr: 'pipe',
    });
  } else {
    // HTTP: tenta Streamable HTTP; cai pra SSE em servidores legados.
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const u = new URL(url);
    const opts = headers && Object.keys(headers).length ? { requestInit: { headers } } : undefined;
    tp = new StreamableHTTPClientTransport(u, opts);
  }

  // Encaminha stderr do servidor stdio pro hook de log (UI).
  if (transport === 'stdio' && tp.stderr && hooks.onLog) {
    tp.stderr.on('data', (b) => hooks.onLog(String(b)));
  }

  try {
    await client.connect(tp);
  } catch (e) {
    if (transport !== 'stdio') {
      // fallback SSE
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      tp = new SSEClientTransport(new URL(url), headers && Object.keys(headers).length ? { requestInit: { headers } } : undefined);
      await client.connect(tp);
    } else {
      throw e;
    }
  }

  const connId = crypto.randomUUID();
  const info = { serverInfo: client.getServerVersion(), capabilities: client.getServerCapabilities() };
  if (hooks.onClose) client.onclose = () => hooks.onClose(connId);
  mcpConns.set(connId, { client, transport: tp, info });
  return { connId, serverInfo: info.serverInfo, capabilities: info.capabilities };
}

async function mcpDisconnect(connId) {
  const c = mcpConns.get(connId);
  if (!c) return;
  try { await c.client.close(); } catch {}
  mcpConns.delete(connId);
}

function mcpDisconnectAll() {
  for (const id of [...mcpConns.keys()]) mcpDisconnect(id);
}

module.exports = { mcpConns, mcpClient, mcpConnect, mcpDisconnect, mcpDisconnectAll };
```

- [ ] **Step 4: Rodar o smoke e ver passar**

Run: `node scripts/mcp-smoke.cjs`
Expected: imprime `conectado: { name: 'example-servers/everything', ... }`, `caps: [...]`, `tools: [...]`, `desconectado ok`. (Baixa o server-everything via npx na 1ª vez.)

- [ ] **Step 5: Ligar o `mcp-core` ao `main.js` (handlers connect/disconnect)**

Em `main.js`, adicionar antes de `// ---------- Preview (dev server) ----------`:

```js
// ---------- MCP connector ----------
const mcpCore = require('./mcp-core.cjs');

ipcMain.handle('mcp:connect', async (evt, { config }) => {
  try {
    // Uma conexão ativa por vez: fecha as anteriores.
    mcpCore.mcpDisconnectAll();
    const res = await mcpCore.mcpConnect(config, {
      onLog: (text) => mainWindow?.webContents.send('mcp:log', { text }),
      onClose: (connId) => mainWindow?.webContents.send('mcp:closed', { connId }),
    });
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('mcp:disconnect', async (evt, { connId }) => {
  try { await mcpCore.mcpDisconnect(connId); return { ok: true }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});
```

E no `cleanup()` do `main.js`, adicionar `mcpCore.mcpDisconnectAll();` pra não deixar processo órfão ao fechar.

**Checkpoint:** smoke verde + `node --check main.js` ok.

---

### Task 2: Handlers de listagem (tools/resources/prompts)

**Files:**
- Modify: `main.js` (seção MCP)
- Modify: `scripts/mcp-smoke.cjs` (cobrir resources/prompts)

**Interfaces:**
- Consumes: `mcpCore.mcpClient(connId)` da Task 1.
- Produces (IPC): `mcp:listTools`, `mcp:listResources`, `mcp:listPrompts`.

- [ ] **Step 1: Estender o smoke pra resources e prompts**

Em `scripts/mcp-smoke.cjs`, antes de `mcpDisconnect`:

```js
  const resources = await c.listResources().catch(() => ({ resources: [] }));
  const prompts = await c.listPrompts().catch(() => ({ prompts: [] }));
  console.log('resources:', resources.resources.length, 'prompts:', prompts.prompts.length);
```

- [ ] **Step 2: Rodar o smoke (deve mostrar contagens)**

Run: `node scripts/mcp-smoke.cjs`
Expected: linha `resources: N prompts: M` com N e M > 0 (o server-everything tem ambos).

- [ ] **Step 3: Adicionar os handlers de listagem no `main.js`**

```js
ipcMain.handle('mcp:listTools', async (e, { connId }) => {
  try { return { ok: true, ...(await mcpCore.mcpClient(connId).listTools()) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('mcp:listResources', async (e, { connId }) => {
  try { return { ok: true, ...(await mcpCore.mcpClient(connId).listResources()) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('mcp:listPrompts', async (e, { connId }) => {
  try { return { ok: true, ...(await mcpCore.mcpClient(connId).listPrompts()) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
```

**Checkpoint:** smoke verde + `node --check main.js` ok.

---

### Task 3: Handlers de invocação (callTool/readResource/getPrompt)

**Files:**
- Modify: `main.js` (seção MCP)
- Modify: `scripts/mcp-smoke.cjs` (invocar uma tool real)

**Interfaces:**
- Consumes: `mcpCore.mcpClient(connId)`.
- Produces (IPC): `mcp:callTool`, `mcp:readResource`, `mcp:getPrompt`.

- [ ] **Step 1: Estender o smoke pra invocar a tool `echo` do server-everything**

Em `scripts/mcp-smoke.cjs`, antes de `mcpDisconnect`:

```js
  const echo = await c.callTool({ name: 'echo', arguments: { message: 'oi carcara' } });
  console.log('callTool echo:', JSON.stringify(echo.content));
```

- [ ] **Step 2: Rodar o smoke**

Run: `node scripts/mcp-smoke.cjs`
Expected: `callTool echo: [{"type":"text","text":"Echo: oi carcara"}]` (ou equivalente do server).

- [ ] **Step 3: Adicionar os handlers no `main.js`**

```js
ipcMain.handle('mcp:callTool', async (e, { connId, name, args }) => {
  try { return { ok: true, ...(await mcpCore.mcpClient(connId).callTool({ name, arguments: args || {} })) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('mcp:readResource', async (e, { connId, uri }) => {
  try { return { ok: true, ...(await mcpCore.mcpClient(connId).readResource({ uri })) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('mcp:getPrompt', async (e, { connId, name, args }) => {
  try { return { ok: true, ...(await mcpCore.mcpClient(connId).getPrompt({ name, arguments: args || {} })) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
```

**Checkpoint:** smoke verde (echo retornou) + `node --check main.js`.

---

### Task 4: Persistência dos servidores salvos

**Files:**
- Modify: `main.js` (seção MCP)

**Interfaces:**
- Produces (IPC): `mcp:listServers`, `mcp:saveServer`, `mcp:readServer`, `mcp:deleteServer`.
- Formato em disco: `<projeto>/.carcara/mcp-servers.json` = `{ [nome]: config }`, onde `config` = `{ transport, command, args, env, url, headers }`.

- [ ] **Step 1: Adicionar os handlers de persistência no `main.js`**

```js
function mcpServersFile(projectPath) { return path.join(projectPath, '.carcara', 'mcp-servers.json'); }
function readMcpServers(projectPath) {
  try { return JSON.parse(fs.readFileSync(mcpServersFile(projectPath), 'utf8')); } catch { return {}; }
}
ipcMain.handle('mcp:listServers', (e, { projectPath }) => {
  try { return { ok: true, servers: readMcpServers(projectPath) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('mcp:readServer', (e, { projectPath, name }) => {
  try { return { ok: true, config: readMcpServers(projectPath)[name] || null }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('mcp:saveServer', (e, { projectPath, name, config }) => {
  try {
    const all = readMcpServers(projectPath);
    all[name] = config;
    fs.mkdirSync(path.join(projectPath, '.carcara'), { recursive: true });
    fs.writeFileSync(mcpServersFile(projectPath), JSON.stringify(all, null, 2));
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('mcp:deleteServer', (e, { projectPath, name }) => {
  try {
    const all = readMcpServers(projectPath);
    delete all[name];
    fs.writeFileSync(mcpServersFile(projectPath), JSON.stringify(all, null, 2));
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check main.js`
Expected: sem erros.

**Checkpoint:** `node --check main.js` ok.

---

### Task 5: Expor no preload

**Files:**
- Modify: `preload.js` (após o bloco `// API connector (REST)`)

**Interfaces:**
- Consumes: handlers das Tasks 1-4.
- Produces: `window.api.mcp*`.

- [ ] **Step 1: Adicionar ao `contextBridge` no `preload.js`**

```js
  // MCP connector
  mcpConnect: (config) => ipcRenderer.invoke('mcp:connect', { config }),
  mcpDisconnect: (connId) => ipcRenderer.invoke('mcp:disconnect', { connId }),
  mcpListTools: (connId) => ipcRenderer.invoke('mcp:listTools', { connId }),
  mcpListResources: (connId) => ipcRenderer.invoke('mcp:listResources', { connId }),
  mcpListPrompts: (connId) => ipcRenderer.invoke('mcp:listPrompts', { connId }),
  mcpCallTool: (connId, name, args) => ipcRenderer.invoke('mcp:callTool', { connId, name, args }),
  mcpReadResource: (connId, uri) => ipcRenderer.invoke('mcp:readResource', { connId, uri }),
  mcpGetPrompt: (connId, name, args) => ipcRenderer.invoke('mcp:getPrompt', { connId, name, args }),
  mcpListServers: (projectPath) => ipcRenderer.invoke('mcp:listServers', { projectPath }),
  mcpReadServer: (projectPath, name) => ipcRenderer.invoke('mcp:readServer', { projectPath, name }),
  mcpSaveServer: (projectPath, name, config) => ipcRenderer.invoke('mcp:saveServer', { projectPath, name, config }),
  mcpDeleteServer: (projectPath, name) => ipcRenderer.invoke('mcp:deleteServer', { projectPath, name }),
```

(O listener de eventos `mcp:log`/`mcp:closed` usa o `window.api.on(channel, cb)` que já existe.)

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check preload.js`
Expected: sem erros.

**Checkpoint:** `node --check preload.js` ok.

---

### Task 6: Gerador de formulário a partir do JSON Schema

**Files:**
- Create: `src/components/McpToolForm.jsx`

**Interfaces:**
- Produces: `export function McpToolForm({ schema, value, onChange })` — renderiza inputs a partir de `schema` (JSON Schema do `inputSchema`), chama `onChange(novoObjeto)` a cada alteração.
- Consumes: `Input`, `Select`, `cn` existentes.

- [ ] **Step 1: Criar o componente**

```jsx
import { Input } from './ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx';

// Gera campos a partir do inputSchema (JSON Schema) de uma tool MCP.
// Tipos suportados como campo: string, number/integer, boolean, enum.
// object/array (aninhado) => editado como JSON cru no MCPPanel (não aqui). YAGNI.
export function McpToolForm({ schema, value, onChange }) {
  const props = (schema && schema.properties) || {};
  const required = (schema && schema.required) || [];
  const names = Object.keys(props);
  const set = (k, v) => onChange({ ...value, [k]: v });

  if (!names.length) {
    return <p className="text-xs text-muted-foreground">Esta tool não recebe argumentos.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {names.map((k) => {
        const p = props[k] || {};
        const isReq = required.includes(k);
        const label = (
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
            <span>{k}</span>
            {isReq && <span className="text-primary">*</span>}
            {p.description && <span className="font-normal text-muted-foreground">— {p.description}</span>}
          </label>
        );
        if (Array.isArray(p.enum)) {
          return (
            <div key={k}>
              {label}
              <Select value={value[k] ?? ''} onValueChange={(v) => set(k, v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>{p.enum.map((o) => <SelectItem key={String(o)} value={String(o)} className="text-xs">{String(o)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          );
        }
        if (p.type === 'boolean') {
          return (
            <label key={k} className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={!!value[k]} onChange={(e) => set(k, e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              <span>{k}</span>{isReq && <span className="text-primary">*</span>}
            </label>
          );
        }
        const isNum = p.type === 'number' || p.type === 'integer';
        return (
          <div key={k}>
            {label}
            <Input
              type={isNum ? 'number' : 'text'}
              value={value[k] ?? ''}
              onChange={(e) => set(k, isNum ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
              placeholder={p.type || 'string'}
              className="h-8 font-mono text-xs"
            />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build ok (o componente ainda não é usado — só valida import/sintaxe).

**Checkpoint:** `npm run build` ok.

---

### Task 7: MCPPanel — barra de conexão + registro da aba (lazy)

**Files:**
- Create: `src/components/MCPPanel.jsx`
- Modify: `src/components/PreviewPanel.jsx`

**Interfaces:**
- Consumes: `window.api.mcp*` (Task 5), `Select`/`Input`/`Button`/`.eyebrow`.
- Produces: `export function MCPPanel({ active })`.

- [ ] **Step 1: Criar `MCPPanel.jsx` com a barra de conexão e estado**

Estrutura (espelha o `ApiPanel.jsx`): `absolute inset-0 flex bg-background`, coluna principal + sidebar à direita (servidores salvos). Estado: `transport` (`'stdio'|'http'`), `command/args/env`, `url/headers`, `connId`, `serverInfo`, `status` (`'idle'|'connecting'|'connected'|'error'`), `log`, `tab` (`'tools'`), listas e `result`.

Barra de conexão (topo, `h-12 border-b px-2.5`): `Select` de transporte; se stdio → `Input` comando + `Input` args; se http → `Input` url (com `normalizeUrl` reusável); botão **Conectar/Desconectar** + chip de status. Conectar:

```jsx
const connect = async () => {
  setStatus('connecting'); setErr(null); setLog('');
  const config = transport === 'stdio'
    ? { transport, command, args: args.trim() ? args.trim().split(/\s+/) : [] }
    : { transport: 'http', url };
  const r = await window.api.mcpConnect(config);
  if (!r.ok) { setStatus('error'); setErr(r.error); return; }
  setConnId(r.connId); setServerInfo(r.serverInfo); setCaps(r.capabilities || {}); setStatus('connected');
  const t = await window.api.mcpListTools(r.connId);
  if (t.ok) setTools(t.tools || []);
};
const disconnect = async () => { if (connId) await window.api.mcpDisconnect(connId); setConnId(null); setStatus('idle'); setTools([]); setResult(null); };
```

Listener de log/queda (uma vez, `useEffect`):

```jsx
useEffect(() => {
  window.api.on('mcp:log', ({ text }) => setLog((l) => (l + text).slice(-8000)));
  window.api.on('mcp:closed', () => { setStatus('idle'); setConnId(null); });
}, []);
```

- [ ] **Step 2: Registrar a aba "MCP" lazy no `PreviewPanel.jsx`**

Adicionar ao lazy block:
```jsx
const MCPPanel = lazy(() => import('./MCPPanel.jsx').then((m) => ({ default: m.MCPPanel })));
```
Importar o ícone `Plug` de lucide (linha de imports do lucide). Adicionar `const inMcp = view === 'mcp';`. Adicionar o trigger após o de API:
```jsx
<TabsTrigger value="mcp" className="h-7 gap-1.5 px-2.5 text-[13px] [&_svg]:size-[15px]"><Plug />MCP</TabsTrigger>
```
Incluir `inMcp` no spacer: `{(inCode || inGit || inApi || inMcp) && <div className="flex-1" />}`. Renderizar:
```jsx
{inMcp && <Suspense fallback={<PanelFallback />}><MCPPanel active={active} /></Suspense>}
```

- [ ] **Step 3: Build + teste manual**

Run: `npm run build`
Expected: build ok; aba "MCP" aparece. Abrir o app, ir na aba MCP, transporte stdio, comando `npx`, args `-y @modelcontextprotocol/server-everything`, Conectar → chip mostra nome/versão do servidor; status "connected".

**Checkpoint:** conectou no app e mostrou o servidor.

---

### Task 8: Tools — lista + form + invocar + resultado

**Files:**
- Modify: `src/components/MCPPanel.jsx`

**Interfaces:**
- Consumes: `McpToolForm` (Task 6), `window.api.mcpCallTool`.

- [ ] **Step 1: Adicionar a aba/coluna Tools**

Centro com `Tabs` (`Tools | Resources | Prompts`, habilitadas conforme `caps`). Em Tools: lista à esquerda (nome + descrição, clicável); ao selecionar, mostra `McpToolForm` com o `inputSchema`; botão **Invocar**:

```jsx
const invoke = async () => {
  setResult(null); setErr(null);
  const r = await window.api.mcpCallTool(connId, selectedTool.name, toolArgs);
  if (!r.ok) { setErr(r.error); return; }
  setResult(r);
};
```

Resultado: `CodeMirror` (json, readonly) com `JSON.stringify(result.content, null, 2)`; se `result.isError`, destacar com borda/título em vermelho. Divisor `DragHandle` entre form e resultado (padrão do ApiPanel).

- [ ] **Step 2: Build + teste manual**

Run: `npm run build`
Expected: conectar no server-everything → selecionar `add` (ou `echo`) → preencher args → Invocar → ver o resultado JSON.

**Checkpoint:** invocou uma tool e viu o resultado no app.

---

### Task 9: Resources + Prompts (listar/ler/obter)

**Files:**
- Modify: `src/components/MCPPanel.jsx`

**Interfaces:**
- Consumes: `mcpListResources/readResource`, `mcpListPrompts/getPrompt`.

- [ ] **Step 1: Aba Resources**

Lista (uri + nome). Carregar ao entrar na aba: `const r = await window.api.mcpListResources(connId); setResources(r.resources)`. Ao clicar, `mcpReadResource(connId, uri)` → mostrar `contents` (texto/json no CodeMirror; se `mimeType` de imagem e `blob`, renderizar `<img>`).

- [ ] **Step 2: Aba Prompts**

Lista (nome + descrição + `arguments`). Ao selecionar, form simples a partir de `arguments` (nome/descrição/required), botão **Obter** → `mcpGetPrompt(connId, name, args)` → renderizar `messages` (role + conteúdo) numa lista legível.

- [ ] **Step 3: Build + teste manual**

Run: `npm run build`
Expected: abas Resources e Prompts listam e leem/obtêm do server-everything.

**Checkpoint:** resources e prompts funcionando no app.

---

### Task 10: Sidebar de servidores salvos + limpeza/erros

**Files:**
- Modify: `src/components/MCPPanel.jsx`

**Interfaces:**
- Consumes: `mcpListServers/saveServer/readServer/deleteServer` (Task 4).

- [ ] **Step 1: Sidebar de coleção (à direita)**

Mesma estrutura da sidebar do `ApiPanel` (eyebrow "SERVERS", lista, salvar/carregar/excluir). Salvar grava a `config` atual da barra de conexão. Carregar preenche a barra (não conecta sozinho). Desabilitado sem projeto aberto (mostra "Abra um projeto…"), igual ao REST.

- [ ] **Step 2: Rodapé de log + estados de erro**

Mostrar `log` (stderr do servidor) num rodapé colapsável da barra de conexão quando `status === 'error'` ou houver log. Erros de conexão/invocação aparecem em `err`. Botão Conectar desabilitado durante `connecting`.

- [ ] **Step 3: Build + teste manual final**

Run: `npm run build`
Expected: salvar um servidor, recarregar o app, ver na lista, carregar e conectar. Fechar o app não deixa processo do server-everything órfão (conferir no Gerenciador de Tarefas).

**Checkpoint:** ciclo completo (conectar → invocar → salvar → reconectar → fechar limpo).

---

## Self-Review

**1. Spec coverage:**
- Inspector genérico stdio+HTTP → Tasks 1, 7. ✅
- Aba própria "MCP" → Task 7. ✅
- Invocar tools (form do schema) → Tasks 6, 8. ✅
- Listar/ler resources e prompts → Tasks 3, 9. ✅
- Persistência `.carcara/mcp-servers.json` → Tasks 4, 10. ✅
- Stateful, 1 conexão por vez → Task 1 (`mcpDisconnectAll` no connect). ✅
- Erros/log + limpeza (killProc/cleanup) → Tasks 1, 10. `client.close()` encerra o transport stdio (mata o filho); reforçado no `cleanup()`. ✅
- SDK ESM via import dinâmico → Global Constraints + Task 1. ✅
- Painel lazy, boot não regride → Task 7. ✅

**2. Placeholder scan:** sem TBD/TODO; código concreto em todos os passos de código. ✅

**3. Type consistency:** `mcpConnect`/`mcpDisconnect`/`mcpClient` definidos na Task 1 e usados igual nas Tasks 2-3; IPC `mcp:*` definidos no main (1-4) e expostos com os mesmos nomes no preload (5) e consumidos no painel (7-10). `McpToolForm({ schema, value, onChange })` definido na 6 e usado na 8. ✅

> Observação de risco (anotada, não bloqueia): os caminhos de import do SDK (`/client/streamableHttp.js`, `/client/sse.js`) e a forma de passar headers (`requestInit`) devem ser confirmados contra a versão instalada no Step 1 da Task 1 (ler os `.d.ts` do pacote, como fizemos com o httpyac). Se divergirem, ajustar no `mcp-core.cjs` antes do Step 4.
