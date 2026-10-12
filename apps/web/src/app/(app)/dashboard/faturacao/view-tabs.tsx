'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SectionPills } from '@/components/section-pills';

/**
 * Three views of one page: this month, what is still owed, and the settings
 * the documents are issued under.
 *
 * Real links rather than buttons, so each view is a URL that can be bookmarked,
 * sent to a colleague and reached by the browser's back button — the same reason
 * every filter here lives in the query string. It also means both work before
 * any JavaScript has loaded.
 *
 * **Drawn by `SectionPills`** since 12 October 2026, so a row that chooses
 * what the page shows looks the same here as on Preços, Turmas and Épocas — one
 * control, one look. It stays `?view=` rather than `?section=` because this
 * page's links and bookmarks already say `view`, and the reason for the row is
 * the same either way. `aria-current`, a fill and the label carry which one is
 * open; colour never does it alone.
 *
 * **Configuração** holds the series and the club's NIPC, which used to sit under
 * both lists and pushed the one somebody came for off the screen. Offered only
 * when the reader may read either of them.
 */
export type InvoiceView = 'month' | 'owing' | 'settings';

export function ViewTabs({
  view,
  settings,
}: {
  view: InvoiceView;
  /** Whether the Configuração view is offered. */
  settings: boolean;
}): React.ReactElement | null {
  const t = useTranslations();
  const pathname = usePathname();
  const params = useSearchParams();

  function href(next: InvoiceView): string {
    const query = new URLSearchParams(params.toString());
    if (next === 'month') query.delete('view');
    else query.set('view', next);
    // A different view is a different question, so a month left over from the
    // other one would filter a list that has no months in it.
    if (next !== 'month') query.delete('month');
    return query.size > 0 ? `${pathname}?${query}` : pathname;
  }

  const views: InvoiceView[] = settings ? ['month', 'owing', 'settings'] : ['month', 'owing'];
  const labels: Record<InvoiceView, string> = {
    month: t('invoices.viewMonth'),
    owing: t('invoices.viewOwing'),
    settings: t('invoices.viewSettings'),
  };

  return (
    <SectionPills
      label={t('invoices.views')}
      current={view}
      items={views.map((key) => ({ key, label: labels[key], href: href(key) }))}
    />
  );
}
