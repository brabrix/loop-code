# Element Selector Implementation Plan

> Execução inline. Projeto sem git/test-runner: cada tarefa fecha com `npm run build` + teste manual.

**Goal:** Seletor de elementos no preview que copia um pacote (seletor + HTML + estilos + arquivo:linha React) pro clipboard.

**Architecture:** Script injetado no webview via `executeJavaScript`; captura no clique e emite via `console.log` sentinela; `PreviewPanel` escuta `console-message`, copia e mostra toast.

**Tech Stack:** Electron webview, React, Tailwind. Sem deps novas, sem mudança no main.js.

## Global Constraints
- Sem preload novo no webview; sem nodeIntegration. Bridge = sentinela no console.
- Clipboard via `window.api.copyText` (já existe, handler `clip:write`).
- Identidade: destaque na cor "brasa" (`hsl(var(--primary))` ≈ #f2792b). Ver [[visual-identity]].
- Não pesar o boot; sem relançar o app sem ok ([[dont-kill-running-app]]).

---

### Task 1: grabScript.js (injeção + captura + fiber)

**Files:** Create `src/lib/grabScript.js`

**Interfaces:** Produces `export const INJECT` (string IIFE) e `export const CLEANUP` (string).

- [ ] Step 1: Criar o módulo com `INJECT` (overlay/hover/click/Esc + montagem do pacote + fiber React + `console.log('__CARCARA_GRAB__'+JSON.stringify({markdown}))`) e `CLEANUP` (remove overlay/listeners + apaga `window.__carcaraGrab`).
- [ ] Step 2: `npm run build` — valida sintaxe (módulo ainda não usado).

### Task 2: Wiring no PreviewPanel

**Files:** Modify `src/components/PreviewPanel.jsx`

**Interfaces:** Consumes `INJECT`/`CLEANUP`; usa `webview.executeJavaScript`, `console-message`, `window.api.copyText`.

- [ ] Step 1: Importar `INJECT`/`CLEANUP`; estado `grabbing` + `grabbed` (toast).
- [ ] Step 2: `ToolButton` (ícone `SquareDashedMousePointer`) no grupo da toolbar, visível com `mode==='web'`; toggle chama `toggleGrab`.
- [ ] Step 3: `toggleGrab` injeta/limpa no webview do projeto ativo; Esc desativa.
- [ ] Step 4: No `getWebview`, adicionar listener `console-message` que detecta o sentinela, copia via `window.api.copyText`, mostra toast e sai do modo.
- [ ] Step 5: Limpar o modo ao trocar de aba/projeto/parar o preview.
- [ ] Step 6: `npm run build` + teste manual: ativar, hover destaca, clique copia + toast; colar e conferir o pacote; Esc sai.

## Self-Review
- Payload universal + React → Task 1. ✅ · Clipboard + toast → Task 2. ✅ · Ativação botão/Esc → Task 2. ✅
- Sem deps/main.js. ✅ · Cleanup em troca de aba → Task 2 Step 5. ✅
