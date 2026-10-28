import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatDate } from '@/lib/date-format';
import type { QualificationStanding } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * A qualification's standing — POOLSE-27, 7b.2.
 *
 * **Its own colour system**, as CONVENTIONS asks of the four: attendance draws
 * *filled* chips in primary, warning and danger, so this one is **outlined**,
 * with a shield for every state — the shape, the icon and the words each carry
 * the meaning, so âmbar never reads as *falta justificada* and colour is never
 * alone. The sentence always carries the date: "Expira a 13-01-2027", never
 * just "âmbar".
 *
 * The status comes from the API (`qualification_status()` in SQL); this only
 * draws it.
 */

const LOOK: Record<QualificationStanding, { tone: string; Icon: typeof ShieldCheck }> = {
  green: { tone: 'border-success text-success', Icon: ShieldCheck },
  amber: { tone: 'border-warning text-warning', Icon: ShieldAlert },
  red: { tone: 'border-danger text-danger', Icon: ShieldX },
  missing: { tone: 'border-danger text-danger border-dashed', Icon: ShieldQuestion },
};

export function QualificationStatus({
  status,
  expiresOn,
  className,
}: {
  status: QualificationStanding;
  expiresOn: string | null;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();
  const { tone, Icon } = LOOK[status];

  const text =
    status === 'missing'
      ? t('qualifications.status.missing')
      : expiresOn === null
        ? t('qualifications.status.noExpiry')
        : t(`qualifications.status.${status}`, { date: formatDate(expiresOn) });

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-sm',
        tone,
        className,
      )}
    >
      <Icon className={cn('size-4 shrink-0', (status === 'red' || status === 'missing') && 'attention')} aria-hidden />
      {text}
    </span>
  );
}
