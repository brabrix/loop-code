import { describe, it, expect, vi } from 'vitest';
import { CodingAgentRegistry } from './agent-registry.cjs';
import { CodingAgentService } from './agent-service.cjs';

// Asserções por name/code/mensagem (não instanceof): o vitest carrega o .cjs
// importado no teste num grafo separado do require() interno dos módulos.

function makeAdapter(id, overrides = {}) {
  return {
    descriptor: { id, name: id },
    checkAvailability: vi.fn(async () => ({ available: true, version: '1.0.0' })),
    execute: vi.fn(async (input) => ({
      executionId: input.executionId,
      agentId: id,
      status: 'completed',
      startedAt: 't0',
      finishedAt: 't1',
    })),
    cancel: vi.fn(async () => {}),
    disposeAll: vi.fn(async () => {}),
    ...overrides,
  };
}

const validInput = (executionId = 'e1') => ({
  executionId,
  workspacePath: '/ws',
  prompt: 'faz algo',
});

describe('CodingAgentService', () => {
  it('lista descritores com disponibilidade', async () => {
    const reg = new CodingAgentRegistry();
    reg.register(makeAdapter('a'));
    reg.register(
      makeAdapter('b', {
        checkAvailability: vi.fn(async () => ({ available: false, reason: 'não instalado' })),
      }),
    );
    const svc = new CodingAgentService(reg);
    const list = await svc.listAgents();
    expect(list).toHaveLength(2);
    expect(list[0].availability.available).toBe(true);
    expect(list[1].availability).toEqual({ available: false, reason: 'não instalado' });
  });

  it('exceção do checkAvailability vira { available: false, reason }', async () => {
    const reg = new CodingAgentRegistry();
    reg.register(
      makeAdapter('a', {
        checkAvailability: vi.fn(async () => {
          throw new Error('boom');
        }),
      }),
    );
    const svc = new CodingAgentService(reg);
    const [item] = await svc.listAgents();
    expect(item.availability.available).toBe(false);
    expect(item.availability.reason).toMatch(/boom/);
  });

  it('executa no agente correto e limpa o rastreamento ao terminar', async () => {
    const reg = new CodingAgentRegistry();
    const a = makeAdapter('a');
    const b = makeAdapter('b');
    reg.register(a);
    reg.register(b);
    const svc = new CodingAgentService(reg);
    const res = await svc.execute('b', validInput());
    expect(res.status).toBe('completed');
    expect(b.execute).toHaveBeenCalledOnce();
    expect(a.execute).not.toHaveBeenCalled();
    expect(svc.activeExecutions()).toEqual([]);
  });

  it('valida o input antes de executar', async () => {
    const reg = new CodingAgentRegistry();
    reg.register(makeAdapter('a'));
    const svc = new CodingAgentService(reg);
    await expect(svc.execute('a', { executionId: 'x' })).rejects.toMatchObject({
      name: 'CodingAgentExecutionError',
      message: expect.stringMatching(/obrigatório/),
    });
  });

  it('rejeita executionId duplicado enquanto a execução está ativa', async () => {
    const reg = new CodingAgentRegistry();
    let release;
    const gate = new Promise((r) => (release = r));
    reg.register(
      makeAdapter('a', {
        execute: vi.fn(async (input) => {
          await gate;
          return { executionId: input.executionId, agentId: 'a', status: 'completed' };
        }),
      }),
    );
    const svc = new CodingAgentService(reg);
    const p1 = svc.execute('a', validInput('dup'));
    await expect(svc.execute('a', validInput('dup'))).rejects.toThrow(/já em uso/);
    release();
    await p1;
    // terminou → o id pode ser reutilizado
    await expect(svc.execute('a', validInput('dup'))).resolves.toBeTruthy();
  });

  it('lança CodingAgentNotFoundError para agente desconhecido', async () => {
    const svc = new CodingAgentService(new CodingAgentRegistry());
    await expect(svc.execute('ghost', validInput())).rejects.toMatchObject({
      name: 'CodingAgentNotFoundError',
      code: 'agent-not-found',
    });
  });

  it('cancela apenas a execução do agente dono', async () => {
    const reg = new CodingAgentRegistry();
    let release;
    const gate = new Promise((r) => (release = r));
    const a = makeAdapter('a', {
      execute: vi.fn(async (input) => {
        await gate;
        return { executionId: input.executionId, agentId: 'a', status: 'cancelled' };
      }),
    });
    const b = makeAdapter('b');
    reg.register(a);
    reg.register(b);
    const svc = new CodingAgentService(reg);
    const running = svc.execute('a', validInput('e1'));

    await expect(svc.cancel('b', 'e1')).rejects.toMatchObject({
      name: 'CodingAgentCancellationError',
    });
    await expect(svc.cancel('b', 'e1')).rejects.toThrow(/outro agente/);
    expect(b.cancel).not.toHaveBeenCalled();

    await svc.cancel('a', 'e1');
    expect(a.cancel).toHaveBeenCalledWith('e1');
    release();
    await running;
  });

  it('cancelar execução inexistente lança erro legível', async () => {
    const reg = new CodingAgentRegistry();
    reg.register(makeAdapter('a'));
    const svc = new CodingAgentService(reg);
    await expect(svc.cancel('a', 'ghost')).rejects.toThrow(/não encontrada/);
  });

  it('disposeAll repassa aos adapters e limpa o rastreamento', async () => {
    const reg = new CodingAgentRegistry();
    const a = makeAdapter('a');
    reg.register(a);
    const svc = new CodingAgentService(reg);
    await svc.disposeAll();
    expect(a.disposeAll).toHaveBeenCalledOnce();
    expect(svc.activeExecutions()).toEqual([]);
  });

  it('o agente padrão é o Claude Code', () => {
    const svc = new CodingAgentService(new CodingAgentRegistry());
    expect(svc.defaultAgentId).toBe('claude-code');
  });
});
