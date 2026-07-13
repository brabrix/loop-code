'use strict';

// Executor de etapa 'command': roda um comando local com segurança dentro do
// workspace autorizado. Regras: executable + arguments SEMPRE separados (array),
// sem shell fora do Windows (lá o shell resolve npm.cmd/.bat pelo PATH — mesmo
// padrão já usado no chat e nos agentes), timeout obrigatório, logs limitados,
// cancelamento mata o processo (árvore inteira no Windows via killProc).

const { truncateLog, truncateSummary, MAX_STEP_LOG_BYTES } = require('../loop-types.cjs');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function createCommandStepExecutor({ spawn, kill, env, platform } = {}) {
  const spawnFn = spawn || require('child_process').spawn;
  const killFn = kill || ((proc) => proc.kill());
  const envFn = env || (() => ({ ...process.env }));
  const plat = platform || process.platform;

  return {
    type: 'command',

    execute(input, signal) {
      const { stepDef, workspacePath, emitOutput } = input;
      const cfg = stepDef.config;
      const timeoutMs = cfg.timeoutMs || DEFAULT_TIMEOUT_MS;
      const successCodes = cfg.successExitCodes || [0];

      return new Promise((resolve) => {
        if (signal.aborted) return resolve(cancelledResult());

        let proc;
        try {
          proc = spawnFn(cfg.executable, cfg.arguments || [], {
            cwd: workspacePath,
            env: envFn(),
            shell: plat === 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          });
        } catch (err) {
          return resolve(spawnFailed(err));
        }

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let aborted = false;
        let settled = false;

        // Mantém só o rabo dos logs mesmo DURANTE a coleta (memória limitada).
        const cap = (buf, chunk) => {
          const next = buf + chunk;
          return next.length > MAX_STEP_LOG_BYTES * 2 ? next.slice(-MAX_STEP_LOG_BYTES) : next;
        };

        const timer = setTimeout(() => {
          timedOut = true;
          try {
            killFn(proc);
          } catch {}
        }, timeoutMs);

        const onAbort = () => {
          aborted = true;
          try {
            killFn(proc);
          } catch {}
        };
        signal.addEventListener('abort', onAbort, { once: true });

        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        };

        proc.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          stdout = cap(stdout, text);
          if (emitOutput) emitOutput('stdout', text);
        });
        proc.stderr.on('data', (chunk) => {
          const text = chunk.toString();
          stderr = cap(stderr, text);
          if (emitOutput) emitOutput('stderr', text);
        });

        proc.on('error', (err) => finish(spawnFailed(err)));

        proc.on('close', (code) => {
          const base = {
            stdout: truncateLog(stdout),
            stderr: truncateLog(stderr),
            exitCode: typeof code === 'number' ? code : undefined,
          };
          if (aborted) return finish({ ...cancelledResult(), ...base });
          if (timedOut) {
            return finish({
              stepStatus: 'failed',
              condition: 'failure',
              summary: `Comando excedeu o timeout de ${timeoutMs}ms e foi encerrado.`,
              error: `timeout após ${timeoutMs}ms`,
              ...base,
            });
          }
          const ok = typeof code === 'number' && successCodes.includes(code);
          finish({
            stepStatus: ok ? 'passed' : 'failed',
            condition: ok ? 'success' : 'failure',
            summary: ok
              ? truncateSummary(`Comando concluído (exit ${code}).`)
              : truncateSummary(
                  `Comando falhou (exit ${code}). ${lastLine(stderr) || lastLine(stdout) || ''}`,
                ),
            ...(ok ? {} : { error: `exit code ${code}` }),
            ...base,
          });
        });
      });

      function spawnFailed(err) {
        const message = `Não foi possível executar "${cfg.executable}": ${String(
          (err && err.message) || err,
        )}`;
        return {
          stepStatus: 'failed',
          condition: 'failure',
          summary: message,
          error: message,
        };
      }
      function cancelledResult() {
        return {
          stepStatus: 'cancelled',
          condition: 'cancelled',
          summary: 'Comando cancelado.',
        };
      }
    },
  };
}

function lastLine(text) {
  const lines = String(text || '')
    .trim()
    .split('\n');
  return lines[lines.length - 1] || '';
}

module.exports = { createCommandStepExecutor, DEFAULT_TIMEOUT_MS };
