'use strict';

// Executor de etapa 'validation': avalia EVIDÊNCIAS de forma determinística
// (arquivos, exit codes de etapas anteriores) e decide validation_passed ou
// validation_failed. Sem LLM no MVP — validação por IA é uma extensão futura
// (novo check type registrável), não um substituto.

const nodePath = require('path');
const { truncateSummary } = require('../loop-types.cjs');

function createValidationStepExecutor({ fs = require('fs') } = {}) {
  // Resolve um path relativo DENTRO do workspace; recusa escapes (.., absoluto
  // fora do ws, symlink que sai do ws).
  function resolveInWorkspace(workspacePath, p) {
    const wsReal = fs.realpathSync(nodePath.resolve(workspacePath));
    const target = nodePath.resolve(wsReal, p);
    if (target !== wsReal && !target.startsWith(wsReal + nodePath.sep)) {
      throw new Error(`caminho fora do workspace: ${p}`);
    }
    // se o arquivo existe, o realpath também precisa continuar dentro
    if (fs.existsSync(target)) {
      const real = fs.realpathSync(target);
      if (real !== wsReal && !real.startsWith(wsReal + nodePath.sep)) {
        throw new Error(`caminho fora do workspace (symlink): ${p}`);
      }
      return real;
    }
    return target;
  }

  function lastStepRun(run, stepId) {
    return [...(run.stepRuns || [])].reverse().find((s) => s.stepId === stepId && s.finishedAt);
  }

  function runCheck(check, { run, workspacePath }) {
    switch (check.type) {
      case 'boolean':
        return { passed: check.value === true, detail: `valor: ${check.value}` };

      case 'file_exists': {
        const target = resolveInWorkspace(workspacePath, check.path);
        const ok = fs.existsSync(target);
        return { passed: ok, detail: ok ? `existe: ${check.path}` : `não existe: ${check.path}` };
      }

      case 'file_contains': {
        const target = resolveInWorkspace(workspacePath, check.path);
        if (!fs.existsSync(target))
          return { passed: false, detail: `arquivo não existe: ${check.path}` };
        const ok = fs.readFileSync(target, 'utf8').includes(check.text);
        return {
          passed: ok,
          detail: ok
            ? `"${check.text}" presente em ${check.path}`
            : `"${check.text}" ausente em ${check.path}`,
        };
      }

      case 'files_changed': {
        const target = resolveInWorkspace(workspacePath, check.path);
        if (!fs.existsSync(target))
          return { passed: false, detail: `arquivo não existe: ${check.path}` };
        const since = run.startedAt ? Date.parse(run.startedAt) : 0;
        const ok = fs.statSync(target).mtimeMs > since;
        return {
          passed: ok,
          detail: ok
            ? `${check.path} foi modificado nesta execução`
            : `${check.path} não foi modificado nesta execução`,
        };
      }

      case 'previous_step_success': {
        const sr = lastStepRun(run, check.stepId);
        if (!sr) return { passed: false, detail: `a etapa "${check.stepId}" ainda não rodou` };
        const ok = sr.status === 'passed';
        return {
          passed: ok,
          detail:
            `etapa "${check.stepId}" terminou como ${sr.status}` +
            (sr.exitCode != null ? ` (exit ${sr.exitCode})` : ''),
        };
      }

      case 'command_result': {
        const sr = lastStepRun(run, check.stepId);
        if (!sr) return { passed: false, detail: `a etapa "${check.stepId}" ainda não rodou` };
        const codes = check.exitCodes || [0];
        const ok = sr.exitCode != null && codes.includes(sr.exitCode);
        return {
          passed: ok,
          detail: `exit code de "${check.stepId}": ${sr.exitCode} (esperado: ${codes.join(', ')})`,
        };
      }

      default:
        return { passed: false, detail: `tipo de check desconhecido: ${check.type}` };
    }
  }

  return {
    type: 'validation',

    async execute(input, signal) {
      if (signal.aborted) {
        return { stepStatus: 'cancelled', condition: 'cancelled', summary: 'Validação cancelada.' };
      }
      const cfg = input.stepDef.config;
      const checks = [];
      const failedCriteria = [];

      for (const check of cfg.checks) {
        let result;
        try {
          result = runCheck(check, input);
        } catch (err) {
          result = { passed: false, detail: String((err && err.message) || err) };
        }
        checks.push({ type: check.type, passed: result.passed, detail: result.detail });
        if (!result.passed) failedCriteria.push(result.detail);
      }

      const passed = failedCriteria.length === 0;
      const validation = {
        passed,
        checks,
        failedCriteria,
        ...(passed ? {} : { suggestedNextAction: cfg.onFailure || 'repeat_previous_agent_step' }),
      };
      return {
        stepStatus: passed ? 'passed' : 'failed',
        condition: passed ? 'validation_passed' : 'validation_failed',
        summary: passed
          ? `Validação passou (${checks.length} check${checks.length > 1 ? 's' : ''}).`
          : truncateSummary(`Validação falhou: ${failedCriteria.join('; ')}`),
        validation,
      };
    },
  };
}

module.exports = { createValidationStepExecutor };
