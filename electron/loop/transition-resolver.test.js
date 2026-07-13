import { describe, it, expect } from 'vitest';
import { resolveTransition } from './transition-resolver.cjs';

const step = {
  id: 'validate',
  transitions: [
    { condition: 'validation_passed', terminalStatus: 'completed' },
    { condition: 'validation_failed', nextStepId: 'implement' },
  ],
};

describe('resolveTransition', () => {
  it('resolve para estado terminal', () => {
    expect(resolveTransition(step, 'validation_passed')).toEqual({
      condition: 'validation_passed',
      terminalStatus: 'completed',
    });
  });

  it('resolve para próxima etapa', () => {
    expect(resolveTransition(step, 'validation_failed')).toEqual({
      condition: 'validation_failed',
      nextStepId: 'implement',
    });
  });

  it('falha controlada quando não há transição para a condição', () => {
    try {
      resolveTransition(step, 'success');
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe('no-transition');
      expect(err.message).toMatch(/"validate".*"success"/);
    }
  });

  it('rejeita terminalStatus que não é terminal', () => {
    const bad = { id: 'x', transitions: [{ condition: 'success', terminalStatus: 'running' }] };
    expect(() => resolveTransition(bad, 'success')).toThrow(/não-terminal/);
  });
});
