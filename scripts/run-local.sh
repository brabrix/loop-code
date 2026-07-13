#!/usr/bin/env bash
# Build & run local do Loop Code (macOS/Linux).
#
# Uso:
#   ./scripts/run-local.sh         # produção local: instala (se precisar), builda e abre o app
#   ./scripts/run-local.sh dev     # desenvolvimento: Vite com hot reload + Electron apontando pro Vite
#   ./scripts/run-local.sh clean   # remove node_modules e dist e reinstala do zero
#
# Rode a partir de qualquer pasta — o script se ancora na raiz do projeto.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# O Electron vira "Node puro" se essa variável estiver setada (acontece quando o
# terminal foi aberto de dentro do Claude Code). Limpar sempre é inofensivo.
unset ELECTRON_RUN_AS_NODE

MODE="${1:-run}"

log() { printf '\n\033[1;36m[loop-code]\033[0m %s\n' "$*"; }

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Erro: Node.js não encontrado. Instale via https://nodejs.org ou 'brew install node'." >&2
    exit 1
  fi
}

# Instalação do Electron completa? O postinstall precisa deixar path.txt,
# dist/version E o executável que o path.txt aponta. Se um npm install cair no
# meio do download (rede), sobra um estado zumbi: o app existe mas o path.txt
# não — e o `electron .` morre com "Electron failed to install correctly".
electron_ok() {
  [ -f node_modules/electron/path.txt ] || return 1
  [ -f node_modules/electron/dist/version ] || return 1
  [ -e "node_modules/electron/dist/$(cat node_modules/electron/path.txt)" ] || return 1
  # Um zip truncado no download pode extrair o .app sem o framework (já aconteceu):
  if [ "$(uname)" = "Darwin" ]; then
    [ -e "node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework" ] || return 1
  fi
  return 0
}

# Extrai o zip do cache com o ditto do macOS e grava o path.txt à mão.
# Motivo: no Node 26 o extract-zip usado pelo postinstall do Electron morre
# SILENCIOSAMENTE no meio da extração (promise nunca resolve, processo sai 0) —
# o postinstall "passa" mas o app fica sem framework e sem path.txt. O download
# do zip em si funciona; só a extração quebra.
repair_electron_from_cache() {
  [ "$(uname)" = "Darwin" ] || return 1
  local ver zip
  ver="$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null)" || return 1
  zip="$(find "$HOME/Library/Caches/electron" -name "electron-v${ver}-darwin-*.zip" 2>/dev/null | head -1)"
  [ -n "$zip" ] || return 1
  log "Extraindo o Electron com o ditto (workaround do extract-zip no Node 26)…"
  rm -rf node_modules/electron/dist
  mkdir -p node_modules/electron/dist
  ditto -xk "$zip" node_modules/electron/dist || return 1
  printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
}

ensure_deps() {
  if [ ! -d node_modules ]; then
    log "Instalando dependências (npm install)…"
    npm install --no-audit --no-fund
  fi
  if ! electron_ok; then
    log "Instalação do Electron incompleta — reparando…"
    # Garante o zip no cache (o download funciona; só a extração é problemática).
    node node_modules/electron/install.js >/dev/null 2>&1 || true
    electron_ok || repair_electron_from_cache || true
    if ! electron_ok; then
      # Última cartada: zip do cache pode estar truncado — baixa de novo do zero.
      log "Cache possivelmente corrompido — baixando o Electron novamente…"
      rm -rf "$HOME/Library/Caches/electron" "$HOME/.cache/electron"
      node node_modules/electron/install.js >/dev/null 2>&1 || true
      electron_ok || repair_electron_from_cache || true
    fi
    if ! electron_ok; then
      echo "Erro: não consegui completar a instalação do Electron (rede? Node muito novo?)." >&2
      echo "Tente ./scripts/run-local.sh clean, ou use Node 22 LTS (nvm use 22)." >&2
      exit 1
    fi
  fi
}

case "$MODE" in
  clean)
    log "Limpando node_modules/, dist/ e o cache de download do Electron…"
    rm -rf node_modules dist "$HOME/Library/Caches/electron" "$HOME/.cache/electron"
    check_node
    ensure_deps
    log "Pronto. Rode ./scripts/run-local.sh (ou 'dev') para abrir o app."
    ;;

  dev)
    check_node
    ensure_deps
    log "Subindo o Vite (hot reload) na porta 5234…"
    npm run dev &
    VITE_PID=$!
    # Encerra o Vite junto com o Electron (Ctrl+C ou fechar a janela).
    trap 'kill "$VITE_PID" 2>/dev/null || true' EXIT INT TERM
    # Espera o dev server responder antes de abrir a janela.
    for _ in $(seq 1 40); do
      curl -sf -o /dev/null http://localhost:5234/ && break
      sleep 0.25
    done
    log "Abrindo o Electron apontando pro Vite (edições em src/ recarregam sozinhas)…"
    VITE_DEV_SERVER_URL=http://localhost:5234/ npx electron .
    ;;

  run)
    check_node
    ensure_deps
    log "Buildando o renderer (vite build → dist/)…"
    npm run build
    log "Abrindo o Loop Code…"
    npm start
    ;;

  *)
    echo "Uso: $0 [run|dev|clean]" >&2
    exit 64
    ;;
esac
