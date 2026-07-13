# Coding Loop — Segurança

## Execução de processos (CommandStepExecutor)

- `executable` + `arguments` **sempre separados** (array). O validador de
  definição recusa executable com espaços ou metacaracteres de shell
  (`| & ; < > $ \``) — argumento de usuário nunca é concatenado em string.
- `shell: false` em Linux/macOS. No Windows usa-se `shell: true` **apenas**
  para o PATH resolver `npm.cmd`/`.bat` — mesma decisão já usada no chat e nos
  agentes da Fase 1 (Node moderno bloqueia spawn direto de `.cmd`); os
  argumentos continuam em array.
- `cwd` é sempre o workspace autorizado — nunca um working directory
  arbitrário do renderer.
- Timeout obrigatório (default 5min) mata o processo; cancelamento via
  `AbortSignal` idem (no Windows, `taskkill /t` derruba a árvore — sem
  processos órfãos). No fechamento do app, `disposeAll()` aborta tudo.
- stdout/stderr limitados durante a coleta (memória) e truncados no stepRun
  (16 KB, mantendo o final).
- Env dos agentes passa pelo `cleanEnv()` (remove `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `ELECTRON_RUN_AS_NODE`).

## Validação de workspace

- `loop:start` só aceita workspace aprovado por `isAuthorizedWorkspace()`
  (main.js): caminho local, existente, `realpath` dentro de um projeto do
  rail. `ssh://` é recusado.
- A etapa de validação resolve todo path **dentro** do workspace
  (`validation-step-executor.cjs`): recusa `..`, absolutos fora do ws e
  symlink cujo `realpath` escape do ws.
- O repositório de runs valida `runId` (`^[a-zA-Z0-9-]{8,64}$`) — sem path
  traversal via nome de arquivo.

## Proteção do IPC

- Canais: `loop:list-definitions`, `loop:start`, `loop:get`, `loop:list-runs`,
  `loop:approve-checkpoint`, `loop:reject-checkpoint`, `loop:cancel`,
  `loop:resume`, `loop:retry-step` + push `loop:event`.
- Todos os handlers validam tipos dos inputs (`runId`/`stepId`/`templateId`
  strings; `options` objeto) e devolvem `{ error }` com mensagem curta de
  domínio — **stack trace nunca vai ao renderer**.
- O renderer recebe **snapshots** (`structuredClone`/JSON) — nunca objetos
  internos mutáveis, processos ou `child_process`.
- A definição construída a partir das opções do usuário passa pelo
  `definition-validator` antes de rodar.
- Listeners: o renderer usa o `window.api.on()` existente, que devolve
  unsubscribe (o LoopPanel remove no unmount); executores removem listeners
  de `abort` no finally.

## Estado e persistência

- Persistidos: definição, estado, etapas, contadores, decisões, erros
  resumidos. **Nunca:** tokens, secrets, variáveis de ambiente, stdout
  ilimitado.
- Estados terminais são imutáveis — toda operação sobre run terminal falha com
  `CodingLoopInvalidStateError`.
- Escrita atômica (tmp + rename) evita JSON corrompido em queda.

## Agente sob controle

- O agente **não** transiciona o workflow: só devolve resultado; quem decide é
  o TransitionResolver com a definição.
- O prompt de cada etapa instrui explicitamente: não commitar, não pushar, não
  tocar secrets/.env, trabalhar só no workspace.
- `permissionMode` nunca ganha default oculto de bypass na camada do loop.
- Limites obrigatórios (`maxIterations` no mínimo) + `maxDurationMs`/execuções
  impedem runaway de custo/tempo.

## Comandos proibidos / fora do escopo do MVP

O motor não cria branches, worktrees, commits, pushes nem PRs (Fase 3+). Não
há execução paralela, runner remoto, containers nem deploy. Nenhuma integração
Brabrix está exposta.

## Riscos conhecidos e futuros

- O comando de validação é definido pelo usuário e roda com os privilégios do
  app no workspace — igual a rodá-lo num terminal. Mitigação atual: sem shell
  (fora do Windows), args separados, cwd preso ao workspace, timeout. Futuro:
  allowlist de executáveis sugeridos e confirmação para executáveis incomuns.
- O agente em si edita arquivos no workspace (natureza do produto); o
  isolamento por branch/worktree chega na Fase 3 (Git), e os checkpoints
  shadow-git existentes já permitem voltar no tempo.
- `files_changed` usa mtime (aproximação); com Git na Fase 3 vira diff real.
- Validação por IA (juiz LLM) entrará como um NOVO tipo de check registrável,
  complementando — nunca substituindo — os checks determinísticos.
