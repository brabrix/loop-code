'use strict';

// LoopRunner: o motor de estados dos Coding Loops. ELE decide quando avançar,
// repetir, aguardar aprovação, cancelar, falhar, atingir limite ou concluir —
// nunca o agente. Não conhece Claude Code, npm, React nem Brabrix: etapas são
// executadas por executores registrados no StepExecutorRegistry e o estado é
// persistido pelo LoopRunRepository antes e depois de cada etapa.
//
// Fluxo por etapa:
//   carregar run → avaliar limites → criar stepRun → persistir → executar
//   → aplicar resultado → persistir → resolver transição → próxima etapa
//   ou estado terminal (imutável) ou pausa em checkpoint.

const crypto = require('crypto');
const { assertValidDefinition } = require('./definition-validator.cjs');
const { resolveTransition } = require('./transition-resolver.cjs');
const { evaluateLimits } = require('./limit-evaluator.cjs');
const { isTerminalStatus, truncateSummary, makeLoopEvent } = require('./loop-types.cjs');
const {
  CodingLoopNotFoundError,
  CodingLoopInvalidStateError,
  LoopCheckpointError,
  LoopPersistenceError,
} = require('./loop-errors.cjs');

function createLoopRunner({ executorRegistry, repository, emit, idGen, now }) {
  const newId = idGen || (() => crypto.randomUUID());
  const clock = now || (() => new Date());
  const emitEvent = (type, runId, extra) => {
    try {
      if (emit) emit(makeLoopEvent(type, runId, extra, clock()));
    } catch {}
  };

  const runs = new Map(); // runId -> run (objeto autoritativo em memória)
  const driving = new Set(); // runIds com drive ativo (impede drive duplo)
  const drives = new Map(); // runId -> Promise do drive corrente (p/ testes e shutdown)
  const controllers = new Map(); // runId -> AbortController da etapa em execução
  const cancelRequested = new Set();

  async function load(runId) {
    if (runs.has(runId)) return runs.get(runId);
    const run = await repository.findById(runId);
    if (!run) throw new CodingLoopNotFoundError(runId);
    runs.set(runId, run);
    return run;
  }

  async function persist(run) {
    run.updatedAt = clock().toISOString();
    await repository.save(run);
  }

  function snapshot(run) {
    return structuredClone(run);
  }

  function stepDefOf(run, stepId) {
    return (run.definition.steps || []).find((s) => s.id === stepId) || null;
  }

  // Transição "para trás" na ordem de autoria das etapas = repetição de ciclo.
  // Uma volta completa (validate → implement → test → validate) conta UMA
  // iteração, não uma por etapa revisitada.
  function isBackEdge(run, fromStepId, toStepId) {
    const steps = run.definition.steps || [];
    const from = steps.findIndex((s) => s.id === fromStepId);
    const to = steps.findIndex((s) => s.id === toStepId);
    return to >= 0 && to <= from;
  }

  async function finalize(run, status, extra = {}) {
    run.status = status;
    run.finishedAt = clock().toISOString();
    if (extra.error) run.error = { message: truncateSummary(extra.error, 1000) };
    if (extra.limit) run.limitReached = extra.limit;
    delete run.interrupted;
    try {
      await persist(run);
    } catch {
      // shutdown/erro de disco: o evento ainda sai; recovery cuida no boot
    }
    if (status === 'completed') emitEvent('loop-completed', run.id);
    else if (status === 'failed') emitEvent('loop-failed', run.id, { error: run.error?.message });
    else if (status === 'cancelled') emitEvent('loop-cancelled', run.id);
    else if (status === 'blocked') emitEvent('loop-blocked', run.id);
    else if (status === 'limit_reached')
      emitEvent('loop-limit-reached', run.id, { limit: extra.limit && extra.limit.limit });
  }

  // ---------------------------------------------------------------- drive ---
  // Executa etapas até: estado terminal, checkpoint humano ou cancelamento.
  async function drive(runId) {
    if (driving.has(runId)) return drives.get(runId);
    const promise = driveInner(runId).finally(() => {
      driving.delete(runId);
      drives.delete(runId);
    });
    driving.add(runId);
    drives.set(runId, promise);
    return promise;
  }

  async function driveInner(runId) {
    const run = await load(runId);
    if (isTerminalStatus(run.status)) return;

    if (run.status === 'pending') {
      run.status = 'running';
      run.startedAt = clock().toISOString();
      await persist(run);
      emitEvent('loop-started', runId);
    } else if (run.status !== 'running') {
      return; // waiting_for_approval só anda via approve/reject
    }

    while (true) {
      if (cancelRequested.has(runId)) {
        cancelRequested.delete(runId);
        await finalize(run, 'cancelled');
        return;
      }

      const stepDef = stepDefOf(run, run.currentStepId);
      if (!stepDef) {
        await finalize(run, 'failed', {
          error: `Etapa atual inexistente na definição: "${run.currentStepId}".`,
        });
        return;
      }

      // Limites ANTES de executar (proteção contra loop infinito).
      const hit = evaluateLimits(run, run.definition.limits, {
        nextStepType: stepDef.type,
        now: clock(),
      });
      if (hit) {
        await finalize(run, 'limit_reached', { limit: { ...hit, stepId: stepDef.id } });
        return;
      }

      // Novo stepRun persistido ANTES da execução.
      const stepRun = {
        id: newId(),
        stepId: stepDef.id,
        type: stepDef.type,
        status: 'running',
        attempt: run.stepRuns.filter((s) => s.stepId === stepDef.id).length + 1,
        startedAt: clock().toISOString(),
      };
      run.stepRuns.push(stepRun);
      try {
        await persist(run);
      } catch (err) {
        stepRun.status = 'failed';
        await finalize(run, 'failed', { error: `Falha de persistência: ${err.message}` });
        return;
      }
      emitEvent('step-started', runId, { stepId: stepDef.id });

      // Execução com cancelamento cooperativo.
      const controller = new AbortController();
      controllers.set(runId, controller);
      let result;
      try {
        const executor = executorRegistry.get(stepDef.type);
        result = await executor.execute(
          {
            run,
            stepDef,
            workspacePath: run.workspacePath,
            objective: run.objective,
            limits: run.definition.limits,
            emitOutput: (stream, content) =>
              emitEvent('step-output', runId, { stepId: stepDef.id, stream, content }),
          },
          controller.signal,
        );
      } catch (err) {
        result = {
          stepStatus: 'failed',
          condition: 'failure',
          summary: truncateSummary(String((err && err.message) || err)),
          error: String((err && err.message) || err),
        };
      } finally {
        controllers.delete(runId);
      }

      // Contadores por tipo (avaliados pelos limites da próxima etapa).
      if (stepDef.type === 'agent') run.agentExecutions += 1;
      if (stepDef.type === 'command') run.commandExecutions += 1;

      // Aplica o resultado no stepRun (campos já truncados pelos executores).
      stepRun.status = result.stepStatus;
      for (const k of [
        'summary',
        'stdout',
        'stderr',
        'exitCode',
        'sessionId',
        'usage',
        'validation',
        'checkpoint',
        'error',
      ]) {
        if (result[k] !== undefined) stepRun[k] = result[k];
      }

      if (result.stepStatus === 'waiting_for_approval') {
        run.status = 'waiting_for_approval';
        await persist(run);
        emitEvent('approval-required', runId, { stepId: stepDef.id });
        return; // o drive PARA; approve/reject retomam depois (mesmo pós-reinício)
      }

      stepRun.finishedAt = clock().toISOString();
      emitEvent(result.stepStatus === 'failed' ? 'step-failed' : 'step-completed', runId, {
        stepId: stepDef.id,
        ...(result.stepStatus === 'failed' ? { error: stepRun.error || stepRun.summary } : {}),
      });

      if (result.stepStatus === 'cancelled' || cancelRequested.has(runId)) {
        cancelRequested.delete(runId);
        await finalize(run, 'cancelled');
        return;
      }

      // Transição decidida pelo motor.
      let decision;
      try {
        decision = resolveTransition(stepDef, result.condition);
      } catch (err) {
        await finalize(run, 'failed', { error: err.message });
        return;
      }
      stepRun.transition = decision;

      if (decision.terminalStatus) {
        await finalize(run, decision.terminalStatus, {
          ...(decision.terminalStatus === 'failed'
            ? { error: stepRun.error || stepRun.summary }
            : {}),
        });
        return;
      }

      // Voltar para uma etapa anterior (back-edge) = nova iteração do ciclo.
      if (isBackEdge(run, stepDef.id, decision.nextStepId)) run.iteration += 1;
      run.currentStepId = decision.nextStepId;
      try {
        await persist(run);
      } catch (err) {
        await finalize(run, 'failed', { error: `Falha de persistência: ${err.message}` });
        return;
      }
    }
  }

  // ----------------------------------------------------------------- API ---

  async function startRun({ definition, workspacePath, objective, metadata }) {
    assertValidDefinition(definition);
    if (typeof workspacePath !== 'string' || !workspacePath.trim())
      throw new CodingLoopInvalidStateError('workspacePath é obrigatório.');
    if (typeof objective !== 'string' || !objective.trim())
      throw new CodingLoopInvalidStateError('Informe o objetivo do loop.');

    const runId = newId();
    const run = {
      id: runId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      definition, // gravada no run: retomada não depende do template continuar igual
      workspacePath,
      objective: objective.trim(),
      status: 'pending',
      currentStepId: definition.initialStepId,
      iteration: 0,
      agentExecutions: 0,
      commandExecutions: 0,
      updatedAt: clock().toISOString(),
      stepRuns: [],
      ...(metadata ? { metadata } : {}),
    };
    runs.set(runId, run);
    try {
      await persist(run);
    } catch (err) {
      runs.delete(runId);
      throw new LoopPersistenceError(`Não foi possível iniciar o Coding Loop: ${err.message}`);
    }
    void drive(runId); // dirige em background; eventos contam a história
    return snapshot(run);
  }

  async function getRun(runId) {
    return snapshot(await load(runId));
  }

  async function listRuns() {
    const stored = await repository.list();
    // runs ativos em memória são a versão mais fresca
    return stored.map((r) => (runs.has(r.id) ? snapshot(runs.get(r.id)) : r));
  }

  function findWaitingCheckpoint(run, stepId) {
    if (run.status !== 'waiting_for_approval')
      throw new CodingLoopInvalidStateError('O loop não está aguardando aprovação.');
    const stepRun = [...run.stepRuns]
      .reverse()
      .find((s) => s.stepId === stepId && s.status === 'waiting_for_approval');
    if (!stepRun)
      throw new LoopCheckpointError(`Não há checkpoint aguardando aprovação na etapa "${stepId}".`);
    return stepRun;
  }

  async function decideCheckpoint(runId, stepId, decision, reason) {
    const run = await load(runId);
    const stepRun = findWaitingCheckpoint(run, stepId);
    const stepDef = stepDefOf(run, stepId);
    if (decision === 'rejected' && stepRun.checkpoint && stepRun.checkpoint.allowReject === false)
      throw new LoopCheckpointError('Este checkpoint não permite rejeição.');

    stepRun.status = decision === 'approved' ? 'passed' : 'failed';
    stepRun.finishedAt = clock().toISOString();
    stepRun.checkpoint = {
      ...(stepRun.checkpoint || {}),
      decision,
      decidedAt: stepRun.finishedAt,
      ...(reason ? { reason: truncateSummary(reason, 500) } : {}),
    };
    emitEvent('step-completed', runId, { stepId, decision });

    let transition;
    try {
      transition = resolveTransition(stepDef, decision);
    } catch (err) {
      await finalize(run, 'failed', { error: err.message });
      return snapshot(run);
    }
    stepRun.transition = transition;

    if (transition.terminalStatus) {
      await finalize(run, transition.terminalStatus);
      return snapshot(run);
    }
    if (isBackEdge(run, stepId, transition.nextStepId)) run.iteration += 1;
    run.currentStepId = transition.nextStepId;
    run.status = 'running';
    await persist(run);
    void drive(runId);
    return snapshot(run);
  }

  const approveCheckpoint = (runId, stepId) => decideCheckpoint(runId, stepId, 'approved');
  const rejectCheckpoint = (runId, stepId, reason) =>
    decideCheckpoint(runId, stepId, 'rejected', reason);

  async function cancelRun(runId) {
    const run = await load(runId);
    if (isTerminalStatus(run.status))
      throw new CodingLoopInvalidStateError(
        `O loop já terminou (${run.status}) e não pode ser cancelado.`,
      );
    if (driving.has(runId)) {
      // aborta a etapa corrente; o drive finaliza como cancelled e persiste
      cancelRequested.add(runId);
      const controller = controllers.get(runId);
      if (controller) controller.abort();
      await drives.get(runId);
    } else {
      // parado (checkpoint ou interrompido): finaliza direto
      const waiting = [...run.stepRuns]
        .reverse()
        .find((s) => s.status === 'waiting_for_approval' || s.status === 'running');
      if (waiting) {
        waiting.status = 'cancelled';
        waiting.finishedAt = clock().toISOString();
      }
      await finalize(run, 'cancelled');
    }
    return snapshot(await load(runId));
  }

  // Marca execuções que estavam rodando quando o app fechou. NÃO retoma nada
  // sozinho: o usuário decide (resumeRun). Checkpoints aguardando ficam como estão.
  async function recoverOnStartup() {
    const stored = await repository.list();
    const recovered = [];
    for (const raw of stored) {
      if (raw.status !== 'running') continue;
      const run = runs.get(raw.id) || raw;
      runs.set(run.id, run);
      const active = [...run.stepRuns].reverse().find((s) => s.status === 'running');
      if (active) {
        active.status = 'failed';
        active.error = 'Execução interrompida: o aplicativo foi encerrado durante a etapa.';
        active.finishedAt = clock().toISOString();
      }
      run.interrupted = true;
      await persist(run);
      recovered.push(run.id);
    }
    return recovered;
  }

  // Retoma um loop interrompido: repete a etapa corrente (nova tentativa).
  // Não assume sucesso de nada que estava no meio do caminho.
  async function resumeRun(runId) {
    const run = await load(runId);
    if (isTerminalStatus(run.status))
      throw new CodingLoopInvalidStateError(`O loop já terminou (${run.status}).`);
    if (run.status === 'waiting_for_approval')
      throw new CodingLoopInvalidStateError(
        'O loop está aguardando aprovação — aprove ou rejeite o checkpoint.',
      );
    if (driving.has(runId)) throw new CodingLoopInvalidStateError('O loop já está em execução.');
    delete run.interrupted;
    await persist(run);
    void drive(runId);
    return snapshot(run);
  }

  // Repete explicitamente a etapa interrompida (mesma semântica do resume, com
  // validação de que a etapa pedida é a corrente).
  async function retryStep(runId, stepId) {
    const run = await load(runId);
    if (run.currentStepId !== stepId)
      throw new CodingLoopInvalidStateError(
        `A etapa atual é "${run.currentStepId}", não "${stepId}".`,
      );
    return resumeRun(runId);
  }

  // Promise do drive corrente (testes/shutdown aguardam o loop assentar).
  function settled(runId) {
    return drives.get(runId) || Promise.resolve();
  }

  async function disposeAll() {
    for (const [runId, controller] of controllers) {
      cancelRequested.add(runId);
      try {
        controller.abort();
      } catch {}
    }
    await Promise.allSettled([...drives.values()]);
  }

  return {
    startRun,
    getRun,
    listRuns,
    approveCheckpoint,
    rejectCheckpoint,
    cancelRun,
    resumeRun,
    retryStep,
    recoverOnStartup,
    settled,
    disposeAll,
  };
}

module.exports = { createLoopRunner };
