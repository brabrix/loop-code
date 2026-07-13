import { describe, it, expect } from 'vitest';
import { CodingAgentRegistry } from './agent-registry.cjs';

// Nota: as asserções checam name/code (e não instanceof) porque o vitest carrega
// o .cjs importado no teste num grafo separado do require() interno dos módulos.

const fakeAdapter = (id) => ({ descriptor: { id, name: id } });

describe('CodingAgentRegistry', () => {
  it('registra e recupera um agente por id', () => {
    const reg = new CodingAgentRegistry();
    const a = fakeAdapter('claude-code');
    reg.register(a);
    expect(reg.get('claude-code')).toBe(a);
    expect(reg.has('claude-code')).toBe(true);
  });

  it('lista os agentes registrados na ordem de registro', () => {
    const reg = new CodingAgentRegistry();
    reg.register(fakeAdapter('a'));
    reg.register(fakeAdapter('b'));
    expect(reg.list().map((x) => x.descriptor.id)).toEqual(['a', 'b']);
  });

  it('rejeita id duplicado', () => {
    const reg = new CodingAgentRegistry();
    reg.register(fakeAdapter('a'));
    expect(() => reg.register(fakeAdapter('a'))).toThrow(/já registrado/);
    try {
      reg.register(fakeAdapter('a'));
    } catch (err) {
      expect(err.code).toBe('duplicate-agent');
    }
  });

  it('rejeita adapter sem descriptor.id', () => {
    const reg = new CodingAgentRegistry();
    expect(() => reg.register({})).toThrow(/descriptor\.id/);
    expect(() => reg.register({ descriptor: {} })).toThrow(/descriptor\.id/);
  });

  it('lança CodingAgentNotFoundError para agente inexistente', () => {
    const reg = new CodingAgentRegistry();
    expect(() => reg.get('nope')).toThrow(/não encontrado/);
    try {
      reg.get('nope');
    } catch (err) {
      expect(err.name).toBe('CodingAgentNotFoundError');
      expect(err.code).toBe('agent-not-found');
    }
    expect(reg.has('nope')).toBe(false);
  });
});
