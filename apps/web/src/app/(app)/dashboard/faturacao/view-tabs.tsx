'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * Two views of one page: this month, and what is still owed.
 *
 * Real links rather than buttons, so each view is a URL that can be bookmarked,
 * sent to a colleague and reached by the browser's back button — the same reason
 * every filter here lives in the query string. It also means both work before
 * any JavaScript has loaded.
 *
 * `aria-current` rather than colour alone carries which one is selected.
 */
export function ViewTabs({ owing }: { owing: boolean }): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const params = useSearchParams();

  function href(view: 'month' | 'owing'): string {
    const query = new URLSearchParams(params.toString());
    if (view === 'owing') query.set('view', 'owing');
    else query.delete('view');
    // A different view is a different question, so a month left over from the
    // other one would filter a list that has no months in it.
    if (view === 'owing') query.delete('month');
    return query.size > 0 ? `${pathname}?${query}` : pathname;
  }

  const TAB =
    'rounded px-3 py-1.5 text-sm transition-colors focus-visible:outline ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

  return (
    <nav aria-label={t('invoices.views')} className="flex gap-2">
      <Link
        href={href('month')}
        aria-current={owing ? undefined : 'page'}
        className={cn(
          TAB,
          owing
            ? 'text-foreground-muted hover:bg-surface-muted'
            : 'bg-primary/15 font-medium text-primary',
        )}
      >
        {t('invoices.viewMonth')}
      </Link>
      <Link
        href={href('owing')}
        aria-current={owing ? 'page' : undefined}
        className={cn(
          TAB,
          owing
            ? 'bg-primary/15 font-medium text-primary'
            : 'text-foreground-muted hover:bg-surface-muted',
        )}
      >
        {t('invoices.viewOwing')}
      </Link>
    </nav>
  );
}
