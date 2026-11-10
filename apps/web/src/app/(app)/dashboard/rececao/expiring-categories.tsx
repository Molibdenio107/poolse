import { getTranslations } from 'next-intl/server';
import { AlertTriangle } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { apiFetch, type ExpiringCategory } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { PANEL, PANEL_TITLE } from './styles';

/**
 * *Categorias a expirar* — POOLSE-202, rule 5. Every person category with 30
 * days or fewer left, soonest first: the office renews the proof before the
 * next sale falls back to the base price. Not paginated, a queue worked down.
 * Which rows are expiring is SQL's (`person_category_status`).
 */
export async function ExpiringCategories(): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const answer = await outcome(apiFetch<{ expiring: ExpiringCategory[] }>('/person-categories/expiring'));
  if (answer.state === 'refused') return null;

  return (
    // Categories about to expire light Receção (POOLSE-202); this card is where (POOLSE-214).
    <section
      aria-labelledby="reception-expiring"
      className={`${PANEL}${answer.state === 'ok' && answer.data.expiring.length > 0 ? ' attention-card' : ''}`}
    >
      <h2 id="reception-expiring" className={`${PANEL_TITLE} flex items-center gap-2`}>
        {t('personCategories.expiringTitle')}
        {answer.state === 'ok' && answer.data.expiring.length > 0 && <span aria-hidden className="attention-dot" />}
      </h2>
      {answer.state === 'failed' ? (
        <p className="text-sm text-danger">{t('personCategories.loadFailed')}</p>
      ) : answer.data.expiring.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('personCategories.expiringNone')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {answer.data.expiring.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-col">
                {row.studentId !== null ? (
                  <FromLink href={`/dashboard/students/${row.studentId}`} className="font-semibold text-primary hover:underline">
                    {row.personName}
                  </FromLink>
                ) : (
                  <span className="font-semibold">{row.personName}</span>
                )}
                <span className="text-sm text-foreground-muted">{row.name}</span>
              </span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
                {t('personCategories.expiresOn', { date: formatDate(row.validUntil) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
