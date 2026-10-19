import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import type { PoolClosure } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';

/**
 * "Encerrado até 24-03-2027 — Esvaziamento", wherever a tank is drawn —
 * POOLSE-84. Instalações, the site's page and reception all read the same
 * `closure` the API derives from `pool_closures_on`, so a tank that is shut says
 * so in the same words everywhere, with its reason, as visible text. The lock is
 * there so the warning tone is not the only thing that says it.
 */
export function PoolClosureNote({
  closure,
  className,
}: {
  closure: PoolClosure | null | undefined;
  className?: string;
}): React.ReactElement | null {
  const t = useTranslations();
  if (closure === null || closure === undefined) return null;

  const when =
    closure.partOfDay === null
      ? t('facilities.closedUntil', { date: formatDate(closure.until) })
      : t(`facilities.closedHalf.${closure.partOfDay}`);

  return (
    <p className={cn('flex items-start gap-1.5 text-sm text-warning', className)}>
      <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        <span className="font-medium">{when}</span>
        {closure.reason !== '' && <span> — {closure.reason}</span>}
      </span>
    </p>
  );
}
