# AGENTS.md

Este arquivo serve para que o **Claude Code** (e qualquer agente de IA) entenda o
propósito deste projeto antes de começar a trabalhar nele.

## O que é o Loop Code

O **Loop Code** é uma **IDE orientada a workflows de codificação com agentes de
inteligência artificial**, desenvolvida pela **Brabrix**. É um fork do
**Carcará Code** (MIT, © Ygor Andrade — créditos preservados em `LICENSE` e na
tela Sobre).

A visão do produto: o **Brabrix Dev** cuida da camada de gestão (projetos,
backlog, sprints, tarefas, PRDs, especificações, critérios de aceite) e o
**Loop Code** cuida da execução local — abrir o projeto, montar contexto,
executar coding agents em **Coding Loops** controlados (implementar → build →
testar → revisar → validar critérios → commit/PR) e reportar o progresso.

Estado atual e plano por fases: `docs/LOOP_CODE_TECHNICAL_ASSESSMENT.md`,
`docs/LOOP_CODE_ARCHITECTURE.md`, `docs/LOOP_CODE_MIGRATION_PLAN.md`.

## A interface hoje

1. **Rail** — um ícone por projeto; cada projeto tem sessões de IA próprias.
2. **Chat/Terminal** — conversa com a CLI de IA escolhida por projeto/sessão
   (Claude Code, Codex, OpenCode, Antigravity ou comando custom).
3. **Preview** — detecta o script `dev`/`start`, sobe o servidor e mostra o
   site embutido.

Além disso: editor (CodeMirror), Git, checkpoints (shadow git), cliente MCP,
cliente REST e projetos remotos por SSH.

## Pontos importantes para quem for desenvolver

- **Stack:** Electron + React (Vite) + Tailwind, JavaScript puro. Processo main
  em `main.js` + módulos em `electron/`, preload em `preload.js`, UI em `src/`.
- **Coding agents:** a camada genérica vive em `electron/agents/` (registry +
  service + adapters). O domínio **não** deve depender de um agente específico;
  o Claude Code é a primeira implementação (`claude-code-adapter.cjs`). Novos
  agentes entram registrando um adapter em `electron/agents/index.cjs` — sem
  espalhar `spawn` pelo código e sem registrar agente que não funciona de
  verdade.
- **Autenticação do Claude:** sempre a **assinatura** logada (mesma do `claude`
  no terminal). **Nunca** chave de API — os spawns limpam `ANTHROPIC_API_KEY`.
- **Renderer nunca executa processos**: tudo passa pelo IPC validado no main
  (`contextIsolation: true`, `nodeIntegration: false`).
- **Como rodar:** `npm install` e `npm start` (edições em `src/` só aparecem
  após `npm run build`).
- **Electron + terminal do Claude Code:** limpe `ELECTRON_RUN_AS_NODE` antes de
  `npm start`.

## Git — regras obrigatórias

- **Nunca execute `git push`.** (A regra antiga de "backup diário" com push
  automático era do repositório original e está **revogada** neste fork.)
- Não faça commit sem o usuário pedir; não altere histórico; nada de
  `git reset --hard`.
- Este repositório é um **submodule** de `micro-saas-core`; o ponteiro no repo
  pai é atualizado pelo usuário.
- Prefira mudanças focadas e pequenas; outras sessões podem estar editando o
  mesmo código em paralelo (inclusive em worktrees).

## Diferenças de plataforma (Win/Mac/Linux)

Nunca espalhe `process.platform` pelo código. Diferença de SO vai em
`electron/platform.cjs` (tabela `TABLE` para valores; funções puras para
comportamento, testáveis via `scripts/platform-smoke.cjs`). O caminho Windows
nunca deve regredir ao adicionar Mac/Linux.

## Idiomas (i18n) — PT-BR e Inglês

O Loop Code é **bilíngue** ('pt'/'en', Configurações → Idioma).

> **REGRA OBRIGATÓRIA:** nenhum texto visível ao usuário direto no JSX. Toda
> string de UI passa pelo i18n e existe nos **dois** idiomas:
> `src/lib/locales/pt.json` + `en.json` (renderer, via `useT()`/`tStatic`) e
> `electron/main.i18n.cjs` (strings nativas do main, via `tn()`).

Antes de fechar qualquer tarefa que mexa em texto: `npm run test:i18n`.

Mantenha o jargão consagrado (`Git`, `commit`, `MCP`, `API`, `Preview`,
`terminal`, `DevTools`) e os nomes próprios (`Claude Code`, `Codex`,
`OpenCode`, `Loop Code`, `Brabrix`, `GitHub`) idênticos nos dois idiomas.

## Notas de versão — obrigatório a cada release

Ao lançar versão (bump + tag `v*`): atualizar `CHANGELOG.md` (seções
**Features** e **Bug Fixes**, estilo n8n, PT-BR, com hash curto) e usar o mesmo
conteúdo na descrição do GitHub Release.

## Antes de construir recurso novo — pesquise primeiro

Para toda funcionalidade nova: (1) **existe lib pronta?** Pesquise na web,
liste ≥3 opções (manutenção, encaixe no stack Electron+Node, distribuição
cross-platform, tamanho, licença) e recomende uma; (2) **como o mercado faz?**
(VS Code, Cursor, Zed…). Só depois proponha o design. Não reinvente SSH,
parsing, cripto ou protocolos.

## Em resumo

Mantenha as coisas simples e **incrementais**: preserve o que funciona (chat,
preview, git, MCP, checkpoints), integre agentes só via adapters, valide todo
IPC no main, nunca exponha segredos e sempre rode `npm run lint && npm test &&
npm run build` antes de encerrar.
