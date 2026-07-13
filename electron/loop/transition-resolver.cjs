'use strict';

// Decide o que acontece depois de uma etapa: próxima etapa, estado terminal ou
// falha controlada quando nenhuma transição cobre a condição produzida.
// O agente NUNCA decide isso — só o motor, com base na definição.

const { isTerminalStatus } = require('./loop-types.cjs');
const { CodingLoopError } = require('./loop-errors.cjs');

/**
 * @param {object} stepDef   definição da etapa executada
 * @param {string} condition condição produzida ('success', 'validation_failed'…)
 * @returns {{ condition: string, nextStepId?: string, terminalStatus?: string }}
 *          A decisão registrável. Lança CodingLoopError quando não há transição.
 */
function resolveTransition(stepDef, condition) {
  const transitions = (stepDef && stepDef.transitions) || [];
  const match = transitions.find((t) => t && t.condition === condition);
  if (!match) {
    throw new CodingLoopError(
      `A etapa "${stepDef && stepDef.id}" produziu "${condition}", mas não há transição para essa condição.`,
      'no-transition',
      { stepId: stepDef && stepDef.id, condition },
    );
  }
  if (match.terminalStatus) {
    if (!isTerminalStatus(match.terminalStatus)) {
      throw new CodingLoopError(
        `Transição de "${stepDef.id}" aponta para status não-terminal: "${match.terminalStatus}".`,
        'invalid-transition-target',
      );
    }
    return { condition, terminalStatus: match.terminalStatus };
  }
  return { condition, nextStepId: match.nextStepId };
}

module.exports = { resolveTransition };
