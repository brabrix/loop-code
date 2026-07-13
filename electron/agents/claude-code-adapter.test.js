import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createClaudeCodeAdapter } from './claude-code-adapter.cjs';

// Processo falso: stdout/stderr são streams reais; stdin captura o que foi
// escrito; emitir 'close'/'error' encerra como o child_process de verdade.
function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdinData = '';
  proc.stdin = {
    write: (s) => {
      proc.stdinData += s;
      return true;
    },
    end: vi.fn(),
  };
  proc.pid = 4242;
  return proc;
}

function makeAdapter(overrides = {}) {
  const proc = makeFakeProc();
  const spawn = vi.fn(() => proc);
  const kill = vi.fn();
  const adapter = createClaudeCodeAdapter({
    spawn,
    kill,
    platform: 'linux',
    env: () => ({ PATH: '/bin' }),
    ...overrides,
  });
  return { adapter, proc, spawn, kill };
}

const input = (extra = {}) => ({
  executionId: 'e1',
  workspacePath: '/ws/projeto',
  prompt: 'conserta o bug',
  ...extra,
});

const streamLine = (obj) => JSON.stringify(obj) + '\n';

describe('createClaudeCodeAdapter', () => {
  it('descriptor descreve o Claude Code com streaming/resume/cancel', () => {
    const { adapter } = makeAdapter();
    expect(adapter.descriptor.id).toBe('claude-code');
    expect(adapter.descriptor.executable).toBe('claude');
    expect(adapter.descriptor.supportsStreaming).toBe(true);
    expect(adapter.descriptor.supportsSessionResume).toBe(true);
    expect(adapter.descriptor.supportsCancellation).toBe(true);
  });

  it('spawna `claude` headless no workspace, sem shell fora do Windows e com env limpo', async () => {
    const { adapter, proc, spawn } = makeAdapter();
    const p = adapter.execute(input());
    const [bin, args, opts] = spawn.mock.calls[0];
    expect(bin).toBe('claude');
    expect(args).toEqual(
      expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format']),
    );
    expect(args).not.toContain('--resume');
    expect(opts.cwd).toBe('/ws/projeto');
    expect(opts.shell).toBe(false);
    expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    proc.emit('close', 0);
    await p;
  });

  it('usa shell:true no Windows (resolução do binário pelo PATH)', async () => {
    const { adapter, proc, spawn } = makeAdapter({ platform: 'win32' });
    const p = adapter.execute(input());
    expect(spawn.mock.calls[0][2].shell).toBe(true);
    proc.emit('close', 0);
    await p;
  });

  it('passa --resume/--model/--permission-mode quando informados', async () => {
    const { adapter, proc, spawn } = makeAdapter();
    const p = adapter.execute(
      input({ sessionId: 'sess-9', model: 'opus', permissionMode: 'acceptEdits' }),
    );
    const args = spawn.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining(['--resume', 'sess-9']));
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus']));
    expect(args).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits']));
    proc.emit('close', 0);
    await p;
  });

  it('escreve o prompt como stream-json no stdin e fecha o stdin (um turno por execução)', async () => {
    const { adapter, proc } = makeAdapter();
    const p = adapter.execute(input());
    const msg = JSON.parse(proc.stdinData);
    expect(msg.type).toBe('user');
    expect(msg.message.content).toEqual([{ type: 'text', text: 'conserta o bug' }]);
    expect(proc.stdin.end).toHaveBeenCalledOnce();
    proc.emit('close', 0);
    await p;
  });

  it('sucesso: junta eventos, captura sessionId, usage e o texto do result', async () => {
    const { adapter, proc } = makeAdapter();
    const events = [];
    const p = adapter.execute(input(), (ev) => events.push(ev));

    proc.stdout.write(streamLine({ type: 'system', subtype: 'init', session_id: 'nova-sessao' }));
    proc.stdout.write(
      streamLine({
        type: 'assistant',
        session_id: 'nova-sessao',
        message: { content: [{ type: 'text', text: 'feito.' }] },
      }),
    );
    proc.stdout.write(
      streamLine({
        type: 'result',
        subtype: 'success',
        session_id: 'nova-sessao',
        result: 'Bug corrigido.',
        total_cost_usd: 0.12,
        duration_ms: 3400,
        num_turns: 2,
      }),
    );
    proc.emit('close', 0);

    const res = await p;
    expect(res.status).toBe('completed');
    expect(res.agentId).toBe('claude-code');
    expect(res.sessionId).toBe('nova-sessao');
    expect(res.output).toBe('Bug corrigido.');
    expect(res.exitCode).toBe(0);
    expect(res.usage).toEqual({ costUsd: 0.12, durationMs: 3400, numTurns: 2 });
    expect(res.startedAt).toBeTruthy();
    expect(res.finishedAt).toBeTruthy();

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('execution-started');
    expect(types).toContain('session-created');
    expect(types).toContain('agent-message');
    expect(types.at(-1)).toBe('execution-completed');
    expect(events.every((e) => e.executionId === 'e1' && e.timestamp)).toBe(true);
  });

  it('stderr vira evento e entra (limitado) no errorOutput', async () => {
    const { adapter, proc } = makeAdapter();
    const events = [];
    const p = adapter.execute(input(), (ev) => events.push(ev));
    proc.stderr.write('aviso qualquer\n');
    proc.emit('close', 0);
    const res = await p;
    expect(res.errorOutput).toContain('aviso qualquer');
    expect(events.some((e) => e.type === 'stderr' && e.content.includes('aviso'))).toBe(true);
  });

  it('exit code ≠ 0 vira status failed com mensagem legível', async () => {
    const { adapter, proc } = makeAdapter();
    const events = [];
    const p = adapter.execute(input(), (ev) => events.push(ev));
    proc.emit('close', 3);
    const res = await p;
    expect(res.status).toBe('failed');
    expect(res.error.message).toMatch(/código 3/);
    expect(events.at(-1).type).toBe('execution-failed');
  });

  it('result com subtype de erro vira failed mesmo com exit 0', async () => {
    const { adapter, proc } = makeAdapter();
    const p = adapter.execute(input());
    proc.stdout.write(
      streamLine({ type: 'result', subtype: 'error_max_turns', result: 'estourou turnos' }),
    );
    proc.emit('close', 0);
    const res = await p;
    expect(res.status).toBe('failed');
  });

  it('erro de spawn (CLI ausente) resolve como failed, sem exceção', async () => {
    const { adapter, proc } = makeAdapter();
    const events = [];
    const p = adapter.execute(input(), (ev) => events.push(ev));
    proc.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
    const res = await p;
    expect(res.status).toBe('failed');
    expect(res.error.code).toBe('spawn-error');
    expect(events.at(-1).type).toBe('execution-failed');
  });

  it('cancel mata o processo e o desfecho é cancelled', async () => {
    const { adapter, proc, kill } = makeAdapter();
    const events = [];
    const p = adapter.execute(input(), (ev) => events.push(ev));
    await adapter.cancel('e1');
    expect(kill).toHaveBeenCalledWith(proc);
    proc.emit('close', null); // processo morto não tem exit code
    const res = await p;
    expect(res.status).toBe('cancelled');
    expect(events.at(-1).type).toBe('execution-cancelled');
  });

  it('cancelar execução desconhecida lança erro', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.cancel('ghost')).rejects.toThrow(/não encontrada/);
  });

  it('checkAvailability: disponível com versão', async () => {
    const { adapter } = makeAdapter({
      probeVersion: () => ({ ok: true, version: '2.1.0 (Claude Code)' }),
    });
    expect(await adapter.checkAvailability()).toEqual({
      available: true,
      version: '2.1.0 (Claude Code)',
    });
  });

  it('checkAvailability: indisponível com motivo', async () => {
    const { adapter } = makeAdapter({
      probeVersion: () => ({ ok: false, reason: 'não achou o binário' }),
    });
    const a = await adapter.checkAvailability();
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/binário/);
  });

  it('disposeAll mata execuções ativas', async () => {
    const { adapter, proc, kill } = makeAdapter();
    const p = adapter.execute(input());
    await adapter.disposeAll();
    expect(kill).toHaveBeenCalledWith(proc);
    proc.emit('close', null);
    const res = await p;
    expect(res.status).toBe('cancelled');
  });

  it('valida input mal formado antes de spawnar', async () => {
    const { adapter, spawn } = makeAdapter();
    // execute() do adapter espera input já validado pelo service; ainda assim,
    // o service é quem valida — aqui garantimos que o fluxo completo rejeita.
    const { CodingAgentRegistry } = await import('./agent-registry.cjs');
    const { CodingAgentService } = await import('./agent-service.cjs');
    const reg = new CodingAgentRegistry();
    reg.register(adapter);
    const svc = new CodingAgentService(reg);
    await expect(svc.execute('claude-code', { executionId: '', prompt: 'x' })).rejects.toThrow(
      /obrigatório/,
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});
