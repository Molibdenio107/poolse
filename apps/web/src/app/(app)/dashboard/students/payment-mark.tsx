import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

/**
 * Said only when there is something to say — round 5.
 *
 * This was a "Pago este mês" checkbox on every row. Four hundred ticked boxes
 * are four hundred things to read past to find the three that matter, and a
 * register is scanned rather than read. So the column is silent for everybody
 * who is up to date and speaks for the ones who are not.
 *
 * `due` is silent too: a payment that is not yet late is not news. It becomes
 * overdue on its own, on the day it is, because the state is computed against
 * `current_date` in Postgres rather than held anywhere.
 *
 * An icon and a word, never colour alone.
 */
export function PaymentMark({
  state,
}: {
  state: 'none' | 'paid' | 'due' | 'overdue';
}): React.ReactElement | null {
  const t = useTranslations();
  if (state !== 'overdue') return null;

  return (
    <span className="flex items-center gap-1.5 rounded bg-danger/10 px-2 py-0.5 text-sm text-danger">
      <AlertTriangle aria-hidden className="size-3.5" />
      {t('fees.overduePayment')}
    </span>
  );
}
