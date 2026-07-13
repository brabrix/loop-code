'use strict';

// Tipos, constantes e helpers puros do motor de Coding Loops (sem Electron/fs).
// Os "tipos" são JSDoc — o projeto é JS puro; a referência TypeScript vive em
// docs/contracts/loop-code-contracts.ts e docs/CODING_LOOP_DEFINITION.md.

/** Estados possíveis de uma execução de loop. */
const LOOP_STATUSES = [
  'pending',
  'running',
  'waiting_for_approval',
  'completed',
  'blocked',
  'failed',
  'cancelled',
  'limit_reached',
];

/** Estados terminais: uma execução neles NUNCA volta a andar (imutável). */
const TERMINAL_STATUSES = ['completed', 'blocked', 'failed', 'cancelled', 'limit_reached'];

/** Estados de uma etapa dentro da execução. */
const STEP_STATUSES = [
  'pending',
  'running',
  'passed',
  'failed',
  'skipped',
  'waiting_for_approval',
  'cancelled',
];

/** Tipos de etapa suportados no MVP. Novos tipos entram pelo StepExecutorRegistry. */
const STEP_TYPES = ['agent', 'command', 'human_checkpoint', 'validation'];

/** Condições que uma transição pode escutar. */
const TRANSITION_CONDITIONS = [
  'success',
  'failure',
  'approved',
  'rejected',
  'validation_passed',
  'validation_failed',
  'cancelled',
];

/** Tipos de check da etapa de validação (determinísticos — sem LLM no MVP). */
const VALIDATION_CHECK_TYPES = [
  'command_result',
  'file_exists',
  'file_contains',
  'files_changed',
  'boolean',
  'previous_step_success',
];

// Tamanho máximo de stdout/stderr/summary gravado num stepRun (o restante é
// truncado pelo INÍCIO — o fim do log é o que explica a falha).
const MAX_STEP_LOG_BYTES = 16 * 1024;
const MAX_SUMMARY_CHARS = 2000;

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

// Mantém o FINAL do texto (onde erro/resultado costuma estar) até `max` bytes.
function truncateLog(text, max = MAX_STEP_LOG_BYTES) {
  const s = String(text || '');
  if (Buffer.byteLength(s, 'utf8') <= max) return s;
  const sliced = Buffer.from(s, 'utf8').subarray(-max).toString('utf8');
  return `…[truncado]…${sliced}`;
}

function truncateSummary(text, max = MAX_SUMMARY_CHARS) {
  const s = String(text || '');
  return s.length <= max ? s : s.slice(0, max) + '…';
}

/**
 * Evento padronizado do loop (enviado ao renderer via push 'loop:event').
 * @param {string} type  ver docs/CODING_LOOP_EXECUTION.md
 */
function makeLoopEvent(type, runId, extra, now) {
  return { type, runId, timestamp: (now || new Date()).toISOString(), ...(extra || {}) };
}

/**
 * @typedef {Object} CodingLoopStepRun
 * @property {string} id
 * @property {string} stepId
 * @property {string} type          um de STEP_TYPES
 * @property {string} status        um de STEP_STATUSES
 * @property {number} attempt       1ª execução = 1; repetições incrementam
 * @property {string} [startedAt]
 * @property {string} [finishedAt]
 * @property {string} [summary]     resultado resumido (truncado)
 * @property {string} [stdout]      truncado (MAX_STEP_LOG_BYTES)
 * @property {string} [stderr]      truncado
 * @property {number} [exitCode]
 * @property {string} [sessionId]   sessão do agente, quando houver
 * @property {{costUsd?: number, durationMs?: number}} [usage]
 * @property {{passed: boolean, checks: Array, failedCriteria: string[]}} [validation]
 * @property {{title: string, description?: string, allowReject?: boolean, decision?: 'approved'|'rejected', reason?: string, decidedAt?: string}} [checkpoint]
 * @property {string} [error]       mensagem curta
 * @property {{condition: string, nextStepId?: string, terminalStatus?: string}} [transition]
 */

module.exports = {
  LOOP_STATUSES,
  TERMINAL_STATUSES,
  STEP_STATUSES,
  STEP_TYPES,
  TRANSITION_CONDITIONS,
  VALIDATION_CHECK_TYPES,
  MAX_STEP_LOG_BYTES,
  MAX_SUMMARY_CHARS,
  isTerminalStatus,
  truncateLog,
  truncateSummary,
  makeLoopEvent,
};
