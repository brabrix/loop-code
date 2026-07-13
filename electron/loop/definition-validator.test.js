import { describe, it, expect } from 'vitest';
import { validateDefinition, assertValidDefinition } from './definition-validator.cjs';
import { buildFeatureDevelopmentDefinition, buildBugFixDefinition } from './templates.cjs';

const validDef = () => buildFeatureDevelopmentDefinition();

describe('validateDefinition', () => {
  it('aceita os templates embutidos', () => {
    expect(validateDefinition(buildFeatureDevelopmentDefinition()).ok).toBe(true);
    expect(validateDefinition(buildBugFixDefinition()).ok).toBe(true);
  });

  it('exige id, name e version', () => {
    const def = { ...validDef(), id: '', name: '', version: 0 };
    const { ok, errors } = validateDefinition(def);
    expect(ok).toBe(false);
    expect(errors.join(' ')).toMatch(/id/);
    expect(errors.join(' ')).toMatch(/name/);
    expect(errors.join(' ')).toMatch(/version/);
  });

  it('rejeita ID de etapa duplicado', () => {
    const def = validDef();
    def.steps.push({ ...def.steps[0] });
    const { errors } = validateDefinition(def);
    expect(errors.join(' ')).toMatch(/duplicado.*"plan"/);
  });

  it('rejeita initialStepId inexistente', () => {
    const def = { ...validDef(), initialStepId: 'nope' };
    const { errors } = validateDefinition(def);
    expect(errors.join(' ')).toMatch(/initialStepId.*"nope"/);
  });

  it('rejeita transição para etapa inexistente com mensagem clara', () => {
    const def = validDef();
    def.steps[0].transitions[0].nextStepId = 'retry-code';
    const { errors } = validateDefinition(def);
    expect(errors.join(' ')).toMatch(/"plan".*inexistente.*"retry-code"/);
  });

  it('rejeita transição sem destino e com destino duplo', () => {
    const def = validDef();
    def.steps[0].transitions.push({ condition: 'cancelled' });
    const { errors } = validateDefinition(def);
    expect(errors.join(' ')).toMatch(/sem destino/);

    const def2 = validDef();
    def2.steps[0].transitions[0] = {
      condition: 'success',
      nextStepId: 'implement',
      terminalStatus: 'failed',
    };
    expect(validateDefinition(def2).errors.join(' ')).toMatch(/escolha um/);
  });

  it('rejeita configuração incompatível com o tipo', () => {
    const def = validDef();
    def.steps[0].config = {}; // agent sem agentId/promptTemplate
    const { errors } = validateDefinition(def);
    expect(errors.join(' ')).toMatch(/agentId/);
    expect(errors.join(' ')).toMatch(/promptTemplate/);
  });

  it('rejeita command com executable contendo metacaracteres de shell', () => {
    const def = validDef();
    const cmd = def.steps.find((s) => s.type === 'command');
    cmd.config = { ...cmd.config, executable: 'npm test && rm -rf /' };
    const { errors } = validateDefinition(def);
    expect(errors.join(' ')).toMatch(/metacaracteres/);
  });

  it('rejeita definição sem estado terminal alcançável', () => {
    const def = validDef();
    for (const s of def.steps) {
      s.transitions = (s.transitions || []).map((t) =>
        t.terminalStatus ? { condition: t.condition, nextStepId: def.steps[0].id } : t,
      );
    }
    const { errors } = validateDefinition(def);
    expect(errors.join(' ')).toMatch(/terminal/);
  });

  it('rejeita limites ausentes ou inválidos', () => {
    const noLimits = { ...validDef(), limits: undefined };
    expect(validateDefinition(noLimits).errors.join(' ')).toMatch(/limits/);

    const bad = validDef();
    bad.limits = { maxIterations: 0, maxDurationMs: -5 };
    const { errors } = validateDefinition(bad);
    expect(errors.join(' ')).toMatch(/maxIterations/);
    expect(errors.join(' ')).toMatch(/maxDurationMs/);
  });

  it('rejeita transição com condição que a etapa nunca produz', () => {
    const def = validDef();
    def.steps[0].transitions.push({ condition: 'validation_passed', terminalStatus: 'completed' });
    const { errors } = validateDefinition(def);
    expect(errors.join(' ')).toMatch(/nunca produz/);
  });

  it('assertValidDefinition lança com todas as mensagens', () => {
    try {
      assertValidDefinition({ id: '', name: '', version: 1, steps: [], initialStepId: 'x' });
      expect.unreachable();
    } catch (err) {
      expect(err.name).toBe('CodingLoopDefinitionError');
      expect(err.messages.length).toBeGreaterThan(2);
    }
  });
});
