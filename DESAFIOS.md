# Desafios

## PATH em app GUI no macOS

Apps Electron no macOS não herdam o PATH dos dotfiles (`.zshrc`). O pty agora abre
como login shell (`zsh -l`, via `platform.loginArgsFor()`), e o boot chama `fix-path`
(ver Task 4). Gotcha: `fix-path`/`shell-env` falham SILENCIOSAMENTE com shells
não-POSIX (Fish, Nushell), caindo no PATH mínimo — raro no público-alvo, mas se um
usuário reportar "claude não encontrado" no Mac com shell exótico, é isto.

## `cd` no terminal do agente polui o cwd compartilhado (dev)

Ferramenta de gestão de sessão do assistente: Bash e PowerShell compartilham o mesmo
diretório de trabalho, e ele PERSISTE entre chamadas. Um `cd node_modules/...` pra
inspecionar tipos deixou o cwd preso lá, e os `npm run build` seguintes falharam com
"Missing script: build" (o npm lia um package.json errado subindo a árvore). Não é bug
do projeto. Lição: pra inspecionar arquivos, usar caminhos absolutos (Read/Grep), não
`cd`; se precisar mesmo, voltar pra raiz depois (`Set-Location <raiz>`).
