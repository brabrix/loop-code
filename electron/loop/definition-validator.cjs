'use strict';

// Validação estrutural de uma CodingLoopDefinition ANTES de qualquer execução.
// Devolve mensagens compreensíveis (uma por problema); o runner só aceita
// definições que passem por aqui.

const {
  STEP_TYPES,
  TRANSITION_CONDITIONS,
  LOOP_STATUSES,
  TERMINAL_STATUSES,
  VALIDATION_CHECK_TYPES,
} = require('./loop-types.cjs');
const { CodingLoopDefinitionError } = require('./loop-errors.cjs');

// Condições que cada tipo de etapa pode produzir (transições fora disso são
// inúteis e quase sempre indicam erro de autoria).
const CONDITIONS_BY_TYPE = {
  agent: ['success', 'failure', 'cancelled'],
  command: ['success', 'failure', 'cancelled'],
  human_checkpoint: ['approved', 'rejected', 'cancelled'],
  validation: ['validation_passed', 'validation_failed', 'cancelled'],
};

function validateStepConfig(step, errors) {
  const cfg = step.config;
  const where = `etapa "${step.id}"`;
  if (!cfg || typeof cfg !== 'object') {
    errors.push(`A ${where} não tem config.`);
    return;
  }
  if (step.type === 'agent') {
    if (typeof cfg.agentId !== 'string' || !cfg.agentId.trim())
      errors.push(`A ${where} é do tipo agent e precisa de config.agentId.`);
    if (typeof cfg.promptTemplate !== 'string' || !cfg.promptTemplate.trim())
      errors.push(`A ${where} é do tipo agent e precisa de config.promptTemplate.`);
  } else if (step.type === 'command') {
    if (typeof cfg.executable !== 'string' || !cfg.executable.trim())
      errors.push(`A ${where} é do tipo command e precisa de config.executable (não vazio).`);
    if (!Array.isArray(cfg.arguments) || cfg.arguments.some((a) => typeof a !== 'string'))
      errors.push(`A ${where} precisa de config.arguments como array de strings (pode ser []).`);
    // executable com espaço/metacaractere sugere comando colado em string única
    if (typeof cfg.executable === 'string' && /[\s|&;<>$`]/.test(cfg.executable.trim()))
      errors.push(
        `A ${where} tem config.executable "${cfg.executable}" — argumentos vão separados em config.arguments, sem metacaracteres de shell.`,
      );
    if (cfg.timeoutMs != null && (typeof cfg.timeoutMs !== 'number' || cfg.timeoutMs <= 0))
      errors.push(`A ${where} tem timeoutMs inválido (precisa ser número > 0).`);
    if (
      cfg.successExitCodes != null &&
      (!Array.isArray(cfg.successExitCodes) ||
        cfg.successExitCodes.some((c) => !Number.isInteger(c)))
    )
      errors.push(`A ${where} tem successExitCodes inválido (array de inteiros).`);
  } else if (step.type === 'human_checkpoint') {
    if (typeof cfg.title !== 'string' || !cfg.title.trim())
      errors.push(`A ${where} é um checkpoint humano e precisa de config.title.`);
  } else if (step.type === 'validation') {
    if (!Array.isArray(cfg.checks) || cfg.checks.length === 0) {
      errors.push(`A ${where} é do tipo validation e precisa de config.checks (≥ 1).`);
    } else {
      cfg.checks.forEach((check, i) => {
        if (!check || typeof check !== 'object' || !VALIDATION_CHECK_TYPES.includes(check.type)) {
          errors.push(
            `A ${where} tem check #${i + 1} com type inválido (use: ${VALIDATION_CHECK_TYPES.join(', ')}).`,
          );
          return;
        }
        if (
          ['file_exists', 'file_contains', 'files_changed'].includes(check.type) &&
          (typeof check.path !== 'string' || !check.path.trim())
        )
          errors.push(`A ${where} tem check ${check.type} sem path.`);
        if (check.type === 'file_contains' && (typeof check.text !== 'string' || !check.text))
          errors.push(`A ${where} tem check file_contains sem text.`);
        if (
          ['previous_step_success', 'command_result'].includes(check.type) &&
          (typeof check.stepId !== 'string' || !check.stepId.trim())
        )
          errors.push(`A ${where} tem check ${check.type} sem stepId.`);
        if (check.type === 'boolean' && typeof check.value !== 'boolean')
          errors.push(`A ${where} tem check boolean sem value booleano.`);
      });
    }
    if (
      cfg.onFailure != null &&
      !['repeat_previous_agent_step', 'fail', 'block'].includes(cfg.onFailure)
    )
      errors.push(`A ${where} tem onFailure inválido: "${cfg.onFailure}".`);
  }
}

/**
 * Valida uma definição. Retorna { ok: boolean, errors: string[] }.
 */
function validateDefinition(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return { ok: false, errors: ['Definição ausente.'] };

  if (typeof def.id !== 'string' || !def.id.trim()) errors.push('A definição precisa de um id.');
  if (typeof def.name !== 'string' || !def.name.trim())
    errors.push('A definição precisa de um name.');
  if (!Number.isInteger(def.version) || def.version < 1)
    errors.push('A definição precisa de version inteira ≥ 1.');

  const steps = Array.isArray(def.steps) ? def.steps : [];
  if (steps.length === 0) errors.push('A definição precisa de pelo menos uma etapa.');

  const ids = new Set();
  for (const step of steps) {
    if (!step || typeof step !== 'object' || typeof step.id !== 'string' || !step.id.trim()) {
      errors.push('Há uma etapa sem id.');
      continue;
    }
    if (ids.has(step.id)) errors.push(`ID de etapa duplicado: "${step.id}".`);
    ids.add(step.id);
    if (typeof step.name !== 'string' || !step.name.trim())
      errors.push(`A etapa "${step.id}" precisa de um name.`);
    if (!STEP_TYPES.includes(step.type))
      errors.push(
        `A etapa "${step.id}" tem type inválido: "${step.type}" (use: ${STEP_TYPES.join(', ')}).`,
      );
    else validateStepConfig(step, errors);
  }

  if (typeof def.initialStepId !== 'string' || !ids.has(def.initialStepId))
    errors.push(`initialStepId aponta para uma etapa inexistente: "${def.initialStepId}".`);

  // Transições
  let anyTerminal = false;
  for (const step of steps) {
    if (!step || !ids.has(step.id)) continue;
    const transitions = step.transitions || [];
    if (!Array.isArray(transitions) || transitions.length === 0) {
      errors.push(`A etapa "${step.id}" não tem transições — o loop não saberia continuar.`);
      continue;
    }
    const allowed = CONDITIONS_BY_TYPE[step.type] || TRANSITION_CONDITIONS;
    for (const t of transitions) {
      if (!t || !TRANSITION_CONDITIONS.includes(t.condition)) {
        errors.push(`A etapa "${step.id}" tem transição com condition inválida.`);
        continue;
      }
      if (!allowed.includes(t.condition))
        errors.push(
          `A etapa "${step.id}" (${step.type}) nunca produz a condição "${t.condition}".`,
        );
      const hasNext = typeof t.nextStepId === 'string' && t.nextStepId.trim();
      const hasTerminal = typeof t.terminalStatus === 'string' && t.terminalStatus.trim();
      if (!hasNext && !hasTerminal)
        errors.push(`A etapa "${step.id}" tem transição "${t.condition}" sem destino.`);
      if (hasNext && hasTerminal)
        errors.push(
          `A etapa "${step.id}" tem transição "${t.condition}" com nextStepId E terminalStatus — escolha um.`,
        );
      if (hasNext && !ids.has(t.nextStepId))
        errors.push(`A etapa "${step.id}" aponta para uma etapa inexistente: "${t.nextStepId}".`);
      if (hasTerminal) {
        if (
          !LOOP_STATUSES.includes(t.terminalStatus) ||
          !TERMINAL_STATUSES.includes(t.terminalStatus)
        )
          errors.push(
            `A etapa "${step.id}" tem terminalStatus inválido: "${t.terminalStatus}" (use: ${TERMINAL_STATUSES.join(', ')}).`,
          );
        else anyTerminal = true;
      }
    }
  }
  if (steps.length > 0 && !anyTerminal)
    errors.push('Nenhuma transição leva a um estado terminal — o loop nunca terminaria.');

  // Limites — obrigatórios e positivos: são a proteção contra ciclos infinitos
  // (a definição PODE ter ciclos, ex.: validate → implement; o teto encerra).
  const limits = def.limits;
  if (!limits || typeof limits !== 'object') {
    errors.push('A definição precisa de limits (com maxIterations ≥ 1).');
  } else {
    if (!Number.isInteger(limits.maxIterations) || limits.maxIterations < 1)
      errors.push('limits.maxIterations precisa ser inteiro ≥ 1.');
    for (const key of ['maxDurationMs', 'maxAgentExecutions', 'maxCommandExecutions']) {
      if (limits[key] != null && (!Number.isInteger(limits[key]) || limits[key] < 1))
        errors.push(`limits.${key} precisa ser inteiro ≥ 1 quando informado.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Valida e lança CodingLoopDefinitionError com todas as mensagens. */
function assertValidDefinition(def) {
  const { ok, errors } = validateDefinition(def);
  if (!ok) throw new CodingLoopDefinitionError(errors);
  return def;
}

module.exports = { validateDefinition, assertValidDefinition, CONDITIONS_BY_TYPE };
