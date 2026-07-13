'use strict';

// Registro de executores de etapa por tipo. O LoopRunner obtém executores por
// aqui — nada de switch gigante com a lógica de todas as etapas no runner.

const { LoopStepExecutorNotFoundError, CodingLoopError } = require('./loop-errors.cjs');

class StepExecutorRegistry {
  constructor() {
    this._executors = new Map();
  }

  register(executor) {
    const type = executor && executor.type;
    if (!type || typeof type !== 'string')
      throw new CodingLoopError('Executor sem type válido.', 'invalid-step-executor');
    if (typeof executor.execute !== 'function')
      throw new CodingLoopError(
        `Executor "${type}" sem método execute().`,
        'invalid-step-executor',
      );
    if (this._executors.has(type))
      throw new CodingLoopError(
        `Já há executor registrado para o tipo: ${type}`,
        'duplicate-step-executor',
        { type },
      );
    this._executors.set(type, executor);
  }

  has(type) {
    return this._executors.has(type);
  }

  get(type) {
    const executor = this._executors.get(type);
    if (!executor) throw new LoopStepExecutorNotFoundError(type);
    return executor;
  }

  list() {
    return Array.from(this._executors.values());
  }
}

module.exports = { StepExecutorRegistry };
