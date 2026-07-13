'use strict';

// Templates locais de Coding Loop. São FUNÇÕES: a UI passa as opções do
// usuário (comando de validação, limites, agente) e recebe uma definição
// completa, validada pelo definition-validator antes de rodar.

const DEFAULT_VALIDATION = {
  executable: 'npm',
  arguments: ['test'],
  timeoutMs: 300000,
  successExitCodes: [0],
};

const DEFAULT_LIMITS = {
  maxIterations: 5,
  maxAgentExecutions: 6,
  maxCommandExecutions: 6,
  maxDurationMs: 3600000,
};

function normalizeOptions(options = {}) {
  const validation = { ...DEFAULT_VALIDATION, ...(options.validationCommand || {}) };
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  if (Number.isInteger(options.maxIterations)) limits.maxIterations = options.maxIterations;
  const agentId = options.agentId || 'claude-code';
  return { validation, limits, agentId };
}

/**
 * Template "Feature Development":
 *   plan → approve-plan → implement → run-validation → evaluate-result
 *   → implement (falhou) | completed (passou)
 */
function buildFeatureDevelopmentDefinition(options = {}) {
  const { validation, limits, agentId } = normalizeOptions(options);
  return {
    id: 'feature-development',
    name: 'Feature Development',
    description:
      'Planeja, aguarda aprovação humana, implementa, valida e repete até passar ou atingir o limite.',
    version: 1,
    initialStepId: 'plan',
    limits,
    steps: [
      {
        id: 'plan',
        name: 'Criar plano de implementação',
        type: 'agent',
        config: { agentId, promptTemplate: 'feature-plan' },
        transitions: [
          { condition: 'success', nextStepId: 'approve-plan' },
          { condition: 'failure', terminalStatus: 'failed' },
          { condition: 'cancelled', terminalStatus: 'cancelled' },
        ],
      },
      {
        id: 'approve-plan',
        name: 'Aprovar plano de implementação',
        type: 'human_checkpoint',
        config: {
          title: 'Aprovar plano de implementação',
          description: 'Revise o plano proposto pelo agente antes da implementação.',
          allowReject: true,
        },
        transitions: [
          { condition: 'approved', nextStepId: 'implement' },
          { condition: 'rejected', terminalStatus: 'blocked' },
        ],
      },
      {
        id: 'implement',
        name: 'Implementar a feature',
        type: 'agent',
        config: { agentId, promptTemplate: 'feature-implementation' },
        transitions: [
          { condition: 'success', nextStepId: 'run-validation' },
          { condition: 'failure', terminalStatus: 'failed' },
          { condition: 'cancelled', terminalStatus: 'cancelled' },
        ],
      },
      {
        id: 'run-validation',
        name: 'Rodar validação do projeto',
        type: 'command',
        config: validation,
        transitions: [
          // falha do comando NÃO termina o loop: a etapa de validação decide
          { condition: 'success', nextStepId: 'evaluate-result' },
          { condition: 'failure', nextStepId: 'evaluate-result' },
          { condition: 'cancelled', terminalStatus: 'cancelled' },
        ],
      },
      {
        id: 'evaluate-result',
        name: 'Avaliar validação',
        type: 'validation',
        config: {
          checks: [{ type: 'previous_step_success', stepId: 'run-validation' }],
          onFailure: 'repeat_previous_agent_step',
        },
        transitions: [
          { condition: 'validation_passed', terminalStatus: 'completed' },
          { condition: 'validation_failed', nextStepId: 'implement' },
        ],
      },
    ],
  };
}

/**
 * Template "Bug Fix":
 *   analyze → approve-diagnosis → fix → run-tests → validate
 *   → fix (falhou) | completed (passou)
 */
function buildBugFixDefinition(options = {}) {
  const { validation, limits, agentId } = normalizeOptions(options);
  return {
    id: 'bug-fix',
    name: 'Bug Fix',
    description:
      'Diagnostica o bug, aguarda aprovação do diagnóstico, corrige, testa e repete até passar.',
    version: 1,
    initialStepId: 'analyze',
    limits,
    steps: [
      {
        id: 'analyze',
        name: 'Diagnosticar o bug',
        type: 'agent',
        config: { agentId, promptTemplate: 'bugfix-analysis' },
        transitions: [
          { condition: 'success', nextStepId: 'approve-diagnosis' },
          { condition: 'failure', terminalStatus: 'failed' },
          { condition: 'cancelled', terminalStatus: 'cancelled' },
        ],
      },
      {
        id: 'approve-diagnosis',
        name: 'Aprovar diagnóstico',
        type: 'human_checkpoint',
        config: {
          title: 'Aprovar diagnóstico do bug',
          description: 'Revise a causa raiz e a correção proposta antes de aplicar.',
          allowReject: true,
        },
        transitions: [
          { condition: 'approved', nextStepId: 'fix' },
          { condition: 'rejected', terminalStatus: 'blocked' },
        ],
      },
      {
        id: 'fix',
        name: 'Corrigir o bug',
        type: 'agent',
        config: { agentId, promptTemplate: 'bugfix-implementation' },
        transitions: [
          { condition: 'success', nextStepId: 'run-tests' },
          { condition: 'failure', terminalStatus: 'failed' },
          { condition: 'cancelled', terminalStatus: 'cancelled' },
        ],
      },
      {
        id: 'run-tests',
        name: 'Rodar testes',
        type: 'command',
        config: validation,
        transitions: [
          { condition: 'success', nextStepId: 'validate' },
          { condition: 'failure', nextStepId: 'validate' },
          { condition: 'cancelled', terminalStatus: 'cancelled' },
        ],
      },
      {
        id: 'validate',
        name: 'Avaliar correção',
        type: 'validation',
        config: {
          checks: [{ type: 'previous_step_success', stepId: 'run-tests' }],
          onFailure: 'repeat_previous_agent_step',
        },
        transitions: [
          { condition: 'validation_passed', terminalStatus: 'completed' },
          { condition: 'validation_failed', nextStepId: 'fix' },
        ],
      },
    ],
  };
}

const TEMPLATE_BUILDERS = {
  'feature-development': buildFeatureDevelopmentDefinition,
  'bug-fix': buildBugFixDefinition,
};

function listTemplates() {
  return Object.entries(TEMPLATE_BUILDERS).map(([id, build]) => {
    const def = build();
    return { id, name: def.name, description: def.description, defaults: def.limits };
  });
}

function buildTemplate(templateId, options) {
  const build = TEMPLATE_BUILDERS[templateId];
  if (!build) return null;
  return build(options);
}

module.exports = {
  buildFeatureDevelopmentDefinition,
  buildBugFixDefinition,
  listTemplates,
  buildTemplate,
  DEFAULT_VALIDATION,
  DEFAULT_LIMITS,
};
