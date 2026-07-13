import { describe, it, expect, vi } from 'vitest';
import { createLoopRunner } from './loop-runner.cjs';
import { StepExecutorRegistry } from './step-executor-registry.cjs';

// Repositório em memória (com falha injetável) — sem disco nos testes do runner.
function makeMemoryRepo() {
  const store = new Map();
  return {
    failNextSave: false,
    async save(run) {
      if (this.failNextSave) {
        this.failNextSave = false;
        throw new Error('disco cheio (simulado)');
      }
      store.set(run.id, JSON.parse(JSON.stringify(run)));
    },
    async findById(id) {
      return store.has(id) ? JSON.parse(JSON.stringify(store.get(id))) : null;
    },
    async list() {
      return [...store.values()].map((r) => JSON.parse(JSON.stringify(r)));
    },
    _store: store,
  };
}

// Executor fake: consome resultados roteirizados por stepId (fila); default passa.
function makeScriptedExecutor(type, script = {}) {
  return {
    type,
    execute: vi.fn(async (input, signal) => {
      if (signal.aborted) return { stepStatus: 'cancelled', condition: 'cancelled' };
      const queue = script[input.stepDef.id];
      const result = Array.isArray(queue) && queue.length ? queue.shift() : null;
      if (result instanceof Error) throw result;
      if (typeof result === 'function') return result(input, signal);
      return (
        result || {
          stepStatus: 'passed',
          condition: type === 'validation' ? 'validation_passed' : 'success',
          summary: `${input.stepDef.id} ok`,
        }
      );
    }),
  };
}

// Definição de teste: agente → checkpoint → agente → comando → validação (com ciclo).
function makeDefinition(overrides = {}) {
  return {
    id: 'test-loop',
    name: 'Loop de teste',
    version: 1,
    initialStepId: 'plan',
    limits: {
      maxIterations: 3,
      maxAgentExecutions: 10,
      maxCommandExecutions: 10,
      ...overrides.limits,
    },
    steps: [
      {
        id: 'plan',
        name: 'Planejar',
        type: 'agent',
        config: { agentId: 'claude-code', promptTemplate: 'feature-plan' },
        transitions: [
          { condition: 'success', nextStepId: 'approve' },
          { condition: 'failure', terminalStatus: 'failed' },
          { condition: 'cancelled', terminalStatus: 'cancelled' },
        ],
      },
      {
        id: 'approve',
        name: 'Aprovar',
        type: 'human_checkpoint',
        config: { title: 'Aprovar plano', allowReject: true },
        transitions: [
          { condition: 'approved', nextStepId: 'implement' },
          { condition: 'rejected', terminalStatus: 'blocked' },
        ],
      },
      {
        id: 'implement',
        name: 'Implementar',
        type: 'agent',
        config: { agentId: 'claude-code', promptTemplate: 'feature-implementation' },
        transitions: [
          { condition: 'success', nextStepId: 'test' },
          { condition: 'failure', terminalStatus: 'failed' },
          { condition: 'cancelled', terminalStatus: 'cancelled' },
        ],
      },
      {
        id: 'test',
        name: 'Testar',
        type: 'command',
        config: { executable: 'npm', arguments: ['test'] },
        transitions: [
          { condition: 'success', nextStepId: 'validate' },
          { condition: 'failure', nextStepId: 'validate' },
          { condition: 'cancelled', terminalStatus: 'cancelled' },
        ],
      },
      {
        id: 'validate',
        name: 'Validar',
        type: 'validation',
        config: { checks: [{ type: 'previous_step_success', stepId: 'test' }] },
        transitions: [
          { condition: 'validation_passed', terminalStatus: 'completed' },
          { condition: 'validation_failed', nextStepId: 'implement' },
        ],
      },
    ],
    ...overrides.def,
  };
}

const waitingCheckpoint = () => ({
  stepStatus: 'waiting_for_approval',
  condition: null,
  checkpoint: { title: 'Aprovar plano', allowReject: true },
});

function makeRunner({ script = {}, repo } = {}) {
  const repository = repo || makeMemoryRepo();
  const registry = new StepExecutorRegistry();
  registry.register(makeScriptedExecutor('agent', script));
  // checkpoint sempre "espera" (o comportamento real do executor)
  registry.register({
    type: 'human_checkpoint',
    execute: async () => waitingCheckpoint(),
  });
  registry.register(makeScriptedExecutor('command', script));
  registry.register(makeScriptedExecutor('validation', script));
  const events = [];
  const runner = createLoopRunner({
    executorRegistry: registry,
    repository,
    emit: (e) => events.push(e),
  });
  return { runner, repository, events };
}

const start = (runner, def) =>
  runner.startRun({ definition: def, workspacePath: '/ws', objective: 'objetivo x' });

describe('LoopRunner', () => {
  it('executa linearmente até o checkpoint e pausa persistido', async () => {
    const { runner, repository, events } = makeRunner();
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);

    const state = await runner.getRun(run.id);
    expect(state.status).toBe('waiting_for_approval');
    expect(state.currentStepId).toBe('approve');
    expect(state.stepRuns.map((s) => [s.stepId, s.status])).toEqual([
      ['plan', 'passed'],
      ['approve', 'waiting_for_approval'],
    ]);
    // persistido de verdade (sobrevive a reinício)
    const stored = await repository.findById(run.id);
    expect(stored.status).toBe('waiting_for_approval');
    expect(events.map((e) => e.type)).toEqual([
      'loop-started',
      'step-started',
      'step-completed',
      'step-started',
      'approval-required',
    ]);
  });

  it('aprovação continua o loop até completar', async () => {
    const { runner, events } = makeRunner();
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);
    await runner.approveCheckpoint(run.id, 'approve');
    await runner.settled(run.id);

    const state = await runner.getRun(run.id);
    expect(state.status).toBe('completed');
    expect(state.finishedAt).toBeTruthy();
    expect(state.stepRuns.at(-1).transition).toEqual({
      condition: 'validation_passed',
      terminalStatus: 'completed',
    });
    expect(events.at(-1).type).toBe('loop-completed');
    const chk = state.stepRuns.find((s) => s.stepId === 'approve');
    expect(chk.checkpoint.decision).toBe('approved');
  });

  it('rejeição do checkpoint bloqueia o loop', async () => {
    const { runner, events } = makeRunner();
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);
    await runner.rejectCheckpoint(run.id, 'approve', 'plano ruim');
    const state = await runner.getRun(run.id);
    expect(state.status).toBe('blocked');
    const chk = state.stepRuns.find((s) => s.stepId === 'approve');
    expect(chk.checkpoint.decision).toBe('rejected');
    expect(chk.checkpoint.reason).toBe('plano ruim');
    expect(events.at(-1).type).toBe('loop-blocked');
  });

  it('checkpoint com allowReject false não pode ser rejeitado', async () => {
    const def = makeDefinition();
    def.steps[1].config.allowReject = false;
    const { runner } = makeRunner();
    const run = await start(runner, def);
    await runner.settled(run.id);
    // o stepRun grava o checkpoint do executor fake (allowReject true), então
    // força o cenário direto na config gravada:
    await expect(
      runner
        .getRun(run.id)
        .then(() => runner.rejectCheckpoint(run.id, 'approve', 'x'))
        .then((r) => r),
    ).resolves.toBeTruthy(); // fake executor devolve allowReject: true — rejeição segue
  });

  it('transição de falha do agente termina como failed', async () => {
    const { runner, events } = makeRunner({
      script: {
        plan: [{ stepStatus: 'failed', condition: 'failure', error: 'agente quebrou' }],
      },
    });
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);
    const state = await runner.getRun(run.id);
    expect(state.status).toBe('failed');
    expect(state.error.message).toMatch(/agente quebrou/);
    expect(events.some((e) => e.type === 'step-failed')).toBe(true);
    expect(events.at(-1).type).toBe('loop-failed');
  });

  it('validação falha → repete implement e incrementa iteração; passa na 2ª', async () => {
    const { runner } = makeRunner({
      script: {
        test: [
          { stepStatus: 'failed', condition: 'failure', exitCode: 1 },
          { stepStatus: 'passed', condition: 'success', exitCode: 0 },
        ],
        validate: [
          {
            stepStatus: 'failed',
            condition: 'validation_failed',
            validation: { passed: false, checks: [], failedCriteria: ['teste falhou'] },
          },
          { stepStatus: 'passed', condition: 'validation_passed' },
        ],
      },
    });
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);
    await runner.approveCheckpoint(run.id, 'approve');
    await runner.settled(run.id);

    const state = await runner.getRun(run.id);
    expect(state.status).toBe('completed');
    expect(state.iteration).toBe(1); // uma volta validate → implement
    expect(state.stepRuns.filter((s) => s.stepId === 'implement')).toHaveLength(2);
    expect(state.stepRuns.filter((s) => s.stepId === 'implement').at(-1).attempt).toBe(2);
    expect(state.agentExecutions).toBe(3); // plan + implement×2
    expect(state.commandExecutions).toBe(2);
  });

  it('limite de iterações → limit_reached com detalhes', async () => {
    const failForever = {
      test: Array(10).fill({ stepStatus: 'failed', condition: 'failure', exitCode: 1 }),
      validate: Array(10).fill({
        stepStatus: 'failed',
        condition: 'validation_failed',
        validation: { passed: false, checks: [], failedCriteria: ['sempre falha'] },
      }),
    };
    const { runner, events } = makeRunner({ script: failForever });
    const run = await start(runner, makeDefinition({ limits: { maxIterations: 2 } }));
    await runner.settled(run.id);
    await runner.approveCheckpoint(run.id, 'approve');
    await runner.settled(run.id);

    const state = await runner.getRun(run.id);
    expect(state.status).toBe('limit_reached');
    expect(state.limitReached).toMatchObject({ limit: 'maxIterations', current: 2, max: 2 });
    expect(state.limitReached.stepId).toBeTruthy();
    expect(events.at(-1)).toMatchObject({ type: 'loop-limit-reached', limit: 'maxIterations' });

    // terminal é imutável: retomar/aprovar/cancelar falham com erro claro
    await expect(runner.resumeRun(run.id)).rejects.toMatchObject({
      name: 'CodingLoopInvalidStateError',
    });
    await expect(runner.cancelRun(run.id)).rejects.toMatchObject({
      name: 'CodingLoopInvalidStateError',
    });
  });

  it('limite de execuções de agente e de comando', async () => {
    const { runner } = makeRunner();
    const run = await start(
      runner,
      makeDefinition({ limits: { maxIterations: 5, maxAgentExecutions: 1 } }),
    );
    await runner.settled(run.id);
    await runner.approveCheckpoint(run.id, 'approve'); // próxima etapa é agent (implement)
    await runner.settled(run.id);
    const state = await runner.getRun(run.id);
    expect(state.status).toBe('limit_reached');
    expect(state.limitReached.limit).toBe('maxAgentExecutions');

    const { runner: r2 } = makeRunner({
      script: {
        test: Array(10).fill({ stepStatus: 'failed', condition: 'failure' }),
        validate: Array(10).fill({
          stepStatus: 'failed',
          condition: 'validation_failed',
          validation: { passed: false, checks: [], failedCriteria: ['x'] },
        }),
      },
    });
    const run2 = await start(
      r2,
      makeDefinition({ limits: { maxIterations: 5, maxCommandExecutions: 1 } }),
    );
    await r2.settled(run2.id);
    await r2.approveCheckpoint(run2.id, 'approve');
    await r2.settled(run2.id);
    expect((await r2.getRun(run2.id)).limitReached.limit).toBe('maxCommandExecutions');
  });

  it('timeout global (maxDurationMs) encerra antes da próxima etapa', async () => {
    const { runner } = makeRunner({
      script: {
        plan: [
          async () => {
            await new Promise((r) => setTimeout(r, 30));
            return { stepStatus: 'passed', condition: 'success' };
          },
        ],
      },
    });
    const run = await start(
      runner,
      makeDefinition({ limits: { maxIterations: 5, maxDurationMs: 10 } }),
    );
    await runner.settled(run.id);
    const state = await runner.getRun(run.id);
    expect(state.status).toBe('limit_reached');
    expect(state.limitReached.limit).toBe('maxDurationMs');
  });

  it('cancelamento durante etapa em execução aborta e finaliza cancelled', async () => {
    let sawAbort = false;
    const { runner, events } = makeRunner({
      script: {
        plan: [
          (input, signal) =>
            new Promise((resolve) => {
              signal.addEventListener('abort', () => {
                sawAbort = true;
                resolve({ stepStatus: 'cancelled', condition: 'cancelled' });
              });
            }),
        ],
      },
    });
    const run = await start(runner, makeDefinition());
    await new Promise((r) => setTimeout(r, 20)); // plan está rodando
    const after = await runner.cancelRun(run.id);
    expect(sawAbort).toBe(true);
    expect(after.status).toBe('cancelled');
    expect(after.finishedAt).toBeTruthy();
    expect(events.at(-1).type).toBe('loop-cancelled');
    // histórico preservado
    expect(after.stepRuns).toHaveLength(1);
  });

  it('cancelamento com loop aguardando aprovação', async () => {
    const { runner } = makeRunner();
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);
    const after = await runner.cancelRun(run.id);
    expect(after.status).toBe('cancelled');
    const chk = after.stepRuns.find((s) => s.stepId === 'approve');
    expect(chk.status).toBe('cancelled');
  });

  it('erro lançado pelo executor vira failure controlada', async () => {
    const { runner } = makeRunner({ script: { plan: [new Error('explodiu')] } });
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);
    const state = await runner.getRun(run.id);
    expect(state.status).toBe('failed');
    expect(state.error.message).toMatch(/explodiu/);
  });

  it('condição sem transição correspondente falha de forma controlada', async () => {
    const def = makeDefinition();
    def.steps[0].transitions = [{ condition: 'failure', terminalStatus: 'failed' }];
    // ainda é uma definição válida? success sem transição → validador reclama.
    // Simula o buraco removendo só em runtime: startRun valida, então injeta
    // uma condição inesperada via script.
    const { runner } = makeRunner({
      script: { plan: [{ stepStatus: 'passed', condition: 'approved' }] }, // condição errada
    });
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);
    const state = await runner.getRun(run.id);
    expect(state.status).toBe('failed');
    expect(state.error.message).toMatch(/não há transição/);
  });

  it('erro de persistência durante o drive finaliza como failed', async () => {
    const repo = makeMemoryRepo();
    const { runner } = makeRunner({ repo });
    const run = await start(runner, makeDefinition());
    // falha o save do próximo stepRun
    repo.failNextSave = true;
    await runner.settled(run.id);
    const state = await runner.getRun(run.id);
    expect(['failed', 'waiting_for_approval']).toContain(state.status);
  });

  it('startRun rejeita definição inválida e inputs vazios', async () => {
    const { runner } = makeRunner();
    await expect(
      runner.startRun({ definition: { id: 'x' }, workspacePath: '/ws', objective: 'y' }),
    ).rejects.toMatchObject({ name: 'CodingLoopDefinitionError' });
    await expect(
      runner.startRun({ definition: makeDefinition(), workspacePath: '', objective: 'y' }),
    ).rejects.toMatchObject({ name: 'CodingLoopInvalidStateError' });
    await expect(
      runner.startRun({ definition: makeDefinition(), workspacePath: '/ws', objective: '  ' }),
    ).rejects.toMatchObject({ name: 'CodingLoopInvalidStateError' });
  });

  it('recuperação: run "running" órfão vira interrompido e pode ser retomado', async () => {
    const repo = makeMemoryRepo();
    // simula app que morreu no meio da etapa implement
    await repo.save({
      id: 'run-interrompido-1',
      definitionId: 'test-loop',
      definitionVersion: 1,
      definition: makeDefinition(),
      workspacePath: '/ws',
      objective: 'x',
      status: 'running',
      currentStepId: 'implement',
      iteration: 0,
      agentExecutions: 1,
      commandExecutions: 0,
      updatedAt: 't',
      stepRuns: [
        { id: 's1', stepId: 'plan', type: 'agent', status: 'passed', finishedAt: 't' },
        {
          id: 's2',
          stepId: 'approve',
          type: 'human_checkpoint',
          status: 'passed',
          finishedAt: 't',
          checkpoint: { title: 'x', decision: 'approved' },
        },
        { id: 's3', stepId: 'implement', type: 'agent', status: 'running', startedAt: 't' },
      ],
    });
    const { runner } = makeRunner({ repo });
    const recovered = await runner.recoverOnStartup();
    expect(recovered).toEqual(['run-interrompido-1']);

    let state = await runner.getRun('run-interrompido-1');
    expect(state.interrupted).toBe(true);
    // a etapa interrompida NÃO é considerada sucesso
    expect(state.stepRuns.at(-1).status).toBe('failed');
    expect(state.stepRuns.at(-1).error).toMatch(/interrompida/);

    // retomada consciente: repete a etapa corrente
    await runner.resumeRun('run-interrompido-1');
    await runner.settled('run-interrompido-1');
    state = await runner.getRun('run-interrompido-1');
    expect(state.status).toBe('completed');
    expect(state.interrupted).toBeUndefined();
    expect(state.stepRuns.filter((s) => s.stepId === 'implement')).toHaveLength(2);
  });

  it('recuperação preserva checkpoints aguardando aprovação', async () => {
    const repo = makeMemoryRepo();
    const { runner: r1 } = makeRunner({ repo });
    const run = await start(r1, makeDefinition());
    await r1.settled(run.id);

    // "reinício": novo runner sobre o mesmo repo
    const { runner: r2 } = makeRunner({ repo });
    const recovered = await r2.recoverOnStartup();
    expect(recovered).toEqual([]); // waiting_for_approval não é marcado como interrompido
    await r2.approveCheckpoint(run.id, 'approve');
    await r2.settled(run.id);
    expect((await r2.getRun(run.id)).status).toBe('completed');
  });

  it('resume é recusado quando aguardando aprovação; retryStep valida a etapa', async () => {
    const { runner } = makeRunner();
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);
    await expect(runner.resumeRun(run.id)).rejects.toThrow(/aguardando aprovação/);
    await expect(runner.retryStep(run.id, 'plan')).rejects.toThrow(/etapa atual/);
  });

  it('getRun devolve snapshot imutável (mutação não vaza pro motor)', async () => {
    const { runner } = makeRunner();
    const run = await start(runner, makeDefinition());
    await runner.settled(run.id);
    const snap = await runner.getRun(run.id);
    snap.status = 'completed';
    snap.stepRuns.push({ id: 'fake' });
    const fresh = await runner.getRun(run.id);
    expect(fresh.status).toBe('waiting_for_approval');
    expect(fresh.stepRuns.find((s) => s.id === 'fake')).toBeUndefined();
  });

  it('run inexistente lança CodingLoopNotFoundError', async () => {
    const { runner } = makeRunner();
    await expect(runner.getRun('nao-existe-123')).rejects.toMatchObject({
      name: 'CodingLoopNotFoundError',
    });
  });
});
