// Smoke da camada de plataforma. Uso: node scripts/platform-smoke.cjs
const {
  TABLE,
  tableFor,
  shellFor,
  loginArgsFor,
  isWin,
  isMac,
  isLinux,
} = require('../electron/platform.cjs');

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

// macMenuTemplate: forma mínima esperada
const { macMenuTemplate } = require('../electron/platform.cjs');
const tpl = macMenuTemplate('Carcará Code');
assert(Array.isArray(tpl) && tpl.length >= 2, 'template é array com >=2 menus');
assert(tpl[0].label === 'Carcará Code', 'primeiro menu = nome do app');
const roles = JSON.stringify(tpl);
assert(roles.includes('"quit"'), 'tem role quit (Cmd+Q)');
assert(roles.includes('"copy"') && roles.includes('"paste"'), 'tem copy/paste no Edit');

// fixLoginPath é no-op seguro fora de darwin/linux (não lança, retorna false)
const { fixLoginPath } = require('../electron/platform.cjs');
(async () => {
  const r = await fixLoginPath('win32');
  assert(r === false, 'fixLoginPath no-op em win32 -> false');

  console.log('platform-smoke OK');
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
