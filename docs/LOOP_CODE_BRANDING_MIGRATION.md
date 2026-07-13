# Loop Code — Migração de Identidade (Carcará Code → Loop Code)

> Data: 2026-07-12 · Executa a Fase 1 do `LOOP_CODE_MIGRATION_PLAN.md`.
> Nome oficial: **Loop Code** · id curto: `loop-code` · org: **Brabrix** ·
> appId: `com.brabrix.loopcode`.

## 1. Referências renomeadas

| Onde                                                 | Antes                                                                                                                                          | Depois                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `package.json` name/description                      | `carcara-code` / "IDE minimalista…"                                                                                                            | `loop-code` / "IDE orientada a workflows de codificação com agentes de inteligência artificial."         |
| `package.json` build                                 | appId `com.carcara.code`, productName `Carcará Code`, artefatos `CarcaraCode-*`, shortcut/uninstall/dmg title                                  | appId `com.brabrix.loopcode`, productName `Loop Code`, artefatos `LoopCode-*`                            |
| `package.json` publish (feed do auto-update)         | `Yg0rAndrade/carcara-code`                                                                                                                     | `brabrix/loop-code` — **corrigia o risco de o app se atualizar de volta pro Carcará**                    |
| `main.js`                                            | `APP_NAME`, AppUserModelId, regex do User-Agent (`Carcar[^/]*`), identidade do shadow git (`checkpoints@carcara.code`), `carcara-request.http` | `Loop Code`, `com.brabrix.loopcode`, `Loop ?Code`, `checkpoints@loopcode.local`, `loopcode-request.http` |
| Protocolo interno de mídia                           | `ygc-media://`                                                                                                                                 | `lc-media://` (runtime-only, nada persiste essas URLs)                                                   |
| `index.html`                                         | título, splash, keyframes `carcara-*`                                                                                                          | `Loop Code`, `loopcode-*`                                                                                |
| i18n (`src/lib/locales/*`, `electron/main.i18n.cjs`) | ~10 chaves com "Carcará" + `notify_title`                                                                                                      | "Loop Code" (paridade pt/en verificada)                                                                  |
| UI                                                   | versão na tela Sobre, link Contribuir (`Yg0rAndrade/carcara-code`), label do ErrorBoundary                                                     | `Loop Code v…`, `https://github.com/brabrix/loop-code`, `Loop Code`                                      |
| Scripts injetados no preview                         | namespaces `__carcara*`, sentinelas `__CARCARA_GRAB__*`                                                                                        | `__loopcode*`, `__LOOPCODE_GRAB__*` (autocontidos: definição e checagens no mesmo módulo)                |
| Cliente MCP                                          | client `carcara-code` (`mcp-core.cjs`), OAuth client_name `Carcará Code`                                                                       | `loop-code` / `Loop Code`                                                                                |
| Dados por projeto                                    | `.carcara/` (prompts, requests, mcp-servers)                                                                                                   | **grava em `.loopcode/`**, com fallback de leitura (ver §2)                                              |
| Workflows CI                                         | artefatos `CarcaraCode-*`                                                                                                                      | `LoopCode-*`                                                                                             |
| Smokes/testes                                        | prefixos tmp `carcara-*`                                                                                                                       | `loopcode-*`                                                                                             |
| `README.md`/`AGENTS.md`/`CLAUDE.md`                  | pitch Carcará (incl. regra de backup diário com push automático)                                                                               | Loop Code (push automático **revogado**)                                                                 |

## 2. Identificadores mantidos por compatibilidade (legado proposital)

| Identificador                                               | Onde                                                   | Por quê                                                                            | Estratégia                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `carcara-board:<path>`                                      | `TldrawPanel.jsx` (persistenceKey → IndexedDB)         | Renomear apagaria os quadros locais dos usuários                                   | Manter; migrar só se/quando houver ferramenta de export/import                                                                    |
| Leitura de `.carcara/`                                      | `main.js` (`projectDataReadPath`)                      | Prompts/requests/servidores MCP salvos antes do rename                             | Escrita sempre em `.loopcode/`; leitura cai no legado quando o novo não existe; `http:listSaved` mescla os dois dirs (novo vence) |
| userData do Carcará Code                                    | `migrateLegacyUserData()` em `main.js`                 | Mudar `app.setName` muda a pasta de dados                                          | Cópia única de `config.json` + `checkpoints/` na primeira execução (não move — o app antigo segue funcionando)                    |
| Segredos SSH antigos                                        | `secretStore` (safeStorage)                            | O safeStorage cifra por app/keychain — ciphertext do Carcará não abre no Loop Code | **Não migram**; o usuário reinsere a credencial (o app já pede quando falta)                                                      |
| Identidade antiga nos shadow-repos de checkpoint existentes | `userData/checkpoints/*.git`                           | `user.email/name` só é setado no init                                              | Novos shadows usam a identidade nova; os antigos seguem válidos                                                                   |
| Histórico do `CHANGELOG.md` e docs de specs antigas         | raiz e `docs/specs`, `src/index.css.carcara-brasa.bak` | Documentação histórica                                                             | Mantidos como estão                                                                                                               |

## 3. Assets (inventário)

| Asset                    | Caminho                                                  | Uso                               | Marca original?           | Ação tomada                                              | Ação futura                                      |
| ------------------------ | -------------------------------------------------------- | --------------------------------- | ------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| Ícone do app (Win)       | `build/icon.ico`                                         | instalador/janela                 | Sim (carcará)             | Mantido (legado)                                         | Ícone Loop Code oficial                          |
| Ícone do app (Linux/mac) | `build/icon.png`                                         | AppImage/DMG/janela               | Sim                       | Mantido (legado)                                         | idem                                             |
| Logos do renderer        | `src/assets/logo.svg`, `logo-dark.svg`, `logo-light.svg` | splash/empty-states/telas         | Sim                       | Mantidos (legado)                                        | Substituir pela marca Loop Code                  |
| Foto do autor            | `src/assets/ygor/`                                       | tela Sobre (cartão de atribuição) | —                         | **Mantida de propósito** (crédito ao autor original)     | Permanece como atribuição                        |
| Ícones de CLI            | `src/assets/cli/`                                        | picker de IA                      | Não (marcas das CLIs)     | Mantidos                                                 | —                                                |
| Imagens do README antigo | `imgs/` (logo, hero, code, preview-*)                    | era usado no README               | Sim                       | README novo não as referencia; arquivos mantidos no repo | Remover/substituir junto com a identidade visual |
| Splash SVG inline        | `index.html`                                             | primeira pintura                  | Sim (silhueta do carcará) | Texto/keyframes renomeados; desenho mantido (legado)     | Marca Loop Code                                  |
| Paleta/tema              | `src/index.css`                                          | cores do app                      | Inspirada no carcará      | Mantida (comentário atualizado)                          | Paleta própria na etapa de identidade visual     |

## 4. URLs alteradas

- Contribuir (tela Sobre) → `https://github.com/brabrix/loop-code` (repositório real do fork).
- Feed de update (`build.publish`) → `brabrix/loop-code`.
- Links pessoais do autor original (site, e-mail, GitHub, LinkedIn, Instagram,
  YouTube) **mantidos** na tela Sobre como atribuição — o cartão agora o
  descreve como "Criador do Carcará Code (projeto original)".
- Nenhuma URL nova inventada (sem site do produto ainda; `brabrix.com` não foi
  adicionado a lugar nenhum).

## 5. Pendências

1. **Ícones/logos oficiais** do Loop Code (build/, src/assets/, splash, imgs/).
2. **UI de agentes** consumindo `agents:list` (status/seleção) — hoje a
   escolha de CLI continua pelo AiPicker existente.
3. Decidir o destino de `imgs/` e `src/index.css.carcara-brasa.bak` (limpeza).
4. `docs/specs/*` e `CHANGELOG.md` citam Carcará em contexto histórico —
   mantidos de propósito.
5. Workspaces remotos e o canal `agents:*` (ver AGENT_ADAPTER_ARCHITECTURE §12).

## 6. Riscos para builds e atualizações

- **appId mudou** (`com.carcara.code` → `com.brabrix.loopcode`): instaladores
  novos NÃO atualizam instalações antigas do Carcará (são apps distintos para
  NSIS/macOS). Intencional — o Loop Code é outro produto; dados locais são
  migrados por cópia na primeira execução.
- **Sem release ainda**: o feed `brabrix/loop-code` não tem releases; o
  auto-update responde "sem update" até a primeira tag `v*`. Os workflows de
  build (win/linux/mac) continuam válidos.
- Assinatura/certificados: o original não assinava (SmartScreen aparece) —
  nada regrediu; assinar fica para quando houver release oficial.
- Regex nova do User-Agent cobre `Loop Code/<versão>`; o problema histórico de
  byte inválido (acento no header) deixa de existir com o nome ASCII.

## 7. Estratégia futura de migração

- Remover o fallback de `.carcara/` após 2–3 releases com aviso em changelog.
- Remover `migrateLegacyUserData()` quando a base do fork não tiver mais
  instalações do Carcará (telemetria/feedback manual — não há telemetria hoje).
- Migrar a chave do tldraw somente com export/import embutido.

## 8. Atribuições open source preservadas

- `LICENSE` (MIT © 2026 Ygor Andrade) — **intocado**.
- README com seção "Open source attribution" apontando o projeto original.
- Tela **Sobre** mantém o cartão do autor original (nome, foto, links) com o
  papel "Criador do Carcará Code (projeto original)".
- Histórico Git integral do projeto original preservado (fork sem rewrite).
