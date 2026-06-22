# Carcará Code

IDE minimalista para o **Claude Code**, com cara de Lovable. Três painéis, zero firula:

1. **Rail** — um ícone por projeto (varre a pasta raiz).
2. **Chat** — conversa com o Claude Code naquele projeto (via Claude Agent SDK, `cwd` = a pasta).
3. **Preview** — detecta o script `dev`/`start`, sobe o servidor e mostra o site embutido. Se já estiver rodando, não sobe de novo.

## Como rodar

```bash
npm install
npm start
```

Na primeira vez, clique no **+** do rail pra escolher a pasta onde ficam seus projetos
(padrão: `~/Documents/github`). Cada subpasta vira um ícone.

## Requisitos

- **Node.js** instalado.
- **Claude Code** instalado e logado (`claude` no terminal funcionando) — o chat usa a mesma autenticação.

## Notas (MVP)

- O chat roda em modo `bypassPermissions` pra ter o fluxo "Lovable" (sem pedir confirmação a cada passo).
- O preview detecta a porta lendo a saída do dev server (`http://localhost:PORT`).
- Estado por projeto (chat/preview) vive em memória enquanto o app está aberto.
- Se for abrir de dentro de um terminal do Claude Code, limpe `ELECTRON_RUN_AS_NODE`
  antes (`$env:ELECTRON_RUN_AS_NODE=$null; npm start`) — essa variável faz o Electron
  rodar como Node puro. Num terminal normal não precisa.
