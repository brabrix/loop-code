'use strict';

// Monta o runtime de Coding Loops usado pelo main.js: registry de executores,
// repositório e runner, com as dependências reais injetadas (agentes da Fase 1,
// spawn/kill/env do main). Deps são injetáveis pros testes.

const { StepExecutorRegistry } = require('./step-executor-registry.cjs');
const { createLoopRunner } = require('./loop-runner.cjs');
const { createLoopRunRepository } = require('./loop-run-repository.cjs');
const { createAgentStepExecutor } = require('./executors/agent-step-executor.cjs');
const { createCommandStepExecutor } = require('./executors/command-step-executor.cjs');
const { createHumanCheckpointExecutor } = require('./executors/human-checkpoint-executor.cjs');
const { createValidationStepExecutor } = require('./executors/validation-step-executor.cjs');
const templates = require('./templates.cjs');
const { validateDefinition } = require('./definition-validator.cjs');

function createLoopRuntime({ agentRuntime, dir, emit, spawn, kill, env, fs }) {
  const executorRegistry = new StepExecutorRegistry();
  executorRegistry.register(
    createAgentStepExecutor({
      agentRegistry: agentRuntime.registry,
      agentService: agentRuntime.service,
    }),
  );
  executorRegistry.register(createCommandStepExecutor({ spawn, kill, env }));
  executorRegistry.register(createHumanCheckpointExecutor());
  executorRegistry.register(createValidationStepExecutor({ fs }));

  const repository = createLoopRunRepository({ dir, fs });
  const runner = createLoopRunner({ executorRegistry, repository, emit });

  return { runner, repository, executorRegistry, templates, validateDefinition };
}

module.exports = { createLoopRuntime };
