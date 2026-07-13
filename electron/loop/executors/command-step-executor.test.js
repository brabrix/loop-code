import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCommandStepExecutor } from './command-step-executor.cjs';

// Usa processos `node -e` reais (seguro e determinístico) — nada de CLI de IA.

let ws;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'loopcode-cmd-'));
});

function exec(config, { signal, emitOutput } = {}) {
  const executor = createCommandStepExecutor();
  return executor.execute(
    {
      run: {},
      stepDef: { id: 'cmd', type: 'command', config },
      workspacePath: ws,
      emitOutput,
    },
    signal || new AbortController().signal,
  );
}

const nodeCmd = (code, extra = {}) => ({
  executable: process.execPath,
  arguments: ['-e', code],
  timeoutMs: 10000,
  ...extra,
});

describe('CommandStepExecutor', () => {
  it('exit 0 → passed/success com stdout capturado', async () => {
    const r = await exec(nodeCmd('console.log("ola loop"); process.exit(0)'));
    expect(r.stepStatus).toBe('passed');
    expect(r.condition).toBe('success');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('ola loop');
  });

  it('exit ≠ 0 → failed/failure com stderr capturado', async () => {
    const r = await exec(nodeCmd('console.error("quebrou feio"); process.exit(3)'));
    expect(r.stepStatus).toBe('failed');
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('quebrou feio');
    expect(r.summary).toMatch(/exit 3/);
  });

  it('successExitCodes customizado', async () => {
    const r = await exec(nodeCmd('process.exit(2)', { successExitCodes: [0, 2] }));
    expect(r.stepStatus).toBe('passed');
  });

  it('roda com cwd no workspace e argumentos separados', async () => {
    const r = await exec(nodeCmd('console.log(process.cwd())'));
    expect(fs.realpathSync(r.stdout.trim())).toBe(fs.realpathSync(ws));
  });

  it('timeout mata o processo e vira failed com mensagem clara', async () => {
    const r = await exec(nodeCmd('setTimeout(()=>{}, 60000)', { timeoutMs: 300 }));
    expect(r.stepStatus).toBe('failed');
    expect(r.error).toMatch(/timeout/);
  }, 10000);

  it('cancelamento via AbortSignal encerra e vira cancelled', async () => {
    const controller = new AbortController();
    const promise = exec(nodeCmd('setTimeout(()=>{}, 60000)'), { signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    const r = await promise;
    expect(r.stepStatus).toBe('cancelled');
    expect(r.condition).toBe('cancelled');
  }, 10000);

  it('signal já abortado nem spawna', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await exec(nodeCmd('console.log("nunca")'), { signal: controller.signal });
    expect(r.stepStatus).toBe('cancelled');
    expect(r.stdout).toBeUndefined();
  });

  it('executable inexistente → failed com mensagem legível, sem exceção', async () => {
    const r = await exec({
      executable: '/caminho/que/nao/existe-xyz',
      arguments: [],
      timeoutMs: 5000,
    });
    expect(r.stepStatus).toBe('failed');
    expect(r.error).toMatch(/Não foi possível executar/);
  });

  it('emite step-output em streaming', async () => {
    const chunks = [];
    await exec(nodeCmd('console.log("linha1"); console.error("erro1")'), {
      emitOutput: (stream, content) => chunks.push({ stream, content }),
    });
    expect(chunks.some((c) => c.stream === 'stdout' && c.content.includes('linha1'))).toBe(true);
    expect(chunks.some((c) => c.stream === 'stderr' && c.content.includes('erro1'))).toBe(true);
  });

  it('limita o tamanho dos logs (mantém o final)', async () => {
    const r = await exec(
      nodeCmd('for (let i=0;i<200000;i++) process.stdout.write("x"); process.stdout.write("FIM")'),
    );
    expect(r.stdout.length).toBeLessThan(40000);
    expect(r.stdout.endsWith('FIM')).toBe(true);
  });
});
