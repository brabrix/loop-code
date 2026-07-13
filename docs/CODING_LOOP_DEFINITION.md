# Coding Loop — Definição (schema)

> Validada por `electron/loop/definition-validator.cjs` antes de qualquer
> execução. Referência TS conceitual em `docs/contracts/loop-code-contracts.ts`.

## Schema

```js
CodingLoopDefinition = {
  id: string,
  name: string,
  description?: string,
  version: number,          // inteiro ≥ 1
  initialStepId: string,    // precisa existir em steps
  limits: {
    maxIterations: number,        // obrigatório, ≥ 1 — é a garantia de término
    maxDurationMs?: number,
    maxAgentExecutions?: number,
    maxCommandExecutions?: number,
  },
  steps: CodingLoopStepDefinition[],
}

CodingLoopStepDefinition = {
  id: string,               // único
  name: string,
  description?: string,
  type: 'agent' | 'command' | 'human_checkpoint' | 'validation',
  config: <por tipo, abaixo>,
  transitions: [{
    condition: 'success' | 'failure' | 'approved' | 'rejected'
             | 'validation_passed' | 'validation_failed' | 'cancelled',
    nextStepId?: string,     // OU terminalStatus — nunca os dois
    terminalStatus?: 'completed' | 'blocked' | 'failed' | 'cancelled' | 'limit_reached',
  }],
}
```

## Configs por tipo de etapa

```js
// agent — executa um coding agent (abstração da Fase 1)
{ agentId: 'claude-code', promptTemplate: 'feature-plan', model?: string }
// promptTemplates embutidos: feature-plan, feature-implementation,
// bugfix-analysis, bugfix-implementation. Texto desconhecido vira a
// instrução literal da etapa (loop-prompt-builder.cjs).

// command — processo local seguro
{
  executable: 'npm',            // SEM espaços/metacaracteres de shell
  arguments: ['run', 'test'],   // sempre array
  timeoutMs?: 300000,           // default 5min
  successExitCodes?: [0],       // default [0]
}

// human_checkpoint — pausa até decisão humana
{ title: 'Aprovar plano', description?: string, allowReject?: true }

// validation — checks determinísticos
{
  checks: [
    { type: 'file_exists',           path: 'src/x.js' },
    { type: 'file_contains',         path: 'package.json', text: 'loop-code' },
    { type: 'files_changed',         path: 'src/x.js' },          // mtime > início do run
    { type: 'previous_step_success', stepId: 'run-validation' },  // última execução da etapa passou
    { type: 'command_result',        stepId: 'run-validation', exitCodes?: [0] },
    { type: 'boolean',               value: true },
  ],
  onFailure?: 'repeat_previous_agent_step' | 'fail' | 'block',    // sugestão registrada no resultado
}
```

## Condições produzidas por tipo

| Tipo             | Condições                                       |
| ---------------- | ----------------------------------------------- |
| agent            | success, failure, cancelled                     |
| command          | success, failure, cancelled                     |
| human_checkpoint | approved, rejected, cancelled                   |
| validation       | validation_passed, validation_failed, cancelled |

O validador rejeita transição com condição que a etapa nunca produz.

## O que o validador garante

id/name/version presentes; ≥ 1 etapa; ids únicos; `initialStepId` existente;
toda transição com destino (etapa existente OU status terminal válido, nunca
ambos); pelo menos um caminho terminal; configs compatíveis com o tipo
(`agentId` obrigatório em agent, `executable` sem metacaracteres e `arguments`
em array em command, `title` em checkpoint, `checks` ≥ 1 em validation);
limites inteiros positivos — `maxIterations` obrigatório é o que torna
qualquer ciclo finito. Mensagens são legíveis, ex.:

```text
A etapa "validate" aponta para uma etapa inexistente: "retry-code".
```

## Template Feature Development (embutido)

```text
plan (agent) → approve-plan (checkpoint) → implement (agent)
→ run-validation (command) → evaluate-result (validation)
→ completed (passou) | implement (falhou, nova iteração)
```

Limites default: 5 iterações, 6 execuções de agente, 6 de comando, 1h. O
comando de validação (`npm test` por default) é **configurável** pela UI:
executável, argumentos, timeout e exit codes de sucesso — nada é fixo por
projeto. Segundo template embutido: **Bug Fix** (`analyze → approve-diagnosis
→ fix → run-tests → validate`).

## Como criar um novo template

1. Adicione uma função builder em `electron/loop/templates.cjs` devolvendo uma
   definição completa (use as existentes como molde) e registre-a em
   `TEMPLATE_BUILDERS`.
2. Rode o validador no teste (`definition-validator.test.js` já valida os
   templates embutidos — adicione o seu).
3. Se a etapa precisar de um papel de prompt novo, adicione o template de
   prompt em `loop-prompt-builder.cjs`.
4. Um tipo de etapa NOVO = novo executor registrado no
   `StepExecutorRegistry` (ver `docs/CODING_LOOP_ENGINE.md`) — sem tocar no
   LoopRunner.
