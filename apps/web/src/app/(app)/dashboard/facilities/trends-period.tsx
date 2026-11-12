'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { SelectList } from '@/components/ui/list-select';

const SELECT =
  'h-control rounded-sm border border-border-strong bg-background px-2.5 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Ano* and *Mês* for Tendências (Rui, 12-11-2026).
 *
 * The URL is the state, as `FilterSelect` does it: `?year=&month=` (`month=all`
 * is the whole year), so a reload, a shared link and Voltar keep the period.
 * A new year drops the month, and the page opens that year on its latest month.
 * Only years and months that have readings are offered (`periodsOffered`).
 */
export function TrendsPeriod({
  offered,
  year,
  month,
  monthNames,
}: {
  offered: { year: number; months: number[] }[];
  year: number;
  /** 1–12, or null for the whole year. */
  month: number | null;
  /** January to December in the reader's language, from the server. */
  monthNames: string[];
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const go = (next: { year: string; month: string | null }): void => {
    const query = new URLSearchParams(params.toString());
    query.set('section', 'trends');
    query.set('year', next.year);
    if (next.month === null) query.delete('month');
    else query.set('month', next.month);
    query.delete('page');
    startTransition(() => router.replace(`${pathname}?${query}`, { scroll: false }));
  };

  const months = offered.find((one) => one.year === year)?.months ?? [];

  return (
    <div className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div className="flex min-w-32 flex-col gap-1.5">
        <label htmlFor="trends-year" className="text-sm text-foreground-muted">
          {t('facilities.trends.year')}
        </label>
        <SelectList
          id="trends-year"
          value={String(year)}
          onChange={(event) => go({ year: event.target.value, month: null })}
          className={SELECT}
        >
          {offered.map((one) => (
            <option key={one.year} value={one.year}>
              {one.year}
            </option>
          ))}
        </SelectList>
      </div>
      <div className="flex min-w-40 flex-col gap-1.5">
        <label htmlFor="trends-month" className="text-sm text-foreground-muted">
          {t('facilities.trends.month')}
        </label>
        <SelectList
          id="trends-month"
          value={month === null ? 'all' : String(month)}
          onChange={(event) => go({ year: String(year), month: event.target.value })}
          className={SELECT}
        >
          <option value="all">{t('facilities.trends.wholeYear')}</option>
          {months.map((one) => (
            <option key={one} value={one}>
              {monthNames[one - 1]}
            </option>
          ))}
        </SelectList>
      </div>
    </div>
  );
}
