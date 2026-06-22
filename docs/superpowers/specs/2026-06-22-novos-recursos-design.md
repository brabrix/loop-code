# Novos recursos do Carcará Code — Design / Roadmap

**Data:** 2026-06-22 · **Projeto:** Carcará Code · **Status:** Notificação aprovada; demais em roadmap

## Resumo

Conjunto de recursos novos que não existem hoje no Carcará, escolhidos pra empurrar a
identidade do produto (IDE minimalista pro Claude Code, fluxo Lovable, multi-projeto,
assinatura) sem trazer firula de IDE pesada.

Ordem de construção decidida:

1. **Notificações de atividade por projeto** — *construído ✓*
2. **Command palette (Ctrl+K)** — *construído ✓ (CommandPalette.jsx; Ctrl/Cmd+K)*
3. **Checkpoints / voltar no tempo** — *construído ✓ (shadow git; aba "Histórico")*
4. **Editor de `.env` com máscara** — *construído ✓ (EnvEditor no CodeView)*
5. **Biblioteca de prompts salvos por projeto** — *construído ✓ (.carcara/prompts.json; menu na barra do chat)*
6. **Toggle plan vs build no chat** — *REMOVIDO (decisão do Ygor 2026-06-22: sem uso)*
7. **Publicar/compartilhar preview via túnel (Cloudflare)** — *futuro, fora do escopo imediato (não construído)*

Recurso rebaixado a "escondido/avançado": **painel de mudanças da rodada** (diff do que o
Claude tocou no último turno) — entra atrelado aos checkpoints, não como destaque.

**Fora de escopo:** Grab→chat (o grab continua copiando pro clipboard) e medidor de uso/limite.

---

## 1. Notificações de atividade por projeto (APROVADO)

### Problema

O app nasceu pra rodar vários projetos ao mesmo tempo (ver README/AGENTS.md), mas não há
nenhum sinal de quando o Claude terminou uma tarefa num projeto que você não está olhando.
Você fica adivinhando ou ficando trocando de projeto à toa.

### Decisões fechadas

- **Disparo:** opção 1 — notificação do SO **só quando termina** e **só em projeto que NÃO
  está em foco** (ou app em segundo plano). Silencioso quando você já está olhando.
- **Escopo de CLI:** **só Claude Code.** Se `ai:get` do projeto ≠ `claude`, todo o
  rastreamento fica inerte — sem indicador no rail e sem notificação. Não pode quebrar
  nem fazer barulho pros outros CLIs (Codex/OpenCode/Antigravity/custom).
- **Granularidade:** estado é **por session** (um projeto tem 1..N sessions/IDs). O rail
  **agrega**: o projeto está "trabalhando" se *qualquer* session estiver; a notificação
  dispara quando *uma* session passa de trabalhando→terminou.

### Detecção (máquina de estados por session)

Cada session é um PTY rodando `claude`. O estado é inferido do stream `term:data`:

- `ocioso` → `trabalhando`: output começou a fluir depois de um input.
- `trabalhando` → `terminou`: output ficou parado por **~3s** (debounce, ajustável) depois
  de ter efetivamente trabalhado.
- `terminou` → `ocioso`: no próximo input do usuário naquela session.
- **Filtro anti-ruído:** só conta como "trabalhou" se o volume de output passou de um mínimo
  (evita disparar no eco do próprio prompt e em respostas triviais de uma linha).

A detecção por ociosidade é agnóstica de CLI por construção, mas fica **gateada** em
`claude` por decisão de produto. Mantém a porta aberta pra habilitar outros CLIs depois.

### Onde mora o estado

- O rastreamento vive no **main process** (`main.js`), onde os PTYs e o output já passam.
  Assim funciona mesmo com a janela em segundo plano e independe do painel de chat estar
  montado. Cada `term:data` alimenta um timer de debounce por session.
- O main emite eventos pro renderer: `activity:state` `{ projectPath, sessionId, state }`
  pra atualizar o rail, e dispara a `Notification` do Electron direto do main.

### Indicador no rail (por projeto, agregado)

- **Trabalhando:** pontinho âmbar (cor de brasa) pulsando.
- **Terminou e você não viu:** badge de "atenção" que **persiste** até você focar o projeto.
- **Separado** do pontinho verde de "preview rodando" que já existe — posição/cor distintas
  pra não confundir os dois sinais.
- Focar o projeto limpa o badge de atenção daquele projeto.

### Notificação do Windows

- `new Notification()` no main (funciona com app desfocado).
- Dispara só em `trabalhando→terminou` **e** projeto ≠ o focado (ou app em background).
- Texto: título "Carcará Code", corpo "Claude terminou em **{nome do projeto}**".
- Clique → foca a janela + troca pro projeto (e session) que terminou.
- **Coalescência por projeto:** se várias sessions terminam quase juntas, agrupa numa só
  notificação por projeto numa janela curta.

### Configuração

- Toggle global **"Notificar quando o Claude terminar"** no `SettingsModal` (padrão: ligado),
  persistido no `config.json`. Limite de ociosidade fixo (~3s) por enquanto.

### Erros / bordas

- Projeto não-Claude: rastreamento inerte, zero efeito colateral.
- Session morre/fecha no meio: limpa timers, não dispara fantasma.
- App focado no projeto certo: nunca notifica (só atualiza rail, que some ao olhar).
- Output contínuo de dev server **não** entra aqui — isso é PTY de chat, não o preview.

### Componentes tocados

- `main.js` — rastreador de estado por session no caminho do `term:data`; emissão de
  `activity:state`; disparo da `Notification`; leitura do toggle e do `ai:get`.
- `preload.js` — expor listener `onActivityState` e (no clique da notificação) foco/troca.
- `src/components/Rail.jsx` — novo indicador de atividade agregado por projeto.
- `src/App.jsx` — consumir `activity:state`, manter mapa de estado por projeto, limpar badge
  ao focar projeto, reagir ao clique da notificação.
- `src/components/SettingsModal.jsx` — toggle de notificações.

---

## 2. Command palette (Ctrl+K) — roadmap

Busca fuzzy única pra: **trocar de projeto**, **abrir arquivo** (reaproveita `fs:search`),
e **rodar ações** (restart/stop preview, novo session, abrir aba Git/API/MCP/Board, trocar
tema, etc.). Overlay minimalista, teclado-first, fecha no Esc. Reaproveita o scoring de
fuzzy que já existe no CodeView. Aprofundar quando chegarmos nela.

## 3. Checkpoints / voltar no tempo — CONSTRUÍDO

**Decisão (pesquisada, confirmada com Cursor/Cline/aider):** em vez de branch no repo do
usuário, usa um **shadow git repository** — `GIT_DIR` separado, fora do projeto
(`userData/checkpoints/<hash>.git`), com a árvore de trabalho apontando pro projeto. Mantém
o histórico/staging do usuário intocados, captura arquivos untracked e funciona até sem git.

- **Snapshot:** auto-checkpoint quando o Claude termina um turno (engatado em `activityIdle`,
  só claude, gateado por config `checkpoints`), pulando quando nada mudou. Mais o botão
  "Criar" manual.
- **Restore exato:** `read-tree <hash>` → `checkout-index -f -a` → `clean -fd` (respeita
  `info/exclude`, então `node_modules` sobrevive). Sempre faz um checkpoint do estado atual
  ANTES — voltar é reversível, e o HEAD do shadow não se move (história toda alcançável).
- **UI:** aba "Histórico" (`CheckpointsPanel.jsx`, no menu Ferramentas e na paleta) lista os
  checkpoints com tempo relativo e botão "Voltar"; toggle "Auto".
- Backend: `main.js` (`shadowGit`/`checkpointCreate`/`checkpointList`/`checkpointRestore`),
  `preload.js`, IPC `checkpoint:*`. Sequência de restore validada em sandbox.

Ainda **futuro** (não construído): o "painel de mudanças da rodada" (diff do último turno,
aceitar/rejeitar por arquivo) e checkpoint *antes* de cada prompt (hoje é após o turno).

## 4. Editor de `.env` com máscara — CONSTRUÍDO

Arquivos `.env*` abrem no `EnvEditor` (dentro do CodeView): valores **mascarados** por
padrão (•••), revelar por linha (olho) ou tudo, editar/adicionar/remover variáveis. Salva
pelo mesmo Ctrl+S (escreve no `content` da aba). Ajustes pós-feedback do Ygor:
- **Comentários e linhas em branco ficam ocultos** no modo mascarado (limpa a visão), mas
  são **preservados no arquivo** ao salvar (a serialização mantém as linhas "cruas").
- **Toggle "Ver como texto"** no toolbar volta pro CodeMirror padrão (e "Modo seguro"
  retorna ao mascarado), por path.

## 5. Biblioteca de prompts salvos por projeto — roadmap

Prompts reutilizáveis (ex.: "rode os testes e corrija o que quebrar"), salvos por projeto
(provável em `.carcara/`), inseríveis no input do chat com um atalho/menu.

## 6. Toggle plan vs build no chat — REMOVIDO

Foi construído e depois **removido a pedido do Ygor (2026-06-22): "não vai ter uso"**.
Revertido por completo — UI do cabeçalho, comando na paleta, `planModeFor`/flag no
`buildLaunchCommand`, IPC `planmode:*` e a API no preload. Fica registrado caso volte:
o caminho determinístico era o flag `claude --permission-mode plan` (Shift+Tab no TUI
varia por terminal/OS); valores válidos do flag: default, acceptEdits, plan, auto,
dontAsk, bypassPermissions.

## 7. Publicar/compartilhar preview via túnel — futuro

Expor o preview local via túnel (ex.: Cloudflare) pra abrir no celular/compartilhar link.
Fora do escopo imediato; documentado como ideia futura.
