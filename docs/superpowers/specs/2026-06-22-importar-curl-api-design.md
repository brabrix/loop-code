# Importar comando cURL na aba API — Design

**Data:** 2026-06-22
**Componente:** Aba "API" (REST connector) — [src/components/ApiPanel.jsx](../../../src/components/ApiPanel.jsx)

## Objetivo

Permitir que o usuário **cole um comando cURL** (copiado da documentação de uma API:
Stripe, OpenAI, etc.) e o app monte a chamada automaticamente, preenchendo método,
URL, query params, headers e corpo nos campos da UI.

O público é **não-técnico**. "Pedagógico" aqui significa **simples e lúdico** — não
ensinar nada. O usuário cola, os campos se preenchem sozinhos, sem telas extras nem
jargão.

## Princípio de arquitetura

A UI já tem `parseHttp(text)`, que converte um documento `.http` na forma
`{ method, url, params, headers, body }` consumida pelos `useState` do painel
(`loadSaved` usa esse fluxo). Vamos adicionar uma função irmã `parseCurl(text)`
que devolve **exatamente a mesma forma**, reusando todo o resto da UI sem mudanças.

Decisão: parser **próprio, puro, no renderer**. Sem dependência nova (mantém o boot
enxuto), do lado do código que já faz o equivalente para `.http`, e fácil de testar
isolado. (Alternativas descartadas: lib `curlconverter` no main — pesada e exagerada
para o escopo; e cURL→`.http`→`parseHttp` — dois parsers em série, mais frágil em
corpos JSON com quebras de linha.)

## Componentes

### 1. `parseCurl(text)` — função pura

Localização: módulo puro **`src/lib/curl.js`** (sem React/UI), importado pelo
`ApiPanel.jsx`. Espelha o que `parseHttp` faz, retornando a mesma forma
`{ method, url, params, headers, body }`. O módulo separado mantém o `ApiPanel.jsx`
focado e torna a função testável por Node (ver seção Testes). O helper `emptyRow`
necessário ao módulo é replicado/importado conforme conveniente.

**Passo 1 — Tokenizar.** Transforma o comando em uma lista de argumentos como um
shell faria:
- Normaliza continuação de linha: remove `\` seguido de quebra de linha, e o `^`
  de continuação do Windows.
- Respeita aspas simples (`'...'`, literal) e duplas (`"..."`).
- Quebra os tokens restantes por espaços.
- Descarta o primeiro token se for `curl`.

**Passo 2 — Varrer tokens** reconhecendo o subconjunto "comum das docs":

| Flag | Efeito |
|------|--------|
| `-X` / `--request` | define o método |
| `-H` / `--header` | header; separa no primeiro `:` em `{ key, val }` |
| `-d` / `--data` / `--data-raw` / `--data-binary` / `--data-ascii` | body; se não houver `-X`, método vira `POST` |
| `--json` | body **e** adiciona `Content-Type: application/json` se ausente |
| `-u` / `--user` | vira header `Authorization: Basic <base64(user:pass)>` |
| flags sem valor conhecidas (`-s`, `-L`, `-k`, `--compressed`, `-i`, `-v`, ...) | puladas sem quebrar |
| token solto que não é flag | candidato a URL (primeiro vence) |

Notas:
- Flags aceitam tanto `-H "x: y"` (valor no próximo token) quanto `-H"x: y"` /
  `--header=x: y` (valor colado/após `=`).
- Flags `-d` repetidas: concatenar com `&` (comportamento do cURL para form data).
  Suficiente para o escopo; não precisa ser perfeito.
- Fora de escopo (não implementar agora): `-F`/`--form` (multipart), `-b` (cookies),
  `-G` (query no GET). Se aparecerem, são ignoradas sem quebrar o parse.

**Passo 3 — Separar query da URL.** Reusar a lógica que `parseHttp` já tem: cortar
no `?`, decodificar cada par em `params` (`{ on: true, key, val }`).

**Passo 4 — Defaults.** Método `GET` se nada indicar outro; `params`/`headers`
vazios viram `[emptyRow()]`; `body` vazio vira `''`.

Se nenhuma URL for reconhecida → retorna `null` (sinaliza falha ao chamador).

### 2. Aplicação na UI — `applyCurl(text)`

Função no componente que chama `parseCurl` e, em caso de sucesso, popula os estados
(`setMethod/setUrl/setParams/setHeaders/setBody`), troca para a aba `params`, limpa
`res`/`err` e desmarca `currentName` — mesmo padrão de `loadSaved`. Mostra o feedback
de sucesso. Em caso de `null`, mostra o aviso de erro gentil (ver seção 4).

### 3. Pontos de entrada

Ambos chamam `applyCurl`.

- **Botão "Importar"** na barra de envio (linha do método/URL), ao lado de *Copiar*
  e *Salvar*. Ícone lucide (`ClipboardPaste`). Ao clicar, abre uma faixa fina
  reusando o padrão visual da barra de "Nome" (`naming`): um campo de texto com
  placeholder *"Cole aqui o comando que você copiou da documentação da API"* e
  botões **Importar** / **Cancelar**. Enter importa; Esc cancela.
- **Colar automático no campo de URL** (`onPaste` do `Input` de URL): se o texto
  colado, sem espaços à esquerda, começar com `curl`, faz `preventDefault` e chama
  `applyCurl(textoColado)` em vez de jogar o comando cru no campo.

### 4. Feedback (tom lúdico, sem jargão)

- **Sucesso:** aviso discreto e amigável **"Pronto! Sua chamada foi montada ✨"**,
  que some sozinho após ~1,8 s (reusa o padrão do estado `copied`).
- **Erro:** na faixa de import, mensagem gentil *"Não consegui entender esse
  comando. Confira se você copiou um cURL completo."* Sem stack trace, sem termos
  técnicos. (No colar automático, se falhar, cai no comportamento padrão de colar
  o texto — não atrapalha o usuário.)

## Tratamento de erro

`parseCurl` nunca lança: entrada inválida → `null`. `applyCurl` decide a mensagem.
URL sem esquema é tratada normalmente depois pela `normalizeUrl` que já existe no envio.

## Testes

O projeto **não tem runner de teste** (sem vitest; scripts: `dev/build/start/pack:exe`).
Seguir o padrão de **smoke test executável por Node**, como `mcp-core.cjs`.

Como `parseCurl` vive em `src/lib/curl.js` (módulo puro, sem React), é importável
diretamente por Node ESM no smoke test — sem bundler.

Casos de smoke (entrada → asserção):
1. **GET simples:** `curl https://api.exemplo.com/x` → método GET, URL correta.
2. **GET com query:** `curl 'https://api.exemplo.com/x?a=1&b=2'` → 2 params.
3. **POST com header + JSON:** `curl -X POST https://... -H "Content-Type: application/json" -d '{"a":1}'`
   → POST, header, body JSON.
4. **`-d` sem `-X`:** método infere POST.
5. **`--json`:** body + `Content-Type: application/json` adicionado.
6. **Multilinha com `\`:** comando quebrado em várias linhas → parse íntegro.
7. **`-u user:pass`:** vira header `Authorization: Basic ...`.
8. **Flags ruidosas** (`-sS -L --compressed`): ignoradas, parse íntegro.
9. **Lixo** (`"isso não é cURL"`): retorna `null`.

Local sugerido: `test/curl.smoke.mjs`, rodável com `node test/curl.smoke.mjs`.

## Fora de escopo (YAGNI)

- Multipart (`-F`), cookies (`-b`), `-G`.
- Importar múltiplas requests de uma vez.
- Tela de pré-visualização / explicação passo a passo do que foi detectado.
- Importar outros formatos (HAR, Postman collection).
