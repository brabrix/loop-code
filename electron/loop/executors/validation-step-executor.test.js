import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createValidationStepExecutor } from './validation-step-executor.cjs';

let ws;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'loopcode-val-'));
});

const signal = () => new AbortController().signal;

async function run(checks, runExtra = {}) {
  const executor = createValidationStepExecutor();
  return executor.execute(
    {
      run: { startedAt: new Date(Date.now() - 5000).toISOString(), stepRuns: [], ...runExtra },
      stepDef: { id: 'validate', type: 'validation', config: { checks } },
      workspacePath: ws,
    },
    signal(),
  );
}

describe('ValidationStepExecutor', () => {
  it('file_exists: passa com arquivo presente e falha sem ele', async () => {
    fs.writeFileSync(path.join(ws, 'a.txt'), 'x');
    expect((await run([{ type: 'file_exists', path: 'a.txt' }])).condition).toBe(
      'validation_passed',
    );
    const r = await run([{ type: 'file_exists', path: 'b.txt' }]);
    expect(r.condition).toBe('validation_failed');
    expect(r.validation.failedCriteria.join(' ')).toMatch(/b\.txt/);
  });

  it('file_contains: texto presente e ausente', async () => {
    fs.writeFileSync(path.join(ws, 'package.json'), '{"name":"loop-code"}');
    expect(
      (await run([{ type: 'file_contains', path: 'package.json', text: 'loop-code' }])).condition,
    ).toBe('validation_passed');
    expect(
      (await run([{ type: 'file_contains', path: 'package.json', text: 'carcara' }])).condition,
    ).toBe('validation_failed');
  });

  it('previous_step_success: positivo e negativo', async () => {
    const stepRuns = [
      {
        id: '1',
        stepId: 'run-tests',
        type: 'command',
        status: 'failed',
        exitCode: 1,
        finishedAt: 't',
      },
      {
        id: '2',
        stepId: 'run-tests',
        type: 'command',
        status: 'passed',
        exitCode: 0,
        finishedAt: 't',
      },
    ];
    const ok = await run([{ type: 'previous_step_success', stepId: 'run-tests' }], { stepRuns });
    expect(ok.condition).toBe('validation_passed'); // considera a ÚLTIMA execução da etapa

    const bad = await run([{ type: 'previous_step_success', stepId: 'nunca-rodou' }], { stepRuns });
    expect(bad.condition).toBe('validation_failed');
    expect(bad.validation.failedCriteria.join(' ')).toMatch(/ainda não rodou/);
  });

  it('command_result: compara exit code da etapa', async () => {
    const stepRuns = [
      { id: '1', stepId: 'lint', type: 'command', status: 'failed', exitCode: 2, finishedAt: 't' },
    ];
    const bad = await run([{ type: 'command_result', stepId: 'lint' }], { stepRuns });
    expect(bad.condition).toBe('validation_failed');
    const ok = await run([{ type: 'command_result', stepId: 'lint', exitCodes: [2] }], {
      stepRuns,
    });
    expect(ok.condition).toBe('validation_passed');
  });

  it('files_changed e boolean', async () => {
    fs.writeFileSync(path.join(ws, 'novo.js'), 'x'); // mtime agora > startedAt (-5s)
    const ok = await run([
      { type: 'files_changed', path: 'novo.js' },
      { type: 'boolean', value: true },
    ]);
    expect(ok.condition).toBe('validation_passed');
    expect((await run([{ type: 'boolean', value: false }])).condition).toBe('validation_failed');
  });

  it('múltiplos checks: um falho derruba o conjunto e lista só os falhos', async () => {
    fs.writeFileSync(path.join(ws, 'a.txt'), 'x');
    const r = await run([
      { type: 'file_exists', path: 'a.txt' },
      { type: 'file_exists', path: 'b.txt' },
    ]);
    expect(r.condition).toBe('validation_failed');
    expect(r.validation.checks).toHaveLength(2);
    expect(r.validation.failedCriteria).toHaveLength(1);
    expect(r.validation.suggestedNextAction).toBe('repeat_previous_agent_step');
  });

  it('recusa path fora do workspace (traversal e absoluto)', async () => {
    const r = await run([{ type: 'file_exists', path: '../../etc/passwd' }]);
    expect(r.condition).toBe('validation_failed');
    expect(r.validation.failedCriteria.join(' ')).toMatch(/fora do workspace/);
  });
});
