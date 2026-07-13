import { describe, it, expect } from 'vitest';
import { evaluateLimits } from './limit-evaluator.cjs';

const baseRun = () => ({
  iteration: 0,
  agentExecutions: 0,
  commandExecutions: 0,
  startedAt: new Date(Date.now() - 1000).toISOString(),
});

describe('evaluateLimits', () => {
  it('sem limites estourados devolve null', () => {
    expect(evaluateLimits(baseRun(), { maxIterations: 5 })).toBeNull();
  });

  it('detecta maxIterations', () => {
    const run = { ...baseRun(), iteration: 5 };
    expect(evaluateLimits(run, { maxIterations: 5 })).toEqual({
      limit: 'maxIterations',
      current: 5,
      max: 5,
    });
  });

  it('detecta maxDurationMs', () => {
    const run = { ...baseRun(), startedAt: new Date(Date.now() - 60000).toISOString() };
    const hit = evaluateLimits(run, { maxIterations: 5, maxDurationMs: 1000 });
    expect(hit.limit).toBe('maxDurationMs');
    expect(hit.current).toBeGreaterThanOrEqual(1000);
  });

  it('detecta maxAgentExecutions só quando a próxima etapa é agent', () => {
    const run = { ...baseRun(), agentExecutions: 3 };
    const limits = { maxIterations: 5, maxAgentExecutions: 3 };
    expect(evaluateLimits(run, limits, { nextStepType: 'agent' })).toMatchObject({
      limit: 'maxAgentExecutions',
    });
    expect(evaluateLimits(run, limits, { nextStepType: 'command' })).toBeNull();
  });

  it('detecta maxCommandExecutions só quando a próxima etapa é command', () => {
    const run = { ...baseRun(), commandExecutions: 2 };
    const limits = { maxIterations: 5, maxCommandExecutions: 2 };
    expect(evaluateLimits(run, limits, { nextStepType: 'command' })).toMatchObject({
      limit: 'maxCommandExecutions',
    });
    expect(evaluateLimits(run, limits, { nextStepType: 'validation' })).toBeNull();
  });
});
