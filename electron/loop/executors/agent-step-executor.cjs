'use strict';

// Executor de etapa 'agent': roda um coding agent pela abstração da Fase 1
// (CodingAgentService). Não conhece Claude Code — funciona com qualquer
// adapter registrado no CodingAgentRegistry.

const { truncateLog, truncateSummary } = require('../loop-types.cjs');
const { buildAgentPrompt } = require('../loop-prompt-builder.cjs');

function createAgentStepExecutor({ agentRegistry, agentService, idGen, promptBuilder }) {
  const buildPrompt = promptBuilder || buildAgentPrompt;
  const newId = idGen || (() => require('crypto').randomUUID());

  return {
    type: 'agent',

    async execute(input, signal) {
      const { run, stepDef, workspacePath, objective, limits, emitOutput } = input;
      const { agentId } = stepDef.config;

      // Disponibilidade antes de gastar iteração: erro legível, sem stack.
      let adapter;
      try {
        adapter = agentRegistry.get(agentId);
      } catch {
        return failed(`O agente selecionado não está disponível: ${agentId}.`);
      }
      const availability = await adapter.checkAvailability().catch((e) => ({
        available: false,
        reason: String((e && e.message) || e),
      }));
      if (!availability.available) {
        return failed(
          `O agente "${adapter.descriptor.name}" não está disponível` +
            (availability.reason ? ` (${availability.reason}).` : '.'),
        );
      }

      const executionId = newId();
      const prompt = buildPrompt({ objective, workspacePath, stepDef, run, limits });

      // Continuidade: se esta MESMA etapa já rodou antes (repetição), retoma a
      // sessão anterior do agente — ele lembra o que já implementou.
      const previous = [...(run.stepRuns || [])]
        .reverse()
        .find((s) => s.stepId === stepDef.id && s.sessionId);

      const onAbort = () => {
        agentService.cancel(agentId, executionId).catch(() => {});
      };
      if (signal.aborted) return cancelled();
      signal.addEventListener('abort', onAbort, { once: true });

      let result;
      try {
        result = await agentService.execute(
          agentId,
          {
            executionId,
            workspacePath,
            prompt,
            sessionId: previous ? previous.sessionId : undefined,
          },
          (event) => {
            if (!emitOutput) return;
            if (event.type === 'agent-message' && event.event) {
              const ev = event.event;
              if (ev.kind === 'text' && ev.text) emitOutput('agent', ev.text);
              else if (ev.kind === 'tool_use') emitOutput('agent', `[tool: ${ev.name}]\n`);
            } else if (event.type === 'stderr' && event.content) {
              emitOutput('stderr', event.content);
            }
          },
        );
      } catch (err) {
        return failed(String((err && err.message) || err));
      } finally {
        signal.removeEventListener('abort', onAbort);
      }

      const base = {
        sessionId: result.sessionId,
        usage: result.usage,
        stdout: truncateLog(result.output || ''),
        stderr: truncateLog(result.errorOutput || ''),
        exitCode: result.exitCode,
      };
      if (result.status === 'cancelled') return { ...cancelled(), ...base };
      if (result.status === 'completed') {
        return {
          stepStatus: 'passed',
          condition: 'success',
          summary: truncateSummary(result.output || 'Agente concluiu a etapa.'),
          ...base,
        };
      }
      return {
        stepStatus: 'failed',
        condition: 'failure',
        summary: truncateSummary(
          (result.error && result.error.message) || 'O agente falhou nesta etapa.',
        ),
        error: (result.error && result.error.message) || 'Falha na execução do agente.',
        ...base,
      };

      function failed(message) {
        return {
          stepStatus: 'failed',
          condition: 'failure',
          summary: message,
          error: message,
        };
      }
      function cancelled() {
        return {
          stepStatus: 'cancelled',
          condition: 'cancelled',
          summary: 'Execução do agente cancelada.',
        };
      }
    },
  };
}

module.exports = { createAgentStepExecutor };
