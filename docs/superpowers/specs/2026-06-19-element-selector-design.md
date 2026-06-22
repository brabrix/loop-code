# Element Selector ("grab") — Design

**Data:** 2026-06-19 · **Projeto:** Carcará Code · **Status:** Aprovado

## Resumo
Um seletor de elementos no preview (estilo "react grab"), pra **qualquer projeto**, que
**copia um pacote pro clipboard** pronto pra colar no Claude — resolvendo a dor do VS Code
(que só manda pro chat nativo, em vários passos).

Decisões fechadas: payload = **pacote pro Claude**; destino = **clipboard**; origem = **DOM
universal sempre + React (fiber) quando der**; ativação = **botão na toolbar do preview + Esc**.

## Arquitetura
Webview do preview recebe um script auto-contido via `webview.executeJavaScript()`. O script
faz highlight no hover e captura no clique; emite o pacote via `console.log('__CARCARA_GRAB__'+json)`.
O host (`PreviewPanel`) escuta `webview.addEventListener('console-message')`, copia via
`window.api.copyText` e mostra toast. Sem preload novo, sem nodeIntegration, sem mudança no `main.js`.

## Componentes
- `src/lib/grabScript.js` — exporta `INJECT` (string IIFE) e `CLEANUP` (string). Toda a lógica
  de overlay/captura/fiber vive aqui como texto a ser injetado.
- `src/components/PreviewPanel.jsx` — estado `grabbing`, `ToolButton` de ativar, injeta/limpa,
  listener `console-message`, toast "Elemento copiado!".

## Pacote copiado (markdown)
- Universal (sempre): seletor CSS, `outerHTML` enxuto (trunca >2000 chars), tamanho (WxH),
  estilos-chave (subset de getComputedStyle: color, background, font, padding, margin, border-radius, display).
- React quando der: componente (`_debugOwner`) + `arquivo:linha` (`_debugSource`) via fiber
  (`__reactFiber$…`). Sem fiber → omite.

## Comportamento
- Ativar: botão (ícone mira) visível só com `mode === 'web'`. Muda cursor, injeta script.
- Hover: caixa de destaque "brasa" + rótulo (tag.classe). Clique: `preventDefault`/`stopPropagation`,
  monta pacote, emite, e o host sai do modo + toast.
- Sair: Esc, clicar no botão de novo, ou após capturar. Cleanup remove overlay/listeners.
- Guard `window.__carcaraGrab` (idempotente). Trocar de aba/projeto limpa o modo.

## Erros / bordas
- `executeJavaScript` falha (página carregando) → não ativa, sem crash.
- `outerHTML` gigante → trunca com reticências.
- Esc/saída sempre limpa o overlay.

## Fora de escopo (YAGNI)
- Mandar pro chat; Vue/Svelte source; seleção múltipla / histórico.

## Sucesso
- Ativar no preview, passar o mouse (destaca), clicar → "Elemento copiado!" e o clipboard tem o
  pacote (com arquivo:linha num app React em dev). Esc sai limpo. Boot não regride.
