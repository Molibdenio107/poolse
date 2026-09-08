'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';

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
        <input
          id="invoice-month"
          type="month"
          value={month}
          disabled={pending}
          onChange={(event) => set('month', event.target.value)}
          className={CONTROL_LINE}
        />
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
