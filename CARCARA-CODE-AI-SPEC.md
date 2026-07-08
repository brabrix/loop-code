# Carcará Code AI — Design (spec)

**Data:** 2026-07-08
**Autor:** Ygor Andrade (+ Claude)
**Status:** Rascunho para aprovação

## 1. Objetivo

Uma **IA de código embutida** no Carcará Code, a **"Carcará Code AI"**, que funciona como o
agente do **Cursor / Copilot / Antigravity**: você conversa em linguagem natural, ela **lê o
projeto**, **edita os arquivos** (com diff + aprovação), suporta **vários modelos** (inclusive
**grátis**) e responde em markdown — para o público que **não gosta de usar a CLI**.

**Motor:** não reinventamos o agente. Usamos o **OpenCode** (agente de código open source, com
servidor headless + SDK) rodando **local** como cérebro. **Controle/custo/chave:** uma **Edge
Function no Supabase** como gateway, que guarda **uma chave da OpenRouter** (300+ modelos,
grátis e pagos) e aplica auth + quota + teto de gasto. Grátis pra todo mundo, uma chave só.

### Referência de comportamento (paridade-alvo)

Cursor/Copilot/Antigravity "Agent": chat com contexto do repo, chamadas de ferramenta em loop
(ler/buscar/editar), diffs aplicáveis com aceitar/rejeitar, multi-arquivo, seletor de modelo,
markdown com blocos de código, anexar imagem.

## 2. Escopo

**Dentro (v1 completo, em fases):**

- Chat com a Carcará Code AI (streaming, markdown) dentro do painel de chat.
- **Agente** (via OpenCode): ler/listar/buscar + **editar** arquivos com diff + aprovação.
- **Multi-modelo** via OpenRouter (seletor de modelo; default = um modelo **grátis**).
- **Imagem** (modelos de visão disponíveis na OpenRouter).
- **Gateway Supabase** (Edge Function) com a chave OpenRouter, **login anônimo**, **quota por
  usuário** e **teto global diário** (anti-abuso/custo).
- Aposentar a ponte experimental **terminal→chat** (adapters de CLI no chat).

**Fora (não-metas):**

- Não substitui o terminal real (claude/codex/agy seguem no xterm normalmente).
- O agente **não** roda na nuvem: ele edita seus arquivos **locais**, então roda local.
- Sem execução de shell arbitrário pela IA no v1 (OpenCode tem permissões; começamos restritos).

## 3. Arquitetura

```
┌────────────────────────────────────┐        ┌──────────────────────────┐        ┌───────────────┐
│  Carcará Code (Electron)           │        │  Supabase Edge Function  │        │  OpenRouter   │
│                                    │        │  "carcara-gateway"       │        │  300+ modelos │
│  ┌──────────────────────────────┐  │        │                          │  HTTP  │  (grátis/pago)│
│  │ UI de chat (assistant-ui)    │  │        │ • CHAVE OpenRouter (secret)      ├───────────────┤
│  │  ▲ dirige via SDK            │  │  HTTPS │ • auth anônima (JWT)     │───────►│ deepseek /    │
│  │  │                           │  │ (JWT)  │ • quota + teto global    │◄───────│ minimax free /│
│  │  ▼                           │  │        │ • rate limit             │  SSE   │ claude/gpt... │
│  │ OpenCode (LOCAL) = o agente  │──┼───────►│ • proxy OpenAI-compat.   │        └───────────────┘
│  │ • edita SEUS arquivos        │  │  SSE   │   (é UM provider do OpenCode)
│  │ • tools, diffs, permissões   │◄─┼────────│
│  │ • multi-modelo               │  │        └──────────────────────────┘
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

**Três camadas, cada uma no seu lugar:**

- **App (local):** a UI de chat + o **OpenCode** (agente). É aqui que ficam os **arquivos** e a
  **execução das ferramentas** — por isso o agente roda local (um agente estilo Cursor precisa
  editar o código local; server-side mexeria no disco do servidor, não no seu).
- **Edge Function (servidor):** o **gateway de controle**. Guarda a chave OpenRouter (secret),
  faz auth, aplica quota + teto, e faz **proxy OpenAI-compatible**. É um provider custom
  registrado no OpenCode. **Todo token que custa dinheiro passa por aqui** → controle total.
- **OpenRouter:** o fan-out multi-modelo (uma chave → 300+ modelos, vários grátis). A DeepSeek
  é só um dos modelos disponíveis por aqui.

**Por que este desenho (DRY + controle):**

- **Não reinventa o agente** — OpenCode já faz tool loop, edição multi-arquivo, permissões, MCP.
- **Multi-modelo + grátis de fábrica** — via OpenRouter, sem código extra.
- **Chave segura + custo controlado** — a chave nunca sai do Supabase; quota + teto blindam.
- **Agente onde os arquivos estão** — edição local de verdade, como Cursor/Copilot.

### Ciclo de um turno

1. Usuário digita na UI (assistant-ui) → app manda pro **OpenCode local** (via SDK): nova
   mensagem na sessão, com o modelo escolhido.
2. OpenCode monta o contexto e chama o **modelo** — a chamada sai pelo **provider "Carcará"**,
   que é a **Edge Function** (não a OpenRouter direto). JWT no header.
3. Edge valida JWT + quota + teto → repassa pra **OpenRouter** (com a chave) → **streaming** de
   volta.
4. OpenCode recebe o stream; se o modelo pediu **ferramenta** (ler/buscar/editar), OpenCode
   **executa local** (permissões aplicam). Edições pedem **aprovação** → nossa UI mostra o diff.
5. OpenCode emite eventos (texto, tool, permissão, done) pela API/SDK → nossa UI renderiza.
6. Repete até a resposta final. Uso é medido no edge (tokens/custo) e contabilizado.

## 4. App — OpenCode local (o agente)

- **Dependência gerenciada:** OpenCode é instalado/gerenciado como as outras ferramentas
  externas (o app já tem tela de preparo p/ Node/Git/Claude; OpenCode entra ali; possível
  auto-instalar ou detectar). Já existe `opencode` como CLI opcional no app.
- **Modo servidor:** o app sobe `opencode serve` (HTTP headless, OpenAPI 3.1) e conversa via
  **`@opencode-ai/sdk`** (cliente tipado). Sem parsear TUI.
- **Config injetada:** o app escreve a config do OpenCode com um **provider custom
  "carcara"** (OpenAI-compatible) cujo `baseURL` = a Edge Function, e uma lista de modelos
  (default grátis + opções). Chave do provider = o **JWT anônimo** do Supabase (não a chave
  OpenRouter — essa fica no edge).
- **Sessões:** cada aba de chat = uma sessão do OpenCode. Reusa o modelo de sessões do app.
- **Permissões → nossa UI:** OpenCode emite pedido de permissão (ex.: gravar arquivo); a UI
  mostra o **diff** com Aceitar/Rejeitar (e um toggle "aceitar tudo" = modo fluido). OpenCode já
  tem o conceito de permissão; a gente pluga na nossa UI em vez da TUI dele.
- **Segurança de arquivos:** confinado ao diretório do projeto (OpenCode opera no cwd da
  sessão). Sem shell arbitrário no v1 (restringir as tools de comando).
- **Desfazer:** integrar com os **checkpoints** (shadow git) que o app já tem — snapshot antes
  de aplicar edições.

## 5. Servidor — Edge Function `carcara-gateway`

### 5.1 Responsabilidades

- Endpoint **OpenAI-compatible** (`POST /chat/completions`, streaming SSE) — passthrough fino.
- **Auth:** valida o **JWT do Supabase Auth** (login anônimo) → `user_id`.
- **Guardrails** (antes de repassar):
  1. **Teto global diário** (circuit breaker): `ai_budget.spent(hoje) ≥ CAP` → `429 daily_cap`.
     **Blinda a carteira**: no pior caso, gasto ≤ CAP/dia.
  2. **Quota por usuário**: `ai_usage(user, hoje).requests ≥ USER_LIMIT` → `429 user_quota`.
  3. **Rate limit por IP** (janela curta) → `429`.
- Repassa pra `https://openrouter.ai/api/v1/chat/completions` com a **chave OpenRouter** (secret)
  - headers de atribuição (`HTTP-Referer`/`X-Title`).
- **Whitelist de modelos** (env): só deixa passar modelos permitidos (evita alguém pedir um
  modelo caro pra estourar o teto). Default = um modelo grátis; opções curadas.
- Mede uso (`usage` da resposta) e atualiza `ai_usage` + `ai_budget` ao fim do stream.

### 5.2 Modelo de dados (Supabase/Postgres)

```sql
create table ai_usage (            -- uso por usuário/dia (RLS: usuário lê só o próprio)
  user_id uuid not null,
  day date not null default (now() at time zone 'utc')::date,
  requests int not null default 0,
  tokens bigint not null default 0,
  primary key (user_id, day)
);
create table ai_budget (           -- orçamento global/dia (só service role)
  day date primary key default (now() at time zone 'utc')::date,
  spent_usd numeric not null default 0
);
create table ai_ratelimit (        -- rate limit por IP
  ip text not null, window_start timestamptz not null, count int not null default 0,
  primary key (ip, window_start)
);
```

Consumo **atômico** via RPC SQL (evita corrida sob concorrência).

### 5.3 Segredos / config (fora do git)

- `OPENROUTER_API_KEY` → **secret do Supabase**, nunca no app/git.
- Públicos no app (por design): **URL do projeto Supabase** + **anon key** (protege RLS + Auth +
  guardrails).
- Env da função (ajustável sem atualizar o app): `CAP` diário, `USER_LIMIT`, whitelist/`DEFAULT_MODEL`.
- **Camadas de proteção de custo:** teto no edge **+** limite de crédito da própria chave na
  OpenRouter (dupla trava).

### 5.4 Login anônimo

- 1º uso: `supabase.auth.signInAnonymously()` → JWT persistido no config local.
- Cada instalação = um `user_id` → quota por usuário sem cadastro.
- Fraqueza assumida: anônimo é farmável → o **teto global** é a proteção real. Evolução: OAuth
  por cima depois, sem mexer no resto.

## 6. Modelos (via OpenRouter)

- **Default "Carcará Code AI" = um modelo grátis** curado (ex.: um dos free da OpenRouter/Zen),
  bom pra código. Zero custo pra você no caminho feliz.
- **Seletor de modelo** na UI: lista curada (whitelist do edge) — grátis + alguns melhores. A
  **DeepSeek V4** entra como opção aqui (é um modelo da OpenRouter).
- **Visão (imagem):** usar um modelo multimodal da OpenRouter nos turnos com imagem.
- **Raciocínio:** modelos com "thinking" quando quiser mais qualidade.

## 7. UI / UX (no painel de chat)

**Carcará Code AI vira uma "IA" de primeira classe** (ao lado de claude/codex/agy):

- Entra em `src/lib/aiOptions.jsx` como `carcara`. Nas Configurações (aba IA), é uma das IAs do
  projeto.
- Sessão com IA = `carcara` renderiza o **`AssistantChat`** (chat assistant-ui, dirigindo o
  OpenCode). Sessões claude/codex/agy seguem no **terminal**. **Reusa toda a infra de
  abas/sessões/layout do `ChatPanel`** (resolve multi-sessão e "trocar de IA" de vez).
- **Decisão:** aposentar o toggle global `chatMode`. Não é modo global — é escolha de IA por
  sessão, consistente com o resto.

**No chat (assistant-ui):**

- Markdown com **blocos de código destacados** (reusar o realce do editor do app).
- **Seletor de modelo** (grátis/melhores).
- **Cartões de tool call** (ler/buscar/editar) com status.
- **Diff por edição** com **Aceitar / Rejeitar** (+ "aceitar tudo").
- **Anexar imagem** (arrastar/colar → modelo de visão).
- Streaming, parar, "pensando" (reasoning).
- Mensagens de **quota / teto** vindas dos `429` do edge ("limite diário atingido").

## 8. O que sai / o que fica

**Sai (a ponte "terminal→chat" foi frágil):**

- `chat-cli.cjs` (adapters claude/codex/agy) + seu smoke.
- Handlers `chat:*` no `main.js` que sobem CLI em stream-json.
- `chatModeContext` + toggle global.
- Overlay `isChatSession` no `ChatPanel` que trocava terminal↔chat por CLI.

**Fica / reaproveitado:**

- **`AssistantChat.jsx`** (assistant-ui + ExternalStoreRuntime): reapontado da ponte CLI pro
  **OpenCode SDK** (novos IPCs `carcaraAi:*`).
- **Terminal real** (`ChatPanel` xterm) pra claude/codex/agy — intacto.
- Padrão "IA por sessão" (`AiPicker`, `session.cli`) — Carcará AI entra como mais uma.

## 9. Interfaces (IPC app ↔ agente)

Novos canais (`preload.js`/`main.js`), o loop/gestão do OpenCode roda no **main**:

- `carcaraAi:ensure(sessionId, projectPath)` → garante `opencode serve` + sessão.
- `carcaraAi:send(sessionId, { text, images, model })` → dispara um turno.
- `carcaraAi:abort(sessionId)`.
- push `carcaraAi:event` → `{ sessionId, event }` com `kind`: `text` | `reasoning` |
  `tool_call` | `tool_result` | `approval_request` | `result` | `error` (traduzidos dos eventos
  do OpenCode SDK).
- `carcaraAi:approve(requestId, ok)` → resposta a um `approval_request` (gravação de arquivo).

## 10. Fases (decomposição — cada uma entrega valor testável)

- **Fase 0 — Aposentar a ponte CLI→chat.** Remover `chat-cli.cjs`/`chat:*`/`chatMode`/overlay;
  manter `AssistantChat` e o terminal. Base limpa.
- **Fase 1 — OpenCode local + UI, com modelo direto.** Subir `opencode serve`, dirigir pela UI
  (assistant-ui) via SDK; agente lendo/editando arquivos com aprovação; usar um modelo grátis
  **direto** (chave de dev/local) só pra validar agente + UI + diffs. Carcará AI vira opção na
  `AiPicker`.
- **Fase 2 — Gateway Supabase + OpenRouter.** Edge Function (chave OpenRouter + auth anônima +
  teto + quota + rate limit + whitelist). OpenCode passa a usar o edge como provider. Agora é
  "grátis pra todos, uma chave, controlado".
- **Fase 3 — Multi-modelo + imagem.** Seletor de modelo (whitelist) e envio de imagem (modelo
  de visão).
- **Fase 4 — Polimento.** Markdown/realce, painel de uso/quota, "aceitar tudo", @-menção de
  arquivos, OAuth opcional.

## 11. Riscos & decisões abertas

- **Valores dos guardrails (decidir):** `CAP` global $/dia (ex.: **$5**?), `USER_LIMIT` (ex.:
  **30 msg/dia**?), rate limit IP. + limite de crédito na própria chave OpenRouter (2ª trava).
- **Dependência OpenCode:** o app passa a depender do OpenCode instalado. UX de instalação
  (auto-instalar? detectar? bundle?) — definir. Projeto jovem → risco de mudança de API do SDK.
- **Limite de tempo da Edge Function:** cada chamada de modelo é curta (um passo do agente) e
  streaming mantém viva; mas respostas longas podem esbarrar no limite. Validar; se precisar,
  trocar o host do gateway (mas Supabase é o pedido).
- **Anônimo é farmável** → teto global é a proteção real; OAuth de reserva.
- **Custo aberto (grátis pra todos):** você banca; teto + whitelist de modelos grátis limitam.
- **Streaming + tool calls** pelo duplo proxy (OpenCode→edge→OpenRouter): o edge é passthrough
  burro; tools rodam no OpenCode local. Validar formato dos deltas.
- **Segurança das tools:** confinar ao projeto, sem shell no v1, limitar leitura.
- **Offline:** a Carcará AI exige internet (o terminal não). Deixar claro na UI.

## 12. Testes

- **Puro/unit (Node):** tradução evento OpenCode→UI; confinamento de path; whitelist de modelos.
- **Edge Function (`supabase functions serve`):** teto batido → 429; quota → 429; JWT inválido →
  401; modelo fora da whitelist → 400; passthrough de streaming.
- **Runtime (app aberto):** turno de texto; tool call de leitura; edição com aprovação →
  checkpoint → desfazer; troca de modelo; imagem; mensagens de limite.

```

```
