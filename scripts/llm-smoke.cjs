// Smoke do motor de IA local, fora do Electron.
// Uso: node scripts/llm-smoke.cjs [diretorio-userData]
// (limpe ELECTRON_RUN_AS_NODE antes, se estiver setado no ambiente)
const os = require('os');
const path = require('path');
const llm = require('../llm-core.cjs');

const userDataDir = process.argv[2] || path.join(os.homedir(), '.carcara-code-smoke');

(async () => {
  const st = await llm.status(userDataDir);
  console.log('status:', st);
  if (!st.installed) {
    console.log('Modelo ausente. Rode o download pelo app (aba Recursos de IA) ou:');
    console.log('  node -e "require(\'./llm-core.cjs\').download(' + JSON.stringify(userDataDir) +
      ', p => process.stdout.write((p.total? Math.round(100*p.done/p.total):0)+\'%\\r\')).then(()=>console.log(\'\\nbaixado\'))"');
    return;
  }
  const diff = process.argv[3] ||
    'diff --git a/login.js b/login.js\n+ if (!password) return error("senha obrigatória");';
  const msg = await llm.generate({ userDataDir, task: 'commit', input: diff });
  console.log('commit sugerido:', JSON.stringify(msg));
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
