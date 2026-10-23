'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SectionPills } from '@/components/section-pills';

/**
 * Two views of one page: this month, and what is still owed.
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
 * A third, **Configuração**, held the numbering books until 23 October 2026;
 * they are a card on the site's *Dados do clube* tab now (POOLSE-104 B).
 */
export type InvoiceView = 'month' | 'owing';

export function ViewTabs({ view }: { view: InvoiceView }): React.ReactElement | null {
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

  const views: InvoiceView[] = ['month', 'owing'];
  const labels: Record<InvoiceView, string> = {
    month: t('invoices.viewMonth'),
    owing: t('invoices.viewOwing'),
  };

  return (
    <SectionPills
      label={t('invoices.views')}
      current={view}
      items={views.map((key) => ({ key, label: labels[key], href: href(key) }))}
    />
  );
}
