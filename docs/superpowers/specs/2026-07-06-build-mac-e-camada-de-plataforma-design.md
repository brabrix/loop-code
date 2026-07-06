# Build Mac + Camada de Plataforma (Win/Mac/Linux) — Design

**Data:** 2026-07-06
**Status:** aprovado (aguardando revisão da spec pelo usuário → writing-plans)

## 1. Contexto e objetivo

O Carcará Code já distribui **Windows** (`build-windows.yml` → `.exe` NSIS) e **Linux**
(`build-linux.yml` → `.AppImage`) via GitHub Actions + GitHub Releases. Falta o **Mac**.

Dois objetivos, decididos com o usuário:

1. **Distribuir uma versão Mac** — um `.dmg` **universal** (Intel + Apple Silicon),
   **não-assinado** por ora, construído no runner `macos-latest` do GitHub Actions e
   publicado no Releases, espelhando os workflows existentes. O repo é público, então
   os minutos de macOS são gratuitos.
2. **Criar uma camada de plataforma canônica** — um "lugar único" para diferenças de
   SO no código, análogo ao que o i18n é para strings traduzíveis, para (a) DRY e
   manutenção e (b) para o Claude Code saber onde colocar código de plataforma.

Uma auditoria de prontidão para macOS (2026-07-06) mostrou que **gerar o `.dmg` é a
parte fácil; fazer o app *funcionar* no Mac exige consertos**. O núcleo (terminal via
node-pty, checkpoints shadow-git, paths via `app.getPath`, SSH, git) é portável e bem
protegido por `process.platform`. Os problemas se concentram em 4 pontos: build,
PATH do shell, integração de menu/janela e o runtime PHP (100% Windows hoje).

## 2. Decisões tomadas (com o usuário)

| Decisão | Escolha | Motivo |
|---|---|---|
| Assinatura Mac | **Não-assinado agora**, assinar depois | US$99/ano da Apple adiado; mesma estratégia faseada do Windows (SignPath "pra depois") |
| Arquitetura do binário | **Universal** (Intel + Apple Silicon) | Um único download; público não-dev não precisa saber o chip |
| PHP no Mac | **Consertar agora, additive** | Adicionar ramo darwin **sem tocar** no caminho Windows; separar o código por plataforma |
| Estrutura cross-platform | **Módulo único canônico** (`src/platform.js`) | Padrão do `platform.ts` do VS Code; zero maquinaria de build; descobrível |

## 3. Fora de escopo (adiado, explícito)

- **Assinatura + notarização + auto-update no Mac** (US$99/ano) → fase 2. **Consequência
  aceita:** sem assinar, o `electron-updater` **não** auto-atualiza no Mac; cada versão
  nova é download manual do Releases (como já é o primeiro install hoje). O workflow
  ainda publica `latest-mac.yml` para facilitar ligar o auto-update na fase 2.
- **Sync do site** carcaracode.net (adicionar o download Mac) → follow-up (repo separado).
- **Cosméticos** achados na auditoria e que não bloqueiam: testes com paths `C:\`
  hardcoded, placeholder de UI com caminho Windows nos locales, `mouse-debug.log`
  versionado, ausência de ramo explícito para `zsh` (o fallback resolve).

## 4. Arquitetura: a camada de plataforma

O elemento estruturante. Todo o resto (build, PATH, menu, PHP) passa a **morar aqui**
em vez de virar `if (process.platform === ...)` espalhado.

### 4.1. Forma

Um **módulo canônico** — não um `.yaml`, não uma lib única. Espelha o
`src/vs/base/common/platform.ts` do VS Code. Ele combina **dado** e **comportamento**:

- **Tabela de dados** (objeto JS indexado por `process.platform`) — os *valores* por SO.
  Esta é a parte gêmea do i18n: adicionar um SO = adicionar uma chave.
- **Booleans** pré-computados (`isWin`, `isMac`, `isLinux`) — substituem as checagens
  espalhadas.
- **Funções finas** — o *comportamento* que não cabe numa tabela (resolver PATH,
  descompactar, escolher login shell).

```js
// src/platform.js  (booleans + tabela: SEM imports de Node — renderer também usa)
export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

export const P = {
  win32:  { shell: 'powershell.exe', exeExt: '.exe', phpAsset: 'win-x64',       openCmd: 'start'    },
  darwin: { shell: 'zsh',            exeExt: '',      phpAsset: 'macos-aarch64', openCmd: 'open'     },
  linux:  { shell: 'bash',           exeExt: '',      phpAsset: 'linux-x86_64',  openCmd: 'xdg-open' },
}[process.platform]
```

### 4.2. Separação de eixo (ressalva de escala do VS Code)

- **Booleans + tabela** → módulo **sem dependência de Node** (importável pelo renderer React).
- **Funções que usam `child_process`/`fs`/`fix-path`** → ficam no **main process**
  (ex.: `remote/platform.cjs` ou uma função exportada consumida só pelo main). Não
  misturar DOM e Node no mesmo arquivo.

O `phpAsset` na tabela deve considerar `process.arch` também (`macos-aarch64` vs
`macos-x86_64`); no build universal cada processo reporta seu próprio arch em runtime.

### 4.3. Como o Claude Code "sabe"

Uma seção nova no **CLAUDE.md** com a convenção explícita — é isso que faz o Claude
rotear código de SO para cá do mesmo jeito que hoje roteia strings para o i18n:

> **Diferenças de plataforma (Win/Mac/Linux):** nunca espalhe `process.platform`.
> Diferença de SO vai em `src/platform.js`. Se for um **valor** (nome de shell, URL de
> binário, extensão), vira chave na tabela `P`. Se for **comportamento**, vira uma
> função no módulo de plataforma do main. Adicionar suporte a um SO = preencher a
> coluna dele na tabela.

## 5. Componentes / trabalho

### A. Build & distribuição Mac

- **A1 — `package.json` › `build`:** adicionar bloco `mac` (target `dmg`,
  `arch: universal`, `icon: build/icon.icns`) e opcionalmente `dmg` (layout da janela).
  Adicionar `hardenedRuntime: false` explícito por ora (sem notarização). Script novo
  `pack:dmg` (`vite build && electron-builder --mac dmg --publish never`).
- **A2 — Ícone:** o `build/icon.png` atual tem ~2,7 KB (baixa resolução). Gerar/obter um
  PNG **1024×1024** e um `build/icon.icns` (ou deixar o electron-builder derivar do PNG
  ≥512px). Confirmar que o `.icns` resultante é válido.
- **A3 — `.github/workflows/build-mac.yml`:** espelhar `build-windows.yml`. Runner
  `macos-latest`; `actions/checkout` → `setup-node@20` → `npm ci` → `npm run pack:dmg`
  → `upload-artifact` (`release/*.dmg`) → `softprops/action-gh-release@v2` em tags `v*`
  (anexar `release/*.dmg` e `release/latest-mac.yml`). `permissions: contents: write`.
- **A4 — Instruções de 1ª abertura:** no README (e follow-up no site), explicar
  Ajustes → Privacidade e Segurança → "Abrir Mesmo Assim" para app não-assinado.

### B. PATH do login shell (crítico — sem isso o app é inútil no Mac)

Apps Electron GUI no macOS não herdam o PATH dos dotfiles (`.zshrc`/`.zprofile`), então
`claude`, `node`, `git`, `npm` podem dar "command not found" — e o app **é** um lançador
do `claude`.

- **B1 — Boot:** no arranque do main, em darwin, chamar `fix-path` (corrige
  `process.env.PATH` a partir do PATH do shell de login). Isso conserta de uma vez o
  `system:checkTools` ([main.js:3231+]), os spawns de git/npm e a resolução do `claude`.
  Encapsular como `fixLoginPath()` na camada de plataforma (no-op fora do darwin).
- **B2 — pty:** abrir o shell interativo como **login shell** no darwin
  ([remote/localPty.cjs:7] usa `args: []`) — ex.: `zsh -l` — para a sessão do terminal
  também enxergar o PATH completo. Usar `P.shell` da tabela.
- **Gotcha documentado:** `shell-env`/`fix-path` falham **silenciosamente** com shells
  não-POSIX (Fish, Nushell), caindo no PATH mínimo. Aceitável (raro no público-alvo),
  mas registrar em DESAFIOS.md.

### C. Integração de menu/janela macOS

- **C1 — Menu:** [main.js:377] faz `Menu.setApplicationMenu(null)`, que no Mac mata a
  barra inteira (some `Cmd+Q/C/V/H/M` e edição nativa). Em darwin, montar um template de
  menu nativo mínimo (app menu + Edit com os roles padrão) em vez de `null`. Manter o
  `null` no Windows (o comentário em main.js mira o problema de paste duplo do terminal).
- **C2 — Janela:** adicionar `app.on('activate', ...)` que recria a janela se não houver
  nenhuma — combinado com o `window-all-closed` que já não sai no darwin ([main.js:383]),
  hoje fechar a janela deixa o app vivo e **irreabrível** pelo dock.

### D. PHP additive para Mac

O runtime PHP é 100% Windows: baixa `php-*-Win32-*.zip`, usa `php.exe`, descompacta via
PowerShell ([php-runtime.cjs], [main.js:3398+]). Consertar de forma **additive**,
separando por plataforma, **sem alterar o caminho Windows**.

- **D1 — Fonte do binário darwin:** static-php-cli (`dl.static-php.dev`), assets
  `macos-aarch64` e `macos-x86_64` (bundle `common`, ~22 MB). URL/asset por
  `platform-arch` vira **dado** na tabela `P` (padrão tabela+SHA do ripgrep do VS Code),
  não branches de código. Considerar usar `php` do sistema se já existir no PATH
  (via `which`) antes de baixar.
- **D2 — Descompactar portável:** substituir o `Expand-Archive` do PowerShell por uma
  lib pura-JS (`extract-zip`) — e lidar com `.tar.gz` do static-php (usar o `tar` do
  Node/sistema ou lib equivalente). O ramo Windows continua usando o método atual.
- **D3 — Separação:** isolar a lógica de download/descompactação/caminho do binário PHP
  por plataforma (uma função por SO ou um branch fino que lê `P`), de modo que Windows e
  Mac não colidam.

### E. Camada de plataforma (refactor de base)

- **E1 — Criar `src/platform.js`** (booleans + tabela `P`, sem Node) e o módulo de
  comportamento do main (funções: `fixLoginPath`, escolha de shell, etc.).
- **E2 — Migrar** os `process.platform === 'win32'` existentes que a auditoria mapeou
  para consumir a camada, **sem mudar comportamento no Windows** (refactor mecânico,
  verificável). Prioridade: os pontos tocados por B/C/D; os demais podem ser migração
  incremental.
- **E3 — CLAUDE.md:** adicionar a seção de convenção (4.3).

### F. Bibliotecas a adotar

| Lib | Uso | Nota |
|---|---|---|
| `fix-path` | PATH do login shell no boot (darwin) | crítico; gotcha shells não-POSIX |
| `execa` | spawn cross-platform moderno | superset do `cross-spawn` |
| `which` | localizar `claude`/`node`/`php` no PATH | padrão de fato |
| `extract-zip` | descompactar sem PowerShell | puro-JS |
| `open` | abrir arquivos/URL no SO | opcional; onde ainda houver `start` manual |

## 6. Verificação / testes

- **Build:** o `build-mac.yml` conclui verde e o Release da tag `v*` tem o `.dmg`.
- **Funcional (exige um Mac):** abrir o `.dmg`, contornar o Gatekeeper, e confirmar que
  (a) o terminal encontra `claude`/`node`/`git`; (b) `Cmd+C/V/Q` funcionam; (c) fechar e
  reabrir pelo dock funciona; (d) preview PHP roda. *Ponto de atenção:* não temos Mac
  local — validar via CI onde possível e marcar os itens que dependem de um Mac real
  como verificação manual pós-merge.
- **Não-regressão Windows:** smokes existentes (`php-smoke.cjs`, `claude-sessions.smoke.cjs`)
  continuam passando; o build Windows continua verde. A camada de plataforma **não pode**
  mudar comportamento no Windows.
- **Lint/format:** ESLint 9 + Prettier passam (toolchain já existente).

## 7. Riscos e gotchas

- **Sem Mac para testar localmente** — a validação funcional depende do CI e de teste
  manual posterior. Mitigar mantendo os consertos pequenos e bem isolados na camada.
- **`fix-path` silencioso em Fish/Nushell** — registrar em DESAFIOS.md.
- **Universal dmg ~2× maior** — aceito.
- **Auto-update inativo no Mac** (não-assinado) — comunicado ao usuário; publicar
  `latest-mac.yml` mesmo assim para facilitar a fase 2.
- **PHP darwin `.tar.gz`** — formato diferente do `.zip` Windows; a descompactação precisa
  tratar tar+gzip, não só zip.

## 8. Follow-ups (fase 2)

1. Conta Apple Developer (US$99) → assinatura + notarização + auto-update no Mac.
2. Adicionar o download Mac no site carcaracode.net.
3. Migração incremental do restante dos `process.platform` para a camada.
4. Limpezas cosméticas da auditoria (testes com `C:\`, placeholder de UI, `mouse-debug.log`).
