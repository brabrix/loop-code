import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLoopRunRepository } from './loop-run-repository.cjs';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopcode-runs-'));
});

const run = (id, extra = {}) => ({
  id,
  status: 'running',
  updatedAt: new Date().toISOString(),
  stepRuns: [],
  ...extra,
});

describe('createLoopRunRepository', () => {
  it('salva e carrega uma execução', async () => {
    const repo = createLoopRunRepository({ dir });
    await repo.save(run('aaaabbbb-1111'));
    const loaded = await repo.findById('aaaabbbb-1111');
    expect(loaded.id).toBe('aaaabbbb-1111');
    expect(loaded.status).toBe('running');
  });

  it('devolve null para execução inexistente', async () => {
    const repo = createLoopRunRepository({ dir });
    expect(await repo.findById('aaaabbbb-2222')).toBeNull();
  });

  it('lista ordenando pela atualização mais recente', async () => {
    const repo = createLoopRunRepository({ dir });
    await repo.save(run('aaaabbbb-1111', { updatedAt: '2026-07-12T10:00:00Z' }));
    await repo.save(run('aaaabbbb-2222', { updatedAt: '2026-07-12T12:00:00Z' }));
    const all = await repo.list();
    expect(all.map((r) => r.id)).toEqual(['aaaabbbb-2222', 'aaaabbbb-1111']);
  });

  it('lista vazia quando o diretório ainda não existe', async () => {
    const repo = createLoopRunRepository({ dir: path.join(dir, 'nao-existe') });
    expect(await repo.list()).toEqual([]);
  });

  it('recupera checkpoint aguardando aprovação após "reinício"', async () => {
    const repo = createLoopRunRepository({ dir });
    await repo.save(
      run('aaaabbbb-3333', {
        status: 'waiting_for_approval',
        currentStepId: 'approve-plan',
        stepRuns: [
          {
            id: 's1',
            stepId: 'approve-plan',
            type: 'human_checkpoint',
            status: 'waiting_for_approval',
            checkpoint: { title: 'Aprovar plano', allowReject: true },
          },
        ],
      }),
    );
    // novo repositório = novo processo (reinício do app)
    const fresh = createLoopRunRepository({ dir });
    const loaded = await fresh.findById('aaaabbbb-3333');
    expect(loaded.status).toBe('waiting_for_approval');
    expect(loaded.stepRuns[0].checkpoint.title).toBe('Aprovar plano');
  });

  it('rejeita runId com path traversal', async () => {
    const repo = createLoopRunRepository({ dir });
    await expect(repo.findById('../../etc/passwd')).rejects.toMatchObject({
      name: 'LoopPersistenceError',
    });
    await expect(repo.save(run('../evil'))).rejects.toMatchObject({
      name: 'LoopPersistenceError',
    });
  });

  it('delete remove o arquivo e ignora inexistente', async () => {
    const repo = createLoopRunRepository({ dir });
    await repo.save(run('aaaabbbb-4444'));
    await repo.delete('aaaabbbb-4444');
    expect(await repo.findById('aaaabbbb-4444')).toBeNull();
    await repo.delete('aaaabbbb-4444'); // não lança
  });

  it('arquivo corrompido não derruba a listagem', async () => {
    const repo = createLoopRunRepository({ dir });
    await repo.save(run('aaaabbbb-5555'));
    fs.writeFileSync(path.join(dir, 'corrompido-9999.json'), '{nope');
    const all = await repo.list();
    expect(all.map((r) => r.id)).toEqual(['aaaabbbb-5555']);
  });
});
