'use strict';

// Serviço central de coding agents: lista disponibilidade, executa e cancela,
// rastreando as execuções ativas (evita id duplicado e cancela só a execução
// do agente certo). É a única porta de entrada usada pelos handlers IPC.

const { CodingAgentExecutionError, CodingAgentCancellationError } = require('./agent-errors.cjs');
const { validateExecutionInput } = require('./agent-types.cjs');

const DEFAULT_AGENT_ID = 'claude-code';

class CodingAgentService {
  constructor(registry) {
    this._registry = registry;
    this._active = new Map(); // executionId -> { agentId, workspacePath, startedAt }
  }

  get defaultAgentId() {
    return DEFAULT_AGENT_ID;
  }

  // [{ descriptor, availability }] — indisponibilidade nunca vira exceção aqui,
  // vira { available: false, reason } (a UI mostra "não instalado").
  async listAgents() {
    const adapters = this._registry.list();
    return Promise.all(
      adapters.map(async (adapter) => {
        let availability;
        try {
          availability = await adapter.checkAvailability();
        } catch (err) {
          availability = { available: false, reason: String((err && err.message) || err) };
        }
        return { descriptor: adapter.descriptor, availability };
      }),
    );
  }

  activeExecutions() {
    return Array.from(this._active.entries()).map(([executionId, info]) => ({
      executionId,
      ...info,
    }));
  }

  // Executa e SEMPRE resolve com AgentExecutionResult (status completed/failed/
  // cancelled). Só lança para erros de chamada: agente inexistente, input
  // inválido ou executionId duplicado.
  async execute(agentId, input, onEvent) {
    const adapter = this._registry.get(agentId); // lança CodingAgentNotFoundError
    const clean = validateExecutionInput(input);
    if (this._active.has(clean.executionId))
      throw new CodingAgentExecutionError(`executionId já em uso: ${clean.executionId}`, {
        code: 'duplicate-execution',
      });
    this._active.set(clean.executionId, {
      agentId,
      workspacePath: clean.workspacePath,
      startedAt: new Date().toISOString(),
    });
    try {
      return await adapter.execute(clean, onEvent);
    } finally {
      this._active.delete(clean.executionId);
    }
  }

  async cancel(agentId, executionId) {
    const info = this._active.get(executionId);
    if (!info) throw new CodingAgentCancellationError(`Execução não encontrada: ${executionId}`);
    if (info.agentId !== agentId)
      throw new CodingAgentCancellationError(
        `Execução ${executionId} pertence a outro agente (${info.agentId}).`,
      );
    await this._registry.get(agentId).cancel(executionId);
  }

  // Encerra tudo (usado no cleanup do app). Erros individuais são engolidos —
  // é caminho de shutdown.
  async disposeAll() {
    for (const adapter of this._registry.list()) {
      try {
        if (typeof adapter.disposeAll === 'function') await adapter.disposeAll();
      } catch {}
    }
    this._active.clear();
  }
}

module.exports = { CodingAgentService, DEFAULT_AGENT_ID };
