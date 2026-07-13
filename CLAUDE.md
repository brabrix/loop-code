# Loop Code

Loop Code é uma **IDE orientada a workflows de desenvolvimento com coding
agents** (Electron + React), conectada ao **Brabrix Dev**. Fork do Carcará Code
(MIT © Ygor Andrade — manter `LICENSE` e créditos intactos, inclusive o cartão
de atribuição na tela Sobre).

## Visão e relação com o Brabrix

- O **Brabrix Dev** cuida de projetos, backlog, sprints, tarefas, PRDs, specs,
  critérios de aceite e acompanhamento.
- O **Loop Code** abre o projeto local, recebe tarefas do Brabrix, monta
  contexto, executa agentes de código (Claude Code, Codex, OpenCode, custom),
  roda **Coding Loops** (implementar → build → testar → revisar → validar
  critérios → commit/PR) e publica o progresso de volta no Brabrix.
- Rota de evolução e estado atual: `docs/LOOP_CODE_TECHNICAL_ASSESSMENT.md`,
  `docs/LOOP_CODE_ARCHITECTURE.md`, `docs/LOOP_CODE_MIGRATION_PLAN.md` e os
  contratos em `docs/contracts/loop-code-contracts.ts`.

## Comandos do projeto (npm — lockfile é package-lock.json)

```bash
npm install          # dependências
npm run dev          # Vite dev server (porta 5234)
npm start            # Electron (carrega dist/ — rode npm run build antes)
npm run build        # build do renderer para dist/
npm run lint         # eslint
npm test             # vitest (unidade)
npm run test:i18n    # paridade pt/en (obrigatório se mexer em texto)
npm run test:platform
```

- Edições em `src/` **só aparecem no app após `npm run build`** (o Electron
  carrega de `dist/`).
- Se abrir o Electron de dentro de um terminal do Claude Code, limpe
  `ELECTRON_RUN_AS_NODE` antes, senão ele roda como Node puro.

## Estrutura principal

- `main.js` — processo main (monólito; novos domínios vão para `electron/`).
- `preload.js` — única ponte renderer↔main (`window.api`).
- `electron/*.cjs` — módulos do main. **Padrão obrigatório:** lógica pura e
  testável no `.cjs` (sem Electron/fs), efeitos colaterais no `main.js`.
- `electron/agents/` — camada genérica de coding agents (ver abaixo).
- `electron/remote/` — SSH (ssh2, secretStore com safeStorage, TOFU).
- `src/` — renderer React (JSX, alias `@/`, Tailwind + tokens de tema).
- `scripts/*.cjs` — smokes standalone.

## Princípios da camada de agentes (`electron/agents/`)

- Integração com agentes **sempre via adapters** do contrato
  `CodingAgentAdapter` (descriptor + checkAvailability + execute + cancel);
  o domínio não depende de nenhum agente específico.
- **Claude Code é a primeira implementação** (`claude-code-adapter.cjs`), que
  reusa a lógica pura de `chat-cli.cjs` — não reimplemente a CLI.
- Novo agente = novo adapter registrado no `CodingAgentRegistry`
  (`electron/agents/index.cjs`). Nunca registre agente sem implementação real.
- Toda operação passa pelo `CodingAgentService` (rastreia execuções, impede id
  duplicado e cancelamento cruzado); os handlers IPC (`agents:*`) só validam e
  delegam.
- O **renderer nunca executa processos**: processos vivem no Electron Main,
  com deps injetáveis para os testes (nada de CLI real em teste unitário).
- IPC de agentes valida input no main (`validateExecutionInput` +
  `isAuthorizedWorkspace` — só workspaces da lista de projetos).
- Canais `chat:*` (chat interativo) e `term:*` (terminal) continuam existindo;
  `agents:*` é o caminho programático (1 prompt → 1 execução → 1 resultado)
  consumido pelo motor de Coding Loops.

## Princípios do motor de Coding Loops (`electron/loop/`)

- **O LoopRunner controla o workflow** — agentes executam UMA etapa e devolvem
  resultado; transições são resolvidas pelo `TransitionResolver` com base na
  definição, nunca pela vontade do agente.
- Executores de etapa são registrados por tipo no `StepExecutorRegistry`
  (novo tipo de etapa = novo executor; nada de switch gigante no runner).
- Comandos usam `executable` + `arguments` em array (sem shell fora do
  Windows, sem concatenação); cwd sempre no workspace autorizado.
- O renderer (LoopPanel) não executa processos: só pede ações via IPC
  `loop:*` validado e exibe estado/eventos (`loop:event`).
- Checkpoints humanos são PERSISTIDOS (nada de Promise aberta esperando a
  UI); aprovação/rejeição são operações separadas e sobrevivem a reinício.
- Todo loop tem limites obrigatórios (`maxIterations` no mínimo) e é
  cancelável (`AbortController` → agente/comando morrem de verdade).
- Estados terminais (`completed`, `blocked`, `failed`, `cancelled`,
  `limit_reached`) são imutáveis — continuar exige nova execução.
- Runs interrompidos por fechamento do app NUNCA assumem sucesso: recovery
  marca como interrompido e o usuário retoma conscientemente.
- Nenhuma integração falsa com Brabrix: a integração real é fase futura e não
  deve ser simulada na UI.
- Docs: `docs/CODING_LOOP_ENGINE.md`, `CODING_LOOP_DEFINITION.md`,
  `CODING_LOOP_EXECUTION.md`, `CODING_LOOP_SECURITY.md`.

## Convenções

- Diferenças de SO **sempre** via `electron/platform.cjs` — nunca espalhar
  `process.platform` (detalhes no `AGENTS.md`).
- i18n: nenhum texto de UI hardcoded no JSX; toda string em
  `src/lib/locales/{pt,en}.json` (renderer) ou `electron/main.i18n.cjs` (main),
  sempre nos **dois** idiomas (detalhes no `AGENTS.md`).
- Módulos novos do main seguem o padrão core puro + teste vitest ao lado.
- Novos canais IPC: namespace claro (`loop:*`, `agents:*`, `brabrix:*`) e
  validação de entrada no main (paths dentro do projeto, ids conhecidos).

## Segurança

- Manter `contextIsolation: true` e `nodeIntegration: false`; nada de expor
  Node cru ao renderer.
- Segredos (tokens Brabrix, senhas SSH) **somente** via `safeStorage`
  (padrão `electron/remote/secretStore.cjs`) — nunca em `config.json`, logs,
  eventos ou neste arquivo.
- Execução autônoma de agentes exige limites (iterações/tempo/custo) e nunca
  herda `bypassPermissions` como default escondido.

## Regras de Git

- **Nunca execute `git push`** (nem o "backup diário" descrito no `AGENTS.md`
  herdado do projeto original — essa regra está **revogada** neste fork).
- Não faça commit sem o usuário pedir; não altere histórico; não use
  `git reset --hard`.
- Este repositório é um **submodule** de `micro-saas-core` — alterações ficam
  no Git daqui; o repo pai só atualiza o ponteiro (feito pelo usuário).
- Mudanças focadas e pequenas; outras sessões podem estar trabalhando em
  paralelo (worktrees).

## Como trabalhar neste fork

- **Mudanças incrementais e aditivas** — preserve o comportamento existente
  (chat, preview, git, MCP, checkpoints); o Coding Loop é camada nova, não
  substituição.
- Antes de fechar qualquer tarefa: `npm run lint && npm test && npm run build`
  (e `npm run test:i18n` se tocou em texto). Não esconda erro ignorando
  validação.
- Sem atualização em massa de dependências; sem troca de framework.
- Identidade: o rebranding para Loop Code está aplicado; identificadores
  legados mantidos de propósito (ex.: chave `carcara-board:` do tldraw,
  fallback de leitura de `.carcara/`) estão documentados em
  `docs/LOOP_CODE_BRANDING_MIGRATION.md` — não os "conserte" sem ler o doc.
