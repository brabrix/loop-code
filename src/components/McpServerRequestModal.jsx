import { useEffect, useState } from 'react';
import { Bot, MessageSquareQuote } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { McpToolForm } from './McpToolForm.jsx';

// Bloco B — modal que atende requisições do SERVIDOR ao cliente (human-in-the-loop):
// - sampling/createMessage: o servidor pede uma completion de LLM; o usuário escreve/aprova a resposta.
// - elicitation/create: o servidor pede dados estruturados ao usuário (form a partir do schema).
export function McpServerRequestModal({ request, onRespond }) {
  const [text, setText] = useState('');
  const [form, setForm] = useState({});

  useEffect(() => { setText(''); setForm({}); }, [request?.reqId]);

  if (!request) return null;
  const { reqId, kind, params = {} } = request;

  const close = (result, error) => onRespond(reqId, result, error);

  const renderContent = (c) => {
    if (!c) return '';
    if (c.type === 'text') return c.text;
    return `[conteúdo ${c.type || 'desconhecido'}]`;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl">
        {kind === 'sampling' ? (
          <>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Bot className="size-4 text-primary" />
              <span className="font-medium">O servidor pediu uma resposta de IA (sampling)</span>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              <p className="text-xs text-muted-foreground">
                O servidor MCP quer que o cliente gere uma resposta. Como não há IA embutida, você responde manualmente — revise o contexto e escreva a resposta a devolver.
              </p>
              {params.systemPrompt && (
                <div>
                  <div className="eyebrow mb-1">System</div>
                  <div className="rounded border bg-muted/40 px-2.5 py-1.5 text-xs whitespace-pre-wrap">{params.systemPrompt}</div>
                </div>
              )}
              <div>
                <div className="eyebrow mb-1">Mensagens</div>
                <div className="space-y-1.5">
                  {(params.messages || []).map((m, i) => (
                    <div key={i} className="rounded border bg-muted/40 px-2.5 py-1.5 text-xs">
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">{m.role}</span>
                      <div className="whitespace-pre-wrap">{renderContent(m.content)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1">Sua resposta {params.maxTokens ? `(máx ~${params.maxTokens} tokens)` : ''}</div>
                <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={5}
                  placeholder="Escreva a resposta que será devolvida ao servidor…"
                  className="w-full resize-y rounded border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => close(null, 'Sampling recusado pelo usuário.')}>Recusar</Button>
              <Button size="sm" disabled={!text.trim()}
                onClick={() => close({ role: 'assistant', content: { type: 'text', text }, model: 'carcara-manual', stopReason: 'endTurn' })}>
                Enviar resposta
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <MessageSquareQuote className="size-4 text-primary" />
              <span className="font-medium">O servidor pediu informações (elicitation)</span>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {params.message && <p className="text-sm whitespace-pre-wrap">{params.message}</p>}
              <McpToolForm schema={params.requestedSchema} value={form} onChange={setForm} />
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => close({ action: 'cancel' })}>Cancelar</Button>
              <Button variant="secondary" size="sm" onClick={() => close({ action: 'decline' })}>Recusar</Button>
              <Button size="sm" onClick={() => close({ action: 'accept', content: form })}>Enviar</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
