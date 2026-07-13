import { describe, it, expect } from 'vitest';
import { StepExecutorRegistry } from './step-executor-registry.cjs';

const fakeExecutor = (type) => ({ type, execute: async () => ({}) });

describe('StepExecutorRegistry', () => {
  it('registra e recupera executor por tipo', () => {
    const reg = new StepExecutorRegistry();
    const e = fakeExecutor('command');
    reg.register(e);
    expect(reg.get('command')).toBe(e);
    expect(reg.has('command')).toBe(true);
  });

  it('lista executores registrados', () => {
    const reg = new StepExecutorRegistry();
    reg.register(fakeExecutor('agent'));
    reg.register(fakeExecutor('command'));
    expect(reg.list().map((e) => e.type)).toEqual(['agent', 'command']);
  });

  it('rejeita tipo duplicado', () => {
    const reg = new StepExecutorRegistry();
    reg.register(fakeExecutor('agent'));
    expect(() => reg.register(fakeExecutor('agent'))).toThrow(/Já há executor/);
  });

  it('rejeita executor sem type ou sem execute', () => {
    const reg = new StepExecutorRegistry();
    expect(() => reg.register({})).toThrow(/type/);
    expect(() => reg.register({ type: 'x' })).toThrow(/execute/);
  });

  it('erro controlado para tipo inexistente', () => {
    const reg = new StepExecutorRegistry();
    try {
      reg.get('webhook');
      expect.unreachable();
    } catch (err) {
      expect(err.name).toBe('LoopStepExecutorNotFoundError');
      expect(err.message).toMatch(/webhook/);
    }
  });
});
