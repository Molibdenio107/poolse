'use client';

import { useTranslations } from 'next-intl';
import type { InvoiceLine } from '@/lib/api';

/**
 * What a line says, composed where the catalogue is.
 *
 * The document stores the club's **own** words — a level's name, a season's —
 * and the structured facts beside them: the kind, the frequency, the period. The
 * translated word for the kind is deliberately *not* stored, because a document
 * holding "Mensalidade" would read half in Portuguese for a club working in
 * English, and it would be frozen at the language of whoever pressed the button.
 *
 * One component, used by the preview and by the document, so a line cannot say
 * one thing before it is issued and another afterwards.
 */
export function LineLabel({ line }: { line: InvoiceLine }): React.ReactElement {
  const t = useTranslations();

  const parts = [t(`fees.kind.${line.kind}`)];
  if (line.description !== null) parts.push(line.description);

  return (
    <span>
      {parts.join(' — ')}
      {line.lessonsPerWeek !== null && (
        <span className="text-foreground-muted">
          {' '}
          {t('invoices.perWeek', { count: line.lessonsPerWeek })}
        </span>
      )}
    </span>
  );
}
