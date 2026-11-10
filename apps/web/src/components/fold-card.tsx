import { ChevronRight } from 'lucide-react';

/**
 * A card that folds — Dados do clube, 10-11-2026 (Rui: "too long to scroll …
 * maybe collapse the sections"). Closed it is one line: the title, and what is
 * set today in words, so the whole pill reads at a glance without opening
 * anything. Open it is the form. A native `<details>`: keyboard and screen
 * readers get a disclosure for free, and `DetailsAnimator` moves it smoothly.
 *
 * The summary line is information, not decoration: it says the value, or that
 * nothing is set, in visible text (never a tooltip).
 */
export function FoldCard({
  title,
  summary,
  open = false,
  children,
}: {
  title: string;
  /** What is set today, in words. */
  summary: string;
  open?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <details open={open} className="group rounded bg-surface shadow-card">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 rounded px-4 py-3 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-foreground-muted transition-transform group-open:rotate-90" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
          <span className="shrink-0 font-medium sm:w-56">{title}</span>
          <span className="truncate text-sm text-foreground-muted">{summary}</span>
        </span>
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
