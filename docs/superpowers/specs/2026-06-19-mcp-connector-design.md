# MCP Connector — Design

**Data:** 2026-06-19
**Projeto:** Carcará Code (IDE minimalista pro Claude Code)
**Status:** Aprovado (design) — aguardando revisão do spec

## Resumo

Um **MCP Inspector embutido**: uma aba "MCP" onde o usuário conecta a qualquer
servidor MCP (Model Context Protocol), inspeciona suas capacidades e **invoca tools**
de teste. É a Fase 2 do plano de conectores (Fase 1 = REST connector, já entregue).

Decisões fechadas no brainstorming:
- **Propósito:** inspector genérico, desacoplado do Claude (testar qualquer servidor MCP).
- **Transportes:** stdio (comando local) + HTTP (URL remota).
- **Lugar na UI:** aba própria "MCP" no topo, ao lado de Preview/Código/Git/API.
- **Escopo v1:** invocar tools (formulário gerado do schema) + listar/ler resources e prompts.

## Contexto e restrições

- Stack: Electron 33 (Node 20) + React 19 + Vite + Tailwind. Padrão do app:
  `ipcMain.handle` no `main.js` → `contextBridge` no `preload.js` → painel React.
- O REST connector já estabeleceu o trilho (handlers `http:*`, `ApiPanel.jsx`,
  coleção em `<projeto>/.carcara/`). O MCP segue o mesmo trilho, com uma diferença:
  conexão MCP é **stateful e longeva** (o servidor fica vivo enquanto conectado),
  então o estado fica no main, parecido com `term:*`/`preview:*`.
- Greenfield: não há nada de MCP no app hoje.

## Arquitetura

O cliente MCP vive no **main process** (precisa de Node pra subir processos stdio e
abrir sockets HTTP). O renderer só desenha e fala por IPC.

- Lib: **`@modelcontextprotocol/sdk`** (SDK oficial TypeScript). Classe `Client` +
  `StdioClientTransport` (local) e transporte HTTP (`StreamableHTTPClientTransport`,
  com fallback `SSEClientTransport` pra servidores legados).
- Estado no main: `const mcpConns = new Map()` — `connId -> { client, transport, child, info }`.
- **Uma conexão ativa por vez na v1**: conectar fecha a anterior. A lista de
  servidores salvos permite alternar. (Múltiplas conexões = fora de escopo.)
- Inicialização do cliente é assíncrona (handshake `initialize`); o `connId` só volta
  pro renderer depois do handshake ok, junto de `serverInfo` e `capabilities`.

## Superfície IPC

Handlers (todos retornam `{ ok, ... }` ou `{ ok: false, error }`, no padrão do app):

- `mcp:connect({ transport, command, args, env, url, headers })`
  → `{ connId, serverInfo: { name, version }, capabilities: { tools?, resources?, prompts? } }`
- `mcp:listTools(connId)` → `{ tools: [{ name, description, inputSchema }] }`
- `mcp:listResources(connId)` → `{ resources: [{ uri, name, mimeType, description }] }`
- `mcp:listPrompts(connId)` → `{ prompts: [{ name, description, arguments }] }`
- `mcp:callTool(connId, name, args)` → `{ content, isError }`
- `mcp:readResource(connId, uri)` → `{ contents }`
- `mcp:getPrompt(connId, name, args)` → `{ messages }`
- `mcp:disconnect(connId)` → `{ ok }`

Eventos (main → renderer, via `webContents.send`, no padrão `term:input`):
- `mcp:log` `{ connId, level, text }` — stderr/diagnóstico do servidor stdio.
- `mcp:closed` `{ connId, reason }` — queda inesperada da conexão.

Persistência (paralelo ao REST):
- `mcp:listServers(projectPath)` / `mcp:saveServer(projectPath, name, config)` /
  `mcp:readServer(projectPath, name)` / `mcp:deleteServer(projectPath, name)`
- Arquivo: **`<projeto>/.carcara/mcp-servers.json`** (mapa nome → config). Versiona junto.

## UI — `src/components/MCPPanel.jsx`

Aba "MCP" (ícone lucide `Plug` ou `Boxes`) registrada no `PreviewPanel.jsx`, **lazy**
(`React.lazy`), seguindo a regra de não pesar o boot. Reusa a identidade Carcará:
`Select`, `Input`, `Button`, `.eyebrow`, divisores arrastáveis, CodeMirror (json).

Layout (espelha o ApiPanel pra coerência):
- **Barra de conexão (topo):** Select de transporte (stdio | HTTP).
  - stdio: campos `comando`, `args`, `env` (editor chave/valor).
  - HTTP: campos `URL`, `headers` (editor chave/valor; normaliza esquema como no REST).
  - Botão **Conectar/Desconectar** + chip de status (nome/versão do servidor, ou erro).
- **Sidebar à direita:** servidores salvos (coleção), com salvar/carregar/excluir —
  mesmos componentes da sidebar do ApiPanel.
- **Centro, abas `Tools | Resources | Prompts`:**
  - **Tools:** lista (nome + descrição) → seleciona → **formulário gerado do
    `inputSchema`** → **Invocar** → resultado no CodeMirror (json).
  - **Resources:** lista (uri + nome) → **Ler** → conteúdo (texto/json/imagem).
  - **Prompts:** lista → **Obter** (com args) → mensagens renderizadas.
- Divisor arrastável entre a área de listagem/form e a de resultado (como no ApiPanel).

### Formulário a partir do JSON Schema (tools)

Gera campos a partir de `inputSchema` (JSON Schema) de cada tool:
- `string` → Input · `number`/`integer` → Input numérico · `boolean` → checkbox
- `enum` → Select · `string` com `format`/multiline grande → textarea
- `object`/`array` → editor JSON cru (CodeMirror) — **YAGNI: aninhado não vira form.**
- Marca `required` e mostra `description` de cada campo. Monta o objeto de args e
  envia em `mcp:callTool`.

## Fluxo de dados (caminho feliz)

1. Usuário escolhe transporte, preenche comando/URL, clica Conectar.
2. `mcp:connect` sobe transporte + `client.connect()` (handshake). Volta `connId` +
   capabilities. Renderer guarda `connId` e habilita as abas conforme capabilities.
3. Renderer chama `mcp:listTools/Resources/Prompts` e popula as listas.
4. Usuário seleciona uma tool, preenche o form, clica Invocar → `mcp:callTool` →
   resultado renderizado.
5. Desconectar (ou trocar de servidor) → `mcp:disconnect` fecha transporte e mata o
   processo filho.

## Erros e segurança

- **Conexão:** comando inválido / servidor que crasha → erro de `connect` + linhas de
  `mcp:log` (stderr) exibidas num rodapé de log da barra de conexão.
- **Tool:** resultado com `isError: true` é mostrado destacado (não é exceção).
- **Limpeza:** `disconnect` e fechar o app matam o processo filho (reusa `killProc`
  do main.js) e fecham transportes; sem processos órfãos.
- **Segurança:** stdio executa **comando local arbitrário** — poderoso por natureza
  (igual a um terminal). Só roda quando o usuário clica em Conectar; nada é executado
  automaticamente. `env` é mesclado ao ambiente do processo filho, não ao do app.

## Componentes (unidades e responsabilidades)

- `main.js` (seção "MCP connector"): handlers IPC + ciclo de vida das conexões + persistência.
- `preload.js`: expõe `window.api.mcp*`.
- `src/components/MCPPanel.jsx`: painel completo (conexão, abas, form, resultado, sidebar).
  Se crescer demais, extrair `McpToolForm.jsx` (gerador de form do schema) como unidade
  testável à parte.

## Dependência nova

- `@modelcontextprotocol/sdk` (requer instalação; pedirá autorização de segurança).

## Fora de escopo (v1 — YAGNI)

- OAuth / auth flow pra MCP HTTP (só headers manuais por enquanto).
- Sampling, roots, e assinatura de notifications/list-changed.
- Múltiplas conexões simultâneas.
- Import automático do `.mcp.json` do Claude (modo escolhido é genérico/desacoplado).
- Forms aninhados complexos (objeto/array = JSON cru).

## Critérios de sucesso

- Conectar num servidor MCP stdio (ex.: um `npx -y @modelcontextprotocol/server-everything`)
  e num HTTP, ver nome/versão e capabilities.
- Listar tools/resources/prompts.
- Invocar uma tool com args montados pelo form e ver o resultado.
- Desconectar sem deixar processo órfão.
- Salvar/carregar uma config de servidor da coleção.
- Boot do app não regride (painel é lazy; SDK só carrega no main quando conecta).
