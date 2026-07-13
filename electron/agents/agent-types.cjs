'use strict';

// Tipos e validação pura da camada de coding agents (sem Electron/fs, testável).
// Os "tipos" são JSDoc — o projeto é JS puro; a referência TypeScript completa
// vive em docs/contracts/loop-code-contracts.ts.
//
// Ids canônicos da camada de agentes ('claude-code', 'codex'…) ≠ ids legados das
// CLIs do chat/terminal ('claude', 'codex', 'opencode', 'agy', 'custom' — ver
// electron/ai-cli.cjs). O mapa abaixo faz a ponte sem tocar no config existente.

const { CodingAgentExecutionError } = require('./agent-errors.cjs');

/**
 * @typedef {Object} CodingAgentDescriptor
 * @property {string} id            id canônico ('claude-code', 'codex', …)
 * @property {string} name          nome de exibição ('Claude Code')
 * @property {string} [description]
 * @property {string} [executable]  binário da CLI ('claude')
 * @property {boolean} supportsStreaming
 * @property {boolean} supportsSessionResume
 * @property {boolean} supportsCancellation
 */

/**
 * @typedef {Object} CodingAgentAvailability
 * @property {boolean} available
 * @property {string} [version]
 * @property {string} [reason]  motivo legível quando indisponível
 */

/**
 * @typedef {Object} AgentExecutionInput
 * @property {string} executionId    id único desta execução (gerado pelo chamador)
 * @property {string} workspacePath  diretório do projeto (o main valida a autorização)
 * @property {string} prompt
 * @property {string} [sessionId]    sessão da CLI a retomar (resume)
 * @property {string} [model]
 * @property {'default'|'acceptEdits'|'plan'|'bypassPermissions'} [permissionMode]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} AgentExecutionResult
 * @property {string} executionId
 * @property {string} agentId
 * @property {'completed'|'failed'|'cancelled'} status
 * @property {string} [sessionId]
 * @property {number} [exitCode]
 * @property {string} [output]       resposta final do agente (texto)
 * @property {string} [errorOutput]  stderr acumulado (limitado)
 * @property {{costUsd?: number, durationMs?: number, numTurns?: number}} [usage]
 * @property {string} startedAt      ISO 8601
 * @property {string} finishedAt     ISO 8601
 * @property {{code: string, message: string, details?: unknown}} [error]
 */

// Ids legados das CLIs (ai-cli.cjs / config.json) → id canônico do agente.
const LEGACY_CLI_TO_AGENT_ID = {
  claude: 'claude-code',
  codex: 'codex',
  opencode: 'opencode',
  agy: 'gemini-antigravity',
  custom: 'custom',
};

const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

// Limite do stderr acumulado no resultado (evita payloads gigantes no IPC).
const MAX_ERROR_OUTPUT = 16 * 1024;

function canonicalAgentId(legacyCliId) {
  return LEGACY_CLI_TO_AGENT_ID[legacyCliId] || legacyCliId;
}

// Valida o input de execução vindo do renderer (nunca confiar no shape).
// Lança CodingAgentExecutionError com mensagem legível; devolve o input saneado
// (só os campos conhecidos — descarta extras silenciosamente).
function validateExecutionInput(input) {
  const fail = (msg) => {
    throw new CodingAgentExecutionError(msg, { code: 'invalid-input' });
  };
  if (!input || typeof input !== 'object') fail('Input de execução ausente.');
  const { executionId, workspacePath, prompt, sessionId, model, permissionMode, metadata } = input;
  if (typeof executionId !== 'string' || !executionId.trim()) fail('executionId é obrigatório.');
  if (typeof workspacePath !== 'string' || !workspacePath.trim())
    fail('workspacePath é obrigatório.');
  if (typeof prompt !== 'string' || !prompt.trim()) fail('prompt é obrigatório.');
  if (sessionId != null && typeof sessionId !== 'string') fail('sessionId inválido.');
  if (model != null && typeof model !== 'string') fail('model inválido.');
  if (permissionMode != null && !PERMISSION_MODES.includes(permissionMode))
    fail(`permissionMode inválido: ${permissionMode}`);
  return {
    executionId: executionId.trim(),
    workspacePath,
    prompt,
    sessionId: sessionId || undefined,
    model: model || undefined,
    permissionMode: permissionMode || undefined,
    metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
  };
}

// Eventos padronizados da execução (enviados ao renderer via push 'agent:event').
// 'agent-message' carrega o evento normalizado do stream da CLI (text/thinking/
// tool_use/tool_result/system/result — ver chat-cli.cjs normalizeStreamEvent).
function makeEvent(type, executionId, extra, now) {
  return { type, executionId, timestamp: (now || new Date()).toISOString(), ...(extra || {}) };
}

module.exports = {
  LEGACY_CLI_TO_AGENT_ID,
  PERMISSION_MODES,
  MAX_ERROR_OUTPUT,
  canonicalAgentId,
  validateExecutionInput,
  makeEvent,
};
