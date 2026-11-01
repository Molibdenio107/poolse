'use client';

import { useTranslations } from 'next-intl';
import type { InvoiceStatus } from '@/lib/api';
import { Badge, type BadgeTone } from '@/components/ui/badge';

/**
 * What state a document is in, said in words.
 *
 * **Colour never carries the meaning.** Every badge has its own text, so the
 * screen reads the same to somebody who cannot tell the amber from the red —
 * the standing rule, and the reason a status is a word first and a tint second.
 * The server decides which word; nothing here recomputes it.
 *
 * Drawn by the shared `Badge` since Slice 5 (01-11-2026), so a state reads the
 * same here as on every other screen.
 */
const TONES: Record<InvoiceStatus, BadgeTone> = {
  open: 'muted',
  partly_paid: 'pending',
  // Behind and needing a chase: the handoff's *Em atraso* is the late tone
  // (Slice 5, 01-11-2026), amber rather than the red it used to be.
  overdue: 'late',
  paid: 'ok',
  // A credited document and a credit note are both "not owed", and both are
  // quiet: the operator's attention belongs on the ones that are.
  credited: 'muted',
  credit_note: 'muted',
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
    <Badge tone={TONES[status]} className={className}>
      {status === 'overdue' && daysOverdue != null
        ? t('invoices.status.overdueBy', { days: daysOverdue })
        : t(`invoices.status.${status}`)}
    </Badge>
  );
}
