import { describe, it, expect, vi } from 'vitest';
import { createAgentStepExecutor } from './agent-step-executor.cjs';

function makeDeps({ availability, executeImpl } = {}) {
  const adapter = {
    descriptor: { id: 'claude-code', name: 'Claude Code' },
    checkAvailability: vi.fn(async () => availability ?? { available: true, version: '2.0' }),
  };
  const agentRegistry = {
    get: vi.fn((id) => {
      if (id !== 'claude-code') throw new Error('não registrado');
      return adapter;
    }),
  };
  const agentService = {
    execute: vi.fn(
      executeImpl ||
        (async (agentId, input) => ({
          executionId: input.executionId,
          agentId,
          status: 'completed',
          output: 'Plano criado.',
          sessionId: 'sess-1',
          usage: { costUsd: 0.05 },
        })),
    ),
    cancel: vi.fn(async () => {}),
  };
  return { agentRegistry, agentService, adapter };
}

const stepDef = {
  id: 'plan',
  name: 'Criar plano',
  type: 'agent',
  config: { agentId: 'claude-code', promptTemplate: 'feature-plan' },
};

const input = (deps, extra = {}) => ({
  run: { iteration: 0, stepRuns: [], ...extra.run },
  stepDef: extra.stepDef || stepDef,
  workspacePath: '/ws/projeto',
  objective: 'Adicionar login',
  limits: { maxIterations: 5 },
  emitOutput: extra.emitOutput,
});

describe('AgentStepExecutor', () => {
  it('executa pelo service com workspace e prompt corretos', async () => {
    const deps = makeDeps();
    const executor = createAgentStepExecutor({ ...deps, idGen: () => 'exec-1' });
    const r = await executor.execute(input(deps), new AbortController().signal);
    expect(r.stepStatus).toBe('passed');
    expect(r.condition).toBe('success');
    expect(r.sessionId).toBe('sess-1');
    const [agentId, execInput] = deps.agentService.execute.mock.calls[0];
    expect(agentId).toBe('claude-code');
    expect(execInput.workspacePath).toBe('/ws/projeto');
    expect(execInput.executionId).toBe('exec-1');
    expect(execInput.prompt).toContain('Adicionar login');
    expect(execInput.prompt).toContain('Criar plano');
  });

  it('agente não registrado → failed com mensagem legível', async () => {
    const deps = makeDeps();
    const executor = createAgentStepExecutor(deps);
    const bad = {
      ...stepDef,
      config: { agentId: 'gemini', promptTemplate: 'feature-plan' },
    };
    const r = await executor.execute(input(deps, { stepDef: bad }), new AbortController().signal);
    expect(r.stepStatus).toBe('failed');
    expect(r.error).toMatch(/não está disponível.*gemini/);
    expect(deps.agentService.execute).not.toHaveBeenCalled();
  });

  it('agente indisponível (CLI não instalada) → failed com o motivo', async () => {
    const deps = makeDeps({ availability: { available: false, reason: 'CLI não respondeu' } });
    const executor = createAgentStepExecutor(deps);
    const r = await executor.execute(input(deps), new AbortController().signal);
    expect(r.stepStatus).toBe('failed');
    expect(r.error).toMatch(/Claude Code.*não está disponível.*CLI não respondeu/);
  });

  it('falha do agente → failed/failure com erro do resultado', async () => {
    const deps = makeDeps({
      executeImpl: async (agentId, input) => ({
        executionId: input.executionId,
        agentId,
        status: 'failed',
        error: { code: 'execution-error', message: 'Claude Code terminou com código 1.' },
        errorOutput: 'stack interna',
      }),
    });
    const executor = createAgentStepExecutor(deps);
    const r = await executor.execute(input(deps), new AbortController().signal);
    expect(r.stepStatus).toBe('failed');
    expect(r.error).toMatch(/código 1/);
  });

  it('cancelamento: aborto do signal chama service.cancel e resultado vira cancelled', async () => {
    let resolveExec;
    const deps = makeDeps({
      executeImpl: (agentId, input) =>
        new Promise((resolve) => {
          resolveExec = () =>
            resolve({ executionId: input.executionId, agentId, status: 'cancelled' });
        }),
    });
    const executor = createAgentStepExecutor({ ...deps, idGen: () => 'exec-9' });
    const controller = new AbortController();
    const promise = executor.execute(input(deps), controller.signal);
    // espera a execução do agente COMEÇAR antes de abortar (senão o executor
    // devolve cancelled cedo, sem precisar chamar o cancel do service)
    await vi.waitFor(() => expect(deps.agentService.execute).toHaveBeenCalled());
    controller.abort();
    // o cancel do service é chamado com o executionId certo
    await vi.waitFor(() =>
      expect(deps.agentService.cancel).toHaveBeenCalledWith('claude-code', 'exec-9'),
    );
    resolveExec();
    const r = await promise;
    expect(r.stepStatus).toBe('cancelled');
  });

  it('streaming: eventos do agente viram emitOutput', async () => {
    const deps = makeDeps({
      executeImpl: async (agentId, input, onEvent) => {
        onEvent({ type: 'agent-message', event: { kind: 'text', text: 'pensando…' } });
        onEvent({ type: 'agent-message', event: { kind: 'tool_use', name: 'Edit' } });
        onEvent({ type: 'stderr', content: 'aviso' });
        return { executionId: input.executionId, agentId, status: 'completed', output: 'ok' };
      },
    });
    const chunks = [];
    const executor = createAgentStepExecutor(deps);
    await executor.execute(
      input(deps, { emitOutput: (stream, content) => chunks.push({ stream, content }) }),
      new AbortController().signal,
    );
    expect(chunks).toEqual([
      { stream: 'agent', content: 'pensando…' },
      { stream: 'agent', content: '[tool: Edit]\n' },
      { stream: 'stderr', content: 'aviso' },
    ]);
  });

  it('repetição retoma a sessão anterior da MESMA etapa e injeta feedback', async () => {
    const deps = makeDeps();
    const executor = createAgentStepExecutor(deps);
    const run = {
      iteration: 1,
      stepRuns: [
        { id: '1', stepId: 'plan', type: 'agent', status: 'passed', sessionId: 'sess-plan' },
        {
          id: '2',
          stepId: 'implement',
          type: 'agent',
          status: 'passed',
          sessionId: 'sess-impl',
          finishedAt: 't',
          summary: 'implementado',
        },
        {
          id: '3',
          stepId: 'evaluate-result',
          type: 'validation',
          status: 'failed',
          finishedAt: 't',
          summary: 'falhou',
          validation: { passed: false, checks: [], failedCriteria: ['teste X falhou'] },
        },
      ],
    };
    const implStep = {
      id: 'implement',
      name: 'Implementar',
      type: 'agent',
      config: { agentId: 'claude-code', promptTemplate: 'feature-implementation' },
    };
    await executor.execute(input(deps, { run, stepDef: implStep }), new AbortController().signal);
    const [, execInput] = deps.agentService.execute.mock.calls[0];
    expect(execInput.sessionId).toBe('sess-impl'); // sessão da etapa implement, não da plan
    expect(execInput.prompt).toContain('teste X falhou');
  });
});
