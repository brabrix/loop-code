'use strict';

// Monta o prompt de uma etapa de agente. NÃO manda o histórico inteiro: só o
// objetivo, o papel da etapa, um resumo curto das etapas anteriores e — quando
// o loop está repetindo — o feedback da última validação/comando que falhou.

const { truncateSummary } = require('./loop-types.cjs');

// Papéis conhecidos (promptTemplate). Um template desconhecido cai no genérico
// usando o próprio texto como instrução da etapa.
const TEMPLATES = {
  'feature-plan': [
    'Sua tarefa nesta etapa é APENAS criar um plano de implementação, sem alterar nenhum arquivo.',
    'Analise o repositório do workspace e produza um plano curto e numerado: arquivos a tocar, mudanças em cada um, riscos e como validar.',
    'Não implemente nada ainda. Não rode comandos que alterem o estado do repositório.',
  ],
  'feature-implementation': [
    'Sua tarefa nesta etapa é IMPLEMENTAR o plano aprovado no workspace.',
    'Faça mudanças focadas e incrementais; preserve o comportamento existente fora do escopo.',
    'Não faça commit e não faça push — o motor cuida do ciclo de validação.',
  ],
  'bugfix-analysis': [
    'Sua tarefa nesta etapa é APENAS diagnosticar o bug descrito no objetivo, sem alterar nenhum arquivo.',
    'Localize a causa raiz no código, explique-a e proponha a correção mínima (arquivos e mudanças).',
  ],
  'bugfix-implementation': [
    'Sua tarefa nesta etapa é CORRIGIR o bug conforme o diagnóstico aprovado.',
    'Faça a correção mínima; não refatore além do necessário. Não faça commit nem push.',
  ],
};

/**
 * @param {object} p
 * @param {string} p.objective            objetivo informado pelo usuário
 * @param {string} p.workspacePath
 * @param {object} p.stepDef              definição da etapa (name, config.promptTemplate)
 * @param {object} p.run                  CodingLoopRun (iteration, stepRuns, …)
 * @param {object} p.limits               limites da definição
 * @returns {string}
 */
function buildAgentPrompt({ objective, workspacePath, stepDef, run, limits }) {
  const lines = [];
  const template = TEMPLATES[stepDef.config.promptTemplate];

  lines.push('Você está executando UMA etapa de um Coding Loop controlado pelo Loop Code.');
  lines.push(
    'O motor do loop (não você) decide quando avançar, repetir ou terminar. Execute somente o papel desta etapa e pare.',
  );
  lines.push('');
  lines.push(`## Objetivo do loop`);
  lines.push(objective);
  lines.push('');
  lines.push(`## Etapa atual: ${stepDef.name}`);
  if (template) lines.push(...template);
  else lines.push(String(stepDef.config.promptTemplate || 'Execute a etapa descrita acima.'));
  lines.push('');
  lines.push(`## Contexto`);
  lines.push(`- Workspace: ${workspacePath}`);
  lines.push(`- Iteração ${run.iteration + 1} de no máximo ${limits.maxIterations}.`);

  // Resumo curto do que já aconteceu (últimas etapas concluídas, uma linha cada).
  const done = (run.stepRuns || []).filter((s) => s.finishedAt && s.summary);
  if (done.length) {
    lines.push('');
    lines.push('## Etapas anteriores (resumo)');
    for (const s of done.slice(-4)) {
      lines.push(`- [${s.stepId} → ${s.status}] ${truncateSummary(s.summary, 300)}`);
    }
  }

  // Feedback da última falha de validação/comando — o coração da repetição.
  const feedback = lastFailureFeedback(run);
  if (feedback) {
    lines.push('');
    lines.push('## A validação anterior falhou');
    lines.push('Falhas:');
    lines.push(...feedback.map((f) => `- ${f}`));
    lines.push('');
    lines.push(
      'Corrija apenas os problemas identificados e preserve as alterações válidas já feitas.',
    );
  }

  lines.push('');
  lines.push('## Regras de segurança');
  lines.push('- Trabalhe somente dentro do workspace indicado.');
  lines.push('- Não execute git commit, git push, nem altere o histórico Git.');
  lines.push('- Não instale dependências novas sem que o objetivo peça explicitamente.');
  lines.push('- Não toque em segredos, tokens ou arquivos .env.');

  return lines.join('\n');
}

// Extrai mensagens de falha da última validação (ou comando falho) do run.
function lastFailureFeedback(run) {
  const stepRuns = run.stepRuns || [];
  for (let i = stepRuns.length - 1; i >= 0; i--) {
    const s = stepRuns[i];
    if (s.type === 'validation' && s.validation && !s.validation.passed) {
      const fails = s.validation.failedCriteria || [];
      const extra = [];
      // anexa o rabo do stderr/stdout do último comando falho — é o que explica o erro
      const cmd = [...stepRuns.slice(0, i)]
        .reverse()
        .find((c) => c.type === 'command' && c.status === 'failed');
      if (cmd && (cmd.stderr || cmd.stdout))
        extra.push(
          `saída do comando "${cmd.stepId}": ${truncateSummary(cmd.stderr || cmd.stdout, 1500)}`,
        );
      return [...fails, ...extra];
    }
    if (s.type === 'command' && s.status === 'failed' && s.finishedAt) {
      return [
        `o comando da etapa "${s.stepId}" falhou (exit ${s.exitCode})`,
        ...(s.stderr || s.stdout ? [truncateSummary(s.stderr || s.stdout, 1500)] : []),
      ];
    }
  }
  return null;
}

module.exports = { buildAgentPrompt, lastFailureFeedback, TEMPLATES };
