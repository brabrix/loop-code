// claude-todos-core.cjs
// Parser puro dos "todos" (tasks) que o Claude Code grava no transcript
// (~/.claude/projects/<projeto>/<id>.jsonl) — irmão do claude-sessions.cjs:
// só fs/path, sem electron, testável em node puro (vitest).
//
// Dois schemas convivem no Claude Code:
//   - legado TodoWrite: cada tool_use carrega o snapshot COMPLETO da lista;
//   - novo TaskCreate/TaskUpdate (flag CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS):
//     stream de eventos — create adiciona (o id sai no tool_result), update
//     muta por taskId.
// O schema vigente é o do ÚLTIMO evento relevante do transcript.
const fs = require('fs');
const path = require('path');

const VALID_STATUSES = ['pending', 'in_progress', 'completed'];

function parseEpoch(ts) {
  if (!ts) return undefined;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : undefined;
}

function isValidTodo(item) {
  return !!item && typeof item === 'object'
    && typeof item.content === 'string'
    && typeof item.activeForm === 'string'
    && VALID_STATUSES.includes(item.status);
}

// Monta um Todo omitindo timings indefinidos — snapshot menor e serializável.
function makeTodo(content, activeForm, status, startedAt, completedAt) {
  const t = { content, activeForm, status };
  if (startedAt !== undefined) t.startedAt = startedAt;
  if (completedAt !== undefined) t.completedAt = completedAt;
  return t;
}

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

// Qual schema vale: o do último evento de todos do transcript (um resume pode
// misturar os dois; vence o mais recente).
function detectSchema(lines, skipSidechain) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    const hasTodoWrite = line.indexOf('"name":"TodoWrite"') >= 0;
    const hasTask = line.indexOf('"name":"TaskCreate"') >= 0 || line.indexOf('"name":"TaskUpdate"') >= 0;
    if (!hasTodoWrite && !hasTask) continue;
    const entry = parseLine(line);
    if (!entry || (skipSidechain && entry.isSidechain)) continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      if (block.name === 'TodoWrite') return 'TodoWrite';
      if (block.name === 'TaskCreate' || block.name === 'TaskUpdate') return 'Task';
    }
  }
  return null;
}

// Último snapshot do TodoWrite: varre do fim pro começo e devolve o primeiro
// tool_use válido que encontrar.
function readLastTodoWriteSnapshot(lines, skipSidechain) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.indexOf('"name":"TodoWrite"') < 0) continue;
    const entry = parseLine(line);
    if (!entry || (skipSidechain && entry.isSidechain)) continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (block && block.type === 'tool_use' && block.name === 'TodoWrite') {
        const raw = block.input && block.input.todos;
        if (Array.isArray(raw)) return raw.filter(isValidTodo);
      }
    }
  }
  return null;
}

// Varre os snapshots em ordem cronológica e registra, por content, o primeiro
// instante em que a task apareceu in_progress e completed (first-write-wins).
// prevStatus detecta a TRANSIÇÃO pra in_progress: reaparecer em in_progress
// vindo de outro estado zera o streak — uma rodada que reutiliza a mesma
// descrição não herda o tempo da anterior. 'absent' = sumiu do snapshot.
function extractTodoWriteTimings(lines, skipSidechain) {
  const timings = new Map();
  const prevStatus = new Map();
  for (const line of lines) {
    if (!line || line.indexOf('"name":"TodoWrite"') < 0) continue;
    const entry = parseLine(line);
    if (!entry || (skipSidechain && entry.isSidechain)) continue;
    const ts = parseEpoch(entry.timestamp);
    if (ts === undefined) continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use' || block.name !== 'TodoWrite') continue;
      const raw = block.input && block.input.todos;
      if (!Array.isArray(raw)) continue;
      const seen = new Set();
      for (const item of raw) {
        if (!isValidTodo(item)) continue;
        seen.add(item.content);
        const prev = prevStatus.get(item.content);
        if (item.status === 'in_progress') {
          if (prev !== 'in_progress') timings.set(item.content, { startedAt: ts });
        } else if (item.status === 'completed') {
          const rec = timings.get(item.content) || {};
          if (rec.completedAt === undefined) rec.completedAt = ts;
          timings.set(item.content, rec);
        } else {
          timings.set(item.content, {}); // pending = ainda não começou nesta rodada
        }
        prevStatus.set(item.content, item.status);
      }
      for (const key of prevStatus.keys()) {
        if (!seen.has(key)) prevStatus.set(key, 'absent');
      }
    }
  }
  return timings;
}

// Task list atual do transcript, no schema que estiver em uso. null = o
// transcript nunca emitiu evento de todos (UI mostra "aguardando").
function parseTodos(lines, skipSidechain) {
  const schema = detectSchema(lines, skipSidechain);
  if (schema === 'TodoWrite') {
    const todos = readLastTodoWriteSnapshot(lines, skipSidechain);
    if (!todos) return null;
    const timings = extractTodoWriteTimings(lines, skipSidechain);
    return todos.map((t) => {
      const tm = timings.get(t.content);
      return tm ? makeTodo(t.content, t.activeForm, t.status, tm.startedAt, tm.completedAt) : makeTodo(t.content, t.activeForm, t.status);
    });
  }
  return null; // schema 'Task' entra na Task 2
}

module.exports = { parseTodos };
