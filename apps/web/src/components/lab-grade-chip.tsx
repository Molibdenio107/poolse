import { AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import type { LabGrade } from '@/lib/water';
import { cn } from '@/lib/utils';

/**
 * A laboratory grade under NP 4542 §4.4 — POOLSE-72. Words and an icon, so the
 * tone is a hint and never the message. Shared by the pool's page and the
 * public water page, which must say the same thing about the same sample.
 */
export function LabGradeChip({
  grade,
  label,
  className,
}: {
  grade: LabGrade | null;
  label: string;
  className?: string | undefined;
}): React.ReactElement {
  const Icon = grade === 'conforme' ? CheckCircle2 : grade === 'nao_conforme' ? AlertTriangle : CircleAlert;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-sm font-medium',
        grade === 'conforme' && 'border-success/40 text-success',
        grade === 'conforme_condicionada' && 'border-warning/40 text-warning',
        grade === 'nao_conforme' && 'border-danger/40 text-danger',
        grade === null && 'border-border text-foreground-muted',
        className,
      )}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </span>
  );
}
