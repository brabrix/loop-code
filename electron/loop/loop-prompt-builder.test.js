import { describe, it, expect } from 'vitest';
import { buildAgentPrompt, lastFailureFeedback } from './loop-prompt-builder.cjs';

const stepDef = (template) => ({
  id: 'implement',
  name: 'Implementar a feature',
  config: { agentId: 'claude-code', promptTemplate: template },
});

const baseRun = (stepRuns = []) => ({
  iteration: 0,
  stepRuns,
});

const limits = { maxIterations: 5 };

describe('buildAgentPrompt', () => {
  it('inclui objetivo, workspace, etapa e regras de segurança', () => {
    const prompt = buildAgentPrompt({
      objective: 'Adicionar tela de login',
      workspacePath: '/ws/app',
      stepDef: stepDef('feature-implementation'),
      run: baseRun(),
      limits,
    });
    expect(prompt).toContain('Adicionar tela de login');
    expect(prompt).toContain('/ws/app');
    expect(prompt).toContain('Implementar a feature');
    expect(prompt).toMatch(/não faça push/i);
    expect(prompt).toMatch(/Iteração 1 de no máximo 5/);
  });

  it('template desconhecido vira instrução literal da etapa', () => {
    const prompt = buildAgentPrompt({
      objective: 'x',
      workspacePath: '/ws',
      stepDef: stepDef('faça um relatório de arquitetura'),
      run: baseRun(),
      limits,
    });
    expect(prompt).toContain('faça um relatório de arquitetura');
  });

  it('inclui o feedback da última validação quando o loop está repetindo', () => {
    const run = baseRun([
      {
        id: 'c1',
        stepId: 'run-validation',
        type: 'command',
        status: 'failed',
        exitCode: 1,
        stderr: 'FAIL auth.test.js — teste de autenticação falhou',
        finishedAt: 't',
        summary: 'Comando falhou (exit 1).',
      },
      {
        id: 'v1',
        stepId: 'evaluate-result',
        type: 'validation',
        status: 'failed',
        finishedAt: 't',
        summary: 'Validação falhou',
        validation: {
          passed: false,
          checks: [],
          failedCriteria: ['teste de autenticação falhou', 'arquivo esperado não foi criado'],
        },
      },
    ]);
    const prompt = buildAgentPrompt({
      objective: 'x',
      workspacePath: '/ws',
      stepDef: stepDef('feature-implementation'),
      run,
      limits,
    });
    expect(prompt).toContain('A validação anterior falhou');
    expect(prompt).toContain('teste de autenticação falhou');
    expect(prompt).toContain('arquivo esperado não foi criado');
    expect(prompt).toMatch(/preserve as alterações válidas/);
    expect(prompt).toContain('FAIL auth.test.js');
  });

  it('não inclui bloco de falha quando não houve validação falha', () => {
    const prompt = buildAgentPrompt({
      objective: 'x',
      workspacePath: '/ws',
      stepDef: stepDef('feature-plan'),
      run: baseRun(),
      limits,
    });
    expect(prompt).not.toContain('A validação anterior falhou');
  });
});

describe('lastFailureFeedback', () => {
  it('devolve null sem falhas e mensagens quando comando falhou', () => {
    expect(lastFailureFeedback(baseRun())).toBeNull();
    const run = baseRun([
      {
        id: 'c1',
        stepId: 'run-tests',
        type: 'command',
        status: 'failed',
        exitCode: 2,
        stdout: 'x',
        finishedAt: 't',
      },
    ]);
    const fb = lastFailureFeedback(run);
    expect(fb.join(' ')).toMatch(/run-tests.*exit 2/);
  });
});
