# Loop Code — Avaliação Técnica do Fork

> Data: 2026-07-12 · Base: fork do Carcará Code v0.1.8 (commit `edbeaba`)
> Ambiente de validação: macOS (Darwin 25), Node v26.4.0, npm 11.17.0

## 1. Resumo executivo

O Loop Code nasce como fork do **Carcará Code**, uma IDE desktop minimalista em
Electron voltada a conversar com CLIs de IA (Claude Code, Codex, OpenCode,
Antigravity) com preview embutido. O código está **saudável**: instala, linta,
testa (163 testes) e builda sem erros. A arquitetura é um monólito pragmático —
`main.js` com ~3.900 linhas concentra quase toda a lógica do processo main, mas
os módulos mais novos (em `electron/`) seguem um padrão limpo de "lógica pura
testável + efeitos no main", que é exatamente o padrão a seguir para o motor de
Coding Loops.

O projeto já possui, prontos para reaproveitamento direto: multi-CLI de IA por
projeto/sessão, ponte headless com o Claude Code (`stream-json`), terminal PTY,
integração Git completa (simple-git), **checkpoints via shadow git** (base ideal
para o `CheckpointManager` do loop), cliente MCP, preview com detecção de porta
e execução de comandos por projeto.

Os maiores riscos do fork são: (1) o **auto-updater aponta para o repositório
original** (`Yg0rAndrade/carcara-code`) — um pacote publicado sem corrigir isso
se "des-forkaria" sozinho na primeira atualização; (2) mudar `appId`/`name`
muda o diretório `userData`, perdendo config de usuários existentes se não
houver migração; (3) o chat roda por padrão em `bypassPermissions`, aceitável
para o produto atual, mas que precisa virar política configurável quando o
Loop Runner executar de forma autônoma.

## 2. Stack encontrada

| Camada        | Tecnologia                                                                 | Versão                                          |
| ------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| Desktop       | Electron                                                                   | ^33.2.0 (instalado 33.4.11)                     |
| UI            | React                                                                      | 19                                              |
| Bundler       | Vite                                                                       | 8 (`vite.config.mjs`, base `./`, saída `dist/`) |
| Estilo        | Tailwind CSS 3 + tokens CSS custom (temas claro/escuro)                    | 3.4                                             |
| Editor        | CodeMirror 6 (`@uiw/react-codemirror`, ~15 linguagens)                     | 6.x                                             |
| Terminal      | `@xterm/xterm` 6 + `node-pty` 1.1 (addon WebGL)                            | —                                               |
| Git           | `simple-git`                                                               | 3.36                                            |
| SSH remoto    | `ssh2` (JS puro)                                                           | 1.17                                            |
| MCP           | `@modelcontextprotocol/sdk`                                                | 1.29                                            |
| REST client   | `httpyac` + `httpsnippet`                                                  | —                                               |
| Updates       | `electron-updater` (feed GitHub Releases)                                  | 6.8                                             |
| Empacotamento | `electron-builder` (NSIS, AppImage, DMG x64+arm64)                         | 26                                              |
| Testes        | Vitest 4 + scripts de smoke (`scripts/*.cjs`)                              | —                                               |
| Lint/format   | ESLint 9 flat config + Prettier + husky/lint-staged                        | —                                               |
| Linguagem     | **JavaScript puro** (JSX + CJS; sem TypeScript; `jsconfig` com alias `@/`) | —                                               |
| Pacotes       | **npm** (`package-lock.json`)                                              | —                                               |
| i18n          | pt/en em `src/lib/locales/*.json` + `electron/main.i18n.cjs` (main)        | —                                               |

## 3. Arquitetura atual

```text
loop-code/
├── main.js            # processo main (~3.900 linhas, monólito)
├── preload.js         # contextBridge → window.api (~140 métodos)
├── index.html         # splash + mount do renderer
├── electron/          # módulos do main (padrão: lógica pura .cjs testável)
│   ├── ai-cli.cjs         # multi-CLI de IA (claude/codex/opencode/agy/custom)
│   ├── chat-cli.cjs       # ponte headless claude -p --output-format stream-json
│   ├── claude-sessions.cjs / claude-todos-core.cjs
│   ├── mcp-core.cjs / mcp-oauth.cjs
│   ├── platform.cjs       # tabela canônica de diferenças de SO
│   ├── updater.cjs / php-runtime.cjs / rail-core.cjs / media-core.cjs / csv-core.cjs
│   └── remote/            # SSH: sshShell, remoteFs, secretStore, knownHosts, localPty…
├── src/               # renderer React (JSX)
│   ├── App.jsx            # shell de layout (rail + chat + preview/código)
│   ├── components/        # painéis: Chat, Preview, CodeView, Git, MCP, API, Checkpoints…
│   └── lib/               # i18n, temas, layout, helpers puros (com .test.js ao lado)
├── scripts/           # smokes standalone (i18n, platform, csv, php, rail, mcp…)
├── build/             # ícones do instalador
└── .github/workflows/ # ci.yml + build-{windows,linux,mac}.yml
```

### Processos e comunicação

- **Main** (`main.js`): janela única (`contextIsolation: true`,
  `nodeIntegration: false`, `webviewTag: true`), config em
  `userData/config.json`, 128 registros `ipcMain.handle/on` em namespaces
  claros: `projects:*`, `sessions:*`, `term:*`, `shell:*`, `chat:*`, `git:*`,
  `fs:*`, `http:*`, `mcp:*`, `checkpoint:*`, `preview:*`, `update:*`,
  `remotes:*`, `lang:*`.
- **Preload** (`preload.js`): expõe `window.api` 1-para-1 com os canais IPC +
  um `on(channel, cb)` genérico com cleanup. Superfície grande porém uniforme.
- **Renderer**: React com estado local + contexts (tema, layout, i18n,
  chatMode). Sem Redux/Zustand. Painéis desmontáveis; layout com
  `react-resizable-panels`.

### Subsistemas relevantes para o Loop Code

| Subsistema           | Onde                                                                                                               | Estado                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Multi-CLI de IA      | `electron/ai-cli.cjs` + `term:ensure`                                                                              | Pronto: escolha por projeto e por sessão, resume por CLI           |
| Chat headless        | `electron/chat-cli.cjs` + `chat:*`                                                                                 | Pronto: `claude -p` com `stream-json` bidirecional, imagens, abort |
| Terminal PTY         | `term:*`/`shell:*` + `node-pty` (local) e `ssh2` (remoto)                                                          | Pronto, com buffer e resize                                        |
| Git                  | `git:*` via simple-git                                                                                             | Status/diff/stage/commit/push/pull/branch/checkout/init            |
| Checkpoints          | `checkpoint:*` — shadow repo em `userData/checkpoints/<sha1>.git` com `GIT_WORK_TREE` no projeto, lock por projeto | **Base ideal do CheckpointManager**                                |
| Preview              | `preview:*` — spawna script dev, detecta porta pela saída, webview                                                 | Pronto (inclui runtime PHP no Windows)                             |
| Execução de comandos | spawn com PATH resolvido (`fix-path`/platform.cjs)                                                                 | Pronto                                                             |
| MCP                  | `mcp:*` (client completo + OAuth)                                                                                  | Pronto — futuro canal Brabrix                                      |
| Persistência         | `userData/config.json` + `<projeto>/.carcara/` (prompts, mcp-servers, requests)                                    | Simples, sem schema/versão                                         |
| Updates              | `electron/updater.cjs` + GitHub Releases                                                                           | Funciona, **feed aponta pro repo original**                        |

## 4. Pontos positivos

1. **Padrão "core puro + efeitos no main"**: módulos em `electron/*.cjs` sem
   Electron/fs, testados por unidade ou smoke — modelo pronto para
   `loop-core.cjs`.
2. **Multi-agente já abstraído** em `ai-cli.cjs` (o embrião do AgentAdapter).
3. **Chat headless via `stream-json`**: exatamente o transporte que um
   LoopRunner precisa para dirigir o Claude Code programaticamente.
4. **Checkpoints com shadow git** sem sujar o repo do usuário, com lock por
   projeto — rollback entre iterações do loop de graça.
5. **Disciplina de plataforma** (`platform.cjs`) e **de i18n** (paridade
   pt/en com smoke test).
6. Segurança básica do Electron correta (`contextIsolation`, sem
   `nodeIntegration`), segredos SSH via `safeStorage`, TOFU de host keys.
7. CI existente (lint + testes + builds por SO em tags `v*`).

## 5. Débitos técnicos

1. **`main.js` monolítico** (~3.900 linhas): os handlers convivem com regras de
   negócio; extrair por domínio é pré-requisito para o motor de loops.
2. **Sem TypeScript**: contratos entre main/preload/renderer são implícitos.
   Adotar TS gradualmente (ou `.d.ts` + JSDoc) nos módulos novos.
3. **Persistência sem versão/schema**: `config.json` cresce por acreção com
   migrações ad-hoc inline (`loadConfig`).
4. Bundle do renderer de 4,3 MB **sem minificação de propósito** (workaround de
   bug do minificador documentado em `vite.config.mjs`) — aceitável em desktop,
   mas revisar no Vite 8.
5. Sem testes de integração/E2E do app empacotado (só unidade + smokes).
6. `webviewTag: true` + preview de conteúdo arbitrário: superfície de risco
   conhecida do Electron (mitigada por ser conteúdo local do dev).
7. Chat default em `bypassPermissions`/`--dangerously-skip-permissions`
   (decisão de produto do original) — precisa virar política por loop/step.

## 6. Riscos do fork

| Risco                                                                                                             | Gravidade | Mitigação                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| `electron-updater` publica/consome de `Yg0rAndrade/carcara-code` — app forkado se auto-atualizaria para o Carcará | **Alta**  | Trocar `build.publish` antes de qualquer empacotamento (Fase 1)             |
| Mudar `name`/`appId` muda `userData` → perde config/checkpoints de quem já usa                                    | Média     | Migração de diretório na primeira execução, ou aceitar reset (produto novo) |
| Renomear `.carcara/` (dados por projeto) quebra prompts/MCP salvos                                                | Média     | Ler do caminho novo com fallback ao antigo                                  |
| `AGENTS.md` herdado instrui commit+push automático diário (hook local do autor)                                   | Média     | Regra revogada no `CLAUDE.md` do fork; revisar `AGENTS.md` na Fase 1        |
| Namespaces injetados `__carcara*` (grab/touch scripts) usados como sentinelas em runtime                          | Baixa     | Renomear em conjunto com os smokes correspondentes                          |
| `persistenceKey` do tldraw (`carcara-board:*`) — renomear perde quadros locais                                    | Baixa     | Manter chave ou migrar                                                      |

## 7. Validação local (comandos executados)

| Comando                            | Resultado                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm install --no-audit --no-fund` | 1ª tentativa falhou com `ETIMEDOUT` (rede, transitório); 2ª tentativa **OK**. Warnings de deprecação transitivos (uuid@8, core-js@2) sem impacto |
| `npm run lint`                     | **OK** (exit 0, sem erros)                                                                                                                       |
| `npm test` (vitest)                | **OK — 24 arquivos, 163 testes, 0 falhas** (~0,9s)                                                                                               |
| `npm run test:i18n`                | **OK** ("i18n parity ok")                                                                                                                        |
| `npm run test:platform`            | **OK** ("platform-smoke OK")                                                                                                                     |
| `npm run build` (vite)             | **OK** em 1,7s — `dist/` gerado, bundle 4,3 MB (minify off por design)                                                                           |
| `npm run dev`                      | **OK** — Vite pronto em 267ms, `http://localhost:5234/` respondeu HTTP 200 (encerrado em seguida)                                                |
| `npm start` (Electron GUI)         | **Não executado** nesta sessão para não abrir janela gráfica durante análise automatizada; nada indica problema (o CI empacota nos 3 SOs)        |

Nenhuma correção de código foi necessária — o repositório está íntegro.

## 8. Oportunidades de reaproveitamento (mapa para o Loop Code)

| Componente proposto            | Reaproveita                                                                  | Esforço                      |
| ------------------------------ | ---------------------------------------------------------------------------- | ---------------------------- |
| AgentAdapter                   | `ai-cli.cjs` (ids, resolução, resume) + `chat-cli.cjs` (transporte headless) | Baixo — formalizar interface |
| StepExecutor (build/lint/test) | infraestrutura de spawn do preview/PTY + `platform.cjs`                      | Baixo                        |
| CheckpointManager              | `checkpoint:*` (shadow git + lock)                                           | Muito baixo                  |
| Git Manager (branch/worktree)  | `git:*` (simple-git já embutido)                                             | Baixo — adicionar worktree   |
| ValidationEngine               | novo, mas usa StepExecutor + saída `stream-json` do agente                   | Médio                        |
| LoopRunner / LoopHistory       | novo (`electron/loop/*.cjs` no padrão core puro)                             | Médio-alto                   |
| BrabrixApiClient / DeepLink    | novo; MCP client existente é alternativa de transporte                       | Médio                        |
| UI do loop                     | padrões de painel existentes (ChatPanel/CheckpointsPanel/TodosPanel)         | Médio                        |

## 9. Conclusão

O fork é um excelente ponto de partida: o produto original já resolve o "chão"
(janela, projetos, terminal, agentes, git, preview) e os padrões internos dos
módulos novos são compatíveis com a evolução planejada. O caminho recomendado é
**incremental**: rebranding seguro (Fase 1), formalização do AgentAdapter sobre
`ai-cli`/`chat-cli` (Fase 2) e um LoopRunner local em `electron/loop/` (Fase 3),
sem reescrever nada do que funciona. Ver `LOOP_CODE_ARCHITECTURE.md` e
`LOOP_CODE_MIGRATION_PLAN.md`.
