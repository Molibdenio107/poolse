import { BackLink } from '@/components/back-link';
import { cn } from '@/lib/utils';

/**
 * One shell for every page — POOLSE-41.
 *
 * Pages had drifted to five different content widths and three vertical
 * rhythms. Each looked fine alone; moving between them felt like moving between
 * two applications, which is the complaint that produced this ticket.
 *
 * **A page never sets its own outer padding.** That is the whole rule, and the
 * reason `scripts/check-layout.mjs` greps for it: drift returns one page at a
 * time, always for a good local reason, and the only defence is that adding it
 * fails a check rather than looking tidy in review.
 *
 * **One content width, centred, and wide content scrolls inside itself.** Still
 * no `max-w` *variants* — the choice AC5 rejected was per-page widths, and that
 * stands. What changed is the single width itself: full-bleed reads as designed
 * at 1440 and as an accident at 2560, where a table row puts the name and its
 * action a forearm apart. The cap is `max-w-page` in the Tailwind config, so it
 * is one number for the whole app; below it the page is fluid and nothing about
 * the small-screen behaviour changes.
 *
 * The cap goes on an inner column rather than on `<main>`, so the page's
 * background still runs to the edge of the window. A `<main>` that stopped at
 * 80rem would leave two grey margins on a wide monitor.
 *
 * **The header is a fixed height whether or not it has actions**, and the title
 * clamps rather than growing. A header that is four pixels taller on one page is
 * exactly the jump 41.1 is about, and it is invisible until you navigate.
 */
export function PageShell({
  title,
  subtitle,
  back,
  actions,
  filters,
  children,
  className,
}: {
  title: string;
  subtitle?: string | undefined;
  /** Rendered above the header, where every page already put it. */
  back?: { href: string; label: string } | undefined;
  /** Top right — the page's primary action, if it has one. */
  actions?: React.ReactNode;
  /** A search or filter row, between the header and the content. */
  filters?: React.ReactNode;
  children: React.ReactNode;
  /** For the content column only. Never for outer padding. */
  className?: string;
}): React.ReactElement {
  return (
    <main className="flex min-h-screen w-full justify-center px-page py-page-y">
      <div className="flex w-full max-w-page flex-col gap-page-gap">
        {back !== undefined && <BackLink href={back.href} label={back.label} />}

        <header className="flex min-h-page-header items-start justify-between gap-4">
          <div className="min-w-0">
            {/*
              Clamped, not wrapped without limit — 41.10. A long translated title
              has to be allowed to be long without making this page taller than the
              one beside it.
            */}
            <h1 className="line-clamp-2 text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle !== undefined && (
              <p className="line-clamp-2 text-sm text-foreground-muted">{subtitle}</p>
            )}
          </div>

          {actions !== undefined && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>

        {filters !== undefined && (
          <div className="flex flex-wrap items-end gap-3">{filters}</div>
        )}

        <div className={cn('flex flex-col gap-page-gap', className)}>{children}</div>
      </div>
    </main>
  );
}

/**
 * A page that could not load, in the shell rather than instead of it — AC6.
 *
 * The failure state was its own markup on every page, which meant a page that
 * failed looked like a different application from the same page succeeding.
 */
export function PageError({ message, detail }: { message: string; detail?: string }): React.ReactElement {
  return (
    <section className="rounded border border-danger/40 bg-danger/10 p-5">
      <p className="font-medium text-danger">{message}</p>
      {detail !== undefined && (
        <p className="mt-1 font-mono text-sm text-foreground-muted">{detail}</p>
      )}
    </section>
  );
}

/**
 * Nothing here yet, said in the shell's own spacing — AC6.
 *
 * Takes the same box as a populated section, so a list that arrives does not
 * move the page under somebody reading it.
 */
export function PageEmpty({
  message,
  hint,
  action,
}: {
  message: string;
  hint?: string | undefined;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col items-start gap-2 rounded border border-border bg-surface p-5">
      <p>{message}</p>
      {hint !== undefined && <p className="text-sm text-foreground-muted">{hint}</p>}
      {action}
    </section>
  );
}

/**
 * Wide content, scrolling inside itself — AC5.
 *
 * Named rather than left to each page to remember, because "the table scrolls,
 * the page does not" is the rule that breaks first and the one a narrow viewport
 * exposes immediately.
 */
export function ScrollX({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}): React.ReactElement {
  return <div className={cn('overflow-x-auto', className)}>{children}</div>;
}
