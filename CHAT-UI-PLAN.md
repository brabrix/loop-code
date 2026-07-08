# Chat UI (assistant-ui) — mapeamento da ponte e plano additivo

Objetivo: oferecer, **como opção** (checkbox nas Configurações), um painel de chat bonito
em HTML/CSS (assistant-ui) no lugar do terminal cru do Claude Code — **sem remover** o
terminal atual. Default continua `cli`. Tudo é additivo e reversível.

## 1. Como o `claude-code-chat` (VS Code) faz a ponte CLI ↔ chat

Referência: https://github.com/andrepimenta/claude-code-chat (arquivo `src/extension.ts`).
Ele **não** embute o terminal (TUI). Sobe o Claude Code em modo headless com JSON em streaming
e desenha as mensagens no webview.

### Spawn

```
cp.spawn(executable, args, { stdio: ['pipe','pipe','pipe'], cwd, env, ... })
args = ['--output-format','stream-json', '--input-format','stream-json', '--verbose']
// condicionais:
//   '--resume', <sessionId>
//   '--model', <modelo>            (só p/ modelos Claude)
//   '--permission-mode', 'plan'    (plan mode)
//   '--dangerously-skip-permissions'  (yolo)
//   '--permission-prompt-tool', 'stdio'  (aprovação de tool via stdin/stdout)
//   '--mcp-config', <path>
```

### Entrada (renderer → processo): 1 spawn por conversa, stdin fica aberto

Cada turno do usuário é uma linha JSON no stdin:

```json
{ "type":"user", "session_id":"…", "message": { "role":"user", "content":[ … ] }, "parent_tool_use_id": null }
```

`content` é um array: texto e/ou imagens (`{type:'image', source:{type:'base64', media_type, data}}`).
stdin **só é fechado** quando chega o `result`.

### Saída (processo → renderer): stdout lido linha-a-linha como JSON

Tipos de mensagem e para onde viram evento de UI:

- `system` (subtype `init`/`status`/`compact_boundary`) → info da sessão, estado de "compactando".
- `assistant` → `text`, `thinking`, `tool_use` (+ contagem de tokens).
- `user` → `tool_result` (resultado das ferramentas).
- `result` (subtype `success`) → custo/duração final; **fecha o turno**.

### Sessão

- ID vem do `result.session_id` (e também do `system/init`). Guarda em `_currentSessionId`.
- Resume = `--resume <id>` no próximo spawn.

### Permissões

- `--permission-prompt-tool stdio`: o CLI manda `control_request` (subtype `can_use_tool`)
  pelo stdout; a extensão checa um `permissions.json` local (pré-aprovados) e responde
  pelo stdin (`{...}\n`). Yolo = `--dangerously-skip-permissions`.

### Imagens

- Regex acha caminhos de imagem no texto + anexos explícitos → lê o arquivo, base64,
  entra como `{type:'image'}` no `content`.

## 2. Como o Carcará conecta ao CLI hoje (o que NÃO muda)

- **Terminal real** (xterm): `src/components/ChatPanel.jsx`. IPC `term:*`.
  - `term:ensure` (`main.js:2341`) sobe um **node-pty** com o shell do SO (`platform.cjs`),
    `cleanEnv()` tira `ANTHROPIC_API_KEY`/`AUTH_TOKEN`/`ELECTRON_RUN_AS_NODE` (força assinatura),
    e **escreve `claude`** (ou `claude --resume <id>`) no shell — `buildLaunchCommand` (`main.js:615`).
  - Entrada: `term:input` (bracketed paste manual em `pasteIntoSession`). Saída: `term:data`.
- **Sessões**: `cfg.sessions[projectPath]` no `config.json`. ID real capturado por snapshot do
  transcript em `~/.claude/projects/**.jsonl` — `claude-sessions.cjs` + `startClaudeWatcher`
  (`main.js:675`). Título via `aiTitle` do transcript.
- **Config**: `config.json` em `userData` (sem electron-store). `loadConfig`/`saveConfig`
  (`main.js:94/114`). Padrão de toggle global: `notify:get/set`, `layout:get/set` +
  `src/lib/layoutContext.jsx` (espelho localStorage + config.json como verdade).
- **Composição**: `src/App.jsx` monta `<ChatPanel>` no painel `chat` (`App.jsx:733`).
- **Build**: Vite `src/` → `dist/` (renderer). `main.js`/`*.cjs` são CommonJS, rodam direto.

## 3. Decisão de arquitetura da ponte (Fase 2)

**A) Spawn cru do `claude` com stream-json** (igual claude-code-chat).

- Prós: zero dep de runtime nova; auth de assinatura idêntica ao terminal atual (`cleanEnv`);
  reaproveita `claude-sessions.cjs`/watcher; controle total das flags; mesmo estilo do `term:ensure`.
- Contras: você mantém o parser de stream-json e o protocolo de permissão na mão.

**B) `@anthropic-ai/claude-agent-sdk` (SDK TS oficial)** que embrulha o mesmo CLI.

- Prós: API limpa (async iterator de mensagens), permissões/sessão já tratadas.
- Contras: +1 dep no main; menos controle das flags; precisa confirmar que usa **assinatura**
  (usa — embrulha o CLI), mas é uma camada a mais pra validar no Electron.

**Recomendação: A.** É DRY com o que já existe (mesmo padrão do `term:ensure` + `cleanEnv` +
`claude-sessions.cjs`), não arrisca a regra "assinatura, nunca API", e o claude-code-chat já
provou o protocolo. O SDK vira útil só se o parser manual virar fardo.

## 4. Plano additivo (fases)

- **Fase 1 (FEITA): infra do toggle.** Additiva, reversível, não mexe no terminal.
  - `chatMode` no `config.json` (`cli` default | `chat`). Handlers `chatMode:get/set` no `main.js`.
  - `preload.js`: `getChatMode`/`setChatMode`.
  - `src/lib/chatModeContext.jsx` (espelha `layoutContext`: localStorage + config.json).
  - Provider em `src/main.jsx`. Switch nas Configurações (aba IA).
  - `App.jsx`: monta `<AssistantChat>` quando `chatMode==='chat'`, senão `<ChatPanel>` (padrão).
- **Fase 2 (FEITA): ponte real (main) + chat funcional.** Decisão **A** (spawn cru).
  - `chat-cli.cjs` (puro/testável): `buildChatArgs` (`-p --input-format stream-json
--output-format stream-json --verbose [--resume]`), `buildUserMessage`, `normalizeStreamEvent`.
    Smoke: `node scripts/chat-cli-smoke.cjs` (21 asserts).
  - `main.js`: `chat:start`/`chat:send`/`chat:abort`/`chat:close` + push `chat:event`. Um processo
    por sessão (`chatProcs`), stdin aberto p/ vários turnos, `chatResumeIds` guarda o id real p/
    `--resume` se o processo morrer. Reusa `cleanEnv()` (assinatura) e `killProc`.
  - `preload.js`: `chatStart`/`chatSend`/`chatAbort`/`chatClose`.
  - `src/components/AssistantChat.jsx`: chat funcional em React puro (timeline com bolhas,
    thinking, tool_use/tool_result, composer). Uma sessão por projeto (`chat-<path>`).
- **Fase 3 (FEITA): assistant-ui no renderer.** `@assistant-ui/react@0.14.26` instalado.
  - `AssistantChat.jsx` reescrito com `useExternalStoreRuntime` (streaming, threading, cancelar,
    auto-scroll vêm do runtime) + `AssistantRuntimeProvider` + primitives
    (`ThreadPrimitive`/`MessagePrimitive`/`ComposerPrimitive`), estilizados com o Tailwind do
    app — **sem** a config/CSS gerada pela CLI do assistant-ui (o pedaço arriscado às cegas).
  - Modelo interno `{id, role, parts}` → `convertMessage` p/ `ThreadMessageLike`
    (text/reasoning/tool-call). `tool_result` casa no `tool_use` pelo `toolCallId`.
  - Componentes por role (`UserMessage`/`AssistantMessage`/`SystemMessage`) e por part
    (`Text`/`Reasoning`/`tools.Fallback`). `ComposerPrimitive.Send`/`Cancel` ligados a
    `onNew`/`onCancel` → `chatSend`/`chatAbort`.
  - **NÃO** usei `@assistant-ui/react-markdown` (instalou quebrado, `dist` faltando; removido).
- **Fase 3.1 (a fazer): markdown + código.** Texto do assistant hoje é plain (`whitespace-pre-wrap`).
  Trazer markdown estilizado (bloco de código, listas, etc.) — reinstalar `react-markdown` do
  assistant-ui OU um `Text` custom com `react-markdown` + realce. Testar em runtime antes.
- **Fase 4 (a fazer): paridade.** Permissões (`control_request` via `--permission-prompt-tool`),
  imagens (base64 no `content`), persistir `claudeId` no `config.json` (resume entre sessões do
  app), título via aiTitle, integração fina com Tasks/paleta.

### Onde a IA de cada fase

- Fases 1–3 (feitas): tocadas direto.
- Fase 3.1/4 (markdown, permissões, imagens): fricção de UI/estado → **Opus**, e idealmente
  com o app rodando pra iterar visual.

### ⚠️ Ainda não testado em runtime

O build compila e o lint passa, mas o fluxo ponta-a-ponta (mandar msg → resposta streamando →
tool calls) **não** foi exercitado com o app aberto. Testar pelos passos da seção 5.

## 6. Correção: multi-sessão + outras IAs (o desenho certo)

**Erro da 1ª versão:** o toggle trocava o `ChatPanel` INTEIRO por um `AssistantChat` de
sessão única — perdia abas/múltiplas sessões, seletor de IA por sessão e layout dividido.
Isso não é aditivo.

**Desenho certo (implementado):** o `AssistantChat` virou o **miolo de UMA sessão** e mora
DENTRO do `ChatPanel`. O `ChatPanel` continua dono de tudo (abas, `AiPicker`, layout, nomes,
atividade). No container de cada pane, quando `isChatSession(p.active)` — modo `chat` E
`session.cli === 'claude'` — renderiza um overlay `<AssistantChat sessionId projectPath/>`
por cima; o xterm daquela sessão fica escondido (não morre). Chaves:

- `ChatPanel`: `useChatMode()` + helper `isChatSession(sid)`. O efeito que monta os xterm
  pula/esconde o terminal das sessões em chat (deps ganharam `chatMode`). O overlay entra
  logo após o `AiPicker` no `renderPane`.
- `AssistantChat({ sessionId, projectPath })`: usa a `sessionId` REAL da aba (não mais
  `chat-<project>`), então cada aba tem seu próprio processo de chat na ponte.
- `App.jsx`: revertido — volta a sempre montar `<ChatPanel>`.

**Outras IAs (por que "trocar de IA" não funciona no chat):** a ponte fala o protocolo do
**Claude Code** (`claude -p` stream-json). Codex, OpenCode, Agy/custom têm CADA um seu
próprio modo máquina (args e formato de saída diferentes) — não é o mesmo stream-json. Então:

- Sessão com IA = `claude` → renderiza como chat bonito.
- Sessão com outra IA → cai no **terminal** (funciona pra qualquer CLI, como sempre).
- Suporte a chat pras outras exige um **adapter por CLI** (Fase 5): uma função que monta os
  args e um parser de saída, no mesmo formato de evento (`chat-cli.cjs` vira uma tabela de
  adapters por `cli`). Trabalho por-IA, feito uma de cada vez.

## 7. Multi-IA: chat para Claude, Codex e Antigravity (Fase 5 — feita)

Cada CLI tem um modo headless MUITO diferente. A ponte virou **adapters por CLI**
(`chat-cli.cjs` → `ADAPTERS`/`getAdapter`), com dois modelos de execução no `main.js`:

| IA                | Comando                                                               | Modelo                                     | Saída                                              |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| **claude**        | `claude -p --input/output-format stream-json --verbose [--resume id]` | **persistente** (1 processo, stdin aberto) | stream-json (rico: texto/thinking/tool)            |
| **codex**         | `codex exec [resume <thread_id>] --json <prompt>`                     | **por-turno** (1 processo/msg)             | JSONL (`thread.started`/`item.*`/`turn.completed`) |
| **agy**           | `agy [-p\|--continue -p] <prompt>`                                    | **por-turno**                              | **texto puro** (sem JSON → sem tool calls)         |
| opencode / custom | —                                                                     | —                                          | sem adapter → **cai no terminal**                  |

- `main.js`: `spawnPersistentChat` (claude) + `runChatTurn` (codex/agy). `chatResumeIds`
  guarda o id de retomada (claude `session_id` / codex `thread_id`); `chatSeen` marca sessões
  com histórico (agy usa `--continue`). `chat:send` recebe o `cli` e escolhe o adapter.
- `preload.js`: `chatSend(sessionId, projectPath, text, cli, images)`.
- `ChatPanel`: `CHAT_CLIS = ['claude','codex','agy']`; `isChatSession(sid)` = modo chat E a
  IA da sessão está nesse conjunto. Passa `cli={cliOf(p.active)}` pro `AssistantChat`.
- `AssistantChat`: rótulos vêm do `OPT[cli].label` (não mais fixo "Claude").
- Smoke: `node scripts/chat-cli-smoke.cjs` (38 asserts, cobre os 3 adapters).

**Bugs corrigidos com isso:**

- "Nova sessão abre o CLI mesmo no chat": era porque só `claude` tinha chat. Agora
  codex/agy também → a nova sessão (que herda a IA do projeto) abre chat.
- "Projeto de outra IA mostra chat do Claude": a decisão agora segue o `cli` REAL da sessão
  (que segue a IA do projeto pras sessões novas), com o adapter certo.

**Limites honestos:**

- **agy é texto-só** (a CLI não expõe JSON): sem visualizar tool calls/reasoning, só a resposta.
- **codex/agy são por-turno**: sem streaming incremental dentro do turno como o claude tem
  (o texto chega quando o item completa). Funciona, mas a sensação é menos "ao vivo".
- **Sessões antigas** guardam o `cli` de quando foram criadas. Uma sessão que era `claude`
  continua `claude` mesmo se o projeto virou agy — troque a IA da sessão (ou abra uma nova).
- **Ainda não testado em runtime** com codex/agy reais (build + smoke passam; falta exercitar).

## 5. Como testar

1. Reabrir o app (carrega de `dist/`; o build já rodou).
2. Configurações → aba IA → ligar **"Chat em vez do terminal (beta)"**.
3. Abrir um projeto e mandar uma mensagem. Deve responder usando a assinatura (sem API).
4. Voltar: desligar o toggle (ou botão "Voltar ao terminal") → volta o terminal intacto.
