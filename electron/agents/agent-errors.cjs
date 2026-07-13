'use strict';

// Erros de domínio da camada de coding agents. Mensagens pensadas pra UI
// (curtas, sem stack); detalhes técnicos vão em `details` e ficam nos logs.

class CodingAgentError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = new.target.name;
    this.code = code || 'agent-error';
    if (details !== undefined) this.details = details;
  }
}

class CodingAgentNotFoundError extends CodingAgentError {
  constructor(agentId) {
    super(`Agente de código não encontrado: ${agentId}`, 'agent-not-found', { agentId });
  }
}

class CodingAgentUnavailableError extends CodingAgentError {
  constructor(agentName, reason) {
    super(`${agentName} não foi encontrado no sistema.`, 'agent-unavailable', { reason });
  }
}

class CodingAgentExecutionError extends CodingAgentError {
  constructor(message, details) {
    super(message, 'agent-execution-error', details);
  }
}

class CodingAgentCancellationError extends CodingAgentError {
  constructor(message, details) {
    super(message, 'agent-cancellation-error', details);
  }
}

module.exports = {
  CodingAgentError,
  CodingAgentNotFoundError,
  CodingAgentUnavailableError,
  CodingAgentExecutionError,
  CodingAgentCancellationError,
};
