# Build Mac + Camada de Plataforma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribuir uma versão Mac (`.dmg` universal, não-assinada) construída no GitHub Actions e deixar o app funcional no macOS, sobre uma camada de plataforma canônica que centraliza as diferenças Win/Mac/Linux.

**Architecture:** Um módulo único `platform.cjs` (estilo `platform.ts` do VS Code) exporta booleans, uma tabela de valores por SO e funções finas de comportamento — todas parametrizáveis por plataforma para testabilidade. Os consertos de macOS (shell/PATH, menu/janela, PHP) passam a consumir essa camada em vez de espalhar `process.platform`. Windows e Linux não podem regredir.

**Tech Stack:** Electron 33 (main em CJS), Vite/React (renderer, não tocado aqui), node-pty, electron-builder 26, GitHub Actions, `fix-path` (nova dep), binários `which`/`tar` do próprio macOS, PHP estático do static-php-cli.

## Deviations from spec (intentional)

- **`platform.cjs` na raiz** (CJS), não `src/platform.js` — segue a convenção dos módulos de main process (`php-runtime.cjs`, `remote/*.cjs`); mantido Node-free para reuso futuro pelo renderer.
- **Única dep nova: `fix-path`** — `which`/`tar` vêm do macOS; sem `execa`/`extract-zip`/`open` (YAGNI).
- **Build universal como primário, fallback para dois `.dmg` por arch** se o merge universal do node-pty (nativo) falhar no CI.
- **SHA256 do PHP darwin é preenchido por ação** (comando fornecido) — não dá para saber o hash de um binário remoto de antemão; mesmo rigor do SHA do Windows que já é uma constante fixada.

## Global Constraints

- **Não regredir Windows nem Linux.** Todo caminho `win32`/`linux` existente deve permanecer byte-idêntico em comportamento. Toda função nova aceita `platform` como parâmetro (default `process.platform`) para teste cruzado.
- **Node ≥ 20** (workflows usam `setup-node@20`; `npm ci`).
- **Lint/format:** ESLint 9 + Prettier devem passar (`npm run lint`, `npm run format:check`). Husky/lint-staged roda no commit.
- **appId:** `com.carcara.code`. **productName:** `Carcará Code`. **publish:** github `Yg0rAndrade/carcara-code`.
- **App não-assinado no Mac** por ora: `identity: null`, `hardenedRuntime: false`, `CSC_IDENTITY_AUTO_DISCOVERY=false` no CI. Sem notarização.
- **Testes:** smokes em `scripts/*.smoke.cjs`/`scripts/*-smoke.cjs` rodados por `node`; adicionar script `test:*` no `package.json` para cada novo smoke.
- **`platform.cjs` é Node-free** (só `process`, sem `require` de `fs`/`child_process`/`electron`) — as funções que precisam de Node ficam nos módulos que já têm Node (`main.js`, `php-runtime.cjs`, `remote/localPty.cjs`).

---

### Task 1: Módulo de plataforma base (`platform.cjs`)

Cria a fundação: booleans + tabela por SO + seletor de shell/login-args, tudo puro e testável.

**Files:**
- Create: `platform.cjs`
- Create: `scripts/platform-smoke.cjs`
- Modify: `package.json` (adicionar script `test:platform`)

**Interfaces:**
- Produces:
  - `isWin: boolean`, `isMac: boolean`, `isLinux: boolean` (para o SO atual)
  - `TABLE: Record<'win32'|'darwin'|'linux', PlatEntry>` onde `PlatEntry = { shellDefault: string, shellEnv: string, loginArgs: string[], exeExt: string, openCmd: string }`
  - `tableFor(platform?: string): PlatEntry`
  - `shellFor(platform?: string, env?: object): string`
  - `loginArgsFor(platform?: string): string[]`

- [ ] **Step 1: Escrever o smoke que falha**

Create `scripts/platform-smoke.cjs`:

```js
// Smoke da camada de plataforma. Uso: node scripts/platform-smoke.cjs
const {
  TABLE,
  tableFor,
  shellFor,
  loginArgsFor,
  isWin,
  isMac,
  isLinux,
} = require('../platform.cjs');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

// tabela cobre os 3 SOs
for (const os of ['win32', 'darwin', 'linux']) {
  assert(TABLE[os], `TABLE tem ${os}`);
  assert(typeof TABLE[os].shellDefault === 'string', `${os}.shellDefault é string`);
  assert(Array.isArray(TABLE[os].loginArgs), `${os}.loginArgs é array`);
}

// tableFor faz fallback para linux em SO desconhecido
assert(tableFor('sunos') === TABLE.linux, 'SO desconhecido cai em linux');
assert(tableFor('win32') === TABLE.win32, 'tableFor win32');

// shellFor preserva o comportamento do antigo shellForOS
assert(shellFor('win32', {}) === 'powershell.exe', 'win sem COMSPEC -> powershell');
assert(shellFor('win32', { COMSPEC: 'cmd.exe' }) === 'cmd.exe', 'win respeita COMSPEC');
assert(shellFor('darwin', {}) === 'zsh', 'mac sem SHELL -> zsh');
assert(shellFor('darwin', { SHELL: '/bin/bash' }) === '/bin/bash', 'mac respeita SHELL');
assert(shellFor('linux', {}) === 'bash', 'linux sem SHELL -> bash');

// loginArgsFor: só o mac usa login shell
assert(JSON.stringify(loginArgsFor('darwin')) === '["-l"]', 'mac -> -l');
assert(JSON.stringify(loginArgsFor('win32')) === '[]', 'win -> sem args');
assert(JSON.stringify(loginArgsFor('linux')) === '[]', 'linux -> sem args');

// booleans batem com o SO atual
assert(isWin === (process.platform === 'win32'), 'isWin');
assert(isMac === (process.platform === 'darwin'), 'isMac');
assert(isLinux === (process.platform === 'linux'), 'isLinux');

console.log('platform-smoke OK');
```

- [ ] **Step 2: Rodar o smoke e ver falhar**

Run: `node scripts/platform-smoke.cjs`
Expected: FAIL — `Cannot find module '../platform.cjs'`

- [ ] **Step 3: Implementar `platform.cjs`**

Create `platform.cjs`:

```js
'use strict';
// Camada canônica de plataforma (Win/Mac/Linux). Ver CLAUDE.md › "Diferenças de
// plataforma". Node-free de propósito: só depende de `process`. Comportamento por SO
// que precise de fs/child_process vive nos módulos que já têm Node.

// TABELA = valores puros por SO (o "locale" de plataforma). Adicionar suporte a um
// SO = preencher a coluna dele aqui.
const TABLE = {
  win32: { shellDefault: 'powershell.exe', shellEnv: 'COMSPEC', loginArgs: [], exeExt: '.exe', openCmd: 'start' },
  darwin: { shellDefault: 'zsh', shellEnv: 'SHELL', loginArgs: ['-l'], exeExt: '', openCmd: 'open' },
  linux: { shellDefault: 'bash', shellEnv: 'SHELL', loginArgs: [], exeExt: '', openCmd: 'xdg-open' },
};

function tableFor(platform = process.platform) {
  return TABLE[platform] || TABLE.linux;
}

// Shell interativo do SO (preserva o antigo shellForOS: win usa COMSPEC, resto usa SHELL).
function shellFor(platform = process.platform, env = process.env) {
  const t = tableFor(platform);
  return env[t.shellEnv] || t.shellDefault;
}

// Args para abrir o shell como login shell (só o macOS precisa, p/ herdar o PATH).
function loginArgsFor(platform = process.platform) {
  return tableFor(platform).loginArgs;
}

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

module.exports = { TABLE, tableFor, shellFor, loginArgsFor, isWin, isMac, isLinux };
```

- [ ] **Step 4: Adicionar o script de teste**

In `package.json`, dentro de `"scripts"`, após a linha `"test:rail": "node scripts/rail-smoke.cjs"`, adicionar (lembre da vírgula na linha anterior):

```json
    "test:rail": "node scripts/rail-smoke.cjs",
    "test:platform": "node scripts/platform-smoke.cjs"
```

- [ ] **Step 5: Rodar o smoke e ver passar**

Run: `npm run test:platform`
Expected: `platform-smoke OK`

- [ ] **Step 6: Lint e commit**

Run: `npm run lint` (deve passar)

```bash
git add platform.cjs scripts/platform-smoke.cjs package.json
git commit -m "feat(platform): módulo canônico de plataforma (booleans + tabela + shell/login)"
```

---

### Task 2: Build Mac — config, script, ícone e workflow

Configura o electron-builder para gerar o `.dmg` universal e cria o workflow espelhando o de Windows. Sem isso não há artefato Mac.

**Files:**
- Modify: `package.json` (bloco `build.mac`, `build.dmg`, script `pack:dmg`)
- Create: `build/icon.icns` (ou PNG 1024 que o electron-builder converte)
- Create: `.github/workflows/build-mac.yml`

**Interfaces:**
- Produces: script npm `pack:dmg`; artefato `release/*.dmg`; feed `release/latest-mac.yml`.

- [ ] **Step 1: Ícone Mac (input necessário)**

O `build/icon.png` atual tem ~2,7 KB (resolução insuficiente; o electron-builder exige ≥512×512, ideal 1024×1024). Gerar um PNG 1024 a partir do maior frame do `.ico` existente:

Run (requer ImageMagick; se indisponível, ver nota abaixo):
```bash
magick "build/icon.ico[0]" -resize 1024x1024 build/icon-1024.png
```
Depois converter para `.icns` — **no macOS/CI** (o `iconutil` só existe no mac). Como o build roda em `macos-latest`, a alternativa mais simples e portável é **deixar o electron-builder gerar o `.icns` a partir de um PNG 1024**: renomeie/coloque o PNG 1024 como `build/icon.png` (substituindo o pequeno) — o electron-builder cria o `.icns` no build do mac automaticamente.

Nota de qualidade: se o upscale do `.ico` ficar borrado, **peça ao usuário o asset de marca em 1024×1024** (o ícone do carcará em alta) e use-o como `build/icon.png`. Não prossiga com um ícone visivelmente ruim.

- [ ] **Step 2: Adicionar os blocos `mac` e `dmg` ao `package.json`**

In `package.json`, dentro de `"build"`, após o bloco `"linux": { ... }` (que termina em `}` na linha do `artifactName` do linux), adicionar (vírgula após o `}` do linux):

```json
    "linux": {
      "target": "AppImage",
      "icon": "build/icon.png",
      "category": "Development",
      "artifactName": "CarcaraCode-${version}.AppImage"
    },
    "mac": {
      "target": "dmg",
      "icon": "build/icon.png",
      "category": "public.app-category.developer-tools",
      "hardenedRuntime": false,
      "identity": null,
      "artifactName": "CarcaraCode-${version}-universal.dmg"
    },
    "dmg": {
      "title": "Carcará Code ${version}"
    }
```

Nota: `"icon": "build/icon.png"` (1024) faz o electron-builder derivar o `.icns`. `identity: null` = não tenta assinar (build ad-hoc, sem cert).

- [ ] **Step 3: Adicionar o script `pack:dmg`**

In `package.json` › `"scripts"`, após `"pack:appimage"`, adicionar:

```json
    "pack:appimage": "vite build && electron-builder --linux AppImage --publish never",
    "pack:dmg": "vite build && electron-builder --mac dmg --universal --publish never",
```

- [ ] **Step 4: Criar o workflow `build-mac.yml`**

Create `.github/workflows/build-mac.yml`:

```yaml
name: Build macOS

# Quando este build roda:
#  - Manualmente, pelo botão "Run workflow" na aba Actions do GitHub
#  - Automaticamente, quando você cria uma tag começando com "v" (ex: v0.1.0)
on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    runs-on: macos-latest

    steps:
      - name: Baixar o código
        uses: actions/checkout@v4

      - name: Instalar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Instalar dependências
        run: npm ci

      - name: Gerar o instalador (.dmg universal)
        env:
          # App não-assinado por ora: impede o electron-builder de procurar cert.
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        run: npm run pack:dmg

      - name: Publicar o .dmg como artefato
        uses: actions/upload-artifact@v4
        with:
          name: CarcaraCode-macOS
          path: release/*.dmg
          retention-days: 30
          if-no-files-found: error

      - name: Publicar Release (somente em tags)
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: |
            release/*.dmg
            release/latest-mac.yml
          generate_release_notes: true
```

- [ ] **Step 5: Validar YAML e config localmente**

Run: `npm run format:check` (o Prettier valida o YAML e o JSON)
Expected: passa (se acusar formatação, rode `npm run format` e re-cheque).

Run (sanidade do JSON do package.json):
```bash
node -e "const b=require('./package.json').build; if(b.mac.target!=='dmg')throw 'mac target'; if(b.mac.identity!==null)throw 'identity'; console.log('build.mac OK')"
```
Expected: `build.mac OK`

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/build-mac.yml build/icon.png
git commit -m "build(mac): target dmg universal não-assinado + workflow build-mac.yml"
```

- [ ] **Step 7: Verificação em CI (manual, pós-merge)**

Disparar o workflow "Build macOS" manualmente (aba Actions → Run workflow) e confirmar que conclui verde e produz o artefato `.dmg`.
**Risco conhecido:** o merge universal do node-pty (módulo nativo) pode falhar em `@electron/universal` se não houver prebuild para as duas arquiteturas. **Se falhar:** trocar para dois `.dmg` por arch — em `pack:dmg` remover `--universal` e rodar `electron-builder --mac dmg --x64 --arm64`; ajustar `artifactName` para `CarcaraCode-${version}-${arch}.dmg`. Registrar o desfecho em `DESAFIOS.md`.

---

### Task 3: Shell de login no pty (PATH — parte 1)

Faz o terminal do app abrir o shell como login shell no macOS, para herdar o PATH do usuário (senão `claude`/`node`/`git` somem). Consome a camada da Task 1.

**Files:**
- Modify: `remote/localPty.cjs` (aceitar `shellArgs`)
- Modify: `main.js:1980-1983` (remover `shellForOS`), `main.js:2003-2010` (usar a camada)
- Modify: `scripts/platform-smoke.cjs` (já cobre `shellFor`/`loginArgsFor`; sem mudança)

**Interfaces:**
- Consumes: `platform.shellFor()`, `platform.loginArgsFor()` (Task 1).
- Produces: `LocalPty` agora aceita `shellArgs?: string[]` (default `[]`, comportamento atual preservado).

- [ ] **Step 1: Escrever teste que falha (LocalPty passa shellArgs ao ptyLib)**

Create `scripts/localpty-smoke.cjs`:

```js
// Smoke do LocalPty: confirma que shell e shellArgs chegam ao ptyLib.
const { LocalPty } = require('../remote/localPty.cjs');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

let captured = null;
const fakePtyLib = {
  spawn(shell, args, opts) {
    captured = { shell, args, opts };
    return { write() {}, resize() {}, onData() {}, onExit() {}, kill() {} };
  },
};

// Com shellArgs explícito (caso macOS login shell)
new LocalPty({ ptyLib: fakePtyLib, shell: 'zsh', shellArgs: ['-l'], env: {}, cwd: '/tmp', cols: 80, rows: 24 });
assert(captured.shell === 'zsh', 'shell repassado');
assert(JSON.stringify(captured.args) === '["-l"]', 'shellArgs repassado ao ptyLib');

// Sem shellArgs: mantém o comportamento antigo (array vazio)
new LocalPty({ ptyLib: fakePtyLib, shell: 'bash', env: {}, cwd: '/tmp', cols: 80, rows: 24 });
assert(JSON.stringify(captured.args) === '[]', 'sem shellArgs -> []');

console.log('localpty-smoke OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/localpty-smoke.cjs`
Expected: FAIL — `ASSERT: shellArgs repassado ao ptyLib` (hoje o LocalPty ignora e passa `[]`).

- [ ] **Step 3: Implementar `shellArgs` no LocalPty**

In `remote/localPty.cjs`, alterar o constructor:

```js
  constructor({ ptyLib, shell, shellArgs, env, cwd, cols, rows }) {
    this.proc = ptyLib.spawn(shell, shellArgs || [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      env,
    });
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node scripts/localpty-smoke.cjs`
Expected: `localpty-smoke OK`

- [ ] **Step 5: Trocar `shellForOS` pela camada no main.js**

In `main.js`, remover a função `shellForOS` (linhas 1980-1983):

```js
// ---------- Terminal (Claude Code de verdade, via node-pty) ----------
function shellForOS() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe';
  return process.env.SHELL || 'bash';
}
```

Substituir por (só o comentário-cabeçalho, sem a função):

```js
// ---------- Terminal (Claude Code de verdade, via node-pty) ----------
```

Garantir que a camada esteja importada no topo do `main.js` — junto dos outros `require` de módulos locais (perto de `const { LocalPty } = require('./remote/localPty.cjs');`, linha 32), adicionar:

```js
const platform = require('./platform.cjs');
```

Em `main.js:2003-2010`, trocar a criação do `LocalPty`:

```js
    return new LocalPty({
      ptyLib: pty,
      shell: platform.shellFor(),
      shellArgs: platform.loginArgsFor(),
      env: cleanEnv(),
      cwd: projectPath,
      cols,
      rows,
    });
```

- [ ] **Step 6: Registrar o gotcha em DESAFIOS.md**

In `DESAFIOS.md`, acrescentar ao final:

```markdown

## PATH em app GUI no macOS
Apps Electron no macOS não herdam o PATH dos dotfiles (`.zshrc`). O pty agora abre
como login shell (`zsh -l`, via `platform.loginArgsFor()`), e o boot chama `fix-path`
(ver Task 4). Gotcha: `fix-path`/`shell-env` falham SILENCIOSAMENTE com shells
não-POSIX (Fish, Nushell), caindo no PATH mínimo — raro no público-alvo, mas se um
usuário reportar "claude não encontrado" no Mac com shell exótico, é isto.
```

- [ ] **Step 7: Adicionar script de teste, lint e commit**

In `package.json` › `"scripts"`, após `"test:platform"`, adicionar:

```json
    "test:platform": "node scripts/platform-smoke.cjs",
    "test:localpty": "node scripts/localpty-smoke.cjs"
```

Run: `npm run test:platform && npm run test:localpty && npm run lint`
Expected: ambos smokes OK e lint limpo.

```bash
git add remote/localPty.cjs main.js scripts/localpty-smoke.cjs package.json DESAFIOS.md
git commit -m "feat(mac): login shell no pty via camada de plataforma (PATH parte 1)"
```

---

### Task 4: `fix-path` no boot (PATH — parte 2)

Corrige `process.env.PATH` do processo main no macOS, para que `system:checkTools`, os spawns de git/npm e a resolução do `claude` enxerguem as ferramentas do usuário.

**Files:**
- Modify: `package.json` (dep `fix-path`)
- Modify: `platform.cjs` (função `fixLoginPath`)
- Modify: `scripts/platform-smoke.cjs` (testar o no-op em win)
- Modify: `main.js:348` (chamar no `whenReady`)

**Interfaces:**
- Consumes: dep `fix-path`.
- Produces: `platform.fixLoginPath(platform?: string): Promise<boolean>` — no-op fora de darwin/linux (retorna `false` sem lançar); em darwin/linux importa `fix-path` e corrige o PATH (retorna `true`; idempotente).

- [ ] **Step 1: Instalar a dep**

Run: `npm install fix-path`
Expected: `fix-path` aparece em `dependencies` do `package.json`.

- [ ] **Step 2: Escrever teste do no-op (roda em Windows)**

In `scripts/platform-smoke.cjs`, antes da linha `console.log('platform-smoke OK');`, adicionar:

```js
// fixLoginPath é no-op seguro fora de darwin/linux (não lança, retorna false)
const { fixLoginPath } = require('../platform.cjs');
(async () => {
  const r = await fixLoginPath('win32');
  assert(r === false, 'fixLoginPath no-op em win32 -> false');
})();
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node scripts/platform-smoke.cjs`
Expected: FAIL — `fixLoginPath is not a function`.

- [ ] **Step 4: Implementar `fixLoginPath` em `platform.cjs`**

In `platform.cjs`, antes do `module.exports`, adicionar:

```js
// Corrige o PATH do processo em apps GUI no macOS/Linux (que não herdam o PATH do
// shell de login). No-op no Windows. Idempotente. `fix-path` é ESM-only, por isso o
// import dinâmico. Falha em silêncio (retorna false) se a lib não carregar.
let _pathFixed = false;
async function fixLoginPath(platform = process.platform) {
  if (platform !== 'darwin' && platform !== 'linux') return false;
  if (_pathFixed) return true;
  try {
    const mod = await import('fix-path');
    (mod.default || mod)();
    _pathFixed = true;
    return true;
  } catch {
    return false;
  }
}
```

E incluir `fixLoginPath` no `module.exports`:

```js
module.exports = { TABLE, tableFor, shellFor, loginArgsFor, fixLoginPath, isWin, isMac, isLinux };
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:platform`
Expected: `platform-smoke OK`

- [ ] **Step 6: Chamar no boot do main**

In `main.js`, no início do callback de `app.whenReady().then(() => {` (linha 348), como primeira instrução dentro do `.then`, adicionar a correção do PATH antes de tudo que depende de ferramentas externas:

```js
app.whenReady().then(async () => {
  await platform.fixLoginPath(); // macOS/Linux: herda o PATH do usuário (acha claude/node/git)
  secretStore = makeSecretStore({
```

(Note a mudança de `() => {` para `async () => {`.)

- [ ] **Step 7: Lint e commit**

Run: `npm run lint && npm run test:platform`
Expected: limpo e OK.

```bash
git add package.json package-lock.json platform.cjs scripts/platform-smoke.cjs main.js
git commit -m "feat(mac): fix-path no boot p/ herdar PATH do usuário (PATH parte 2)"
```

- [ ] **Step 8: Verificação (manual, exige Mac)**

Pós-merge, num Mac: abrir o app, ir à tela de preparo/1º uso e confirmar que `git`/`node`/`npm`/`claude` aparecem como encontrados, e que uma sessão nova de terminal roda `claude`.

---

### Task 5: Menu e janela no macOS

Restaura um menu de aplicação nativo no macOS (Cmd+Q/C/V/H) e o handler `activate` para reabrir a janela pelo dock, sem afetar o Windows.

**Files:**
- Modify: `platform.cjs` (função pura `macMenuTemplate`)
- Modify: `scripts/platform-smoke.cjs` (testar a forma do template)
- Modify: `main.js:377` (menu por plataforma) e `main.js:379-384` (handler `activate`)

**Interfaces:**
- Consumes: `platform.isMac`.
- Produces: `platform.macMenuTemplate(appName: string): object[]` — template do `Menu.buildFromTemplate` para darwin (app menu + Edit + Window).

- [ ] **Step 1: Teste da forma do template (roda em Windows)**

In `scripts/platform-smoke.cjs`, antes do `console.log('platform-smoke OK');`, adicionar:

```js
// macMenuTemplate: forma mínima esperada
const { macMenuTemplate } = require('../platform.cjs');
const tpl = macMenuTemplate('Carcará Code');
assert(Array.isArray(tpl) && tpl.length >= 2, 'template é array com >=2 menus');
assert(tpl[0].label === 'Carcará Code', 'primeiro menu = nome do app');
const roles = JSON.stringify(tpl);
assert(roles.includes('"quit"'), 'tem role quit (Cmd+Q)');
assert(roles.includes('"copy"') && roles.includes('"paste"'), 'tem copy/paste no Edit');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/platform-smoke.cjs`
Expected: FAIL — `macMenuTemplate is not a function`.

- [ ] **Step 3: Implementar `macMenuTemplate`**

In `platform.cjs`, antes do `module.exports`, adicionar:

```js
// Template de menu nativo do macOS. Sem ele (setApplicationMenu(null)), o mac perde
// Cmd+Q/C/V/H e a edição nativa. Só roles padrão — o Electron traduz p/ os itens do SO.
function macMenuTemplate(appName) {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ];
}
```

Incluir no `module.exports`:

```js
module.exports = { TABLE, tableFor, shellFor, loginArgsFor, fixLoginPath, macMenuTemplate, isWin, isMac, isLinux };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:platform`
Expected: `platform-smoke OK`

- [ ] **Step 5: Menu por plataforma no main.js**

In `main.js:377`, trocar:

```js
  Menu.setApplicationMenu(null);
  createWindow();
```

por:

```js
  // Windows: sem menu (evita o paste duplo no terminal — ver comentário acima).
  // macOS: menu nativo (Cmd+Q/C/V/H) — sem ele o app fica sem atalhos essenciais.
  if (platform.isMac) {
    Menu.setApplicationMenu(Menu.buildFromTemplate(platform.macMenuTemplate(APP_NAME)));
  } else {
    Menu.setApplicationMenu(null);
  }
  createWindow();
```

- [ ] **Step 6: Handler `activate` (reabrir janela pelo dock)**

In `main.js`, após o bloco `app.on('window-all-closed', ...)` (termina na linha 384), adicionar:

```js
// macOS: clicar no ícone do dock com nenhuma janela aberta recria a janela.
app.on('activate', () => {
  const { BrowserWindow } = require('electron');
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

(Se `BrowserWindow` já estiver importado no topo do arquivo, use o import existente em vez do `require` inline.)

- [ ] **Step 7: Lint e commit**

Run: `npm run lint && npm run test:platform`
Expected: limpo e OK.

```bash
git add platform.cjs scripts/platform-smoke.cjs main.js
git commit -m "feat(mac): menu nativo + activate p/ reabrir janela pelo dock"
```

- [ ] **Step 8: Verificação (manual, exige Mac) — ATENÇÃO ao paste duplo**

Pós-merge, num Mac: (a) `Cmd+Q`, `Cmd+C/V` em inputs, `Cmd+H` funcionam; (b) fechar a janela e clicar no dock reabre; (c) **colar (Cmd+V) no terminal xterm NÃO duplica o texto**. O menu do Windows foi removido justamente por causa do paste duplo (main.js:371-376); no mac o role `paste` pode reintroduzir isso. **Se duplicar:** remover o item `{ role: 'paste' }` do template e tratar Cmd+V no renderer via `term.paste()` com `preventDefault` no container do xterm. Registrar em `DESAFIOS.md`.

---

### Task 6: PHP additive para macOS

Adiciona um caminho darwin ao runtime PHP (usa `php` do sistema se houver, senão baixa o binário estático do static-php-cli e extrai com `tar`), **sem alterar o caminho Windows**.

**Files:**
- Modify: `php-runtime.cjs` (funções puras + ramificação em `ensurePhpRuntime`/`extractZip`)
- Modify: `scripts/php-smoke.cjs` (testar as novas funções puras; asserts do Windows intactos)

**Interfaces:**
- Consumes: `which`/`tar` do sistema (darwin), `child_process.spawnSync`.
- Produces (em `php-runtime.cjs`):
  - `phpBinaryName(platform?: string): string` — `'php.exe'` em win32, `'php'` no resto.
  - `phpAssetFor(platform: string, arch: string): { name: string, urls: string[], sha256: string } | null` — win32 retorna o asset atual; darwin retorna o tarball static-php por arch; senão `null`.
  - `ensurePhpRuntime` inalterado na assinatura; internamente ramifica por SO.

- [ ] **Step 1: Testes das funções puras (rodam em Windows)**

In `scripts/php-smoke.cjs`, importar as novas funções — alterar o bloco de `require` do topo:

```js
const {
  detectProjectType,
  resolvePhpDocroot,
  buildPhpServeArgs,
  isVcRedistError,
  verifySha256,
  PHP_VERSION,
  PHP_ZIP_NAME,
  PHP_DOWNLOAD_URLS,
  PHP_SHA256,
  phpBinaryName,
  phpAssetFor,
} = require('../php-runtime.cjs');
```

E antes de `console.log('\nphp-smoke OK');`, adicionar:

```js
  // phpBinaryName
  assert(phpBinaryName('win32') === 'php.exe', 'win -> php.exe');
  assert(phpBinaryName('darwin') === 'php', 'mac -> php');
  assert(phpBinaryName('linux') === 'php', 'linux -> php');

  // phpAssetFor: win32 espelha as constantes atuais
  const win = phpAssetFor('win32', 'x64');
  assert(win && win.name === PHP_ZIP_NAME, 'asset win = PHP_ZIP_NAME');
  assert(win.sha256 === PHP_SHA256, 'asset win sha = PHP_SHA256');

  // phpAssetFor: darwin por arch
  const macArm = phpAssetFor('darwin', 'arm64');
  assert(macArm && /aarch64/.test(macArm.name), 'darwin arm64 -> aarch64');
  assert(macArm.urls.every((u) => u.endsWith(macArm.name)), 'urls darwin terminam no asset');
  const macIntel = phpAssetFor('darwin', 'x64');
  assert(macIntel && /x86_64/.test(macIntel.name), 'darwin x64 -> x86_64');
  console.log('phpBinaryName/phpAssetFor ok');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/php-smoke.cjs`
Expected: FAIL — `phpBinaryName is not a function`.

- [ ] **Step 3: Obter os SHA256 dos binários darwin (ação)**

Descobrir a versão disponível e os hashes no índice do static-php-cli. Abrir `https://dl.static-php.dev/static-php-cli/common/` e localizar os arquivos `php-<versão>-cli-macos-aarch64.tar.gz` e `php-<versão>-cli-macos-x86_64.tar.gz` (bundle CLI). Para cada, baixar e computar o sha256:

```bash
curl -L -o /tmp/php-arm.tar.gz "https://dl.static-php.dev/static-php-cli/common/php-<VERSAO>-cli-macos-aarch64.tar.gz"
shasum -a 256 /tmp/php-arm.tar.gz    # ou: sha256sum
curl -L -o /tmp/php-x64.tar.gz "https://dl.static-php.dev/static-php-cli/common/php-<VERSAO>-cli-macos-x86_64.tar.gz"
shasum -a 256 /tmp/php-x64.tar.gz
```

Anotar `<VERSAO>` e os dois hashes para usar no Step 4. Se o provedor publicar um arquivo de checksum ao lado (`.sha256`), preferir conferir contra ele.

- [ ] **Step 4: Implementar as funções e a ramificação no `php-runtime.cjs`**

In `php-runtime.cjs`, após o bloco de constantes do Windows (após a linha `];` que fecha `PHP_DOWNLOAD_URLS`, ~linha 75), adicionar:

```js
// --- Runtime PHP no macOS (static-php-cli) -----------------------------
// Binários estáticos: https://dl.static-php.dev/static-php-cli/common/
// Preencher VERSAO/SHA com os valores obtidos do índice (ver plano, Task 6 Step 3).
const PHP_MAC_VERSION = '<VERSAO>';
const PHP_MAC = {
  arm64: {
    name: `php-${PHP_MAC_VERSION}-cli-macos-aarch64.tar.gz`,
    sha256: '<SHA_ARM64>',
  },
  x64: {
    name: `php-${PHP_MAC_VERSION}-cli-macos-x86_64.tar.gz`,
    sha256: '<SHA_X64>',
  },
};
const PHP_MAC_URL_BASE = 'https://dl.static-php.dev/static-php-cli/common/';

function phpBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'php.exe' : 'php';
}

function phpAssetFor(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') {
    return { name: PHP_ZIP_NAME, urls: PHP_DOWNLOAD_URLS.slice(), sha256: PHP_SHA256 };
  }
  if (platform === 'darwin') {
    const key = arch === 'arm64' ? 'arm64' : 'x64';
    const a = PHP_MAC[key];
    return { name: a.name, urls: [PHP_MAC_URL_BASE + a.name], sha256: a.sha256 };
  }
  return null; // linux fora de escopo por ora
}
```

Renomear a função `extractZip` para incluir o caso tar.gz. Trocar a assinatura e o corpo de `extractZip` (linhas ~118-138) por uma função `extractArchive`:

```js
function extractArchive(archivePath, destDir, platform = process.platform) {
  if (platform === 'win32') {
    // Windows: Expand-Archive do PowerShell (sem dependência npm).
    const psQuote = (p) => String(p).replace(/'/g, "''");
    const r = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${psQuote(archivePath)}' -DestinationPath '${psQuote(destDir)}' -Force`,
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      throw new Error('falha ao extrair o PHP: ' + (r.stderr || r.error?.message || 'erro desconhecido'));
    }
    return;
  }
  // macOS/Linux: tar do sistema (sempre presente no macOS).
  const r = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error('falha ao extrair o PHP: ' + (r.stderr || r.error?.message || 'erro desconhecido'));
  }
}
```

Reescrever `ensurePhpRuntime` (linhas ~140-187) para ramificar por SO, preservando o caminho Windows:

```js
async function ensurePhpRuntime({ cacheBaseDir, onPhase }) {
  const phase = (m) => {
    if (onPhase) onPhase(m);
  };
  const plat = process.platform;
  const asset = phpAssetFor(plat, process.arch);
  const binName = phpBinaryName(plat);

  // macOS: se já existe um php no PATH do usuário, usa-o (evita download).
  if (plat === 'darwin') {
    const sys = spawnSync('which', ['php'], { encoding: 'utf8' });
    if (sys.status === 0 && sys.stdout && sys.stdout.trim()) {
      return sys.stdout.trim();
    }
  }
  if (!asset) throw new Error('runtime PHP não disponível nesta plataforma ainda.');

  const versionDir = path.join(cacheBaseDir, plat === 'win32' ? PHP_VERSION : PHP_MAC_VERSION);
  const phpBin = path.join(versionDir, binName);
  if (fs.existsSync(phpBin)) return phpBin; // cache hit

  fs.mkdirSync(versionDir, { recursive: true });
  const archivePath = path.join(versionDir, asset.name);

  phase('Baixando PHP (primeira vez)…');
  try {
    await downloadFirstAvailable(asset.urls, archivePath);
  } catch (e) {
    try { fs.rmSync(archivePath, { force: true }); } catch {}
    throw new Error('Não foi possível baixar o PHP (verifique a conexão). ' + e.message);
  }

  phase('Verificando o download…');
  const ok = await verifySha256(archivePath, asset.sha256);
  if (!ok) {
    try { fs.rmSync(archivePath, { force: true }); } catch {}
    throw new Error('Checksum do PHP não confere — download abortado por segurança.');
  }

  phase('Extraindo o PHP…');
  try {
    extractArchive(archivePath, versionDir, plat);
  } catch (e) {
    try { fs.rmSync(archivePath, { force: true }); } catch {}
    throw new Error('Falha ao extrair o PHP: ' + e.message);
  }
  try { fs.rmSync(archivePath, { force: true }); } catch {}

  if (!fs.existsSync(phpBin)) {
    throw new Error(binName + ' não encontrado após a extração.');
  }
  if (plat !== 'win32') {
    try { fs.chmodSync(phpBin, 0o755); } catch {}
  }
  return phpBin;
}
```

Atualizar o `module.exports` (linhas ~189-200) para incluir as novas funções:

```js
module.exports = {
  detectProjectType,
  resolvePhpDocroot,
  buildPhpServeArgs,
  isVcRedistError,
  verifySha256,
  PHP_VERSION,
  PHP_ZIP_NAME,
  PHP_DOWNLOAD_URLS,
  PHP_SHA256,
  phpBinaryName,
  phpAssetFor,
  ensurePhpRuntime,
};
```

Nota: o tarball do static-php pode extrair para um nome como `php` diretamente no `versionDir` (caso comum do bundle CLI) — se extrair para uma subpasta, ajustar `phpBin` no Step 6 de verificação. O `startPhpPreview` em `main.js:3431` já usa o caminho retornado, então não muda.

- [ ] **Step 5: Rodar o smoke e ver passar (Windows intacto)**

Run: `node scripts/php-smoke.cjs`
Expected: `php-smoke OK` — incluindo `phpBinaryName/phpAssetFor ok`, e todos os asserts antigos do Windows continuam passando.

- [ ] **Step 6: Lint e commit**

Run: `npm run lint`
Expected: limpo.

```bash
git add php-runtime.cjs scripts/php-smoke.cjs
git commit -m "feat(mac): runtime PHP additive (static-php + tar), Windows intacto"
```

- [ ] **Step 7: Verificação (manual, exige Mac)**

Pós-merge, num Mac: abrir um projeto PHP (com `index.php`) e confirmar que o preview sobe — tanto com `php` do sistema instalado (deve usá-lo) quanto sem (deve baixar o static-php e extrair). Se o binário extrair para subpasta, ajustar o `path.join` do `phpBin`.

---

### Task 7: Convenção no CLAUDE.md

Documenta a camada de plataforma para que o Claude Code roteie código de SO para lá (o análogo do i18n). Feito por último, com a forma final do módulo já conhecida.

**Files:**
- Modify: `CLAUDE.md` (nova seção)

**Interfaces:** nenhuma (documentação).

- [ ] **Step 1: Adicionar a seção ao CLAUDE.md**

In `CLAUDE.md`, após a seção `## Notas de desenvolvimento`, adicionar:

```markdown
## DIFERENÇAS DE PLATAFORMA (Win/Mac/Linux)

Nunca espalhe `process.platform` pelo código. Diferença de SO vai em `platform.cjs`
(módulo canônico, estilo `platform.ts` do VS Code):

- É um **valor** (nome de shell, extensão de binário, comando de "abrir", URL de asset)?
  → vira chave na tabela `TABLE` de `platform.cjs`. Adicionar suporte a um SO = preencher
  a coluna dele.
- É **comportamento** (resolver PATH, montar menu, escolher login shell)? → vira uma
  função em `platform.cjs` que aceita `platform` como parâmetro (default `process.platform`),
  para ser testável em qualquer SO via `scripts/platform-smoke.cjs`.
- Comportamento que precisa de `fs`/`child_process` (ex.: download/extração por SO) mora
  no módulo que já tem Node (ex.: `php-runtime.cjs`), ramificando por `process.platform`,
  mas com as partes de decisão (asset, nome de binário) como funções puras testáveis.

Regra de ouro: se você escreveu `process.platform === '...'` fora de `platform.cjs`,
provavelmente há um lugar melhor. O caminho Windows nunca deve regredir ao adicionar Mac/Linux.
```

- [ ] **Step 2: Format e commit**

Run: `npm run format:check` (ou `npm run format` se acusar)
Expected: passa.

```bash
git add CLAUDE.md
git commit -m "docs: convenção da camada de plataforma no CLAUDE.md"
```

---

## Self-Review

**1. Spec coverage:**
- Camada de plataforma (spec §4) → Tasks 1, 4, 5 (módulo + funções) + Task 7 (convenção). ✅
- Build Mac + workflow + ícone (spec §5.A) → Task 2. ✅
- PATH login shell + fix-path (spec §5.B) → Tasks 3 e 4. ✅
- Menu/janela (spec §5.C) → Task 5. ✅
- PHP additive (spec §5.D) → Task 6. ✅
- Libs (spec §5.F): só `fix-path` adotada (Task 4); `which`/`tar` do sistema — deviation documentada. ✅
- Não-regressão Windows (spec §6): asserts antigos do `php-smoke` intactos; `LocalPty` default `[]`; menu `null` no Windows. ✅
- Fora de escopo (spec §3): assinatura/notarização, site, cosméticos — não há tasks, correto. ✅

**2. Placeholder scan:** os `<VERSAO>`/`<SHA...>` do PHP são preenchidos por ação explícita (Task 6 Step 3, com comandos) — não são TODOs vagos. O ícone (Task 2 Step 1) é input com comando + fallback definido. Sem outros placeholders.

**3. Type consistency:** `shellFor`/`loginArgsFor`/`fixLoginPath`/`macMenuTemplate` definidas na Task 1/4/5 e consumidas com os mesmos nomes no `main.js`. `phpBinaryName`/`phpAssetFor` consistentes entre `php-runtime.cjs` e `php-smoke.cjs`. `LocalPty` ganha `shellArgs` (Task 3) usado no `main.js` com o mesmo nome. ✅
