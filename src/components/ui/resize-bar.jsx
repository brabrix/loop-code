import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

// Alça de redimensionamento vertical, igual à do shadcn (ResizableHandle withHandle),
// mas controlada por onMouseDown (pros nossos resizers custom: rail, devtools, árvore).
export function ResizeBar({ onMouseDown, className }) {
  return (
    <div
      onMouseDown={onMouseDown}
      title="Arraste para redimensionar"
      className={cn(
        'relative flex w-px shrink-0 cursor-col-resize items-center justify-center bg-border transition-colors hover:bg-primary',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2',
        className
      )}
    >
      <div className="z-10 flex h-5 w-3 items-center justify-center rounded-sm border bg-card">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    </div>
  );
}
