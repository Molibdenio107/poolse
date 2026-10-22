'use client';

import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check } from 'lucide-react';
import type { StudentFees } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { feeTotals } from '@/lib/fee-totals';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import { CoverBadge, lineLabel } from './fees-block';
import { PaymentDestinations } from '@/components/payment-destinations';

/**
 * What a family owes, read-only — 15 October 2026 (Rui).
 *
 * The office's fee block is a page of forms; a family needs the lines, whether
 * each is paid, and the two totals. The totals come from `feeTotals`, the same
 * function the office's block reads, so a parent and the office never see two
 * balances. Nothing here writes; where to pay is the club's own account,
 * when it has given one (POOLSE-94).
 */
export function FamilyFees({ fees }: { fees: StudentFees }): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const { live, paidTotal, outstanding } = feeTotals(fees);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('detailTabs.fees')}
      </h2>
      <p className="text-sm text-foreground-muted">
        {t(fees.payTo == null ? 'family.feesHint' : 'family.feesHintPayTo')}
      </p>

      <CoverBadge cover={fees.cover} />

      {live.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('family.noFees')}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {live.map((line) => (
              <li
                key={line.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{lineLabel(line, t)}</span>
                  <span className="text-sm text-foreground-muted">
                    {[line.facilityName, line.classGroupName, line.periodName]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="tabular-nums">{formatCents(locale, line.payableCents)}</span>
                  {/* A word and an icon for each state, never colour alone. */}
                  <span
                    className={cn(
                      'flex items-center gap-1 text-sm',
                      line.isPaid
                        ? 'text-foreground-muted'
                        : line.isOverdue
                          ? 'text-danger'
                          : 'text-foreground-muted',
                    )}
                  >
                    {line.isPaid ? (
                      <Check aria-hidden className="size-3.5" />
                    ) : line.isOverdue ? (
                      <AlertTriangle aria-hidden className="size-3.5" />
                    ) : null}
                    {line.isPaid
                      ? line.paidOn === null
                        ? t('fees.paidLabel')
                        : t('fees.paidOn', { date: formatDate(line.paidOn) })
                      : line.isOverdue
                        ? t('fees.overdueSince', { date: formatDate(line.dueOn) })
                        : line.dueOn === null
                          ? t('fees.notPaid')
                          : t('fees.dueBy', { date: formatDate(line.dueOn) })}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <dl className="flex flex-col gap-1 rounded bg-surface-muted p-4 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <dt className={cn(outstanding <= 0 && 'font-medium')}>{t('fees.totalPaid')}</dt>
              <dd className="tabular-nums">{formatCents(locale, paidTotal)}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <dt className={cn(outstanding > 0 && 'font-medium')}>{t('fees.totalRemaining')}</dt>
              <dd className={cn('tabular-nums', outstanding > 0 && 'font-medium text-warning')}>
                {formatCents(locale, Math.max(0, outstanding))}
              </dd>
            </div>
            {fees.penalties.mensalidadeCents > 0 && (
              <p className="flex items-center gap-1.5 text-danger">
                <AlertTriangle aria-hidden className="size-3.5" />
                {t('fees.penaltyMensalidadeApplied', {
                  amount: formatCents(locale, fees.penalties.mensalidadeCents),
                })}
              </p>
            )}
            {fees.penalties.quotaCents > 0 && (
              <p className="flex items-center gap-1.5 text-danger">
                <AlertTriangle aria-hidden className="size-3.5" />
                {t('fees.penaltyQuotaApplied', {
                  amount: formatCents(locale, fees.penalties.quotaCents),
                })}
              </p>
            )}
          </dl>
          {outstanding > 0 && fees.payTo != null && (
            <PaymentDestinations
              destinations={fees.payTo.destinations}
              references={[{ reference: fees.payTo.reference }]}
            />
          )}
        </>
      )}
    </section>
  );
}
