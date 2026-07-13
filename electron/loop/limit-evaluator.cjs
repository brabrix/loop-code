'use strict';

// Proteção contra loops infinitos: avalia os limites ANTES de cada etapa.
// Quando um limite é atingido o run vira `limit_reached` (terminal).

/**
 * @param {object} run     CodingLoopRun corrente
 * @param {object} limits  CodingLoopLimits da definição
 * @param {object} [opts]  { nextStepType, now } — tipo da etapa prestes a rodar
 * @returns {null | { limit: string, current: number, max: number }}
 */
function evaluateLimits(run, limits, opts = {}) {
  const l = limits || {};
  const nextType = opts.nextStepType;
  const now = opts.now ? opts.now.getTime() : Date.now();

  if (Number.isInteger(l.maxIterations) && run.iteration >= l.maxIterations) {
    return { limit: 'maxIterations', current: run.iteration, max: l.maxIterations };
  }
  if (Number.isInteger(l.maxDurationMs) && run.startedAt) {
    const elapsed = now - Date.parse(run.startedAt);
    if (elapsed >= l.maxDurationMs)
      return { limit: 'maxDurationMs', current: elapsed, max: l.maxDurationMs };
  }
  if (
    nextType === 'agent' &&
    Number.isInteger(l.maxAgentExecutions) &&
    run.agentExecutions >= l.maxAgentExecutions
  ) {
    return { limit: 'maxAgentExecutions', current: run.agentExecutions, max: l.maxAgentExecutions };
  }
  if (
    nextType === 'command' &&
    Number.isInteger(l.maxCommandExecutions) &&
    run.commandExecutions >= l.maxCommandExecutions
  ) {
    return {
      limit: 'maxCommandExecutions',
      current: run.commandExecutions,
      max: l.maxCommandExecutions,
    };
  }
  return null;
}

module.exports = { evaluateLimits };
