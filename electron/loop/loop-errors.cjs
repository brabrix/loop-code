'use strict';

// Erros de domínio do motor de Coding Loops. Mensagens curtas e legíveis pra
// UI; detalhe técnico vai em `details` e fica nos logs de desenvolvimento.

class CodingLoopError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = new.target.name;
    this.code = code || 'loop-error';
    if (details !== undefined) this.details = details;
  }
}

class CodingLoopDefinitionError extends CodingLoopError {
  constructor(messages, details) {
    const list = Array.isArray(messages) ? messages : [messages];
    super(`Definição de loop inválida: ${list.join(' | ')}`, 'loop-definition-invalid', details);
    this.messages = list;
  }
}

class CodingLoopNotFoundError extends CodingLoopError {
  constructor(runId) {
    super(`Execução de loop não encontrada: ${runId}`, 'loop-not-found', { runId });
  }
}

class CodingLoopInvalidStateError extends CodingLoopError {
  constructor(message, details) {
    super(message, 'loop-invalid-state', details);
  }
}

class CodingLoopLimitReachedError extends CodingLoopError {
  constructor(limit, details) {
    super(`Limite do loop atingido: ${limit}`, 'loop-limit-reached', details);
  }
}

class LoopStepExecutorNotFoundError extends CodingLoopError {
  constructor(type) {
    super(`Não há executor registrado para etapas do tipo "${type}".`, 'step-executor-not-found', {
      type,
    });
  }
}

class LoopStepExecutionError extends CodingLoopError {
  constructor(message, details) {
    super(message, 'step-execution-error', details);
  }
}

class LoopCheckpointError extends CodingLoopError {
  constructor(message, details) {
    super(message, 'loop-checkpoint-error', details);
  }
}

class LoopPersistenceError extends CodingLoopError {
  constructor(message, details) {
    super(message, 'loop-persistence-error', details);
  }
}

module.exports = {
  CodingLoopError,
  CodingLoopDefinitionError,
  CodingLoopNotFoundError,
  CodingLoopInvalidStateError,
  CodingLoopLimitReachedError,
  LoopStepExecutorNotFoundError,
  LoopStepExecutionError,
  LoopCheckpointError,
  LoopPersistenceError,
};
