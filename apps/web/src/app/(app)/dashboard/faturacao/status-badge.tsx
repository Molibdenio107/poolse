'use client';

import { useTranslations } from 'next-intl';
import type { InvoiceStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * What state a document is in, said in words.
 *
 * **Colour never carries the meaning.** Every badge has its own text, so the
 * screen reads the same to somebody who cannot tell the amber from the red —
 * the standing rule, and the reason a status is a word first and a tint second.
 * The server decides which word; nothing here recomputes it.
 *
 * Solid tints on the surface rather than washed fills, for the reason the level
 * colours are solid: a wash of the background at 10% is a colour doing no work.
 */
const TONES: Record<InvoiceStatus, string> = {
  open: 'border-border text-foreground-muted',
  partly_paid: 'border-primary/40 bg-primary/10 text-primary',
  overdue: 'border-danger/40 bg-danger/10 text-danger',
  paid: 'border-success/40 bg-success/10 text-success',
  // A credited document and a credit note are both "not owed", and both are
  // quiet: the operator's attention belongs on the ones that are.
  credited: 'border-border bg-surface-muted text-foreground-muted',
  credit_note: 'border-border bg-surface-muted text-foreground-muted',
};

export function StatusBadge({
  status,
  daysOverdue,
  className,
}: {
  status: InvoiceStatus;
  /** Shown only when it is still owed — from the server, never from a clock here. */
  daysOverdue?: number | null;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2 py-0.5 text-xs whitespace-nowrap',
        TONES[status],
        className,
      )}
    >
      {status === 'overdue' && daysOverdue != null
        ? t('invoices.status.overdueBy', { days: daysOverdue })
        : t(`invoices.status.${status}`)}
    </span>
  );
}
