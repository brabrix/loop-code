'use strict';

// Monta o runtime de coding agents usado pelo main.js: registry + service com
// os adapters reais registrados. Deps são injetáveis pros testes.
//
// Hoje só o Claude Code está registrado (primeira implementação do contrato).
// Novos agentes (Codex, Gemini CLI, OpenCode, custom) entram criando um adapter
// e registrando aqui — nada mais no app precisa mudar. NÃO registre um agente
// sem implementação real: a UI trataria como funcional.

const { CodingAgentRegistry } = require('./agent-registry.cjs');
const { CodingAgentService } = require('./agent-service.cjs');
const { createClaudeCodeAdapter } = require('./claude-code-adapter.cjs');

function createAgentRuntime(deps = {}) {
  const registry = new CodingAgentRegistry();
  registry.register(createClaudeCodeAdapter(deps.claude || {}));
  const service = new CodingAgentService(registry);
  return { registry, service };
}

module.exports = { createAgentRuntime };
