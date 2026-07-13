/**
 * Loop Code — contratos iniciais (referência, sem efeito no runtime).
 *
 * O app hoje é JavaScript puro; este arquivo documenta as interfaces que os
 * módulos `electron/agents/` e `electron/loop/` deverão implementar nas
 * Fases 2–3 (ver docs/LOOP_CODE_MIGRATION_PLAN.md). Ele fica em docs/ de
 * propósito: não é importado por ninguém e não entra no bundle.
 *
 * Decisões de modelagem (alinhadas ao código existente):
 * - `AgentKind` espelha VALID_CLIS de electron/ai-cli.cjs.
 * - Transporte 'headless' espelha chat-cli.cjs (stream-json); 'pty' espelha
 *   term:ensure. O LoopRunner prefere headless quando o adapter suportar.
 * - Eventos seguem o padrão push do app (chat:event, todos:snapshot):
 *   um canal IPC único `loop:event` com payload discriminado por `type`.
 */

// ---------------------------------------------------------------------------
// Agentes
// ---------------------------------------------------------------------------

/** Ids das CLIs suportadas hoje (electron/ai-cli.cjs) + futuras. */
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'agy' | 'gemini' | 'custom';

export type AgentTransport = 'headless' | 'pty';

export interface AgentExecutionInput {
  executionId: string;
  projectPath: string;
  /** Prompt principal (tarefa + contexto montado pelo TaskContextLoader). */
  prompt: string;
  /** Arquivos/trechos anexados como contexto adicional. */
  attachments?: Array<{ path: string; reason?: string }>;
  /** Id de sessão do agente para retomar (resume) uma conversa anterior. */
  resumeId?: string;
  /** Política de permissões — nunca herdar bypass global implícito. */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  model?: string;
  timeoutMs?: number;
  /** Sinal de cancelamento cooperativo (o runner também pode chamar cancel). */
  abortSignal?: AbortSignal;
}

export interface AgentExecutionResult {
  executionId: string;
  status: 'ok' | 'error' | 'canceled' | 'timeout';
  /** Resposta final em texto (resumo do agente). */
  output: string;
  /** Id de sessão devolvido pela CLI, para resume na próxima iteração. */
  sessionId?: string;
  /** Custo/uso quando a CLI reporta (Claude Code reporta em stream-json). */
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  /** Arquivos que o agente declarou ter tocado (quando parseável). */
  changedFiles?: string[];
  error?: { message: string; detail?: string };
}

export interface CodingAgentAdapter {
  id: AgentKind;
  name: string;
  /** Como o runner conversa com o agente; headless é o preferido. */
  transports: AgentTransport[];

  /** CLI instalada e autenticada? (reusa a checagem de system:checkTools) */
  isAvailable(): Promise<boolean>;

  execute(input: AgentExecutionInput): Promise<AgentExecutionResult>;

  /** Eventos incrementais (texto, tool use, custo) durante o execute. */
  onEvent?(executionId: string, listener: (event: AgentStreamEvent) => void): () => void;

  cancel(executionId: string): Promise<void>;
}

export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail?: unknown }
  | { type: 'usage'; usage: NonNullable<AgentExecutionResult['usage']> }
  | { type: 'status'; status: 'starting' | 'working' | 'finishing' };

// ---------------------------------------------------------------------------
// Definição de loop
// ---------------------------------------------------------------------------

export type CodingLoopStepType =
  | 'agent' // rodar um agente com um prompt (planejar, implementar, corrigir…)
  | 'command' // rodar comando do projeto (build, lint, test) via StepExecutor
  | 'validation' // avaliar critérios de aceite (ValidationEngine)
  | 'review' // revisão (agente revisor ou humana)
  | 'checkpoint' // criar checkpoint (shadow git)
  | 'commit'; // commit (e futuramente PR) — sempre explícito, nunca push automático

export interface CodingLoopStep {
  id: string;
  type: CodingLoopStepType;
  name: string;
  /** type 'agent': qual agente e template de prompt. */
  agent?: { kind: AgentKind; promptTemplate: string; model?: string };
  /** type 'command': comando e diretório (relativo ao projeto). */
  command?: { cmd: string; args?: string[]; cwd?: string; timeoutMs?: number };
  /** Step que recebe o controle quando este falha (default: correção). */
  onFailStepId?: string;
  /** Falha deste step encerra o run (ex.: validação final)? */
  critical?: boolean;
}

export interface CodingLoopLimits {
  maxIterations: number;
  maxDurationMs?: number;
  maxCostUsd?: number;
  /** Ações que exigem confirmação humana mesmo dentro do loop. */
  requireHumanFor?: Array<'commit' | 'push' | 'pullRequest' | 'delete' | 'migration'>;
}

export interface CodingLoopDefinition {
  id: string;
  name: string;
  description?: string;
  steps: CodingLoopStep[];
  limits: CodingLoopLimits;
}

// ---------------------------------------------------------------------------
// Execução (run)
// ---------------------------------------------------------------------------

export type CodingLoopStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'validating'
  | 'correcting'
  | 'committing'
  | 'reporting'
  | 'paused'
  | 'needs_human'
  | 'done'
  | 'failed'
  | 'canceled';

export interface CodingLoopRun {
  id: string;
  loopId: string;
  projectPath: string;
  /** Tarefa do Brabrix que originou o run (ausente em runs locais avulsos). */
  taskId?: string;
  status: CodingLoopStatus;
  currentStepId?: string;
  iteration: number;
  /** Checkpoint (hash no shadow git) do início da iteração corrente. */
  lastCheckpoint?: string;
  usage?: { costUsd: number; inputTokens: number; outputTokens: number };
  startedAt: string; // ISO 8601
  finishedAt?: string; // ISO 8601
  /** Por que parou (limite, falha crítica, pedido humano, cancelado…). */
  stopReason?: string;
}

/** Evento append-only do run (LoopHistory: userData/loops/<runId>.events.jsonl). */
export interface CodingLoopEvent {
  runId: string;
  at: string; // ISO 8601
  type:
    | 'run:started'
    | 'step:started'
    | 'step:finished'
    | 'agent:event'
    | 'validation:result'
    | 'checkpoint:created'
    | 'iteration:advanced'
    | 'status:changed'
    | 'run:finished';
  stepId?: string;
  iteration?: number;
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// Validação de critérios de aceite
// ---------------------------------------------------------------------------

export interface ValidationCheck {
  id: string;
  /** Critério de aceite (texto do Brabrix) ou checagem técnica (ex.: "lint"). */
  description: string;
  kind: 'command' | 'criteria' | 'agent-judged';
  passed: boolean;
  /** Evidência: saída do comando, justificativa do agente etc. */
  evidence?: string;
}

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
  /** Critérios de aceite (ids/descrições) ainda não atendidos. */
  failedCriteria: string[];
  /** Sugestão do motor para o próximo passo (vira prompt de correção). */
  suggestedNextAction?: string;
}

// ---------------------------------------------------------------------------
// Brabrix (esboço — Fase 5; sem implementação nesta etapa)
// ---------------------------------------------------------------------------

export interface BrabrixTaskContext {
  taskId: string;
  projectId: string;
  title: string;
  description: string;
  prd?: string;
  technicalSpec?: string;
  acceptanceCriteria: Array<{ id: string; description: string }>;
  projectContext?: string;
}

export interface TaskProgressUpdate {
  taskId: string;
  runId: string;
  status: CodingLoopStatus;
  iteration: number;
  summary?: string;
  commitHash?: string;
  pullRequestUrl?: string;
}
