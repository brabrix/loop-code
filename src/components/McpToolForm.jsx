import { Input } from './ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx';

// Gera campos a partir do inputSchema (JSON Schema) de uma tool MCP.
// Suporta como campo: string, number/integer, boolean, enum.
// object/array (aninhado) => editado como JSON cru no MCPPanel, não aqui. YAGNI.
export function McpToolForm({ schema, value, onChange }) {
  const props = (schema && schema.properties) || {};
  const required = (schema && schema.required) || [];
  const names = Object.keys(props);
  const set = (k, v) => onChange({ ...value, [k]: v });

  if (!names.length) {
    return <p className="text-xs text-muted-foreground">Esta tool não recebe argumentos.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {names.map((k) => {
        const p = props[k] || {};
        const isReq = required.includes(k);
        const label = (
          <label className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-medium">
            <span className="font-mono">{k}</span>
            {isReq && <span className="text-primary">*</span>}
            {p.description && <span className="font-normal text-muted-foreground">— {p.description}</span>}
          </label>
        );

        if (Array.isArray(p.enum)) {
          return (
            <div key={k}>
              {label}
              <Select value={value[k] ?? ''} onValueChange={(v) => set(k, v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {p.enum.map((o) => <SelectItem key={String(o)} value={String(o)} className="text-xs">{String(o)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          );
        }

        if (p.type === 'boolean') {
          return (
            <label key={k} className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={!!value[k]} onChange={(e) => set(k, e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              <span className="font-mono">{k}</span>{isReq && <span className="text-primary">*</span>}
            </label>
          );
        }

        const isNum = p.type === 'number' || p.type === 'integer';
        return (
          <div key={k}>
            {label}
            <Input
              type={isNum ? 'number' : 'text'}
              value={value[k] ?? ''}
              onChange={(e) => set(k, isNum ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
              placeholder={p.type || 'string'}
              spellCheck={false}
              className="h-8 font-mono text-xs"
            />
          </div>
        );
      })}
    </div>
  );
}
