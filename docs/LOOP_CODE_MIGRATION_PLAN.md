# Loop Code — Plano de Migração por Fases

> Data: 2026-07-12 · Base: Carcará Code v0.1.8. Cada fase é entregável,
> pequena e não quebra o que existe. Referências: `LOOP_CODE_TECHNICAL_ASSESSMENT.md`
> (estado atual) e `LOOP_CODE_ARCHITECTURE.md` (destino).

---

## Fase 0 — Auditoria e estabilização do fork ✅ (esta tarefa)

**Objetivo:** entender o código herdado, validar que instala/builda/testa e
documentar a rota — sem mudanças estruturais.

**Tarefas**

- [x] Identificar submodule e estado do Git.
- [x] Analisar arquitetura, stack, IPC, subsistemas.
- [x] Validar `install`, `lint`, `test`, `build`, `dev` (tudo verde).
- [x] Auditar marca Carcará (tabela no assessment e abaixo, Fase 1).
- [x] Criar docs técnicos + contratos iniciais (`docs/contracts/`).
- [x] Atualizar `CLAUDE.md` para o contexto do fork (inclui revogar a regra
      herdada de push automático diário).

**Arquivos:** só `docs/*` e `CLAUDE.md`. **Riscos:** nenhum (documental).
**Critérios de aceite:** comandos validados e documentados; nenhuma regressão.

---

## Fase 1 — Identidade Loop Code

**Objetivo:** o app se chamar Loop Code em tudo que o usuário vê e no
empacotamento, sem quebrar dados locais nem violar a licença MIT original.

**Tarefas**

1. **Empacotamento/updates (crítico):** `package.json` → `name: loop-code`,
   `build.appId: com.brabrix.loopcode`, `productName: Loop Code`,
   `artifactName`s, `nsis.shortcutName`, `dmg.title` e — antes de qualquer
   release — `build.publish` apontando para `brabrix/loop-code` (hoje aponta
   para `Yg0rAndrade/carcara-code`; ver risco alto no assessment).
2. `main.js`: `APP_NAME`, `setAppUserModelId`, regex de limpeza do User-Agent
   (`Carcar[^/]*` → cobrir o nome novo), identidade do shadow git de
   checkpoints (`checkpoints@carcara.code`).
3. `index.html`: título, splash, keyframes `carcara-*`.
4. i18n: chaves com "Carcará" em `src/lib/locales/{pt,en}.json` e
   `electron/main.i18n.cjs` (`notify_title`); rodar `npm run test:i18n`.
5. UI: `SettingsModal` (Sobre — manter crédito "baseado no Carcará Code de
   Ygor Andrade (MIT)" + link), `main.jsx` (ErrorBoundary label),
   `empty-state.jsx`, assets `src/assets/logo-*.svg`, `imgs/`, `build/icon.*`.
6. Dados por projeto: `.carcara/` → `.loopcode/` **com fallback de leitura**
   (prompts, mcp-servers, requests) + `.gitignore`.
7. Migração de `userData` (mudança de `name` muda o diretório): decidir entre
   migrar na primeira execução ou aceitar reset (produto ainda sem base
   instalada — recomendação: reset consciente, documentado).
8. Namespaces internos de baixo risco, em lote separado: `__carcara*`
   (grabScript/touchCursorScript/PreviewPanel), `carcara-board:` (tldraw —
   decidir migração), `ygc-media://`, prefixos `carcara-*` nos smokes,
   nomes de artefato nos workflows.
9. `README.md`/`AGENTS.md`: reescrever para o Loop Code; **remover a regra de
   backup diário com push automático**; manter seção de créditos e `LICENSE`
   (MIT © Ygor Andrade) intocada.

**Arquivos:** `package.json`, `main.js`, `index.html`, `electron/main.i18n.cjs`,
`src/lib/locales/*`, `src/components/{SettingsModal,SetupScreen}.jsx`, `src/main.jsx`,
`src/lib/{grabScript,touchCursorScript,toast}.js`, `imgs/`, `build/`, `.github/workflows/*`.

**Riscos:** perda de config/checkpoints locais (mitigar com migração/fallback);
regex do User-Agent (nome com acento já causou bug real — testar preview);
esquecimento do `build.publish` (bloqueador de release).

**Dependências:** Fase 0. **Critérios de aceite:** nenhum "Carcará" visível na
UI; lint/test/build/i18n verdes; LICENSE preservada; app abre e preview funciona.

---

## Fase 2 — Agent Adapter genérico

**Objetivo:** formalizar `CodingAgentAdapter` (docs/contracts) sobre o que já
existe, sem mudar o comportamento do chat/terminal atuais.

**Tarefas**

1. Criar `electron/agents/` com o registry de adapters (padrão core puro +
   testes vitest).
2. `ClaudeCodeAdapter` headless encapsulando `chat-cli.cjs` (spawn, stream-json,
   eventos, usage/custo, resume, cancel).
3. `PtyAgentAdapter` genérico (codex/opencode/agy/custom) sobre a infra de
   `term:ensure`/`ai-cli.cjs` — transporte `pty`, modo assistido.
4. `isAvailable()` reusando `system:checkTools`.
5. Canais IPC finos (`agents:list`, `agents:execute`, `agents:cancel`,
   push `agent:event`) — aditivos, sem tocar `chat:*`/`term:*`.
6. Converter contratos de `docs/contracts/` em `.d.ts`/JSDoc consumível pelos
   módulos novos.

**Arquivos:** novos `electron/agents/*.cjs(.test.js)`, main.js (registro dos
handlers), preload.js (métodos novos).

**Riscos:** duplicar lógica do chat (mitigar: adapter _chama_ chat-cli, não
copia); zumbis de processo (padronizar kill/abort como no chat atual).

**Dependências:** Fase 1 (nomes). **Critérios de aceite:** executar um prompt
via ClaudeCodeAdapter headless com eventos e cancel funcionando; suíte verde;
chat/terminal atuais intactos.

---

## Fase 3 — Coding Loop local

**Objetivo:** rodar um loop completo local (sem Brabrix): plano → implementação
→ build/test → validação → correção → repetir dentro de limites.

**Tarefas**

1. `electron/loop/loop-core.cjs`: tipos/validação de `LoopDefinition`,
   transições de estado puras (testável 100% por unidade).
2. `electron/loop/step-executor.cjs`: steps `command` (spawn com PATH da
   plataforma, timeout, captura de saída) e `agent` (via adapters da Fase 2).
3. `electron/loop/loop-runner.cjs`: máquina de estados, iterações, limites
   (`maxIterations`/`maxDurationMs`/`maxCostUsd`), pause/cancel/needs_human.
4. `ValidationEngine` v1: checks `command` (exit code) + `agent-judged`
   (agente avalia critérios textuais e devolve `ValidationResult`).
5. Integração com checkpoints: checkpoint automático por iteração, restore em
   correção (reusa `checkpoint:*` e o lock por projeto).
6. `LoopHistory`: `userData/loops/<runId>.json` + `.events.jsonl`.
7. UI mínima: painel "Loop" (definição default embutida, botão rodar, timeline
   de eventos, estado/iteração/custo) — padrão dos painéis existentes, i18n
   pt+en.
8. Loop default de referência: `plan → implement → build → test → validate`.

**Arquivos:** novos `electron/loop/*`, `src/components/LoopPanel.jsx`,
main.js/preload.js (canais `loop:*`), locales.

**Riscos:** runaway de custo/tempo (limites obrigatórios + botão parar);
concorrência com o usuário editando (checkpoint antes de cada iteração; Fase 4
resolve de vez com worktree); parse frágil de resultados de teste (v1: exit
code, não parsing de output).

**Dependências:** Fase 2. **Critérios de aceite:** numa repo de teste, uma
tarefa simples com teste falhando é corrigida pelo loop em ≤ N iterações;
interromper/pausar funciona; histórico gravado; app atual intacto.

---

## Fase 4 — Git branch e worktree

**Objetivo:** isolar cada run em branch (e worktree) dedicada e fechar com
commit rotulado.

**Tarefas**

1. Estender o Git Manager: `git worktree add/remove/list` e criação de branch
   `loop/<taskId>-<slug>` (simple-git `raw()`).
2. LoopRunner passa a rodar na worktree do run; diff final apresentado ao
   usuário antes do step `commit`.
3. Step `commit` com mensagem estruturada (tarefa, iterações, validações).
   **Sem push automático** — push/PR são ação explícita do usuário até a Fase 5.
4. Limpeza de worktrees órfãs na inicialização.

**Riscos:** worktrees não suportadas em repos exóticos (fallback: branch no
working copy com confirmação); espaço em disco (limpeza + limite).

**Dependências:** Fase 3. **Critérios de aceite:** run não toca o working copy
do usuário; commit sai na branch do loop; abortar limpa a worktree.

---

## Fase 5 — Integração Brabrix

**Objetivo:** receber tarefa/contexto do Brabrix Dev e devolver progresso.

**Tarefas**

1. `electron/brabrix/api-client.cjs` (REST; base URL configurável) +
   autenticação com token em `safeStorage` (padrão `secretStore`).
2. `TaskContextLoader`: tarefa + PRD + spec + critérios → `BrabrixTaskContext`
   → prompt de contexto do loop; vínculo tarefa ↔ projeto local persistido.
3. `TaskProgressPublisher`: eventos do run → API (status, iteração, custo,
   commit/PR) com fila offline (retry).
4. `DeepLinkHandler`: protocolo `loopcode://task/<id>` (registrar via
   `setAsDefaultProtocolClient`; hoje não há deep link no app) com confirmação
   do usuário.
5. UI: login Brabrix nas Configurações; lista "Minhas tarefas" por projeto.
6. Criação de PR opcional ao final (via `gh` ou API do provedor), sempre com
   confirmação.

**Riscos:** contrato da API Brabrix ainda em definição (isolar num client
único); segurança de deep link (validação + confirmação); publicar progresso
não pode travar o loop (fila assíncrona).

**Dependências:** Fases 3–4 + API do Brabrix. **Critérios de aceite:** fluxo
completo tarefa → loop → commit/PR → tarefa atualizada no Brabrix.

---

## Fase 6 — Multiagente

**Objetivo:** papéis distintos por step (implementador, revisor, julgador de
validação) possivelmente com CLIs/modelos diferentes.

**Tarefas**

1. `LoopDefinition` já suporta agente por step — expor na UI (editor de loops).
2. Step `review` com agente revisor independente (prompt de crítica + gate).
3. Biblioteca de loops predefinidos (rápido, rigoroso, só-testes…) e loops por
   projeto em `.loopcode/loops/*.json`.
4. Métricas comparativas por agente no histórico (custo, iterações, aprovação).

**Riscos:** explosão de custo (orçamento por run já existente na Fase 3);
complexidade de UI (editor pode ser JSON validado antes de UI rica).

**Dependências:** Fases 3 e 5. **Critérios de aceite:** run com implementador
e revisor distintos concluindo tarefa real.

---

## Fase 7 — Execução remota

**Objetivo:** rodar loops em máquina remota (a infra SSH já existe:
`electron/remote/` com sshShell, remoteFs, secretStore, knownHosts).

**Tarefas**

1. Estender StepExecutor para executar via `sshShell`/`remoteFs` quando o
   projeto for remoto (`ssh://` já é um conceito do app).
2. Estado do run continua local; execução e arquivos remotos.
3. Avaliar modo "fila": Brabrix despacha tarefa para um Loop Code headless
   (deriva do LoopRunner viver no main, não na UI).

**Riscos:** latência/instabilidade de conexão (retomada de run); agentes
precisam estar instalados/autenticados no host remoto (checagem prévia).

**Dependências:** Fases 3–5. **Critérios de aceite:** loop completo num
projeto remoto SSH com progresso publicado no Brabrix.

---

## Resumo da ordem e do valor

| Fase | Entrega visível                          | Desbloqueia       |
| ---- | ---------------------------------------- | ----------------- |
| 0    | Diagnóstico + docs                       | Tudo              |
| 1    | App "Loop Code" (marca/updates corretos) | Releases próprios |
| 2    | Adapter formal de agentes                | 3, 6              |
| 3    | **Coding Loop local funcionando**        | 4, 5, 6, 7        |
| 4    | Isolamento por branch/worktree           | 5                 |
| 5    | **Integração Brabrix ponta a ponta**     | 6, 7              |
| 6    | Multiagente / loops customizados         | —                 |
| 7    | Execução remota                          | —                 |
