// Runtime PHP isolado do main.js. Node puro (sem require de electron),
// pra ser testável por scripts/php-smoke.cjs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- Detecção de tipo de projeto ---------------------------------------
function hasNodeDevScript(projectPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
    const s = pkg.scripts || {};
    return Boolean(s.dev || s.start || s.serve);
  } catch { return false; }
}

function hasAnyPhpFile(projectPath) {
  // index.php na raiz ou em public/ é o caso comum; senão qualquer .php no topo.
  if (fs.existsSync(path.join(projectPath, 'index.php'))) return true;
  if (fs.existsSync(path.join(projectPath, 'public', 'index.php'))) return true;
  try {
    return fs.readdirSync(projectPath).some((f) => f.toLowerCase().endsWith('.php'));
  } catch { return false; }
}

function detectProjectType(projectPath) {
  if (hasNodeDevScript(projectPath)) return 'node'; // Node vence sempre
  if (hasAnyPhpFile(projectPath)) return 'php';
  return null;
}

function resolvePhpDocroot(projectPath) {
  if (fs.existsSync(path.join(projectPath, 'public', 'index.php'))) {
    return path.join(projectPath, 'public');
  }
  return projectPath;
}

function buildPhpServeArgs({ port, docroot }) {
  return ['-S', `127.0.0.1:${port}`, '-t', docroot];
}

// --- Classificador de erro de VC redist --------------------------------
function isVcRedistError({ log, elapsedMs }) {
  const quick = elapsedMs < 4000;                 // saiu quase na hora
  const dll = /VCRUNTIME140|MSVCP140|vcruntime140/i.test(log || '');
  return quick && dll;
}

// --- Verificação de sha256 ---------------------------------------------
function verifySha256(filePath, expectedHex) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('error', () => resolve(false));
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex').toLowerCase() === String(expectedHex).toLowerCase()));
  });
}

module.exports = {
  detectProjectType, resolvePhpDocroot, buildPhpServeArgs,
  isVcRedistError, verifySha256,
};
