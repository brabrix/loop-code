// Runtime PHP isolado do main.js. Node puro (sem require de electron),
// pra ser testável por scripts/php-smoke.cjs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawnSync } = require('child_process');

// --- Detecção de tipo de projeto ---------------------------------------
function hasNodeDevScript(projectPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
    const s = pkg.scripts || {};
    return Boolean(s.dev || s.start || s.serve);
  } catch {
    return false;
  }
}

function hasAnyPhpFile(projectPath) {
  // index.php na raiz ou em public/ é o caso comum; senão qualquer .php no topo.
  if (fs.existsSync(path.join(projectPath, 'index.php'))) return true;
  if (fs.existsSync(path.join(projectPath, 'public', 'index.php'))) return true;
  try {
    return fs.readdirSync(projectPath).some((f) => f.toLowerCase().endsWith('.php'));
  } catch {
    return false;
  }
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
  const quick = elapsedMs < 4000; // saiu quase na hora
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
    s.on('end', () =>
      resolve(hash.digest('hex').toLowerCase() === String(expectedHex).toLowerCase()),
    );
  });
}

// --- Runtime PHP sob demanda -------------------------------------------
const PHP_VERSION = '8.5.8';
const PHP_ZIP_NAME = `php-${PHP_VERSION}-nts-Win32-vs17-x64.zip`;
const PHP_SHA256 = '63a3f6493f37c9ff3e288ec16621222a6cda5167dd1abffec0019e7f18c8e7e9';
const PHP_DOWNLOAD_URLS = [
  `https://windows.php.net/downloads/releases/${PHP_ZIP_NAME}`,
  `https://windows.php.net/downloads/releases/archives/${PHP_ZIP_NAME}`,
];

// --- Runtime PHP no macOS (static-php-cli) -----------------------------
// Binários estáticos: https://dl.static-php.dev/static-php-cli/common/
const PHP_MAC_VERSION = '8.5.8';
const PHP_MAC = {
  arm64: {
    name: `php-${PHP_MAC_VERSION}-cli-macos-aarch64.tar.gz`,
    sha256: '6864cbb62e31411a3fdc30ae316e1820336bc56cfe00aa2bba592783172b2b5b',
  },
  x64: {
    name: `php-${PHP_MAC_VERSION}-cli-macos-x86_64.tar.gz`,
    sha256: '7aa8a7d5cc0afcd9aef1f7bf0245db59edd580f1b7fa36717dbb477d68796bec',
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

function downloadTo(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('excesso de redirects'));
        const next = new URL(headers.location, url).toString();
        return resolve(downloadTo(next, destPath, redirectsLeft - 1));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} ao baixar ${url}`));
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      res.on('error', (e) => {
        out.destroy();
        reject(e);
      });
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout no download do PHP')));
  });
}

async function downloadFirstAvailable(urls, destPath) {
  let lastErr;
  for (const u of urls) {
    try {
      await downloadTo(u, destPath);
      return u;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('nenhuma URL de download disponível');
}

function extractArchive(archivePath, destDir, platform = process.platform) {
  if (platform === 'win32') {
    // Windows: usa o Expand-Archive do PowerShell (sem dependência npm).
    // Aspas simples dobradas = escape literal do PowerShell, evita quebra de
    // string se o caminho tiver aspas (ex.: userData com username "O'Connor").
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
      throw new Error(
        'falha ao extrair o PHP: ' + (r.stderr || r.error?.message || 'erro desconhecido'),
      );
    }
    return;
  }
  // macOS/Linux: tar do sistema (sempre presente no macOS).
  const r = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      'falha ao extrair o PHP: ' + (r.stderr || r.error?.message || 'erro desconhecido'),
    );
  }
}

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
    try {
      fs.rmSync(archivePath, { force: true });
    } catch {}
    throw new Error('Não foi possível baixar o PHP (verifique a conexão). ' + e.message);
  }

  phase('Verificando o download…');
  const ok = await verifySha256(archivePath, asset.sha256);
  if (!ok) {
    try {
      fs.rmSync(archivePath, { force: true });
    } catch {}
    throw new Error('Checksum do PHP não confere — download abortado por segurança.');
  }

  phase('Extraindo o PHP…');
  try {
    extractArchive(archivePath, versionDir, plat);
  } catch (e) {
    try {
      fs.rmSync(archivePath, { force: true });
    } catch {}
    throw new Error('Falha ao extrair o PHP: ' + e.message);
  }
  try {
    fs.rmSync(archivePath, { force: true });
  } catch {}

  if (!fs.existsSync(phpBin)) {
    throw new Error(binName + ' não encontrado após a extração.');
  }
  if (plat !== 'win32') {
    try {
      fs.chmodSync(phpBin, 0o755);
    } catch {}
  }
  return phpBin;
}

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
