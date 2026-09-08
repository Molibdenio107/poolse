'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';

/**
 * The months a picker offers: two years back, three ahead.
 *
 * Newest first, because a club billing in September is far more likely to want
 * September than a month from 2024. The month currently in the URL is always
 * included even when it falls outside the window — a bookmark from last year
 * must not silently select a different month than the page is showing.
 */
function months(selected: string): string[] {
  const now = new Date();
  const values = new Set<string>();

  // From three months ahead down to twenty-four behind: `back` is how many
  // months to subtract, so a negative one is the future.
  for (let back = -3; back <= 24; back += 1) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    values.add(`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  if (!values.has(selected)) return [selected, ...values];
  return [...values];
}

/**
 * Which month, and which site.
 *
 * Both live in the URL, for the reason every filter here does: a run somebody is
 * halfway through checking survives a refresh, browser back steps through the
 * months, and the view can be sent to a colleague. It also keeps the preview a
 * server render rather than a fetch behind a spinner.
 *
 * `FilterSelect` is not reused: it exists for filters with an "all" option, and
 * neither of these has one — every document belongs to exactly one site and one
 * month, so an empty choice would mean nothing an operator could act on.
 *
 * The site picker appears only when there is a choice. A subscription covers one
 * facility unless the plan says otherwise, so for most clubs a dropdown of one
 * would be furniture.
 */
export function InvoiceFilters({
  facilityId,
  facilities,
  month,
}: {
  facilityId: string;
  facilities: { id: string; name: string }[];
  month: string;
}): React.ReactElement {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(name: string, value: string): void {
    const query = new URLSearchParams(params.toString());
    if (value === '') query.delete(name);
    else query.set(name, value);

    const href = query.size > 0 ? `${pathname}?${query}` : pathname;
    startTransition(() => router.replace(href, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className={FIELD_COLUMN}>
        <label htmlFor="invoice-month" className={FIELD_LABEL}>
          {t('invoices.month')}
        </label>
        {/*
          A select, not `<input type="month">` — F-17.

          The native control renders its label in the **browser's** locale and
          cannot be told otherwise, so a Portuguese interface read "September
          2026" and no amount of i18n on our side could reach inside it. These
          options are formatted with the app's own named `month` format, which is
          the same one any heading would use.

          Bounded to the months a club actually bills — two years back, three
          ahead for a season being priced early. An older month is still
          reachable: the value lives in the URL and the API takes any date.
        */}
        <select
          id="invoice-month"
          value={month}
          disabled={pending}
          onChange={(event) => set('month', event.target.value)}
          className={CONTROL_LINE}
        >
          {months(month).map((value) => (
            <option key={value} value={value}>
              {format.dateTime(new Date(`${value}-01T12:00:00Z`), 'month')}
            </option>
          ))}
        </select>
      </div>

      {facilities.length > 1 && (
        <div className={FIELD_COLUMN}>
          <label htmlFor="invoice-facility" className={FIELD_LABEL}>
            {t('invoices.facility')}
          </label>
          <select
            id="invoice-facility"
            value={facilityId}
            disabled={pending}
            onChange={(event) => set('facilityId', event.target.value)}
            className={CONTROL_LINE}
          >
            {facilities.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
