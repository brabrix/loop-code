# Geração de commit robusta a diffs grandes — design

**Data:** 2026-06-22
**Status:** Aprovado (design) — pronto para plano de implementação
**Contexto da branch:** `feat/ia-local` (continua a feature de IA local v1)

## Contexto / problema

A sugestão de mensagem de commit (botão "✨ Gerar" no [GitPanel.jsx](../../../src/components/GitPanel.jsx)) falha com **"Não consegui gerar agora"** quando o diff é grande. Reproduzido fora do app, o erro real é:

> *Failed to compress chat history for context shift due to a too long prompt or system message… Consider increasing the context size or shortening the long prompt.*

Causa: o `generate()` em [llm-core.cjs](../../../llm-core.cjs) usa `contextSize: 2048`, e o GitPanel monta o diff cru (truncado só a 6000 chars ≈ ~1800 tokens). Com o prompt de sistema (few-shot) + moldura, um diff de um arquivo grande (ex.: artigo de blog com ~1500 palavras) **estoura o contexto** → o modelo nem começa a gerar (fica em **0 tokens** e dá erro).

Pesquisa de boas práticas (opencommit, aicommit2, "Precision Dissection of Git Diffs for LLM", Abi Raja) aponta o padrão: **orçar tokens e truncar pra caber**, **filtrar ruído** (lock files, gerados, binários), usar **`--stat`/resumo** pra arquivos enormes, e **degradar com elegância** em vez de erro cru.

## Objetivo

O botão "✨ Gerar" **sempre** produz uma mensagem coerente em pt-br, qualquer que seja o tamanho do diff — sem nunca estourar o contexto nem mostrar erro cru.

## Design (Abordagem A: orçamento + filtro)

### 1. Motor — orçamento de tokens (rede de segurança) · [llm-core.cjs](../../../llm-core.cjs)

- **`contextSize: 2048 → 6144`** em `GEN` (cabe mais diff; KV cache do Qwen3-0.6B segue leve).
- Novo passo no `generate()`, depois de `ensureModel` (o `_model` dá acesso ao tokenizer):
  - Medir tokens com `model.tokenize(text)` (tamanho do array).
  - Orçamento pro diff = `contextSize − tokenize(systemPrompt) − tokenize(molduraVazia) − OUTPUT_RESERVE(160) − MARGEM(64)`.
  - Se `tokenize(input)` exceder o orçamento, **truncar o `input` por tokens** (`tokenize` → fatiar → `detokenize`) e acrescentar `\n…[diff truncado]…`.
- Garante que o prompt **sempre cabe** → a geração sempre começa. Esta parte sozinha elimina o crash; o resto melhora a qualidade.
- Helper isolado e testável: `fitToBudget(model, text, maxTokens)` → string truncada.

### 2. GitPanel — montagem inteligente do diff (qualidade) · [GitPanel.jsx](../../../src/components/GitPanel.jsx) (`generateCommit`)

- **Pular ruído**: arquivos cujo `path` casa com lock/gerado/binário não entram com diff; entram só como nome numa nota final curta:
  - lock: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`
  - gerados/minificados: `*.min.js`, `*.min.css`, dentro de `dist/`, `build/`
  - binários/imagens por extensão: `png jpg jpeg gif webp ico pdf zip woff woff2 ttf`
- **Teto por arquivo** (`PER_FILE_MAX`, ex.: 2500 chars): se o diff de um arquivo passa, inclui o cabeçalho + trecho inicial + nota `(+N/−M linhas)` (contando `+`/`−` do diff).
- Prioriza arquivos de **código** antes de docs/markdown na montagem (pra o conteúdo mais relevante sobrar quando truncar).
- Mantém um teto total de chars antes de enviar (o motor ainda re-orça por token como garantia).

### 3. Degradação · [GitPanel.jsx](../../../src/components/GitPanel.jsx)

- Se, após filtro/teto, não sobrar diff útil (ex.: mudança só de lock), enviar um **resumo de arquivos**: `arquivos alterados: a, b, c` (com status). O modelo gera uma mensagem de alto nível.
- `generate` nunca lança por contexto agora; o `catch`/toast atual continua só pra falhas reais (modelo ausente etc.).
- Contador de tokens ao vivo + laser (já existentes) seguem dando feedback.

## Não-objetivos (YAGNI)

- Resumo por arquivo via LLM (map-reduce) — descartado: 2–3× mais lento, e o 0.6B resume mal.
- Contexto gigante (32k) — descartado: pesa RAM/velocidade no PC básico.
- Configurar tamanho de contexto/filtros na UI.

## Verificação (end-to-end)

1. **Caso que quebrou**: montar o diff real das 3 mudanças do projeto `joiamisticalaroye` (inclui o artigo `como-usar-velas-rituais.md`) e chamar `generate` → produz mensagem pt-br coerente, **sem erro**, em tempo razoável. Smoke por node contra o modelo real em `%APPDATA%/Carcará Code`.
2. **Diff grande sintético** (~20k chars) → trunca, gera, não estoura.
3. **Diff pequeno** → comportamento idêntico ao de hoje.
4. **Só ruído** (ex.: só `package-lock.json`) → cai no resumo de arquivos e gera algo razoável.
5. **No app**: abrir a aba Git no projeto com as mudanças, clicar "✨ Gerar" → ver o contador subir e a mensagem aparecer, sem o toast de erro.

## Arquivos

- `llm-core.cjs` — `GEN.contextSize`, helper `fitToBudget`, uso no `generate()`.
- `src/components/GitPanel.jsx` — filtro de ruído + teto por arquivo + fallback de resumo em `generateCommit`.
