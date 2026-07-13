# Loop Code

**IDE orientada a workflows de codificação com agentes de inteligência artificial.**

> An AI coding workflow IDE for planning, implementing, testing and validating
> software tasks.

O Loop Code é uma IDE desktop (Electron) da **Brabrix** para desenvolvimento com
coding agents. A visão do produto: receber tarefas do **Brabrix Dev** (backlog,
PRDs, especificações, critérios de aceite) e executá-las em **Coding Loops**
controlados — planejar → implementar → build → testes → revisão → validação →
commit/PR → atualizar a tarefa.

## Estado do projeto

**Loop Code is currently under active development.** O produto está em
transição do fork original para a arquitetura de Coding Loops — os documentos
em [`docs/`](docs/) descrevem o plano por fases.

## Capacidades atuais

O que já funciona hoje, herdado e evoluído do projeto original:

- **Projetos no rail** — um ícone por projeto, sessões de IA independentes por
  projeto, projetos remotos via SSH.
- **Agentes de IA por CLI** — Claude Code, Codex, OpenCode, Antigravity ou
  comando customizado, escolhidos por projeto/sessão (terminal interativo ou
  chat headless com o Claude Code).
- **Contrato genérico de coding agents** (`electron/agents/`) — registry +
  service + adapter do Claude Code para execuções programáticas.
- **Coding Loops (experimental)** — motor local de workflows
  (`electron/loop/`): planejar → aprovar (checkpoint humano) → implementar →
  validar → repetir até passar ou atingir limites, com persistência,
  cancelamento e retomada. Painel "Loops" no menu de ferramentas do projeto.
  Templates: Feature Development e Bug Fix.
- **Editor de código** (CodeMirror) com árvore de arquivos, busca e visualização
  de mídia/planilhas/PDF.
- **Terminal integrado** (xterm + node-pty) por sessão e terminal livre por
  projeto.
- **Preview automático** — detecta o script `dev`/`start`, sobe o servidor e
  mostra o site embutido (inclui runtime PHP no Windows).
- **Git** — status, diff, stage, commit, push/pull, branches.
- **Checkpoints** — "voltar no tempo" sem sujar o Git do projeto (repositório-
  sombra separado).
- **Cliente MCP** e **cliente REST** (aba API) por projeto.
- **i18n pt/en** e temas claro/escuro.

## Visão futura (roadmap)

- **Git por execução**: branch/worktree isolada por loop, diff e preparação de
  commit (Fase 3).
- **Integração Brabrix**: receber tarefas com contexto (PRD, spec, critérios),
  publicar progresso e atualizar a tarefa ao final.
- **Validação automática** de critérios de aceite.
- **Múltiplos agentes** por workflow (implementador, revisor).
- **Branch/worktree por execução** e criação de pull request.

Detalhes: [`docs/LOOP_CODE_ARCHITECTURE.md`](docs/LOOP_CODE_ARCHITECTURE.md) e
[`docs/LOOP_CODE_MIGRATION_PLAN.md`](docs/LOOP_CODE_MIGRATION_PLAN.md).

## Desenvolvimento local

Gerenciador de pacotes: **npm** (lockfile `package-lock.json`).

```bash
npm install          # dependências
npm run dev          # Vite dev server (renderer, porta 5234)
npm start            # Electron (carrega dist/ — rode npm run build antes)
npm run build        # build do renderer para dist/
npm run lint         # eslint (não há script de typecheck; o projeto é JS puro)
npm test             # vitest (unidade)
npm run test:i18n    # paridade de traduções pt/en
npm run test:platform
npm run pack:exe     # instalador Windows (NSIS)
npm run pack:appimage# AppImage Linux
npm run pack:dmg     # DMG macOS
```

> Dica: se abrir o Electron de dentro de um terminal do Claude Code, limpe a
> variável `ELECTRON_RUN_AS_NODE` antes de `npm start`.

## Arquitetura (visão resumida)

```text
Electron Main   main.js + electron/*.cjs — janela, IPC, processos, git,
                preview, MCP, checkpoints, SSH remoto
Preload         preload.js — única ponte renderer↔main (window.api)
Renderer        src/ — React + Vite + Tailwind (rail, chat, editor, preview…)
Agents          electron/agents/ — contrato genérico (registry/service/adapter);
                electron/ai-cli.cjs + chat-cli.cjs — CLIs por projeto e chat headless
Workspace       projetos, fs, terminal (node-pty/ssh2), preview, git (simple-git)
Persistence     userData/config.json (app) + <projeto>/.loopcode/ (por projeto,
                com fallback de leitura do legado .carcara/)
```

Documentação técnica: [`docs/`](docs/) — em especial
[`docs/AGENT_ADAPTER_ARCHITECTURE.md`](docs/AGENT_ADAPTER_ARCHITECTURE.md) e
[`docs/LOOP_CODE_BRANDING_MIGRATION.md`](docs/LOOP_CODE_BRANDING_MIGRATION.md).

## Open source attribution

Loop Code is based on **[Carcará Code](https://github.com/Yg0rAndrade/carcara-code)**,
created by **Ygor Andrade**, and is distributed under the terms described in the
repository [LICENSE](LICENSE) file (MIT License, © 2026 Ygor Andrade). The
original copyright notice and permission notice are preserved as required by
the license.

O Loop Code é derivado do **Carcará Code**, criado por Ygor Andrade e
distribuído sob licença MIT. O arquivo [`LICENSE`](LICENSE), o copyright e os
créditos originais estão preservados — inclusive na tela **Sobre** do app.

## Licença

[MIT](LICENSE) — veja o arquivo `LICENSE` na raiz do repositório.
