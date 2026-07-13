import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button.jsx';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Painel EXPERIMENTAL de Coding Loops. O renderer só pede ações e exibe
// estado/eventos — quem controla o workflow é o LoopRunner no processo main
// (ver docs/CODING_LOOP_ENGINE.md). Nada aqui executa processos.

const TERMINAL = ['completed', 'blocked', 'failed', 'cancelled', 'limit_reached'];
const MAX_LOG_LINES = 500;

const STATUS_STYLE = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-primary/15 text-primary',
  waiting_for_approval: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  blocked: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  limit_reached: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
};

function StatusBadge({ status }) {
  const t = useT();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        STATUS_STYLE[status] || 'bg-muted text-muted-foreground',
      )}
    >
      {t(`loops.status_${status}`)}
    </span>
  );
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}min ${s % 60}s`;
}

function runDuration(run, nowTs) {
  if (!run?.startedAt) return null;
  const end = run.finishedAt ? Date.parse(run.finishedAt) : nowTs;
  return end - Date.parse(run.startedAt);
}

// ---------- formulário de novo loop ----------
function StartForm({ active, templates, defaultAgentId, agents, onStarted }) {
  const t = useT();
  const [templateId, setTemplateId] = useState('feature-development');
  const [objective, setObjective] = useState('');
  const [executable, setExecutable] = useState('npm');
  const [argsText, setArgsText] = useState('test');
  const [maxIterations, setMaxIterations] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const agent = agents?.find((a) => a.descriptor.id === defaultAgentId);

  const start = async () => {
    setError('');
    if (!objective.trim()) {
      setError(t('loops.err_objective'));
      return;
    }
    setBusy(true);
    try {
      const res = await window.api.loopStart(templateId, active.path, objective, {
        maxIterations: Number(maxIterations) || 5,
        validationCommand: {
          executable: executable.trim(),
          arguments: argsText.trim() ? argsText.trim().split(/\s+/) : [],
        },
      });
      if (res?.error) setError(res.error);
      else onStarted(res.run);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl p-4">
      <div className="mb-1 text-sm font-semibold">{t('loops.new_title')}</div>
      <p className="mb-4 text-xs text-muted-foreground">{t('loops.new_hint')}</p>

      <label className="mb-1 block text-xs font-medium">{t('loops.template')}</label>
      <select
        value={templateId}
        onChange={(e) => setTemplateId(e.target.value)}
        className="mb-3 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        {(templates || []).map((tpl) => (
          <option key={tpl.id} value={tpl.id}>
            {tpl.name}
          </option>
        ))}
      </select>

      <label className="mb-1 block text-xs font-medium">{t('loops.objective')}</label>
      <textarea
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        rows={3}
        placeholder={t('loops.objective_ph')}
        className="mb-3 w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm"
      />

      <label className="mb-1 block text-xs font-medium">{t('loops.agent')}</label>
      <div className="mb-3 flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
        <span>{agent?.descriptor?.name || defaultAgentId}</span>
        <span
          className={cn(
            'text-[11px]',
            agent?.availability?.available ? 'text-emerald-500' : 'text-destructive',
          )}
        >
          {agent
            ? agent.availability.available
              ? t('loops.agent_available')
              : t('loops.agent_unavailable')
            : ''}
        </span>
      </div>

      <label className="mb-1 block text-xs font-medium">{t('loops.validation_cmd')}</label>
      <div className="mb-3 flex gap-2">
        <input
          value={executable}
          onChange={(e) => setExecutable(e.target.value)}
          placeholder="npm"
          className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
        />
        <input
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder="test"
          className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <p className="-mt-2 mb-3 text-[11px] text-muted-foreground">{t('loops.validation_hint')}</p>

      <label className="mb-1 block text-xs font-medium">{t('loops.max_iterations')}</label>
      <input
        type="number"
        min={1}
        max={20}
        value={maxIterations}
        onChange={(e) => setMaxIterations(e.target.value)}
        className="mb-4 w-24 rounded-md border bg-background px-2 py-1.5 text-sm"
      />

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
      <Button onClick={start} disabled={busy}>
        {busy ? t('loops.starting') : t('loops.start')}
      </Button>
    </div>
  );
}

// ---------- detalhe de uma execução ----------
function RunDetail({ run, logLines, onAction, busyAction }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  const logRef = useRef(null);

  const isRunning = run.status === 'running';
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  const stepName = (stepId) => run.definition?.steps?.find((s) => s.id === stepId)?.name || stepId;
  const terminal = TERMINAL.includes(run.status);
  const waiting = run.status === 'waiting_for_approval';
  const waitingStep = waiting
    ? [...run.stepRuns].reverse().find((s) => s.status === 'waiting_for_approval')
    : null;
  const lastValidation = [...run.stepRuns].reverse().find((s) => s.validation);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabeçalho */}
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{run.definition?.name}</span>
          <StatusBadge status={run.status} />
          {run.interrupted && (
            <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] text-orange-600 dark:text-orange-400">
              {t('loops.interrupted')}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{run.objective}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {t('loops.current_step')}: <b>{stepName(run.currentStepId)}</b>
          </span>
          <span>
            {t('loops.iteration')}: {run.iteration}/{run.definition?.limits?.maxIterations}
          </span>
          <span>
            {t('loops.agent_execs')}: {run.agentExecutions}
          </span>
          <span>
            {t('loops.command_execs')}: {run.commandExecutions}
          </span>
          <span>
            {t('loops.duration')}: {fmtDuration(runDuration(run, now))}
          </span>
        </div>
        {run.error?.message && <p className="mt-2 text-xs text-destructive">{run.error.message}</p>}
        {run.limitReached && (
          <p className="mt-2 text-xs text-orange-600 dark:text-orange-400">
            {t('loops.limit_detail', {
              limit: run.limitReached.limit,
              max: String(run.limitReached.max),
            })}
          </p>
        )}

        {/* Ações */}
        <div className="mt-3 flex flex-wrap gap-2">
          {waiting && waitingStep && (
            <>
              <Button
                size="sm"
                disabled={!!busyAction}
                onClick={() => onAction('approve', waitingStep.stepId)}
              >
                {t('loops.approve')}
              </Button>
              {waitingStep.checkpoint?.allowReject !== false && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busyAction}
                  onClick={() => onAction('reject', waitingStep.stepId)}
                >
                  {t('loops.reject')}
                </Button>
              )}
            </>
          )}
          {run.interrupted && !terminal && (
            <Button size="sm" disabled={!!busyAction} onClick={() => onAction('resume')}>
              {t('loops.resume')}
            </Button>
          )}
          {!terminal && (
            <Button
              size="sm"
              variant="outline"
              disabled={!!busyAction}
              onClick={() => onAction('cancel')}
            >
              {t('loops.cancel')}
            </Button>
          )}
        </div>
        {waiting && waitingStep?.checkpoint && (
          <div className="mt-3 rounded-md border border-dashed p-2 text-xs">
            <b>{waitingStep.checkpoint.title}</b>
            {waitingStep.checkpoint.description && (
              <p className="mt-1 text-muted-foreground">{waitingStep.checkpoint.description}</p>
            )}
          </div>
        )}
      </div>

      {/* Etapas */}
      <div className="border-b px-4 py-2">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('loops.steps')}
        </div>
        <div className="flex flex-col gap-1">
          {run.stepRuns.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              <StatusBadge
                status={
                  s.status === 'waiting_for_approval'
                    ? 'waiting_for_approval'
                    : s.status === 'passed'
                      ? 'completed'
                      : s.status === 'running'
                        ? 'running'
                        : s.status === 'failed'
                          ? 'failed'
                          : 'cancelled'
                }
              />
              <span className="font-medium">{stepName(s.stepId)}</span>
              {s.attempt > 1 && (
                <span className="text-muted-foreground">
                  ({t('loops.attempt')} {s.attempt})
                </span>
              )}
              {s.summary && (
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.summary}</span>
              )}
            </div>
          ))}
          {run.stepRuns.length === 0 && (
            <span className="text-xs text-muted-foreground">{t('loops.no_steps_yet')}</span>
          )}
        </div>
        {lastValidation?.validation && (
          <div className="mt-2 rounded-md bg-muted/40 p-2 text-[11px]">
            <b>{t('loops.validation_result')}:</b>{' '}
            {lastValidation.validation.passed
              ? t('loops.validation_ok')
              : t('loops.validation_fail')}
            {!lastValidation.validation.passed && (
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {lastValidation.validation.failedCriteria.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Log ao vivo */}
      <div className="min-h-0 flex-1 px-4 py-2">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('loops.log')}
        </div>
        <div
          ref={logRef}
          className="h-[calc(100%-20px)] overflow-auto rounded-md bg-muted/30 p-2 font-mono text-[11px] leading-relaxed"
        >
          {(logLines || []).map((l, i) => (
            <div key={i} className={cn(l.stream === 'stderr' && 'text-destructive')}>
              {l.content}
            </div>
          ))}
          {(!logLines || logLines.length === 0) && (
            <span className="text-muted-foreground">{t('loops.log_empty')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- painel principal ----------
export function LoopPanel({ active }) {
  const t = useT();
  const [templates, setTemplates] = useState([]);
  const [defaultAgentId, setDefaultAgentId] = useState('claude-code');
  const [agents, setAgents] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [actionError, setActionError] = useState('');
  const logsRef = useRef(new Map()); // runId -> [{stream, content}]
  const [, forceLog] = useState(0);

  const projectPath = active?.path || '';
  const selected = runs.find((r) => r.id === selectedId) || null;

  const refreshRuns = useCallback(async () => {
    if (!projectPath) return;
    const res = await window.api.loopListRuns(projectPath);
    if (res?.ok) setRuns(res.runs);
  }, [projectPath]);

  const refreshRun = useCallback(async (runId) => {
    const res = await window.api.loopGet(runId);
    if (res?.ok) {
      setRuns((prev) => {
        const i = prev.findIndex((r) => r.id === runId);
        if (i < 0) return [res.run, ...prev];
        const next = [...prev];
        next[i] = res.run;
        return next;
      });
    }
  }, []);

  // Carga inicial: templates + agentes + runs do projeto.
  useEffect(() => {
    let alive = true;
    (async () => {
      const defs = await window.api.loopListDefinitions();
      if (alive && defs?.ok) {
        setTemplates(defs.templates);
        setDefaultAgentId(defs.defaultAgentId);
      }
      const ag = await window.api.agentsList();
      if (alive && ag?.ok) setAgents(ag.agents);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setShowForm(false);
    refreshRuns();
  }, [projectPath, refreshRuns]);

  // Eventos do motor: log em streaming + refresh do run nas mudanças de estado.
  useEffect(() => {
    const off = window.api.on('loop:event', (event) => {
      if (event.type === 'step-output') {
        const arr = logsRef.current.get(event.runId) || [];
        arr.push({ stream: event.stream, content: event.content });
        if (arr.length > MAX_LOG_LINES) arr.splice(0, arr.length - MAX_LOG_LINES);
        logsRef.current.set(event.runId, arr);
        forceLog((n) => n + 1);
      } else {
        refreshRun(event.runId);
      }
    });
    return off;
  }, [refreshRun]);

  const onAction = async (action, stepId) => {
    if (!selected) return;
    setBusyAction(true);
    setActionError('');
    try {
      let res;
      if (action === 'approve') res = await window.api.loopApproveCheckpoint(selected.id, stepId);
      else if (action === 'reject')
        res = await window.api.loopRejectCheckpoint(selected.id, stepId);
      else if (action === 'cancel') res = await window.api.loopCancel(selected.id);
      else if (action === 'resume') res = await window.api.loopResume(selected.id);
      if (res?.error) setActionError(res.error);
      else if (res?.run) await refreshRun(selected.id);
    } finally {
      setBusyAction(false);
    }
  };

  if (!active) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        {t('loops.no_project')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Coluna esquerda: histórico */}
      <div className="flex w-60 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div>
            <div className="text-xs font-semibold">{t('loops.title')}</div>
            <div className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {t('loops.experimental')}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowForm(true);
              setSelectedId(null);
            }}
          >
            {t('loops.new')}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setSelectedId(r.id);
                setShowForm(false);
              }}
              className={cn(
                'block w-full border-b px-3 py-2 text-left hover:bg-muted/50',
                selectedId === r.id && 'bg-muted',
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-xs font-medium">{r.definition?.name}</span>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{r.objective}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'} ·{' '}
                {fmtDuration(runDuration(r, Date.now()))} · {t('loops.iteration')} {r.iteration}
              </p>
            </button>
          ))}
          {runs.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">{t('loops.empty_history')}</p>
          )}
        </div>
      </div>

      {/* Coluna direita: form ou detalhe */}
      <div className="min-w-0 flex-1">
        {actionError && (
          <p className="border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
            {actionError}
          </p>
        )}
        {showForm || !selected ? (
          <StartForm
            active={active}
            templates={templates}
            defaultAgentId={defaultAgentId}
            agents={agents}
            onStarted={(run) => {
              setShowForm(false);
              setSelectedId(run.id);
              refreshRuns();
            }}
          />
        ) : (
          <RunDetail
            run={selected}
            logLines={logsRef.current.get(selected.id)}
            onAction={onAction}
            busyAction={busyAction}
          />
        )}
      </div>
    </div>
  );
}
