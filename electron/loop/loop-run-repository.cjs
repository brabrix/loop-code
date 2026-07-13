'use strict';

// Persistência local das execuções: um JSON por run em <userData>/loops/.
// Formato simples e auditável, no padrão do projeto (config.json também é JSON
// plano). Escrita atômica (tmp + rename) pra não corromper em queda de energia.
//
// NUNCA persistir aqui: tokens, secrets, env, stdout ilimitado (os stepRuns já
// chegam truncados pelo runner — ver loop-types.cjs).

const nodePath = require('path');
const { LoopPersistenceError } = require('./loop-errors.cjs');

// Só aceita ids que o próprio runner gera (uuid/hex) — nada de path traversal
// via runId vindo do renderer.
const SAFE_ID = /^[a-zA-Z0-9-]{8,64}$/;

function createLoopRunRepository({ dir, fs = require('fs') }) {
  if (!dir) throw new LoopPersistenceError('Repositório sem diretório.');

  const fileFor = (runId) => {
    if (typeof runId !== 'string' || !SAFE_ID.test(runId))
      throw new LoopPersistenceError(`runId inválido: ${String(runId).slice(0, 40)}`);
    return nodePath.join(dir, `${runId}.json`);
  };

  async function save(run) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = fileFor(run.id);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      if (err instanceof LoopPersistenceError) throw err;
      throw new LoopPersistenceError(`Falha ao salvar a execução ${run && run.id}.`, {
        cause: String((err && err.message) || err),
      });
    }
  }

  async function findById(runId) {
    try {
      return JSON.parse(fs.readFileSync(fileFor(runId), 'utf8'));
    } catch (err) {
      if (err instanceof LoopPersistenceError) throw err;
      if (err && err.code === 'ENOENT') return null;
      throw new LoopPersistenceError(`Falha ao ler a execução ${runId}.`, {
        cause: String((err && err.message) || err),
      });
    }
  }

  async function list() {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw new LoopPersistenceError('Falha ao listar execuções.', {
        cause: String((err && err.message) || err),
      });
    }
    const runs = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        runs.push(JSON.parse(fs.readFileSync(nodePath.join(dir, f), 'utf8')));
      } catch {
        // arquivo corrompido não derruba a listagem inteira
      }
    }
    runs.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return runs;
  }

  async function remove(runId) {
    try {
      fs.unlinkSync(fileFor(runId));
    } catch (err) {
      if (err instanceof LoopPersistenceError) throw err;
      if (err && err.code === 'ENOENT') return;
      throw new LoopPersistenceError(`Falha ao remover a execução ${runId}.`, {
        cause: String((err && err.message) || err),
      });
    }
  }

  return { save, findById, list, delete: remove };
}

module.exports = { createLoopRunRepository, SAFE_ID };
