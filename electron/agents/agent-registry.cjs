'use strict';

// Registro central de coding agents. Novos agentes entram por aqui, sem que o
// restante da aplicação precise conhecer implementações específicas.

const { CodingAgentNotFoundError, CodingAgentError } = require('./agent-errors.cjs');

class CodingAgentRegistry {
  constructor() {
    this._adapters = new Map();
  }

  register(adapter) {
    const id = adapter && adapter.descriptor && adapter.descriptor.id;
    if (!id || typeof id !== 'string')
      throw new CodingAgentError('Adapter sem descriptor.id válido.', 'invalid-adapter');
    if (this._adapters.has(id))
      throw new CodingAgentError(`Agente já registrado: ${id}`, 'duplicate-agent', { id });
    this._adapters.set(id, adapter);
  }

  has(agentId) {
    return this._adapters.has(agentId);
  }

  get(agentId) {
    const adapter = this._adapters.get(agentId);
    if (!adapter) throw new CodingAgentNotFoundError(agentId);
    return adapter;
  }

  list() {
    return Array.from(this._adapters.values());
  }
}

module.exports = { CodingAgentRegistry };
