import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';
import { lastPage, pageHref, pageRange, type Paginated } from '@/lib/pagination';

/**
 * The one pagination control — POOLSE-29.
 *
 * Every list in the app renders this, so page size becomes a one-line change if
 * fifteen turns out to be wrong (criterion 8) and no list grows its own slightly
 * different set of arrows.
 *
 * **Links, not buttons.** These pages are server components whose filters are
 * already a plain GET form, and a page is meant to be linkable and to survive a
 * refresh (criterion 6). Anchors get all of that for free, plus middle-click to
 * open page 4 in a new tab, plus working before any JavaScript has loaded — the
 * same argument the register's search form already makes for itself.
 *
 * **It renders nothing when everything fits.** Criterion 3, and it matters more
 * than it sounds: a disabled control under a six-row list is furniture that
 * implies there is more to see.
 *
 * **The state is never colour alone.** The current page is marked by weight, a
 * border and `aria-current`, not by a tint — a tint is the first thing to
 * disappear against a dark surface. An arrow that cannot go anywhere is a
 * `<span>` rather than a greyed link, so it is genuinely not focusable rather
 * than merely looking unavailable.
 */
export async function Pagination<T>({
  /** The envelope straight from the API. */
  page: result,
  /** The path this list lives at, without a query string. */
  basePath,
  /**
   * The current query, so paging keeps the search term and the filters. Pass
   * the page's own `searchParams`; `page` inside it is replaced, not merged.
   */
  query = {},
  className,
}: {
  page: Paginated<T>;
  basePath: string;
  query?: Record<string, string | undefined>;
  className?: string;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();

  const pages = lastPage(result.total, result.limit);

  // Criterion 3: one page means no control at all, not a disabled one.
  if (result.total <= result.limit) return null;

  const { from, to } = pageRange(result.page, result.limit, result.total);
  const atStart = result.page <= 1;
  const atEnd = result.page >= pages;

  const step = (target: number, label: string, icon: React.ReactElement, disabled: boolean) =>
    disabled ? (
      <span
        aria-hidden="true"
        className="rounded border border-transparent p-2 text-foreground-muted/40"
      >
        {icon}
      </span>
    ) : (
      <Link
        href={pageHref(basePath, query, target)}
        aria-label={label}
        className="rounded border border-transparent p-2 text-foreground-muted hover:border-border hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {icon}
      </Link>
    );

  return (
    <nav
      aria-label={t('pagination.label')}
      className={cn('flex flex-wrap items-center justify-between gap-3 pt-4', className)}
    >
      {/*
        The range, as one translated sentence with three interpolated numbers —
        never assembled from fragments. "16–30 de 214" and "16–30 of 214" are not
        the same string with a word swapped, and the numerals are formatted by
        the locale.
      */}
      <p className="text-sm text-foreground-muted">
        {t('pagination.range', { from, to, total: result.total })}
      </p>

      <div className="flex items-center gap-1">
        {step(1, t('pagination.first'), <ChevronsLeft className="size-4" />, atStart)}
        {step(result.page - 1, t('pagination.previous'), <ChevronLeft className="size-4" />, atStart)}

        {/*
          Weight and a border, not a background tint — the tint is what stops
          being visible first in dark mode. `aria-current` says the same thing to
          anybody not looking at it.
        */}
        <span
          aria-current="page"
          className="rounded border border-border px-3 py-1.5 text-sm font-medium tabular-nums"
        >
          {t('pagination.page', { page: result.page, pages })}
        </span>

        {step(result.page + 1, t('pagination.next'), <ChevronRight className="size-4" />, atEnd)}
        {step(pages, t('pagination.last'), <ChevronsRight className="size-4" />, atEnd)}
      </div>
    </nav>
  );
}
