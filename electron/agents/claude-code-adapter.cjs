'use strict';

// Adapter do Claude Code para o contrato genérico de coding agents.
//
// NÃO reimplementa a integração: reusa a lógica pura de electron/chat-cli.cjs
// (args do modo headless `-p --input-format/--output-format stream-json`,
// mensagem de usuário e normalização de eventos) e o MESMO shape de spawn da
// ponte de chat do main.js (cwd no workspace, env limpo sem chave de API,
// shell:true só no Windows pra resolver o binário pelo PATH).
//
// Diferença de modelo: o chat mantém um processo persistente por sessão de UI;
// aqui cada execução é UM processo que roda um turno e sai (fecha o stdin após
// a mensagem) — o formato que o futuro LoopRunner consome. Resume é suportado
// via input.sessionId (--resume).
//
// Todas as dependências com efeito (spawn, kill, env, probe de versão) são
// injetáveis para os testes rodarem sem CLI real.

const chatCli = require('../chat-cli.cjs');
const { makeEvent, MAX_ERROR_OUTPUT } = require('./agent-types.cjs');
const { CodingAgentCancellationError } = require('./agent-errors.cjs');

const DESCRIPTOR = Object.freeze({
  id: 'claude-code',
  name: 'Claude Code',
  description: 'CLI oficial do Claude (usa a assinatura logada, nunca chave de API).',
  executable: 'claude',
  supportsStreaming: true,
  supportsSessionResume: true,
  supportsCancellation: true,
});

// Mesmo contrato do cleanEnv() do main.js: sem chave de API (força assinatura)
// e sem a flag que faria um Electron filho rodar como Node puro.
function defaultCleanEnv(base) {
  const env = { ...(base || process.env) };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

// Probe padrão de disponibilidade: `claude --version` (mesmo esquema do
// system:checkTools do main.js — shell:true pra resolver .cmd no Windows).
function defaultProbeVersion(bin) {
  try {
    const r = require('child_process').spawnSync(bin, ['--version'], {
      shell: true,
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return { ok: false, reason: 'CLI não respondeu a --version' };
    return { ok: true, version: String(r.stdout || '').trim() || undefined };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
}

function createClaudeCodeAdapter(deps = {}) {
  const spawnFn = deps.spawn || require('child_process').spawn;
  const killFn = deps.kill || ((proc) => proc.kill());
  const envFn = deps.env || defaultCleanEnv;
  const probeFn = deps.probeVersion || defaultProbeVersion;
  const platform = deps.platform || process.platform;
  const now = deps.now || (() => new Date());

  const executions = new Map(); // executionId -> { proc, cancelled }

  function spawnOpts(workspacePath) {
    return {
      cwd: workspacePath,
      env: envFn(),
      shell: platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    };
  }

  async function checkAvailability() {
    const probe = probeFn(DESCRIPTOR.executable);
    if (!probe.ok) return { available: false, reason: probe.reason };
    return { available: true, version: probe.version };
  }

  // Sempre resolve com AgentExecutionResult (status completed/failed/cancelled).
  // `onEvent` é opcional; exceções do listener não derrubam a execução.
  function execute(input, onEvent) {
    const emit = (type, extra) => {
      if (typeof onEvent !== 'function') return;
      try {
        onEvent(makeEvent(type, input.executionId, extra, now()));
      } catch {}
    };

    return new Promise((resolve) => {
      const startedAt = now().toISOString();
      const args = chatCli.buildChatArgs({
        resumeId: input.sessionId || null,
        model: input.model,
        permissionMode: input.permissionMode,
      });
      let proc;
      const finish = (status, fields) => {
        executions.delete(input.executionId);
        resolve({
          executionId: input.executionId,
          agentId: DESCRIPTOR.id,
          status,
          startedAt,
          finishedAt: now().toISOString(),
          ...fields,
        });
      };

      try {
        proc = spawnFn(DESCRIPTOR.executable, args, spawnOpts(input.workspacePath));
      } catch (err) {
        const message = String((err && err.message) || err);
        emit('execution-failed', { message });
        finish('failed', { error: { code: 'spawn-error', message } });
        return;
      }

      const entry = { proc, cancelled: false };
      executions.set(input.executionId, entry);
      emit('execution-started', {});

      let stdoutBuf = '';
      let stderrBuf = '';
      let sessionId = input.sessionId || undefined;
      let finalResult = null; // evento kind:'result' do stream-json
      const textParts = []; // fallback de output quando não vier 'result'
      let settled = false;

      const handleStreamEvent = (ev) => {
        if (ev.sessionId && ev.sessionId !== sessionId) {
          sessionId = ev.sessionId;
          emit('session-created', { sessionId });
        }
        if (ev.kind === 'text' && ev.text) textParts.push(ev.text);
        if (ev.kind === 'result') finalResult = ev;
        emit('agent-message', { event: ev });
      };

      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() || '';
        for (const line of lines) {
          const s = line.trim();
          if (!s) continue;
          for (const ev of chatCli.getAdapter('claude').parseLine(s)) handleStreamEvent(ev);
        }
      });

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrBuf = (stderrBuf + text).slice(-MAX_ERROR_OUTPUT);
        emit('stderr', { content: text });
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        const message = String((err && err.message) || err);
        emit('execution-failed', { message });
        finish('failed', {
          errorOutput: stderrBuf || undefined,
          error: { code: 'spawn-error', message },
        });
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        // última linha sem \n pendente no buffer
        if (stdoutBuf.trim()) {
          for (const ev of chatCli.getAdapter('claude').parseLine(stdoutBuf.trim()))
            handleStreamEvent(ev);
        }
        const output =
          (finalResult && typeof finalResult.text === 'string' && finalResult.text) ||
          textParts.join('') ||
          undefined;
        const usage = finalResult
          ? {
              costUsd: finalResult.cost,
              durationMs: finalResult.durationMs,
              numTurns: finalResult.numTurns,
            }
          : undefined;
        const common = {
          sessionId,
          exitCode: typeof code === 'number' ? code : undefined,
          output,
          errorOutput: stderrBuf || undefined,
          usage,
        };
        if (entry.cancelled) {
          emit('execution-cancelled', {});
          finish('cancelled', common);
        } else if (code === 0 && !(finalResult && finalResult.isError)) {
          emit('execution-completed', { exitCode: code });
          finish('completed', common);
        } else {
          const message =
            (finalResult && finalResult.isError && finalResult.text) ||
            `Claude Code terminou com código ${code}.`;
          emit('execution-failed', { message });
          finish('failed', { ...common, error: { code: 'execution-error', message } });
        }
      });

      // Um turno por execução: envia a mensagem e fecha o stdin (o processo
      // conclui o turno e sai — diferente do chat persistente).
      try {
        proc.stdin.write(
          chatCli.getAdapter('claude').buildInput(input.prompt, input.sessionId || ''),
        );
        proc.stdin.end();
      } catch {
        // se o stdin falhar o 'error'/'close' do processo cuida do desfecho
      }
    });
  }

  async function cancel(executionId) {
    const entry = executions.get(executionId);
    if (!entry) throw new CodingAgentCancellationError(`Execução não encontrada: ${executionId}`);
    entry.cancelled = true;
    try {
      killFn(entry.proc);
    } catch {}
  }

  function activeExecutions() {
    return Array.from(executions.keys());
  }

  async function disposeAll() {
    for (const entry of executions.values()) {
      entry.cancelled = true;
      try {
        killFn(entry.proc);
      } catch {}
    }
  }

  return {
    descriptor: DESCRIPTOR,
    checkAvailability,
    execute,
    cancel,
    activeExecutions,
    disposeAll,
  };
}

module.exports = { createClaudeCodeAdapter, DESCRIPTOR, defaultCleanEnv, defaultProbeVersion };
